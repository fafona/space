import assert from "node:assert/strict";
import crypto from "node:crypto";
import { constants } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { createMaintenanceRecoveryInspection, buildMaintenanceRecoveredState } from "./production-maintenance-recovery.mjs";
import { createMaintenanceContinuationInspection, buildMaintenanceContinuedState } from "./production-maintenance-continuation.mjs";
import { MAINTENANCE_BUILD_RECOVERY_INCIDENT as BUILD, MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION as OLD_EXTENSION,
  MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION_DIGEST as OLD_EXTENSION_DIGEST,
  MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP_SPEC_DIGEST, validateMaintenanceBuildRecoveryState } from "./production-maintenance-build-recovery.mjs";
import { MAINTENANCE_ATTEMPT_RECOVERY_INCIDENT as INCIDENT, createMaintenanceAttemptRecoveryInspection, buildMaintenanceAttemptRecoveredState } from "./production-maintenance-attempt-recovery.mjs";
import { MAINTENANCE_SECOND_ATTEMPT_RECOVERY_INCIDENT as SECOND, createMaintenanceSecondAttemptRecoveryInspection, buildMaintenanceSecondAttemptRecoveredState,
  validateMaintenanceSecondAttemptRecoveryState } from "./production-maintenance-second-attempt-recovery.mjs";
import { MAINTENANCE_BUDGET_RECOVERY_INCIDENT as BUDGET, MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION as AUTH,
  createMaintenanceBudgetRecoveryInspection, buildMaintenanceBudgetRecoveredState,
  encodeMaintenanceBudgetRecoveryEvidence } from "./production-maintenance-budget-recovery.mjs";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "./production-maintenance-launch-journal.mjs";
import { createMaintenanceLaunchJournalStorage } from "./production-maintenance-launch-journal-storage.mjs";
import { parseMaintenanceRequest, runMaintenanceAction, validateMaintenanceState, validateMaintenanceSubproofBindings,
  validateMaintenanceLaunchProofBindings, maintenanceLaunchBinding } from "./production-maintenance-control.mjs";
import { validateRuntimeProof, validateCandidateProof, validateLaunchDisk, validateResumedCandidateProof,
  validateResumedDumpProof } from "./production-maintenance-runtime.mjs";
import { pm2RegistryDigest } from "./production-maintenance-pm2-adapter.mjs";

// Controller + real single-state storage + pure recovery/journal validators.
// Host probes/process sends, source/GitHub evidence and the filesystem are
// isolated fixtures. This does not attest a production host or signed evidence.
const originalCreateHash = crypto.createHash;
const hash = value => originalCreateHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => structuredClone(value);
const NOW = Date.parse("2026-09-14T08:00:00.000Z"), TARGET = "a".repeat(40), ID = "1:2:3:4:5:1:0:33188";
const clock = (now = NOW) => ({ bootId: INCIDENT.bootId, now });
const RUN_KEYS = ["backupRunId", "backupRunAttempt", "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt", "failedDeployRunId", "failedDeployRunAttempt"];
function makeDisk(sha) {
  const runtime = "/srv/faolla.releases/" + sha.slice(0, 12) + "-20260913200000";
  return { runtime, runtimeIdentity: ID, environmentIdentity: ID, environmentDigest: "a".repeat(64),
    nextBuildIdentity: ID, nextBuildDigest: "c".repeat(64), nextEntryPath: runtime + "/node_modules/next/dist/bin/next", nextEntryIdentity: ID };
}
const makeEnvironment = disk => ({ directoryIdentity: "1:2:3:4:1:0:16877", fileIdentity: disk.environmentIdentity,
  sha256: disk.environmentDigest, configurationHash: "b".repeat(64) });
function originalRuntime() {
  const disk = makeDisk(INCIDENT.expectedOldSha);
  const managed = (pid, name) => ({ pm2: { pmId: pid, pid, name, status: "online", createdAt: 1, pmUptime: 1, restartTime: 0, metadataHash: "e".repeat(64) },
    processes: [{ ...copy(daemon), pid, parentPid: daemon.pid, startTicks: String(pid + 100), cwd: disk.runtime, cwdIdentity: disk.runtimeIdentity }] });
  return { version: 1, input: { appDir: "/srv/faolla", appName: "faolla", appPort: 3000, expectedOldSha: INCIDENT.expectedOldSha }, bootId: INCIDENT.bootId,
    disk, environment: makeEnvironment(disk), daemon: copy(daemon), web: managed(101, "faolla"),
    worker: { state: "running", managed: managed(102, "faolla-enterprise-automation-worker") } };
}
const daemon = { pid: 100, parentPid: 1, uid: 0, startTicks: "50", processIdentity: ID, cwd: "/", cwdIdentity: ID,
  executable: "/usr/bin/node", executableIdentity: ID, commandLineDigest: "b".repeat(64) };
