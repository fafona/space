import { validateRuntimeProof, validateCandidateProof, validateResumedDumpProof } from "../production-maintenance-runtime.mjs";
import { pm2RegistryDigest } from "../production-maintenance-pm2-adapter.mjs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { buildMaintenanceRecoveredState, createMaintenanceRecoveryInspection } from "../production-maintenance-recovery.mjs";
import { buildMaintenanceContinuedState, createMaintenanceContinuationInspection } from "../production-maintenance-continuation.mjs";
import { MAINTENANCE_BUILD_RECOVERY_INCIDENT as BUILD, MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION as OLD_EXTENSION,
  MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION_DIGEST as OLD_EXTENSION_DIGEST,
  MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP_SPEC_DIGEST, validateMaintenanceBuildRecoveryState } from "../production-maintenance-build-recovery.mjs";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "../production-maintenance-launch-journal.mjs";
import { MAINTENANCE_ATTEMPT_RECOVERY_INCIDENT as INCIDENT, createMaintenanceAttemptRecoveryInspection,
  buildMaintenanceAttemptRecoveredState, validateMaintenanceAttemptRecoveryState } from "../production-maintenance-attempt-recovery.mjs";
import { MAINTENANCE_SECOND_ATTEMPT_RECOVERY_INCIDENT as SECOND, createMaintenanceSecondAttemptRecoveryInspection,
  buildMaintenanceSecondAttemptRecoveredState, validateMaintenanceSecondAttemptRecoveryState } from "../production-maintenance-second-attempt-recovery.mjs";
import { MAINTENANCE_BUDGET_RECOVERY_INCIDENT as BUDGET, MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION as AUTH,
  createMaintenanceBudgetRecoveryInspection, buildMaintenanceBudgetRecoveredState, validateMaintenanceBudgetRecoveryState } from "../production-maintenance-budget-recovery.mjs";
import { MAINTENANCE_WINDOW_RENEWAL_INCIDENT as WINDOW, createMaintenanceWindowRenewalInspection,
  buildMaintenanceWindowRenewedState, assertMaintenanceWindowRenewalProgress } from "../production-maintenance-window-renewal.mjs";

/** TEST ONLY. Fake host proof objects are not production evidence. Exactly four
 * complete synthetic byte strings alone map to historical pins while this
 * awaited callback runs. All other hashes remain real and hooks are restored.
 * No tests are registered here and no production validator has an override. */
const originalCreateHash = crypto.createHash;
const hash = value => originalCreateHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => structuredClone(value);
const NOW = Date.parse("2026-09-14T12:40:00.000Z"), TARGET = "a".repeat(40), ID = "1:2:3:4:5:1:0:33188";
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


function baseline(state, version, now, stateDigest) {
  return { version, stateDigest, candidateDigest: hash(state.candidate), launchDiskDigest: hash(state.launchDisk),
    launchJournalDigest: hash(state.launchJournal), runtimeDigest: hash(state.runtime),
    current: { target: state.launchDisk.runtime, linkIdentity: ID, runtimeIdentity: ID }, bootId: state.bootId,
    pm2RegistryDigest: "a".repeat(64), observedAt: now - 1000 };
}
function syntheticV6(seed) {
  const now = Date.parse("2026-09-13T23:29:37Z"), context = { operationId: INCIDENT.operationId, previousTargetSha: INCIDENT.previousTargetSha,
    targetSha: SECOND.previousTargetSha, expectedOldSha: INCIDENT.expectedOldSha, expectedRevision: 15, expectedDigest: INCIDENT.stateDigest,
    bootId: INCIDENT.bootId, now, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64),
    stoppedBaseline: baseline(seed, 1, now, INCIDENT.stateDigest) };
  const evidence = { ...createMaintenanceAttemptRecoveryInspection(seed, context), toolsSha: context.targetSha,
    attemptRecoveryRunId: "34789744074", attemptRecoveryRunAttempt: 1, mainCIrunId: "34789133814",
    historyDigest: "d".repeat(64), historyCheckedAt: now - 1000 };
  const state = copy(buildMaintenanceAttemptRecoveredState(seed, evidence, context));
  state.phase = "failed-held"; state.revision = 23;
  Object.assign(state, launch(state, "11111111-2222-4333-8444-555555555555"));
  validateMaintenanceAttemptRecoveryState(state, clock(Date.parse("2026-09-14T02:05:00Z")));
  return state;
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
  // Pure tests have deliberately synthetic ingress, not a host-proof fixture.
  // Padding fixes the exact public byte-length anchor; it is not real state.
  state.ingress.padding = "";
  const remaining = BUDGET.stateBytes - Buffer.byteLength(JSON.stringify(state));
  assert(remaining > 0); state.ingress.padding = "x".repeat(remaining);
  assert.equal(Buffer.byteLength(JSON.stringify(state)), BUDGET.stateBytes);
  validateMaintenanceSecondAttemptRecoveryState(state, clock(now));
  return state;
}


