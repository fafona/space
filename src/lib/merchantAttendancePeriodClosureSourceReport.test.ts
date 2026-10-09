import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sheetWire, sheetEvent, sheetEffect, firstApprovalSourceV2, timesheetId as id } from "../../scripts/fixtures/attendance-timesheet-model";
import { parseUnifiedSource, type MissingReportSource, type UnifiedQuery } from "./merchantAttendanceUnifiedTimesheet";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import { parsePeriodClosureSourceReport, type PeriodClosureSourceBasis } from "./merchantAttendancePeriodClosureSourceReport";

function wire() {
  return { version: "attendance-unified-v1", access: "owner" as "owner" | "self", base: firstApprovalSourceV2(sheetWire()),
    missing: [] as MissingReportSource[], complete: true, payrollReady: false };
}
type Wire = ReturnType<typeof wire>;
const next = (date: string) => new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
const utc6 = (s: string) => s.replace(/Z$/, "000Z");
function frame(raw: Wire): PeriodClosureSourceBasis {
  const b = raw.base, dayBoundaries: PeriodClosureSourceBasis["dayBoundaries"] = [];
  for (let date = b.fromDate; date <= b.throughDate; date = next(date)) {
    try { const r = attendanceDayUtcRange(date, b.timeZone); dayBoundaries.push({ date, fromAt: utc6(r.startAt), toAt: utc6(r.endAt), skipped: false }); }
    catch (e) { if (!(e instanceof Error) || e.message !== "attendance_local_date_does_not_exist") throw e;
      const at = utc6(attendanceDayUtcRange(next(date), b.timeZone).startAt); dayBoundaries.push({ date, fromAt: at, toAt: at, skipped: true }); }
  }
  return { siteId: b.siteId, access: raw.access, workerId: b.workerId, employeeId: b.employeeId, employeeAuthUserId: id(9),
    fromDate: b.fromDate, throughDate: b.throughDate, timeZone: b.timeZone, fromAt: b.fromAt, toAt: b.toAt, dayBoundaries };
}
function query(raw: Wire): UnifiedQuery {
  const b = raw.base; return raw.access === "owner" ? { siteId: b.siteId, access: "owner", workerId: b.workerId, fromDate: b.fromDate, throughDate: b.throughDate }
    : { siteId: b.siteId, access: "self", expectedWorkerId: b.workerId, fromDate: b.fromDate, throughDate: b.throughDate };
}
function missing(startAt = "2026-09-08T20:00:00.000000Z", endAt = "2026-09-09T05:00:00.000000Z"): MissingReportSource {
  return { source: "missing-approved", requestId: id(500), operationId: id(501), workerId: id(4), employeeId: null, workerName: "Saved worker",
    locationId: id(5), locationName: "Saved location", timeZone: "Europe/Madrid", policyRevision: 1,
    proposal: { startAt, endAt, breaks: [] }, submittedAt: "2026-09-25T06:00:00.000000Z", approvedAt: "2026-09-25T07:00:00.000000Z" };
}
function self(raw: Wire): Wire {
  const r = structuredClone(raw); r.access = "self";
  Object.assign(r.base, { access: "self", viewerEmployeeId: id(2), scopeRevision: null, locationId: null,
    coverage: "authorized-complete-sessions-v1", accessValidUntil: null });
  for (const row of r.base.items) { for (const e of row.events) Object.assign(e, { actorEmployeeId: id(2) }); if (row.effect) Object.assign(row.effect, { employeeId: id(2) }); }
  r.missing.forEach(m => { m.employeeId = id(2); }); return r;
}
function parity(raw: Wire) {
  const f = frame(raw), before = structuredClone({ raw, f }), expected = parseUnifiedSource(raw, query(raw));
  assert.deepEqual(parsePeriodClosureSourceReport(raw, f), expected); assert.deepEqual({ raw, f }, before); return expected;
}
function ranged(zone: string, fromDate: string, throughDate: string, asOf: string): Wire {
  const r = wire(); Object.assign(r.base, { timeZone: zone, fromDate, throughDate, asOf,
    fromAt: utc6(attendanceDayUtcRange(fromDate, zone).startAt), toAt: utc6(attendanceDayUtcRange(throughDate, zone).endAt), items: [] }); return r;
}

test("normal original and first/latest approved reports are exactly equal to the old algorithm for owner/self", () => {
  const raw = wire(); parity(raw); parity(self(raw));
  raw.base.items[0].effect = sheetEffect({ startAt: "2026-09-05T06:00:00.000000Z", endAt: "2026-09-05T18:00:00.000000Z",
    breaks: [{ startAt: "2026-09-05T11:00:00.000000Z", endAt: "2026-09-05T12:00:00.000000Z", paid: true }] });
  raw.base = firstApprovalSourceV2(raw.base); raw.missing = [missing()]; parity(raw); parity(self(raw));
  Object.assign(raw.base.items[0].effect!, { revision: 2, requestId: id(31), operationId: id(41), recordedAt: "2026-09-26T20:00:00.000000Z",
    lineage: { rootRequestId: id(30), rootOperationId: id(40), rootRecordedAt: "2026-09-25T20:00:00.000000Z", previousOperationId: id(40) } });
  parity(raw); parity(self(raw));
});

