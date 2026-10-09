import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { RETENTION_DISPOSAL_FIELDS, RETENTION_DISPOSAL_INPUT_PROTOCOL, RETENTION_DISPOSAL_PREVIEW_PROTOCOL,
  evaluateRetentionDisposal, evaluateRetentionDisposalCandidates, parseRetentionDisposalInput, parseRetentionDisposalInputJson,
  type RetentionDisposalInput } from "./merchantAttendanceRetentionDisposal";

// Synthetic metadata only. Neither these values nor the computed hashes prove
// actual source/holds/authorization. There is no SQL, network or disposal here.
const id = (n: number) => `24300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zero = () => ({ revision: 0, held: false, operationId: null, recordedAt: null });
function input() {
  return {
    protocol: RETENTION_DISPOSAL_INPUT_PROTOCOL, siteId: "99990001", asOf: "2026-10-08T12:00:00.123456Z",
    location: { evidenceId: id(1), workerId: id(2), sourceFingerprint: "a".repeat(64), anchorAt: "2026-10-07T12:00:00.123456Z", reason: "inside", needsReview: false,
      precisionPresent: { capturedAt: true, accuracyMeters: true, distanceMeters: true } },
    policy: { category: "location_results", revision: 1, retentionDays: 1 as number | null, operationId: id(3) as string | null, recordedAt: "2026-10-01T00:00:00.000000Z" as string | null },
    dependencies: {
      session: { state: "closed", sessionId: id(4) as string | null, sourceFingerprint: "b".repeat(64) as string | null },
      review: { coverage: "complete", hasReview: false, hasDiscussion: false },
      locationSnapshotHistory: { coverage: "complete", hasAnySnapshot: false },
      artifacts: { coverage: "complete", items: [{ artifactId: id(5), sourceFingerprint: "c".repeat(64) }] },
    },
    preservation: { coverage: "complete", location: zero() as { revision: number; held: boolean; operationId: string | null; recordedAt: string | null },
      event: zero() as { revision: number; held: boolean; operationId: string | null; recordedAt: string | null },
      artifacts: [{ artifactId: id(5), ...zero() }] as { artifactId: string; revision: number; held: boolean; operationId: string | null; recordedAt: string | null }[] },
  };
}
const rejected = (raw: unknown) => assert.throws(() => parseRetentionDisposalInput(raw), /attendance_retention_disposal_invalid/);
const held = () => ({ revision: 1, held: true, operationId: id(6), recordedAt: "2026-10-08T11:00:00.000000Z" });
const released = () => ({ revision: 2, held: false, operationId: id(7), recordedAt: "2026-10-08T11:30:00.000000Z" });
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

test("disposal exact candidate is metadata-only, caller-claimed and never authority or execution", async () => {
  const result = await evaluateRetentionDisposal(input());
  assert.deepEqual(Object.keys(result).sort(), ["protocol", "status", "candidateOnly", "authorityChecked", "applied", "evidenceOrigin", "sourceFingerprintVerified",
    "siteId", "asOf", "evidenceId", "workerId", "fields", "candidateState", "evidenceCompleteness", "dueAt", "blockers", "sourceFingerprint",
    "policyFingerprint", "dependencyFingerprint", "holdFingerprint", "previewFingerprint"].sort());
  assert.equal(result.protocol, RETENTION_DISPOSAL_PREVIEW_PROTOCOL); assert.equal(result.status, "preview_only");
  assert.equal(result.candidateOnly, true); assert.equal(result.authorityChecked, false); assert.equal(result.applied, false);
  assert.equal(result.evidenceOrigin, "caller_provided"); assert.equal(result.sourceFingerprintVerified, false);
  assert.equal(result.candidateState, "candidate"); assert.equal(result.evidenceCompleteness, "caller_claimed_complete"); assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.fields, ["captured_at", "accuracy_meters", "distance_meters"]);
  for (const key of ["source", "capturedAt", "accuracyMeters", "distanceMeters", "approvalId", "operationId", "canExecute", "authorized"]) assert.equal(Object.hasOwn(result, key), false);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.fields) && Object.isFrozen(result.blockers));
});

test("disposal matches retention fixed-day microsecond equality without consulting current/local time", async t => {
  t.mock.method(Date, "now", () => { throw Error("no implicit clock"); });
  for (const method of ["getDate", "getMonth", "getFullYear", "getHours"] as const) t.mock.method(Date.prototype, method, () => { throw Error("no host timezone"); });
  const value = input(); assert.equal((await evaluateRetentionDisposal(value)).dueAt, value.asOf);
  value.asOf = "2026-10-08T12:00:00.123455Z"; assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, ["not_due"]);
  value.asOf = "2026-10-08T12:00:00.123457Z"; assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, []);
  value.location.anchorAt = "2026-03-28T12:00:00.000999Z"; value.asOf = "2026-03-29T12:00:00.000999Z"; value.policy.recordedAt = "2026-03-01T00:00:00.000000Z";
  assert.equal((await evaluateRetentionDisposal(value)).dueAt, value.asOf);
});

test("disposal never supplies a default retention period for absent or explicitly unconfigured policy", async () => {
  for (const revision of [0, 2]) {
    const value = input(); value.policy.retentionDays = null; value.policy.revision = revision;
    if (!revision) { value.policy.operationId = null; value.policy.recordedAt = null; }
    const result = await evaluateRetentionDisposal(value); assert.equal(result.dueAt, null); assert.deepEqual(result.blockers, ["policy_unconfigured"]);
  }
  for (const days of [0, -1, 36501, 1.2, Number.NaN, -0]) { const value = input(); value.policy.retentionDays = days; rejected(value); }
  const max = input(); max.policy.retentionDays = 36500; assert.equal((await evaluateRetentionDisposal(max)).dueAt, "2126-09-13T12:00:00.123456Z");
});

test("disposal limits classification and all three present fields without copying their values", async () => {
  for (const reason of ["outside", "uncertain", "stale", "future", "denied", "timeout", "unavailable", "unsupported", "not_provided"]) {
    const value = input(); value.location.reason = reason; value.location.needsReview = true;
    assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, ["not_inside"]);
  }
  for (const key of ["capturedAt", "accuracyMeters", "distanceMeters"] as const) {
    const value = input(); value.location.precisionPresent[key] = false; assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, ["precision_not_present"]);
  }
  const invalid = input(); invalid.location.needsReview = true; rejected(invalid);
});

test("disposal open or unknown original session blocks, with unknown references explicit null", async () => {
  const open = input(); open.dependencies.session.state = "open"; assert.deepEqual((await evaluateRetentionDisposal(open)).blockers, ["session_not_closed"]);
  const unknown = input(); unknown.dependencies.session = { state: "unknown", sessionId: null, sourceFingerprint: null };
  const result = await evaluateRetentionDisposal(unknown); assert.deepEqual(result.blockers, ["session_not_closed"]); assert.equal(result.evidenceCompleteness, "incomplete");
  unknown.dependencies.session.sessionId = id(4); rejected(unknown);
  const bad = input(); bad.dependencies.session.sourceFingerprint = null; rejected(bad);
});

test("disposal blocks each missing completeness assertion instead of treating a first page as complete", async () => {
  for (const mode of ["unknown", "over_limit"]) {
    for (const [key, reason] of [["review", "review_incomplete"], ["locationSnapshotHistory", "snapshot_history_incomplete"], ["artifacts", "artifact_dependencies_incomplete"]] as const) {
      const value = input(); value.dependencies[key].coverage = mode; const result = await evaluateRetentionDisposal(value);
      assert.deepEqual(result.blockers, [reason]); assert.equal(result.evidenceCompleteness, "incomplete");
    }
    const value = input(); value.preservation.coverage = mode; assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, ["holds_incomplete"]);
  }
  const empty = input(); empty.dependencies.artifacts.items = []; empty.preservation.artifacts = [];
  assert.equal((await evaluateRetentionDisposal(empty)).candidateState, "candidate");
  empty.dependencies.artifacts.coverage = "unknown"; assert.equal((await evaluateRetentionDisposal(empty)).candidateState, "blocked");
});

test("disposal review/discussion and historical location snapshots remain blockers after release", async () => {
  for (const key of ["hasReview", "hasDiscussion"] as const) { const value = input(); value.dependencies.review[key] = true;
    assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, [key === "hasReview" ? "location_review" : "location_discussion"]); }
  const value = input(); value.dependencies.locationSnapshotHistory.hasAnySnapshot = true; value.preservation.location = released();
  assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, ["historical_location_snapshot"]);
  value.preservation.location = held(); assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, ["historical_location_snapshot", "location_held"]);
  value.dependencies.locationSnapshotHistory.hasAnySnapshot = false; rejected(value);
  const impossible = input(); impossible.dependencies.locationSnapshotHistory.hasAnySnapshot = true; rejected(impossible);
});

test("disposal original event and any referenced artifact hold independently block", async () => {
  const value = input(); value.preservation.event = held(); assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, ["event_held"]);
  value.preservation.event = released(); assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, []);
  value.preservation.artifacts[0] = { artifactId: id(5), ...held() }; assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, ["artifact_held"]);
  value.preservation.artifacts[0] = { artifactId: id(5), ...released() }; assert.deepEqual((await evaluateRetentionDisposal(value)).blockers, []);
});

test("disposal exact artifact dependency/hold sets are sorted, bounded and cannot omit a hold", () => {
  const value = input(); value.dependencies.artifacts.items = Array.from({ length: 25 }, (_, i) => ({ artifactId: id(100 + i), sourceFingerprint: "d".repeat(64) }));
  value.preservation.artifacts = value.dependencies.artifacts.items.map(a => ({ artifactId: a.artifactId, ...zero() }));
  assert.equal(parseRetentionDisposalInput(value).dependencies.artifacts.items.length, 25);
  const omitted = structuredClone(value); omitted.preservation.artifacts.pop(); rejected(omitted);
  const mismatch = structuredClone(value); mismatch.preservation.artifacts[0].artifactId = id(999); rejected(mismatch);
  const unsorted = structuredClone(value); unsorted.dependencies.artifacts.items.reverse(); unsorted.preservation.artifacts.reverse(); rejected(unsorted);
  const duplicate = structuredClone(value); duplicate.dependencies.artifacts.items[1] = duplicate.dependencies.artifacts.items[0]; duplicate.preservation.artifacts[1] = duplicate.preservation.artifacts[0]; rejected(duplicate);
  value.dependencies.artifacts.items.push({ artifactId: id(125), sourceFingerprint: "d".repeat(64) }); value.preservation.artifacts.push({ artifactId: id(125), ...zero() }); rejected(value);
});

test("disposal input IDs, instants, revisions and snapshot nullability are exact", () => {
  for (const tail of ["\n", "\r\n", "\u2028", "\0", "\ud800"]) { const value = input(); value.location.evidenceId += tail; rejected(value); }
  for (const at of ["2026-02-29T00:00:00.000000Z", "0000-01-01T00:00:00.000000Z", "2026-10-08T12:00:00.123Z", "2026-10-08T12:00:00.123456+00:00"]) { const value = input(); value.asOf = at; rejected(value); }
  const future = input(); future.policy.recordedAt = "2026-10-08T12:00:00.123457Z"; rejected(future);
  const futureHold = input(); futureHold.preservation.event = { ...held(), recordedAt: "2026-10-08T12:00:00.123457Z" }; rejected(futureHold);
  const rev = input(); rev.preservation.event = { ...released(), revision: 1 }; rejected(rev);
  const rev0 = input(); rev0.preservation.event = { ...held(), revision: 0 }; rejected(rev0);
  for (const revision of [-1, 9007199254740991, 1.5]) { const value = input(); value.policy.revision = revision; rejected(value); }
  const missingOp = input(); missingOp.policy.operationId = null; rejected(missingOp);
  const zeroPolicy = input(); zeroPolicy.policy.revision = 0; rejected(zeroPolicy);
});

test("disposal does not truncate an unrepresentable due instant", async () => {
  const value = input(); value.location.anchorAt = value.asOf = "9999-12-31T23:59:59.999999Z";
  await assert.rejects(evaluateRetentionDisposal(value), /attendance_retention_disposal_invalid/);
});

test("disposal fingerprints use fixed scalar tuples independently of object-key order", async () => {
  const raw = input(), result = await evaluateRetentionDisposal(raw);
  const expectedPolicy = `["attendance-retention-disposal-policy-v1", "99990001", ["location_results", 1, 1, "${id(3)}", "2026-10-01T00:00:00.000000Z"]]`;
  assert.equal(result.policyFingerprint, sha(expectedPolicy));
  // A literal independent fixed vector catches accidental object JSON or spacing drift.
  assert.equal(result.policyFingerprint, "8e4b49a38805ad1388831ab2c1a1ceb538d9a27e2f5cef31901071bf775ec965");
  const reversed = Object.fromEntries(Object.entries(raw).reverse()); assert.deepEqual(await evaluateRetentionDisposal(reversed), result);
  assert.ok([result.policyFingerprint, result.dependencyFingerprint, result.holdFingerprint, result.previewFingerprint].every(v => /^[0-9a-f]{64}$/.test(v)));
});

test("disposal source/policy/dependency/hold changes alter only the applicable digest and preview binding", async () => {
  const baseline = await evaluateRetentionDisposal(input());
  const variants = [
    { edit: (v: ReturnType<typeof input>) => { v.location.sourceFingerprint = "e".repeat(64); }, changed: null },
    { edit: (v: ReturnType<typeof input>) => { v.policy.revision = 2; v.policy.operationId = id(8); }, changed: "policyFingerprint" },
    { edit: (v: ReturnType<typeof input>) => { v.dependencies.artifacts.items[0].sourceFingerprint = "e".repeat(64); }, changed: "dependencyFingerprint" },
    { edit: (v: ReturnType<typeof input>) => { v.preservation.event = released(); }, changed: "holdFingerprint" },
  ] as const;
  for (const variant of variants) { const value = input(); variant.edit(value); const result = await evaluateRetentionDisposal(value);
    assert.notEqual(result.previewFingerprint, baseline.previewFingerprint);
    for (const key of ["policyFingerprint", "dependencyFingerprint", "holdFingerprint"] as const) assert.equal(result[key] !== baseline[key], key === variant.changed);
    assert.equal(result.authorityChecked, false); assert.equal(result.sourceFingerprintVerified, false);
  }
});

test("disposal copies/freezes all metadata before asynchronous hashing", async t => {
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle), raw = input();
  const baseline = await evaluateRetentionDisposal(raw); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis.crypto.subtle, "digest", async (...args: Parameters<SubtleCrypto["digest"]>) => { await gate; return digest(...args); });
  const pending = evaluateRetentionDisposal(raw); raw.location.sourceFingerprint = "f".repeat(64); raw.policy.retentionDays = null; raw.dependencies.artifacts.items.length = 0;
  release(); assert.deepEqual(await pending, baseline);
  const parsed = parseRetentionDisposalInput(input()); assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.dependencies.artifacts.items[0]));
  assert.throws(() => { (parsed as { siteId: string }).siteId = "00000001"; });
});

test("disposal exact trees reject getters, cycles, prototypes, sparse/extra arrays and huge keys without getter calls", () => {
  let calls = 0; const getter = { ...input() }; Object.defineProperty(getter, "location", { enumerable: true, get() { calls++; throw Error("getter executed"); } }); rejected(getter); assert.equal(calls, 0);
  const keyGetter = { ...input() }; Object.defineProperty(keyGetter, "x".repeat(65537), { enumerable: true, get() { calls++; return 0; } }); rejected(keyGetter); assert.equal(calls, 0);
  rejected({ ...input(), [Symbol("hidden")]: true }); rejected(Object.assign(Object.create({}), input()));
  const cyclic: Record<string, unknown> = { ...input() }; cyclic.location = cyclic; rejected(cyclic);
  const sparse = input(); sparse.dependencies.artifacts.items = Array(1); rejected(sparse);
  const extra = input(); Object.assign(extra.dependencies.artifacts.items, { note: "extra" }); rejected(extra);
  const nonEnumerable = input(); Object.defineProperty(nonEnumerable.location, "evidenceId", { value: id(1), enumerable: false }); rejected(nonEnumerable);
  for (const value of [undefined, () => null, BigInt(1), Infinity]) rejected({ ...input(), extra: value });
  const missing = { ...input() } as Record<string, unknown>; delete missing.policy; rejected(missing);
});

test("disposal JSON rejects duplicate/escaped-duplicate keys, invalid Unicode, body and nesting overflow", () => {
  const text = JSON.stringify(input()); assert.deepEqual(parseRetentionDisposalInputJson(text), parseRetentionDisposalInput(input()));
  for (const value of [text.replace('"siteId":', '"siteId":"99990001","siteId":'), text.replace('"siteId":', '"site\\u0049d":"99990001","siteId":'),
    text.replace('"reason":"inside"', '"reason":"inside\\u0000"'), text.replace('"reason":"inside"', '"reason":"\\ud800"'), " ".repeat(65537) + text])
    assert.throws(() => parseRetentionDisposalInputJson(value), /attendance_retention_disposal_invalid/);
  let deep: unknown = null; for (let i = 0; i < 17; i++) deep = { child: deep }; rejected({ ...input(), extra: deep });
  const many: unknown[] = Array.from({ length: 25 }, () => Array.from({ length: 25 }, () => Array(25).fill(null))); rejected({ ...input(), extra: many });
});

test("disposal selection supports exactly 25 independent candidates without whole-selection authorization", async () => {
  const inputs = Array.from({ length: 25 }, (_, i) => { const value = input(); value.location.evidenceId = id(100 + i); if (i === 7) value.dependencies.review.hasReview = true; return value; });
  const selection = { locationEvidenceIds: inputs.map(v => v.location.evidenceId), inputs }, results = await evaluateRetentionDisposalCandidates(selection);
  assert.equal(results.length, 25); assert.equal(results[7].candidateState, "blocked"); assert.equal(results[0].candidateState, "candidate");
  assert.ok(Object.isFrozen(results) && results.every(v => !v.authorityChecked && !v.applied && Object.isFrozen(v)));
  for (const key of ["approved", "eligible", "canExecute", "operationId", "selectionFingerprint"]) assert.equal(Object.hasOwn(results, key), false);
  await assert.rejects(evaluateRetentionDisposalCandidates({ locationEvidenceIds: [], inputs: [] }));
  await assert.rejects(evaluateRetentionDisposalCandidates({ locationEvidenceIds: [...selection.locationEvidenceIds, id(125)], inputs: [...inputs, input()] }));
});

test("disposal selection IDs correspond one-to-one, are ordered, and cannot mix site/time scopes", async () => {
  const a = input(), b = input(); b.location.evidenceId = id(9);
  await assert.rejects(evaluateRetentionDisposalCandidates({ locationEvidenceIds: [id(1), id(9)], inputs: [b, a] }));
  await assert.rejects(evaluateRetentionDisposalCandidates({ locationEvidenceIds: [id(1), id(1)], inputs: [a, a] }));
  await assert.rejects(evaluateRetentionDisposalCandidates({ locationEvidenceIds: [id(9), id(1)], inputs: [b, a] }));
  await assert.rejects(evaluateRetentionDisposalCandidates({ locationEvidenceIds: [id(1)], inputs: [a, b] }));
  for (const key of ["siteId", "asOf"] as const) { const mixed = structuredClone(b); mixed[key] = key === "siteId" ? "99990002" : "2026-10-08T12:00:00.123457Z";
    await assert.rejects(evaluateRetentionDisposalCandidates({ locationEvidenceIds: [id(1), id(9)], inputs: [a, mixed] })); }
});

test("disposal parsed API type remains a pure input rather than executable command", () => {
  const value: RetentionDisposalInput = parseRetentionDisposalInput(input()); assert.equal(value.protocol, RETENTION_DISPOSAL_INPUT_PROTOCOL);
  assert.deepEqual(RETENTION_DISPOSAL_FIELDS, ["captured_at", "accuracy_meters", "distance_meters"]);
  for (const key of ["command", "action", "authUserId", "allowWrite", "execute", "approve", "recover"]) assert.equal(Object.hasOwn(value, key), false);
});