function launch(state, nonce = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee") {
  const disk = makeDisk(state.targetSha);
  const binding = { operationId: state.operationId, targetSha: state.targetSha, appName: state.appName, appPort: state.appPort,
    daemon: { pid: daemon.pid, uid: 0, startTicks: daemon.startTicks, bootId: state.bootId, executable: daemon.executable, executableIdentity: ID },
    release: { path: disk.runtime, identity: ID, buildDigest: disk.nextBuildDigest } };
  const instance = { pmId: 9, pid: 110, parentPid: daemon.pid, uid: 0, startTicks: "60", processIdentity: ID,
    cwd: disk.runtime, cwdIdentity: ID, executable: daemon.executable, executableIdentity: ID, commandLineDigest: "d".repeat(64),
    createdAt: 1, pmUptime: 1, restartTime: 0, metadataDigest: "e".repeat(64) };
  let journal = createMaintenanceLaunchJournal(binding);
  journal = planMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, environmentDigest: "f".repeat(64) });
  journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, phase: "attempted" });
  journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, phase: "confirmed",
    observation: { ...binding, role: "paused-web", sequence: 1, observedNonce: nonce, environmentDigest: "f".repeat(64), instance } });
  const processKeys = ["pid", "parentPid", "uid", "startTicks", "processIdentity", "cwd", "cwdIdentity", "executable", "executableIdentity", "commandLineDigest"];
  const web = { processes: [Object.fromEntries(processKeys.map(key => [key, instance[key]]))],
    pm2: { pmId: instance.pmId, pid: instance.pid, name: state.appName, status: "online", createdAt: 1, pmUptime: 1, restartTime: 0, metadataHash: instance.metadataDigest } };
  return { launchDisk: disk, launchJournal: journal,
    candidate: { version: 1, targetSha: state.targetSha, pauseExpected: "1", disk, environment: makeEnvironment(disk), daemon: copy(daemon), web } };
}
function syntheticPredecessor() {
  const initial = { version: 2, revision: 3, operationId: INCIDENT.operationId, targetSha: BUILD.originalTargetSha,
    expectedOldSha: INCIDENT.expectedOldSha, appDir: "/srv/faolla", appName: "faolla", appPort: 3000, bootId: INCIDENT.bootId,
    createdAt: INCIDENT.createdAt, phase: "failed-held", runtime: originalRuntime(), ingress: { input: { operationId: INCIDENT.operationId, appPort: 3000, publicSupabaseUrl: "https://example.invalid/" }, docker: { containers: [{ service: "db", id: "1".repeat(64), image: "supabase/postgres:15.8.1.085" }] } }, database: { id: "1".repeat(64), image: "supabase/postgres:15.8.1.085", databaseOid: 5 },
    publicSupabaseUrl: "https://example.invalid/", tokenHash: "1".repeat(64), candidate: null, resumed: null, launchDisk: null, launchJournal: null, finalDump: null };
  const rc = { operationId: initial.operationId, previousTargetSha: initial.targetSha, targetSha: BUILD.recoveredTargetSha,
    expectedOldSha: initial.expectedOldSha, expectedRevision: 3, expectedDigest: hash(initial), bootId: initial.bootId,
    now: initial.createdAt + 3600000, sourceDiffDigest: "2".repeat(64), migrationDigest: "3".repeat(64) };
  const recovered = buildMaintenanceRecoveredState(initial, { ...createMaintenanceRecoveryInspection(initial, rc), toolsSha: rc.targetSha,
    recoveryRunId: "34715768455", recoveryRunAttempt: 1, mainCIrunId: "34715352249", historyDigest: "4".repeat(64), historyCheckedAt: rc.now - 1000 }, rc);
  const cc = { ...rc, previousTargetSha: rc.targetSha, targetSha: BUILD.previousTargetSha, expectedRevision: 4,
    expectedDigest: hash(recovered), now: initial.createdAt + 2 * 3600000 };
  const continued = buildMaintenanceContinuedState(recovered, { ...createMaintenanceContinuationInspection(recovered, cc), toolsSha: cc.targetSha,
    continuationRunId: "34724808528", continuationRunAttempt: 1, mainCIrunId: "34724337523", historyDigest: "5".repeat(64), historyCheckedAt: cc.now - 1000 }, cc);
  const recoveredAt = Date.parse("2026-09-13T19:42:00.000Z");
  const evidence = { version: 1, state: "build-recovery-inspected", operationId: INCIDENT.operationId, targetSha: INCIDENT.previousTargetSha,
    previousTargetSha: BUILD.previousTargetSha, expectedOldSha: INCIDENT.expectedOldSha, revision: 7, stateDigest: BUILD.stateDigest,
    createdAt: INCIDENT.createdAt, sourceDiffDigest: "6".repeat(64), migrationDigest: "7".repeat(64), recoveryDigest: hash(continued.recovery),
    continuationDigest: hash(continued.continuation), deadlineExtensionDigest: OLD_EXTENSION_DIGEST,
    additionalBackupSpecDigest: MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP_SPEC_DIGEST,
    ...Object.fromEntries(RUN_KEYS.map(key => [key, BUILD[key]])), toolsSha: INCIDENT.previousTargetSha,
    buildRecoveryRunId: "34778424264", buildRecoveryRunAttempt: 1, mainCIrunId: "34777790522", historyDigest: "8".repeat(64),
    historyCheckedAt: recoveredAt - 1000, additionalBackupEvidenceDigest: "9".repeat(64) };
  const state = { ...copy(continued), version: 5, revision: 15, targetSha: INCIDENT.previousTargetSha, phase: "failed-held",
    buildRecovery: { version: 1, evidence, recoveredAt }, deadlineExtension: copy(OLD_EXTENSION) };
  Object.assign(state, launch(state));
  validateMaintenanceBuildRecoveryState(state, clock(INCIDENT.historicalObservedAt));
  return state;
}


function syntheticV6(seed) {
  const now = Date.parse("2026-09-13T23:29:37Z"), baseline = { version: 1, stateDigest: INCIDENT.stateDigest,
    candidateDigest: hash(seed.candidate), launchDiskDigest: hash(seed.launchDisk), launchJournalDigest: hash(seed.launchJournal),
    runtimeDigest: hash(seed.runtime), current: { target: seed.launchDisk.runtime, linkIdentity: ID, runtimeIdentity: ID },
    bootId: INCIDENT.bootId, pm2RegistryDigest: "a".repeat(64), observedAt: now - 1000 };
  const context = { operationId: INCIDENT.operationId, previousTargetSha: INCIDENT.previousTargetSha, targetSha: SECOND.previousTargetSha,
    expectedOldSha: INCIDENT.expectedOldSha, expectedRevision: 15, expectedDigest: INCIDENT.stateDigest, bootId: INCIDENT.bootId, now,
    sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline: baseline };
  const evidence = { ...createMaintenanceAttemptRecoveryInspection(seed, context), toolsSha: context.targetSha,
    attemptRecoveryRunId: "34789744074", attemptRecoveryRunAttempt: 1, mainCIrunId: "34789133814",
    historyDigest: "d".repeat(64), historyCheckedAt: now - 1000 };
  const state = copy(buildMaintenanceAttemptRecoveredState(seed, evidence, context));
  state.revision = 23; state.phase = "failed-held";
  Object.assign(state, launch(state, "11111111-2222-4333-8444-555555555555"));
  return state;
}
function baseline(state, version, now, stateDigest) {
  return { version, stateDigest, candidateDigest: hash(state.candidate), launchDiskDigest: hash(state.launchDisk),
    launchJournalDigest: hash(state.launchJournal), runtimeDigest: hash(state.runtime),
    current: { target: state.launchDisk.runtime, linkIdentity: ID, runtimeIdentity: ID }, bootId: state.bootId,
    pm2RegistryDigest: "a".repeat(64), observedAt: now - 1000 };
}
function syntheticV7(seed) {
  const now = Date.parse("2026-09-14T02:48:00Z"), context = { operationId: SECOND.operationId, previousTargetSha: SECOND.previousTargetSha,
    targetSha: BUDGET.previousTargetSha, expectedOldSha: SECOND.expectedOldSha, expectedRevision: 23, expectedDigest: SECOND.stateDigest,
    bootId: SECOND.bootId, now, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64),
    stoppedBaseline: baseline(seed, 2, now, SECOND.stateDigest) };
  const evidence = { ...createMaintenanceSecondAttemptRecoveryInspection(seed, context), toolsSha: context.targetSha,
    secondAttemptRecoveryRunId: "34800461043", secondAttemptRecoveryRunAttempt: 1, mainCIrunId: "34799821827",
    historyDigest: "d".repeat(64), historyCheckedAt: now - 1000 };
  const state = copy(buildMaintenanceSecondAttemptRecoveredState(seed, evidence, context));
  state.phase = "failed-held"; state.revision = 31;
  Object.assign(state, launch(state, "22222222-2222-4333-8444-555555555555"));
  // The ingress transport is synthetic; complete runtime and launch proofs are
  // validated separately below. This is not a live host or performance proof.
  // Padding fixes the exact public byte-length anchor; it is not real state.
  state.ingress.padding = "";
  const remaining = BUDGET.stateBytes - Buffer.byteLength(JSON.stringify(state));
  assert(remaining > 0); state.ingress.padding = "x".repeat(remaining);
  assert.equal(Buffer.byteLength(JSON.stringify(state)), BUDGET.stateBytes);
  validateMaintenanceSecondAttemptRecoveryState(state, clock(now));
  return state;
}

