import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { buildMaintenanceRecoveredState, createMaintenanceRecoveryInspection } from "./production-maintenance-recovery.mjs";
import { buildMaintenanceContinuedState, createMaintenanceContinuationInspection } from "./production-maintenance-continuation.mjs";
import { MAINTENANCE_BUILD_RECOVERY_INCIDENT as BUILD, MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION as OLD_EXTENSION,
  MAINTENANCE_BUILD_RECOVERY_DEADLINE_EXTENSION_DIGEST as OLD_EXTENSION_DIGEST,
  MAINTENANCE_BUILD_RECOVERY_ADDITIONAL_BACKUP_SPEC_DIGEST, validateMaintenanceBuildRecoveryState } from "./production-maintenance-build-recovery.mjs";
import { createMaintenanceLaunchJournal, planMaintenanceLaunch, transitionMaintenanceLaunch } from "./production-maintenance-launch-journal.mjs";
import { MAINTENANCE_ATTEMPT_RECOVERY_INCIDENT as INCIDENT, createMaintenanceAttemptRecoveryInspection,
  buildMaintenanceAttemptRecoveredState, validateMaintenanceAttemptRecoveryState } from "./production-maintenance-attempt-recovery.mjs";
import { MAINTENANCE_SECOND_ATTEMPT_RECOVERY_INCIDENT as SECOND,
  createMaintenanceSecondAttemptRecoveryInspection, buildMaintenanceSecondAttemptRecoveredState,
  validateMaintenanceSecondAttemptRecoveryState } from "./production-maintenance-second-attempt-recovery.mjs";
import { MAINTENANCE_BUDGET_RECOVERY_INCIDENT as BUDGET, MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION as AUTH,
  MAINTENANCE_BUDGET_RECOVERY_AUTHORIZATION_DIGEST as AUTH_DIGEST,
  createMaintenanceBudgetRecoveryInspection, validateMaintenanceBudgetRecoveryInspection,
  validateMaintenanceBudgetRecoveryEvidence, encodeMaintenanceBudgetRecoveryEvidence, decodeMaintenanceBudgetRecoveryEvidence,
  validateMaintenanceBudgetRecoveryPredecessor, buildMaintenanceBudgetRecoveredState,
  validateMaintenanceBudgetRecoveryState, assertMaintenanceBudgetRecoveryProgress } from "./production-maintenance-budget-recovery.mjs";

const originalCreateHash = crypto.createHash;
const hash = value => originalCreateHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => structuredClone(value);
const NOW = Date.parse("2026-09-14T07:20:00.000Z"), TARGET = "a".repeat(40), ID = "1:2:3:4:5:1:0:33188";
const clock = (now = NOW) => ({ bootId: INCIDENT.bootId, now });
const reject = action => assert.throws(action, error => error.message === "maintenance_budget_recovery_invalid" && error.cause === undefined);
const RUN_KEYS = ["backupRunId", "backupRunAttempt", "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt", "failedDeployRunId", "failedDeployRunAttempt"];
const daemon = { pid: 100, parentPid: 1, uid: 0, startTicks: "50", processIdentity: ID, cwd: "/", cwdIdentity: ID,
  executable: "/usr/bin/node", executableIdentity: ID, commandLineDigest: "b".repeat(64) };