function syntheticV8(seed) {
  const now = Date.parse("2026-09-14T09:07:20Z"), context = { operationId: WINDOW.operationId, previousTargetSha: BUDGET.previousTargetSha,
    targetSha: WINDOW.previousTargetSha, expectedOldSha: WINDOW.expectedOldSha, expectedRevision: 31, expectedDigest: BUDGET.stateDigest,
    bootId: WINDOW.bootId, now, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64),
    stoppedBaseline: baseline(seed, 3, now, BUDGET.stateDigest) };
  const evidence = { ...createMaintenanceBudgetRecoveryInspection(seed, context), toolsSha: context.targetSha,
    budgetRecoveryRunId: WINDOW.priorRecoveryRunId, budgetRecoveryRunAttempt: 1, mainCIrunId: WINDOW.priorMainCIrunId,
    historyDigest: "d".repeat(64), historyCheckedAt: now - 1000 };
  const state = copy(buildMaintenanceBudgetRecoveredState(seed, evidence, context));
  // Fixture-only inert ingress bytes fix the public raw length; there is NO
  // real private state and this padding is not a valid production ingress proof.
  state.ingress.padding = "";
  const remaining = WINDOW.stateBytes - Buffer.byteLength(JSON.stringify(state));
  assert(remaining > 0); state.ingress.padding = "y".repeat(remaining);
  validateMaintenanceBudgetRecoveryState(state, clock(now));
  return state;
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


export async function withWindowRenewalFixture(t, action) {
  const seed = syntheticPredecessor(), mappings = new Map([[JSON.stringify(seed), INCIDENT.stateDigest]]);
  t.mock.method(crypto, "createHash", (algorithm, options) => {
    const result = originalCreateHash(algorithm, options), chunks = [], update = result.update.bind(result), digest = result.digest.bind(result);
    result.update = (value, encoding) => { chunks.push(Buffer.from(value, encoding)); update(value, encoding); return result; };
    result.digest = encoding => {
      const actual = digest(encoding), bytes = Buffer.concat(chunks);
      if (algorithm === "sha256" && encoding === "hex")
        for (const [input, expected] of mappings) if (bytes.equals(Buffer.from(input))) return expected;
      return actual;
    };
    return result;
  }); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); assert.equal(crypto.createHash, originalCreateHash);
    for (const [bytes, expected] of mappings) assert.notEqual(originalCreateHash("sha256").update(bytes).digest("hex"), expected); });
  const v6 = syntheticV6(seed); mappings.set(JSON.stringify(v6), SECOND.stateDigest);
  const v7 = syntheticV7(v6); mappings.set(JSON.stringify(v7), BUDGET.stateDigest);
  const predecessor = syntheticV8(v7); mappings.set(JSON.stringify(predecessor), WINDOW.stateDigest);
  for (const historical of [seed, v6, v7, predecessor]) {
    validateRuntimeProof(historical.runtime);
    if (historical.candidate) validateCandidateProof(historical.candidate, historical.runtime);
  }
  const fixture = () => {
    const state = copy(predecessor), context = { operationId: WINDOW.operationId, previousTargetSha: WINDOW.previousTargetSha, targetSha: TARGET,
      expectedOldSha: WINDOW.expectedOldSha, expectedRevision: 32, expectedDigest: WINDOW.stateDigest, bootId: WINDOW.bootId, now: NOW,
      sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64),
      stoppedBaseline: baseline(state.budgetRecovery.predecessor.state, 3, NOW, BUDGET.stateDigest) };
    const inspection = createMaintenanceWindowRenewalInspection(state, context);
    const evidence = { ...inspection, toolsSha: TARGET, windowRenewalRunId: "34850000001", windowRenewalRunAttempt: 1,
      mainCIrunId: "34850000000", historyDigest: "d".repeat(64), historyCheckedAt: NOW - 1000 };
    return { state, context, inspection, evidence };
  };
  const build = f => buildMaintenanceWindowRenewedState(f.state, f.evidence, f.context);
  const nextState = previous => ({ ...copy(previous), revision: previous.revision + 1 });
  function journalSteps(initial) {
    const launched = { ...copy(initial), ...launch(initial, "99999999-2222-4333-8444-555555555555") }, binding = {
      operationId: initial.operationId, targetSha: initial.targetSha, appName: initial.appName, appPort: initial.appPort,
      daemon: launched.launchJournal.daemon, release: launched.launchJournal.release };
    let state = { ...nextState(initial), launchDisk: launched.launchDisk, launchJournal: createMaintenanceLaunchJournal(binding) };
    assertMaintenanceWindowRenewalProgress(initial, state);
    const saved = [state], slot = launched.launchJournal.slots["paused-web"];
    let journal = planMaintenanceLaunch(state.launchJournal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, environmentDigest: slot.environmentDigest });
    let next = { ...nextState(state), launchJournal: journal }; assertMaintenanceWindowRenewalProgress(state, next); saved.push(next); state = next;
    journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "attempted" });
    next = { ...nextState(state), launchJournal: journal }; assertMaintenanceWindowRenewalProgress(state, next); saved.push(next); state = next;
    journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "confirmed",
      observation: { ...binding, role: "paused-web", sequence: 1, observedNonce: slot.nonce, environmentDigest: slot.environmentDigest, instance: slot.instance } });
    next = { ...nextState(state), launchJournal: journal }; assertMaintenanceWindowRenewalProgress(state, next); saved.push(next); state = next;
    next = { ...nextState(state), candidate: launched.candidate, phase: "candidate" }; assertMaintenanceWindowRenewalProgress(state, next); saved.push(next);
    return { saved, candidate: next, launched };
  }

  return await action({ seed, v6, v7, predecessor, mappings, fixture, build, nextState, journalSteps, hash, copy, clock, launch, syntheticDump, makeDisk, makeEnvironment, originalRuntime, daemon, originalCreateHash, INCIDENT, SECOND, BUDGET, AUTH, NOW, TARGET });
}