function fixture(seed) {
  const state = copy(seed), baseline = { version: 3, stateDigest: BUDGET.stateDigest, candidateDigest: hash(state.candidate),
    launchDiskDigest: hash(state.launchDisk), launchJournalDigest: hash(state.launchJournal), runtimeDigest: hash(state.runtime),
    current: { target: state.launchDisk.runtime, linkIdentity: ID, runtimeIdentity: ID }, bootId: BUDGET.bootId,
    pm2RegistryDigest: "a".repeat(64), observedAt: NOW - 1000 };
  const context = { operationId: BUDGET.operationId, previousTargetSha: BUDGET.previousTargetSha, targetSha: TARGET,
    expectedOldSha: BUDGET.expectedOldSha, expectedRevision: 31, expectedDigest: BUDGET.stateDigest, bootId: BUDGET.bootId,
    now: NOW, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline: baseline };
  const inspection = createMaintenanceBudgetRecoveryInspection(state, context);
  const evidence = { ...inspection, toolsSha: TARGET, budgetRecoveryRunId: "34790000001", budgetRecoveryRunAttempt: 1,
    mainCIrunId: "34790000000", historyDigest: "d".repeat(64), historyCheckedAt: NOW - 1000 };
  return { state, baseline, context, inspection, evidence };
}
function request(action, f) {
  const args = [action, "--app-dir", "/srv/faolla", "--app-name", "faolla", "--app-port", "3000", "--target-sha", TARGET,
    "--expected-old-sha", BUDGET.expectedOldSha, "--expected-operation-id", BUDGET.operationId, "--json"];
  if (["inspect-budget-recovery", "recover-budget"].includes(action)) args.push("--previous-target-sha", BUDGET.previousTargetSha);
  if (action === "recover-budget") args.push("--budget-recovery-evidence", encodeMaintenanceBudgetRecoveryEvidence(f.evidence));
  return parseMaintenanceRequest(args);
}
function proofs(state) {
  validateRuntimeProof(state.runtime); validateMaintenanceSubproofBindings(state);
  if (state.launchDisk) validateLaunchDisk(state.launchDisk, state.runtime, state.targetSha);
  if (state.candidate) validateCandidateProof(state.candidate, state.runtime);
  if (state.resumed) validateResumedCandidateProof(state.resumed, state.runtime);
  if (state.finalDump) validateResumedDumpProof(state.finalDump, state.runtime, state.resumed);
  validateMaintenanceLaunchProofBindings(state);
  if (state.version === 8) proofs(state.budgetRecovery.predecessor.state);
  if (state.version === 7) proofs(state.secondAttemptRecovery.predecessor.state);
  if (state.version === 6) proofs(state.attemptRecovery.predecessor.state);
}

function syntheticDump(runtime, resumed, journal) {
  const registry = [resumed.candidate.web, resumed.worker].map((managed, index) => {
    const role = index === 0 ? "resumed-web" : "worker", slot = journal.slots[role], pm = managed.pm2;
    return { name: pm.name, pid: pm.pid, pm_id: pm.pmId, pm2_env: { name: pm.name, pm_id: pm.pmId, status: "online",
      created_at: pm.createdAt, pm_uptime: pm.pmUptime, restart_time: 0, pm_cwd: resumed.candidate.disk.runtime,
      pm_exec_path: resumed.candidate.disk.nextEntryPath, args: [], node_args: [], exec_mode: "fork_mode",
      exec_interpreter: runtime.daemon.executable, watch: false, cron_restart: null, autorestart: false,
      FAOLLA_BACKGROUND_JOBS_PAUSED: "0", nonce: slot.nonce, envDigest: slot.environmentDigest } };
  });
  const receipt = { version: 1, pm2Version: "6.0.14", peerVerified: true, saved: true, processCount: registry.length,
    registryHash: pm2RegistryDigest(registry), target: { version: 1, socketPath: "/root/.pm2/rpc.sock",
      daemon: { pid: daemon.pid, uid: daemon.uid, startTicks: daemon.startTicks, bootId: runtime.bootId,
        executable: daemon.executable, executableIdentity: daemon.executableIdentity },
      chain: [["1", "2", "16832", "0", "0"], ["1", "3", "16832", "0", "0"]],
      dump: { identity: ID, sha256: "b".repeat(64) }, backup: null } };
  return validateResumedDumpProof({ version: 1, resumed, registry, receipt }, runtime, resumed);
}

