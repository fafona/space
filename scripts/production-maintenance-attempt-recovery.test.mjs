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
import { MAINTENANCE_ATTEMPT_RECOVERY_INCIDENT as INCIDENT, MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION as AUTH,
  MAINTENANCE_ATTEMPT_RECOVERY_DEADLINE_AUTHORIZATION_DIGEST as AUTH_DIGEST,
  createMaintenanceAttemptRecoveryInspection, validateMaintenanceAttemptRecoveryInspection,
  validateMaintenanceAttemptRecoveryEvidence, encodeMaintenanceAttemptRecoveryEvidence, decodeMaintenanceAttemptRecoveryEvidence,
  validateMaintenanceAttemptRecoveryPredecessor, buildMaintenanceAttemptRecoveredState, validateMaintenanceAttemptRecoveryState,
  readMaintenanceActiveAttempt, assertMaintenanceAttemptRecoveryProgress } from "./production-maintenance-attempt-recovery.mjs";

const originalCreateHash = crypto.createHash;
const hash = value => originalCreateHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => structuredClone(value);
const NOW = Date.parse("2026-09-13T23:00:00.000Z"), TARGET = "a".repeat(40), ID = "1:2:3:4:5:1:0:33188";
const clock = (now = NOW) => ({ bootId: INCIDENT.bootId, now });
const reject = action => assert.throws(action, error => error.message === "maintenance_attempt_recovery_invalid" && error.cause === undefined);
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

