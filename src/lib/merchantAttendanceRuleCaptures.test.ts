import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseRuleCapturesQuery, parseRuleCapturesHttpQuery, parseRuleCapturesCommand, parseRuleCapturesBody, parseRuleCapturesResult, RULE_CAPTURES_ERRORS,
  type RuleCapturesCommand, type RuleCapturesResult } from "./merchantAttendanceRuleCaptures";
import { executeRuleCaptures } from "./merchantAttendanceRuleCaptures.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ruleCapturesQuery as query, ruleCapturesCommand as command, ruleCapturesResult } from "../../scripts/fixtures/attendance-rule-captures-model";
import { ruleSourcesId, ruleSourcesOwner as actor } from "../../scripts/fixtures/attendance-rule-sources-model";

const invalid = (fn: () => unknown, code = "attendance_rule_capture_invalid") => assert.throws(fn, (e: unknown) => e instanceof MerchantAttendanceError && e.code === code);
const read = (raw: unknown, c: RuleCapturesCommand | null = null) => parseRuleCapturesResult(raw, query, c, actor);
const seal = (r: RuleCapturesResult, text: string) => {
  r.receipt!.sourceText = text; r.receipt!.sourceBytes = Buffer.byteLength(text, "utf8");
  r.receipt!.sourceSha256 = createHash("sha256").update(text, "utf8").digest("hex"); return r;
};
const edit = (change: (source: ReturnType<typeof JSON.parse>) => void) => {
  const r = ruleCapturesResult(), source = JSON.parse(r.receipt!.sourceText); change(source); return seal(r, JSON.stringify(source));
};
const service = (data: unknown, error: { message: string } | null = null, log?: unknown[]): AttendanceSelfRpc => ({
  rpc: async (name, args) => { log?.push({ name, args }); return { data, error }; },
});

test("exact query/HTTP query requires a non-null canonical operation UUID and forbids every extra key", () => {
  assert.deepEqual(parseRuleCapturesQuery(query), query);
  assert.deepEqual(parseRuleCapturesHttpQuery("https://example.test/x?" + new URLSearchParams(query)), query);
  for (const change of [{ operationId: null }, { operationId: query.operationId.toUpperCase().replace("4000", "ABCD") }, { siteId: " 99990001" }, { workerId: "bad" }, { beforeRevision: 1 }])
    invalid(() => parseRuleCapturesQuery({ ...query, ...change }), "attendance_invalid_request");
  for (const suffix of ["&operationId=" + query.operationId, "&__proto__=x", "&constructor=x", "&source=x"])
    invalid(() => parseRuleCapturesHttpQuery("https://example.test/x?" + new URLSearchParams(query) + suffix), "attendance_invalid_request");
  invalid(() => parseRuleCapturesQuery({ siteId: query.siteId, workerId: query.workerId }), "attendance_invalid_request");
});

test("command accepts one through seven civil dates and exact reason/dual identity, not browser source/actor/flags", () => {
  assert.deepEqual(parseRuleCapturesCommand(command), command);
  for (const dates of [{ fromDate: "2026-10-25", throughDate: "2026-10-25" }, { fromDate: "2026-10-25", throughDate: "2026-10-31" }, { fromDate: "2100-12-31", throughDate: "2100-12-31" }])
    assert.deepEqual(parseRuleCapturesCommand({ ...command, ...dates }), { ...command, ...dates });
  for (const change of [{ throughDate: "2026-10-06" }, { throughDate: "2026-09-28" }, { fromDate: "2026-02-30" }, { reason: "" }, { reason: " x" },
    { reason: "x\n" }, { reason: "x".repeat(201) }, { employeeId: null }, { employeeAuthUserId: null }, { source: {} }, { actorId: actor }, { moduleEnabled: true }])
    invalid(() => parseRuleCapturesCommand({ ...command, ...change }), "attendance_invalid_request");
  assert.equal(parseRuleCapturesCommand({ ...command, reason: "🙂".repeat(200) }).reason.length, 400);
  invalid(() => parseRuleCapturesBody({ query, command: { ...command, operationId: ruleSourcesId(2) } }), "attendance_invalid_request");
  assert.deepEqual(parseRuleCapturesBody({ query, command }), { query, command });
});

