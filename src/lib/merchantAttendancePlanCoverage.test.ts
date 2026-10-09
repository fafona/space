import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanCoverageQuery, parsePlanCoverageHttpQuery, planCoverageQueryString, parsePlanCoverageData, parsePlanCoverageResult, parsePlanCoverageResponse, PLAN_COVERAGE_BYTE_LIMIT,
  type PlanCoverageData } from "./merchantAttendancePlanCoverage";
import type { ShiftCheckData, ShiftCheckEffect } from "./merchantAttendanceShiftCheck";
import { planCoverageActor as actor, planCoverageQuery as query, planCoverageId as id, planCoverageWire } from "../../scripts/fixtures/attendance-plan-coverage-model";
import { shiftCheckApprovedEffect } from "../../scripts/fixtures/attendance-shift-check-model";

const hour = "3600000000", twoHours = "7200000000";
const stamp = (time: string) => `2026-09-02T${time}Z`;
const at = (value: string) => BigInt(Date.parse(value.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(value.slice(23, 26));
function fixture(count: 0 | 1 | 2 = 2) { const v = planCoverageWire(count); v.readStartedAt = stamp("16:00:00.000000"); return v; }
const parse = (v = fixture()) => parsePlanCoverageResult(v, query, actor);
function cutoff(v: PlanCoverageData, time: string) {
  v.readStartedAt = time; v.readCompletedAt = time;
  for (const child of v.sessions) { child.rule.readAt = time; child.asOf = time; }
}
function span(child: ShiftCheckData, startAt: string, endAt: string | null, sequence = child.rule.event.sequence) {
  const first = { ...child.events[0], sequence, occurredAt: startAt };
  child.rule.event.occurredAt = startAt; child.rule.event.sequence = sequence;
  if (child.rule.binding) child.rule.binding.recordedAt = startAt;
  if (child.relation) child.relation.recordedAt = startAt;
  child.events = endAt === null ? [first] : [first, { ...first, id: id(sequence + 900), sequence: sequence + 1, action: "clock_out", occurredAt: endAt }];
  child.effect = null;
}
function correction(child: ShiftCheckData, startAt: string, endAt: string, n = 0): ShiftCheckEffect {
  const effect = shiftCheckApprovedEffect(), recordedAt = stamp("15:00:00.000000"), requestId = id(800 + n * 2), operationId = id(801 + n * 2);
  return { ...effect, requestId, operationId, originalLastEventId: child.events.at(-1)!.id, recordedAt,
    proposal: { startAt, endAt, breaks: [] }, elapsedUs: Number(at(endAt) - at(startAt)), workedUs: Number(at(endAt) - at(startAt)), breakUs: 0, paidBreakUs: 0,
    lineage: { rootRequestId: requestId, rootOperationId: operationId, rootRecordedAt: recordedAt, previousOperationId: null } };
}
function missingRule(child: ShiftCheckData) { child.rule.status = "missing"; child.rule.reason = "binding_missing"; child.rule.binding = null; child.rule.evidence = null; }
function assertFrozen(value: unknown) { if (value && typeof value === "object") { assert(Object.isFrozen(value)); Object.values(value).forEach(assertFrozen); } }

test("query requires exact site/worker/slot and HTTP rejects duplicates, actor overrides and prototype keys", () => {
  assert.deepEqual(parsePlanCoverageQuery(query), query); const url = `https://local.invalid/?${planCoverageQueryString(query)}`;
  assert.deepEqual(parsePlanCoverageHttpQuery(url), query);
  for (const key of Object.keys(query)) { const bad = { ...query }; Reflect.deleteProperty(bad, key); assert.throws(() => parsePlanCoverageQuery(bad), /attendance_invalid_request/); }
  for (const suffix of ["&slotId=" + query.slotId, "&actorId=" + actor, "&offset=0", "&__proto__=x", "&fromDate=2026-09-02"]) assert.throws(() => parsePlanCoverageHttpQuery(url + suffix), /attendance_invalid_request/);
  assert.throws(() => parsePlanCoverageQuery({ ...query, slotId: "invalid" }), /attendance_invalid_request/);
  assert.throws(() => parsePlanCoverageQuery({ ...query, command: null }), /attendance_invalid_request/);
});
test("two explicitly linked closed spans union to four hours including breaks, with internal and trailing gaps", () => {
  const r = parse(); assert.equal(r.phase, "ended"); assert.deepEqual(r.gapBlockers, []); assert.equal(r.original.closedCount, 2);
  assert.equal(r.original.coveredUs, "14400000000"); assert.equal(r.original.overlapUs, "0"); assert.equal(r.original.coverage.length, 2);
  assert.deepEqual(r.original.gaps?.map(g => [g.startAt, g.endAt, g.durationUs]), [
    [stamp("10:00:00.000000"), stamp("12:00:00.000000"), twoHours], [stamp("14:00:00.000000"), stamp("16:00:00.000000"), twoHours],
  ]);
  assert.deepEqual(r.selected, r.original); assert.equal(r.hasApprovedChanges, false); assert.equal(r.formalReady, false);
  // Both original spans contain breaks; this is span coverage, not net work.
  assert(r.sessions.every(s => s.original.breaks.length === 1));
});
test("a real-shape approved correction overlaps the second original span without changing original coverage", () => {
  const v = fixture(); v.sessions[0].effect = correction(v.sessions[0], stamp("09:00:00.000000"), stamp("13:00:00.000000"));
  const r = parse(v); assert.equal(r.hasApprovedChanges, true); assert.equal(r.original.coveredUs, "14400000000");
  assert.equal(r.selected.coveredUs, "18000000000"); assert.equal(r.selected.overlapUs, hour); assert.equal(r.selected.coverage.length, 1);
  assert.deepEqual(r.selected.overlaps[0], { startAt: stamp("12:00:00.000000"), endAt: stamp("13:00:00.000000"), durationUs: hour,
    startEventIds: v.sessions.map(s => s.rule.event.startEventId) });
  assert.equal(r.sessions[0].rule.event.startEventId, v.sessions[0].rule.event.startEventId);
  assert.equal(r.sessions[0].effect?.operationId, id(801));
});
test("touching half-open spans merge coverage without overlap or a fabricated gap", () => {
  const v = fixture(); span(v.sessions[1], stamp("10:00:00.000000"), stamp("12:00:00.000000"));
  const r = parse(v); assert.equal(r.original.coverage.length, 1); assert.equal(r.original.coveredUs, "14400000000"); assert.equal(r.original.overlapUs, "0");
  assert.equal(r.original.segments.length, 2); assert.equal(r.original.gaps?.length, 1);
});
test("one-microsecond gap and overlap remain exact before display rounding", () => {
  const v = fixture(); span(v.sessions[1], stamp("10:00:00.000001"), stamp("12:00:00.000000"));
  const r = parse(v); assert.equal(r.original.gaps?.[0].durationUs, "1"); assert.equal(r.original.coveredUs, "14399999999");
  v.sessions[0].effect = correction(v.sessions[0], stamp("08:00:00.000000"), stamp("10:00:00.000002"));
  const changed = parse(v); assert.equal(changed.selected.overlapUs, "1"); assert.equal(changed.original.overlapUs, "0");
});
test("zero-duration and outside/just-touching spans keep their IDs without positive coverage", () => {
  const zero = fixture(); span(zero.sessions[1], stamp("12:00:00.000000"), stamp("12:00:00.000000"));
  const z = parse(zero); assert.deepEqual(z.original.zeroIds, [zero.sessions[1].rule.event.startEventId]); assert.equal(z.original.coveredUs, twoHours);
  const outside = fixture(1); span(outside.sessions[0], stamp("06:00:00.000000"), stamp("08:00:00.000000"));
  const o = parse(outside); assert.deepEqual(o.original.outsideIds, [outside.sessions[0].rule.event.startEventId]); assert.equal(o.original.coveredUs, "0"); assert.equal(o.original.coverage.length, 0);
});
test("a correction wholly outside the plan remains linked and is not silently filtered or rebound", () => {
  const v = fixture(); const effect = correction(v.sessions[0], stamp("06:00:00.000000"), stamp("07:00:00.000000")); v.sessions[0].effect = effect;
  const r = parse(v); assert.equal(r.sessions.length, 2); assert.deepEqual(r.selected.outsideIds, [v.sessions[0].rule.event.startEventId]);
  assert.equal(r.original.coveredUs, "14400000000"); assert.equal(r.selected.coveredUs, twoHours);
  assert.equal(r.sessions[0].relation?.selection?.slotId, query.slotId);
});
test("no relation returns no gaps, not an all-plan absence interval", () => {
  const r = parse(fixture(0)); assert.deepEqual(r.gapBlockers, ["no_explicit_relations"]); assert.equal(r.original.gaps, null); assert.equal(r.selected.gaps, null);
  assert.deepEqual(r.original.coverage, []); assert.equal(r.original.closedCount, 0);
});
test("open final session retains its real start; closed coverage remains visible but final gaps are withheld", () => {
  const v = fixture(); span(v.sessions[1], stamp("12:00:00.000000"), null);
  const r = parse(v); assert(r.gapBlockers.includes("open_sessions")); assert.equal(r.original.coveredUs, twoHours); assert.equal(r.original.gaps, null);
  assert.deepEqual(r.original.openIds, [v.sessions[1].rule.event.startEventId]); assert.equal(r.sessions[1].original.endAt, null);
});
test("unverified relations are excluded from trusted union, without discarding other closed spans", () => {
  const v = fixture(); v.sessions[1].relation!.status = "unverified"; v.sessions[1].relation!.reason = "outside_window";
  const r = parse(v); assert.equal(r.original.coveredUs, twoHours); assert.deepEqual(r.original.unverifiedIds, [v.sessions[1].rule.event.startEventId]);
  assert(r.gapBlockers.includes("unverified_relations")); assert.equal(r.original.gaps, null);
});
test("missing fixed rules do not erase trustworthy linked temporal facts", () => {
  const v = fixture(); v.sessions.forEach(missingRule);
  const r = parse(v); assert.equal(r.original.coveredUs, "14400000000"); assert.deepEqual(r.gapBlockers, []);
  assert(r.sessions.every(s => s.checks.breakRule.state === "unavailable"));
});
test("later cancellation retains originally linked coverage but withholds gaps; before-start and ongoing phases also withhold gaps", () => {
  const cancelled = fixture(); cancelled.slot.cancelled = true; cancelled.sessions.forEach(s => { s.relation!.currentCancelled = true; });
  const c = parse(cancelled); assert.equal(c.original.coveredUs, "14400000000"); assert(c.gapBlockers.includes("cancelled")); assert.equal(c.original.gaps, null);
  const ongoing = planCoverageWire(); assert.equal(parse(ongoing).phase, "ongoing"); assert.equal(parse(ongoing).original.gaps, null);
  const future = fixture(0); future.readStartedAt = stamp("07:00:00.000000"); future.readCompletedAt = stamp("07:00:00.000001");
  assert.equal(parse(future).phase, "future"); assert(parse(future).gapBlockers.includes("plan_not_ended"));
});
test("cross-midnight and both DST changes use saved UTC endpoints, not fixed local-day lengths or current timezone reconstruction", () => {
  for (const [date, start, end, zone, expected] of [
    ["2026-09-02", "2026-09-02T22:00:00.000000Z", "2026-09-03T02:00:00.000000Z", "Europe/Madrid", "14400000000"],
    ["2026-03-29", "2026-03-29T00:00:00.000000Z", "2026-03-29T03:00:00.000000Z", "Europe/Madrid", "10800000000"],
    ["2026-10-25", "2026-10-25T00:00:00.000000Z", "2026-10-25T03:00:00.000000Z", "Europe/Madrid", "10800000000"],
  ]) {
    const v = fixture(1), child = v.sessions[0]; missingRule(child); span(child, start, end);
    child.rule.event.timeZone = zone; child.events.forEach(event => { event.timeZone = zone; });
    Object.assign(v.slot, { workDate: date, timeZone: zone, startAt: start.slice(0, 23) + "Z", endAt: end.slice(0, 23) + "Z" });
    child.relation!.slot = structuredClone(v.slot); cutoff(v, end);
    const r = parse(v); assert.equal(r.original.coveredUs, expected); assert.deepEqual(r.original.gaps, []); assert.equal(r.original.overlapUs, "0");
  }
});
test("all worker fields, auth identity, requested slot, immutable relation slot and observed time ordering bind each child", () => {
  const fail = (change: (v: PlanCoverageData) => void) => { const v = fixture(); change(v); assert.throws(() => parse(v), /attendance_plan_coverage_invalid/); };
  fail(v => { v.sessions[1].rule.worker.employeeAuthUserId = id(99); });
  fail(v => { v.sessions[1].rule.worker.version++; }); fail(v => { v.worker.workerName = "Different context"; });
  fail(v => { v.slot.id = id(99); }); fail(v => { v.slot.locationName = "Different saved place"; });
  fail(v => { v.sessions[1].relation!.currentCancelled = true; });
  fail(v => { v.sessions[1].rule.readAt = stamp("15:59:59.999999"); });
  fail(v => { v.sessions[1].asOf = stamp("16:00:00.000002"); });
  fail(v => { v.readCompletedAt = stamp("15:00:00.000000"); });
  fail(v => { v.sessions[1].relation = null; });
  fail(v => { v.sessions[1].relation = { ...v.sessions[1].relation!, status: "unselected", reason: null, selection: null, slot: null, currentCancelled: null }; });
});
test("UUID ordering, original sequence disjointness, global event identity and original chronological order are strict", () => {
  for (const mutate of [
    (v: PlanCoverageData) => { v.sessions.reverse(); },
    (v: PlanCoverageData) => { v.sessions[1] = structuredClone(v.sessions[0]); },
    (v: PlanCoverageData) => { span(v.sessions[1], stamp("12:00:00.000000"), stamp("14:00:00.000000"), 2); },
    (v: PlanCoverageData) => { span(v.sessions[1], stamp("09:00:00.000000"), stamp("11:00:00.000000")); },
    (v: PlanCoverageData) => { v.sessions[1].events[1].id = v.sessions[0].events[1].id; },
  ]) { const v = fixture(); mutate(v); assert.throws(() => parse(v), /attendance_plan_coverage_invalid/); }
});
function manyEvents(child: ShiftCheckData, breaks: number) {
  const first = child.events[0], startSequence = first.sequence, at = child.events[1].occurredAt, end = child.events.at(-1)!.occurredAt;
  child.events = [first];
  for (let i = 0; i < breaks; i++) child.events.push({ ...first, id: id(5000 + startSequence * 3000 + i * 2), sequence: startSequence + i * 2 + 1, action: "break_start", breakPaid: false, occurredAt: at },
    { ...first, id: id(5001 + startSequence * 3000 + i * 2), sequence: startSequence + i * 2 + 2, action: "break_end", occurredAt: at });
  child.events.push({ ...first, id: id(9000 + startSequence * 3000), sequence: startSequence + breaks * 2 + 1, action: "clock_out", occurredAt: end });
}
test("2002 complete events are accepted; aggregate2004 and11 sessions are rejected as too large", () => {
  const exact = fixture(1); manyEvents(exact.sessions[0], 1000); const r = parse(exact);
  assert.equal(r.sessions[0].events.length, 2002); assert.equal(r.original.coveredUs, twoHours);
  const aggregate = fixture(2); manyEvents(aggregate.sessions[0], 500); manyEvents(aggregate.sessions[1], 500);
  assert.throws(() => parse(aggregate), /attendance_plan_coverage_too_large/);
  const count = fixture(1); count.sessions = Array.from({ length: 11 }, () => structuredClone(count.sessions[0]));
  assert.throws(() => parse(count), /attendance_plan_coverage_too_large/);
});
test("unsafe JSON graphs, unknown fields and oversized bodies fail without executing accessors", () => {
  const bad = fixture(); let reads = 0; Object.defineProperty(bad, "worker", { enumerable: true, get: () => { reads++; return {}; } });
  assert.throws(() => parse(bad), /attendance_plan_coverage_invalid/); assert.equal(reads, 0);
  const sparse = fixture(); Reflect.deleteProperty(sparse.sessions, "0"); assert.throws(() => parse(sparse), /attendance_plan_coverage_invalid/);
  const extra = fixture(); Object.assign(extra, { original: { coveredUs: "0" } }); assert.throws(() => parse(extra), /attendance_plan_coverage_invalid/);
  const large = fixture(); Object.assign(large, { padding: "x".repeat(PLAN_COVERAGE_BYTE_LIMIT) }); assert.throws(() => parse(large), /attendance_plan_coverage_too_large/);
});
test("parsed results are detached and deeply frozen; public wire strips all derived geometry, including child calculations", () => {
  const raw = fixture(), before = structuredClone(raw), result = parse(raw), data = parsePlanCoverageData(raw, query, actor);
  assert.deepEqual(raw, before); assertFrozen(result); assertFrozen(data);
  raw.worker.workerName = "Changed after parse"; assert.equal(result.worker.workerName, before.worker.workerName);
  assert(!Object.hasOwn(data, "original")); assert(!Object.hasOwn(data, "selected")); assert(!Object.hasOwn(data.sessions[0], "checks"));
  assert.throws(() => parsePlanCoverageResponse({ ok: true, moduleEnabled: true, data: result }, query, actor), /attendance_plan_coverage_invalid/);
  const paused = parsePlanCoverageResponse({ ok: true, moduleEnabled: false, data }, query, actor); assert.equal(paused.moduleEnabled, false); assertFrozen(paused);
  assert.throws(() => parsePlanCoverageResponse({ ok: true, moduleEnabled: false, data, extra: true }, query, actor), /attendance_plan_coverage_invalid/);
});
