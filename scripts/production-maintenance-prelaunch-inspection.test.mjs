import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { assertPrelaunchRecoveryGenerationsStopped, assertPrelaunchRecoveryStopped, capturePrelaunchRecoveryBaseline, validatePrelaunchRecoveryBaseline, verifyPrelaunchRecoveryBaseline } from "./production-maintenance-prelaunch-inspection.mjs";
import { readPrelaunchRecoveryHandoffFields } from "./production-maintenance-prelaunch-handoff.mjs";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "./production-maintenance-launch-journal.mjs";

const PIN5 = "d8e8abb8926441caef71867c15539fdafcb7cc9dbe0f77bd84ebc9548d39a0f8";
const BOOT = "e6531ec9-db4a-4216-b87a-7cc858197eaa";
const U = "eb81284a-09c4-4514-8f16-38eaf6acc1e4";
const O = "cd943076ebda758b70bf2f2270a508c774b726d6";
const T5 = "f3104de19aa59e527c7b94a99850d151448da8cd";
const APP = "/www/wwwroot/merchant-space";
const realCreateHash = crypto.createHash;
const hash = value => realCreateHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const id = (inode, kind = "file") => `1:${inode}:64:10:20:${kind === "directory" ? 2 : 1}:0:${kind === "directory" ? 16877 : kind === "link" ? 41471 : 33188}`;
function fixtureV5() {
  const disks = new Map(), environments = new Map(), facts = new Map(), calls = [];
  const config = { internalUrl: "http://fixture.invalid", publicUrl: "https://fixture.invalid", anonKey: "SYNTHETIC_PRIVATE", rolloutStatus: "explicit",
    staffBusinessRbacMode: "off", staffBusinessRbacSiteIds: "", canonicalPortalOrigin: "https://fixture.invalid" };
  for (const [sha, number] of [[O, 10], [T5, 20], [T6, 30], [T7, 40]]) {
    const runtime = `${APP}.releases/${sha.slice(0, 12)}-20260913200000`;
    const disk = { runtime, runtimeIdentity: id(number, "directory"), environmentIdentity: id(number + 1), environmentDigest: hash(sha + "env"),
      nextBuildIdentity: id(number + 2), nextBuildDigest: hash(sha), nextEntryPath: runtime + "/node_modules/next/dist/bin/next", nextEntryIdentity: id(number + 3) };
    const environment = { directoryIdentity: "1:2:10:20:2:0:16877", fileIdentity: disk.environmentIdentity, sha256: disk.environmentDigest, configurationHash: hash(config) };
    disks.set(sha, disk); environments.set(sha, environment);
  }
  const proc = (pid, cwd, cwdIdentity, parentPid = 10) => ({ pid, parentPid, startTicks: String(pid + 100), processIdentity: id(pid, "directory"), uid: 0,
    cwd, cwdIdentity, executable: "/usr/bin/node", executableIdentity: id(500), commandLineDigest: hash(String(pid)) });
  const daemon = proc(10, "/", id(1, "directory"), 1); facts.set(10, daemon);
  const managed = (pid, sha, worker = false) => ({ pm2: { pmId: pid, pid, name: "merchant-space" + (worker ? "-enterprise-automation-worker" : ""),
    status: "online", createdAt: 10000, pmUptime: 10000, restartTime: 0, metadataHash: hash(String(pid) + "metadata") },
    processes: [proc(pid, disks.get(sha).runtime, disks.get(sha).runtimeIdentity)] });
  const runtime = { version: 1, input: { appDir: APP, appName: "merchant-space", appPort: 3000, expectedOldSha: O }, bootId: BOOT,
    disk: disks.get(O), environment: environments.get(O), daemon, web: managed(101, O), worker: { state: "running", managed: managed(102, O, true) } };
  const candidate = { version: 1, targetSha: T5, pauseExpected: "1", disk: disks.get(T5), environment: environments.get(T5), daemon, web: managed(201, T5) };
  const binding = { operationId: U, targetSha: T5, appName: "merchant-space", appPort: 3000,
    daemon: { pid: 10, uid: 0, startTicks: daemon.startTicks, bootId: BOOT, executable: daemon.executable, executableIdentity: daemon.executableIdentity },
    release: { path: candidate.disk.runtime, identity: candidate.disk.runtimeIdentity, buildDigest: candidate.disk.nextBuildDigest } };
  const nonce = "12345678-1234-4234-8234-123456789012", environmentDigest = hash("launch environment");
  let journal = planMaintenanceLaunch(createMaintenanceLaunchJournal(binding), binding, { role: "paused-web", sequence: 1, nonce, environmentDigest });
  journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, phase: "attempted" });
  const pm = candidate.web.pm2;
  journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, phase: "confirmed", observation: {
    ...binding, role: "paused-web", sequence: 1, observedNonce: nonce, environmentDigest,
    instance: { ...candidate.web.processes[0], pmId: pm.pmId, createdAt: pm.createdAt, pmUptime: pm.pmUptime, restartTime: pm.restartTime, metadataDigest: pm.metadataHash },
  } });
  const state = syntheticPredecessor(runtime, candidate, journal);
  let current = { target: candidate.disk.runtime, linkIdentity: id(90, "link"), runtimeIdentity: candidate.disk.runtimeIdentity };
  const runtimeIo = {
    boot: () => BOOT,
    runtimeIdentity(path) { calls.push("disk:" + path); return [...disks.values()].find(disk => disk.runtime === path).runtimeIdentity; },
    readRollback(path, sha) {
      assert.equal(path, disks.get(sha).runtime + "/.env.local");
      const environment = environments.get(sha);
      return { ...config, directoryIdentity: environment.directoryIdentity, fileIdentity: environment.fileIdentity, sha256: environment.sha256 };
    },
    file(path) {
      const disk = [...disks.values()].find(value => path.startsWith(value.runtime + "/"));
      return path.endsWith("/BUILD_ID") ? { identity: disk.nextBuildIdentity, hash: disk.nextBuildDigest } : { identity: disk.nextEntryIdentity, hash: hash("entry") };
    },
    readProcess: pid => structuredClone(facts.get(pid) ?? null),
    processesInRuntime(path) { calls.push("scan:" + path); return [...facts.values()].filter(fact => fact.cwd === path || fact.cwd.startsWith(path + "/")).map(fact => fact.pid); },
    portEmpty() { calls.push("port"); return true; },
    pm2Registry: async () => { calls.push("registry"); return []; },
  };
  const io = { runtime: runtimeIo, readCurrent: () => { calls.push("current"); return structuredClone(current); }, now: () => Date.parse("2026-09-13T22:30:00Z") };
  return { state, io, facts, disks, environments, calls, candidate6: { version: 1, targetSha: T6, pauseExpected: "1", disk: disks.get(T6), environment: environments.get(T6), daemon, web: managed(301, T6) }, candidate7: { version: 1, targetSha: T7, pauseExpected: "1", disk: disks.get(T7), environment: environments.get(T7), daemon, web: managed(401, T7) }, setCurrent: value => { current = value; }, current: () => current };
}

