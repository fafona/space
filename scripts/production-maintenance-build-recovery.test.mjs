import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { createMaintenanceRecoveryInspection, buildMaintenanceRecoveredState } from "./production-maintenance-recovery.mjs";
import { createMaintenanceContinuationInspection, buildMaintenanceContinuedState,
  assertMaintenanceContinuationProgress } from "./production-maintenance-continuation.mjs";
import { MAINTENANCE_BUILD_RECOVERY_INCIDENT as INCIDENT, MAINTENANCE_BUILD_RECOVERY_MAX_EVIDENCE_BYTES,
  MAINTENANCE_BUILD_RECOVERY_HISTORY_MAX_AGE_MS, createMaintenanceBuildRecoveryInspection,
  validateMaintenanceBuildRecoveryInspection, validateMaintenanceBuildRecoveryEvidence,
  encodeMaintenanceBuildRecoveryEvidence, decodeMaintenanceBuildRecoveryEvidence,
  buildMaintenanceBuildRecoveredState, validateMaintenanceBuildRecoveryState,
  assertMaintenanceBuildRecoveryProgress } from "./production-maintenance-build-recovery.mjs";

const BOOT = "11111111-2222-4333-8444-555555555555", TARGET = "e".repeat(40);
const NOW = INCIDENT.createdAt + 8 * 3600000, DEADLINE = INCIDENT.createdAt + 12 * 3600000;
const PIN = "56d5c39c287ec24ce96fb40943d283bee19a950462e7c384934b6461b42c5ffa";
const originalCreateHash = crypto.createHash;
const actualHash = value => originalCreateHash("sha256").update(JSON.stringify(value)).digest("hex");
const copy = value => structuredClone(value);
const reject = action => assert.throws(action, error => error.message === "maintenance_build_recovery_invalid" && error.cause === undefined);
const clock = now => ({ bootId: BOOT, now });

function syntheticPredecessor() {
  const initial = { version: 2, revision: 3, operationId: INCIDENT.operationId, targetSha: INCIDENT.originalTargetSha,
    expectedOldSha: INCIDENT.expectedOldSha, appDir: "/srv/faolla", appName: "faolla", appPort: 3000, bootId: BOOT,
    createdAt: INCIDENT.createdAt, phase: "failed-held", runtime: { synthetic: true, generations: [{ pid: 77 }] },
    ingress: { synthetic: true, nginx: { retiringWorkers: [] } }, database: { databaseOid: 5 },
    publicSupabaseUrl: "https://example.invalid", tokenHash: "4".repeat(64), candidate: null, resumed: null,
    launchDisk: null, launchJournal: null, finalDump: null };
  const recoveryContext = { operationId: initial.operationId, previousTargetSha: initial.targetSha,
    targetSha: INCIDENT.recoveredTargetSha, expectedOldSha: initial.expectedOldSha, expectedRevision: 3,
    expectedDigest: actualHash(initial), bootId: BOOT, now: INCIDENT.createdAt + 3600000,
    sourceDiffDigest: "5".repeat(64), migrationDigest: "6".repeat(64) };
  const recoveryEvidence = { ...createMaintenanceRecoveryInspection(initial, recoveryContext), toolsSha: INCIDENT.recoveredTargetSha,
    recoveryRunId: "34715768455", recoveryRunAttempt: 1, mainCIrunId: "34715352249", historyDigest: "7".repeat(64),
    historyCheckedAt: recoveryContext.now - 1000 };
  const recovered = buildMaintenanceRecoveredState(initial, recoveryEvidence, recoveryContext);
  const continuationContext = { operationId: initial.operationId, previousTargetSha: recovered.targetSha,
    targetSha: INCIDENT.previousTargetSha, expectedOldSha: initial.expectedOldSha, expectedRevision: 4,
    expectedDigest: actualHash(recovered), bootId: BOOT, now: INCIDENT.createdAt + 2 * 3600000,
    sourceDiffDigest: "8".repeat(64), migrationDigest: "9".repeat(64) };
  const continuationEvidence = { ...createMaintenanceContinuationInspection(recovered, continuationContext), toolsSha: INCIDENT.previousTargetSha,
    continuationRunId: "34724808528", continuationRunAttempt: 1, mainCIrunId: "34724337523", historyDigest: "a".repeat(64),
    historyCheckedAt: continuationContext.now - 1000 };
  const continued = buildMaintenanceContinuedState(recovered, continuationEvidence, continuationContext);
  return { initial, recovered, continued, state: { ...copy(continued), revision: 7, phase: "failed-held" } };
}

