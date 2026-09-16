// Authorized repair of the exact unlaunched daemon continuity incident.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, openSync, closeSync, fsyncSync, writeFileSync, readFileSync, readlinkSync, lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DAEMON_REPAIR as P, validateDaemonRepairPredecessor, buildDaemonRepairedState } from "./production-maintenance-daemon-repair.mjs";
import { validateTransportRepairLedger } from "./repair-unlaunched-transport.mjs";
import { assertMaintenanceRecoveryProgress } from "./production-maintenance-recovery.mjs";
import { productionOperations, withPrivateOperationLock, validateMaintenanceState, validateMaintenanceSubproofBindings } from "./production-maintenance-control.mjs";
import { MAINTENANCE_RECOVERY_MIGRATION_SQL } from "./production-maintenance-recovery-evidence.mjs";
import { MAINTENANCE_PSQL_CONTAINER_SCRIPT } from "./check-production-maintenance-capabilities.mjs";

const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/, ID = /^[1-9][0-9]{0,15}$/;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fail = () => { throw new Error("daemon_repair_unverified"); };
const hash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const command = (file, args, input) => {
  const result = spawnSync(file, args, { cwd: root, input, encoding: "utf8", timeout: 20000, maxBuffer: 4194304,
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (result.error || result.signal || result.status !== 0) fail();
  return result.stdout;
};
const REVIEWED_CORE = Object.freeze({
  "scripts/production-maintenance-control.mjs": "0083c096dccdda3a37d6c0c54ef30fc51836b574a47a82e067710d0e0c4417a3",
  "scripts/production-maintenance-recovery.mjs": "464403b4f1f10370eb6c8ae3046db634e96fa0f7cdf87f8aa2c5f30cd8e61e21",
  "scripts/production-maintenance-daemon-continuity.mjs": "33714dbfc634247634ed54f4b3f4d14cd17253a411f5c822713343b63393d1b0",
  "scripts/production-maintenance-daemon-continuity.test.mjs": "6e288457716285356126642e2a76c5b0100b60efa873f9d4d9c8cbb75c7f5310"
});
export const DAEMON_REPAIR_PATHS = Object.freeze([
  "scripts/production-maintenance-daemon-continuity.mjs",
  "scripts/production-maintenance-daemon-continuity.test.mjs",
  "scripts/production-maintenance-recovery.mjs",
  "scripts/production-maintenance-control.mjs",
  "scripts/production-maintenance-daemon-repair.mjs",
  "scripts/repair-daemon.mjs",
  "scripts/repair-daemon-workflow.mjs",
  "scripts/repair-daemon.test.mjs",
  ".github/workflows/repair-daemon.yml",
  "docs/daemon-repair-20260917.md"
]);
export function readDaemonRepairSource(sha, git = args => command("/usr/bin/git", args)) {
  if (!SHA.test(sha) || sha === P.previousTargetSha) fail();
  const check = () => { if (git(["rev-parse", "HEAD"]).trim() !== sha || git(["status", "--porcelain", "--untracked-files=all"]) !== "") fail(); };
  check(); git(["merge-base", "--is-ancestor", P.previousTargetSha, sha]);
  const paths = git(["diff", "--name-only", "--no-renames", "--no-ext-diff", "--no-textconv", P.previousTargetSha, sha, "--"]).trim().split("\n");
  if (paths.length !== DAEMON_REPAIR_PATHS.length || new Set(paths).size !== paths.length || paths.some(p => !DAEMON_REPAIR_PATHS.includes(p))) fail();
  const changes = paths.sort().map(file => {
    const old = ["scripts/production-maintenance-daemon-continuity.mjs", "scripts/production-maintenance-daemon-continuity.test.mjs", "scripts/production-maintenance-recovery.mjs", "scripts/production-maintenance-control.mjs"].includes(file)
      ? git(["show", `${P.previousTargetSha}:${file}`]) : "";
    const content = git(["show", `${sha}:${file}`]);
    if (Object.hasOwn(REVIEWED_CORE, file) && hash(content) !== REVIEWED_CORE[file]) fail();
    const tree = git(["ls-tree", sha, "--", file]);
    if (!tree.startsWith("100644 blob ") || tree.split("\n").length !== 2) fail();
    if (old === "" && git(["ls-tree", P.previousTargetSha, "--", file]) !== "") fail();
    return { file, before: hash(old), after: hash(content) };
  });
  check(); return hash(changes);
}
export function validateDaemonRepairAuthority(value, sha, runId, now = Date.now()) {
  if (!exact(value, ["version", "kind", "targetSha", "runId", "runAttempt", "operationId", "failedRunId", "mainCIrunId", "historyDigest", "checkedAt"]) ||
      value.version !== 1 || value.kind !== "faolla-daemon-repair" || !SHA.test(sha) || value.targetSha !== sha || !ID.test(runId) ||
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
  return validateTransportRepairLedger(rows, db.databaseOid, catalog, P.createdAt);
}
export async function runDaemonRepair(action, sha, runId, authority, ops, sourceDigest, request) {
  if (!["inspect", "repair"].includes(action)) fail();
  validateDaemonRepairAuthority(authority, sha, runId, ops.now());
  const snapshot = await ops.readRecoverySnapshot();
  const state = validateDaemonRepairPredecessor(snapshot.state, { bootId: ops.bootId(), now: ops.now() });
  if (snapshot.digest !== P.stateDigest || snapshot.revision !== P.revision) fail();
  ops.validateProofs(state);
  const verify = async () => { await ops.verifyIngress(state.ingress); await ops.assertRuntimeStopped(state.runtime); await ops.assertDatabaseQuiet(state.database); };
  await verify();
  const migrationDigest = await ops.readDaemonLedger(state);
  if (migrationDigest !== "2190b7868b879233c8d4852810d7d2ee186271005104c78bc229484b60d58388") fail();
  await verify();
  if (await ops.readDaemonLedger(state) !== migrationDigest) fail();
  validateDaemonRepairAuthority(authority, sha, runId, ops.now());
  const repairedAt = ops.now();
  const next = buildDaemonRepairedState(state, { version: 1, predecessor: state, targetSha: sha, repairedAt, runId,
    mainCIrunId: authority.mainCIrunId, sourceDigest, historyDigest: authority.historyDigest, historyCheckedAt: authority.checkedAt, migrationDigest },
    { bootId: ops.bootId(), now: repairedAt });
  validateMaintenanceState(next, request, ops.bootId(), ops.now()); validateMaintenanceSubproofBindings(next); ops.validateProofs(next);
  assertMaintenanceRecoveryProgress(state, next);
  if (JSON.stringify(state) !== JSON.stringify(next.daemonRepair.predecessor)) fail();
  // Exercise the real pinned predecessor through validation and later write
  // guards before any persistence. No fixture can substitute the host digest.
  const later = structuredClone(next); later.revision++;
  assertMaintenanceRecoveryProgress(next, later);
  for (const key of ["runtime", "database", "recovery", "tokenHash", "createdAt", "operationId", "targetSha", "daemonRepair"]) {
    const bad = structuredClone(later); bad[key] = null;
    let rejected = false; try { assertMaintenanceRecoveryProgress(next, bad); } catch { rejected = true; }
    if (!rejected) fail();
  }
  if (action === "inspect") return { state: "daemon-inspected", operationId: P.operationId, launchAttempted: false };
  await ops.archiveDaemonPredecessor(state, authority);
  const saved = await ops.commitDaemonRepair(snapshot, next);
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
    const authority = validateDaemonRepairAuthority(JSON.parse(readFileSync(file)), sha, runId);
    stage = "source";
    const sourceDigest = readDaemonRepairSource(sha);
    const request = { action: "repair-daemon", appDir: P.appDir, appName: P.appName, appPort: P.appPort,
      targetSha: sha, previousTargetSha: P.previousTargetSha, expectedOldSha: P.expectedOldSha, operationId: P.operationId };
    stage = "operations";
    const ops = await productionOperations(request);
    ops.readDaemonLedger = ledger;
    ops.archiveDaemonPredecessor = (state, auth) => {
      const directory = "/var/lib/faolla-maintenance/merchant-space";
      createPrivate(directory + "/daemon-35156337705.predecessor.json", JSON.stringify(state));
      createPrivate(directory + "/daemon-35156337705.authority.json", JSON.stringify(auth));
    };
    stage = "held-verification-and-cas";
    const result = await withPrivateOperationLock(request, () => runDaemonRepair(action, sha, runId, authority, ops, sourceDigest, request));
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch { process.stderr.write("daemon_repair_unverified:" + stage + "\n"); process.exitCode = 1; }
}