function rehearsal(f, initial = f.state) {
  const ROOT = "/var/lib/faolla-maintenance/faolla", FILE = ROOT + "/state.json", TEMP = ROOT + "/state.launch-journal.tmp";
  const files = new Map(), handles = new Map(), events = [];
  let inode = 0, fd = 10, locked = false, writes = 0, now = NOW, fault = null, nonce = 20, outcome = "success", revived = null;
  const put = (path, type, bytes = "") => files.set(path, { type, bytes: Buffer.from(bytes), dev: 1n, ino: BigInt(++inode), uid: 0n, nlink: 1n,
    mode: type === "directory" ? 0o40700n : 0o100600n, mtimeNs: 1n, ctimeNs: 1n });
  for (const path of ["/", "/var", "/var/lib", "/var/lib/faolla-maintenance", ROOT]) put(path, "directory");
  put(FILE, "file", JSON.stringify(initial));
  const get = path => { assert.ok(files.has(path), "fixture path must exist"); return files.get(path); };
  const stat = value => ({ ...value, size: BigInt(value.bytes.length), isFile: () => value.type === "file", isDirectory: () => value.type === "directory", isSymbolicLink: () => false });
  const effect = (name, fn) => (...args) => { assert.equal(locked, true, "filesystem outside existing operation lock"); events.push(name); return fn(...args); };
  const inject = stage => { if (fault?.write === writes && fault.stage === stage) throw new Error("synthetic I/O uncertainty"); };
  const io = {
    lstatSync: effect("lstat", path => stat(get(path))), realpathSync: effect("realpath", path => path),
    openSync: effect("open", (path, flags) => {
      if (path === TEMP) { assert.ok(flags & constants.O_EXCL); assert.equal(files.has(path), false); writes++; put(path, "file"); }
      const next = ++fd; handles.set(next, { path, entry: get(path), offset: 0 }); return next;
    }),
    fstatSync: effect("fstat", fd => stat(handles.get(fd).entry)),
    readSync: effect("read", (fd, buffer, offset, length) => { const h = handles.get(fd), n = Math.min(length, h.entry.bytes.length - h.offset);
      h.entry.bytes.copy(buffer, offset, h.offset, h.offset + n); h.offset += n; return n; }),
    writeSync: effect("write", (fd, bytes, offset, length) => { const h = handles.get(fd); h.entry.bytes = Buffer.concat([h.entry.bytes, bytes.subarray(offset, offset + length)]); return length; }),
    fsyncSync: effect("fsync", fd => { const kind = handles.get(fd).entry.type; events.push("sync:" + kind); inject(kind === "file" ? "fileSync" : "directorySync"); }),
    closeSync: effect("close", fd => handles.delete(fd)),
    renameSync: effect("rename", (from, to) => { inject("renameBefore"); files.set(to, get(from)); files.delete(from); inject("renameAfter"); }),
  };
  const validateState = state => {
    validateMaintenanceState(state, { ...state, action: state.version === 7 ? "inspect-budget-recovery" : "check-held",
      previousTargetSha: BUDGET.previousTargetSha }, BUDGET.bootId, now);
    proofs(state); return state;
  };
  const storage = createMaintenanceLaunchJournalStorage({ appName: "faolla", captureState: validateState,
    withExistingOperationLock: async callback => { assert.equal(locked, false); locked = true; events.push("lock");
      try { return await callback(); } finally { locked = false; events.push("unlock"); } } }, io);
  const saved = () => JSON.parse(get(FILE).bytes.toString("utf8"));
  const baselines = new WeakMap(), poisoned = new WeakSet();
  const load = async () => { const snapshot = await storage.readOperationUnderExistingOperationLock(), state = copy(snapshot.state); baselines.set(state, snapshot); return state; };
  const save = async state => {
    assert.ok(baselines.has(state)); if (poisoned.has(state)) throw new Error("fixture state poisoned");
    const before = baselines.get(state);
    try { const next = await storage.replaceOperationUnderExistingOperationLock({ expectedRevision: before.revision, expectedDigest: before.digest,
      next: { ...state, revision: before.revision + 1 } }); state.revision = next.revision; baselines.set(state, next); }
    catch (error) { poisoned.add(state); throw error; }
  };
  const record = (name, value = true) => async () => { events.push(name); return value; };
  const ops = {
    load, save, now: () => now, bootId: () => BUDGET.bootId, readToken: () => "synthetic-control-token",
    uuid: () => `12345678-1234-4234-8234-${String(nonce++).padStart(12, "0")}`,
    validateProofs(state) { proofs(state); events.push("proofs"); }, validateLaunchDisk,
    verifyIngress: record("ingress"), assertRuntimeStopped: record("originalStopped"), async assertBudgetRecoveryStopped(state) {
      assert.deepEqual(state, f.state); proofs(state); events.push("bothStopped");
      for (const name of ["O", "T5", "T6", "T7"]) { events.push("stopped:" + name); if (revived === name) throw new Error("synthetic " + name + " revival"); }
    },
    async assertBudgetRecoveryGenerationsStopped(state) {
      assert.deepEqual(state, f.state); proofs(state); events.push("historicalGenerationStopped");
      for (const name of ["O", "T5", "T6", "T7"]) { events.push("generation:" + name); if (revived === name) throw new Error("synthetic " + name + " revival"); }
    },
    assertDatabaseQuiet: record("databaseQuiet"),
    async readBudgetRecoverySnapshot() { const state = await load(), snapshot = baselines.get(state); return { ...snapshot, state }; },
    captureBudgetRecoveryBaseline: record("captureBaseline", f.baseline),
    async verifyBudgetRecoveryBaseline(state, baseline) { events.push("verifyBaseline"); assert.deepEqual(state, f.state); assert.deepEqual(baseline, f.baseline); return true; },
    readBudgetRecoverySourceProof: record("source", { sourceDiffDigest: f.context.sourceDiffDigest }),
    readBudgetRecoveryMigrationProof: record("migration", f.context.migrationDigest),
    async commitBudgetRecovery(snapshot, next) {
      events.push("recoveryCAS"); const expected = baselines.get(snapshot.state); assert.ok(expected);
      const result = await storage.replaceOperationUnderExistingOperationLock({ expectedRevision: expected.revision, expectedDigest: expected.digest, next });
      poisoned.add(snapshot.state); return copy(result.state);
    },
    async startCandidate(_runtime, target, { launchJournal }) {
      assert.equal(target, TARGET); const state = saved(), expected = launch(state);
      const actualNonce = await launchJournal.attempt("paused-web", expected.launchDisk, "f".repeat(64));
      assert.equal(saved().launchJournal.slots["paused-web"].phase, "attempted"); events.push("send");
      if (outcome === "unknown") { await launchJournal.unknown("paused-web"); throw new Error("synthetic unknown ACK"); }
      const actual = launch(state, actualNonce), slot = actual.launchJournal.slots["paused-web"];
      await launchJournal.confirm("paused-web", { observedNonce: actualNonce, environmentDigest: slot.environmentDigest, instance: slot.instance });
      return actual.candidate;
    },
    async verifyCandidate(runtime, candidate, pause) { validateCandidateProof(candidate, runtime); assert.equal(candidate.targetSha, TARGET); assert.equal(pause, "1"); events.push("verifyCandidate"); },
    async readManagedSnapshot(runtime, candidate, role) {
      validateCandidateProof(candidate, runtime); events.push("snapshot:" + role);
      return role === "web" ? "running:" + candidate.web.pm2.pid : "absent";
    },
    async readManagedSnapshotPair(runtime, candidate) {
      validateCandidateProof(candidate, runtime); events.push("snapshot:pair");
      return { web: "running:" + candidate.web.pm2.pid, worker: "absent" };
    },
    readCandidateHandoffFields: record("handoff", Object.fromEntries(["CANDIDATE_WEB_PID", "CANDIDATE_WEB_PROCESS_START_TICKS",
      "CANDIDATE_WEB_PROCESS_IDENTITY", "CANDIDATE_WEB_CWD_IDENTITY", "CANDIDATE_WEB_LISTENER_HANDOFF_PROOF_B64"].map(key => [key, "synthetic"]))),
    assertClientWritesDenied: record("assertAcl"),
    async resumeCandidate(runtime, candidate, target, { launchJournal }) {
      assert.equal(target, TARGET); events.push("resumeCandidate");
      const managed = [];
      for (const [index, role] of ["resumed-web", "worker"].entries()) {
        const actualNonce = await launchJournal.attempt(role, candidate.disk, "f".repeat(64));
        assert.equal(saved().launchJournal.slots[role].phase, "attempted"); events.push("send:" + role);
        const instance = { ...copy(saved().launchJournal.slots["paused-web"].instance),
          pmId: 20 + index, pid: 120 + index, startTicks: String(70 + index), createdAt: 2 + index, pmUptime: 2 + index };
        await launchJournal.confirm(role, { observedNonce: actualNonce, environmentDigest: "f".repeat(64), instance });
        const base = copy(candidate.web);
        Object.assign(base.pm2, { pmId: instance.pmId, pid: instance.pid, createdAt: instance.createdAt, pmUptime: instance.pmUptime,
          name: index === 0 ? runtime.input.appName : runtime.input.appName + "-enterprise-automation-worker" });
        Object.assign(base.processes[0], { pid: instance.pid, startTicks: instance.startTicks }); managed.push(base);
      }
      const resumed = validateResumedCandidateProof({ version: 1, candidate: { ...copy(candidate), pauseExpected: "0", web: managed[0] }, worker: managed[1] }, runtime);
      await launchJournal.checkpoint({ candidate: resumed.candidate, resumed });
      return resumed;
    },
    async verifyResumedCandidate(runtime, resumed) { validateResumedCandidateProof(resumed, runtime); events.push("verifyResumed"); },
    async persistResumedDump(runtime, resumed) { events.push("persistDump"); return syntheticDump(runtime, resumed, saved().launchJournal); },
    validateResumedDumpProof(value, runtime, resumed) { events.push("validateDump"); return validateResumedDumpProof(value, runtime, resumed); },
    async verifyResumedDump(runtime, resumed, value) { events.push("verifyDump"); validateResumedDumpProof(value, runtime, resumed); },
    restoreIngress: record("restoreIngress"), stopResumedCandidate: record("stopResumed"),
    async installIngress(ingress) { events.push("closeIngress"); return ingress; },
    async recloseAttemptIngress(state) { events.push("recloseIngress"); assert.deepEqual(state.budgetRecovery.predecessor.state, f.state); return state.ingress; },
    stopCandidate: record("stopCandidate"),
    stopRuntime: async () => { assert.fail("v8 cleanup must never resume or target original O"); },
    async reconcileMaintenanceLaunches(_runtime, _disk, target, { launchJournal }) {
      assert.equal(target, TARGET); events.push("reconcileReadOnly");
      const state = saved(), slot = state.launchJournal.slots["paused-web"], actual = launch(state, slot.nonce), observed = actual.launchJournal.slots["paused-web"];
      await launchJournal.confirm("paused-web", { observedNonce: slot.nonce, environmentDigest: observed.environmentDigest, instance: observed.instance });
      return { candidate: actual.candidate, resumed: null };
    },
  };
  return { ops, storage, events, saved, writes: () => writes, setNow: value => { now = value; },
    setFault: value => { fault = value; }, setOutcome: value => { outcome = value; }, fds: handles,
    setRevived: value => { revived = value; }, clearEvents: () => { events.length = 0; } };
}

