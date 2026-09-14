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
import { MAINTENANCE_SECOND_ATTEMPT_RECOVERY_INCIDENT as SECOND, MAINTENANCE_SECOND_ATTEMPT_RECOVERY_AUTHORIZATION as AUTH,
  MAINTENANCE_SECOND_ATTEMPT_RECOVERY_AUTHORIZATION_DIGEST as AUTH_DIGEST,
  createMaintenanceSecondAttemptRecoveryInspection, validateMaintenanceSecondAttemptRecoveryInspection,
  validateMaintenanceSecondAttemptRecoveryEvidence, encodeMaintenanceSecondAttemptRecoveryEvidence, decodeMaintenanceSecondAttemptRecoveryEvidence,
  validateMaintenanceSecondAttemptRecoveryPredecessor, buildMaintenanceSecondAttemptRecoveredState,
  validateMaintenanceSecondAttemptRecoveryState, assertMaintenanceSecondAttemptRecoveryProgress } from "./production-maintenance-second-attempt-recovery.mjs";

const originalCreateHash = crypto.createHash;
const hash = value => originalCreateHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => structuredClone(value);
const NOW = Date.parse("2026-09-14T02:05:00.000Z"), TARGET = "a".repeat(40), ID = "1:2:3:4:5:1:0:33188";
const clock = (now = NOW) => ({ bootId: INCIDENT.bootId, now });
const reject = action => assert.throws(action, error => error.message === "maintenance_second_attempt_recovery_invalid" && error.cause === undefined);
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
  validateMaintenanceAttemptRecoveryState(state, clock());
  return state;
}