// This test never contains private production state. One EXACT synthetic byte
// sequence maps to the separately asserted production pin, in this sequential
// test process only. All other hashes, including the two old audit hashes, use
// real SHA256. There is no production injection/override or wildcard mapping.
test("build-recovery pure contract (isolated exact synthetic digest fixture)", { concurrency: false }, async t => {
  const seed = syntheticPredecessor(), mappedBytes = Buffer.from(JSON.stringify(seed.state));
  t.mock.method(crypto, "createHash", (algorithm, options) => {
    const result = originalCreateHash(algorithm, options), chunks = [];
    const update = result.update.bind(result), digest = result.digest.bind(result);
    result.update = (data, encoding) => { chunks.push(Buffer.from(data, encoding)); update(data, encoding); return result; };
    result.digest = encoding => {
      const actual = digest(encoding);
      return algorithm === "sha256" && encoding === "hex" && Buffer.concat(chunks).equals(mappedBytes) ? PIN : actual;
    };
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    assert.equal(crypto.createHash, originalCreateHash);
    assert.equal(crypto.createHash("sha256").update(mappedBytes).digest("hex"), actualHash(seed.state));
  });
  const fixture = () => {
    const state = copy(seed.state), context = { operationId: INCIDENT.operationId, previousTargetSha: INCIDENT.previousTargetSha,
      targetSha: TARGET, expectedOldSha: INCIDENT.expectedOldSha, expectedRevision: 7, expectedDigest: PIN, bootId: BOOT,
      now: NOW, sourceDiffDigest: "b".repeat(64), migrationDigest: "c".repeat(64) };
    const inspection = createMaintenanceBuildRecoveryInspection(state, context);
    const evidence = { ...inspection, toolsSha: TARGET, buildRecoveryRunId: "34740000001", buildRecoveryRunAttempt: 1,
      mainCIrunId: "34740000000", historyDigest: "d".repeat(64), historyCheckedAt: NOW - 1000 };
    return { state, context, inspection, evidence };
  };
  const build = f => buildMaintenanceBuildRecoveredState(f.state, f.evidence, f.context);

  await t.test("production pin is literal; synthetic mapping affects no other bytes or hash algorithm", () => {
    assert(Object.isFrozen(INCIDENT)); assert.equal(INCIDENT.stateDigest, PIN);
    assert.notEqual(actualHash(seed.state), PIN);
    assert.equal(crypto.createHash("sha256").update(mappedBytes).digest("hex"), PIN);
    for (const bytes of [Buffer.from("unrelated"), Buffer.concat([mappedBytes, Buffer.from(" ")]), Buffer.from(JSON.stringify(seed.recovered))]) {
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), originalCreateHash("sha256").update(bytes).digest("hex"));
    }
    assert.equal(crypto.createHash("sha512").update(mappedBytes).digest("hex"), originalCreateHash("sha512").update(mappedBytes).digest("hex"));
  });

  await t.test("inspection binds both original audits and fixed B3/M/R3/D3 without exposing runtime proof", () => {
    const f = fixture();
    assert.equal(f.inspection.state, "build-recovery-inspected"); assert.equal(f.inspection.revision, 7);
    assert.equal(f.inspection.stateDigest, PIN); assert.equal(f.inspection.recoveryDigest, actualHash(f.state.recovery));
    assert.equal(f.inspection.continuationDigest, actualHash(f.state.continuation));
    assert.equal(f.inspection.backupRunId, "34724943157"); assert.equal(f.inspection.migrationRunId, "34721155156");
    assert.equal(f.inspection.readinessRunId, "34728212357"); assert.equal(f.inspection.failedDeployRunId, "34728263285");
    assert.deepEqual(Object.keys(f.inspection), ["version", "state", "operationId", "targetSha", "previousTargetSha", "expectedOldSha",
      "revision", "stateDigest", "createdAt", "sourceDiffDigest", "migrationDigest", "recoveryDigest", "continuationDigest",
      "backupRunId", "backupRunAttempt", "migrationRunId", "migrationRunAttempt", "readinessRunId", "readinessRunAttempt",
      "failedDeployRunId", "failedDeployRunAttempt"]); assert(Object.isFrozen(f.inspection));
    assert.deepEqual(validateMaintenanceBuildRecoveryInspection(f.inspection), f.inspection);
    for (const value of [BOOT, f.state.tokenHash, f.state.publicSupabaseUrl, "generations", "retiringWorkers"]) assert(!JSON.stringify(f.inspection).includes(value));
    assert.deepEqual(f.state, seed.state);
  });

  await t.test("one v4 failed-held to v5 held transition preserves full audits, proof and original deadline", () => {
    const f = fixture(), before = copy(f.state), next = build(f);
    assert.equal(next.version, 5); assert.equal(next.revision, 8); assert.equal(next.phase, "held"); assert.equal(next.targetSha, TARGET);
    for (const key of Object.keys(before).filter(key => !["version", "revision", "phase", "targetSha"].includes(key))) assert.deepEqual(next[key], before[key], key);
    assert.deepEqual(next.buildRecovery, { version: 1, evidence: f.evidence, recoveredAt: NOW });
    assert.equal(JSON.stringify(next.recovery), JSON.stringify(before.recovery)); assert.equal(JSON.stringify(next.continuation), JSON.stringify(before.continuation));
    assert.notEqual(next.runtime, f.state.runtime); assert(Object.isFrozen(next.runtime.generations[0]));
    assert(Object.isFrozen(next.buildRecovery.evidence)); assert.deepEqual(f.state, before);
    assertMaintenanceBuildRecoveryProgress(f.state, next); assert.deepEqual(validateMaintenanceBuildRecoveryState(next, clock(NOW)), next);
    reject(() => buildMaintenanceBuildRecoveredState(next, f.evidence, f.context));
  });

  await t.test("only fixed v4 failed-held revision7 and all five null launch fields can be inspected", () => {
    for (const patch of [{ version: 3 }, { version: 5 }, { revision: 6 }, { revision: 8 },
      ...["preparing", "held", "candidate", "resuming", "ended", "failed-unknown"].map(phase => ({ phase })),
      ...["candidate", "resumed", "launchDisk", "launchJournal", "finalDump"].map(key => ({ [key]: {} }))]) {
      const f = fixture(); Object.assign(f.state, patch); reject(() => createMaintenanceBuildRecoveryInspection(f.state, f.context));
    }
  });

  await t.test("fixed incident, boot, whole-state bytes and expected digest cannot be substituted", () => {
    for (const patch of [{ operationId: "aaaaaaaa-2222-4222-8222-bbbbbbbbbbbb" }, { expectedOldSha: "0".repeat(40) },
      { targetSha: INCIDENT.recoveredTargetSha }, { createdAt: INCIDENT.createdAt + 1 }, { bootId: "aaaaaaaa-2222-4222-8222-bbbbbbbbbbbb" }]) {
      const f = fixture(); Object.assign(f.state, patch); reject(() => createMaintenanceBuildRecoveryInspection(f.state, f.context));
    }
    const f = fixture(); f.state.runtime.generations[0].pid++; reject(() => createMaintenanceBuildRecoveryInspection(f.state, f.context));
    f.context.expectedDigest = actualHash(f.state); reject(() => createMaintenanceBuildRecoveryInspection(f.state, f.context));
    const reordered = Object.fromEntries(Object.entries(seed.state).reverse());
    reject(() => createMaintenanceBuildRecoveryInspection(reordered, fixture().context));
    for (const key of Object.keys(f.context)) {
      const bad = fixture(); bad.context[key] = key === "now" || key === "expectedRevision" ? -1 : "unexpected";
      reject(() => createMaintenanceBuildRecoveryInspection(bad.state, bad.context));
    }
  });

  await t.test("new target excludes O/T1/T2/T3 and canonical values never trim or coerce", () => {
    for (const targetSha of [INCIDENT.originalTargetSha, INCIDENT.recoveredTargetSha, INCIDENT.previousTargetSha, INCIDENT.expectedOldSha,
      "E".repeat(40), TARGET + "\n", " " + TARGET, "e".repeat(39), 123, { toString() { throw Error("never"); } }]) {
      const f = fixture(); f.context.targetSha = targetSha; reject(() => createMaintenanceBuildRecoveryInspection(f.state, f.context));
    }
    for (const patch of [{ historyDigest: "d".repeat(64) + "\n" }, { mainCIrunId: "34740000000\n" }, { buildRecoveryRunId: "034740000001" }]) {
      reject(() => validateMaintenanceBuildRecoveryEvidence({ ...fixture().evidence, ...patch }));
    }
  });

  await t.test("all original audit members and historical recovery/continuation identities are checked", () => {
    for (const key of ["recovery", "continuation"]) {
      for (const mutate of [audit => { audit.version = 2; }, audit => { audit.extra = true; },
        audit => { audit.evidence.historyDigest = "0".repeat(64); }, audit => { audit.evidence.targetSha = TARGET; },
        audit => { audit.evidence.previousTargetSha = "0".repeat(40); }, audit => { audit.evidence.mainCIrunId = "123"; },
        audit => { audit.evidence[key === "recovery" ? "recoveryRunId" : "continuationRunId"] = "124"; }]) {
        const f = fixture(); mutate(f.state[key]); reject(() => createMaintenanceBuildRecoveryInspection(f.state, f.context));
      }
      const f = fixture(); delete f.state[key]; reject(() => createMaintenanceBuildRecoveryInspection(f.state, f.context));
    }
  });

  await t.test("fixed historical B/M/R/D IDs and attempts cannot be selected by the caller", () => {
    for (const key of ["backupRunId", "migrationRunId", "readinessRunId", "failedDeployRunId"]) {
      for (const value of ["123", Number(INCIDENT[key]), "0" + INCIDENT[key]]) reject(() => validateMaintenanceBuildRecoveryEvidence({ ...fixture().evidence, [key]: value }));
    }
    for (const key of ["backupRunAttempt", "migrationRunAttempt", "readinessRunAttempt", "failedDeployRunAttempt"]) {
      for (const value of [2, 0, "1", null]) reject(() => validateMaintenanceBuildRecoveryEvidence({ ...fixture().evidence, [key]: value }));
    }
  });

  await t.test("grant matches every inspected field, tools SHA and distinct new workflow identities", () => {
    for (const [key, value] of Object.entries({ sourceDiffDigest: "0".repeat(64), migrationDigest: "0".repeat(64), recoveryDigest: "0".repeat(64),
      continuationDigest: "0".repeat(64), stateDigest: "0".repeat(64), revision: 8, createdAt: INCIDENT.createdAt + 1,
      toolsSha: INCIDENT.previousTargetSha, buildRecoveryRunAttempt: 2, historyDigest: "invalid" })) {
      const f = fixture(); f.evidence[key] = value; reject(() => build(f));
    }
    for (const prior of ["34715768455", "34715352249", "34715932102", "34721155156", "34721256683", "34721317710",
      "34724808528", "34724337523", "34724943157", "34728212357", "34728263285"]) {
      for (const key of ["buildRecoveryRunId", "mainCIrunId"]) reject(() => validateMaintenanceBuildRecoveryEvidence({ ...fixture().evidence, [key]: prior }));
    }
    const f = fixture(); f.evidence.buildRecoveryRunId = f.evidence.mainCIrunId; reject(() => build(f));
  });

  await t.test("history is fresh, not future, and cannot predate the original continuation", () => {
    const f = fixture();
    assert(buildMaintenanceBuildRecoveredState(f.state, { ...f.evidence, historyCheckedAt: NOW - 300000 }, f.context));
    for (const historyCheckedAt of [NOW + 1, NOW - 300001, INCIDENT.createdAt - 1]) reject(() => buildMaintenanceBuildRecoveredState(f.state, { ...f.evidence, historyCheckedAt }, f.context));
    f.context.now = f.state.continuation.continuedAt + 1000; f.evidence.historyCheckedAt = f.state.continuation.continuedAt - 1;
    reject(() => build(f));
  });

  await t.test("the original twelve-hour TTL is never restarted by any of the three audits", () => {
    const f = fixture(), next = buildMaintenanceBuildRecoveredState(f.state, { ...f.evidence, historyCheckedAt: DEADLINE }, { ...f.context, now: DEADLINE });
    assert.equal(next.createdAt, INCIDENT.createdAt); assert.equal(next.buildRecovery.recoveredAt, DEADLINE);
    reject(() => validateMaintenanceBuildRecoveryState(next, clock(DEADLINE + 1)));
    reject(() => buildMaintenanceBuildRecoveredState(f.state, { ...f.evidence, historyCheckedAt: DEADLINE }, { ...f.context, now: DEADLINE + 1 }));
    for (const now of [INCIDENT.createdAt - 1, Number.MAX_SAFE_INTEGER, NaN, Infinity, -0]) reject(() => createMaintenanceBuildRecoveryInspection(f.state, { ...f.context, now }));
    reject(() => validateMaintenanceBuildRecoveryState(build(f), { ...clock(NOW), extra: true }));
  });

  await t.test("exact bounded records refuse omitted, extra, raw-report and malformed nested members", () => {
    const f = fixture();
    for (const patch of [{ version: 2 }, { state: "held" }, { raw: f.state.runtime }, { confirmed: true }]) reject(() => validateMaintenanceBuildRecoveryInspection({ ...f.inspection, ...patch }));
    for (const key of Object.keys(f.evidence)) { const bad = copy(f.evidence); delete bad[key]; reject(() => validateMaintenanceBuildRecoveryEvidence(bad)); }
    reject(() => validateMaintenanceBuildRecoveryEvidence({ ...f.evidence, raw: "secret" }));
    reject(() => validateMaintenanceBuildRecoveryEvidence({ ...f.evidence, historyDigest: "a".repeat(16385) }));
    reject(() => createMaintenanceBuildRecoveryInspection(f.state, { ...f.context, ready: true }));
  });

  await t.test("canonical base64url rejects duplicate or reordered JSON, whitespace, padding and invalid UTF8", () => {
    const f = fixture(), encoded = encodeMaintenanceBuildRecoveryEvidence(f.evidence), raw = JSON.stringify(f.evidence);
    assert.deepEqual(decodeMaintenanceBuildRecoveryEvidence(encoded), f.evidence); assert(Object.isFrozen(decodeMaintenanceBuildRecoveryEvidence(encoded)));
    assert.equal(encodeMaintenanceBuildRecoveryEvidence(Object.fromEntries(Object.entries(f.evidence).reverse())), encoded);
    for (const text of [raw + "\n", raw.replace('"version":1', '"version":1,"version":1'), JSON.stringify(Object.fromEntries(Object.entries(f.evidence).reverse())), "null"]) {
      reject(() => decodeMaintenanceBuildRecoveryEvidence(Buffer.from(text).toString("base64url")));
    }
    for (const text of [encoded + "=", encoded + "+", encoded + "\n", "", "A".repeat(16385), Buffer.from([255]).toString("base64url")]) reject(() => decodeMaintenanceBuildRecoveryEvidence(text));
  });

  await t.test("descriptor capture runs no getter, proxy, coercion or toJSON and rejects hidden fields", () => {
    const f = fixture(); let reads = 0;
    const getter = copy(f.state); Object.defineProperty(getter.continuation, "version", { enumerable: true, get() { reads++; return 1; } });
    reject(() => createMaintenanceBuildRecoveryInspection(getter, f.context));
    reject(() => createMaintenanceBuildRecoveryInspection(new Proxy(f.state, { ownKeys() { reads++; return []; } }), f.context));
    const method = copy(f.state); method.runtime.toJSON = () => { reads++; return {}; }; reject(() => createMaintenanceBuildRecoveryInspection(method, f.context));
    const evidence = copy(f.evidence); Object.defineProperty(evidence, "targetSha", { enumerable: true, get() { reads++; return TARGET; } });
    reject(() => validateMaintenanceBuildRecoveryEvidence(evidence)); assert.equal(reads, 0);
    const hidden = copy(f.state); Object.defineProperty(hidden.runtime, "hidden", { value: 1 }); reject(() => createMaintenanceBuildRecoveryInspection(hidden, f.context));
  });

  await t.test("non-JSON, sparse, cyclic, symbolic, custom-prototype and excessive proof values fail closed", () => {
    for (const value of [undefined, -0, Infinity, BigInt(1), new Date(), [, 1], { [Symbol("x")]: true }, Object.create({ custom: true }),
      Object.setPrototypeOf([], { custom: true }), new Array(100001)]) {
      const f = fixture(); f.state.runtime.value = value; reject(() => createMaintenanceBuildRecoveryInspection(f.state, f.context));
    }
    const cycle = fixture(); cycle.state.runtime.self = cycle.state.runtime; reject(() => createMaintenanceBuildRecoveryInspection(cycle.state, cycle.context));
    const large = fixture(); large.state.runtime.raw = "x".repeat(4 * 1024 * 1024); reject(() => createMaintenanceBuildRecoveryInspection(large.state, large.context));
    const nullProto = fixture(); Object.setPrototypeOf(nullProto.state.runtime, null);
    assert.deepEqual(createMaintenanceBuildRecoveryInspection(nullProto.state, nullProto.context), nullProto.inspection);
  });

  await t.test("initial v5 validator requires held/revision8/five nulls, real T4 and all three valid audits", () => {
    for (const mutate of [s => { s.version = 4; }, s => { s.revision = 7; }, s => { s.phase = "failed-held"; }, s => { s.candidate = {}; },
      s => { s.targetSha = INCIDENT.previousTargetSha; }, s => { delete s.buildRecovery; }, s => { s.buildRecovery.extra = true; },
      s => { s.buildRecovery.recoveredAt = NOW + 1; }, s => { s.buildRecovery.evidence.continuationDigest = "0".repeat(64); },
      s => { s.recovery.evidence.historyDigest = "0".repeat(64); }, s => { s.continuation.evidence.historyDigest = "0".repeat(64); },
      s => { s.createdAt++; }, s => { s.unknown = true; }]) {
      const next = copy(build(fixture())); mutate(next); reject(() => validateMaintenanceBuildRecoveryState(next, clock(NOW)));
    }
    reject(() => validateMaintenanceBuildRecoveryState(build(fixture()), { bootId: "aaaaaaaa-2222-4222-8222-bbbbbbbbbbbb", now: NOW }));
  });

  await t.test("single transition cannot smuggle simultaneous proof changes or even allowed later ingress bookkeeping", () => {
    for (const mutate of [s => { s.runtime.generations[0].pid++; }, s => { s.database.databaseOid++; },
      s => { s.ingress.nginx.retiringWorkers.push({ pid: 8 }); }, s => { s.tokenHash = "0".repeat(64); },
      s => { s.appName = "other"; }, s => { s.revision++; }, s => { s.launchJournal = {}; },
      s => { s.recovery.recoveredAt++; }, s => { s.continuation.continuedAt++; }]) {
      const f = fixture(), next = copy(build(f)); mutate(next); reject(() => assertMaintenanceBuildRecoveryProgress(f.state, next));
    }
  });

  await t.test("later v5 writes freeze every original binding and all three complete audits", () => {
    const previous = build(fixture()), next = { ...copy(previous), revision: 9, phase: "failed-held" };
    next.ingress.nginx.retiringWorkers.push({ pid: 9 }); assertMaintenanceBuildRecoveryProgress(previous, next);
    for (const key of ["operationId", "targetSha", "expectedOldSha", "appDir", "appName", "appPort", "bootId", "createdAt", "tokenHash", "publicSupabaseUrl", "runtime", "database", "recovery", "continuation", "buildRecovery"]) {
      const bad = copy(next); bad[key] = typeof bad[key] === "number" ? bad[key] + 1 : typeof bad[key] === "string" ? bad[key] + "x" : { replaced: true };
      reject(() => assertMaintenanceBuildRecoveryProgress(previous, bad));
    }
    for (const mutate of [s => { delete s.buildRecovery; }, s => { delete s.continuation; }, s => { delete s.recovery; },
      s => { s.version = 4; delete s.buildRecovery; }, s => { s.version = 3; delete s.buildRecovery; delete s.continuation; },
      s => { s.revision++; }, s => { s.revision--; }]) { const bad = copy(next); mutate(bad); reject(() => assertMaintenanceBuildRecoveryProgress(previous, bad)); }
  });

  await t.test("later launch bookkeeping uses actual T4, never the local audit-validation projection T3", () => {
    const initial = build(fixture());
    // Opaque fixtures only: existing controller/PM2 validators remain mandatory.
    const planned = { ...copy(initial), revision: 9, launchDisk: { targetSha: TARGET }, launchJournal: { targetSha: TARGET } };
    assertMaintenanceBuildRecoveryProgress(initial, planned);
    const candidate = { ...copy(planned), revision: 10, phase: "candidate", candidate: { targetSha: TARGET } };
    assertMaintenanceBuildRecoveryProgress(planned, candidate);
    const validated = validateMaintenanceBuildRecoveryState(candidate, clock(NOW));
    assert.equal(validated.targetSha, TARGET); assert.equal(validated.candidate.targetSha, TARGET);
    assert.equal(validated.recovery.evidence.targetSha, INCIDENT.recoveredTargetSha);
    assert.equal(validated.continuation.evidence.targetSha, INCIDENT.previousTargetSha);
  });

  await t.test("old v2/v3/v4 transitions are delegated unchanged, not upgraded or relaxed", () => {
    assertMaintenanceBuildRecoveryProgress(seed.initial, { ...seed.initial, revision: 4 });
    assertMaintenanceBuildRecoveryProgress(seed.initial, seed.recovered);
    assertMaintenanceBuildRecoveryProgress(seed.recovered, seed.continued);
    const later = { ...copy(seed.continued), revision: 6, phase: "failed-held" };
    assertMaintenanceContinuationProgress(seed.continued, later); assertMaintenanceBuildRecoveryProgress(seed.continued, later);
    const bad = copy(later); bad.continuation.evidence.historyDigest = "0".repeat(64);
    assert.throws(() => assertMaintenanceBuildRecoveryProgress(seed.continued, bad), /maintenance_continuation_invalid/);
    reject(() => assertMaintenanceBuildRecoveryProgress(seed.initial, { ...seed.initial, buildRecovery: null }));
    reject(() => assertMaintenanceBuildRecoveryProgress(seed.recovered, build(fixture())));
  });

  await t.test("production API has no hash override, host calls, implicit clock, retry or persistence", () => {
    const source = readFileSync(new URL("./production-maintenance-build-recovery.mjs", import.meta.url), "utf8");
    assert(source.includes(PIN)); assert.doesNotMatch(source, /synthetic|mock|overrideHash|expectedHashCallback/);
    assert.doesNotMatch(source, /from ["']node:(?:fs|child_process|http|https|net|tls|process)["']|\b(?:Date\.now|fetch|spawn|execSync|randomUUID|randomBytes|setTimeout)\s*\(/);
    assert.equal(MAINTENANCE_BUILD_RECOVERY_MAX_EVIDENCE_BYTES, 16384); assert.equal(MAINTENANCE_BUILD_RECOVERY_HISTORY_MAX_AGE_MS, 300000);
  });
});
