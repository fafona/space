import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertMaintenanceRecoveryProgress, buildMaintenanceRecoveredState, createMaintenanceRecoveryInspection,
  decodeMaintenanceRecoveryEvidence, encodeMaintenanceRecoveryEvidence, MAINTENANCE_RECOVERY_HISTORY_MAX_AGE_MS,
  MAINTENANCE_RECOVERY_MAX_EVIDENCE_BYTES, validateMaintenanceRecoveryEvidence, validateMaintenanceRecoveryInspection,
  validateMaintenanceRecoveryState } from "./production-maintenance-recovery.mjs";

const OLD = "a".repeat(40), PREVIOUS = "b".repeat(40), TARGET = "c".repeat(40);
const CREATED = 1789236000000, NOW = CREATED + 60 * 60 * 1000;
const BOOT = "aaaaaaaa-1111-4111-8111-bbbbbbbbbbbb";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const reject = action => assert.throws(action, error => error.message === "maintenance_recovery_invalid" && error.cause === undefined);
const copy = value => structuredClone(value);
function fixture() {
  const state = { version: 2, revision: 3, operationId: "aaaaaaaa-2222-4222-8222-bbbbbbbbbbbb", targetSha: PREVIOUS,
    expectedOldSha: OLD, appDir: "/srv/faolla", appName: "faolla", appPort: 3000, bootId: BOOT, createdAt: CREATED,
    phase: "failed-held", runtime: { original: "opaque-runtime", nested: [{ generation: "unchanged" }] },
    ingress: { original: "opaque-ingress", nginx: { retiringWorkers: [] } }, database: { databaseOid: 5 },
    publicSupabaseUrl: "https://example.invalid", tokenHash: "d".repeat(64), candidate: null, resumed: null,
    launchDisk: null, launchJournal: null, finalDump: null };
  const context = { operationId: state.operationId, previousTargetSha: PREVIOUS, targetSha: TARGET, expectedOldSha: OLD,
    expectedRevision: 3, expectedDigest: digest(state), bootId: BOOT, now: NOW,
    sourceDiffDigest: "e".repeat(64), migrationDigest: "f".repeat(64) };
  const inspection = createMaintenanceRecoveryInspection(state, context);
  const evidence = { ...inspection, toolsSha: TARGET, recoveryRunId: "34400000001", recoveryRunAttempt: 1,
    mainCIrunId: "34400000000", historyDigest: "1".repeat(64), historyCheckedAt: NOW - 1000 };
  return { state, context, inspection, evidence };
}
const refresh = f => { f.context.expectedDigest = digest(f.state); };
const recover = f => buildMaintenanceRecoveredState(f.state, f.evidence, f.context);

test("inspection is strictly read-only metadata, never a held receipt or state mutation", () => {
  const f = fixture(), before = copy(f.state);
  assert.equal(f.inspection.state, "recovery-inspected");
  assert.deepEqual(Object.keys(f.inspection), ["version", "state", "operationId", "targetSha", "previousTargetSha", "expectedOldSha", "revision", "stateDigest", "createdAt", "sourceDiffDigest", "migrationDigest"]);
  assert.equal(f.inspection.stateDigest, digest(f.state));
  assert.equal(f.inspection.createdAt, CREATED);
  assert.deepEqual(f.state, before); assert(Object.isFrozen(f.inspection));
  const encoded = JSON.stringify(f.inspection);
  for (const secret of [f.state.tokenHash, "opaque-runtime", "opaque-ingress", BOOT, f.state.publicSupabaseUrl]) assert(!encoded.includes(secret));
});

test("one legal transition changes only version/revision/target/phase and adds the immutable audit", () => {
  const f = fixture(), before = copy(f.state), next = recover(f);
  assert.equal(next.version, 3); assert.equal(next.phase, "held"); assert.equal(next.revision, 4); assert.equal(next.targetSha, TARGET);
  for (const key of Object.keys(f.state).filter(key => !["version", "revision", "targetSha", "phase"].includes(key))) assert.deepEqual(next[key], before[key], key);
  assert.deepEqual(next.recovery, { version: 1, evidence: f.evidence, recoveredAt: NOW });
  assert.deepEqual(f.state, before); assert(Object.isFrozen(next)); assert(Object.isFrozen(next.runtime.nested[0]));
  assert.notEqual(next.runtime, f.state.runtime);
  assertMaintenanceRecoveryProgress(f.state, next);
  assert.deepEqual(validateMaintenanceRecoveryState(next, { bootId: BOOT, now: NOW }), next);
});