test("request parsers never invoke accessor or custom serialization callbacks", () => {
  let invoked = 0;
  const getter = { ...query }; Object.defineProperty(getter, "siteId", { enumerable: true, get() { invoked++; return query.siteId; } });
  invalid(() => parseRuleCapturesQuery(getter), "attendance_invalid_request");
  invalid(() => parseRuleCapturesCommand({ ...command, toJSON() { invoked++; return {}; } }), "attendance_invalid_request");
  invalid(() => parseRuleCapturesBody(Object.assign(Object.create({ inherited: 1 }), { query, command })), "attendance_invalid_request");
  assert.equal(invoked, 0);
});

test("valid populated capture preserves original UTF8 text, all provenance and microseconds without resolving", () => {
  const raw = ruleCapturesResult(), before = structuredClone(raw), parsed = read(raw, command);
  assert.deepEqual(parsed, raw); assert.deepEqual(raw, before);
  assert.equal(parsed.receipt!.sourceText, raw.receipt!.sourceText); assert.equal(parsed.receipt!.sourceReadAt, "2026-10-04T12:00:00.000001Z");
  assert.notEqual(parsed.receipt, raw.receipt); assert.notEqual(parsed.receipt!.command, raw.receipt!.command);
  assert.equal(parsed.receipt!.applied, false); assert.equal(parsed.receipt!.historicalApplicationProven, false);
  assert(!Object.hasOwn(parsed, "resolution")); assert(!Object.hasOwn(parsed.receipt!, "source"));
});

test("unknown GET is null while a POST requires the original matching receipt", () => {
  const raw = ruleCapturesResult(); raw.receipt = null; assert.equal(read(raw).receipt, null); invalid(() => read(raw, command));
  invalid(() => read(ruleCapturesResult(), { ...command, reason: "different" }));
  const mismatched = ruleCapturesResult(); mismatched.receipt!.command.operationId = ruleSourcesId(3); invalid(() => read(mismatched));
});

test("source dedup may retain earlier sourceId/readAt with a later observedAt and operation", () => {
  const raw = ruleCapturesResult(); raw.receipt!.sourceId = ruleSourcesId(999);
  raw.receipt!.observedAt = "2026-10-04T12:00:00.000100Z"; raw.receipt!.recordedAt = "2026-10-04T12:00:00.000101Z"; raw.readAt = "2026-10-04T12:00:00.000102Z";
  assert.deepEqual(read(raw), raw);
});

test("archive reads do not consult Intl/current timezone data or rederive saved UTC endpoints", () => {
  const raw = edit(source => {
    source.timeZone = "Retired/Archive_Zone"; source.fromAt = "2026-09-28T22:17:00.000Z"; source.toAt = "2026-10-01T22:17:00.000Z";
    for (const a of source.assignments.items) { a.detail.timeZone = "Retired/Archive_Zone"; a.detail.history[0].item.timeZone = a.detail.timeZone; a.detail.history[0].command.timeZone = a.detail.timeZone; }
    for (const stream of source.rules.items) for (const p of stream.publications) { p.timeZone = "Retired/Archive_Zone"; p.effectiveAt = "2026-09-27T22:17:00.000Z"; }
    for (const pair of source.personal.items) for (const p of [pair.approval, pair.withdrawal].filter(Boolean)) p.timeZone = "Retired/Archive_Zone";
  });
  const original = Intl.DateTimeFormat;
  try { Intl.DateTimeFormat = function () { throw Error("No timezone replay allowed"); } as unknown as typeof Intl.DateTimeFormat; assert.equal(read(raw).receipt!.sourceText, raw.receipt!.sourceText); }
  finally { Intl.DateTimeFormat = original; }
});

