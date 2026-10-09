import assert from "node:assert/strict";
import test from "node:test";
import { resolveAttendanceScheduleEvidence, type ScheduleEvidenceResult } from "./merchantAttendanceScheduleEvidence";
import {
  scheduleEvidenceActor, scheduleEvidenceId as id, scheduleEvidenceQuery as query, scheduleEvidenceWire as wire,
  parseScheduleEvidenceWire as parse, scheduleEvidenceRow as row, scheduleEvidenceSlot as slot,
  scheduleEvidenceCorrection as correction, scheduleEvidenceMissing as missing, scheduleEvidenceLeave as leave,
  scheduleEvidenceCalendar as calendar, scheduleEvidenceSources,
} from "../../scripts/fixtures/attendance-schedule-evidence-model";

const resolve = (value = wire()) => resolveAttendanceScheduleEvidence(parse(value));
const view = (value: ScheduleEvidenceResult, kind: "original" | "selected" = "selected") => value.views.find(item => item.kind === kind)!;
const record = (value: ScheduleEvidenceResult, kind: "original" | "selected" = "selected") => view(value, kind).records[0];
const proposal = (startAt: string, endAt: string) => ({ startAt, endAt, breaks: [] });

test("actual sources parser feeds detached one-to-one temporal candidates, never formal application", () => {
  const source = scheduleEvidenceSources(), result = resolveAttendanceScheduleEvidence(source);
  assert.equal(result.protocol, "schedule-evidence-v1"); assert.equal(result.applied, false); assert.equal(result.formalReady, false);
  assert.equal(result.actorId, scheduleEvidenceActor); assert.equal(result.workerId, query.workerId);
  for (const item of result.views) {
    assert.equal(item.records[0].relation, "one-time-candidate"); assert.equal(item.schedules[0].relation, "one-time-candidate");
    assert.deepEqual(item.records[0].timeDifference, { scheduleId: slot().id, startDeltaUs: 0, endDeltaUs: 0 });
  }
  assert.ok(result.limitations.includes("location_not_proven")); assert.ok(result.limitations.includes("historical_identity_not_proven"));
  assert.ok(result.limitations.includes("clock_rule_binding_not_loaded")); assert.ok(result.limitations.includes("current_sources_not_frozen"));
  assert.equal(result.slots[0].startAt, "2026-09-02T08:00:00.000000Z");
});

test("mixed millisecond schedule and microsecond evidence preserve signed one-microsecond differences", () => {
  const raw = wire(); raw.attendance.base.items = [row(1, "2026-09-02T08:00:00.000001Z", "2026-09-02T15:59:59.999999Z")];
  assert.deepEqual(record(resolve(raw)).timeDifference, { scheduleId: slot().id, startDeltaUs: 1, endDeltaUs: -1 });
  raw.attendance.base.items = [row(1, "2026-09-02T07:59:59.999999Z", "2026-09-02T16:00:00.000001Z")];
  assert.deepEqual(record(resolve(raw)).timeDifference, { scheduleId: slot().id, startDeltaUs: -1, endDeltaUs: 1 });
});

test("half-open intervals touching either endpoint have no temporal edge", () => {
  for (const [start, end] of [["07:00:00", "08:00:00"], ["16:00:00", "17:00:00"]]) {
    const raw = wire(); raw.attendance.base.items = [row(1, `2026-09-02T${start}.000000Z`, `2026-09-02T${end}.000000Z`)];
    const result = resolve(raw); assert.equal(record(result).relation, "no-time-candidate");
    assert.deepEqual(record(result).candidateScheduleIds, []); assert.equal(record(result).timeDifference, null);
    assert.deepEqual(view(result).schedules[0].recordKeys, []);
  }
});

test("one record across two adjacent plans is ambiguous in both graph directions", () => {
  const raw = wire(); raw.schedule.items = [slot(1, "2026-09-02T08:00:00.000Z", "2026-09-02T12:00:00.000Z"), slot(2, "2026-09-02T12:00:00.000Z", "2026-09-02T16:00:00.000Z")];
  const result = resolve(raw); assert.equal(record(result).relation, "ambiguous"); assert.equal(record(result).candidateScheduleIds.length, 2);
  assert.equal(record(result).timeDifference, null); assert.ok(view(result).schedules.every(item => item.relation === "ambiguous"));
});