test("only virgin v2 failed-held is recoverable, never unknown/held/ended or another recovery", () => {
  for (const phase of ["preparing", "held", "candidate", "resuming", "ended", "failed-unknown"]) {
    const f = fixture(); f.state.phase = phase; refresh(f); reject(() => createMaintenanceRecoveryInspection(f.state, f.context));
  }
  for (const key of ["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"]) {
    const f = fixture(); f.state[key] = {}; refresh(f); reject(() => createMaintenanceRecoveryInspection(f.state, f.context));
  }
  const f = fixture(), next = recover(f);
  reject(() => createMaintenanceRecoveryInspection(next, { ...f.context, expectedRevision: 4, expectedDigest: digest(next) }));
  reject(() => buildMaintenanceRecoveredState(next, f.evidence, f.context));
});

test("U/O/boot/T1/T2/revision and exact original compact-byte digest must match", () => {
  for (const change of [c => { c.operationId = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"; },
    c => { c.expectedOldSha = "9".repeat(40); }, c => { c.previousTargetSha = "9".repeat(40); },
    c => { c.targetSha = PREVIOUS; }, c => { c.targetSha = OLD; }, c => { c.expectedRevision++; },
    c => { c.expectedDigest = "0".repeat(64); }, c => { c.bootId = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"; }]) {
    const f = fixture(); change(f.context); reject(() => createMaintenanceRecoveryInspection(f.state, f.context));
  }
  const f = fixture(); f.state.runtime.nested[0].generation = "replacement";
  reject(() => createMaintenanceRecoveryInspection(f.state, f.context));
  const reordered = Object.fromEntries(Object.entries(f.state).reverse());
  reject(() => createMaintenanceRecoveryInspection(reordered, f.context));
});

test("strict state and context reject missing/extra fields, invalid revisions and unsafe paths", () => {
  for (const mutate of [s => { delete s.tokenHash; }, s => { s.extra = "ignored"; }, s => { s.version = 1; },
    s => { s.revision = Number.MAX_SAFE_INTEGER; }, s => { s.appDir = "/"; }, s => { s.appDir = "/srv/../faolla"; },
    s => { s.appPort = 80; }, s => { s.bootId = "unknown"; }, s => { s.runtime = []; }]) {
    const f = fixture(); mutate(f.state); refresh(f); reject(() => createMaintenanceRecoveryInspection(f.state, f.context));
  }
  for (const mutate of [c => { c.extra = true; }, c => { delete c.now; }, c => { c.expectedRevision = "3"; },
    c => { c.now = NaN; }, c => { c.sourceDiffDigest = "bad"; }]) {
    const f = fixture(); mutate(f.context); reject(() => createMaintenanceRecoveryInspection(f.state, f.context));
  }
});

test("original twelve-hour deadline is preserved, and overflow/future/expired states fail", () => {
  const f = fixture();
  const last = CREATED + 12 * 60 * 60 * 1000;
  const atLimit = { ...f.context, now: last }, evidence = { ...f.evidence, historyCheckedAt: last };
  const next = buildMaintenanceRecoveredState(f.state, evidence, atLimit);
  assert.equal(next.createdAt, CREATED);
  reject(() => validateMaintenanceRecoveryState(next, { bootId: BOOT, now: last + 1 }));
  reject(() => buildMaintenanceRecoveredState(f.state, { ...evidence, historyCheckedAt: last + 1 }, { ...atLimit, now: last + 1 }));
  reject(() => createMaintenanceRecoveryInspection(f.state, { ...f.context, now: CREATED - 1 }));
  reject(() => createMaintenanceRecoveryInspection(f.state, { ...f.context, now: Number.MAX_SAFE_INTEGER }));
});

test("grant must match every inspected field, tools target and canonical run identifiers", () => {
  for (const [key, value] of Object.entries({ operationId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", targetSha: "9".repeat(40),
    previousTargetSha: "9".repeat(40), expectedOldSha: "9".repeat(40), revision: 4, stateDigest: "0".repeat(64),
    createdAt: CREATED + 1, sourceDiffDigest: "0".repeat(64), migrationDigest: "0".repeat(64), toolsSha: PREVIOUS,
    recoveryRunId: 34400000001, recoveryRunAttempt: 2, mainCIrunId: "034400000000", historyDigest: "unknown" })) {
    const f = fixture(); f.evidence[key] = value; reject(() => recover(f));
  }
  const f = fixture(); f.evidence.extra = true; reject(() => recover(f));
});

test("history freshness is five minutes, bounded by original creation and not future", () => {
  const f = fixture();
  assert(buildMaintenanceRecoveredState(f.state, { ...f.evidence, historyCheckedAt: NOW - MAINTENANCE_RECOVERY_HISTORY_MAX_AGE_MS }, f.context));
  for (const checkedAt of [NOW + 1, CREATED - 1, NOW - MAINTENANCE_RECOVERY_HISTORY_MAX_AGE_MS - 1]) {
    reject(() => buildMaintenanceRecoveredState(f.state, { ...f.evidence, historyCheckedAt: checkedAt }, f.context));
  }
});

test("strict canonical evidence codec roundtrips and rejects duplicate keys, reordered JSON and padding", () => {
  const { evidence } = fixture(), encoded = encodeMaintenanceRecoveryEvidence(evidence);
  assert.deepEqual(decodeMaintenanceRecoveryEvidence(encoded), evidence);
  assert(Object.isFrozen(decodeMaintenanceRecoveryEvidence(encoded)));
  const raw = JSON.stringify(evidence), malformed = [raw + "\n", " " + raw,
    raw.replace('"version":1', '"version":1,"version":1'), JSON.stringify(Object.fromEntries(Object.entries(evidence).reverse()))];
  for (const text of malformed) reject(() => decodeMaintenanceRecoveryEvidence(Buffer.from(text).toString("base64url")));
  for (const value of [encoded + "=", "", encoded + "+", "A".repeat(MAINTENANCE_RECOVERY_MAX_EVIDENCE_BYTES + 1),
    Buffer.from([255]).toString("base64url"), Buffer.from("null").toString("base64url")]) reject(() => decodeMaintenanceRecoveryEvidence(value));
  // Object input order does not matter; the encoder always projects the fixed field order.
  assert.equal(encodeMaintenanceRecoveryEvidence(Object.fromEntries(Object.entries(evidence).reverse())), encoded);
});

test("inspection/evidence exact validators reject claimed held status and embedded raw facts", () => {
  const f = fixture();
  for (const value of [{ ...f.inspection, state: "held" }, { ...f.inspection, raw: f.state.runtime }, { ...f.inspection, version: 2 }]) {
    reject(() => validateMaintenanceRecoveryInspection(value));
  }
  reject(() => validateMaintenanceRecoveryEvidence({ ...f.evidence, token: "secret" }));
  reject(() => validateMaintenanceRecoveryEvidence({ ...f.evidence, confirmation: true }));
  assert.deepEqual(validateMaintenanceRecoveryInspection(f.inspection), f.inspection);
});

test("descriptor capture never invokes getters, proxies, toJSON or custom coercion", () => {
  let invoked = 0;
  const f = fixture();
  const getter = copy(f.state); Object.defineProperty(getter.runtime, "secret", { enumerable: true, get() { invoked++; return "secret"; } });
  reject(() => createMaintenanceRecoveryInspection(getter, f.context));
  const proxy = new Proxy(f.state, { ownKeys() { invoked++; return []; } });
  reject(() => createMaintenanceRecoveryInspection(proxy, f.context));
  const withMethod = copy(f.state); withMethod.runtime.toJSON = () => { invoked++; return {}; };
  reject(() => createMaintenanceRecoveryInspection(withMethod, f.context));
  const evidence = copy(f.evidence); Object.defineProperty(evidence, "targetSha", { enumerable: true, get() { invoked++; return TARGET; } });
  reject(() => validateMaintenanceRecoveryEvidence(evidence));
  assert.equal(invoked, 0);
});

test("nested non-JSON values, hidden/symbol fields, sparse arrays, cycles and oversize states fail", () => {
  for (const value of [undefined, Infinity, -0, BigInt(1), new Date(), [, 1], { [Symbol("hidden")]: true }]) {
    const f = fixture(); f.state.runtime.value = value; reject(() => createMaintenanceRecoveryInspection(f.state, f.context));
  }
  const f = fixture(); Object.defineProperty(f.state.runtime, "hidden", { value: 1, enumerable: false });
  reject(() => createMaintenanceRecoveryInspection(f.state, f.context));
  const cycle = fixture(); cycle.state.runtime.self = cycle.state.runtime; reject(() => createMaintenanceRecoveryInspection(cycle.state, cycle.context));
  const large = fixture(); large.state.runtime.raw = "x".repeat(4 * 1024 * 1024);
  reject(() => createMaintenanceRecoveryInspection(large.state, large.context));
});

test("v3 audit validation binds original identity, target, revision and chronology", () => {
  for (const mutate of [s => { delete s.recovery; }, s => { s.recovery = null; }, s => { s.recovery.extra = true; },
    s => { s.recovery.version = 2; }, s => { s.recovery.recoveredAt = NOW + 1; },
    s => { s.recovery.recoveredAt = CREATED; }, s => { s.createdAt++; }, s => { s.targetSha = PREVIOUS; },
    s => { s.revision = 3; }, s => { s.recovery.evidence.operationId = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"; }]) {
    const f = fixture(), next = copy(recover(f)); mutate(next);
    reject(() => validateMaintenanceRecoveryState(next, { bootId: BOOT, now: NOW }));
  }
  reject(() => validateMaintenanceRecoveryState(recover(fixture()), { bootId: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb", now: NOW }));
});

test("storage transition guard rejects forged recovery changes beyond the exact legal conversion", () => {
  for (const mutate of [s => { s.phase = "candidate"; }, s => { s.revision++; }, s => { s.runtime.original = "replacement"; },
    s => { s.ingress.nginx.retiringWorkers.push({ pid: 1 }); }, s => { s.database.databaseOid++; },
    s => { s.tokenHash = "0".repeat(64); }, s => { s.publicSupabaseUrl += "/other"; }, s => { s.appName = "other"; },
    s => { s.bootId = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb"; }, s => { s.candidate = {}; }]) {
    const f = fixture(), next = copy(recover(f)); mutate(next); reject(() => assertMaintenanceRecoveryProgress(f.state, next));
  }
});

test("every later v3 write must retain audit and fixed binding; no silent downgrade or retarget", () => {
  const before = recover(fixture());
  const next = { ...copy(before), revision: before.revision + 1, phase: "failed-held" };
  assertMaintenanceRecoveryProgress(before, next);
  // Existing controlled ingress installation bookkeeping is not prohibited by the audit guard.
  next.ingress.nginx.retiringWorkers.push({ pid: 7 }); assertMaintenanceRecoveryProgress(before, next);
  for (const mutate of [s => { delete s.recovery; }, s => { s.recovery = null; }, s => { s.version = 2; delete s.recovery; },
    s => { s.recovery.evidence.historyDigest = "2".repeat(64); }, s => { s.recovery.recoveredAt++; },
    s => { s.targetSha = "9".repeat(40); }, s => { s.runtime.original = "changed"; },
    s => { s.database.databaseOid++; }, s => { s.createdAt++; }, s => { s.tokenHash = "0".repeat(64); },
    s => { s.revision += 1; }, s => { s.revision -= 1; }]) {
    const bad = copy(next); mutate(bad); reject(() => assertMaintenanceRecoveryProgress(before, bad));
  }
});

test("legacy v2 writes retain existing semantics but cannot hide an audit key", () => {
  const f = fixture(), next = { ...copy(f.state), revision: 4, phase: "held" };
  assertMaintenanceRecoveryProgress(f.state, next);
  reject(() => assertMaintenanceRecoveryProgress(f.state, { ...next, recovery: null }));
  reject(() => assertMaintenanceRecoveryProgress({ ...f.state, version: 1 }, { ...next, version: 1 }));
});

test("pure module has no host operations, ambient clock, retry or audit/nonce generation", () => {
  const source = readFileSync(new URL("./production-maintenance-recovery.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["']node:(?:fs|child_process|http|https|net|tls|process)["']|\b(?:Date\.now|fetch|spawn|execSync|randomUUID|randomBytes|setTimeout)\s*\(/);
  assert.equal(MAINTENANCE_RECOVERY_MAX_EVIDENCE_BYTES, 16384);
  assert.equal(MAINTENANCE_RECOVERY_HISTORY_MAX_AGE_MS, 300000);
});
