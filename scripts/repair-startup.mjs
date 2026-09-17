// Authorized repair of the exact confirmed, stopped startup attribution incident.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, openSync, closeSync, fsyncSync, writeFileSync, readFileSync, readlinkSync, lstatSync, realpathSync, symlinkSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STARTUP_REPAIR as P, validateStartupRepairPredecessor, buildStartupRepairedState } from "./production-maintenance-startup-repair.mjs";
import { validateTransportRepairLedger } from "./repair-unlaunched-transport.mjs";
import { assertMaintenanceRecoveryProgress } from "./production-maintenance-recovery.mjs";
import { productionOperations, withPrivateOperationLock, validateMaintenanceState, validateMaintenanceSubproofBindings } from "./production-maintenance-control.mjs";
import { MAINTENANCE_RECOVERY_MIGRATION_SQL } from "./production-maintenance-recovery-evidence.mjs";
import { MAINTENANCE_PSQL_CONTAINER_SCRIPT } from "./check-production-maintenance-capabilities.mjs";

const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/, ID = /^[1-9][0-9]{0,15}$/;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fail = () => { throw new Error("startup_repair_unverified"); };
const hash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const command = (file, args, input) => {
  const result = spawnSync(file, args, { cwd: root, input, encoding: "utf8", timeout: 20000, maxBuffer: 4194304,
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (result.error || result.signal || result.status !== 0) fail();
  return result.stdout;
};
const REVIEWED_CORE = Object.freeze({
  "scripts/production-maintenance-control.mjs": "0dab2e6f567b0030fdb0861086a9bc3f6b00d8cbe66c1386d6deb17f82fbed08",
  "scripts/production-maintenance-recovery.mjs": "326951222d35dc04d11144fbc85efff47223ca35428e6214029c30c694697a65",
  "scripts/check-production-runtime-supervision.mjs": "dae80654e87692425f820d051362a02c8a62875a6f929933ca6ede52c37cabc4",
  "scripts/check-production-runtime-supervision.test.mjs": "843adc950afb8e14e4d15cf038ff6f1c0b3f406497eb0ad7bf63e421eb2fc573",
  "scripts/production-maintenance-runtime.mjs": "0463a519d696429cbcc95add9d3f7029aa3cc241a49dbb2e92c754bffda0561e",
  "scripts/production-maintenance-runtime.test.mjs": "99785a3029358c738569fc304e777718f7d76c15b2e9216a07f805f4bc22f3e6",
  ".github/workflows/ci.yml": "b416bf170254a35963c260d1ca5569ed04f51bc99cf71738e379b624a0abf0d4",
  "scripts/repair-daemon.test.mjs": "4993590329f25f7c05bc74195ce8eea6564bceb279996db86dc12bdfa73bdcc6"
});
export const STARTUP_REPAIR_PATHS = Object.freeze([
  "scripts/check-production-runtime-supervision.mjs",
  "scripts/check-production-runtime-supervision.test.mjs",
  "scripts/production-maintenance-runtime.mjs",
  "scripts/production-maintenance-runtime.test.mjs",
  ".github/workflows/ci.yml",
  "scripts/production-maintenance-next-startup-acceptance.mjs",
  "scripts/repair-daemon.test.mjs",
  "scripts/production-maintenance-recovery.mjs",
  "scripts/production-maintenance-control.mjs",
  "scripts/production-maintenance-startup-repair.mjs",
  "scripts/repair-startup.mjs",
  "scripts/repair-startup-workflow.mjs",
  "scripts/repair-startup.test.mjs",
  ".github/workflows/repair-startup.yml",
  "docs/startup-repair-20260917.md"
]);
export function readStartupRepairSource(sha, git = args => command("/usr/bin/git", args)) {
  if (!SHA.test(sha) || sha === P.previousTargetSha) fail();
  const check = () => { if (git(["rev-parse", "HEAD"]).trim() !== sha || git(["status", "--porcelain", "--untracked-files=all"]) !== "") fail(); };
  check(); git(["merge-base", "--is-ancestor", P.previousTargetSha, sha]);
  const paths = git(["diff", "--name-only", "--no-renames", "--no-ext-diff", "--no-textconv", P.previousTargetSha, sha, "--"]).trim().split("\n");
  if (paths.length !== STARTUP_REPAIR_PATHS.length || new Set(paths).size !== paths.length || paths.some(p => !STARTUP_REPAIR_PATHS.includes(p))) fail();
  const changes = paths.sort().map(file => {
    const old = Object.hasOwn(REVIEWED_CORE, file)
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
export function validateStartupRepairAuthority(value, sha, runId, now = Date.now()) {
  if (!exact(value, ["version", "kind", "targetSha", "runId", "runAttempt", "operationId", "failedRunId", "mainCIrunId", "historyDigest", "checkedAt"]) ||
      value.version !== 1 || value.kind !== "faolla-startup-repair" || !SHA.test(sha) || value.targetSha !== sha || !ID.test(runId) ||
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
export function restoreStoppedCurrent(state) {
  // Called only after BOTH frozen generations, held ingress and quiet DB have
  // been verified twice under the deployment + original operation locks.
  if(state.runtime.disk.runtime!==P.stableRelease||state.candidate.disk.runtime!==P.release)fail();
  const current=P.appDir+".current",temp=current+".startup-35165126333";
  const identity=s=>["dev","ino","mode","uid","nlink","mtimeNs","ctimeNs"].map(k=>String(s[k])).join(":");
  const before=lstatSync(current,{bigint:true}),stable=lstatSync(P.stableRelease,{bigint:true});
  if(!before.isSymbolicLink()||before.uid!==0n||before.nlink!==1n||readlinkSync(current)!==P.release||realpathSync(current)!==P.release||
    !stable.isDirectory()||stable.isSymbolicLink()||stable.uid!==0n||(stable.mode&0o022n)!==0n||realpathSync(P.stableRelease)!==P.stableRelease)fail();
  symlinkSync(P.stableRelease,temp);
  if(identity(lstatSync(current,{bigint:true}))!==identity(before)||readlinkSync(current)!==P.release)fail();
  renameSync(temp,current);
  const parent=openSync(dirname(current),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{fsyncSync(parent);}finally{closeSync(parent);}
  if(readlinkSync(current)!==P.stableRelease||realpathSync(current)!==P.stableRelease)fail();
}
function ledger(state) {
  const db = state.database;
  const observed = JSON.parse(command("docker", ["--host", "unix:///var/run/docker.sock", "inspect", "--format", '{"id":{{json .Id}},"image":{{json .Config.Image}},"running":{{json .State.Running}}}', "supabase-db"]));
  if (observed.id !== db.id || observed.image !== db.image || observed.running !== true) fail();
  const rows = JSON.parse(command("docker", ["--host", "unix:///var/run/docker.sock", "exec", "-i", db.id, "sh", "-c", MAINTENANCE_PSQL_CONTAINER_SCRIPT], MAINTENANCE_RECOVERY_MIGRATION_SQL));
  const catalog = command("/usr/bin/git", ["ls-tree", "--name-only", P.previousTargetSha + ":scripts/supabase-migrations"]).trim().split("\n").filter(n => /^\d{12}_.*\.sql$/.test(n)).sort();
  return validateTransportRepairLedger(rows, db.databaseOid, catalog, P.createdAt);
}
export async function runStartupRepair(action, sha, runId, authority, ops, sourceDigest, request) {
  if (!["inspect", "repair"].includes(action)) fail();
  validateStartupRepairAuthority(authority, sha, runId, ops.now());
  const snapshot = await ops.readRecoverySnapshot();
  const state = validateStartupRepairPredecessor(snapshot.state, { bootId: ops.bootId(), now: ops.now() });
  if (snapshot.digest !== P.stateDigest || snapshot.revision !== P.revision) fail();
  ops.validateProofs(state);
  const verify = async () => { await ops.verifyIngress(state.ingress); await ops.assertRuntimeStopped(state.runtime); await ops.assertRetiredCandidateStopped(state.runtime, state.candidate); await ops.assertDatabaseQuiet(state.database); };
  await verify();
  const migrationDigest = await ops.readStartupLedger(state);
  if (migrationDigest !== "2190b7868b879233c8d4852810d7d2ee186271005104c78bc229484b60d58388") fail();
  await verify();
  if (await ops.readStartupLedger(state) !== migrationDigest) fail();
  validateStartupRepairAuthority(authority, sha, runId, ops.now());
  const repairedAt = ops.now();
  const next = buildStartupRepairedState(state, { version: 1, predecessor: state, targetSha: sha, repairedAt, runId,
    mainCIrunId: authority.mainCIrunId, sourceDigest, historyDigest: authority.historyDigest, historyCheckedAt: authority.checkedAt, migrationDigest },
    { bootId: ops.bootId(), now: repairedAt });
  validateMaintenanceState(next, request, ops.bootId(), ops.now()); validateMaintenanceSubproofBindings(next); ops.validateProofs(next);
  assertMaintenanceRecoveryProgress(state, next);
  if (JSON.stringify(state) !== JSON.stringify(next.startupRepair.predecessor)) fail();
  // Exercise the real pinned predecessor through validation and later write
  // guards before any persistence. No fixture can substitute the host digest.
  const later = structuredClone(next); later.revision++;
  assertMaintenanceRecoveryProgress(next, later);
  for (const key of ["runtime", "database", "recovery", "daemonRepair", "tokenHash", "createdAt", "operationId", "targetSha", "startupRepair"]) {
    const bad = structuredClone(later); bad[key] = null;
    let rejected = false; try { assertMaintenanceRecoveryProgress(next, bad); } catch { rejected = true; }
    if (!rejected) fail();
  }
  if (action === "inspect") return { state: "startup-inspected", operationId: P.operationId, priorLaunchPreserved: true };
  await ops.archiveStartupPredecessor(state, authority);
  await ops.restoreStoppedCurrent(state);
  await verify();
  const saved = await ops.commitStartupRepair(snapshot, next);
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
    const authority = validateStartupRepairAuthority(JSON.parse(readFileSync(file)), sha, runId);
    stage = "source";
    const sourceDigest = readStartupRepairSource(sha);
    const request = { action: "repair-startup", appDir: P.appDir, appName: P.appName, appPort: P.appPort,
      targetSha: sha, previousTargetSha: P.previousTargetSha, expectedOldSha: P.expectedOldSha, operationId: P.operationId };
    stage = "operations";
    const ops = await productionOperations(request);
    ops.restoreStoppedCurrent = restoreStoppedCurrent;
    ops.readStartupLedger = ledger;
    ops.archiveStartupPredecessor = (state, auth) => {
      const directory = "/var/lib/faolla-maintenance/merchant-space";
      createPrivate(directory + "/startup-35165126333.predecessor.json", JSON.stringify(state));
      createPrivate(directory + "/startup-35165126333.authority.json", JSON.stringify(auth));
    };
    stage = "held-verification-and-cas";
    const result = await withPrivateOperationLock(request, () => runStartupRepair(action, sha, runId, authority, ops, sourceDigest, request));
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch { process.stderr.write("startup_repair_unverified:" + stage + "\n"); process.exitCode = 1; }
}
