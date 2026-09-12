import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildMaintenanceRecoveredState, createMaintenanceRecoveryInspection, assertMaintenanceRecoveryProgress } from "./production-maintenance-recovery.mjs";
import { MAINTENANCE_CONTINUATION_INCIDENT as INCIDENT, MAINTENANCE_CONTINUATION_MAX_EVIDENCE_BYTES,
  MAINTENANCE_CONTINUATION_HISTORY_MAX_AGE_MS, createMaintenanceContinuationInspection, validateMaintenanceContinuationInspection,
  validateMaintenanceContinuationEvidence, encodeMaintenanceContinuationEvidence, decodeMaintenanceContinuationEvidence,
  buildMaintenanceContinuedState, validateMaintenanceContinuationState, assertMaintenanceContinuationProgress } from "./production-maintenance-continuation.mjs";

const BOOT = "11111111-2222-4333-8444-555555555555";
const TARGET = "3".repeat(40), NOW = INCIDENT.createdAt + 7 * 60 * 60 * 1000;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => structuredClone(value);
const reject = action => assert.throws(action, error => error.message === "maintenance_continuation_invalid" && error.cause === undefined);
function fixture() {
  const initial = { version: 2, revision: 3, operationId: INCIDENT.operationId, targetSha: INCIDENT.originalTargetSha,
    expectedOldSha: INCIDENT.expectedOldSha, appDir: "/srv/faolla", appName: "faolla", appPort: 3000, bootId: BOOT,
    createdAt: INCIDENT.createdAt, phase: "failed-held", runtime: { private: "original-runtime", generations: [{ pid: 77 }] },
    ingress: { private: "original-ingress", nginx: { retiringWorkers: [] } }, database: { databaseOid: 5 },
    publicSupabaseUrl: "https://example.invalid", tokenHash: "4".repeat(64), candidate: null, resumed: null,
    launchDisk: null, launchJournal: null, finalDump: null };
  const recoveryContext = { operationId: initial.operationId, previousTargetSha: initial.targetSha,
    targetSha: INCIDENT.previousTargetSha, expectedOldSha: initial.expectedOldSha, expectedRevision: 3,
    expectedDigest: hash(initial), bootId: BOOT, now: initial.createdAt + 3600000,
    sourceDiffDigest: "5".repeat(64), migrationDigest: "6".repeat(64) };
  const recoveryEvidence = { ...createMaintenanceRecoveryInspection(initial, recoveryContext), toolsSha: INCIDENT.previousTargetSha,
    recoveryRunId: "34700000001", recoveryRunAttempt: 1, mainCIrunId: "34700000000", historyDigest: "7".repeat(64),
    historyCheckedAt: recoveryContext.now - 1000 };
  const state = copy(buildMaintenanceRecoveredState(initial, recoveryEvidence, recoveryContext));
  const context = { operationId: state.operationId, previousTargetSha: state.targetSha, targetSha: TARGET,
    expectedOldSha: state.expectedOldSha, expectedRevision: 4, expectedDigest: hash(state), bootId: BOOT, now: NOW,
    sourceDiffDigest: "8".repeat(64), migrationDigest: "9".repeat(64) };
  const inspection = createMaintenanceContinuationInspection(state, context);
  const evidence = { ...inspection, toolsSha: TARGET, continuationRunId: "34722000001", continuationRunAttempt: 1,
    mainCIrunId: "34722000000", historyDigest: "a".repeat(64), historyCheckedAt: NOW - 1000 };
  return { initial, recoveryContext, recoveryEvidence, state, context, inspection, evidence };
}
const refresh = f => { f.context.expectedDigest = hash(f.state); };
const build = f => buildMaintenanceContinuedState(f.state, f.evidence, f.context);

test("inspection admits only the exact incident and exposes metadata, not private frozen proof", () => {
  const f = fixture(), before = copy(f.state);
  assert(Object.isFrozen(INCIDENT)); assert(Object.isFrozen(f.inspection));
  assert.deepEqual(Object.keys(f.inspection), ["version", "state", "operationId", "targetSha", "previousTargetSha", "expectedOldSha",
    "revision", "stateDigest", "createdAt", "sourceDiffDigest", "migrationDigest", "recoveryDigest", "backupRunId", "backupRunAttempt",
    "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt", "failedDeployRunId", "failedDeployRunAttempt"]);
  assert.equal(f.inspection.state, "continuation-inspected"); assert.equal(f.inspection.stateDigest, hash(before));
  assert.equal(f.inspection.recoveryDigest, hash(before.recovery));
  assert.equal(f.inspection.backupRunId, "34715932102"); assert.equal(f.inspection.migrationRunId, "34721155156");
  assert.equal(f.inspection.readinessRunId, "34721256683"); assert.equal(f.inspection.failedDeployRunId, "34721317710");
  for (const privateValue of [BOOT, f.state.tokenHash, f.state.publicSupabaseUrl, "original-runtime", "original-ingress"]) {
    assert(!JSON.stringify(f.inspection).includes(privateValue));
  }
  assert.deepEqual(f.state, before);
});

