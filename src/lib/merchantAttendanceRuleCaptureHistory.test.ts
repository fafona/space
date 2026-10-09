import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseRuleCaptureHistoryQuery, parseRuleCaptureHistoryHttpQuery, parseRuleCaptureHistoryResult, parseRuleCaptureHistoryResponse,
  ruleCaptureHistoryQueryString, RULE_CAPTURE_HISTORY_ERRORS, type RuleCaptureHistoryQuery } from "./merchantAttendanceRuleCaptureHistory";
import { executeRuleCaptureHistory } from "./merchantAttendanceRuleCaptureHistory.server";
import { ruleCaptureHistoryQuery as query, ruleCaptureHistoryResult as result } from "../../scripts/fixtures/attendance-rule-capture-history-model";
import { ruleSourcesId, ruleSourcesOwner as actor } from "../../scripts/fixtures/attendance-rule-sources-model";

const invalid = (fn: () => unknown, code = "attendance_rule_capture_history_invalid") => assert.throws(fn, (e: unknown) => e instanceof MerchantAttendanceError && e.code === code);
const parse = (raw: unknown, q = query) => parseRuleCaptureHistoryResult(raw, q, actor);
const next = (): RuleCaptureHistoryQuery => ({ ...query, ...result(25, true).nextCursor! });

test("query is exact seven keys; first page is five nulls and continuation requires all five fields", () => {
  assert.deepEqual(parseRuleCaptureHistoryQuery(query), query); assert.deepEqual(parseRuleCaptureHistoryQuery(next()), next());
  for (const key of ["asOf", "beforeAt", "beforeId", "expectedEmployeeId", "expectedEmployeeAuthUserId"] as const) {
    invalid(() => parseRuleCaptureHistoryQuery({ ...next(), [key]: null }), "attendance_invalid_request");
    invalid(() => parseRuleCaptureHistoryQuery({ ...query, [key]: next()[key] }), "attendance_invalid_request");
  }
  for (const patch of [{ limit: 25 }, { offset: 0 }, { pageSize: 25 }, { operationId: ruleSourcesId(1) }, { actorId: actor }, { sourceText: "{}" }, { siteId: " 99990001" }, { workerId: "bad" }])
    invalid(() => parseRuleCaptureHistoryQuery({ ...query, ...patch }), "attendance_invalid_request");
  const missing = { ...query } as Partial<RuleCaptureHistoryQuery>; delete missing.beforeId; invalid(() => parseRuleCaptureHistoryQuery(missing), "attendance_invalid_request");
});

test("HTTP first page normalizes omitted null fields and refuses duplicates, unknown keys and partial cursors", () => {
  const url = "https://www.faolla.com/api/merchant-enterprise/attendance/rule-capture-history?";
  assert.equal(ruleCaptureHistoryQueryString(query), `siteId=${query.siteId}&workerId=${query.workerId}`);
  assert.deepEqual(parseRuleCaptureHistoryHttpQuery(url + ruleCaptureHistoryQueryString(query)), query);
  assert.deepEqual(parseRuleCaptureHistoryHttpQuery(url + ruleCaptureHistoryQueryString(next())), next());
  for (const suffix of ["&siteId=99990002", "&asOf=null", "&beforeId=" + ruleSourcesId(2), "&__proto__=x", "&constructor=x", "&moduleEnabled=true", "&limit=25"])
    invalid(() => parseRuleCaptureHistoryHttpQuery(url + ruleCaptureHistoryQueryString(query) + suffix), "attendance_invalid_request");
});

test("UTC timestamps preserve all six digits, require valid dates and reject year zero without current-zone checks", () => {
  for (const stamp of ["2026-10-04T12:00:00.000Z", "2026-02-30T12:00:00.000000Z", "2026-10-04T12:00:00.000000+00:00", "0000-01-01T00:00:00.000000Z"])
    invalid(() => parseRuleCaptureHistoryQuery({ ...next(), beforeAt: stamp }), "attendance_invalid_request");
  invalid(() => parseRuleCaptureHistoryQuery({ ...next(), beforeAt: "2026-10-04T12:00:00.000101Z" }), "attendance_invalid_request");
  const raw = result(0); raw.asOf = "0001-01-01T00:00:00.000000Z"; raw.readAt = "9999-12-31T23:59:59.999999Z";
  const original = Intl.DateTimeFormat;
  try { Intl.DateTimeFormat = function () { throw Error("no timezone reconstruction"); } as unknown as typeof Intl.DateTimeFormat; assert.deepEqual(parse(raw), raw); }
  finally { Intl.DateTimeFormat = original; }
});