import { buildMaintenanceRecoveredState, createMaintenanceRecoveryInspection } from "./production-maintenance-recovery.mjs";
import { buildMaintenanceContinuedState, createMaintenanceContinuationInspection } from "./production-maintenance-continuation.mjs";
import { MAINTENANCE_BUILD_RECOVERY_INCIDENT as BUILD, MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION as OLD_EXTENSION,
  MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION_DIGEST as OLD_EXTENSION_DIGEST,
  MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP_SPEC_DIGEST, validateMaintenanceBuildRecoveryState } from "./production-maintenance-build-recovery.mjs";
import { MAINTENANCE_ATTEMPT_RECOVERY_INCIDENT as INCIDENT, createMaintenanceAttemptRecoveryInspection,
  buildMaintenanceAttemptRecoveredState } from "./production-maintenance-attempt-recovery.mjs";
const PIN6 = "785a4139be1cc78b42fd0a9e2dde619d995f0b2f1be521589ec31fd900c0db75";
const T6 = "3af8fa6ba6644593e10bef0a391389b2b34e926a";
const NOW = Date.parse("2026-09-14T17:00:00Z"), copy = value => structuredClone(value);
const RUN_KEYS = ["backupRunId", "backupRunAttempt", "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt", "failedDeployRunId", "failedDeployRunAttempt"];

function syntheticPredecessor(runtime, candidate, journal) {
  const initial = { version: 2, revision: 3, operationId: INCIDENT.operationId, targetSha: BUILD.originalTargetSha,
    expectedOldSha: INCIDENT.expectedOldSha, appDir: APP, appName: "merchant-space", appPort: 3000, bootId: INCIDENT.bootId,
    createdAt: INCIDENT.createdAt, phase: "failed-held", runtime, ingress: { fixture: true }, database: { fixture: true },
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
  Object.assign(state, { candidate, launchDisk: candidate.disk, launchJournal: journal });
  validateMaintenanceBuildRecoveryState(state, { bootId: BOOT, now: INCIDENT.historicalObservedAt });
  return state;
}


function assembleV6(f) {
  const seed = f.state, now = Date.parse("2026-09-13T23:29:37Z");
  const stoppedBaseline = { version: 1, stateDigest: PIN5, candidateDigest: hash(seed.candidate), launchDiskDigest: hash(seed.launchDisk),
    launchJournalDigest: hash(seed.launchJournal), runtimeDigest: hash(seed.runtime), current: copy(f.current()), bootId: BOOT,
    pm2RegistryDigest: hash([]), observedAt: now - 1000 };
  const context = { operationId: U, previousTargetSha: T5, targetSha: T6, expectedOldSha: O, expectedRevision: 15,
    expectedDigest: PIN5, bootId: BOOT, now, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline };
  const evidence = { ...createMaintenanceAttemptRecoveryInspection(seed, context), toolsSha: T6,
    attemptRecoveryRunId: "34789744074", attemptRecoveryRunAttempt: 1, mainCIrunId: "34789133814", historyDigest: "d".repeat(64), historyCheckedAt: now - 1000 };
  const state = copy(buildMaintenanceAttemptRecoveredState(seed, evidence, context)), candidate = f.candidate6, daemon = state.runtime.daemon;
  const binding = { operationId: U, targetSha: T6, appName: state.appName, appPort: 3000,
    daemon: { pid: daemon.pid, uid: 0, startTicks: daemon.startTicks, bootId: BOOT, executable: daemon.executable, executableIdentity: daemon.executableIdentity },
    release: { path: candidate.disk.runtime, identity: candidate.disk.runtimeIdentity, buildDigest: candidate.disk.nextBuildDigest } };
  const nonce = "11111111-2222-4333-8444-555555555555", environmentDigest = hash("T6 launch"), pm = candidate.web.pm2;
  let journal = planMaintenanceLaunch(createMaintenanceLaunchJournal(binding), binding, { role: "paused-web", sequence: 1, nonce, environmentDigest });
  journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, phase: "attempted" });
  journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, phase: "confirmed", observation: {
    ...binding, role: "paused-web", sequence: 1, observedNonce: nonce, environmentDigest,
    instance: { ...candidate.web.processes[0], pmId: pm.pmId, createdAt: pm.createdAt, pmUptime: pm.pmUptime, restartTime: pm.restartTime, metadataDigest: pm.metadataHash },
  } });
  Object.assign(state, { revision: 23, phase: "failed-held", candidate, launchDisk: candidate.disk, launchJournal: journal });
  f.state = state; f.setCurrent({ target: candidate.disk.runtime, linkIdentity: id(91, "link"), runtimeIdentity: candidate.disk.runtimeIdentity });
  f.io.now = () => NOW; return f;
}