test("v3 held becomes v4 held exactly once and preserves every original field and recovery byte", () => {
  const f = fixture(), before = copy(f.state), next = build(f);
  assert.equal(next.version, 4); assert.equal(next.revision, 5); assert.equal(next.phase, "held"); assert.equal(next.targetSha, TARGET);
  for (const key of Object.keys(before).filter(key => !["version", "revision", "phase", "targetSha"].includes(key))) assert.deepEqual(next[key], before[key], key);
  assert.equal(JSON.stringify(next.recovery), JSON.stringify(before.recovery));
  assert.deepEqual(next.continuation, { version: 1, evidence: f.evidence, continuedAt: NOW });
  assert.deepEqual(f.state, before); assert.notEqual(next.runtime, f.state.runtime); assert(Object.isFrozen(next.runtime.generations[0]));
  assert(Object.isFrozen(next.recovery.evidence)); assert(Object.isFrozen(next.continuation.evidence));
  assertMaintenanceContinuationProgress(f.state, next);
  assert.deepEqual(validateMaintenanceContinuationState(next, { bootId: BOOT, now: NOW }), next);
  reject(() => createMaintenanceContinuationInspection(next, { ...f.context, expectedRevision: 5, expectedDigest: hash(next) }));
  reject(() => buildMaintenanceContinuedState(next, f.evidence, f.context));
});

test("only exact v3 held revision4 with five null launch fields is continuable", () => {
  for (const mutate of [s => { s.version = 2; delete s.recovery; }, s => { s.version = 4; }, s => { s.revision = 5; },
    ...["preparing", "failed-held", "failed-unknown", "candidate", "resuming", "ended"].map(phase => s => { s.phase = phase; }),
    ...["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"].map(key => s => { s[key] = {}; })]) {
    const f = fixture(); mutate(f.state); refresh(f); reject(() => createMaintenanceContinuationInspection(f.state, f.context));
  }
});

test("another operation, old build, creation time, target or boot cannot borrow the incident", () => {
  for (const patch of [{ operationId: "aaaaaaaa-2222-4222-8222-bbbbbbbbbbbb" }, { expectedOldSha: "0".repeat(40) },
    { targetSha: "0".repeat(40) }, { createdAt: INCIDENT.createdAt + 1 }, { bootId: "aaaaaaaa-2222-4222-8222-bbbbbbbbbbbb" }]) {
    const f = fixture(); Object.assign(f.state, patch); refresh(f);
    reject(() => createMaintenanceContinuationInspection(f.state, f.context));
  }
  for (const key of ["operationId", "previousTargetSha", "expectedOldSha", "expectedRevision", "bootId"]) {
    const f = fixture(); f.context[key] = key === "expectedRevision" ? 5 : "unexpected";
    reject(() => createMaintenanceContinuationInspection(f.state, f.context));
  }
});

test("T3 cannot be any of T1, T2 or O, and SHA format never coerces", () => {
  for (const targetSha of [INCIDENT.originalTargetSha, INCIDENT.previousTargetSha, INCIDENT.expectedOldSha,
    "A".repeat(40), "3".repeat(39), 123, { toString() { throw new Error("never"); } }]) {
    const f = fixture(); f.context.targetSha = targetSha;
    reject(() => createMaintenanceContinuationInspection(f.state, f.context));
  }
});

test("unchanged raw compact state digest is mandatory even for equally valid or reordered state", () => {
  const f = fixture(); f.state.runtime.generations[0].pid++;
  reject(() => createMaintenanceContinuationInspection(f.state, f.context));
  const other = fixture(); other.context.expectedDigest = "0".repeat(64);
  reject(() => createMaintenanceContinuationInspection(other.state, other.context));
  const reordered = Object.fromEntries(Object.entries(other.state).reverse());
  reject(() => createMaintenanceContinuationInspection(reordered, fixture().context));
  const changedRecovery = fixture(); changedRecovery.state.recovery.evidence.historyDigest = "0".repeat(64); refresh(changedRecovery);
  reject(() => build(changedRecovery)); // original inspection's recovery/state digests cannot be reused
});

