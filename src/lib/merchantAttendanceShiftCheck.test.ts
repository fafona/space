import assert from "node:assert/strict";
import test from "node:test";
import { parseShiftCheckResult, parseShiftCheckResponse, parseShiftCheckQuery, parseShiftCheckHttpQuery, shiftCheckQueryString, formatShiftCheckDuration, type ShiftCheckData } from "./merchantAttendanceShiftCheck";
import { projectShiftCheck, executeShiftCheck } from "./merchantAttendanceShiftCheck.server";
import { shiftCheckSource as source, shiftCheckWire as wire, shiftCheckHttp as http, shiftCheckApprovedEffect as effect,
  shiftCheckQuery as query, shiftCheckActor as actor, shiftCheckId as id } from "../../scripts/fixtures/attendance-shift-check-model";
import { shiftRulePoint, refreshShiftRulePointFields, rehashShiftRuleBinding } from "../../scripts/fixtures/attendance-shift-rule-binding-model";
const parse = (raw: unknown) => parseShiftCheckResult(raw, query, actor);
function withBreaks(durations: number[], open = false) {
  const v = wire(), first = v.events[0]; let time = Date.parse(first.occurredAt) * 1000, sequence = 1;
  const stamp = () => new Date(Math.floor(time / 1000)).toISOString().slice(0, 23) + String(time % 1000).padStart(3, "0") + "Z";
  for (const length of durations) {
    time += 1000000; v.events.push({ ...first, id: id(100 + ++sequence), sequence, action: "break_start", occurredAt: stamp(), breakPaid: sequence % 4 === 0 });
    time += length; v.events.push({ ...first, id: id(100 + ++sequence), sequence, action: "break_end", occurredAt: stamp() });
  }
  if (open) v.events.push({ ...first, id: id(100 + ++sequence), sequence, action: "break_start", occurredAt: stamp(), breakPaid: true });
  return v;
}
function linked(): ShiftCheckData {
  const v = wire(); v.relation = { startEventId: query.startEventId, operationId: v.rule.event.operationId, selection: { slotId: id(88), revision: 1 },
    status: "linked", reason: null, observedRevision: 1, recordedAt: "2026-09-02T08:00:00.000001Z", currentCancelled: false,
    slot: { id: id(88), revision: 1, locationId: v.rule.event.locationId, locationName: "Original location", timeZone: "Historical/Zone", workDate: "2026-09-02",
      startAt: "2026-09-02T07:55:00.000Z", endAt: "2026-09-02T16:00:00.000Z", cancelled: false, hasPublicationEvidence: true } }; return v;
}
test("three-key query rejects additions, duplicates and noncanonical identifiers", () => {
  assert.deepEqual(parseShiftCheckQuery(query), query); assert.deepEqual(parseShiftCheckHttpQuery("https://fixture.invalid/?" + shiftCheckQueryString(query)), query);
  for (const suffix of ["&siteId=99990009", "&asOf=x", "&actorId=" + actor, "&command={}"]) assert.throws(() => parseShiftCheckHttpQuery("https://fixture.invalid/?" + shiftCheckQueryString(query) + suffix));
  assert.throws(() => parseShiftCheckQuery({ ...query, startEventId: "x" }));
});
for (const [microseconds, state] of [[-1, "not_triggered"], [0, "triggered"], [1, "triggered"]] as const) test(`open threshold compares exact microseconds ${microseconds}`, () => {
  const v = wire(); v.rule.readAt = "2026-09-02T08:00:01.000000Z";
  v.asOf = microseconds < 0 ? "2026-09-02T15:59:59.999999Z" : `2026-09-02T16:00:00.00000${microseconds}Z`;
  assert.equal(parse(v).checks.open.state, state);
});
test("breaks compare individually without rounding, combining or dropping zero duration; open break stays separate", () => {
  const r = parse(withBreaks([0, 59999999, 60000000, 60000001], true));
  assert.deepEqual(r.checks.originalBreaks.map(b => b.state), ["triggered", "triggered", "not_triggered", "not_triggered"]);
  assert.deepEqual(r.checks.originalBreaks.map(b => b.durationUs), ["0", "59999999", "60000000", "60000001"]);
  assert.equal(r.original.status, "break"); assert.equal(r.original.openBreak!.paid, true); assert.equal(r.checks.open.state, "triggered");
});
test("no complete breaks is an empty comparison, not a normal or payroll conclusion", () => {
  const r = parse(wire()); assert.equal(r.checks.originalBreaks.length, 0); assert.equal(r.approved, null); assert.equal(r.checks.approvedBreaks, null);
  assert.equal(r.formalReady, false); assert.equal(Object.hasOwn(r, "normal"), false); assert.equal(Object.hasOwn(r.original, "totals"), false);
});
for (const status of ["missing", "unverified"] as const) test(`${status} source never uses current defaults`, () => {
  const r = parse(wire(status)); assert.equal(r.checks.open.state, "unavailable"); assert.deepEqual(r.checks.breakRule, { state: "unavailable", minutes: null });
});
for (const mode of ["disabled", "inherit"] as const) test(`${mode} is not zero and other field stays independent`, () => {
  const raw = source(), point = shiftRulePoint(true); point.group!.publication!.rules!.openSpanWarningMinutes = { mode };
  rehashShiftRuleBinding(raw.binding, refreshShiftRulePointFields(point)); const r = parse(projectShiftCheck(raw, query, actor));
  assert.equal(r.checks.open.state, mode === "disabled" ? "disabled" : "unconfigured"); assert.equal(r.checks.open.minutes, null); assert.equal(r.checks.breakRule.minutes, 1);
});
test("closed original plus approved proposal are separate and share the original frozen source", () => {
  const v = wire("verified", true); v.effect = effect(); const r = parse(v);
  assert.equal(r.checks.open.state, "not_applicable"); assert.equal(r.checks.open.elapsedUs, null);
  assert.equal(r.checks.originalBreaks[0].state, "triggered"); assert.equal(r.checks.approvedBreaks![0].state, "not_triggered");
  assert.notEqual(r.original.startAt, r.approved!.startAt); assert.equal(r.rule.event.occurredAt, r.original.startAt);
  assert.equal(r.checks.originalBreaks[0].paid, false); assert.equal(r.checks.approvedBreaks![0].paid, true);
});
test("latest approved revision retains root and immediate previous reference", () => {
  const v = wire("verified", true); v.effect = effect(); const rootOperation = v.effect.operationId;
  Object.assign(v.effect, { requestId: id(72), operationId: id(73), revision: 2, recordedAt: "2026-09-02T12:00:00.000000Z" }); v.effect.lineage.previousOperationId = rootOperation;
  assert.equal(parse(v).effect!.revision, 2); v.effect.lineage.previousOperationId = id(75); assert.throws(() => parse(v));
});
test("UTC whole-segment comparison spans midnight and DST without current zone remapping", () => {
  const v = withBreaks([60000000]); v.rule.event.occurredAt = "2026-10-24T23:59:00.000000Z"; v.events[0].occurredAt = v.rule.event.occurredAt;
  v.rule.event.timeZone = v.events[0].timeZone = "Archive/Unknown_Zone";
  v.rule.binding!.recordedAt = "2026-10-24T23:59:00.000001Z";
  v.events[1].occurredAt = "2026-10-25T00:59:59.999999Z"; v.events[2].occurredAt = "2026-10-25T01:00:59.999999Z";
  v.rule.readAt = v.asOf = "2026-10-25T08:00:00.000000Z";
  const r = parse(v); assert.equal(r.checks.originalBreaks[0].durationUs, "60000000"); assert.equal(r.checks.originalBreaks[0].state, "not_triggered");
});
test("signed plan differences preserve original slot and later cancellation, without formal late/early output", () => {
  const v = linked(); v.relation!.currentCancelled = true; const r = parse(v);
  assert.deepEqual(r.plan.original, { startDeltaUs: "300000000", endDeltaUs: null }); assert.equal(r.relation!.slot!.cancelled, false);
  assert.equal(r.relation!.currentCancelled, true); assert.equal(r.plan.approved, null);
});
test("137 clock rollback recording and saved outside-window decision are not reinterpreted", () => {
  const v = linked(); v.relation!.recordedAt = "2026-09-02T07:59:59.999999Z";
  assert.equal(parse(v).relation!.status, "linked"); v.relation!.status = "unverified"; v.relation!.reason = "outside_window";
  assert.equal(parse(v).plan.original, null); assert.equal(parse(v).checks.open.state, "triggered");
});
test("unselected relation is distinct from absent relation", () => {
  const v = linked(); Object.assign(v.relation!, { status: "unselected", reason: null, selection: null, slot: null, currentCancelled: null });
  assert.equal(parse(v).relation!.status, "unselected"); assert.equal(parse(wire()).relation, null);
});
test("relation reason priority matches original137 producer", () => {
  const v = linked(); v.relation!.status = "unverified"; v.relation!.slot!.hasPublicationEvidence = false; v.relation!.slot!.cancelled = true; v.relation!.currentCancelled = true;
  v.relation!.reason = "cancelled"; assert.equal(parse(v).relation!.reason, "cancelled");
  v.relation!.reason = "publication_missing"; assert.throws(() => parse(v));
});
test("unverified without reason, forged relation and cancellation rollback are rejected", () => {
  for (const mutate of [(v: ShiftCheckData) => { v.relation!.status = "unverified"; }, (v: ShiftCheckData) => { v.relation!.operationId = id(99); },
    (v: ShiftCheckData) => { v.relation!.slot!.cancelled = true; }, (v: ShiftCheckData) => { v.relation!.observedRevision = 0; },
    (v: ShiftCheckData) => { v.relation!.recordedAt = "2026-09-03T00:00:00.000000Z"; }]) { const v = linked(); mutate(v); assert.throws(() => parse(v)); }
});
test("whole session refuses gaps, duplicate ids, invalid transitions, future facts or anchor mismatch", () => {
  const mutations = [(v: ShiftCheckData) => { v.events[1].sequence++; }, (v: ShiftCheckData) => { v.events[1].id = v.events[0].id; },
    (v: ShiftCheckData) => { v.events[1].action = "clock_out"; }, (v: ShiftCheckData) => { v.events[2].occurredAt = "2026-09-02T17:00:00.000000Z"; },
    (v: ShiftCheckData) => { v.events[0].timeZone = "Other"; }, (v: ShiftCheckData) => { v.events[0].source = "kiosk"; },
    (v: ShiftCheckData) => { v.events[3].breakPaid = true; }, (v: ShiftCheckData) => { v.rule.readAt = "2026-09-03T00:00:00.000000Z"; }];
  for (const mutate of mutations) { const v = wire("verified", true); mutate(v); assert.throws(() => parse(v)); }
});
test("effect requires completed original, exact last event, employee, zone, approval time, totals and lineage", () => {
  const open = wire(); open.effect = effect(); assert.throws(() => parse(open));
  for (const key of ["originalLastEventId", "employeeId", "timeZone", "recordedAt", "elapsedUs", "revision", "policyRevision", "action", "calculationVersion"] as const) {
    const v = wire("verified", true); v.effect = effect(); Object.assign(v.effect, { [key]: key === "elapsedUs" ? 1 : key === "revision" || key === "policyRevision" ? 0 : "invalid" }); assert.throws(() => parse(v));
  }
  const v = wire("verified", true); v.effect = effect(); v.effect.lineage.rootRecordedAt = "2026-09-02T09:00:00.000000Z"; assert.throws(() => parse(v));
});
test("maximum1000 completebreaks/2002 events accepted,2003 rejected without truncation", () => {
  const v = withBreaks(Array(1000).fill(0)), first = v.events[0], last = v.events.at(-1)!;
  v.events.push({ ...first, id: id(9999), sequence: 2002, action: "clock_out", occurredAt: last.occurredAt });
  assert.equal(parse(v).checks.originalBreaks.length, 1000); v.events.push({ ...first, id: id(9998), sequence: 2003 }); assert.throws(() => parse(v));
});
test("strict object graph rejects accessor without invoking it, extra fields and malformedUnicode", () => {
  let reads = 0; const v = wire(); Object.defineProperty(v, "events", { enumerable: true, get() { reads++; return []; } }); assert.throws(() => parse(v)); assert.equal(reads, 0);
  assert.throws(() => parse({ ...wire(), checks: {} })); const bad = wire(); bad.rule.worker.workerName = "\ud800"; assert.throws(() => parse(bad));
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; assert.throws(() => parse(cycle));
  const sparse = wire(); sparse.events.length = 2; assert.throws(() => parse(sparse));
});
test("detached frozen result and wrapper reject private source leakage or malformed success", () => {
  const v = http(), before = structuredClone(v), r = parseShiftCheckResponse(v, query, actor);
  assert.deepEqual(v, before); assert(Object.isFrozen(r)); assert(Object.isFrozen(r.events)); assert(Object.isFrozen(r.checks.originalBreaks));
  v.data.events[0].timeZone = "mutated"; assert.equal(r.events[0].timeZone, "UTC");
  assert.throws(() => parseShiftCheckResponse({ ...http(), ok: false }, query, actor)); assert.throws(() => parse({ ...wire(), sourceText: "secret" }));
});
test("oneRPC service validates actual frozen bytes and never sends sourceText", async () => {
  const calls: unknown[] = [], raw = source(), data = await executeShiftCheck({ query, authUserId: actor }, { rpc: async (name, args) => { calls.push({ name, args }); return { data: raw, error: null }; } });
  assert.deepEqual(calls, [{ name: "faolla_attendance_shift_check_v1", args: { p_query: query, p_auth_user_id: actor } }]);
  assert.equal(JSON.stringify(data).includes("sourceText"), false); assert.equal(parse(data).checks.open.state, "triggered");
  raw.binding.binding!.source!.sourceSha256 = "0".repeat(64); assert.throws(() => projectShiftCheck(raw, query, actor), /attendance_shift_check_invalid/);
});
test("service retains safe errors and rejects unavailable/unknown/malformed readers without fallback", async () => {
  await assert.rejects(executeShiftCheck({ query, authUserId: actor }, null), /attendance_unavailable/);
  for (const code of ["attendance_access_denied", "attendance_shift_rule_binding_identity_changed", "attendance_shift_check_too_large"]) await assert.rejects(executeShiftCheck({ query, authUserId: actor }, { rpc: async () => ({ data: null, error: { message: code } }) }), new RegExp(code));
  await assert.rejects(executeShiftCheck({ query, authUserId: actor }, { rpc: async () => { throw Error("private SQL"); } }), /attendance_unavailable/);
  await assert.rejects(executeShiftCheck({ query, authUserId: actor }, { rpc: async () => ({ data: source(), error: { message: "secret" } }) }), /attendance_unavailable/);
});
test("duration formatting preserves sign and microsecond boundary", () => {
  assert.equal(formatShiftCheckDuration("-59999999"), "−0 小时 0 分 59.999999 秒"); assert.equal(formatShiftCheckDuration("60000000"), "0 小时 1 分 0 秒");
  assert.throws(() => formatShiftCheckDuration("-0")); assert.throws(() => formatShiftCheckDuration("1e9"));
});