test("two separate records within one plan remain ambiguous even when each record has exactly one candidate", () => {
  const raw = wire(); raw.attendance.base.items = [row(1, "2026-09-02T08:00:00.000000Z", "2026-09-02T11:00:00.000000Z"), row(2, "2026-09-02T12:00:00.000000Z", "2026-09-02T16:00:00.000000Z")];
  const result = resolve(raw); assert.ok(view(result).records.every(item => item.candidateScheduleIds.length === 1 && item.relation === "ambiguous" && item.timeDifference === null));
  assert.equal(view(result).schedules[0].recordKeys.length, 2); assert.equal(view(result).schedules[0].relation, "ambiguous");
});

test("latest approved correction changes only selected-view candidate provenance", () => {
  const raw = wire(), original = row(1, "2026-09-01T08:00:00.000000Z", "2026-09-01T16:00:00.000000Z");
  original.effect = correction(original, proposal("2026-09-03T08:00:00.000000Z", "2026-09-03T16:00:00.000000Z"));
  raw.attendance.base.items = [original]; raw.schedule.items = [slot(1, "2026-09-01T08:00:00.000Z", "2026-09-01T16:00:00.000Z"), slot(2, "2026-09-03T08:00:00.000Z", "2026-09-03T16:00:00.000Z")];
  const result = resolve(raw), old = record(result, "original"), selected = record(result);
  assert.equal(old.kind, "original"); assert.equal(old.operationId, null); assert.deepEqual(old.candidateScheduleIds, [slot(1).id]);
  assert.equal(selected.kind, "approved"); assert.equal(selected.operationId, original.effect.operationId); assert.equal(selected.revision, 1);
  assert.deepEqual(selected.candidateScheduleIds, [slot(2).id]); assert.equal(old.key, selected.key);
});

test("original outside-window with selected moved inside remains present without a fabricated original match", () => {
  const raw = wire({ query: { ...query, fromDate: "2026-09-02", throughDate: "2026-09-02" } });
  const original = row(1, "2026-09-01T08:00:00.000000Z", "2026-09-01T16:00:00.000000Z");
  original.effect = correction(original, proposal("2026-09-02T08:00:00.000000Z", "2026-09-02T16:00:00.000000Z")); raw.attendance.base.items = [original];
  const result = resolve(raw); assert.equal(record(result, "original").relation, "outside-window"); assert.equal(record(result, "original").timeDifference, null);
  assert.equal(record(result).relation, "one-time-candidate"); assert.equal(record(result).timeDifference!.startDeltaUs, 0);
});

test("selected correction wholly moved out never inherits the original view's candidate", () => {
  const raw = wire({ query: { ...query, fromDate: "2026-09-02", throughDate: "2026-09-02" } }), original = raw.attendance.base.items[0];
  original.effect = correction(original, proposal("2026-09-03T08:00:00.000000Z", "2026-09-03T16:00:00.000000Z"));
  const result = resolve(raw); assert.equal(record(result, "original").relation, "one-time-candidate");
  assert.equal(record(result).relation, "outside-window"); assert.deepEqual(record(result).candidateScheduleIds, []); assert.equal(record(result).timeDifference, null);
});

test("whole-missing approval is a separate selected-only record with no synthetic punch identifier", () => {
  const raw = wire(); raw.attendance.missing = [missing()]; raw.schedule.items.push(slot(2, "2026-09-03T08:00:00.000Z", "2026-09-03T16:00:00.000Z"));
  const result = resolve(raw), item = view(result).records[1]; assert.equal(view(result, "original").records.length, 1);
  assert.equal(item.kind, "missing-approved"); assert.equal(item.key, `missing:${missing().requestId}`); assert.equal(item.referenceId, missing().requestId);
  assert.equal(item.startEventId, null); assert.equal(item.operationId, missing().operationId); assert.equal(item.revision, null);
  assert.equal(item.relation, "one-time-candidate"); assert.equal(Object.hasOwn(item, "events"), false);
});

test("open record observes only asOf, never readAt or a synthetic clock-out", () => {
  const raw = wire({ asOf: "2026-09-02T10:00:00.000001Z" }); raw.attendance.base.items = [row(1, "2026-09-02T08:00:00.000000Z", null)];
  raw.readAt = "2026-09-02T12:00:00.000001Z"; raw.schedule.items.push(slot(2, "2026-09-02T17:00:00.000Z", "2026-09-02T18:00:00.000Z"));
  const result = resolve(raw), item = record(result); assert.equal(item.endAt, null); assert.equal(item.observedUntilAt, raw.attendance.base.asOf);
  assert.deepEqual(item.candidateScheduleIds, [slot().id]); assert.equal(item.timeDifference, null); assert.ok(item.reasons.includes("open_record"));
  assert.equal(result.slots[0].phase, "ongoing"); assert.equal(result.slots[1].phase, "future");
});