test("original T1 to T2 audit is validated, not rewritten or replaced with a direct T1 to T3 claim", () => {
  for (const mutate of [r => { r.evidence.previousTargetSha = "0".repeat(40); }, r => { r.evidence.targetSha = TARGET; },
    r => { r.evidence.revision = 2; }, r => { r.evidence.operationId = "aaaaaaaa-2222-4222-8222-bbbbbbbbbbbb"; },
    r => { r.version = 2; }, r => { r.recoveredAt = NOW + 1; }, r => { r.extra = true; }]) {
    const f = fixture(); mutate(f.state.recovery); refresh(f); reject(() => createMaintenanceContinuationInspection(f.state, f.context));
  }
  const f = fixture(); delete f.state.recovery; refresh(f); reject(() => createMaintenanceContinuationInspection(f.state, f.context));
});

test("old B M R failed-D ids and attempt1 are exact, never caller-selected or coercible", () => {
  for (const key of ["backupRunId", "migrationRunId", "readinessRunId", "failedDeployRunId"]) {
    for (const value of ["34700000009", Number(INCIDENT[key]), "0" + INCIDENT[key]]) {
      const f = fixture(); f.evidence[key] = value; reject(() => validateMaintenanceContinuationEvidence(f.evidence));
    }
  }
  for (const key of ["backupRunAttempt", "migrationRunAttempt", "readinessRunAttempt", "failedDeployRunAttempt"]) {
    for (const value of [2, 0, "1", null]) {
      const f = fixture(); f.evidence[key] = value; reject(() => validateMaintenanceContinuationEvidence(f.evidence));
    }
  }
});

test("continuation grant binds every inspected digest and cannot reuse old workflow identities", () => {
  for (const [key, value] of Object.entries({ sourceDiffDigest: "0".repeat(64), migrationDigest: "0".repeat(64),
    recoveryDigest: "0".repeat(64), stateDigest: "0".repeat(64), revision: 5, createdAt: INCIDENT.createdAt + 1,
    toolsSha: INCIDENT.previousTargetSha, continuationRunAttempt: 2, mainCIrunId: "034722000000",
    continuationRunId: INCIDENT.failedDeployRunId, historyDigest: "invalid" })) {
    const f = fixture(); f.evidence[key] = value; reject(() => build(f));
  }
  const f = fixture(); f.evidence.continuationRunId = f.evidence.mainCIrunId; reject(() => build(f));
  const oldRecoveryRun = fixture(); oldRecoveryRun.evidence.continuationRunId = oldRecoveryRun.state.recovery.evidence.recoveryRunId;
  reject(() => build(oldRecoveryRun));
});

test("grant history is at most five minutes old, never future or earlier than original recovery", () => {
  const f = fixture();
  assert(buildMaintenanceContinuedState(f.state, { ...f.evidence, historyCheckedAt: NOW - MAINTENANCE_CONTINUATION_HISTORY_MAX_AGE_MS }, f.context));
  for (const historyCheckedAt of [NOW + 1, NOW - MAINTENANCE_CONTINUATION_HISTORY_MAX_AGE_MS - 1, INCIDENT.createdAt - 1]) {
    reject(() => buildMaintenanceContinuedState(f.state, { ...f.evidence, historyCheckedAt }, f.context));
  }
  const short = fixture(); short.context.now = short.state.recovery.recoveredAt + 1000;
  short.evidence.historyCheckedAt = short.state.recovery.recoveredAt - 1;
  reject(() => build(short));
});

test("original twelve-hour lifetime never restarts at recovery or continuation", () => {
  const f = fixture(), deadline = INCIDENT.createdAt + 12 * 60 * 60 * 1000;
  const state = buildMaintenanceContinuedState(f.state, { ...f.evidence, historyCheckedAt: deadline }, { ...f.context, now: deadline });
  assert.equal(state.createdAt, INCIDENT.createdAt);
  reject(() => validateMaintenanceContinuationState(state, { bootId: BOOT, now: deadline + 1 }));
  reject(() => buildMaintenanceContinuedState(f.state, { ...f.evidence, historyCheckedAt: deadline }, { ...f.context, now: deadline + 1 }));
  for (const now of [INCIDENT.createdAt - 1, Number.MAX_SAFE_INTEGER, NaN, Infinity]) {
    reject(() => createMaintenanceContinuationInspection(f.state, { ...f.context, now }));
  }
});