test("cross-midnight raw breaks and missing declarations preserve paid/unpaid amounts and zero rounding", () => {
  const r = wire(); r.base.items[0].events = [sheetEvent(1, "clock_in", "2026-09-06T20:00:00.000000Z"),
    sheetEvent(2, "break_start", "2026-09-06T21:30:00.000000Z", true), sheetEvent(3, "break_end", "2026-09-06T22:30:00.000000Z"),
    sheetEvent(4, "clock_out", "2026-09-07T04:00:00.000001Z")];
  r.missing = [missing()]; r.missing[0].proposal.breaks = [{ startAt: "2026-09-08T21:30:00.000000Z", endAt: "2026-09-08T22:30:00.000000Z", paid: false }];
  const result = parity(r); parity(self(r)); assert.equal(result.totals.original.workedUs, 7 * 3600000000 + 1);
  assert.equal(result.totals.original.paidBreakUs, 3600000000); assert.equal(result.totals.missingSelected.workedUs, 8 * 3600000000);
});

test("23/25-hour civil days and equivalent saved aliases retain exact old output", () => {
  for (const [first, last, start, end, asOf] of [
    ["2026-03-28", "2026-03-29", "2026-03-28T20:00:00.000000Z", "2026-03-29T05:00:00.000000Z", "2026-03-30T00:00:00.000000Z"],
    ["2026-10-24", "2026-10-25", "2026-10-24T20:00:00.000000Z", "2026-10-25T05:00:00.000000Z", "2026-10-26T00:00:00.000000Z"],
  ]) {
    const r = ranged("Europe/Madrid", first, last, asOf);
    r.base.items = [{ startEventId: id(101), events: [sheetEvent(1, "clock_in", start), sheetEvent(2, "break_start", start.slice(0, 11) + "21:30:00.000000Z", true),
      sheetEvent(3, "break_end", start.slice(0, 11) + "22:30:00.000000Z"), sheetEvent(4, "clock_out", end)], effect: null }]; parity(r); parity(self(r));
    const m = missing(start, end); m.submittedAt = asOf; m.approvedAt = asOf; r.base.items = []; r.missing = [m]; parity(r); parity(self(r));
  }
  for (const z of ["UTC", "Etc/UTC"]) { const r = ranged(z, "2026-09-05", "2026-09-05", "2026-09-06T00:00:00.000000Z");
    r.base.items = wire().base.items; parity(r); }
});

test("interior skipped civil date is zero-length, never counted as an empty attendance day", () => {
  const r = ranged("Pacific/Apia", "2011-12-29", "2011-12-31", "2012-01-02T00:00:00.000000Z");
  const result = parity(r); assert.deepEqual(result.base.skippedDates, ["2011-12-30"]); assert.deepEqual(result.days.map(d => d.date), ["2011-12-29", "2011-12-31"]);
});

test("zero-duration completed and genuinely open sessions retain old semantics", () => {
  const r = wire(); r.base.items[0].events[1].occurredAt = r.base.items[0].events[0].occurredAt;
  assert.equal(parity(r).totals.original.workedUs, 0);
  r.base.items[0].events = [sheetEvent(1, "clock_in", "2026-08-15T08:00:00.000000Z"), sheetEvent(2, "break_start", "2026-09-05T09:00:00.000000Z", true)];
  const open = parity(r); parity(self(r)); assert.equal(open.base.openSessionCount, 1); assert.equal(open.base.rows[0].original.totals, null); assert.equal(open.totals.original.workedUs, 0);
});