test("open observation ending exactly at a plan start does not project attendance into the future", () => {
  const raw = wire({ asOf: "2026-09-02T10:00:00.000000Z" }); raw.attendance.base.items = [row(1, "2026-09-02T08:00:00.000000Z", null)];
  raw.schedule.items = [slot(1, "2026-09-02T10:00:00.000Z", "2026-09-02T12:00:00.000Z")];
  const result = resolve(raw); assert.equal(record(result).relation, "no-time-candidate"); assert.equal(record(result).timeDifference, null);
  assert.equal(result.slots[0].phase, "ongoing");
});

test("valid zero-duration completed punch remains explicit and creates no interval edge", () => {
  const raw = wire(); raw.attendance.base.items = [row(1, "2026-09-02T08:00:00.000000Z", "2026-09-02T08:00:00.000000Z")];
  const result = resolve(raw); assert.equal(record(result).relation, "zero-duration"); assert.equal(record(result).endAt, record(result).startAt);
  assert.deepEqual(record(result).candidateScheduleIds, []); assert.equal(record(result).timeDifference, null);
});

test("cross-night carry-in relates within the window but suppresses full-span differences", () => {
  const raw = wire({ query: { ...query, fromDate: "2026-09-02", throughDate: "2026-09-02" } });
  raw.attendance.base.items = [row(1, "2026-09-01T23:00:00.000000Z", "2026-09-02T03:00:00.000000Z")];
  raw.schedule.items = [slot(1, "2026-09-01T22:00:00.000Z", "2026-09-02T04:00:00.000Z")];
  const result = resolve(raw), item = record(result); assert.equal(item.relation, "one-time-candidate");
  assert.equal(item.windowPartial, true); assert.equal(result.slots[0].windowPartial, true); assert.equal(item.timeDifference, null);
  assert.ok(item.reasons.includes("record_crosses_window")); assert.ok(item.reasons.includes("schedule_crosses_window"));
});

test("fully-contained overnight interval uses UTC differences rather than workDate equality", () => {
  const raw = wire(); raw.attendance.base.items = [row(1, "2026-09-01T23:00:00.000000Z", "2026-09-02T03:00:00.000000Z")];
  raw.schedule.items = [slot(1, "2026-09-01T22:00:00.000Z", "2026-09-02T04:00:00.000Z")];
  const result = resolve(raw); assert.equal(record(result).windowPartial, false);
  assert.deepEqual(record(result).timeDifference, { scheduleId: slot().id, startDeltaUs: 3600000000, endDeltaUs: -3600000000 });
});

test("Madrid DST civil windows remain 23 and 25 hours with exact UTC plan relationships", () => {
  for (const [date, start, end, hours] of [["2026-03-29", "2026-03-29T00:00:00.000Z", "2026-03-29T03:00:00.000Z", 23],
    ["2026-10-25", "2026-10-25T00:00:00.000Z", "2026-10-25T03:00:00.000Z", 25]] as const) {
    const raw = wire({ query: { ...query, fromDate: date, throughDate: date }, timeZone: "Europe/Madrid", asOf: "2026-11-01T00:00:00.000001Z", empty: true });
    raw.attendance.base.items = [row(1, start, end, { timeZone: "Europe/Madrid" })]; raw.schedule.items = [slot(1, start, end, { timeZone: "Europe/Madrid" })];
    const result = resolve(raw); assert.equal((Date.parse(result.toAt) - Date.parse(result.fromAt)) / 3600000, hours);
    assert.equal(record(result).relation, "one-time-candidate"); assert.equal(record(result).timeDifference!.startDeltaUs, 0);
  }
});

test("future and ongoing schedules remain temporal states, not absence or completed comparisons", () => {
  const future = wire({ empty: true, asOf: "2026-09-01T12:00:00.000001Z" }); future.schedule.items = [slot()];
  const result = resolve(future); assert.equal(result.slots[0].phase, "future"); assert.equal(view(result).records.length, 0);
  assert.equal(view(result).schedules[0].relation, "no-time-candidate");
  const ongoing = wire({ asOf: "2026-09-02T10:00:00.000001Z" }); ongoing.attendance.base.items = [row(1, "2026-09-02T08:00:00.000000Z", "2026-09-02T09:00:00.000000Z")];
  const item = record(resolve(ongoing)); assert.equal(item.relation, "one-time-candidate"); assert.equal(item.timeDifference, null); assert.ok(item.reasons.includes("schedule_not_ended"));
});