test("hash and byte count check original nonASCII UTF8 bytes, not parsed/rerendered JSON", () => {
  const raw = edit(source => { source.worker.workerName = "员工🙂"; }); assert.equal(read(raw).receipt!.sourceText, raw.receipt!.sourceText);
  const wrongLength = structuredClone(raw); wrongLength.receipt!.sourceBytes = wrongLength.receipt!.sourceText.length; invalid(() => read(wrongLength));
  const wrongHash = structuredClone(raw); wrongHash.receipt!.sourceSha256 = "0".repeat(64); invalid(() => read(wrongHash));
  const changedWhitespace = structuredClone(raw); changedWhitespace.receipt!.sourceText += " "; invalid(() => read(changedWhitespace));
  const exactBytes = seal(ruleCapturesResult(), "\n" + ruleCapturesResult().receipt!.sourceText + "  "); assert.equal(read(exactBytes).receipt!.sourceText, exactBytes.receipt!.sourceText);
});

test("source size bound is inclusive and invalid UTF16/surrogate payloads are rejected", () => {
  const raw = ruleCapturesResult(), body = raw.receipt!.sourceText, padded = body + " ".repeat(1048576 - Buffer.byteLength(body));
  assert.equal(read(seal(raw, padded)).receipt!.sourceBytes, 1048576);
  invalid(() => read(seal(ruleCapturesResult(), padded + " ")));
  invalid(() => read(edit(source => { source.worker.workerName = "\ud800"; })));
});

test("timestamp order is checked at all six microseconds and malformed instants are refused", () => {
  for (const change of [
    (r: RuleCapturesResult) => { r.receipt!.observedAt = "2026-10-04T12:00:00.000000Z"; },
    (r: RuleCapturesResult) => { r.receipt!.recordedAt = "2026-10-04T12:00:00.000001Z"; },
    (r: RuleCapturesResult) => { r.readAt = "2026-10-04T12:00:00.000002Z"; },
    (r: RuleCapturesResult) => { r.receipt!.sourceReadAt = "2026-10-04T12:00:00.000000Z"; },
    (r: RuleCapturesResult) => { r.readAt = "2026-02-30T12:00:00.000004Z"; },
    (r: RuleCapturesResult) => { r.readAt = "2026-10-04T12:00:00.000Z"; },
  ]) { const raw = ruleCapturesResult(); change(raw); invalid(() => read(raw)); }
  const same = ruleCapturesResult(); same.receipt!.observedAt = same.receipt!.sourceReadAt; same.receipt!.recordedAt = same.receipt!.sourceReadAt; same.readAt = same.receipt!.sourceReadAt; assert(read(same));
});

test("result, receipt and source bind exact actor/site/worker/command dates and both employee identities", () => {
  for (const key of ["actorId", "siteId", "workerId", "operationId"] as const) { const raw = ruleCapturesResult(); raw[key] = key === "siteId" ? "99990002" : ruleSourcesId(2); invalid(() => read(raw)); }
  for (const change of [
    (s: ReturnType<typeof JSON.parse>) => { s.actorId = ruleSourcesId(2); }, (s: ReturnType<typeof JSON.parse>) => { s.siteId = "99990002"; },
    (s: ReturnType<typeof JSON.parse>) => { s.worker.workerId = ruleSourcesId(2); }, (s: ReturnType<typeof JSON.parse>) => { s.worker.employeeId = ruleSourcesId(2); },
    (s: ReturnType<typeof JSON.parse>) => { s.worker.employeeAuthUserId = ruleSourcesId(2); }, (s: ReturnType<typeof JSON.parse>) => { s.fromDate = "2026-09-28"; },
    (s: ReturnType<typeof JSON.parse>) => { s.throughDate = "2026-10-02"; }, (s: ReturnType<typeof JSON.parse>) => { s.protocol = "sources-v1"; },
  ]) invalid(() => read(edit(change)));
});