// Only these TWO exact synthetic JSON byte strings map to the incident pins.
// No real private state, wildcard hash mapping or production injection exists.
test("one separately authorized second attempt preserves the whole v6 chain", { concurrency: false }, async t => {
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
  const predecessor = syntheticV6(seed); mappings.set(JSON.stringify(predecessor), SECOND.stateDigest);
  const fixture = () => {
    const state = copy(predecessor), context = { operationId: SECOND.operationId, previousTargetSha: SECOND.previousTargetSha, targetSha: TARGET,
      expectedOldSha: SECOND.expectedOldSha, expectedRevision: 23, expectedDigest: SECOND.stateDigest, bootId: SECOND.bootId, now: NOW,
      sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline: baseline(state, 2, NOW, SECOND.stateDigest) };
    const inspection = createMaintenanceSecondAttemptRecoveryInspection(state, context);
    const evidence = { ...inspection, toolsSha: TARGET, secondAttemptRecoveryRunId: "34800000001", secondAttemptRecoveryRunAttempt: 1,
      mainCIrunId: "34800000000", historyDigest: "d".repeat(64), historyCheckedAt: NOW - 1000 };
    return { state, context, inspection, evidence };
  };
  const build = f => buildMaintenanceSecondAttemptRecoveredState(f.state, f.evidence, f.context);
  const nextState = previous => ({ ...copy(previous), revision: previous.revision + 1 });
  function journalSteps(initial) {
    const launched = { ...copy(initial), ...launch(initial, "99999999-2222-4333-8444-555555555555") }, binding = {
      operationId: initial.operationId, targetSha: initial.targetSha, appName: initial.appName, appPort: initial.appPort,
      daemon: launched.launchJournal.daemon, release: launched.launchJournal.release };
    let state = { ...nextState(initial), launchDisk: launched.launchDisk, launchJournal: createMaintenanceLaunchJournal(binding) };
    assertMaintenanceSecondAttemptRecoveryProgress(initial, state);
    const saved = [state];
    const slot = launched.launchJournal.slots["paused-web"];
    let journal = planMaintenanceLaunch(state.launchJournal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, environmentDigest: slot.environmentDigest });
    let next = { ...nextState(state), launchJournal: journal }; assertMaintenanceSecondAttemptRecoveryProgress(state, next); saved.push(next); state = next;
    journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "attempted" });
    next = { ...nextState(state), launchJournal: journal }; assertMaintenanceSecondAttemptRecoveryProgress(state, next); saved.push(next); state = next;
    journal = transitionMaintenanceLaunch(journal, binding, { role: "paused-web", sequence: 1, nonce: slot.nonce, phase: "confirmed",
      observation: { ...binding, role: "paused-web", sequence: 1, observedNonce: slot.nonce, environmentDigest: slot.environmentDigest, instance: slot.instance } });
    next = { ...nextState(state), launchJournal: journal }; assertMaintenanceSecondAttemptRecoveryProgress(state, next); saved.push(next); state = next;
    next = { ...nextState(state), candidate: launched.candidate, phase: "candidate" }; assertMaintenanceSecondAttemptRecoveryProgress(state, next); saved.push(next);
    return { saved, candidate: next, launched };
  }

  await t.test("exact pins, raw mapping and original protocol remain intact", () => {
    assert.equal(SECOND.stateDigest, "785a4139be1cc78b42fd0a9e2dde619d995f0b2f1be521589ec31fd900c0db75");
    assert.equal(crypto.createHash("sha256").update(JSON.stringify(predecessor)).digest("hex"), SECOND.stateDigest);
    assert.notEqual(hash(predecessor), SECOND.stateDigest);
    assert.equal(crypto.createHash("sha256").update("unrelated").digest("hex"), originalCreateHash("sha256").update("unrelated").digest("hex"));
    assert.equal(crypto.createHash("sha512").update(JSON.stringify(predecessor)).digest("hex"), originalCreateHash("sha512").update(JSON.stringify(predecessor)).digest("hex"));
    validateMaintenanceAttemptRecoveryState(predecessor, clock());
    assert.equal(AUTH_DIGEST, hash(AUTH)); assert(Object.isFrozen(AUTH)); assert(Object.isFrozen(SECOND));
  });
  await t.test("inspection is typed, private, actual T6 baseline and not transition authority", () => {
    const f = fixture(); assert.equal(f.inspection.state, "second-attempt-recovery-inspected"); assert.equal(f.inspection.activeAttempt, 2);
    assert.equal(f.inspection.stoppedBaseline.version, 2); assert.equal(f.inspection.predecessorJournalDigest, hash(f.state.launchJournal));
    assert.deepEqual(validateMaintenanceSecondAttemptRecoveryInspection(f.inspection), f.inspection);
    assert(!JSON.stringify(f.inspection).includes(f.state.launchJournal.slots["paused-web"].nonce));
  });
  await t.test("one builder produces v7 rev24, complete v6 predecessor, active attempt2", () => {
    const f = fixture(), next = build(f); assert.equal(next.version, 7); assert.equal(next.revision, 24); assert.equal(next.activeAttempt, 2); assert.equal(next.phase, "held");
    for (const key of ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"]) assert.equal(next[key], null);
    assert.deepEqual(next.secondAttemptRecovery.predecessor.state, predecessor); assert.equal(next.secondAttemptRecovery.predecessor.stateDigest, SECOND.stateDigest);
    assert.deepEqual(next.attemptRecovery, predecessor.attemptRecovery);
    for (const key of ["recovery", "continuation", "buildRecovery", "deadlineExtension", "runtime", "database", "ingress", "createdAt", "bootId", "tokenHash", "expectedOldSha"])
      assert.deepEqual(next[key], predecessor[key]);
    assert(Object.isFrozen(next.secondAttemptRecovery.predecessor.state.launchJournal.slots));
    assertMaintenanceSecondAttemptRecoveryProgress(f.state, next);
    assert.deepEqual(f.state, predecessor);
  });
  await t.test("real current time, same 04UTC limit, earlier acknowledgements confer no clock bypass", () => {
    const f = fixture(), next = build(f);
    for (const now of [AUTH.authorizedAt - 1, AUTH.priorAcknowledgedAt, AUTH.expiresAt, AUTH.expiresAt + 1]) {
      reject(() => validateMaintenanceSecondAttemptRecoveryPredecessor(f.state, clock(now)));
      reject(() => validateMaintenanceSecondAttemptRecoveryState(next, clock(now)));
    }
    assert.equal(AUTH.expiresAt, predecessor.attemptRecovery.deadlineAuthorization.expiresAt);
    assert.equal(AUTH.authorizedAt, Date.parse("2026-09-14T02:01:33Z"));
    assert.equal(validateMaintenanceSecondAttemptRecoveryState(next, clock(AUTH.expiresAt - 1)).version, 7);
  });
  await t.test("only exact failed v6/23/785a can recover, with consumed paused-web retained", () => {
    for (const patch of [{ version: 5 }, { version: 7 }, { activeAttempt: 0 }, { activeAttempt: 2 }, { revision: 22 }, { revision: 24 },
      { phase: "held" }, { phase: "failed-unknown" }, { candidate: null }, { launchDisk: null }, { launchJournal: null }, { resumed: {} }, { finalDump: {} },
      { targetSha: TARGET }, { createdAt: predecessor.createdAt + 1 }, { tokenHash: "0".repeat(64) }])
      reject(() => validateMaintenanceSecondAttemptRecoveryPredecessor({ ...copy(predecessor), ...patch }, clock()));
  });
  await t.test("CAS and exact source/migration context cannot drift", () => {
    for (const patch of [{ expectedDigest: "0".repeat(64) }, { expectedRevision: 24 }, { previousTargetSha: TARGET }, { bootId: "x" },
      { operationId: "x" }, { expectedOldSha: TARGET }, { sourceDiffDigest: "bad" }, { migrationDigest: "bad" }, { extra: 1 }]) {
      const f = fixture(); reject(() => createMaintenanceSecondAttemptRecoveryInspection(f.state, { ...f.context, ...patch }));
    }
    for (const targetSha of [SECOND.previousTargetSha, SECOND.expectedOldSha, INCIDENT.previousTargetSha, BUILD.originalTargetSha, BUILD.recoveredTargetSha, BUILD.previousTargetSha, "13df917416cf06ce27fce021460b08caf50f6165"]) {
      const f = fixture(); reject(() => createMaintenanceSecondAttemptRecoveryInspection(f.state, { ...f.context, targetSha }));
    }
  });
  await t.test("baseline binds complete files/proofs, current T6 and fresh time", () => {
    for (const mutate of [b => b.version = 1, b => b.stateDigest = INCIDENT.stateDigest, b => b.current.target = seed.launchDisk.runtime,
      b => b.current.runtimeIdentity = "2:2:3:4:5:1:0:33188", b => b.current.linkIdentity = "1:2", b => b.observedAt = NOW + 1,
      b => b.observedAt = NOW - 300001, ...["candidateDigest", "launchDiskDigest", "launchJournalDigest", "runtimeDigest"].map(key => b => b[key] = "0".repeat(64))]) {
      const f = fixture(); mutate(f.context.stoppedBaseline); reject(() => createMaintenanceSecondAttemptRecoveryInspection(f.state, f.context));
    }
  });
  await t.test("fixed B6/R6/D6/M/authorization and new CI/recovery run cannot be relabelled", () => {
    for (const patch of [{ toolsSha: SECOND.previousTargetSha }, { secondAttemptRecoveryRunAttempt: 2 }, { secondAttemptRecoveryRunId: "34789744074" },
      { mainCIrunId: "34789133814" }, { mainCIrunId: "34800000001" }, { activeAttempt: 1 }, { authorizationDigest: "0".repeat(64) },
      { historyCheckedAt: AUTH.authorizedAt - 1 }, { historyCheckedAt: AUTH.expiresAt }, ...RUN_KEYS.map(key => ({ [key]: key.endsWith("Id") ? "999" : 2 }))])
      reject(() => validateMaintenanceSecondAttemptRecoveryEvidence({ ...fixture().evidence, ...patch }));
    for (const key of ["sourceDiffDigest", "migrationDigest", "predecessorJournalDigest", "stoppedBaselineDigest"]) {
      const f = fixture(); f.evidence[key] = "0".repeat(64); reject(() => build(f));
    }
  });
  await t.test("final actual clock enforces fresh grant and baseline independently", () => {
    for (const patch of [{ now: NOW + 300000 }, { now: AUTH.expiresAt }, { now: NOW - 1001 }]) { const f = fixture(); Object.assign(f.context, patch); reject(() => build(f)); }
    const f = fixture(); f.evidence.historyCheckedAt = NOW + 1; reject(() => build(f));
  });
  await t.test("canonical bounded codec rejects duplicates, reordering, padding, UTF8 and hidden input", () => {
    const f = fixture(), encoded = encodeMaintenanceSecondAttemptRecoveryEvidence(f.evidence), text = Buffer.from(encoded, "base64url").toString("utf8");
    assert.deepEqual(decodeMaintenanceSecondAttemptRecoveryEvidence(encoded), validateMaintenanceSecondAttemptRecoveryEvidence(f.evidence));
    for (const input of [encoded + "=", " " + encoded, "a".repeat(16385), Buffer.from([255]).toString("base64url"),
      Buffer.from(text.replace('"version":1', '"version":1,"version":1')).toString("base64url"),
      Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(f.evidence).reverse()))).toString("base64url")])
      reject(() => decodeMaintenanceSecondAttemptRecoveryEvidence(input));
    let touches = 0;
    const getter = { ...f.evidence }; Object.defineProperty(getter, "toolsSha", { enumerable: true, get() { touches++; return TARGET; } });
    reject(() => validateMaintenanceSecondAttemptRecoveryEvidence(getter));
    reject(() => validateMaintenanceSecondAttemptRecoveryEvidence(new Proxy(f.evidence, { ownKeys() { touches++; return []; } })));
    assert.equal(touches, 0);
    for (const extra of [undefined, NaN, -0, "x".repeat(4 * 1024 * 1024)]) reject(() => validateMaintenanceSecondAttemptRecoveryEvidence({ ...f.evidence, extra }));
    const hidden = copy(f.evidence); Object.defineProperty(hidden, "hidden", { value: 1 }); reject(() => validateMaintenanceSecondAttemptRecoveryEvidence(hidden));
  });
  await t.test("both archived attempts and all top-level audits remain immutable on every writer", () => {
    const first = build(fixture());
    for (const mutate of [s => s.secondAttemptRecovery.predecessor.state.launchJournal = null,
      s => s.secondAttemptRecovery.predecessor.state.attemptRecovery.predecessor.state.candidate = null,
      s => s.secondAttemptRecovery.authorization.expiresAt++, s => s.secondAttemptRecovery.evidence.historyDigest = "0".repeat(64),
      s => s.secondAttemptRecovery.stoppedBaseline.pm2RegistryDigest = "0".repeat(64),
      s => s.attemptRecovery.predecessor.stateDigest = "0".repeat(64), s => s.recovery.extra = 1, s => s.continuation.extra = 1,
      s => s.buildRecovery.extra = 1, s => s.deadlineExtension.expiresAt++, s => s.createdAt++, s => s.targetSha = "b".repeat(40), s => s.activeAttempt = 3]) {
      const next = nextState(first); mutate(next); reject(() => assertMaintenanceSecondAttemptRecoveryProgress(first, next));
    }
  });
  await t.test("every active journal transition is enforced, no null-to-confirmed jump", () => {
    const initial = build(fixture()), { candidate, launched, saved } = journalSteps(initial);
    assert.equal(candidate.phase, "candidate"); assert.equal(candidate.launchJournal.slots["paused-web"].phase, "confirmed");
    reject(() => assertMaintenanceSecondAttemptRecoveryProgress(initial, { ...launched, revision: 25, phase: "candidate" }));
    reject(() => assertMaintenanceSecondAttemptRecoveryProgress(saved[0], { ...copy(saved[3]), revision: saved[0].revision + 1 }));
    reject(() => assertMaintenanceSecondAttemptRecoveryProgress(candidate, { ...nextState(candidate), launchJournal: null }));
    reject(() => assertMaintenanceSecondAttemptRecoveryProgress(candidate, { ...nextState(candidate), candidate: null, phase: "failed-held" }));
  });
  await t.test("nonce collisions with either archived attempt are rejected", () => {
    const initial = build(fixture());
    for (const nonce of [seed.launchJournal.slots["paused-web"].nonce, predecessor.launchJournal.slots["paused-web"].nonce]) {
      const collision = { ...nextState(initial), ...launch(initial, nonce), phase: "candidate" };
      reject(() => validateMaintenanceSecondAttemptRecoveryState(collision, clock()));
    }
  });
  await t.test("failed attempt2 is terminal for launch and cannot append a third attempt", () => {
    const { candidate } = journalSteps(build(fixture())), failed = { ...nextState(candidate), phase: "failed-held" };
    assertMaintenanceSecondAttemptRecoveryProgress(candidate, failed);
    for (const phase of ["held", "candidate", "resuming", "ended"])
      reject(() => assertMaintenanceSecondAttemptRecoveryProgress(failed, { ...nextState(failed), phase }));
    reject(() => buildMaintenanceSecondAttemptRecoveredState(failed, fixture().evidence, fixture().context));
    reject(() => assertMaintenanceSecondAttemptRecoveryProgress(failed, { ...nextState(failed), version: 8, activeAttempt: 3 }));
  });
  await t.test("all legacy v6 transitions delegate unchanged, but cannot smuggle v7 audit", () => {
    const next = nextState(predecessor); assertMaintenanceSecondAttemptRecoveryProgress(predecessor, next);
    assert.throws(() => assertMaintenanceSecondAttemptRecoveryProgress(predecessor, { ...next, phase: "held" }));
    reject(() => assertMaintenanceSecondAttemptRecoveryProgress(predecessor, { ...next, secondAttemptRecovery: {} }));
    const initial = build(fixture()); reject(() => assertMaintenanceSecondAttemptRecoveryProgress(initial, { ...nextState(initial), version: 6 }));
  });
});