test("inspection and evidence are exact bounded records, not claimed held booleans or raw reports", () => {
  const f = fixture();
  for (const patch of [{ state: "held" }, { version: 2 }, { ready: true }, { raw: f.state.runtime }]) {
    reject(() => validateMaintenanceContinuationInspection({ ...f.inspection, ...patch }));
  }
  for (const value of [{ ...f.evidence, confirmed: true }, { ...f.evidence, secret: "unaccepted" },
    { ...f.evidence, historyDigest: "a".repeat(MAINTENANCE_CONTINUATION_MAX_EVIDENCE_BYTES + 1) }]) {
    reject(() => validateMaintenanceContinuationEvidence(value));
  }
  const context = { ...f.context, raw: true }; reject(() => createMaintenanceContinuationInspection(f.state, context));
  assert.deepEqual(validateMaintenanceContinuationInspection(f.inspection), f.inspection);
});

test("canonical base64url accepts one representation and refuses duplicate keys, whitespace, UTF8 errors or padding", () => {
  const f = fixture(), encoded = encodeMaintenanceContinuationEvidence(f.evidence), raw = JSON.stringify(f.evidence);
  assert.deepEqual(decodeMaintenanceContinuationEvidence(encoded), f.evidence);
  assert(Object.isFrozen(decodeMaintenanceContinuationEvidence(encoded)));
  assert.equal(encodeMaintenanceContinuationEvidence(Object.fromEntries(Object.entries(f.evidence).reverse())), encoded);
  for (const text of [raw + "\n", raw.replace('"version":1', '"version":1,"version":1'),
    JSON.stringify(Object.fromEntries(Object.entries(f.evidence).reverse())), "null"]) {
    reject(() => decodeMaintenanceContinuationEvidence(Buffer.from(text).toString("base64url")));
  }
  for (const text of [encoded + "=", encoded + "+", "", "A".repeat(MAINTENANCE_CONTINUATION_MAX_EVIDENCE_BYTES + 1),
    Buffer.from([255]).toString("base64url")]) reject(() => decodeMaintenanceContinuationEvidence(text));
});

test("capture executes no getter/proxy/toJSON and rejects hidden fields throughout state and grant", () => {
  let reads = 0; const f = fixture();
  const getter = copy(f.state); Object.defineProperty(getter.recovery, "version", { enumerable: true, get() { reads++; return 1; } });
  reject(() => createMaintenanceContinuationInspection(getter, f.context));
  const proxy = new Proxy(f.state, { ownKeys() { reads++; return []; } });
  reject(() => createMaintenanceContinuationInspection(proxy, f.context));
  const method = copy(f.state); method.runtime.toJSON = () => { reads++; return {}; };
  reject(() => createMaintenanceContinuationInspection(method, f.context));
  const grant = copy(f.evidence); Object.defineProperty(grant, "targetSha", { enumerable: true, get() { reads++; return TARGET; } });
  reject(() => validateMaintenanceContinuationEvidence(grant)); assert.equal(reads, 0);
  const hidden = copy(f.state); Object.defineProperty(hidden.runtime, "hidden", { value: 1 });
  reject(() => createMaintenanceContinuationInspection(hidden, f.context));
});

test("non-JSON, sparse, cyclic, symbolic and oversized proof objects are never normalized", () => {
  for (const value of [undefined, -0, Infinity, BigInt(1), new Date(), [, 1], { [Symbol("x")]: true }]) {
    const f = fixture(); f.state.runtime.value = value; reject(() => createMaintenanceContinuationInspection(f.state, f.context));
  }
  const cyclic = fixture(); cyclic.state.ingress.self = cyclic.state.ingress;
  reject(() => createMaintenanceContinuationInspection(cyclic.state, cyclic.context));
  const large = fixture(); large.state.runtime.raw = "x".repeat(4 * 1024 * 1024);
  reject(() => createMaintenanceContinuationInspection(large.state, large.context));
});

test("v4 validator preserves original audit chain and rejects false initial launch or target/recovery drift", () => {
  for (const mutate of [s => { delete s.continuation; }, s => { s.continuation = null; }, s => { s.continuation.extra = true; },
    s => { s.continuation.version = 2; }, s => { s.continuation.continuedAt = NOW + 1; },
    s => { s.continuation.continuedAt = s.recovery.recoveredAt - 1; }, s => { s.targetSha = INCIDENT.previousTargetSha; },
    s => { s.recovery.evidence.historyDigest = "0".repeat(64); }, s => { s.createdAt++; }, s => { s.revision = 4; },
    s => { s.candidate = {}; }, s => { s.phase = "failed-held"; }]) {
    const next = copy(build(fixture())); mutate(next);
    reject(() => validateMaintenanceContinuationState(next, { bootId: BOOT, now: NOW }));
  }
  reject(() => validateMaintenanceContinuationState(build(fixture()), { bootId: "aaaaaaaa-2222-4222-8222-bbbbbbbbbbbb", now: NOW }));
});