// Exactly one synthetic compact JSON byte string maps to the published d8e8
// pin, only in this sequential test process. No private state, production hook,
// wildcard hash bypass or claim of real-host proof is present in these tests.
test("single post-launch attempt pure protocol", { concurrency: false }, async t => {
  const seed = syntheticPredecessor(), mappedBytes = Buffer.from(JSON.stringify(seed));
  t.mock.method(crypto, "createHash", (algorithm, options) => {
    const result = originalCreateHash(algorithm, options), chunks = [], update = result.update.bind(result), digest = result.digest.bind(result);
    result.update = (value, encoding) => { chunks.push(Buffer.from(value, encoding)); update(value, encoding); return result; };
    result.digest = encoding => { const actual = digest(encoding); return algorithm === "sha256" && encoding === "hex" && Buffer.concat(chunks).equals(mappedBytes) ? INCIDENT.stateDigest : actual; };
    return result;
  }); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); assert.equal(crypto.createHash, originalCreateHash); assert.equal(hash(seed), originalCreateHash("sha256").update(mappedBytes).digest("hex")); });
  const fixture = () => {
    const state = copy(seed), baseline = { version: 1, stateDigest: INCIDENT.stateDigest, candidateDigest: hash(state.candidate),
      launchDiskDigest: hash(state.launchDisk), launchJournalDigest: hash(state.launchJournal), runtimeDigest: hash(state.runtime),
      current: { target: state.launchDisk.runtime, linkIdentity: ID, runtimeIdentity: ID }, bootId: INCIDENT.bootId,
      pm2RegistryDigest: "a".repeat(64), observedAt: NOW - 1000 };
    const context = { operationId: INCIDENT.operationId, previousTargetSha: INCIDENT.previousTargetSha, targetSha: TARGET,
      expectedOldSha: INCIDENT.expectedOldSha, expectedRevision: 15, expectedDigest: INCIDENT.stateDigest, bootId: INCIDENT.bootId,
      now: NOW, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64), stoppedBaseline: baseline };
    const inspection = createMaintenanceAttemptRecoveryInspection(state, context);
    const evidence = { ...inspection, toolsSha: TARGET, attemptRecoveryRunId: "34790000001", attemptRecoveryRunAttempt: 1,
      mainCIrunId: "34790000000", historyDigest: "d".repeat(64), historyCheckedAt: NOW - 1000 };
    return { state, context, inspection, evidence };
  };
  const build = f => buildMaintenanceAttemptRecoveredState(f.state, f.evidence, f.context);

  await t.test("pins are fixed, hash override is exact synthetic bytes only", () => {
    assert.equal(INCIDENT.stateDigest, "d8e8abb8926441caef71867c15539fdafcb7cc9dbe0f77bd84ebc9548d39a0f8"); assert.notEqual(hash(seed), INCIDENT.stateDigest);
    assert.equal(crypto.createHash("sha256").update(mappedBytes).digest("hex"), INCIDENT.stateDigest);
    assert.equal(crypto.createHash("sha256").update("unrelated").digest("hex"), originalCreateHash("sha256").update("unrelated").digest("hex"));
    assert.equal(crypto.createHash("sha512").update(mappedBytes).digest("hex"), originalCreateHash("sha512").update(mappedBytes).digest("hex"));
    assert(Object.isFrozen(INCIDENT)); assert(Object.isFrozen(AUTH)); assert.equal(AUTH_DIGEST, hash(AUTH));
  });
  await t.test("inspection privately retains the typed stopped baseline, not held authority or launch secrets", () => {
    const f = fixture(); assert.equal(f.inspection.state, "attempt-recovery-inspected"); assert.equal(f.inspection.activeAttempt, 1);
    assert.equal(f.inspection.predecessorJournalDigest, hash(f.state.launchJournal)); assert.equal(f.inspection.stoppedBaselineDigest, hash(f.context.stoppedBaseline));
    assert.deepEqual(validateMaintenanceAttemptRecoveryInspection(f.inspection), f.inspection);
    assert.deepEqual(f.inspection.stoppedBaseline, f.context.stoppedBaseline); assert(Object.isFrozen(f.inspection.stoppedBaseline.current));
    assert(!JSON.stringify(f.inspection).includes(seed.launchJournal.slots["paused-web"].nonce)); assert(!JSON.stringify(f.inspection).includes(seed.tokenHash));
    assert(Object.isFrozen(f.inspection));
  });
  await t.test("one CAS builds flat v6/16 and retains complete consumed predecessor/audits", () => {
    const f = fixture(), before = copy(f.state), next = build(f);
    assert.equal(next.version, 6); assert.equal(next.revision, 16); assert.equal(next.phase, "held"); assert.equal(next.targetSha, TARGET); assert.equal(next.activeAttempt, 1);
    assert.deepEqual(next.attemptRecovery.predecessor.state, before); assert.equal(next.attemptRecovery.predecessor.stateDigest, INCIDENT.stateDigest);
    for (const key of ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"]) assert.equal(next[key], null);
    for (const key of ["recovery", "continuation", "buildRecovery", "deadlineExtension", "runtime", "database", "ingress", "createdAt", "bootId", "tokenHash", "expectedOldSha"]) assert.deepEqual(next[key], before[key]);
    assert.equal(next.attemptRecovery.predecessor.state.launchJournal.slots["paused-web"].phase, "confirmed");
    assert.deepEqual(f.state, before); assert(Object.isFrozen(next.attemptRecovery.predecessor.state.launchJournal.slots));
    assertMaintenanceAttemptRecoveryProgress(f.state, next); assert.deepEqual(readMaintenanceActiveAttempt(next, clock()), next);
  });
  await t.test("new expiry uses real clock, never the legacy historical audit clock", () => {
    const f = fixture(), next = build(f);
    assert.throws(() => validateMaintenanceBuildRecoveryState(f.state, clock()));
    for (const now of [AUTH.authorizedAt - 1, AUTH.expiresAt, AUTH.expiresAt + 1, INCIDENT.historicalObservedAt]) {
      reject(() => validateMaintenanceAttemptRecoveryPredecessor(f.state, clock(now)));
      reject(() => validateMaintenanceAttemptRecoveryState(next, clock(now)));
    }
    assert.equal(AUTH.expiresAt, Date.parse("2026-09-14T04:00:00.000Z")); assert.equal(AUTH.previousExpiresAt, OLD_EXTENSION.expiresAt);
    assert.equal(validateMaintenanceAttemptRecoveryState(next, clock(AUTH.expiresAt - 1)).version, 6);
  });
  await t.test("predecessor cannot change phase/version/revision/boot/target/original bytes", () => {
    for (const patch of [{ version: 4 }, { version: 6 }, { revision: 14 }, { revision: 16 }, { phase: "held" }, { phase: "failed-unknown" },
      { bootId: "a".repeat(36) }, { targetSha: TARGET }, { createdAt: seed.createdAt + 1 }, { operationId: "x" }, { tokenHash: "0".repeat(64) }]) {
      reject(() => validateMaintenanceAttemptRecoveryPredecessor({ ...copy(seed), ...patch }, clock()));
    }
    for (const key of ["candidate", "launchDisk", "launchJournal"]) reject(() => validateMaintenanceAttemptRecoveryPredecessor({ ...copy(seed), [key]: null }, clock()));
    for (const key of ["resumed", "finalDump"]) reject(() => validateMaintenanceAttemptRecoveryPredecessor({ ...copy(seed), [key]: {} }, clock()));
  });
  await t.test("real revision/digest/source and target CAS context cannot drift", () => {
    for (const patch of [{ expectedDigest: "0".repeat(64) }, { expectedRevision: 16 }, { previousTargetSha: TARGET }, { targetSha: seed.targetSha },
      { targetSha: seed.expectedOldSha }, { bootId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" }, { sourceDiffDigest: "bad" }, { migrationDigest: "bad" }, { extra: true }]) {
      const f = fixture(); reject(() => createMaintenanceAttemptRecoveryInspection(f.state, { ...f.context, ...patch }));
    }
  });
  await t.test("candidate baseline binds complete objects, actual current and fresh observation", () => {
    const mutations = [b => b.stateDigest = "0".repeat(64), b => b.candidateDigest = "0".repeat(64), b => b.launchDiskDigest = "0".repeat(64),
      b => b.launchJournalDigest = "0".repeat(64), b => b.runtimeDigest = "0".repeat(64), b => b.current.target = "/srv/faolla.releases/old",
      b => b.current.linkIdentity = "1:2", b => b.current.runtimeIdentity = "2:2:3:4:5:1:0:33188", b => b.bootId = "bad",
      b => b.observedAt = NOW + 1, b => b.observedAt = NOW - 300001, b => b.pm2RegistryDigest = "bad", b => b.extra = true];
    for (const mutate of mutations) { const f = fixture(); mutate(f.context.stoppedBaseline); reject(() => createMaintenanceAttemptRecoveryInspection(f.state, f.context)); }
  });
  await t.test("evidence cannot relabel previous B/R/D/M, CI, source, nonce scope or authorization", () => {
    const patches = [{ toolsSha: seed.targetSha }, { attemptRecoveryRunAttempt: 2 }, { attemptRecoveryRunId: "34781392661" },
      { mainCIrunId: "34777790522" }, { mainCIrunId: "34790000001" }, { historyCheckedAt: AUTH.expiresAt }, { historyCheckedAt: AUTH.authorizedAt - 1 },
      { activeAttempt: 2 }, { deadlineAuthorizationDigest: "0".repeat(64) }, { historyDigest: "bad" }, ...RUN_KEYS.map(key => ({ [key]: key.endsWith("Id") ? "999" : 2 }))];
    for (const patch of patches) { const f = fixture(); reject(() => validateMaintenanceAttemptRecoveryEvidence({ ...f.evidence, ...patch })); }
    for (const key of ["sourceDiffDigest", "migrationDigest", "stoppedBaselineDigest", "predecessorJournalDigest"]) {
      const f = fixture(); f.evidence[key] = "0".repeat(64); reject(() => build(f));
    }
  });
  await t.test("grant freshness is checked at final build, including future and exact expiry", () => {
    for (const patch of [{ now: NOW + 300000 }, { now: AUTH.expiresAt }, { now: NOW - 1001 }]) {
      const f = fixture(); Object.assign(f.context, patch); reject(() => build(f));
    }
    const f = fixture(); f.evidence.historyCheckedAt = NOW + 1; reject(() => build(f));
  });
  await t.test("canonical base64url rejects reordering, padding, duplicate keys and invalid UTF8", () => {
    const f = fixture(), encoded = encodeMaintenanceAttemptRecoveryEvidence(f.evidence);
    assert.deepEqual(decodeMaintenanceAttemptRecoveryEvidence(encoded), validateMaintenanceAttemptRecoveryEvidence(f.evidence));
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    for (const input of [encoded + "=", " " + encoded, "a".repeat(16385), Buffer.from([255]).toString("base64url"),
      Buffer.from(json.replace('"version":1', '"version":1,"version":1')).toString("base64url"),
      Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(f.evidence).reverse()))).toString("base64url")]) reject(() => decodeMaintenanceAttemptRecoveryEvidence(input));
  });
  await t.test("descriptor capture rejects proxies/getters/hidden keys/undefined/depth and size", () => {
    const f = fixture(); let touches = 0;
    const getter = { ...f.evidence }; Object.defineProperty(getter, "toolsSha", { enumerable: true, get() { touches++; return TARGET; } });
    const proxy = new Proxy(f.evidence, { ownKeys() { touches++; return []; } });
    reject(() => validateMaintenanceAttemptRecoveryEvidence(getter)); reject(() => validateMaintenanceAttemptRecoveryEvidence(proxy)); assert.equal(touches, 0);
    for (const extra of [undefined, NaN, -0, "x".repeat(4 * 1024 * 1024)]) reject(() => validateMaintenanceAttemptRecoveryEvidence({ ...f.evidence, extra }));
    const hidden = copy(f.evidence); Object.defineProperty(hidden, "hidden", { value: 1 }); reject(() => validateMaintenanceAttemptRecoveryEvidence(hidden));
    const deep = {}; let ptr = deep; for (let i = 0; i < 70; i++) { ptr.child = {}; ptr = ptr.child; } reject(() => validateMaintenanceAttemptRecoveryEvidence(deep));
  });
  await t.test("every historical audit/baseline/authorization/predecessor is permanently immutable", () => {
    const f = fixture(), next = build(f);
    for (const mutate of [s => s.attemptRecovery.predecessor.state.launchJournal = null, s => s.attemptRecovery.predecessor.state.candidate = null,
      s => s.attemptRecovery.predecessor.stateDigest = "0".repeat(64), s => s.attemptRecovery.deadlineAuthorization.expiresAt++,
      s => s.attemptRecovery.evidence.historyDigest = "0".repeat(64), s => s.attemptRecovery.stoppedBaseline.pm2RegistryDigest = "0".repeat(64),
      s => s.activeAttempt = 2, s => s.targetSha = "b".repeat(40), s => s.createdAt++, s => s.recovery.extra = true,
      s => s.continuation.extra = true, s => s.buildRecovery.extra = true, s => s.deadlineExtension.expiresAt++]) {
      const changed = copy(next); changed.revision++; mutate(changed); reject(() => assertMaintenanceAttemptRecoveryProgress(next, changed));
    }
  });
  await t.test("v6 journal may advance but never reuse attempt0 nonce or clear a consumed attempt1", () => {
    const next = build(fixture()), changed = { ...copy(next), revision: 17 };
    Object.assign(changed, launch(changed, "11111111-2222-4333-8444-555555555555")); changed.phase = "candidate";
    assertMaintenanceAttemptRecoveryProgress(next, changed);
    assert.equal(validateMaintenanceAttemptRecoveryState(changed, clock()).candidate.pauseExpected, "1");
    const collision = copy(changed); Object.assign(collision, launch(collision)); reject(() => validateMaintenanceAttemptRecoveryState(collision, clock()));
    const cleared = { ...copy(changed), revision: 18, candidate: null, launchDisk: null, launchJournal: null, phase: "failed-held" };
    reject(() => assertMaintenanceAttemptRecoveryProgress(changed, cleared));
    const failed = { ...copy(changed), revision: 18, phase: "failed-held" }; assertMaintenanceAttemptRecoveryProgress(changed, failed);
    reject(() => assertMaintenanceAttemptRecoveryProgress(failed, { ...copy(failed), revision: 19, phase: "held" }));
    reject(() => buildMaintenanceAttemptRecoveredState(failed, fixture().evidence, fixture().context));
  });
  await t.test("failed attempts cannot structurally re-enter held, candidate, resuming or ended", () => {
    const initial = build(fixture()), launched = { ...copy(initial), revision: 17, phase: "candidate" };
    Object.assign(launched, launch(launched, "11111111-2222-4333-8444-555555555555"));
    for (const phase of ["failed-held", "failed-unknown"]) {
      const failed = { ...copy(launched), revision: 18, phase };
      assertMaintenanceAttemptRecoveryProgress(launched, failed);
      for (const nextPhase of ["held", "candidate", "resuming", "ended"])
        reject(() => assertMaintenanceAttemptRecoveryProgress(failed, { ...copy(failed), revision: 19, phase: nextPhase }));
      // Reclassification while still failed is allowed, not a new attempt.
      for (const nextPhase of ["failed-held", "failed-unknown"])
        assertMaintenanceAttemptRecoveryProgress(failed, { ...copy(failed), revision: 19, phase: nextPhase });
    }
  });
  await t.test("initial builder cannot omit/archive-afterward or invent candidate fields", () => {
    const f = fixture(), next = copy(build(f)); next.candidate = copy(seed.candidate); reject(() => assertMaintenanceAttemptRecoveryProgress(f.state, next));
    const noAudit = copy(build(f)); delete noAudit.attemptRecovery; reject(() => assertMaintenanceAttemptRecoveryProgress(f.state, noAudit));
    const downgrade = { ...copy(build(f)), version: 5 }; reject(() => assertMaintenanceAttemptRecoveryProgress(build(f), downgrade));
  });
  await t.test("ordinary legacy progress delegates unchanged and cannot hide new attempt metadata", () => {
    const previous = copy(seed), next = { ...copy(seed), revision: 16 }; assertMaintenanceAttemptRecoveryProgress(previous, next);
    reject(() => assertMaintenanceAttemptRecoveryProgress(previous, { ...next, activeAttempt: 1 }));
    assert.throws(() => assertMaintenanceAttemptRecoveryProgress(previous, { ...next, targetSha: TARGET }));
  });
});