import { createMaintenanceSecondAttemptRecoveryInspection, buildMaintenanceSecondAttemptRecoveredState,
  validateMaintenanceSecondAttemptRecoveryState } from "./production-maintenance-second-attempt-recovery.mjs";
import { MAINTENANCE_BUDGET_RECOVERY_INCIDENT as BUDGET } from "./production-maintenance-budget-recovery.mjs";
const PIN = BUDGET.stateDigest, T7 = BUDGET.previousTargetSha;

function assembleV7(f) {
  const seed = f.state, now = Date.parse("2026-09-14T02:48:00Z");
  const stoppedBaseline = { version: 2, stateDigest: PIN6, candidateDigest: hash(seed.candidate), launchDiskDigest: hash(seed.launchDisk),
    launchJournalDigest: hash(seed.launchJournal), runtimeDigest: hash(seed.runtime), current: copy(f.current()), bootId: BOOT,
    pm2RegistryDigest: hash([]), observedAt: now - 1000 };
  const context = { operationId: U, previousTargetSha: T6, targetSha: T7, expectedOldSha: O, expectedRevision: 23,
    expectedDigest: PIN6, bootId: BOOT, now, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline };
  const evidence = { ...createMaintenanceSecondAttemptRecoveryInspection(seed, context), toolsSha: T7,
    secondAttemptRecoveryRunId: "34800461043", secondAttemptRecoveryRunAttempt: 1, mainCIrunId: "34799821827",
    historyDigest: "d".repeat(64), historyCheckedAt: now - 1000 };
  const state = copy(buildMaintenanceSecondAttemptRecoveredState(seed, evidence, context)), candidate = f.candidate7, daemon = state.runtime.daemon;
  const binding = { operationId: U, targetSha: T7, appName: state.appName, appPort: 3000,
    daemon: { pid: daemon.pid, uid: 0, startTicks: daemon.startTicks, bootId: BOOT, executable: daemon.executable, executableIdentity: daemon.executableIdentity },
    release: { path: candidate.disk.runtime, identity: candidate.disk.runtimeIdentity, buildDigest: candidate.disk.nextBuildDigest } };
  const nonce = "22222222-2222-4333-8444-555555555555", environmentDigest = hash("T7 launch"), pm = candidate.web.pm2;
  let journal = planMaintenanceLaunch(createMaintenanceLaunchJournal(binding), binding, { role: "paused-web", sequence: 1, nonce, environmentDigest });
  journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, phase: "attempted" });
  journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce, phase: "confirmed", observation: {
    ...binding, role: "paused-web", sequence: 1, observedNonce: nonce, environmentDigest,
    instance: { ...candidate.web.processes[0], pmId: pm.pmId, createdAt: pm.createdAt, pmUptime: pm.pmUptime, restartTime: pm.restartTime, metadataDigest: pm.metadataHash },
  } });
  Object.assign(state, { revision: 31, phase: "failed-held", candidate, launchDisk: candidate.disk, launchJournal: journal });
  // Host runtime/disk/process proofs are fully typed. Ingress/database remain
  // explicitly synthetic pure-protocol fixtures, not production observations.
  state.ingress.padding = "";
  const remaining = BUDGET.stateBytes - Buffer.byteLength(JSON.stringify(state));
  assert(remaining > 0); state.ingress.padding = "x".repeat(remaining);
  assert.equal(Buffer.byteLength(JSON.stringify(state)), BUDGET.stateBytes);
  validateMaintenanceSecondAttemptRecoveryState(state, { bootId: BOOT, now });
  f.state = state; f.setCurrent({ target: candidate.disk.runtime, linkIdentity: id(92, "link"), runtimeIdentity: candidate.disk.runtimeIdentity });
  f.io.now = () => NOW; return f;
}

