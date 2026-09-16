// One explicitly authorized, unlaunched SSH failure. This is not a general
// failed-state reset. Original v2 bytes and the failed run remain audit evidence.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, openSync, closeSync, fsyncSync, writeFileSync, readFileSync, readlinkSync, lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildMaintenanceRecoveredState, createMaintenanceRecoveryInspection } from "./production-maintenance-recovery.mjs";
import { productionOperations, withPrivateOperationLock, validateMaintenanceState, validateMaintenanceSubproofBindings } from "./production-maintenance-control.mjs";
import { MAINTENANCE_RECOVERY_MIGRATION_SQL } from "./production-maintenance-recovery-evidence.mjs";
import { MAINTENANCE_PSQL_CONTAINER_SCRIPT } from "./check-production-maintenance-capabilities.mjs";

export const TRANSPORT_REPAIR = Object.freeze({
  operationId: "78124069-9a5c-4eb5-aaaf-fe80ef1db2b1",
  previousTargetSha: "b342b2e1f794d58cda81c44541fabc2e4738e2e3",
  expectedOldSha: "a06a5921e2fad5797e58304b828dfcf16b7ec43b",
  stateDigest: "6830689a185f448380683c0a439b516b1165fead84b81cc0b55d11f566ea75a7",
  revision: 4, createdAt: 1789580413188,
  bootId: "e6531ec9-db4a-4216-b87a-7cc858197eaa",
  failedRunId: "35131822753", backupRunId: "35129762971", readinessRunId: "35131689002",
  appDir: "/www/wwwroot/merchant-space", appName: "merchant-space", appPort: 3000,
  release: "/www/wwwroot/merchant-space.releases/a06a5921e2fa-20260916054114",
});
const P = TRANSPORT_REPAIR, SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/, ID = /^[1-9][0-9]{0,15}$/;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fail = () => { throw new Error("unlaunched_transport_repair_unverified"); };
const hash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const command = (file, args, input) => {
  const result = spawnSync(file, args, { cwd: root, input, encoding: "utf8", timeout: 20000, maxBuffer: 4194304,
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (result.error || result.signal || result.status !== 0) fail();
  return result.stdout;
};
export const TRANSPORT_REPAIR_PATHS = Object.freeze([
  ".github/workflows/deploy.yml", ".github/workflows/repair-unlaunched-transport.yml",
  "scripts/production-maintenance-control.mjs", "scripts/repair-unlaunched-transport.mjs",
  "scripts/repair-unlaunched-transport-workflow.mjs", "scripts/repair-unlaunched-transport.test.mjs",
  "docs/transport-repair-20260916.md",
]);
export function validateTransportRepairEdits(file, before, after) {
  if (file === ".github/workflows/deploy.yml") {
    const line = "            -o ServerAliveInterval=30 -o ServerAliveCountMax=10 -o TCPKeepAlive=yes \\\n";
    if (after.split(line).length !== 2 || after.replace(line, "") !== before) fail();
  } else if (file === "scripts/production-maintenance-control.mjs") {
    const exported = "\nexport { withPrivateOperationLock, productionOperations };\n";
    if (after.split(exported).length !== 2 || after.replace(exported, "") !== before) fail();
  } else if (!TRANSPORT_REPAIR_PATHS.includes(file) || before !== "") fail();
}
export function readTransportRepairSource(sha, git = args => command("/usr/bin/git", args)) {
  if (!SHA.test(sha) || sha === P.previousTargetSha) fail();
  const check = () => { if (git(["rev-parse", "HEAD"]).trim() !== sha || git(["status", "--porcelain", "--untracked-files=all"]) !== "") fail(); };
  check(); git(["merge-base", "--is-ancestor", P.previousTargetSha, sha]);
  const paths = git(["diff", "--name-only", "--no-renames", "--no-ext-diff", "--no-textconv", P.previousTargetSha, sha, "--"]).trim().split("\n");
  if (paths.length !== TRANSPORT_REPAIR_PATHS.length || new Set(paths).size !== paths.length || paths.some(p => !TRANSPORT_REPAIR_PATHS.includes(p))) fail();
  const changes = paths.sort().map(file => {
    const old = [".github/workflows/deploy.yml", "scripts/production-maintenance-control.mjs"].includes(file)
      ? git(["show", `${P.previousTargetSha}:${file}`]) : "";
    const content = git(["show", `${sha}:${file}`]);
    const tree = git(["ls-tree", sha, "--", file]);
    if (!tree.startsWith("100644 blob ") || tree.split("\n").length !== 2) fail();
    validateTransportRepairEdits(file, old, content);
    return { file, before: hash(old), after: hash(content) };
  });
  check(); return hash(changes);
}
export function validateTransportRepairPredecessor(state, now = Date.now()) {
  if (state.version !== 2 || state.phase !== "failed-held" || state.revision !== P.revision || hash(state) !== P.stateDigest ||
      state.operationId !== P.operationId || state.targetSha !== P.previousTargetSha || state.expectedOldSha !== P.expectedOldSha ||
      state.bootId !== P.bootId || state.createdAt !== P.createdAt || now < P.createdAt || now >= P.createdAt + 43200000 - 1200000 ||
      ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"].some(k => state[k] !== null)) fail();
  return state;
}
export function validateTransportRepairLedger(value, oid, catalog, now = P.createdAt) {
  if (!exact(value, ["readOnly", "databaseOid", "rows"]) || value.readOnly !== true || value.databaseOid !== oid || !Number.isSafeInteger(oid) || oid < 1 ||
      !Array.isArray(value.rows) || value.rows.length !== 56 || catalog.length !== 56) fail();
  for (let i = 0; i < catalog.length; i++) {
    const row = value.rows[i], name = /^(\d{12})_([a-z][a-z0-9_]+)\.sql$/.exec(catalog[i]);
    if (!name || (i > 0 && catalog[i] <= catalog[i - 1]) || !exact(row, ["version", "name", "appliedAt"]) || row.version !== name[1] || row.name !== name[2] ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(row.appliedAt)) fail();
    const ms = Date.parse(row.appliedAt);
    if (!Number.isSafeInteger(ms) || new Date(ms).toISOString() !== row.appliedAt.slice(0, 23) + "Z" ||
        BigInt(ms) * 1000n + BigInt(row.appliedAt.slice(23, 26)) > BigInt(now) * 1000n) fail();
  }
  return hash(value.rows);
}
export function validateTransportRepairAuthority(value, sha, runId, now = Date.now()) {
  if (!exact(value, ["version", "kind", "targetSha", "runId", "runAttempt", "operationId", "failedRunId", "mainCIrunId", "historyDigest", "checkedAt"]) ||
      value.version !== 1 || value.kind !== "faolla-unlaunched-transport-repair" || !SHA.test(sha) || value.targetSha !== sha || !ID.test(runId) ||
      value.runId !== runId || value.runAttempt !== 1 || value.operationId !== P.operationId || value.failedRunId !== P.failedRunId ||
      !ID.test(value.mainCIrunId) || !HASH.test(value.historyDigest) || !Number.isSafeInteger(value.checkedAt) ||
      value.checkedAt > now || now - value.checkedAt > 300000) fail();
  return value;
}
function createPrivate(file, bytes) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  const parent = openSync(dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
function ledger(state) {
  const db = state.database;
  const observed = JSON.parse(command("docker", ["--host", "unix:///var/run/docker.sock", "inspect", "--format", '{"id":{{json .Id}},"image":{{json .Config.Image}},"running":{{json .State.Running}}}', "supabase-db"]));
  if (observed.id !== db.id || observed.image !== db.image || observed.running !== true) fail();
  const rows = JSON.parse(command("docker", ["--host", "unix:///var/run/docker.sock", "exec", "-i", db.id, "sh", "-c", MAINTENANCE_PSQL_CONTAINER_SCRIPT], MAINTENANCE_RECOVERY_MIGRATION_SQL));
  const catalog = command("/usr/bin/git", ["ls-tree", "--name-only", P.previousTargetSha + ":scripts/supabase-migrations"]).trim().split("\n").filter(n => /^\d{12}_.*\.sql$/.test(n)).sort();
  return validateTransportRepairLedger(rows, db.databaseOid, catalog);
}
export async function runTransportRepair(action, sha, runId, authority, ops, sourceDigest, request) {
  if (!["inspect", "repair"].includes(action)) fail();
  validateTransportRepairAuthority(authority, sha, runId, ops.now());
  const snapshot = await ops.readRecoverySnapshot(), state = validateTransportRepairPredecessor(snapshot.state, ops.now());
  if (snapshot.digest !== P.stateDigest || snapshot.revision !== P.revision || ops.bootId() !== P.bootId) fail();
  ops.validateProofs(state);
  const verify = async () => { await ops.verifyIngress(state.ingress); await ops.assertRuntimeStopped(state.runtime); await ops.assertDatabaseQuiet(state.database); };
  await verify();
  const migrationDigest = await ops.readTransportLedger(state);
  const context = { operationId: P.operationId, previousTargetSha: P.previousTargetSha, targetSha: sha, expectedOldSha: P.expectedOldSha,
    expectedRevision: snapshot.revision, expectedDigest: snapshot.digest, bootId: ops.bootId(), now: ops.now(), sourceDiffDigest: sourceDigest, migrationDigest };
  const inspection = createMaintenanceRecoveryInspection(state, context);
  if (action === "inspect") return { ...inspection, launchAttempted: false };
  await verify();
  if (await ops.readTransportLedger(state) !== migrationDigest) fail();
  validateTransportRepairAuthority(authority, sha, runId, ops.now());
  const evidence = { ...inspection, toolsSha: sha, recoveryRunId: runId, recoveryRunAttempt: 1, mainCIrunId: authority.mainCIrunId,
    historyDigest: authority.historyDigest, historyCheckedAt: authority.checkedAt };
  const next = buildMaintenanceRecoveredState(state, evidence, { ...context, now: ops.now() });
  validateMaintenanceState(next, request, ops.bootId(), ops.now()); validateMaintenanceSubproofBindings(next); ops.validateProofs(next);
  await ops.archiveTransportPredecessor(state, authority);
  const saved = await ops.commitRecovery(snapshot, next);
  if (JSON.stringify(saved) !== JSON.stringify(next)) fail();
  return { version: 1, operationId: P.operationId, targetSha: sha, expectedOldSha: P.expectedOldSha, state: "held" };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let stage = "arguments";
  try {
    const [action, sha, runId, file] = process.argv.slice(2);
    if (process.platform !== "linux" || process.getuid?.() !== 0 || readlinkSync(P.appDir + ".current") !== P.release) fail();
    stage = "authority";
    const meta = lstatSync(file);
    if (!meta.isFile() || meta.isSymbolicLink() || meta.uid !== 0 || meta.nlink !== 1 || (meta.mode & 0o077) || meta.size > 8192) fail();
    const authority = validateTransportRepairAuthority(JSON.parse(readFileSync(file)), sha, runId);
    stage = "source";
    const sourceDigest = readTransportRepairSource(sha);
    const request = { action: "recover-held", appDir: P.appDir, appName: P.appName, appPort: P.appPort,
      targetSha: sha, previousTargetSha: P.previousTargetSha, expectedOldSha: P.expectedOldSha, operationId: P.operationId };
    stage = "operations";
    const ops = await productionOperations(request);
    ops.readTransportLedger = ledger;
    ops.archiveTransportPredecessor = (state, auth) => {
      const directory = "/var/lib/faolla-maintenance/merchant-space";
      createPrivate(directory + "/transport-35131822753.predecessor.json", JSON.stringify(state));
      createPrivate(directory + "/transport-35131822753.authority.json", JSON.stringify(auth));
    };
    stage = "held-verification-and-cas";
    const result = await withPrivateOperationLock(request, () => runTransportRepair(action, sha, runId, authority, ops, sourceDigest, request));
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch { process.stderr.write("unlaunched_transport_repair_unverified:" + stage + "\n"); process.exitCode = 1; }
}