test("valid empty and full metadata pages are detached, read-only and preserve legal duplicate source references", () => {
  for (const raw of [result(0), result(2), result(25), result(25, true)]) {
    const before = structuredClone(raw), parsed = parse(raw); assert.deepEqual(parsed, raw); assert.deepEqual(raw, before);
    assert.notEqual(parsed, raw); assert.notEqual(parsed.items, raw.items);
    if (raw.items.length) { assert.notEqual(parsed.items[0].command, raw.items[0].command); assert.equal(new Set(parsed.items.map(item => item.sourceId)).size, 1); }
    assert(!JSON.stringify(parsed).includes("sourceText")); assert.equal(parsed.readOnly, true);
  }
});

test("ordering is strictly recordedAt descending then operation UUID descending at equal microseconds", () => {
  const raw = result(3); raw.items.forEach(item => { item.recordedAt = raw.items[0].recordedAt; item.observedAt = item.recordedAt; }); assert(parse(raw));
  const swapped = structuredClone(raw); [swapped.items[0], swapped.items[1]] = [swapped.items[1], swapped.items[0]]; invalid(() => parse(swapped));
  const duplicate = result(2); duplicate.items[1] = structuredClone(duplicate.items[0]); invalid(() => parse(duplicate));
  const reversed = result(2); reversed.items.reverse(); invalid(() => parse(reversed));
  const micros = result(2); micros.items[1].recordedAt = "2026-10-04T12:00:00.000091Z"; invalid(() => parse(micros));
});

test("continuation is bound to same cutoff and dual identities and cannot repeat or move above the previous tuple", () => {
  const q = next(), raw = result(2); raw.asOf = q.asOf!;
  raw.items.forEach((item, index) => { item.recordedAt = `2026-10-04T12:00:00.${String(60 - index).padStart(6, "0")}Z`; item.observedAt = item.recordedAt; });
  assert(parse(raw, q));
  for (const patch of [{ asOf: "2026-10-04T12:00:00.000099Z" }, { employeeId: ruleSourcesId(8) }, { employeeAuthUserId: ruleSourcesId(8) }]) invalid(() => parse({ ...raw, ...patch }, q));
  const repeated = structuredClone(raw); repeated.items[0].operationId = q.beforeId!; repeated.items[0].command.operationId = q.beforeId!;
  repeated.items[0].recordedAt = q.beforeAt!; repeated.items[0].observedAt = q.beforeAt!; invalid(() => parse(repeated, q));
});

test("nextCursor requires 25 emitted records and exactly the final emitted tuple, cutoff and both identities", () => {
  invalid(() => parse(result(24, true))); invalid(() => parse(result(26))); const raw = result(25, true);
  for (const patch of [{ beforeId: raw.items[23].operationId }, { beforeAt: raw.items[23].recordedAt }, { asOf: "2026-10-04T12:00:00.000099Z" },
    { expectedEmployeeId: ruleSourcesId(8) }, { expectedEmployeeAuthUserId: ruleSourcesId(8) }, { offset: 25 }])
    invalid(() => parse({ ...raw, nextCursor: { ...raw.nextCursor, ...patch } }));
  assert.equal(parse(result(25)).nextCursor, null);
});

test("top-level and every row bind owner/site/worker plus current employee and authentication IDs", () => {
  for (const patch of [{ actorId: ruleSourcesId(8) }, { siteId: "99990002" }, { workerId: ruleSourcesId(8) }, { employeeId: null }, { employeeAuthUserId: null },
    { readOnly: false }, { protocol: "candidate-rule-captures-v1" }]) invalid(() => parse({ ...result(), ...patch }));
  for (const change of [
    (r: ReturnType<typeof result>) => { r.items[0].actorId = ruleSourcesId(8); },
    (r: ReturnType<typeof result>) => { r.items[0].command.employeeId = ruleSourcesId(8); },
    (r: ReturnType<typeof result>) => { r.items[0].command.employeeAuthUserId = ruleSourcesId(8); },
    (r: ReturnType<typeof result>) => { r.items[0].command.operationId = ruleSourcesId(8); },
  ]) { const raw = result(); change(raw); invalid(() => parse(raw)); }
});

test("all archive times obey sourceReadAt <= observedAt <= recordedAt <= asOf <= readAt", () => {
  for (const change of [
    (r: ReturnType<typeof result>) => { r.items[0].sourceReadAt = "2026-10-04T12:00:00.000091Z"; },
    (r: ReturnType<typeof result>) => { r.items[0].observedAt = "2026-10-04T12:00:00.000091Z"; },
    (r: ReturnType<typeof result>) => { r.items[0].recordedAt = "2026-10-04T12:00:00.000101Z"; },
    (r: ReturnType<typeof result>) => { r.readAt = "2026-10-04T12:00:00.000099Z"; },
  ]) { const raw = result(); change(raw); invalid(() => parse(raw)); }
});