test("cancelled overlapping plan is preserved for context but excluded from both candidate graphs", () => {
  const raw = wire(); raw.schedule.items.push(slot(2, undefined, undefined, { cancelled: true, cancelReason: "Synthetic cancellation" }));
  const result = resolve(raw); assert.equal(result.slots.length, 2); assert.equal(result.slots[1].cancelled, true);
  assert.deepEqual(record(result).candidateScheduleIds, [slot().id]); assert.equal(record(result).relation, "one-time-candidate"); assert.equal(view(result).schedules.length, 1);
  raw.schedule.items[0].cancelled = true; raw.schedule.items[0].cancelReason = "Also cancelled";
  assert.equal(record(resolve(raw)).relation, "no-time-candidate");
});

test("schedule-limited is unknown rather than an empty complete plan list", () => {
  const raw = wire(); raw.schedule = { limited: true, items: [] }; raw.calendar = { limited: true, items: [] };
  const result = resolve(raw); assert.equal(result.coverage.schedule, "limited"); assert.equal(result.slots.length, 0);
  assert.equal(record(result).relation, "schedule-limited"); assert.equal(record(result).timeDifference, null);
});

test("leave and calendar truncation annotate coverage and suppress literal comparisons without erasing edges", () => {
  for (const key of ["leave", "calendar"] as const) {
    const raw = wire(); raw[key] = { limited: true, items: [] }; const result = resolve(raw), item = record(result);
    assert.equal(result.coverage[key], "limited"); assert.equal(item.relation, "one-time-candidate");
    assert.ok(item.reasons.includes(`${key}_limited`)); assert.equal(item.timeDifference, null);
  }
  const unrelated = wire(); unrelated.assignments = { limited: true, items: [] }; unrelated.rules = { limited: true, items: [] };
  assert.notEqual(record(resolve(unrelated)).timeDifference, null);
});

test("historical identity mismatch and inactive worker retain evidence but withhold comparisons", () => {
  const raw = wire(); raw.leave.items = [leave(1, "approved", { employeeId: id(999) })];
  const result = resolve(raw); assert.equal(result.coverage.identityChanged, true); assert.equal(result.slots[0].leave[0].employeeMatches, false);
  assert.equal(record(result).relation, "one-time-candidate"); assert.equal(record(result).timeDifference, null); assert.ok(record(result).reasons.includes("identity_changed"));
  const inactive = wire(); inactive.worker.active = false; assert.equal(record(resolve(inactive)).timeDifference, null); assert.ok(record(resolve(inactive)).reasons.includes("inactive_worker"));
});

test("all leave lifecycle statuses remain distinct hints and do not deduct or excuse time", () => {
  const raw = wire(), statuses = ["submitted", "withdrawn", "approved", "rejected", "cancelled"] as const;
  raw.leave.items = statuses.map((status, n) => leave(n + 1, status)); const result = resolve(raw);
  assert.deepEqual(result.slots[0].leave.map(item => item.status), statuses); assert.ok(result.slots[0].leave.every(item => item.employeeMatches));
  assert.deepEqual(record(result).timeDifference, { scheduleId: slot().id, startDeltaUs: 0, endDeltaUs: 0 });
  assert.equal(Object.hasOwn(result, "excused"), false); assert.equal(Object.hasOwn(result, "workedUs"), false);
});

test("calendar joins saved plan location and saved zone dates, preserving cancelled notices", () => {
  const raw = wire(); raw.attendance.base.items[0].events.forEach(event => { event.locationId = id(6); });
  raw.schedule.items = [slot(1, "2026-09-02T01:00:00.000Z", "2026-09-02T03:00:00.000Z")];
  const common = { fromDate: "2026-09-01", throughDate: "2026-09-01", timeZone: "America/Los_Angeles" };
  raw.calendar.items = [calendar(1, common), calendar(2, { ...common, locationId: id(5), locationName: "Saved schedule place" }),
    calendar(3, { ...common, locationId: id(6), locationName: "Different actual place" }), calendar(4, { ...common, status: "cancelled", revision: 2 })];
  const result = resolve(raw), hints = result.slots[0].calendar; assert.deepEqual(hints.map(item => item.entryId), [calendar(1).entryId, calendar(2).entryId, calendar(4).entryId]);
  assert.equal(hints[2].status, "cancelled"); assert.ok(hints.every(item => item.fromAt === "2026-09-02T01:00:00.000000Z" && item.toAt === "2026-09-02T03:00:00.000000Z"));
});

test("leave and calendar hints touching a plan endpoint do not intersect", () => {
  const raw = wire(); const hint = leave(); hint.summary.startAt = "2026-09-02T06:00:00.000Z"; hint.summary.endAt = "2026-09-02T08:00:00.000Z"; raw.leave.items = [hint];
  raw.calendar.items = [calendar(1, { fromDate: "2026-09-01", throughDate: "2026-09-01", timeZone: "America/Los_Angeles" })];
  assert.deepEqual(resolve(raw).slots[0].leave, []); assert.deepEqual(resolve(raw).slots[0].calendar, []);
});