test("a validated fixed frame is used even when today's zone rules disagree or Intl is unavailable", () => {
  const r = ranged("Europe/Madrid", "2026-09-06", "2026-09-07", "2026-09-08T00:00:00.000000Z");
  r.base.items = [{ startEventId: id(101), events: [sheetEvent(1, "clock_in", "2026-09-06T21:00:00.000000Z"), sheetEvent(2, "clock_out", "2026-09-06T23:00:00.000000Z")], effect: null }];
  const f = frame(r), expected = parsePeriodClosureSourceReport(r, f);
  const ctor = Object.getOwnPropertyDescriptor(Intl, "DateTimeFormat")!, method = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "formatToParts")!, prototype = Intl.DateTimeFormat.prototype;
  try {
    Object.defineProperty(prototype, "formatToParts", { ...method, value() { throw Error("current_tzdata_must_not_run"); } });
    Object.defineProperty(Intl, "DateTimeFormat", { ...ctor, value() { throw Error("current_tzdata_must_not_run"); } });
    assert.deepEqual(parsePeriodClosureSourceReport(r, f), expected);
    f.dayBoundaries[0].toAt = f.dayBoundaries[1].fromAt = "2026-09-06T23:00:00.000000Z";
    const changed = parsePeriodClosureSourceReport(r, f); assert.deepEqual(changed.totals, expected.totals);
    assert.deepEqual(changed.days.map(d => d.original.elapsedUs), [2 * 3600000000, 0]);
    r.base.timeZone = f.timeZone = "Saved/Unavailable_Name"; r.base.items[0].events.forEach(e => { e.timeZone = "Saved/Event_Name"; });
    assert.equal(parsePeriodClosureSourceReport(r, f).base.timeZone, "Saved/Unavailable_Name");
  } finally { Object.defineProperty(Intl, "DateTimeFormat", ctor); Object.defineProperty(prototype, "formatToParts", method); }
});

test("frames reject reordered/missing dates, gaps, overlaps, bad skipped flags and detached ranges", () => {
  const r = wire(), valid = frame(r);
  const patches: ((f: PeriodClosureSourceBasis) => void)[] = [f => { f.dayBoundaries.reverse(); }, f => { f.dayBoundaries.pop(); },
    f => { f.dayBoundaries[1].date = f.dayBoundaries[0].date; }, f => { f.dayBoundaries[0].date = "2026-02-30"; },
    f => { f.dayBoundaries[1].fromAt = "2026-09-01T23:00:00.000000Z"; }, f => { f.dayBoundaries[1].toAt = f.dayBoundaries[1].fromAt; },
    f => { f.dayBoundaries[0].skipped = true; }, f => { f.dayBoundaries[0].fromAt = f.dayBoundaries[0].toAt; },
    f => { f.dayBoundaries[0].toAt = f.dayBoundaries[0].fromAt; f.dayBoundaries[0].skipped = true; f.dayBoundaries[1].fromAt = f.fromAt; },
    f => { const last = f.dayBoundaries.at(-1)!; last.fromAt = last.toAt; last.skipped = true; f.dayBoundaries.at(-2)!.toAt = f.toAt; },
    f => { f.fromAt = "2026-09-01T00:00:00.000000Z"; }, f => { f.throughDate = "2026-10-01"; },
    f => { f.dayBoundaries[0].fromAt = "2026-08-31T22:00:00.000Z"; }, f => { f.timeZone = "Europe/London"; },
    f => { f.employeeId = id(999); }, f => { f.employeeAuthUserId = "invalid"; }];
  for (const patch of patches) { const f = structuredClone(valid); patch(f); assert.throws(() => parsePeriodClosureSourceReport(r, f)); }
  assert.throws(() => parsePeriodClosureSourceReport(r, { ...valid, access: "manager" }));
});

test("self coverage, every event actor, approved effect employee and missing employee remain enforced", () => {
  const owner = wire(); owner.base.items[0].effect = sheetEffect({ startAt: "2026-09-05T07:00:00.000000Z", endAt: "2026-09-05T16:00:00.000000Z", breaks: [] });
  owner.base = firstApprovalSourceV2(owner.base); owner.missing = [missing()]; const r = self(owner), f = frame(r); parity(r);
  for (const patch of [{ viewerEmployeeId: id(999) }, { employeeId: id(999) }, { scopeRevision: 1 }, { locationId: id(5) }, { accessValidUntil: r.base.asOf }, { coverage: "partial" }])
    assert.throws(() => parsePeriodClosureSourceReport({ ...r, base: { ...r.base, ...patch } }, f));
  const event = structuredClone(r); Object.assign(event.base.items[0].events[1], { actorEmployeeId: id(999) }); assert.throws(() => parsePeriodClosureSourceReport(event, f));
  const effect = structuredClone(r); Object.assign(effect.base.items[0].effect!, { employeeId: id(999) }); assert.throws(() => parsePeriodClosureSourceReport(effect, f));
  const m = structuredClone(r); m.missing[0].employeeId = id(999); assert.throws(() => parsePeriodClosureSourceReport(m, f));
});

test("sequence, original anchor, latest lineage and declared amounts fail closed", () => {
  const r = wire(); r.base.items[0].effect = sheetEffect({ startAt: "2026-09-05T07:00:00.000000Z", endAt: "2026-09-05T16:00:00.000000Z", breaks: [] });
  r.base = firstApprovalSourceV2(r.base); const f = frame(r);
  for (const patch of [{ originalLastEventId: id(999) }, { workedUs: 0 }, { timeZone: "UTC" }, { revision: 2 }, { lineage: null }]) {
    const changed = structuredClone(r); Object.assign(changed.base.items[0].effect!, patch); assert.throws(() => parsePeriodClosureSourceReport(changed, f));
  }
  const duplicate = structuredClone(r); duplicate.base.items.push(duplicate.base.items[0]); assert.throws(() => parsePeriodClosureSourceReport(duplicate, f));
  const sequence = structuredClone(r); sequence.base.items[0].events[1].sequence = 3; assert.throws(() => parsePeriodClosureSourceReport(sequence, f), /attendance_session_invalid_records/);
});

