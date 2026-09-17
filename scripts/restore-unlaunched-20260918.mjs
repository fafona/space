// Bounded, independently journaled completion of an unlaunched release.
// Preserve the failed predecessor byte-for-byte. Never replay historical slots.
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual as equal } from "node:util";
import { inspectUnlaunchedArtifacts } from "./restore-unlaunched-20260918-artifacts.mjs";
const inspectArtifacts = proof => inspectUnlaunchedArtifacts(P, proof);
import { extractRecoveryShellFunction } from "./recover-maintenance-candidate.mjs";

export const RESTORATION_TARGET = Object.freeze({
  targetSha: "1aab7b9beb10d0f86f5354b873d8a56c85cae576",
  expectedOldSha: "0d17d3830bc4cc69a53147d04488f5f18f79ddb7",
  operationId: "d2bab5d6-744b-4a63-b49c-48becafb087b",
  bootId: "e6531ec9-db4a-4216-b87a-7cc858197eaa",
  release: "/www/wwwroot/merchant-space.releases/1aab7b9beb10-20260917225453",
  oldRelease: "/www/wwwroot/merchant-space.releases/0d17d3830bc4-20260917082356",
  appDir: "/www/wwwroot/merchant-space", appName: "merchant-space", appPort: 3000,
  backupRunId: "35271745728", readinessRunId: "35284198746", deployRunId: "35284285532",
  expiresAt: Date.parse("2026-09-18T08:34:48.378Z"),
});
const P = RESTORATION_TARGET;
export const RESTORATION = Object.freeze({
  operationId: "25967b48-8705-4812-913f-0fcfaab2e6ae",
  predecessorDigest: "00294057e4fae0f701600868d762cffb4c00b6996da826b0e57318eb782266c3",
  failedRunId: "35284285532", predecessorRevision: 4,
  directory: "/var/lib/faolla-restoration-35284285532",
  archive: "/var/lib/faolla-maintenance/merchant-space.archived-35284285532",
});
const R = RESTORATION, ROOT = "/var/lib/faolla-maintenance/merchant-space";
const hash = b => createHash("sha256").update(b).digest("hex");
const fail = code => { throw new Error("restoration_" + code); };
const load = name => import(new URL("./" + name + ".mjs", import.meta.url));
let expectedCurrent;
const pointer = () => expectedCurrent ?? P.oldRelease;
const command = (file, args, options = {}) => {
  const r = spawnSync(file, args, { encoding: "utf8", timeout: 180000, maxBuffer: 4194304,
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" }, ...options });
  if (r.error || r.signal || r.status !== 0) fail("command_failed"); return r.stdout;
};
function privateFile(file, maximum = 4194304) {
  const s = lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.uid !== 0 || s.nlink !== 1 || (s.mode & 0o077) || s.size < 1 || s.size > maximum) fail("private_file");
  return readFileSync(file);
}
function syncDirectory(path) { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
function createPrivate(file, bytes) { const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); } syncDirectory(dirname(file)); }
function privateDirectory(path) { const s = lstatSync(path); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o077) || realpathSync(path) !== path) fail("private_directory"); }
function predecessor() {
  if (process.platform !== "linux" || process.getuid?.() !== 0) fail("host");
  privateDirectory(ROOT);
  const bytes = privateFile(ROOT + "/state.json"), state = JSON.parse(bytes);
  if (hash(bytes) !== R.predecessorDigest || state.revision !== R.predecessorRevision || state.phase !== "failed-unknown" ||
    state.operationId !== P.operationId || state.targetSha !== P.targetSha || state.bootId !== P.bootId ||
    readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() !== P.bootId ||
    readlinkSync(P.appDir + ".current") !== pointer() || Date.now() >= P.expiresAt - 1200000 ||
    state.expectedOldSha !== P.expectedOldSha || ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"].some(k => state[k] !== null)) fail("predecessor_changed");
  return { bytes, state };
}
export function validateRestorationReceipt(v, sha, runId, now = Date.now()) {
  const keys = ["version", "kind", "operationId", "predecessorDigest", "failedRunId", "targetSha", "recoverySha", "runId", "checkedAt", "validUntil", "candidateDigest"];
  if (!v || Object.keys(v).sort().join() !== keys.sort().join() || v.version !== 1 || v.kind !== "faolla-unlaunched-candidate-restoration" ||
    !/^[a-f0-9]{64}$/.test(v.candidateDigest) || v.operationId !== R.operationId || v.predecessorDigest !== R.predecessorDigest || v.failedRunId !== R.failedRunId || v.targetSha !== P.targetSha ||
    !/^[a-f0-9]{40}$/.test(sha) || !/^[1-9][0-9]{0,15}$/.test(runId) || v.recoverySha !== sha || v.runId !== runId ||
    !Number.isSafeInteger(v.checkedAt) || !Number.isSafeInteger(now) || v.checkedAt > now || now >= v.validUntil ||
    v.validUntil !== Math.min(v.checkedAt + 1800000, P.expiresAt)) fail("receipt");
  return v;
}
async function database(state, quiet = true) {
  const control = await load("production-maintenance-control"), caps = await load("check-production-maintenance-capabilities"), sched = await load("maintenance-supabase-scheduler-profile");
  const query = (db, sql) => {
    const actual = JSON.parse(command("docker", ["--host", "unix:///var/run/docker.sock", "inspect", "--format", '{"id":{{json .Id}},"image":{{json .Config.Image}},"running":{{json .State.Running}}}', "supabase-db"]));
    if (actual.id !== state.database.id || actual.image !== state.database.image || actual.running !== true) fail("database_identity");
    const args = db === "postgres" ? [caps.MAINTENANCE_PSQL_CONTAINER_SCRIPT] : [sched.SUPABASE_SCHEDULER_PSQL_SCRIPT, "faolla-maintenance-readonly", db];
    if (db !== "postgres" && (db !== "_supabase" || state.database.image !== sched.SUPABASE_SCHEDULER_IMAGE)) fail("database_profile");
    return JSON.parse(command("docker", ["--host", "unix:///var/run/docker.sock", "exec", "-i", state.database.id, "sh", "-c", ...args], { input: sql, timeout: 12000 }));
  };
  if (quiet) {
    const row = control.queryMaintenanceDatabaseQuiet(state.database, query);
    if (!equal(row, { complete: true, schedulerSafe: true, transactions: 0, prepared: 0, databaseOid: state.database.databaseOid })) fail("database_not_quiet");
  }
  if (!equal(query("postgres", control.PRODUCTION_MAINTENANCE_ACL_SQL), { migration: true, clientsDenied: true, serviceWrites: true })) fail("acl");
  const originalBytes = privateFile(new URL("./production-readiness-attestation.json", import.meta.url), 16384);
  if (hash(originalBytes) !== "2ab6a6bf68cc2232a9e90671a79f6da8e97dba665d03a80d42728b530f20453c") fail("baseline");
  const original = JSON.parse(originalBytes), api = await load("check-ordinary-account-cutover-readiness");
  const report = await api.checkOrdinaryAccountCutoverReadiness({ containerName: original.database.containerName,
    env: { FAOLLA_EXPECTED_DATABASE_NAME: original.database.dbName, FAOLLA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER: original.database.systemId,
      FAOLLA_EXPECTED_MERCHANT_RECORD_COUNT: original.baseline.merchantRecordCount, FAOLLA_EXPECTED_PERSONAL_CANONICAL_COUNT: original.baseline.personalCanonicalBindingCount,
      FAOLLA_EXPECTED_ORDINARY_IDENTITY_CONTENT_SHA256: original.baseline.ordinaryIdentityContentSha256 } });
  if (report.status !== "ready" || report.mode !== "read_only" || ["dbName", "dbOid", "systemId", "primary"].some(k => report.databaseIdentity[k] !== original.database[k]) ||
    Object.entries(original.baseline).some(([k, v]) => String(report.readiness[k]) !== v)) fail("readiness");
}
async function dependencies(state) {
  const runtime = await load("production-maintenance-runtime"), ingress = await load("production-maintenance-ingress");
  const env = await runtime.readRuntimeHandoffEnvironment(state.runtime);
  return { runtime, ingress, probe: { probeHeaders: { apikey: env.anonKey, authorization: `Bearer ${env.anonKey}` } } };
}
async function inspect(sha, runId) {
  const before = predecessor(), s = before.state, d = await dependencies(s), control = await load("production-maintenance-control");
  control.validateMaintenanceState(s, s, P.bootId, Date.now()); control.validateMaintenanceSubproofBindings(s); control.validateMaintenanceLaunchProofBindings(s);
  if (command("git", ["-C", P.appDir, "rev-parse", "HEAD"]).trim() !== P.targetSha) fail("source");
  command("git", ["-C", P.appDir, "diff", "--quiet", "HEAD", "--"]);
  await d.ingress.verifyIngress(s.ingress, d.probe);
  await d.runtime.assertRuntimeStopped(s.runtime);
  await database(s);
  if (!predecessor().bytes.equals(before.bytes)) fail("predecessor_changed");
  const artifacts = await inspectArtifacts(s.runtime);
  const checkedAt = Date.now();
  const receipt = validateRestorationReceipt({ version: 1, kind: "faolla-unlaunched-candidate-restoration", operationId: R.operationId,
    predecessorDigest: R.predecessorDigest, failedRunId: R.failedRunId, targetSha: P.targetSha, recoverySha: sha, runId,
    checkedAt, validUntil: Math.min(checkedAt + 1800000, P.expiresAt), candidateDigest: artifacts.digest }, sha, runId, checkedAt);
  return { receipt, before, d, artifacts };
}
export async function restorationSequence(ops) {
  const stage = async name => { ops.report?.(name, "started"); await ops[name](); ops.report?.(name, "passed"); };
  try {
    for (const name of ["startPaused", "verifyPaused", "checkApplication", "checkDatabase", "resume", "verifyResumed", "persistDump", "verifyDump",
      "verifyHistory", "restoreIngress", "verifyPublic", "verifyResumed", "verifyDump", "verifyHistory", "finish"]) await stage(name);
  } catch (error) { await ops.failClosed(); throw error; }
}
export function validateRestorationEnd(value, runId) {
  const expected = { version: 1, state: "ended", operationId: R.operationId, targetSha: P.targetSha, predecessorDigest: R.predecessorDigest, runId };
  if (!/^[1-9][0-9]{0,15}$/.test(runId) || !equal(value, expected)) fail("end_receipt");
  return value;
}
async function restore(sha, runId, file) {
  const signed = validateRestorationReceipt(JSON.parse(privateFile(file, 4096)), sha, runId);
  // One fixed directory can only ever be created once. Neither reruns nor a
  // missing subprocess result authorize recreating/reusing its launch slots.
  const lock = ROOT + "/operation.lock"; mkdirSync(lock, { mode: 0o700 }); const identity = lstatSync(lock);
  let archived = false;
  try {
    const { before, d, artifacts } = await inspect(sha, runId), old = before.state;
    if (signed.candidateDigest !== artifacts.digest) fail("candidate_changed");
    validateRestorationReceipt(signed, sha, runId);
    mkdirSync(R.directory, { mode: 0o700 }); privateDirectory(R.directory);
    createPrivate(R.directory + "/predecessor.json", before.bytes);
    const journalApi = await load("production-maintenance-launch-journal"), control = await load("production-maintenance-control");
    const record = { version: 1, revision: 0, operationId: R.operationId, predecessorDigest: R.predecessorDigest, recoverySha: sha, runId,
      phase: "held", targetSha: P.targetSha, appName: P.appName, appPort: P.appPort, bootId: P.bootId, runtime: old.runtime,
      launchDisk: artifacts.disk, launchJournal: null, candidate: null, resumed: null, finalDump: null, ingress: old.ingress };
    const binding = control.maintenanceLaunchBinding(record);
    record.launchJournal = journalApi.createMaintenanceLaunchJournal(binding);
    const path = R.directory + "/state.json"; let previous;
    const save = async () => {
      if (!predecessor().bytes.equals(before.bytes)) fail("predecessor_changed");
      journalApi.validateMaintenanceLaunchJournal(record.launchJournal, binding);
      if (previous && !privateFile(path).equals(previous)) fail("journal_conflict");
      record.revision += 1;
      const bytes = Buffer.from(JSON.stringify(record));
      if (!previous) createPrivate(path, bytes);
      else { const tmp = path + "." + record.revision + ".tmp"; createPrivate(tmp, bytes); if (!privateFile(path).equals(previous)) fail("journal_conflict"); renameSync(tmp, path); syncDirectory(R.directory); }
      if (!privateFile(path).equals(bytes)) fail("journal_write"); previous = bytes;
    };
    await save();
    let queue = Promise.resolve(), poisoned = false;
    const serial = fn => { const p = queue.then(async () => { if (poisoned) fail("journal_poisoned"); try { return await fn(); } catch (e) { poisoned = true; throw e; } }); queue = p.catch(() => {}); return p; };
    const roles = ["paused-web", "resumed-web", "worker"];
    const journal = {
      read: role => serial(() => { if (!roles.includes(role)) fail("role"); return structuredClone(record.launchJournal.slots[role]); }),
      attempt: (role, disk, environmentDigest) => serial(async () => {
        d.runtime.validateLaunchDisk(disk, old.runtime, P.targetSha);
        if (!equal(disk, record.launchDisk) || !roles.includes(role) || (role === "paused-web" ? record.phase !== "held" : record.phase !== "resuming")) fail("launch");
        const sequence = roles.indexOf(role) + 1, nonce = randomUUID();
        record.launchJournal = journalApi.planMaintenanceLaunch(record.launchJournal, binding, { role, sequence, nonce, environmentDigest }); await save();
        record.launchJournal = journalApi.transitionMaintenanceLaunch(record.launchJournal, binding, { role, sequence, nonce, phase: "attempted" }); await save(); return nonce;
      }),
      confirm: (role, observation) => serial(async () => {
        const slot = record.launchJournal.slots[role]; if (!slot) fail("slot");
        record.launchJournal = journalApi.transitionMaintenanceLaunch(record.launchJournal, binding, { role, sequence: slot.sequence, nonce: slot.nonce, phase: "confirmed", observation: { ...binding, role, sequence: slot.sequence, ...observation } }); await save();
      }),
      unknown: role => serial(async () => {
        const slot = record.launchJournal.slots[role]; if (!slot) fail("slot");
        if (["unknown", "confirmed"].includes(slot.phase)) return;
        record.launchJournal = journalApi.transitionMaintenanceLaunch(record.launchJournal, binding, { role, sequence: slot.sequence, nonce: slot.nonce, phase: "unknown" }); await save();
      }),
      checkpoint: value => serial(async () => {
        d.runtime.validateCandidateProof(value.candidate, old.runtime);
        if (value.resumed) d.runtime.validateResumedCandidateProof(value.resumed, old.runtime);
        if (value.candidate.targetSha !== P.targetSha || value.candidate.pauseExpected !== "0") fail("checkpoint");
        record.candidate = value.candidate; record.resumed = value.resumed; await save();
      }),
    };
    const application = async () => {
      const source = readFileSync(P.appDir + "/scripts/deploy.production.sh", "utf8"), repaired = readFileSync(new URL("./deploy.production.sh", import.meta.url), "utf8");
      const environment = await load("read-production-supabase-environment");
      const snapshot = environment.readFrozenProductionSupabaseRollbackEnvironmentSnapshot(P.release + "/.env.local", P.targetSha);
      const booking = extractRecoveryShellFunction(source, "verify_booking_persistence").split("<<'NODE'\n")[1]?.split("\nNODE\n")[0];
      if (!booking) fail("booking_source");
      command("/usr/bin/node", ["--input-type=module", "-", P.release, snapshot.directoryIdentity, snapshot.fileIdentity, snapshot.sha256, "30", "5"], {
        input: booking, timeout: 35000, env: { BOOKING_PERSISTENCE_CHECK_ATTEMPTS: "1", BOOKING_PERSISTENCE_CHECK_DELAY_MS: "1", BOOKING_PERSISTENCE_QUERY_TIMEOUT_MS: "10000" },
      });
      for (const [name, text] of [["run_local_release_smoke", source], ["verify_nginx_release_static_access", repaired]]) {
        command("/bin/bash", ["-s"], { input: `set -euo pipefail\nAPP_DIR=${P.appDir}\nCURRENT_LINK=${P.appDir}.current\nRELEASE_DIR=${P.release}\nAPP_PORT=3000\nFAOLLA_WEB_BUILD_ID=${P.targetSha}\nCANDIDATE_FAOLLA_CANONICAL_PORTAL_ORIGIN=https://launch.faolla.com\nRELEASE_SMOKE_ORIGIN=http://127.0.0.1:3000\nRELEASE_SMOKE_PATHS=/,/login,/10000000,/admin,/enterprise\nRELEASE_SMOKE_ATTEMPTS=3\nRELEASE_SMOKE_DELAY_MS=1000\nRELEASE_SMOKE_TIMEOUT_MS=12000\nRELEASE_SMOKE_TOTAL_TIMEOUT_SECONDS=180\nNGINX_RUNTIME_USER=www\nNGINX_RELEASE_GATE_TOTAL_TIMEOUT_SECONDS=120\n${extractRecoveryShellFunction(text, name)}\n${name}\n`, timeout: 200000 });
      }
    };
    await restorationSequence({
      report: (stage, result) => process.stderr.write(`[restoration] stage=${stage} result=${result}\n`),
      startPaused: async () => {
        if (!predecessor().bytes.equals(before.bytes) || (await inspectArtifacts(old.runtime)).digest !== signed.candidateDigest) fail("candidate_changed");
        const link = P.appDir + ".current", temporary = link + ".restoration-" + R.operationId;
        symlinkSync(P.release, temporary);
        if (!predecessor().bytes.equals(before.bytes)) fail("predecessor_changed");
        renameSync(temporary, link); syncDirectory(dirname(link)); expectedCurrent = P.release;
        const supervision = await load("check-production-runtime-supervision");
        const captured = supervision.captureRuntimeProof(P.appDir, P.targetSha);
        if (!equal(Object.fromEntries(Object.keys(record.launchDisk).map(k => [k, captured[k]])), record.launchDisk)) fail("candidate_changed");
        record.candidate = await d.runtime.startCandidate(old.runtime, P.targetSha, { launchJournal: journal }); record.phase = "candidate"; await save(); },
      verifyPaused: () => d.runtime.verifyCandidate(old.runtime, record.candidate, "1"), checkApplication: application, checkDatabase: () => database(old),
      resume: async () => { record.phase = "resuming"; await save(); record.resumed = await d.runtime.resumeCandidate(old.runtime, record.candidate, P.targetSha, { launchJournal: journal }); await save(); },
      verifyResumed: () => d.runtime.verifyResumedCandidate(old.runtime, record.resumed),
      persistDump: async () => { record.finalDump = await d.runtime.persistResumedDump(old.runtime, record.resumed); await save(); },
      verifyDump: () => d.runtime.verifyResumedDump(old.runtime, record.resumed, record.finalDump),
      verifyHistory: () => d.runtime.verifyResumedCandidate(old.runtime, record.resumed),
      restoreIngress: () => d.ingress.restoreIngress(record.ingress, d.probe),
      verifyPublic: async () => { const smoke = await load("check-production-smoke"); const r = await smoke.runProductionSmoke({ origin: "https://faolla.com", paths: ["/", "/login", "/10000000", "/admin", "/enterprise"], expectedBuildId: P.targetSha, attempts: 5, delayMs: 2000, timeoutMs: 12000, logger: { log: () => {}, warn: () => {} } }); if (!r.ok || r.buildId !== P.targetSha) fail("public_smoke"); },
      finish: async () => { record.phase = "ended"; await save(); },
      failClosed: async () => {
        const token = privateFile(ROOT + "/control.token", 64).toString();
        record.ingress = await d.ingress.installIngress(record.ingress, token, { ...d.probe, probeControlServices: false }); await save();
        if (Object.values(record.launchJournal.slots).some(slot => slot && ["attempted", "unknown"].includes(slot.phase))) {
          const reconciled = await d.runtime.reconcileMaintenanceLaunches(old.runtime, record.launchDisk, P.targetSha, { launchJournal: journal });
          record.candidate = reconciled.candidate; record.resumed = reconciled.resumed; await save();
        }
        if (record.resumed) await d.runtime.stopResumedCandidate(old.runtime, record.resumed);
        else if (record.candidate) await d.runtime.stopCandidate(old.runtime, record.candidate);
        await d.ingress.verifyIngress(record.ingress, { ...d.probe, probeControlServices: false });
        await d.runtime.assertRuntimeStopped(old.runtime); await database(old); record.phase = "failed-held"; await save();
      },
    });
    // Move only the exact, unchanged incident directory, after all public and
    // saved-runtime checks. The failed history is retained byte-for-byte.
    if (!predecessor().bytes.equals(before.bytes) || realpathSync(ROOT) !== ROOT || dirname(R.archive) !== "/var/lib/faolla-maintenance") fail("archive_binding");
    try { lstatSync(R.archive); fail("archive_exists"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    renameSync(ROOT, R.archive); archived = true; syncDirectory(dirname(ROOT));
    return { version: 1, state: "ended", operationId: R.operationId, targetSha: P.targetSha, predecessorDigest: R.predecessorDigest, runId };
  } finally {
    const actual = (archived ? R.archive : ROOT) + "/operation.lock", current = lstatSync(actual);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) fail("lock_changed");
    rmdirSync(actual);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [action, sha, runId, file, confirmation] = process.argv.slice(2);
    if (action === "inspect") process.stdout.write(JSON.stringify((await inspect(sha, runId)).receipt) + "\n");
    else if (action === "validate") validateRestorationReceipt(JSON.parse(readFileSync(file)), sha, runId);
    else if (action === "validate-ended") validateRestorationEnd(JSON.parse(readFileSync(file)), runId);
    else if (action === "restore" && confirmation === "RESTORE_VERIFIED_UNLAUNCHED_20260918" && resolve(file) === resolve(dirname(process.argv[1]), "restoration-receipt.json")) process.stdout.write(JSON.stringify(await restore(sha, runId, file)) + "\n");
    else fail("arguments");
  } catch (e) { process.stderr.write(/^restoration_[a-z_]+$/.test(e?.message ?? "") ? e.message + "\n" : "restoration_unverified\n"); process.exitCode = 1; }
}