test("every source section must be complete and independently bounded, including global publication count", () => {
  for (const key of ["assignments", "rules", "personal"]) {
    invalid(() => read(edit(s => { s[key] = { ...s[key], limited: true, items: [] }; })));
    invalid(() => read(edit(s => { s[key].items = Array.from({ length: 101 }, () => s[key].items[0]); })));
  }
  invalid(() => read(edit(s => { s.rules.items[0].publications = Array.from({ length: 100 }, () => s.rules.items[0].publications[0]); })));
  invalid(() => read(edit(s => { s.rules.items = []; })));
});

test("complete candidate-blocked observations are preserved rather than promoted to an applied or usable result", () => {
  const raw = edit(s => {
    const second = structuredClone(s.assignments.items[0]); second.detail.assignmentId = ruleSourcesId(802);
    second.detail.history[0].command.operationId = second.detail.assignmentId; second.detail.history[0].item.assignmentId = second.detail.assignmentId;
    s.assignments.items.push(second);
    for (const a of s.assignments.items) {
      a.currentGroup.active = false; a.detail.employeeId = ruleSourcesId(7); a.detail.history[0].item.employeeId = ruleSourcesId(7);
    }
    s.personal.items[0].withdrawal = null;
  });
  assert.equal(read(raw).receipt!.sourceText, raw.receipt!.sourceText);
  assert.equal(read(raw).receipt!.applied, false); assert.equal(read(raw).receipt!.historicalApplicationProven, false);
});

test("extra fields and dangerous JSON keys are rejected at all nested archive boundaries", () => {
  const paths = [[], ["worker"], ["assignments"], ["assignments", "items", 0], ["assignments", "items", 0, "detail"],
    ["assignments", "items", 0, "detail", "history", 0], ["assignments", "items", 0, "detail", "history", 0, "command"],
    ["assignments", "items", 0, "currentGroup"], ["rules", "items", 0], ["rules", "items", 0, "publications", 0],
    ["rules", "items", 0, "publications", 0, "rules", "lateGraceMinutes"], ["personal", "items", 0], ["personal", "items", 0, "withdrawal"]];
  for (const path of paths) invalid(() => read(edit(source => { let at = source; for (const key of path) at = at[key]; at.extra = true; })));
  invalid(() => read(edit(s => { Object.defineProperty(s.worker, "__proto__", { enumerable: true, value: {} }); })));
  invalid(() => read({ ...ruleCapturesResult(), resolution: {} }));
  const raw = ruleCapturesResult(); Object.assign(raw.receipt!, { payrollReady: true }); invalid(() => read(raw));
});

test("source JSON duplicate decoded keys, excessive depth and malformed JSON are rejected even with matching hashes", () => {
  const text = ruleCapturesResult().receipt!.sourceText;
  invalid(() => read(seal(ruleCapturesResult(), text.replace('"protocol":', '"protocol":"wrong","prot\\u006fcol":'))));
  invalid(() => read(seal(ruleCapturesResult(), "{")));
  invalid(() => read(edit(s => { s.extra = Array.from({ length: 30 }).reduce(value => [value], 1 as unknown); })));
});

test("nested archive identities, chronology, scope and withdrawal snapshots remain internally consistent", () => {
  for (const change of [
    (s: ReturnType<typeof JSON.parse>) => { s.personal.items[0].withdrawal.rules.lateGraceMinutes.minutes = 5; },
    (s: ReturnType<typeof JSON.parse>) => { s.personal.items[0].withdrawal.approvedRevision = 3; },
    (s: ReturnType<typeof JSON.parse>) => { s.personal.items[1].approval.employeeAuthUserId = ruleSourcesId(2); },
    (s: ReturnType<typeof JSON.parse>) => { s.personal.items[1].approval.revision = 10; },
    (s: ReturnType<typeof JSON.parse>) => { s.rules.items[1].groupId = ruleSourcesId(2); },
    (s: ReturnType<typeof JSON.parse>) => { s.rules.items[1].publications[0].settingsVersion = 100; },
    (s: ReturnType<typeof JSON.parse>) => { s.assignments.items[0].detail.workerId = ruleSourcesId(2); },
    (s: ReturnType<typeof JSON.parse>) => { s.assignments.items[0].detail.history[0].item.workerName = "not the saved snapshot"; },
  ]) invalid(() => read(edit(change)));
});