test("inputs and totals remain unchanged; output is recursively frozen with no input object aliases", () => {
  const raw = wire(); raw.leave.items = [leave()]; raw.calendar.items = [calendar()];
  const source = parse(raw), before = structuredClone(source), result = resolveAttendanceScheduleEvidence(source), inputObjects = new Set<object>();
  const visit = (value: unknown, callback: (value: object) => void) => {
    if (!value || typeof value !== "object") return; callback(value); for (const child of Object.values(value)) visit(child, callback);
  };
  visit(source, value => inputObjects.add(value)); visit(result, value => { assert.equal(Object.isFrozen(value), true); assert.equal(inputObjects.has(value), false); });
  assert.deepEqual(source, before); const saved = JSON.stringify(result); source.schedule.items[0].locationName = "Edited input"; source.leave.items[0].summary.status = "rejected";
  assert.equal(JSON.stringify(result), saved); assert.equal(Object.hasOwn(result, "totals"), false);
  assert.throws(() => { (result.slots as unknown[]).push({}); }, TypeError);
});

test("100 schedules and 100 records remain complete and 101 is rejected rather than silently truncated", () => {
  const raw = wire({ empty: true });
  for (let n = 1; n <= 100; n++) {
    const start = new Date(Date.parse("2026-09-02T08:00:00.000Z") + (n - 1) * 120000).toISOString(), end = new Date(Date.parse(start) + 60000).toISOString();
    raw.schedule.items.push(slot(n, start, end)); raw.attendance.base.items.push(row(n, start, end));
  }
  const source = parse(raw), result = resolveAttendanceScheduleEvidence(source); assert.equal(result.slots.length, 100);
  for (const item of result.views) { assert.equal(item.records.length, 100); assert.equal(item.schedules.length, 100); assert.ok(item.records.every(record => record.relation === "one-time-candidate")); }
  const overWire = structuredClone(raw); overWire.schedule.items.push(slot(101, "2026-09-02T12:00:00.000Z", "2026-09-02T12:01:00.000Z")); assert.throws(() => parse(overWire));
  const overRows = structuredClone(raw); overRows.attendance.base.items.push(row(101, "2026-09-02T12:00:00.000Z", "2026-09-02T12:01:00.000Z")); assert.throws(() => parse(overRows));
  const mutated = structuredClone(source); mutated.schedule.items.push(structuredClone(mutated.schedule.items[0]));
  assert.throws(() => resolveAttendanceScheduleEvidence(mutated), /attendance_schedule_evidence_too_large/);
});

test("focused defensive guards reject malformed normalized scope, mixed limited payload and duplicate records", () => {
  const mutations = [
    (value: ReturnType<typeof parse>) => { value.worker.workerId = id(99); },
    (value: ReturnType<typeof parse>) => { value.schedule.limited = true; },
    (value: ReturnType<typeof parse>) => { value.attendance.base.rows.push(structuredClone(value.attendance.base.rows[0])); },
    (value: ReturnType<typeof parse>) => { value.schedule.items[0].workerId = id(99); },
    (value: ReturnType<typeof parse>) => { value.attendance.base.rows[0].selected.endAt = "2026-09-02T07:00:00.000000Z"; },
  ];
  for (const mutate of mutations) { const value = parse(wire()); mutate(value); assert.throws(() => resolveAttendanceScheduleEvidence(value)); }
});

test("valid local endpoint dates may have UTC boundaries in 1999 or 2101", () => {
  for (const [date, timeZone, fromAt, toAt] of [
    ["2000-01-01", "Pacific/Kiritimati", "1999-12-31T10:00:00.000000Z", "2000-01-01T10:00:00.000000Z"],
    ["2100-12-31", "UTC", "2100-12-31T00:00:00.000000Z", "2101-01-01T00:00:00.000000Z"],
  ]) {
    const raw = wire({ query: { ...query, fromDate: date, throughDate: date }, timeZone, empty: true });
    const result = resolve(raw); assert.equal(result.fromAt, fromAt); assert.equal(result.toAt, toAt); assert.equal(view(result).records.length, 0);
  }
});

test("valid source location labels count Unicode code points rather than UTF-16 units", () => {
  const raw = wire(); raw.schedule.items[0].locationName = "😀".repeat(100);
  assert.equal(resolve(raw).slots[0].locationName, raw.schedule.items[0].locationName);
});