test("approved moved-in/moved-out spans and combined overlap rejection equal the old parser", () => {
  const r = ranged("Europe/Madrid", "2026-09-06", "2026-09-06", "2026-09-30T12:00:00.000000Z");
  r.base.items = wire().base.items; r.base.items[0].effect = sheetEffect({ startAt: "2026-09-06T07:00:00.000000Z", endAt: "2026-09-06T16:00:00.000000Z", breaks: [] });
  r.base = firstApprovalSourceV2(r.base); const movedIn = parity(r); assert.equal(movedIn.totals.original.workedUs, 0);
  r.base.fromDate = r.base.throughDate = "2026-09-05"; r.base.fromAt = "2026-09-04T22:00:00.000000Z"; r.base.toAt = "2026-09-05T22:00:00.000000Z";
  assert.equal(parity(r).totals.recordedSelected.workedUs, 0);
  const conflict = wire(); conflict.missing = [missing("2026-09-05T09:00:00.000000Z", "2026-09-05T10:00:00.000000Z")];
  assert.throws(() => parsePeriodClosureSourceReport(conflict, frame(conflict)), /attendance_report_reconciliation_required/);
  assert.throws(() => parseUnifiedSource(conflict, query(conflict)), /attendance_report_reconciliation_required/);
});

test("the 100-related-source bound accepts zero-duration rows and rejects the 101st", () => {
  const r = wire(), at = "2026-09-05T08:00:00.000000Z";
  r.base.items = Array.from({ length: 100 }, (_, n) => ({ startEventId: id(1000 + n * 2), effect: null,
    events: [sheetEvent(n * 2 + 1, "clock_in", at), sheetEvent(n * 2 + 2, "clock_out", at)].map((e, k) => ({ ...e, id: id(1000 + n * 2 + k) })) }));
  assert.equal(parity(r).base.rows.length, 100); r.missing = [missing()];
  assert.throws(() => parsePeriodClosureSourceReport(r, frame(r)), /attendance_report_too_large/);
});

test("per-session 2002 and total 4000 events remain bounded without truncation", () => {
  const at = "2026-09-05T08:00:00.000000Z";
  const item = (rests: number, first: number) => {
    const actions = ["clock_in", ...Array.from({ length: rests }, () => ["break_start", "break_end"]).flat(), "clock_out"];
    const events = actions.map((action, n) => sheetEvent(first + n, action as Parameters<typeof sheetEvent>[1], at, n % 2 === 0));
    return { startEventId: events[0].id, events, effect: null };
  };
  const r = wire(); r.base.items = [item(1000, 1), item(998, 2003)];
  assert.equal(r.base.items.reduce((n, row) => n + row.events.length, 0), 4000); parity(r);
  r.base.items[1] = item(999, 2003); assert.throws(() => parsePeriodClosureSourceReport(r, frame(r)));
  r.base.items = [item(1001, 1)]; assert.throws(() => parsePeriodClosureSourceReport(r, frame(r)));
});

test("sparse/accessor-shaped arrays and undeclared frame keys cannot masquerade as complete saved days", () => {
  const r = wire(), f = frame(r);
  assert.throws(() => parsePeriodClosureSourceReport(r, { ...f, currentTimeZone: "UTC" }));
  const extra = structuredClone(f); Object.assign(extra.dayBoundaries, { hidden: true }); assert.throws(() => parsePeriodClosureSourceReport(r, extra));
  const sparse = structuredClone(f); delete (sparse.dayBoundaries as unknown[])[0]; assert.throws(() => parsePeriodClosureSourceReport(r, sparse));
  const accessor = structuredClone(f); Object.defineProperty(accessor.dayBoundaries, "0", { enumerable: true, get() { throw Error("getter_must_not_execute"); } });
  assert.throws(() => parsePeriodClosureSourceReport(r, accessor), /attendance_report_invalid_data/);
});

test("the new projection never dispatches to dynamic day/session/report calculation", () => {
  const source = readFileSync(new URL("./merchantAttendancePeriodClosureSourceReport.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:Intl|attendanceDayUtcRange|attendanceLocalDate|attendanceTimeZone|summarizeAttendanceSessionRecords|parseUnifiedSource|parseAttendanceTimesheetResult)\s*[.(]/);
  assert.match(source, /No estimated|NO estimated/);
});