test("isolated v7 to v8 controller, pure model and real journal storage composition", { concurrency: false }, async t => {
  const oldSeed = syntheticPredecessor(), mappings = new Map([[JSON.stringify(oldSeed), INCIDENT.stateDigest]]);
  t.mock.method(crypto, "createHash", (algorithm, options) => {
    const actual = originalCreateHash(algorithm, options), chunks = [], update = actual.update.bind(actual), digest = actual.digest.bind(actual);
    actual.update = (value, encoding) => { chunks.push(Buffer.from(value, encoding)); update(value, encoding); return actual; };
    actual.digest = encoding => {
      const real = digest(encoding), bytes = Buffer.concat(chunks);
      if (algorithm === "sha256" && encoding === "hex") {
        for (const [input, expected] of mappings) if (bytes.equals(Buffer.from(input))) return expected;
      }
      return real;
    };
    return actual;
  }); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); assert.equal(crypto.createHash, originalCreateHash); assert.notEqual(hash(oldSeed), INCIDENT.stateDigest); });
  const v6 = syntheticV6(oldSeed); mappings.set(JSON.stringify(v6), SECOND.stateDigest);
  const seed = syntheticV7(v6); mappings.set(JSON.stringify(seed), BUDGET.stateDigest);

  await t.test("new authority is exact while ordinary v7 remains expired at the real current clock", async () => {
    assert.equal(AUTH.authorizedAt, Date.parse("2026-09-14T07:13:57Z"));
    assert.equal(AUTH.expiresAt, Date.parse("2026-09-14T10:00:00Z"));
    assert.equal(Buffer.byteLength(JSON.stringify(seed)), 785807);
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(seed)).digest("hex"), BUDGET.stateDigest);
    assert.notEqual(hash(seed), BUDGET.stateDigest);
    for (const action of ["check-held", "check-runtime-held", "runtime-handoff", "start-candidate", "end", "fail-held"]) {
      const ordinary = { ...request(action, fixture(seed)), targetSha: BUDGET.previousTargetSha };
      assert.throws(() => validateMaintenanceState(seed, ordinary, BUDGET.bootId, NOW), /maintenance_second_attempt_recovery_invalid/);
    }
    for (const now of [AUTH.authorizedAt - 1, AUTH.expiresAt]) {
      const f = fixture(seed), r = rehearsal(f); r.setNow(now);
      await assert.rejects(runMaintenanceAction(request("inspect-budget-recovery", f), r.ops));
      assert.equal(r.writes(), 0); assert.equal(r.events.includes("send"), false);
    }
  });

  await t.test("inspection has zero writes/sends and returns the actual fixture baseline binding", async () => {
    const f = fixture(seed), r = rehearsal(f), report = await runMaintenanceAction(request("inspect-budget-recovery", f), r.ops);
    assert.deepEqual(report, f.inspection); assert.equal(r.writes(), 0); assert.equal(r.events.includes("send"), false);
    assert.deepEqual(r.saved(), f.state); assert.ok(r.events.includes("verifyBaseline")); assert.equal(r.fds.size, 0);
  });
  await t.test("recovery uses one durable CAS and retains the whole consumed journal and all prior audits", async () => {
    const f = fixture(seed), r = rehearsal(f), next = buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context);
    assert.equal((await runMaintenanceAction(request("recover-budget", f), r.ops)).state, "held");
    assert.deepEqual(r.saved(), next); assert.equal(r.writes(), 1); assert.equal(r.events.filter(event => event === "recoveryCAS").length, 1);
    assert.equal(r.events.filter(event => event === "bothStopped").length, 2); assert.equal(r.events.filter(event => event === "migration").length, 2);
    assert.deepEqual(r.saved().budgetRecovery.predecessor.state.launchJournal, f.state.launchJournal);
    assert.equal(r.saved().launchJournal, null); assert.equal(r.events.includes("send"), false);
    assert.equal(r.saved().version, 8); assert.equal(r.saved().revision, 32); assert.equal(r.saved().activeAttempt, 3);
    for (const key of ["recovery", "continuation", "buildRecovery", "deadlineExtension", "attemptRecovery", "secondAttemptRecovery"])
      assert.deepEqual(r.saved()[key], f.state[key]);
    assert.ok(r.events.indexOf("sync:file") < r.events.indexOf("rename")); assert.ok(r.events.indexOf("rename") < r.events.indexOf("sync:directory"));
    await assert.rejects(runMaintenanceAction(request("recover-budget", f), r.ops));
    assert.equal(r.writes(), 1); assert.equal(r.events.filter(event => event === "recoveryCAS").length, 1);
    assert.deepEqual(r.saved(), next); assert.equal(r.events.includes("send"), false);
  });
  await t.test("wrong target, invalid evidence, stale history or failed host proof never writes", async () => {
    for (const alter of [
      (r, q) => { q.targetSha = "e".repeat(40); },
      (r, q) => { q.budgetRecoveryEvidence.historyDigest = "invalid"; },
      (r, q) => { q.budgetRecoveryEvidence.historyCheckedAt = NOW - 300001; },
      r => { r.ops.validateProofs = () => { validateMaintenanceSubproofBindings({ ...seed, database: { ...seed.database, id: "2".repeat(64) } }); }; },
      r => { r.ops.assertDatabaseQuiet = async () => { throw new Error("synthetic active transaction"); }; },
    ]) {
      const f = fixture(seed), r = rehearsal(f), q = copy(request("recover-budget", f)); alter(r, q);
      await assert.rejects(runMaintenanceAction(q, r.ops)); assert.equal(r.writes(), 0); assert.equal(r.events.includes("send"), false);
    }
  });
  await t.test("second full proof round rechecks source, migration and real final deadline before CAS", async () => {
    for (const kind of ["source", "migration", "deadline"]) {
      const f = fixture(seed), r = rehearsal(f); let calls = 0;
      if (kind === "source") r.ops.readBudgetRecoverySourceProof = async () => ({ sourceDiffDigest: ++calls === 1 ? f.context.sourceDiffDigest : "e".repeat(64) });
      if (kind === "migration") r.ops.readBudgetRecoveryMigrationProof = async () => ++calls === 1 ? f.context.migrationDigest : "e".repeat(64);
      if (kind === "deadline") r.ops.assertDatabaseQuiet = async () => { if (++calls === 2) r.setNow(AUTH.expiresAt); };
      await assert.rejects(runMaintenanceAction(request("recover-budget", f), r.ops)); assert.equal(r.writes(), 0);
    }
  });
  await t.test("file fsync and post-rename uncertainty produce no recovery success and no send/retry", async () => {
    for (const stage of ["fileSync", "renameAfter", "directorySync"]) {
      const f = fixture(seed), r = rehearsal(f); r.setFault({ write: 1, stage });
      await assert.rejects(runMaintenanceAction(request("recover-budget", f), r.ops), /storage_unconfirmed/);
      assert.equal(r.events.filter(event => event === "recoveryCAS").length, 1); assert.equal(r.writes(), 1); assert.equal(r.events.includes("send"), false);
      assert.equal(r.saved().version, stage === "fileSync" ? 7 : 8); assert.equal(r.fds.size, 0);
    }
  });
  await t.test("later v8 start persists its own attempt before one send while all three predecessors stay immutable", async () => {
    const f = fixture(seed), initial = buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context), r = rehearsal(f, initial);
    assert.equal((await runMaintenanceAction(request("start-candidate", f), r.ops)).state, "candidate");
    assert.equal(r.events.filter(event => event === "send").length, 1); assert.equal(r.saved().launchJournal.slots["paused-web"].phase, "confirmed");
    assert.equal(r.saved().candidate.targetSha, TARGET); assert.deepEqual(r.saved().attemptRecovery, initial.attemptRecovery);
    assert.deepEqual(r.saved().budgetRecovery, initial.budgetRecovery);
    assert.deepEqual(r.saved().secondAttemptRecovery, initial.secondAttemptRecovery);
    assert.ok(r.events.indexOf("bothStopped") < r.events.indexOf("send"));
    assert.ok(r.events.slice(0, r.events.indexOf("send")).filter(event => event === "rename").length === 3);
    assert.notEqual(r.saved().launchJournal.slots["paused-web"].nonce, f.state.launchJournal.slots["paused-web"].nonce);
    assert.notEqual(r.saved().launchJournal.slots["paused-web"].nonce, f.state.attemptRecovery.predecessor.state.launchJournal.slots["paused-web"].nonce);
  });
  await t.test("any O/T5/T6/T7 revival blocks inspect, recovery and launch before writes or sends", async () => {
    for (const name of ["O", "T5", "T6", "T7"]) {
      for (const action of ["inspect-budget-recovery", "recover-budget", "start-candidate"]) {
        const f = fixture(seed), initial = action === "start-candidate" ? buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context) : f.state;
        const r = rehearsal(f, initial); r.setRevived(name);
        await assert.rejects(runMaintenanceAction(request(action, f), r.ops), /revival/);
        assert.equal(r.writes(), 0); assert.equal(r.events.includes("send"), false); assert.deepEqual(r.saved(), initial);
      }
      const f = fixture(seed), r = rehearsal(f, buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context));
      await runMaintenanceAction(request("start-candidate", f), r.ops); r.setRevived(name);
      for (const action of ["check-candidate", "snapshot-web", "snapshot-worker", "snapshot-pair", "register-candidate", "candidate-handoff", "end"]) {
        r.clearEvents(); const writes = r.writes();
        await assert.rejects(runMaintenanceAction(request(action, f), r.ops), /revival/);
        assert.equal(r.writes(), writes);
        assert.equal(r.events.some(event => ["verifyCandidate", "handoff", "snapshot:web", "snapshot:worker", "snapshot:pair", "resumeCandidate", "restoreIngress"].includes(event)), false);
      }
    }
  });
  await t.test("every candidate snapshot, check, registration and handoff excludes O/T5/T6/T7 before reading T8", async () => {
    const f = fixture(seed), r = rehearsal(f, buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context));
    await runMaintenanceAction(request("start-candidate", f), r.ops);
    assert.deepEqual(r.events.filter(event => ["verifyCandidate", "historicalGenerationStopped"].includes(event)),
      ["verifyCandidate", "historicalGenerationStopped", "verifyCandidate"]);
    for (const action of ["snapshot-web", "snapshot-worker", "snapshot-pair", "check-candidate", "register-candidate", "candidate-handoff"]) {
      r.clearEvents(); const writes = r.writes(); await runMaintenanceAction(request(action, f), r.ops);
      const effects = r.events.filter(event => ["proofs", "ingress", "historicalGenerationStopped", "verifyCandidate", "handoff", "snapshot:web", "snapshot:worker", "snapshot:pair"].includes(event));
      assert.deepEqual(effects, ["proofs", "ingress", "historicalGenerationStopped",
        ...(action.startsWith("snapshot-") ? ["snapshot:" + action.slice(9)] : ["verifyCandidate"]),
        ...(action === "candidate-handoff" ? ["handoff"] : [])]);
      assert.equal(r.writes(), writes); assert.equal(r.events.includes("bothStopped"), false);
    }
    for (const action of ["snapshot-web", "snapshot-worker", "check-candidate", "register-candidate", "candidate-handoff", "end"]) {
      r.clearEvents(); const writes = r.writes();
      r.ops.assertBudgetRecoveryGenerationsStopped = async () => { r.events.push("historicalGenerationStopped"); throw new Error("synthetic historical revival"); };
      await assert.rejects(runMaintenanceAction(request(action, f), r.ops), /historical revival/);
      assert.equal(r.writes(), writes);
      assert.equal(r.events.some(event => ["verifyCandidate", "handoff", "snapshot:web", "snapshot:worker", "snapshot:pair", "resumeCandidate", "restoreIngress"].includes(event)), false);
    }
  });
  await t.test("end preserves all four journals and checks historical absence before dump, before reopen and before ended", async () => {
    const f = fixture(seed), r = rehearsal(f, buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context));
    await runMaintenanceAction(request("start-candidate", f), r.ops); r.clearEvents();
    assert.equal((await runMaintenanceAction(request("end", f), r.ops)).state, "ended");
    assert.deepEqual(r.events.filter(event => ["ingress", "historicalGenerationStopped", "verifyCandidate", "assertAcl", "resumeCandidate",
      "send:resumed-web", "send:worker", "verifyResumed", "persistDump", "validateDump", "verifyDump", "restoreIngress"].includes(event)),
    ["ingress", "historicalGenerationStopped", "verifyCandidate", "assertAcl", "resumeCandidate", "send:resumed-web", "send:worker",
      "verifyResumed", "historicalGenerationStopped", "persistDump", "validateDump", "verifyDump", "ingress", "historicalGenerationStopped",
      "restoreIngress", "verifyResumed", "verifyDump", "historicalGenerationStopped"]);
    assert.deepEqual(r.saved().budgetRecovery.predecessor.state, f.state);
    assert.ok(r.saved().finalDump); assert.equal(r.saved().phase, "ended");
    for (const role of ["paused-web", "resumed-web", "worker"]) assert.equal(r.saved().launchJournal.slots[role].phase, "confirmed");
  });
  await t.test("historical revival after resume or before reopen blocks restore and stops only the new exact resumed proof", async () => {
    for (const rejectAt of [2, 3]) {
      const f = fixture(seed), r = rehearsal(f, buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context));
      await runMaintenanceAction(request("start-candidate", f), r.ops); r.clearEvents(); let observations = 0;
      r.ops.assertBudgetRecoveryGenerationsStopped = async () => { r.events.push("historicalGenerationStopped");
        if (++observations === rejectAt) throw new Error("synthetic historical revival"); };
      // Full cleanup must also refuse to certify held while historical remains alive.
      r.ops.assertBudgetRecoveryStopped = async () => { r.events.push("bothStopped"); throw new Error("synthetic historical remains alive"); };
      r.ops.stopResumedCandidate = async (runtime, resumed) => {
        assert.deepEqual(runtime, f.state.runtime); validateResumedCandidateProof(resumed, runtime);
        assert.equal(resumed.candidate.targetSha, TARGET); r.events.push("stopResumed");
      };
      await assert.rejects(runMaintenanceAction(request("end", f), r.ops), /failure_state_unverified/);
      assert.equal(observations, rejectAt); assert.equal(r.events.includes("restoreIngress"), false);
      assert.equal(r.events.filter(event => event === "recloseIngress").length, 1);
      assert.equal(r.events.filter(event => event === "stopResumed").length, 1); assert.equal(r.saved().phase, "failed-unknown");
      assert.equal(r.events.includes("persistDump"), rejectAt === 3); assert.deepEqual(r.saved().budgetRecovery.predecessor.state, f.state);
    }
  });
  await t.test("crossing the actual deadline after restore still recloses and stops but cannot save or certify held", async () => {
    const f = fixture(seed), r = rehearsal(f, buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context));
    await runMaintenanceAction(request("start-candidate", f), r.ops); r.clearEvents(); let writesAtReopen = -1;
    r.ops.restoreIngress = async () => { r.events.push("restoreIngress"); writesAtReopen = r.writes(); r.setNow(AUTH.expiresAt); };
    await assert.rejects(runMaintenanceAction(request("end", f), r.ops));
    assert.equal(r.events.filter(event => event === "restoreIngress").length, 1);
    assert.equal(r.events.filter(event => event === "recloseIngress").length, 1);
    assert.equal(r.events.filter(event => event === "stopResumed").length, 1);
    assert.ok(r.events.indexOf("restoreIngress") < r.events.indexOf("recloseIngress"));
    assert.equal(r.writes(), writesAtReopen); assert.equal(r.saved().phase, "resuming");
    assert.deepEqual(r.saved().budgetRecovery.predecessor.state, f.state);
    assert.equal(r.events.filter(event => event === "send:resumed-web").length, 1);
    assert.equal(r.events.filter(event => event === "send:worker").length, 1);
  });
  await t.test("uncertain attempted-slot persistence cannot authorize a process send", async () => {
    for (const stage of ["fileSync", "renameAfter", "directorySync"]) {
      const f = fixture(seed), r = rehearsal(f, buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context));
      r.setFault({ write: 3, stage }); await assert.rejects(runMaintenanceAction(request("start-candidate", f), r.ops));
      assert.equal(r.events.includes("send"), false); assert.equal(r.writes(), 3);
      assert.equal(r.saved().launchJournal.slots["paused-web"].phase, stage === "fileSync" ? "planned" : "attempted");
      assert.deepEqual(r.saved().budgetRecovery.predecessor.state.launchJournal, f.state.launchJournal);
    }
  });
  await t.test("unknown ACK is reconciled by an observation and stopped, never launched again", async () => {
    const f = fixture(seed), r = rehearsal(f, buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context)); r.setOutcome("unknown");
    await assert.rejects(runMaintenanceAction(request("start-candidate", f), r.ops), /candidate_start_failed_held/);
    assert.equal(r.events.filter(event => event === "send").length, 1); assert.equal(r.events.filter(event => event === "reconcileReadOnly").length, 1);
    assert.equal(r.events.filter(event => event === "stopCandidate").length, 1); assert.equal(r.saved().phase, "failed-held");
    assert.equal(r.saved().launchJournal.slots["paused-web"].phase, "confirmed");
    assert.deepEqual(r.saved().budgetRecovery.predecessor.state, f.state);
  });
  await t.test("real storage refuses v8 journal reset, audit deletion and predecessor reuse", async () => {
    const f = fixture(seed), r = rehearsal(f, buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context));
    await runMaintenanceAction(request("start-candidate", f), r.ops);
    const snapshot = await r.storage.readOperationUnderExistingOperationLock();
    for (const alter of [s => { s.launchJournal = null; s.launchDisk = null; s.candidate = null; s.phase = "held"; },
      s => { delete s.budgetRecovery; }, s => { s.version = 7; delete s.budgetRecovery; },
      s => { s.budgetRecovery.predecessor.state.launchJournal.slots["paused-web"].phase = "planned"; },
      ...["recovery", "continuation", "buildRecovery", "deadlineExtension", "attemptRecovery", "secondAttemptRecovery"]
        .map(key => s => { s[key] = null; })]) {
      const next = copy(snapshot.state); next.revision++; alter(next); const writes = r.writes();
      await assert.rejects(r.storage.replaceOperationUnderExistingOperationLock({ expectedRevision: snapshot.revision, expectedDigest: snapshot.digest, next }));
      assert.equal(r.writes(), writes);
    }
    const bound = maintenanceLaunchBinding(snapshot.state), slot = snapshot.state.launchJournal.slots["paused-web"];
    await assert.rejects(r.storage.applyUnderExistingOperationLock({ expectedRevision: snapshot.revision, expectedDigest: snapshot.digest, binding: bound,
      change: { type: "transition", value: { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "attempted" } } }));
  });
  await t.test("each consumed T5, T6 or T7 launch nonce is rejected before any new process send", async () => {
    const historical = [seed.launchJournal, seed.secondAttemptRecovery.predecessor.state.launchJournal,
      seed.attemptRecovery.predecessor.state.launchJournal].map(journal => journal.slots["paused-web"].nonce);
    assert.equal(new Set(historical).size, 3);
    for (const nonce of historical) {
      const f = fixture(seed), r = rehearsal(f, buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context));
      r.ops.uuid = () => nonce;
      await assert.rejects(runMaintenanceAction(request("start-candidate", f), r.ops));
      assert.equal(r.events.includes("send"), false);
      assert.deepEqual(r.saved().budgetRecovery.predecessor.state, f.state);
      assert.equal(r.saved().launchJournal?.slots["paused-web"] ?? null, null);
    }
  });
});