import { createMaintenanceBudgetRecoveryInspection, buildMaintenanceBudgetRecoveredState,
  validateMaintenanceBudgetRecoveryState } from "./production-maintenance-budget-recovery.mjs";
import { MAINTENANCE_WINDOW_RENEWAL_INCIDENT as WINDOW,
  createMaintenanceWindowRenewalInspection, buildMaintenanceWindowRenewedState } from "./production-maintenance-window-renewal.mjs";
function assembleV8(f) {
  const seed = f.state, now = Date.parse("2026-09-14T09:07:00Z");
  const stoppedBaseline = { version: 3, stateDigest: PIN, candidateDigest: hash(seed.candidate), launchDiskDigest: hash(seed.launchDisk),
    launchJournalDigest: hash(seed.launchJournal), runtimeDigest: hash(seed.runtime), current: copy(f.current()), bootId: BOOT,
    pm2RegistryDigest: hash([]), observedAt: now - 1000 };
  const context = { operationId: U, previousTargetSha: T7, targetSha: WINDOW.previousTargetSha, expectedOldSha: O, expectedRevision: 31,
    expectedDigest: PIN, bootId: BOOT, now, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline };
  const evidence = { ...createMaintenanceBudgetRecoveryInspection(seed, context), toolsSha: context.targetSha,
    budgetRecoveryRunId: WINDOW.priorRecoveryRunId, budgetRecoveryRunAttempt: 1, mainCIrunId: WINDOW.priorMainCIrunId,
    historyDigest: "d".repeat(64), historyCheckedAt: now - 1000 };
  const state = copy(buildMaintenanceBudgetRecoveredState(seed, evidence, context));
  // Match only the size of this fully synthetic unused v8. No private state,
  // production proof or configurable production hash override enters tests.
  state.ingress.padding = "";
  const remaining = WINDOW.stateBytes - Buffer.byteLength(JSON.stringify(state));
  assert(remaining > 0); state.ingress.padding = "y".repeat(remaining);
  validateMaintenanceBudgetRecoveryState(state, { bootId: BOOT, now });
  assert.equal(Buffer.byteLength(JSON.stringify(state)), WINDOW.stateBytes);
  f.state = state; f.io.now = () => NOW;
  Object.defineProperty(f, "archived", { get() { return f.state.budgetRecovery.predecessor.state; } });
  return f;
}

import { MAINTENANCE_PRELAUNCH_RECOVERY_INCIDENT as PRELAUNCH, MAINTENANCE_PRELAUNCH_RECOVERY_AUTHORIZATION as PRELAUNCH_AUTH,
  createMaintenancePrelaunchRecoveryInspection, buildMaintenancePrelaunchRecoveredState,
  validateMaintenancePrelaunchRecoveryPredecessor } from "./production-maintenance-prelaunch-recovery.mjs";
function assembleV9(f) {
  const now = Date.parse("2026-09-14T13:58:00Z"), state = f.state;
  const stoppedBaseline = { ...copy(state.budgetRecovery.stoppedBaseline), observedAt: now - 1000 };
  const context = { operationId: U, previousTargetSha: WINDOW.previousTargetSha, targetSha: PRELAUNCH.previousTargetSha,
    expectedOldSha: O, expectedRevision: WINDOW.revision, expectedDigest: WINDOW.stateDigest, bootId: BOOT, now,
    sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline };
  const evidence = { ...createMaintenanceWindowRenewalInspection(state, context), toolsSha: context.targetSha,
    windowRenewalRunId: PRELAUNCH.priorRecoveryRunId, windowRenewalRunAttempt: 1, mainCIrunId: PRELAUNCH.priorMainCIrunId,
    historyDigest: "d".repeat(64), historyCheckedAt: now - 1000 };
  f.state = copy(buildMaintenanceWindowRenewedState(state, evidence, context));
  f.state.phase = "failed-held"; f.state.revision = 35; f.state.ingress.padding = "";
  const remaining = PRELAUNCH.stateBytes - Buffer.byteLength(JSON.stringify(f.state));
  assert(remaining > 0); f.state.ingress.padding = "z".repeat(remaining);
  assert.equal(Buffer.byteLength(JSON.stringify(f.state)), PRELAUNCH.stateBytes);
  f.io.now = () => NOW; return f;
}
async function recover(f) {
  const stoppedBaseline = await capturePrelaunchRecoveryBaseline(f.state, f.io);
  const context = { operationId: U, previousTargetSha: PRELAUNCH.previousTargetSha, targetSha: "e".repeat(40), expectedOldSha: O,
    expectedRevision: PRELAUNCH.revision, expectedDigest: PRELAUNCH.stateDigest, bootId: BOOT, now: NOW,
    sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline };
  f.state = copy(buildMaintenancePrelaunchRecoveredState(f.state, { ...createMaintenancePrelaunchRecoveryInspection(f.state, context),
    toolsSha: context.targetSha, prelaunchRecoveryRunId: "34900000001", prelaunchRecoveryRunAttempt: 1, mainCIrunId: "34900000002",
    historyDigest: "d".repeat(64), historyCheckedAt: NOW - 1000 }, context));
  return f;
}