test("result plain-JSON guard rejects accessors/symbols/sparse arrays/cycles without invoking accessors", () => {
  let invoked = 0; const raw = ruleCapturesResult(); Object.defineProperty(raw, "receipt", { enumerable: true, get() { invoked++; return null; } }); invalid(() => read(raw)); assert.equal(invoked, 0);
  const symbol = ruleCapturesResult(); Object.assign(symbol, { [Symbol("hidden")]: true }); invalid(() => read(symbol));
  const cycle = ruleCapturesResult(); Object.assign(cycle, { cycle }); invalid(() => read(cycle));
  const sparse = ruleCapturesResult(); Object.assign(sparse, { extra: new Array(1) }); invalid(() => read(sparse));
});

test("service calls only dedicated RPC, copies command identity and forwards paused state for original recovery", async () => {
  const raw = ruleCapturesResult(), calls: unknown[] = [];
  assert.equal(await executeRuleCaptures({ query, command, authUserId: actor, moduleEnabled: false }, service(raw, null, calls)), raw);
  assert.deepEqual(calls, [{ name: "faolla_attendance_rule_captures_v1", args: { p_query: query, p_auth_user_id: actor, p_command: command, p_module_enabled: false } }]);
  calls.length = 0; const missing = { ...raw, receipt: null };
  assert.equal(await executeRuleCaptures({ query, authUserId: actor }, service(missing, null, calls)), missing);
  assert.deepEqual(calls, [{ name: "faolla_attendance_rule_captures_v1", args: { p_query: query, p_auth_user_id: actor, p_command: null, p_module_enabled: false } }]);
});

test("service validates bytes and metadata before returning raw wire and never leaks unknown RPC failures", async () => {
  const bad = ruleCapturesResult(); bad.receipt!.sourceSha256 = "0".repeat(64);
  await assert.rejects(executeRuleCaptures({ query, authUserId: actor }, service(bad)), { code: "attendance_rule_capture_invalid" });
  await assert.rejects(executeRuleCaptures({ query, authUserId: actor }, service(null, { message: "secret internal error" })), { code: "attendance_unavailable" });
  for (const code of ["attendance_access_denied", "attendance_rule_capture_identity_changed", "attendance_rule_capture_incomplete", "attendance_rule_capture_limit", "attendance_platform_paused"])
    await assert.rejects(executeRuleCaptures({ query, authUserId: actor }, service(null, { message: code })), { code });
  await assert.rejects(executeRuleCaptures({ query, authUserId: actor }, null), { code: "attendance_unavailable" });
  assert.equal(RULE_CAPTURES_ERRORS.attendance_rule_capture_invalid, 503); assert.equal(RULE_CAPTURES_ERRORS.attendance_rule_capture_incomplete, 409);
});

test("service input failures are rejected before RPC and mutations during pending RPC cannot rebind validation", async () => {
  const calls: unknown[] = []; const rpc = service(ruleCapturesResult(), null, calls);
  await assert.rejects(executeRuleCaptures({ query, command: { ...command, operationId: ruleSourcesId(2) }, authUserId: actor }, rpc), { code: "attendance_invalid_request" });
  await assert.rejects(executeRuleCaptures({ query, authUserId: actor, moduleEnabled: null as unknown as boolean }, rpc), { code: "attendance_unavailable" }); assert.equal(calls.length, 0);
  const mutableQuery = { ...query }, mutableCommand = { ...command };
  const race: AttendanceSelfRpc = { rpc: async () => { mutableQuery.workerId = ruleSourcesId(2); mutableCommand.reason = "changed"; return { data: ruleCapturesResult(), error: null }; } };
  assert(await executeRuleCaptures({ query: mutableQuery, command: mutableCommand, authUserId: actor, moduleEnabled: true }, race));
});