test("stored hash is validated as metadata only, with byte limits and consistent deduplicated artifacts", () => {
  assert(parse(result())); // The synthetic hash has no underlying body and is deliberately not recomputed.
  for (const patch of [{ sourceBytes: 0 }, { sourceBytes: 1048577 }, { sourceBytes: 1.5 }, { sourceSha256: "A".repeat(64) }, { sourceSha256: "not-a-hash" },
    { sourceText: "private" }, { canonicalFormat: "pg-jsonb-text-utf8-v1" }, { applied: true }, { historicalApplicationProven: true }]) {
    const raw = result(); Object.assign(raw.items[0], patch); invalid(() => parse(raw));
  }
  const raw = result(); raw.items[1].sourceSha256 = "b".repeat(64); invalid(() => parse(raw));
  raw.items[1].sourceId = ruleSourcesId(123); assert(parse(raw));
});

test("paused/inactive historical metadata remains readable and current labels are not claimed as stored source labels", () => {
  const raw = result(); raw.workerActive = false; raw.employeeActive = false; raw.workerName = "Current renamed worker";
  assert.deepEqual(parse(raw), raw); const envelope = { ok: true, moduleEnabled: false, data: raw };
  assert.equal(parseRuleCaptureHistoryResponse(envelope, query, actor).moduleEnabled, false);
  invalid(() => parseRuleCaptureHistoryResponse({ ...envelope, moduleEnabled: "false" }, query, actor));
  invalid(() => parseRuleCaptureHistoryResponse({ ...envelope, source: {} }, query, actor));
});

test("plain JSON guard rejects dangerous keys, symbols, accessors, sparse arrays and cycles without invoking user code", () => {
  let invoked = 0; const getter = result(); Object.defineProperty(getter.items[0].command, "reason", { enumerable: true, get() { invoked++; return "x"; } }); invalid(() => parse(getter)); assert.equal(invoked, 0);
  for (const change of [
    (r: ReturnType<typeof result>) => { Object.defineProperty(r.items[0], "__proto__", { enumerable: true, value: {} }); },
    (r: ReturnType<typeof result>) => { Object.assign(r, { [Symbol("hidden")]: 1 }); },
    (r: ReturnType<typeof result>) => { delete r.items[0]; },
    (r: ReturnType<typeof result>) => { Object.assign(r, { cycle: r }); },
    (r: ReturnType<typeof result>) => { Object.setPrototypeOf(r.items[0].command, { inherited: true }); },
  ]) { const raw = result(); change(raw); invalid(() => parse(raw)); }
});

test("64 KiB raw metadata budget is enforced before accepting oversized or unknown bodies", () => {
  invalid(() => parse({ ...result(), extra: "x".repeat(65536) }), "attendance_rule_capture_history_too_large");
  invalid(() => parse({ ...result(), extra: "🙂".repeat(20000) }), "attendance_rule_capture_history_too_large");
  invalid(() => parse({ ...result(), sourceText: "{}" }));
  const raw = result(25); raw.items.forEach(item => { item.command.reason = "🙂".repeat(200); }); assert(parse(raw));
  assert.equal(RULE_CAPTURE_HISTORY_ERRORS.attendance_rule_capture_history_too_large, 422);
});

test("service invokes one independent metadata RPC with no write flags and validates bindings before returning wire", async () => {
  const raw = result(), calls: unknown[] = [];
  assert.equal(await executeRuleCaptureHistory({ query, authUserId: actor }, { rpc: async (name, args) => { calls.push({ name, args }); return { data: raw, error: null }; } }), raw);
  assert.deepEqual(calls, [{ name: "faolla_attendance_rule_capture_history_v1", args: { p_query: query, p_auth_user_id: actor } }]);
  for (const patch of [{ actorId: ruleSourcesId(8) }, { items: [{ sourceText: "private" }] }, { readOnly: false }])
    await assert.rejects(executeRuleCaptureHistory({ query, authUserId: actor }, { rpc: async () => ({ data: { ...raw, ...patch }, error: null }) }), { code: "attendance_rule_capture_history_invalid" });
});

test("service preserves known safe errors and redacts unknown transport/SQL failures", async () => {
  for (const code of ["attendance_access_denied", "attendance_rule_capture_identity_changed", "attendance_rule_capture_history_invalid", "attendance_rule_capture_history_too_large"])
    await assert.rejects(executeRuleCaptureHistory({ query, authUserId: actor }, { rpc: async () => ({ data: null, error: { message: code } }) }), { code });
  for (const service of [null, { rpc: async () => { throw Error("private"); } }, { rpc: async () => ({ data: null, error: { message: "private" } }) }])
    await assert.rejects(executeRuleCaptureHistory({ query, authUserId: actor }, service), { code: "attendance_unavailable" });
});

test("protocol remains browser-safe and never loads sources, calculates candidates or recomputes hashes", () => {
  const text = readFileSync(new URL("merchantAttendanceRuleCaptureHistory.ts", import.meta.url), "utf8");
  assert.doesNotMatch(text, /^import (?!type)[^\n]*from ["']\.\/merchantAttendanceRuleCaptures["']/m);
  assert.doesNotMatch(text, /from ["']node:|subtle\.digest|createHash|attendanceDayUtcRange|parseRuleSources|resolveCandidate/);
});