test("storage transition accepts exactly the derived state, never any simultaneous proof or audit change", () => {
  for (const mutate of [s => { s.runtime.generations[0].pid++; }, s => { s.ingress.nginx.retiringWorkers.push({ pid: 8 }); },
    s => { s.database.databaseOid++; }, s => { s.tokenHash = "0".repeat(64); }, s => { s.publicSupabaseUrl += "/changed"; },
    s => { s.appName = "another"; }, s => { s.revision++; }, s => { s.launchJournal = {}; }, s => { s.recovery.recoveredAt++; }]) {
    const f = fixture(), next = copy(build(f)); mutate(next); reject(() => assertMaintenanceContinuationProgress(f.state, next));
  }
});

test("all later v4 writes retain two complete audits and fixed binding; downgrade, retarget and erase fail", () => {
  const before = build(fixture()), next = { ...copy(before), revision: 6, phase: "failed-held" };
  assertMaintenanceContinuationProgress(before, next);
  next.ingress.nginx.retiringWorkers.push({ pid: 9 }); assertMaintenanceContinuationProgress(before, next);
  for (const mutate of [s => { delete s.recovery; }, s => { delete s.continuation; }, s => { s.version = 3; delete s.continuation; },
    s => { s.version = 2; delete s.continuation; delete s.recovery; }, s => { s.continuation.evidence.historyDigest = "b".repeat(64); },
    s => { s.continuation.continuedAt++; }, s => { s.recovery.evidence.stateDigest = "b".repeat(64); },
    s => { s.targetSha = "b".repeat(40); }, s => { s.runtime.private = "new"; }, s => { s.database.databaseOid++; },
    s => { s.createdAt++; }, s => { s.tokenHash = "b".repeat(64); }, s => { s.revision++; }, s => { s.revision--; }]) {
    const bad = copy(next); mutate(bad); reject(() => assertMaintenanceContinuationProgress(before, bad));
  }
});

test("normal later v4 launch bookkeeping is not reset or precluded by the audit wrapper", () => {
  const initial = build(fixture());
  // These are opaque protocol fixtures, not evidence of real PM2 observations:
  // the existing control/launch-journal validators still enforce every instance.
  const planned = { ...copy(initial), revision: 6, launchDisk: { targetSha: TARGET }, launchJournal: { targetSha: TARGET } };
  assertMaintenanceContinuationProgress(initial, planned);
  const candidate = { ...copy(planned), revision: 7, phase: "candidate", candidate: { targetSha: TARGET } };
  assertMaintenanceContinuationProgress(planned, candidate);
  assert.equal(candidate.recovery.evidence.targetSha, INCIDENT.previousTargetSha);
  assert.equal(candidate.continuation.evidence.targetSha, TARGET);
});

test("old v2/v3 writes still use the unchanged recovery guard, including original failures", () => {
  const f = fixture();
  assertMaintenanceContinuationProgress(f.initial, f.state);
  const later = { ...copy(f.state), revision: 5, phase: "failed-held" };
  assertMaintenanceRecoveryProgress(f.state, later); assertMaintenanceContinuationProgress(f.state, later);
  const tampered = copy(later); tampered.recovery.evidence.historyDigest = "b".repeat(64);
  assert.throws(() => assertMaintenanceRecoveryProgress(f.state, tampered), /maintenance_recovery_invalid/);
  assert.throws(() => assertMaintenanceContinuationProgress(f.state, tampered), /maintenance_recovery_invalid/);
  reject(() => assertMaintenanceContinuationProgress(f.initial, { ...f.initial, continuation: null }));
  reject(() => assertMaintenanceContinuationProgress(f.initial, build(f)));
});

test("protocol module contains no host access, deadline reset, random id, process call or automatic retry", () => {
  const source = readFileSync(new URL("./production-maintenance-continuation.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["']node:(?:fs|child_process|http|https|net|tls|process)["']|\b(?:Date\.now|fetch|spawn|execSync|randomUUID|randomBytes|setTimeout)\s*\(/);
  assert.equal(MAINTENANCE_CONTINUATION_MAX_EVIDENCE_BYTES, 16384); assert.equal(MAINTENANCE_CONTINUATION_HISTORY_MAX_AGE_MS, 300000);
});