function launch(state, nonce = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee") {
  const disk = { runtime: `${state.appDir}.releases/${state.targetSha.slice(0, 12)}-20260913200000`, runtimeIdentity: ID, nextBuildDigest: "c".repeat(64) };
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
    pm2: { pmId: instance.pmId, createdAt: 1, pmUptime: 1, restartTime: 0, metadataHash: instance.metadataDigest } };
  return { launchDisk: disk, launchJournal: journal,
    candidate: { version: 1, targetSha: state.targetSha, pauseExpected: "1", disk, environment: { fixture: true }, daemon: copy(daemon), web } };
}
function syntheticPredecessor() {
  const initial = { version: 2, revision: 3, operationId: INCIDENT.operationId, targetSha: BUILD.originalTargetSha,
    expectedOldSha: INCIDENT.expectedOldSha, appDir: "/srv/faolla", appName: "faolla", appPort: 3000, bootId: INCIDENT.bootId,
    createdAt: INCIDENT.createdAt, phase: "failed-held", runtime: { daemon: copy(daemon) }, ingress: { fixture: true }, database: { fixture: true },
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

// Only these THREE exact synthetic JSON byte strings map to the incident pins.
// No real private state, wildcard hash mapping or production injection exists.
test("one separately authorized budget attempt preserves the whole expired v7 chain", { concurrency: false }, async t => {
  const seed = syntheticPredecessor(), mappings = new Map([[JSON.stringify(seed), INCIDENT.stateDigest]]);
  t.mock.method(crypto, "createHash", (algorithm, options) => {
    const result = originalCreateHash(algorithm, options), chunks = [], update = result.update.bind(result), digest = result.digest.bind(result);
    result.update = (value, encoding) => { chunks.push(Buffer.from(value, encoding)); update(value, encoding); return result; };
    result.digest = encoding => {
      const actual = digest(encoding), bytes = Buffer.concat(chunks);
      if (algorithm === "sha256" && encoding === "hex") {
        for (const [input, expected] of mappings) if (bytes.equals(Buffer.from(input))) return expected;
      }
      return actual;
    };
    return result;
  }); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); assert.equal(crypto.createHash, originalCreateHash); assert.notEqual(hash(seed), INCIDENT.stateDigest); });
  const v6 = syntheticV6(seed); mappings.set(JSON.stringify(v6), SECOND.stateDigest);
  const predecessor = syntheticV7(v6); mappings.set(JSON.stringify(predecessor), BUDGET.stateDigest);
  const fixture = () => {
    const state = copy(predecessor), context = { operationId: BUDGET.operationId, previousTargetSha: BUDGET.previousTargetSha, targetSha: TARGET,
      expectedOldSha: BUDGET.expectedOldSha, expectedRevision: 31, expectedDigest: BUDGET.stateDigest, bootId: BUDGET.bootId, now: NOW,
      sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline: baseline(state, 3, NOW, BUDGET.stateDigest) };
    const inspection = createMaintenanceBudgetRecoveryInspection(state, context);
    const evidence = { ...inspection, toolsSha: TARGET, budgetRecoveryRunId: "34800000001", budgetRecoveryRunAttempt: 1,
      mainCIrunId: "34800000000", historyDigest: "d".repeat(64), historyCheckedAt: NOW - 1000 };
    return { state, context, inspection, evidence };
  };
  const build = f => buildMaintenanceBudgetRecoveredState(f.state, f.evidence, f.context);
  const nextState = previous => ({ ...copy(previous), revision: previous.revision + 1 });
  function journalSteps(initial) {
    const launched = { ...copy(initial), ...launch(initial, "99999999-2222-4333-8444-555555555555") }, binding = {
      operationId: initial.operationId, targetSha: initial.targetSha, appName: initial.appName, appPort: initial.appPort,
      daemon: launched.launchJournal.daemon, release: launched.launchJournal.release };
    let state = { ...nextState(initial), launchDisk: launched.launchDisk, launchJournal: createMaintenanceLaunchJournal(binding) };
    assertMaintenanceBudgetRecoveryProgress(initial, state);
    const saved = [state];
    const slot = launched.launchJournal.slots["paused-web"];
    let journal = planMaintenanceLaunch(state.launchJournal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, environmentDigest: slot.environmentDigest });
    let next = { ...nextState(state), launchJournal: journal }; assertMaintenanceBudgetRecoveryProgress(state, next); saved.push(next); state = next;
    journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "attempted" });
    next = { ...nextState(state), launchJournal: journal }; assertMaintenanceBudgetRecoveryProgress(state, next); saved.push(next); state = next;
    journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "confirmed",
      observation: { ...binding, role: "paused-web", sequence: 1, observedNonce: slot.nonce, environmentDigest: slot.environmentDigest, instance: slot.instance } });
    next = { ...nextState(state), launchJournal: journal }; assertMaintenanceBudgetRecoveryProgress(state, next); saved.push(next); state = next;
    next = { ...nextState(state), candidate: launched.candidate, phase: "candidate" }; assertMaintenanceBudgetRecoveryProgress(state, next); saved.push(next);
    return { saved, candidate: next, launched };
  }

  await t.test("exact pins, raw mapping and original protocol remain intact", () => {
    assert.equal(BUDGET.stateDigest, "a7767b3e1e5a788282c16a57a91ed588821cb0b5894925fcff9d5e544e5d6003");
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(predecessor)).digest("hex"), BUDGET.stateDigest);
    assert.notEqual(hash(predecessor), BUDGET.stateDigest);
    assert.equal(crypto.createHash("sha256").update("unrelated").digest("hex"), originalCreateHash("sha256").update("unrelated").digest("hex"));
    assert.equal(crypto.createHash("sha512").update(JSON.stringify(predecessor)).digest("hex"), originalCreateHash("sha512").update(JSON.stringify(predecessor)).digest("hex"));
    assert.throws(() => validateMaintenanceSecondAttemptRecoveryState(predecessor, clock()));
    validateMaintenanceSecondAttemptRecoveryState(predecessor, clock(predecessor.secondAttemptRecovery.recoveredAt));
    assert.equal(Buffer.byteLength(JSON.stringify(predecessor)), 785807);
    assert.equal(AUTH_DIGEST, hash(AUTH)); assert(Object.isFrozen(AUTH)); assert(Object.isFrozen(BUDGET));
  });
  await t.test("inspection is typed, private, actual T7 baseline and not transition authority", () => {
    const f = fixture(); assert.equal(f.inspection.state, "budget-recovery-inspected"); assert.equal(f.inspection.activeAttempt, 3);
    assert.equal(f.inspection.stoppedBaseline.version, 3); assert.equal(f.inspection.predecessorJournalDigest, hash(f.state.launchJournal));
    assert.deepEqual(validateMaintenanceBudgetRecoveryInspection(f.inspection), f.inspection);
    assert(!JSON.stringify(f.inspection).includes(f.state.launchJournal.slots["paused-web"].nonce));
  });
  await t.test("one builder produces v8 rev32, complete v7 predecessor, active attempt3", () => {
    const f = fixture(), next = build(f); assert.equal(next.version, 8); assert.equal(next.revision, 32); assert.equal(next.activeAttempt, 3); assert.equal(next.phase, "held");
    for (const key of ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"]) assert.equal(next[key], null);
    assert.deepEqual(next.budgetRecovery.predecessor.state, predecessor); assert.equal(next.budgetRecovery.predecessor.stateDigest, BUDGET.stateDigest);
    assert.deepEqual(next.attemptRecovery, predecessor.attemptRecovery);
    assert.deepEqual(next.secondAttemptRecovery, predecessor.secondAttemptRecovery);
    for (const key of ["recovery", "continuation", "buildRecovery", "deadlineExtension", "runtime", "database", "ingress", "createdAt", "bootId", "tokenHash", "expectedOldSha"])
      assert.deepEqual(next[key], predecessor[key]);
    assert(Object.isFrozen(next.budgetRecovery.predecessor.state.launchJournal.slots));
    assertMaintenanceBudgetRecoveryProgress(f.state, next);
    assert.deepEqual(f.state, predecessor);
  });
  await t.test("new real 07-to-10UTC authority, old 04UTC permission remains expired", () => {
    const f = fixture(), next = build(f);
    for (const now of [AUTH.authorizedAt - 1, AUTH.previousExpiresAt, AUTH.expiresAt, AUTH.expiresAt + 1]) {
      reject(() => validateMaintenanceBudgetRecoveryPredecessor(f.state, clock(now)));
      reject(() => validateMaintenanceBudgetRecoveryState(next, clock(now)));
    }
    assert.equal(AUTH.previousExpiresAt, predecessor.attemptRecovery.deadlineAuthorization.expiresAt);
    assert.equal(predecessor.secondAttemptRecovery.authorization.expiresAt, AUTH.previousExpiresAt);
    assert.equal(AUTH.expiresAt, Date.parse("2026-09-14T10:00:00Z"));
    assert.throws(() => validateMaintenanceSecondAttemptRecoveryState(predecessor, clock()));
    assert.equal(AUTH.authorizedAt, Date.parse("2026-09-14T07:13:57Z"));
    assert.equal(validateMaintenanceBudgetRecoveryState(next, clock(AUTH.expiresAt - 1)).version, 8);
  });
  await t.test("only exact failed v7/31/a776 can recover, with consumed paused-web retained", () => {
    for (const patch of [{ version: 6 }, { version: 8 }, { activeAttempt: 1 }, { activeAttempt: 3 }, { revision: 30 }, { revision: 32 },
      { phase: "held" }, { phase: "failed-unknown" }, { candidate: null }, { launchDisk: null }, { launchJournal: null }, { resumed: {} }, { finalDump: {} },
      { targetSha: TARGET }, { createdAt: predecessor.createdAt + 1 }, { tokenHash: "0".repeat(64) }])
      reject(() => validateMaintenanceBudgetRecoveryPredecessor({ ...copy(predecessor), ...patch }, clock()));
  });
  await t.test("CAS and exact source/migration context cannot drift", () => {
    for (const patch of [{ expectedDigest: "0".repeat(64) }, { expectedRevision: 32 }, { previousTargetSha: TARGET }, { bootId: "x" },
      { operationId: "x" }, { expectedOldSha: TARGET }, { sourceDiffDigest: "bad" }, { migrationDigest: "bad" }, { extra: 1 }]) {
      const f = fixture(); reject(() => createMaintenanceBudgetRecoveryInspection(f.state, { ...f.context, ...patch }));
    }
    for (const targetSha of [BUDGET.previousTargetSha, BUDGET.expectedOldSha, SECOND.previousTargetSha, INCIDENT.previousTargetSha, BUILD.originalTargetSha, BUILD.recoveredTargetSha, BUILD.previousTargetSha, "13df917416cf06ce27fce021460b08caf50f6165"]) {
      const f = fixture(); reject(() => createMaintenanceBudgetRecoveryInspection(f.state, { ...f.context, targetSha }));
    }
  });
  await t.test("old audit time is not a caller-controlled current clock or extra grant", () => {
    const f = fixture(), next = build(f), historicalAuditClock = predecessor.secondAttemptRecovery.recoveredAt;
    reject(() => validateMaintenanceBudgetRecoveryPredecessor(predecessor, clock(historicalAuditClock)));
    reject(() => validateMaintenanceBudgetRecoveryPredecessor(predecessor, { ...clock(), historicalAuditClock }));
    reject(() => createMaintenanceBudgetRecoveryInspection(predecessor, { ...f.context, historicalAuditClock }));
    reject(() => validateMaintenanceBudgetRecoveryState(next, { ...clock(), historicalAuditClock }));
    for (const key of ["authorizedAt", "previousExpiresAt", "expiresAt", "previousActiveAttempt", "activeAttempt", "maximumAdditionalAttempts"]) {
      const changed = copy(next); changed.budgetRecovery.authorization[key]++;
      reject(() => validateMaintenanceBudgetRecoveryState(changed, clock()));
    }
    assert.deepEqual(next.secondAttemptRecovery.authorization, predecessor.secondAttemptRecovery.authorization);
    assert.equal(next.createdAt, predecessor.createdAt);
    assert.equal(validateMaintenanceBudgetRecoveryState(next, clock(AUTH.expiresAt - 1)).version, 8);
  });
  await t.test("exact canonical predecessor byte length and all three private mappings are bounded", () => {
    assert.equal(mappings.size, 3);
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(seed)).digest("hex"), INCIDENT.stateDigest);
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(v6)).digest("hex"), SECOND.stateDigest);
    const shortened = copy(predecessor); shortened.ingress.padding = shortened.ingress.padding.slice(1);
    assert.equal(Buffer.byteLength(JSON.stringify(shortened)), BUDGET.stateBytes - 1);
    reject(() => validateMaintenanceBudgetRecoveryPredecessor(shortened, clock()));
    const reordered = Object.fromEntries(Object.entries(predecessor).reverse());
    reject(() => validateMaintenanceBudgetRecoveryPredecessor(reordered, clock()));
    const f = fixture();
    for (const id of ["34800461043", "34799821827", "34800653808", "34802075500", "34802138869"])
      for (const key of ["budgetRecoveryRunId", "mainCIrunId"])
        reject(() => validateMaintenanceBudgetRecoveryEvidence({ ...f.evidence, [key]: id }));
  });
  await t.test("baseline binds complete files/proofs, current T7 and fresh time", () => {
    for (const mutate of [b => b.version = 2, b => b.stateDigest = INCIDENT.stateDigest, b => b.current.target = seed.launchDisk.runtime,
      b => b.current.runtimeIdentity = "2:2:3:4:5:1:0:33188", b => b.current.linkIdentity = "1:2", b => b.observedAt = NOW + 1,
      b => b.observedAt = NOW - 300001, ...["candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest"].map(key => b => b[key] = "0".repeat(64))]) {
      const f = fixture(); mutate(f.context.stoppedBaseline); reject(() => createMaintenanceBudgetRecoveryInspection(f.state, f.context));
    }
  });
  await t.test("fixed B7/R7/D7/M/authorization and new CI/recovery run cannot be relabelled", () => {
    for (const patch of [{ toolsSha: BUDGET.previousTargetSha }, { budgetRecoveryRunAttempt: 2 }, { budgetRecoveryRunId: "34789744074" },
      { mainCIrunId: "34789133814" }, { mainCIrunId: "34800000001" }, { activeAttempt: 1 }, { authorizationDigest: "0".repeat(64) },
      { historyCheckedAt: AUTH.authorizedAt - 1 }, { historyCheckedAt: AUTH.expiresAt }, ...RUN_KEYS.map(key => ({ [key]: key.endsWith("Id") ? "999" : 2 }))])
      reject(() => validateMaintenanceBudgetRecoveryEvidence({ ...fixture().evidence, ...patch }));
    for (const key of ["sourceDiffDigest", "migrationDigest", "predecessorJournalDigest", "stoppedBaselineDigest"]) {
      const f = fixture(); f.evidence[key] = "0".repeat(64); reject(() => build(f));
    }
  });
  await t.test("final actual clock enforces fresh grant and baseline independently", () => {
    for (const patch of [{ now: NOW + 300000 }, { now: AUTH.expiresAt }, { now: NOW - 1001 }]) { const f = fixture(); Object.assign(f.context, patch); reject(() => build(f)); }
    const f = fixture(); f.evidence.historyCheckedAt = NOW + 1; reject(() => build(f));
  });
  await t.test("canonical bounded codec rejects duplicates, reordering, padding, UTF8 and hidden input", () => {
    const f = fixture(), encoded = encodeMaintenanceBudgetRecoveryEvidence(f.evidence), text = Buffer.from(encoded, "base64url").toString("utf8");
    assert.deepEqual(decodeMaintenanceBudgetRecoveryEvidence(encoded), validateMaintenanceBudgetRecoveryEvidence(f.evidence));
    for (const input of [encoded + "=", " " + encoded, "a".repeat(16385), Buffer.from([255]).toString("base64url"),
      Buffer.from(text.replace('"version":1', '"version":1,"version":1')).toString("base64url"),
      Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(f.evidence).reverse()))).toString("base64url")])
      reject(() => decodeMaintenanceBudgetRecoveryEvidence(input));
    let touches = 0;
    const getter = { ...f.evidence }; Object.defineProperty(getter, "toolsSha", { enumerable: true, get() { touches++; return TARGET; } });
    reject(() => validateMaintenanceBudgetRecoveryEvidence(getter));
    reject(() => validateMaintenanceBudgetRecoveryEvidence(new Proxy(f.evidence, { ownKeys() { touches++; return []; } })));
    assert.equal(touches, 0);
    for (const extra of [undefined, NaN, -0, "x".repeat(4 * 1024 * 1024)]) reject(() => validateMaintenanceBudgetRecoveryEvidence({ ...f.evidence, extra }));
    const hidden = copy(f.evidence); Object.defineProperty(hidden, "hidden", { value: 1 }); reject(() => validateMaintenanceBudgetRecoveryEvidence(hidden));
  });
  await t.test("all three archived attempts and all top-level audits remain immutable on every writer", () => {
    const first = build(fixture());
    for (const mutate of [s => s.budgetRecovery.predecessor.state.launchJournal = null,
      s => s.budgetRecovery.predecessor.state.attemptRecovery.predecessor.state.candidate = null,
      s => s.budgetRecovery.authorization.expiresAt++, s => s.budgetRecovery.evidence.historyDigest = "0".repeat(64),
      s => s.budgetRecovery.stoppedBaseline.pm2RegistryDigest = "0".repeat(64),
      s => s.attemptRecovery.predecessor.stateDigest = "0".repeat(64),
      s => s.secondAttemptRecovery.predecessor.state.launchJournal.slots["paused-web"].nonce = "99999999-2222-4333-8444-555555555555", s => s.recovery.extra = 1, s => s.continuation.extra = 1,
      s => s.buildRecovery.extra = 1, s => s.deadlineExtension.expiresAt++, s => s.createdAt++, s => s.targetSha = "b".repeat(40), s => s.activeAttempt = 4]) {
      const next = nextState(first); mutate(next); reject(() => assertMaintenanceBudgetRecoveryProgress(first, next));
    }
  });
  await t.test("every active journal transition is enforced, no null-to-confirmed jump", () => {
    const initial = build(fixture()), { candidate, launched, saved } = journalSteps(initial);
    assert.equal(candidate.phase, "candidate"); assert.equal(candidate.launchJournal.slots["paused-web"].phase, "confirmed");
    reject(() => assertMaintenanceBudgetRecoveryProgress(initial, { ...launched, revision: 33, phase: "candidate" }));
    reject(() => assertMaintenanceBudgetRecoveryProgress(saved[0], { ...copy(saved[3]), revision: saved[0].revision + 1 }));
    reject(() => assertMaintenanceBudgetRecoveryProgress(candidate, { ...nextState(candidate), launchJournal: null }));
    reject(() => assertMaintenanceBudgetRecoveryProgress(candidate, { ...nextState(candidate), candidate: null, phase: "failed-held" }));
  });
  await t.test("nonce collisions with ANY of three archived attempts are rejected", () => {
    const initial = build(fixture());
    for (const nonce of [seed.launchJournal.slots["paused-web"].nonce, v6.launchJournal.slots["paused-web"].nonce, predecessor.launchJournal.slots["paused-web"].nonce]) {
      const collision = { ...nextState(initial), ...launch(initial, nonce), phase: "candidate" };
      reject(() => validateMaintenanceBudgetRecoveryState(collision, clock()));
    }
  });
  await t.test("failed attempt3 is terminal and cannot append another attempt", () => {
    const { candidate } = journalSteps(build(fixture())), failed = { ...nextState(candidate), phase: "failed-held" };
    assertMaintenanceBudgetRecoveryProgress(candidate, failed);
    for (const phase of ["held", "candidate", "resuming", "ended"])
      reject(() => assertMaintenanceBudgetRecoveryProgress(failed, { ...nextState(failed), phase }));
    reject(() => buildMaintenanceBudgetRecoveredState(failed, fixture().evidence, fixture().context));
    reject(() => assertMaintenanceBudgetRecoveryProgress(failed, { ...nextState(failed), version: 9, activeAttempt: 4 }));
  });
  await t.test("all legacy v7 structural transitions delegate unchanged, but cannot smuggle v8 audit", () => {
    const next = nextState(predecessor); assertMaintenanceBudgetRecoveryProgress(predecessor, next);
    assert.throws(() => assertMaintenanceBudgetRecoveryProgress(predecessor, { ...next, phase: "held" }));
    reject(() => assertMaintenanceBudgetRecoveryProgress(predecessor, { ...next, budgetRecovery: {} }));
    const initial = build(fixture()); reject(() => assertMaintenanceBudgetRecoveryProgress(initial, { ...nextState(initial), version: 7 }));
  });
});