test("exact failed v9 and flat recovered v10 compose actual O/T5/T6/T7 read-only proofs", { concurrency: false }, async t => {
  const seed5 = fixtureV5(), mappings = new Map([[JSON.stringify(seed5.state), PIN5]]);
  t.mock.method(crypto, "createHash", (algorithm, options) => {
    const actual = realCreateHash(algorithm, options), chunks = [], update = actual.update.bind(actual), digest = actual.digest.bind(actual);
    actual.update = (value, encoding) => { chunks.push(Buffer.from(value, encoding)); update(value, encoding); return actual; };
    actual.digest = encoding => {
      const value = digest(encoding), mapped = mappings.get(Buffer.concat(chunks).toString());
      return algorithm === "sha256" && encoding === "hex" && mapped ? mapped : value;
    }; return actual;
  }); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); assert.equal(crypto.createHash, realCreateHash); });
  const seed6 = assembleV6(seed5); mappings.set(JSON.stringify(seed6.state), PIN6);
  const seed7 = assembleV7(seed6); mappings.set(JSON.stringify(seed7.state), PIN);
  const seed8 = assembleV8(seed7); mappings.set(JSON.stringify(seed8.state), WINDOW.stateDigest);
  const seed = assembleV9(seed8); mappings.set(JSON.stringify(seed.state), PRELAUNCH.stateDigest);
  const fixture = () => assembleV9(assembleV8(assembleV7(assembleV6(fixtureV5()))));
  const reject = promise => assert.rejects(promise, /prelaunch_(?:inspection_unverified|handoff_unverified)/);
  await t.test("only five exact synthetic states map, real private state is never used", () => {
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(seed.state)).digest("hex"), PRELAUNCH.stateDigest);
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(seed.state) + " ").digest("hex"), hash(JSON.stringify(seed.state) + " "));
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(seed.archived.candidate)).digest("hex"), hash(seed.archived.candidate));
  });
  await t.test("capture observes all four real frozen directories/generations and port; signed baseline timestamp retained", async () => {
    const f = fixture(), bytes = JSON.stringify(f.state), baseline = await capturePrelaunchRecoveryBaseline(f.state, f.io);
    assert.equal(baseline.version, 3); assert.equal(baseline.stateDigest, PIN); assert.equal(baseline.current.target, f.archived.candidate.disk.runtime);
    assert.equal(f.calls.filter(x => x === "registry").length, 4); assert.equal(f.calls.filter(x => x === "port").length, 4);
    for (const disk of f.disks.values()) assert(f.calls.includes("scan:" + disk.runtime));
    assert.equal(JSON.stringify(f.state), bytes); assert(Object.isFrozen(baseline.current)); assert(!JSON.stringify(baseline).includes("SYNTHETIC_PRIVATE"));
    f.io.now = () => NOW + 1; assert.equal(await verifyPrelaunchRecoveryBaseline(f.state, baseline, f.io), true); assert.equal(baseline.observedAt, NOW);
  });
  await t.test("O web/worker, T5, T6 and T7 generations or descendants cannot revive", async () => {
    for (const select of [f => f.state.runtime.web.processes[0], f => f.state.runtime.worker.managed.processes[0],
      f => f.archived.attemptRecovery.predecessor.state.candidate.web.processes[0],
      f => f.archived.secondAttemptRecovery.predecessor.state.candidate.web.processes[0], f => f.archived.candidate.web.processes[0],
      f => ({ ...f.archived.candidate.web.processes[0], pid: 402, parentPid: 401, cwd: f.archived.candidate.disk.runtime + "/subdirectory" })]) {
      const f = fixture(), fact = select(f); f.facts.set(fact.pid, fact); await reject(capturePrelaunchRecoveryBaseline(f.state, f.io));
    }
  });
  await t.test("later full-stop assertion does not consult current; it still requires empty port", async () => {
    const f = fixture(); f.io.readCurrent = () => assert.fail("current must not be rewritten or consulted");
    assert.equal(await assertPrelaunchRecoveryStopped(f.state, f.io), true);
    f.io.runtime.portEmpty = () => false; await reject(assertPrelaunchRecoveryStopped(f.state, f.io));
  });
  await t.test("generation-only checks allow T8 listener and same app, but exclude all histories and registry drift", async () => {
    const newPath = APP + ".releases/aaaaaaaaaaaa-20260914023000";
    const make = () => {
      const f = fixture(), row = { name: "merchant-space", pid: 501, pm_id: 501, pm2_env: { name: "merchant-space", pm_id: 501, status: "online",
        created_at: 20000, pm_uptime: 20000, restart_time: 0, pm_cwd: newPath, pm_exec_path: newPath + "/node_modules/next/dist/bin/next",
        args: ["start", "-p", "3000"], node_args: [], exec_mode: "fork_mode", exec_interpreter: "/usr/bin/node", watch: false, cron_restart: null,
        autorestart: false, FAOLLA_BACKGROUND_JOBS_PAUSED: "1", nonce: "12345678-1234-4234-8234-123456789014", envDigest: "a".repeat(64) } };
      f.facts.set(501, { ...f.archived.candidate.web.processes[0], pid: 501, startTicks: "999", cwd: newPath });
      f.io.runtime.pm2Registry = async () => [copy(row)];
      f.io.runtime.portEmpty = () => assert.fail("no fake empty port assertion"); f.io.readCurrent = () => assert.fail("no current relabel");
      return { f, row };
    };
    const good = make(); let registryReads = 0;
    const readRegistry = good.f.io.runtime.pm2Registry;
    good.f.io.runtime.pm2Registry = async (...args) => { registryReads++; return readRegistry(...args); };
    assert.equal(await assertPrelaunchRecoveryGenerationsStopped(good.f.state, good.f.io), true);
    assert.equal(registryReads, 2);
    for (const disk of good.f.disks.values()) assert.equal(good.f.calls.filter(call => call === "scan:" + disk.runtime).length, 2);
    for (const mutate of [
      ({ f }) => f.facts.set(101, f.state.runtime.web.processes[0]),
      ({ f }) => f.facts.set(102, f.state.runtime.worker.managed.processes[0]),
      ({ f }) => f.facts.set(201, f.archived.attemptRecovery.predecessor.state.candidate.web.processes[0]),
      ({ f }) => f.facts.set(301, f.archived.secondAttemptRecovery.predecessor.state.candidate.web.processes[0]),
      ({ f }) => f.facts.set(401, f.archived.candidate.web.processes[0]),
      ({ f, row }) => { row.pm2_env.pm_cwd = f.disks.get(T5).runtime; },
      ({ f, row }) => { row.pm2_env.pm_exec_path = f.archived.candidate.disk.nextEntryPath; },
      ({ row }) => { row.pm_id = row.pm2_env.pm_id = 301; row.pm2_env.created_at = 10000; },
      ({ f, row }) => { let n = 0; f.io.runtime.pm2Registry = async () => [{ ...row, pm2_env: { ...row.pm2_env, restart_time: n++ } }]; },
    ]) { const changed = make(); mutate(changed); await reject(assertPrelaunchRecoveryGenerationsStopped(changed.f.state, changed.f.io)); }
    for (const sha of [O, T5, T6, T7]) {
      const changed = make(); changed.row.pm2_env.pm_exec_path = changed.f.disks.get(sha).nextEntryPath;
      await reject(assertPrelaunchRecoveryGenerationsStopped(changed.f.state, changed.f.io));
      const descendant = make(); descendant.f.facts.set(601, { ...descendant.f.archived.candidate.web.processes[0], pid: 601,
        cwd: descendant.f.disks.get(sha).runtime + "/descendant" });
      await reject(assertPrelaunchRecoveryGenerationsStopped(descendant.f.state, descendant.f.io));
    }
  });
  await t.test("each original/candidate disk and environment is checked in full-stop and generation-only paths", async () => {
    for (const observe of [capturePrelaunchRecoveryBaseline, assertPrelaunchRecoveryGenerationsStopped]) {
      for (const sha of [O, T5, T6, T7]) {
        for (const kind of ["buildHash", "entryIdentity", "environment", "directoryIdentity"]) {
          const f = fixture(), disk = f.disks.get(sha);
          if (kind === "environment") {
            const read = f.io.runtime.readRollback;
            f.io.runtime.readRollback = (path, target) => ({ ...read(path, target), ...(target === sha ? { anonKey: "DRIFT" } : {}) });
          } else if (kind === "directoryIdentity") {
            const read = f.io.runtime.runtimeIdentity;
            f.io.runtime.runtimeIdentity = path => path === disk.runtime ? id(999, "directory") : read(path);
          } else {
            const read = f.io.runtime.file;
            f.io.runtime.file = path => ({ ...read(path), ...(path === (kind === "buildHash" ? disk.runtime + "/.next/BUILD_ID" : disk.nextEntryPath) ?
              kind === "buildHash" ? { hash: "f".repeat(64) } : { identity: id(999) } : {}) });
          }
          await reject(observe(f.state, f.io));
        }
      }
    }
  });
  await t.test("fresh daemon/boot, registry and current observations cannot drift within a check", async () => {
    for (const observe of [capturePrelaunchRecoveryBaseline, assertPrelaunchRecoveryGenerationsStopped]) {
      const daemon = fixture(), read = daemon.io.runtime.readProcess; let n = 0;
      daemon.io.runtime.readProcess = pid => {
        const actual = read(pid);
        return pid === 10 && ++n > 1 ? { ...actual, processIdentity: id(10000, "directory") } : actual;
      };
      await reject(observe(daemon.state, daemon.io));
      const reboot = fixture(); let bootReads = 0;
      reboot.io.runtime.boot = () => ++bootReads > 3 ? "another-boot" : BOOT;
      await reject(observe(reboot.state, reboot.io));
      const lateDisk = fixture(), file = lateDisk.io.runtime.file; let buildReads = 0;
      lateDisk.io.runtime.file = path => ({ ...file(path), ...(path === lateDisk.disks.get(O).runtime + "/.next/BUILD_ID" &&
        ++buildReads > 1 ? { hash: "f".repeat(64) } : {}) });
      await reject(observe(lateDisk.state, lateDisk.io));
    }
    const current = fixture(); let currentReads = 0;
    current.io.readCurrent = () => ({ ...current.current(), linkIdentity: id(++currentReads === 1 ? 92 : 93, "link") });
    await reject(capturePrelaunchRecoveryBaseline(current.state, current.io));
    const registry = fixture(); let registryReads = 0;
    registry.io.runtime.pm2Registry = async () => ++registryReads === 4 ? [{ malformed: true }] : [];
    await reject(capturePrelaunchRecoveryBaseline(registry.state, registry.io));
    assert.equal(registryReads, 4);
  });
  await t.test("T7 handoff returns only 27 physical/configuration fields and original O worker policy", async () => {
    const f = fixture(), baseline = await capturePrelaunchRecoveryBaseline(f.state, f.io), bytes = JSON.stringify(f.state);
    const fields = await readPrelaunchRecoveryHandoffFields(f.state.runtime, f.state, baseline, f.io);
    assert.equal(Object.keys(fields).length, 27); assert.equal(fields.PREVIOUS_BUILD_ID, T7); assert.equal(fields.PREVIOUS_WEB_PID, "401");
    assert.equal(fields.PREVIOUS_LINK_TARGET, f.disks.get(T7).runtime); assert.equal(fields.PREVIOUS_ENVIRONMENT_FILE_IDENTITY, f.disks.get(T7).environmentIdentity);
    assert.equal(fields.PREVIOUS_AUTOMATION_WORKER_STATE, "running"); assert.equal(JSON.stringify(f.state), bytes);
    assert(Buffer.byteLength(JSON.stringify(fields)) < 8192);
    await reject(readPrelaunchRecoveryHandoffFields({ ...f.state.runtime, bootId: "bad" }, f.state, baseline, f.io));
    let n = 0; f.io.readCurrent = () => ({ ...f.current(), linkIdentity: id(++n < 3 ? 92 : 93, "link") });
    await reject(readPrelaunchRecoveryHandoffFields(f.state.runtime, f.state, baseline, f.io));
  });
  await t.test("wrong current, file/env drift, boot, journal, audit, getters and mutations reject", async () => {
    for (const mutate of [
      f => f.setCurrent({ ...f.current(), target: f.disks.get(T5).runtime }),
      f => { f.io.runtime.boot = () => "bad"; },
      f => { const read = f.io.runtime.readRollback; f.io.runtime.readRollback = (...args) => ({ ...read(...args), anonKey: "DRIFT" }); },
      f => { f.io.runtime.runtimeIdentity = () => id(999, "directory"); },
      f => { f.state.revision++; }, f => { f.archived.attemptRecovery.predecessor.state.recovery.evidence.historyDigest = "f".repeat(64); },
      f => { f.archived.launchJournal.slots["paused-web"].instance.pid++; },
    ]) { const f = fixture(); f.state = copy(f.state); mutate(f); await reject(capturePrelaunchRecoveryBaseline(f.state, f.io)); }
    const f = fixture(); let touched = 0; const hostile = { ...f.state };
    Object.defineProperty(hostile, "runtime", { enumerable: true, get() { touched++; return f.state.runtime; } });
    await reject(capturePrelaunchRecoveryBaseline(hostile, f.io)); assert.equal(touched, 0);
    await reject(capturePrelaunchRecoveryBaseline(new Proxy(f.state, {}), f.io));
    await reject(capturePrelaunchRecoveryBaseline(f.state, { ...f.io, runtime: { ...f.io.runtime, pm2Control() { assert.fail(); } } }));
  });
  await t.test("actual deadline is enforced before and after observations; shape never authorizes extension", async () => {
    const f = fixture(), baseline = await capturePrelaunchRecoveryBaseline(f.state, f.io);
    assert.throws(() => validateMaintenanceBudgetRecoveryState(f.state, { bootId: BOOT, now: NOW }));
    assert.equal(f.state.budgetRecovery.authorization.expiresAt, Date.parse("2026-09-14T10:00:00Z"));
    assert.equal(f.archived.secondAttemptRecovery.authorization.expiresAt, Date.parse("2026-09-14T04:00:00Z"));
    assert.throws(() => validatePrelaunchRecoveryBaseline({ ...baseline, version: 1 }), /prelaunch_inspection_unverified/);
    for (const tooEarly of ["2026-09-14T10:00:00Z", "2026-09-14T15:00:31.999Z"]) {
      f.io.now = () => Date.parse(tooEarly); await reject(capturePrelaunchRecoveryBaseline(f.state, f.io));
    }
    f.io.now = () => Date.parse("2026-09-14T20:00:00Z"); await reject(capturePrelaunchRecoveryBaseline(f.state, f.io));
    let n = 0; f.io.now = () => ++n === 1 ? NOW : Date.parse("2026-09-14T20:00:00Z");
    await reject(capturePrelaunchRecoveryBaseline(f.state, f.io));
    n = 0; await reject(assertPrelaunchRecoveryGenerationsStopped(f.state, f.io));
    f.io.now = () => NOW - 1; await reject(verifyPrelaunchRecoveryBaseline(f.state, baseline, f.io));
  });

  await t.test("v10 reconstructs the exact failed v9 without changing audits and all real checks use the new clock", async () => {
    const f = fixture(), previous = JSON.stringify(f.state), oldAudit = JSON.stringify(f.state.budgetRecovery);
    await recover(f);
    assert.equal(f.state.version, 10); assert.equal(f.state.activeAttempt, 3);
    assert.equal(JSON.stringify(f.state.budgetRecovery), oldAudit);
    assert.equal(f.state.prelaunchRecovery.predecessor.state, undefined);
    assert.equal(f.state.prelaunchRecovery.predecessor.stateDigest, PRELAUNCH.stateDigest);
    assert.equal(f.state.prelaunchRecovery.stoppedBaseline.observedAt, NOW);
    const baseline = await capturePrelaunchRecoveryBaseline(f.state, f.io);
    assert.equal(await verifyPrelaunchRecoveryBaseline(f.state, baseline, f.io), true);
    assert.equal(await assertPrelaunchRecoveryStopped(f.state, f.io), true);
    assert.equal(await assertPrelaunchRecoveryGenerationsStopped(f.state, f.io), true);
    assert.equal(Object.keys(await readPrelaunchRecoveryHandoffFields(f.state.runtime, f.state, baseline, f.io)).length, 27);
    assert.equal(JSON.stringify(f.state.budgetRecovery), oldAudit);
    assert.notEqual(JSON.stringify(f.state), previous);
    f.io.now = () => PRELAUNCH_AUTH.expiresAt;
    await reject(assertPrelaunchRecoveryStopped(f.state, f.io));
    await reject(assertPrelaunchRecoveryGenerationsStopped(f.state, f.io));
  });
  await t.test("old baseline cannot be reused and all boundary clocks are real, including post-current read", async () => {
    const f = fixture();
    await reject(verifyPrelaunchRecoveryBaseline(f.state, f.state.budgetRecovery.stoppedBaseline, f.io));
    f.io.now = () => PRELAUNCH_AUTH.authorizedAt;
    assert.equal((await capturePrelaunchRecoveryBaseline(f.state, f.io)).observedAt, PRELAUNCH_AUTH.authorizedAt);
    f.io.now = () => PRELAUNCH_AUTH.expiresAt - 1;
    assert.equal((await capturePrelaunchRecoveryBaseline(f.state, f.io)).observedAt, PRELAUNCH_AUTH.expiresAt - 1);
    let now = NOW, currentReads = 0; f.io.now = () => now;
    f.io.readCurrent = () => { if (++currentReads === 2) now = PRELAUNCH_AUTH.expiresAt; return copy(f.current()); };
    await reject(capturePrelaunchRecoveryBaseline(f.state, f.io));
    assert.equal(currentReads, 2);
    assert.throws(() => validateMaintenancePrelaunchRecoveryPredecessor(f.state, { bootId: BOOT, now }));
  });
  await t.test("renewal may refresh only time, not re-anchor a same-target link or a different stable registry", async () => {
    for (const renewed of [false, true]) {
      const link = fixture(); if (renewed) await recover(link);
      link.io.readCurrent = () => ({ ...link.current(), linkIdentity: id(999, "link") });
      await reject(capturePrelaunchRecoveryBaseline(link.state, link.io));
      const registry = fixture(); if (renewed) await recover(registry);
      const runtime = APP + ".releases/ffffffffffff-20260914120000";
      const row = { name: "unrelated", pid: 501, pm_id: 501, pm2_env: { name: "unrelated", pm_id: 501, status: "online",
        created_at: 20000, pm_uptime: 20000, restart_time: 0, pm_cwd: runtime, pm_exec_path: runtime + "/node_modules/next/dist/bin/next",
        args: ["start", "-p", "3100"], node_args: [], exec_mode: "fork_mode", exec_interpreter: "/usr/bin/node", watch: false, cron_restart: null,
        autorestart: false, FAOLLA_BACKGROUND_JOBS_PAUSED: "1", nonce: "12345678-1234-4234-8234-123456789014", envDigest: "a".repeat(64) } };
      let reads = 0, currents = 0;
      registry.io.runtime.pm2Registry = async () => { reads++; return [copy(row)]; };
      registry.io.readCurrent = () => { currents++; return copy(registry.current()); };
      await reject(capturePrelaunchRecoveryBaseline(registry.state, registry.io));
      assert.equal(reads, 4); assert.equal(currents, 2);
    }
  });

  await t.test("read-only source cannot acquire locks or actuate and covers all historical candidates", () => {
    const source = readFileSync(new URL("./production-maintenance-prelaunch-inspection.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:stopRuntime|stopCandidate|controlPm2|writeFileSync|renameSync|unlinkSync|mkdirSync|spawnSync)\s*\(/);
    assert.match(source, /\[state\.attemptRecovery\.predecessor\.state, state\.secondAttemptRecovery\.predecessor\.state, state\]/);
    assert.match(source, /for \(const frozen of \[proof, \.\.\.projections\]\)/);
  });
});
