import assert from "node:assert/strict";
import test from "node:test";
import { sheetWire, sheetEffect, firstApprovalSourceV2, timesheetId as id } from "../../scripts/fixtures/attendance-timesheet-model";
import { emptyAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import type { GroupAssignmentItem, GroupAssignmentDetail, GroupItem } from "./merchantAttendanceGroups";
import type { ScheduleEntry } from "./merchantAttendanceSchedule";
import type { CalendarSummary } from "./merchantAttendanceCalendar";
import type { RulesItem } from "./merchantAttendanceRules";
import { parseSourcesQuery, parseSourcesHttpQuery, sourcesQueryString, parseSourcesResult, parseSourcesResponse, type SourcesQuery, type SourcesLeave } from "./merchantAttendanceSources";

const actor = id(1), query: SourcesQuery = { siteId: "99990009", workerId: id(4), fromDate: "2026-09-01", throughDate: "2026-09-07" };
const record = "2026-08-01T08:00:00.000001Z", read = "2026-09-30T12:00:00.000001Z";
const us = (at: string) => at.replace(/\.([0-9]{3})Z$/, ".$1000Z");
const group = (n = 501): GroupItem => ({ groupId: id(n), revision: 1, name: "Current group", description: "", active: true, createdAt: record, updatedAt: record });
function assignment(n = 601, groupNumber = 501, timeZone = "Europe/Madrid", startsOn = query.fromDate, endsOn: string | null = null): GroupAssignmentDetail {
  const item: GroupAssignmentItem = { assignmentId: id(n), groupId: id(groupNumber), groupName: "Historical group", workerId: query.workerId,
    workerName: "Historical name", workerNo: "OLD", employeeId: id(2), timeZone, startsOn, endsOn, createdAt: record, updatedAt: record, revision: 1, status: "assigned" };
  return { ...item, history: [{ item: { ...item }, command: { action: "assign", operationId: id(n), reason: "Fixture", groupId: id(groupNumber), workerId: query.workerId,
    expectedGroupRevision: 1, expectedWorkerVersion: 1, expectedSettingsVersion: 1, timeZone, startsOn, endsOn } }], canEnd: endsOn === null, canCancel: true };
}
const publication = (revision = 2, effectiveOn = "2026-09-02", groupId: string | null = null): RulesItem => ({ revision, operationId: id(700 + revision), actorId: id(99),
  action: "publish", reason: "Candidate only", recordedAt: record, settingsVersion: 1, groupRevision: groupId === null ? null : 1,
  timeZone: "Europe/Madrid", rules: emptyAttendanceRuleDraft(), effectiveOn, effectiveAt: attendanceDayUtcRange(effectiveOn, "Europe/Madrid").startAt, publishedRevision: null });
const schedule = (n = 801): ScheduleEntry => ({ id: id(n), workerId: query.workerId, workerName: "Historical name", locationId: id(5), locationName: "Original place", timeZone: "Europe/Madrid",
  workDate: "2026-08-31", startAt: "2026-08-31T21:00:00.000Z", endAt: "2026-08-31T23:00:00.000Z", revision: 1, cancelled: false, reason: "Fixture", cancelReason: null });
const leave = (n = 901): SourcesLeave => ({ workerId: query.workerId, employeeId: id(2), operationId: id(n + 1), recordedAt: "2026-08-02T08:00:00.000002Z",
  summary: { requestId: id(n), workerName: "Not a join key", startAt: "2026-07-01T00:00:00.000Z", endAt: "2026-09-08T00:00:00.000Z", timeZone: "Europe/Madrid", submittedAt: record, revision: 2, status: "approved" } });
const calendar = (n = 1001): CalendarSummary => ({ entryId: id(n), locationId: null, locationName: null, timeZone: "Europe/Madrid", kind: "holiday", title: "Hint only",
  fromDate: query.fromDate, throughDate: query.throughDate, createdAt: record, revision: 1, status: "created" });
function wire(q = query, timeZone = "Europe/Madrid") {
  const fromAt = attendanceDayUtcRange(q.fromDate, timeZone).startAt, toAt = attendanceDayUtcRange(q.throughDate, timeZone).endAt;
  const base = { ...firstApprovalSourceV2(sheetWire()), ...q, timeZone, fromAt: us(fromAt), toAt: us(toAt) };
  return { protocol: "sources-v1", siteId: q.siteId, actorId: actor, fromDate: q.fromDate, throughDate: q.throughDate,
    worker: { workerId: q.workerId, workerName: base.workerName, workerNo: base.workerNo, employeeId: base.employeeId, version: 3, active: true },
    settingsVersion: 3, timeZone, fromAt, toAt, readAt: read,
    attendance: { version: "attendance-unified-v1", access: "owner", base, missing: [] as unknown[], complete: true, payrollReady: false },
    assignments: { limited: false, items: [] as { detail: GroupAssignmentDetail; currentGroup: GroupItem }[] },
    rules: { limited: false, items: [{ groupId: null as string | null, revision: 0, publications: [] as RulesItem[] }] },
    schedule: { limited: false, items: [] as ScheduleEntry[] }, leave: { limited: false, items: [] as SourcesLeave[] }, calendar: { limited: false, items: [] as CalendarSummary[] } };
}
const parse = (value: unknown, q = query) => parseSourcesResult(value, q, actor);
function addAssignment(value: ReturnType<typeof wire>, detail = assignment(), currentGroup = group()) {
  value.assignments.items.push({ detail, currentGroup });
  if (!value.rules.items.some(item => item.groupId === detail.groupId)) value.rules.items.push({ groupId: detail.groupId, revision: 0, publications: [] });
}

test("sources queries allow one worker and at most seven inclusive dates, rejecting unknown and prototype keys", () => {
  assert.deepEqual(parseSourcesQuery(query), query);
  assert.deepEqual(parseSourcesHttpQuery(`https://fixture.invalid/?${sourcesQueryString(query)}`), query);
  for (const patch of [{ workerId: null }, { fromDate: "2026-02-30" }, { throughDate: "2026-09-08" }, { throughDate: "2026-08-31" },
    { fromDate: "1999-12-31" }, { throughDate: "2101-01-01" }, { access: "owner" }, { actorId: actor }]) assert.throws(() => parseSourcesQuery({ ...query, ...patch }), /attendance_invalid_request/);
  for (const suffix of ["&siteId=99990009", "&__proto__=x", "&constructor=x", "&locationId=" + id(5), "&workerIds=" + id(4)])
    assert.throws(() => parseSourcesHttpQuery(`https://fixture.invalid/?${sourcesQueryString(query)}${suffix}`), /attendance_invalid_request/);
  assert.throws(() => parseSourcesQuery(Object.assign(Object.create({ extra: true }), query)));
  const getter = { ...query }; Object.defineProperty(getter, "workerId", { get() { throw Error("getter ran"); } });
  assert.throws(() => parseSourcesQuery(getter), /attendance_invalid_request/);
});

test("wire and HTTP normalize once, preserve original calculation, and always disclaim rule application", () => {
  const raw = wire(), saved = structuredClone(raw), result = parse(raw);
  assert.deepEqual(raw, saved);
  assert.equal(result.attendance.totals.original.workedUs, 8 * 3600000000);
  assert.equal(result.attendance.totals.selected.workedUs, 8 * 3600000000);
  assert.deepEqual(result.warnings, ["candidate_rules_not_applied", "historical_context_not_pinned", "personal_exceptions_not_supported"]);
  assert.deepEqual(parseSourcesResponse({ ok: true, moduleEnabled: false, data: raw }, query, actor), { ...result, moduleEnabled: false });
  for (const response of [{ ok: true, moduleEnabled: 1, data: raw }, { ok: false, moduleEnabled: true, data: raw },
    { ok: true, moduleEnabled: true, data: raw, extra: true }, { ok: true, moduleEnabled: true, ...raw }]) assert.throws(() => parseSourcesResponse(response, query, actor));
});

test("top-level identities, authoritative zone/date bounds and read timestamp are bound", () => {
  for (const patch of [{ siteId: "99990001" }, { actorId: id(99) }, { fromDate: "2026-09-02" }, { throughDate: "2026-09-06" }, { timeZone: "UTC" },
    { settingsVersion: 0 }, { fromAt: "2026-09-01T00:00:00.000Z" }, { toAt: "2026-09-07T00:00:00.000Z" },
    { readAt: "2026-09-30T12:00:00.000Z" }, { readAt: "2026-09-30T11:59:59.999999Z" }]) assert.throws(() => parse({ ...wire(), ...patch }));
  for (const patch of [{ workerId: id(55) }, { employeeId: id(99) }, { workerName: "Another" }, { workerNo: "OTHER" }]) {
    const raw = wire(); Object.assign(raw.worker, patch); assert.throws(() => parse(raw));
  }
  assert.throws(() => parseSourcesResult(wire(), query, id(55)));
});

test("raw unified unknown keys never pass through the new wire envelope", () => {
  const mutations = [
    (r: ReturnType<typeof wire>) => Object.assign(r.attendance, { credential: "hidden" }),
    (r: ReturnType<typeof wire>) => Object.assign(r.attendance.base, { secret: "hidden" }),
    (r: ReturnType<typeof wire>) => Object.assign(r.attendance.base.items[0], { latitude: 1 }),
    (r: ReturnType<typeof wire>) => Object.assign(r.attendance.base.items[0].events[0], { actorEmployeeId: id(2) }),
  ];
  for (const mutate of mutations) { const raw = wire(); mutate(raw); assert.throws(() => parse(raw)); }
  const symbol = wire(); Object.defineProperty(symbol.worker, Symbol("secret"), { value: 1 }); assert.throws(() => parse(symbol));
  const sparse = wire(); delete sparse.attendance.base.items[0].events[0]; assert.throws(() => parse(sparse));
  const getter = wire(); Object.defineProperty(getter.worker, "workerName", { get() { throw Error("getter ran"); } }); assert.throws(() => parse(getter), /attendance_sources_invalid/);
});

test("approved corrections and whole-missing sources remain distinct with exact microseconds", () => {
  const raw = wire();
  const effect = { ...sheetEffect({ startAt: "2026-09-05T08:00:00.000000Z", endAt: "2026-09-05T16:00:00.000001Z", breaks: [] }), employeeId: id(2),
    lineage: { rootRequestId: id(30), rootOperationId: id(40), rootRecordedAt: "2026-09-25T20:00:00.000000Z", previousOperationId: null } };
  raw.attendance.base.items[0].effect = effect;
  raw.attendance.missing = [{ source: "missing-approved", requestId: id(500), operationId: id(501), workerId: query.workerId, employeeId: null,
    workerName: "Another historical label", locationId: id(7), locationName: "Other place", timeZone: "Europe/Madrid", policyRevision: 1,
    proposal: { startAt: "2026-09-06T08:00:00.000000Z", endAt: "2026-09-06T08:00:00.000001Z", breaks: [] }, submittedAt: "2026-09-07T08:00:00.000000Z", approvedAt: "2026-09-07T09:00:00.000000Z" }];
  const result = parse(raw);
  assert.equal(result.attendance.totals.original.workedUs, 8 * 3600000000);
  assert.equal(result.attendance.totals.recordedSelected.workedUs, 8 * 3600000000 + 1);
  assert.equal(result.attendance.totals.missingSelected.workedUs, 1);
  assert.equal(result.attendance.totals.selected.workedUs, 8 * 3600000000 + 2);
  assert.equal(result.attendance.base.rows[0].source, "approved"); assert.equal(result.attendance.missing[0].source, "missing-approved");
  effect.employeeId = id(99); assert.ok(parse(raw).warnings.includes("identity_changed"));
  Object.assign(effect.lineage, { untrusted: true }); assert.throws(() => parse(raw));
});

test("overnight schedule carry-in is included by UTC overlap, never only workDate", () => {
  const raw = wire(); raw.schedule.items = [schedule()];
  assert.equal(parse(raw).schedule.items[0].workDate, "2026-08-31");
  for (const patch of [{ workerId: id(99) }, { endAt: raw.fromAt }, { workDate: "2026-09-01" }, { endAt: "2026-09-02T21:00:00.000Z" },
    { startAt: "2026-08-31T21:00:00.001Z" }, { cancelled: true }, { cancelReason: "not cancelled" }]) {
    const bad = structuredClone(raw); Object.assign(bad.schedule.items[0], patch); assert.throws(() => parse(bad));
  }
  raw.schedule.items[0] = { ...schedule(), cancelled: true, cancelReason: "Cancelled plan" }; assert.equal(parse(raw).schedule.items[0].cancelled, true);
  raw.schedule.items.push(schedule()); assert.throws(() => parse(raw));
  const conflict = wire(); conflict.schedule.items = [schedule(), schedule(802)]; assert.throws(() => parse(conflict));
  conflict.schedule.items[0] = { ...schedule(), cancelled: true, cancelReason: "Historical plan" }; assert.equal(parse(conflict).schedule.items.length, 2);
});

test("leave includes long spanning approved, pending, rejected and cancelled intervals without name joins", () => {
  const raw = wire(); raw.leave.items = [leave()];
  assert.equal(parse(raw).leave.items[0].summary.workerName, "Not a join key");
  raw.leave.items[0].employeeId = id(99); assert.ok(parse(raw).warnings.includes("identity_changed"));
  raw.leave.items[0].workerId = id(99); assert.throws(() => parse(raw));
  for (const status of ["submitted", "withdrawn", "approved", "rejected", "cancelled"] as const) {
    const r = wire(), l = leave(); l.summary.status = status; l.summary.revision = status === "submitted" ? 1 : status === "cancelled" ? 3 : 2;
    if (status === "submitted") { l.operationId = l.summary.requestId; l.recordedAt = l.summary.submittedAt; }
    r.leave.items = [l]; assert.equal(parse(r).leave.items[0].summary.status, status);
  }
  for (const patch of [{ recordedAt: record }, { operationId: id(901) }, { recordedAt: "2026-10-01T00:00:00.000000Z" }]) {
    const r = wire(); r.leave.items = [{ ...leave(), ...patch }];
    if (patch.recordedAt === record) r.leave.items[0].summary.submittedAt = "2026-08-02T00:00:00.000000Z";
    assert.throws(() => parse(r));
  }
  const touch = wire(); touch.leave.items = [leave()]; touch.leave.items[0].summary.endAt = touch.fromAt; assert.throws(() => parse(touch));
});

test("assignment history and current group stay separate, employee changes warn and ended source history is retained", () => {
  const raw = wire(); addAssignment(raw);
  const result = parse(raw); assert.equal(result.assignments.items[0].detail.groupName, "Historical group"); assert.equal(result.assignments.items[0].currentGroup.name, "Current group");
  assert.equal(result.assignments.items[0].fromAt, raw.fromAt); assert.equal(result.assignments.items[0].toAt, null);
  const d = raw.assignments.items[0].detail; d.employeeId = id(99); d.history[0].item.employeeId = id(99); assert.ok(parse(raw).warnings.includes("identity_changed"));
  const ended = assignment(); const original = structuredClone(ended.history[0]);
  Object.assign(ended, { endsOn: "2026-09-02", updatedAt: "2026-09-20T00:00:00.000000Z", revision: 2, status: "ended", canEnd: false });
  const { history: ignoredHistory, canEnd: ignoredEnd, canCancel: ignoredCancel, ...endedItem } = ended; void ignoredHistory; void ignoredEnd; void ignoredCancel;
  ended.history = [original, { command: { action: "end", operationId: id(602), assignmentId: ended.assignmentId, expectedRevision: 1, endsOn: "2026-09-02", reason: "End" }, item: endedItem }];
  const q = { ...query, fromDate: "2026-09-05" }, laterWire = wire(q); addAssignment(laterWire, ended);
  assert.equal(parse(laterWire, q).assignments.items[0].toAt, "2026-09-02T22:00:00.000Z");
  assert.equal(parse(laterWire, q).assignments.items[0].inPeriod, false);
  assert.equal(parse(laterWire, q).assignments.items[0].originalInPeriod, true);
  const bad = wire(); addAssignment(bad); bad.assignments.items[0].currentGroup.groupId = id(599); assert.throws(() => parse(bad));
  const conflictingGroup = wire(); addAssignment(conflictingGroup); addAssignment(conflictingGroup, assignment(602), { ...group(), name: "Conflicting current projection" });
  assert.throws(() => parse(conflictingGroup));
});

test("frozen assignment zones detect actual UTC overlap rather than matching civil labels", () => {
  const raw = wire(); addAssignment(raw, assignment(601, 501, "Europe/Madrid", "2026-09-01", "2026-09-01"));
  addAssignment(raw, assignment(602, 502, "Pacific/Kiritimati", "2026-09-02", "2026-09-02"), group(502));
  assert.ok(parse(raw).warnings.includes("assignment_utc_overlap"));
  const adjacent = wire(); addAssignment(adjacent, assignment(601, 501, "Europe/Madrid", "2026-09-01", "2026-09-01"));
  addAssignment(adjacent, assignment(602, 502, "Europe/Madrid", "2026-09-02", "2026-09-02"), group(502));
  assert.ok(!parse(adjacent).warnings.includes("assignment_utc_overlap"));
  const conservative = wire(); addAssignment(conservative, assignment(601, 501, "Europe/Madrid", "2026-09-09", "2026-09-09"));
  assert.throws(() => parse(conservative));
});

test("rule publications bind selected streams, versions, immutable author and strict order but are not applied", () => {
  const raw = wire(); raw.rules.items[0] = { groupId: null, revision: 4, publications: [publication(2), publication(4, "2026-09-03")] };
  assert.equal(parse(raw).rules.items[0].publications[0].actorId, id(99));
  for (const mutate of [
    (r: ReturnType<typeof wire>) => r.rules.items[0].publications.reverse(),
    (r: ReturnType<typeof wire>) => { r.rules.items[0].publications[0].revision = 5; },
    (r: ReturnType<typeof wire>) => { r.rules.items[0].publications[0].settingsVersion = 4; },
    (r: ReturnType<typeof wire>) => { r.rules.items[0].publications[0].action = "save_draft"; },
    (r: ReturnType<typeof wire>) => { r.rules.items[0].groupId = id(501); },
    (r: ReturnType<typeof wire>) => { r.rules.items[0].publications = [publication(2, "2026-09-08")]; },
    (r: ReturnType<typeof wire>) => { r.rules.items[0].publications = [publication(2, "2026-08-30"), publication(4, "2026-09-01")]; },
  ]) { const bad = structuredClone(raw); mutate(bad); assert.throws(() => parse(bad)); }
  const absent = wire(); absent.rules.items = []; assert.throws(() => parse(absent));
  const groupWire = wire(); addAssignment(groupWire); groupWire.rules.items[1] = { groupId: id(501), revision: 2, publications: [publication(2, "2026-09-02", id(501))] };
  assert.equal(parse(groupWire).rules.items[1].publications.length, 1);
});

test("calendar scopes come from source locations, inclusive saved-zone dates are hints only", () => {
  const raw = wire(); raw.calendar.items = [calendar(), { ...calendar(1002), locationId: id(5), locationName: "Evidence place" }];
  assert.equal(parse(raw).calendar.items.length, 2);
  raw.calendar.items[1].locationId = id(99); assert.throws(() => parse(raw));
  raw.calendar.items[1].locationId = id(5); raw.calendar.items[1].status = "cancelled"; raw.calendar.items[1].revision = 2; assert.equal(parse(raw).calendar.items[1].status, "cancelled");
  const carry = wire(); carry.calendar.items = [{ ...calendar(), timeZone: "America/Los_Angeles", fromDate: "2026-08-31", throughDate: "2026-08-31" }];
  assert.equal(parse(carry).calendar.items.length, 1);
  carry.calendar.items[0].throughDate = "2026-08-30"; assert.throws(() => parse(carry));
});

test("limited sections are explicitly empty, propagate dependencies, and never become a complete empty read", () => {
  const raw = wire(); raw.schedule.limited = true; raw.calendar.limited = true; raw.leave.limited = true;
  assert.ok(parse(raw).warnings.includes("schedule_truncated")); assert.ok(parse(raw).warnings.includes("calendar_truncated")); assert.ok(parse(raw).warnings.includes("leave_truncated"));
  raw.schedule.items = [schedule()]; assert.throws(() => parse(raw));
  raw.schedule.items = []; raw.calendar.limited = false; assert.throws(() => parse(raw));
  const limitedAssignments = wire(); limitedAssignments.assignments.limited = true; limitedAssignments.rules = { limited: true, items: [] };
  assert.ok(parse(limitedAssignments).warnings.includes("assignments_truncated"));
  limitedAssignments.rules = wire().rules; assert.throws(() => parse(limitedAssignments));
});

test("section, publication, byte, duplicate and ordering bounds fail closed", () => {
  const oversized = wire(); oversized.schedule.items = Array.from({ length: 101 }, (_, n) => schedule(801 + n)); assert.throws(() => parse(oversized));
  const duplicate = wire(); duplicate.calendar.items = [calendar(), calendar()]; assert.throws(() => parse(duplicate));
  const reverse = wire(); reverse.calendar.items = [calendar(1002), calendar(1001)]; assert.throws(() => parse(reverse));
  const text = wire(); text.worker.workerName = "x".repeat(1048576); assert.throws(() => parse(text), /attendance_sources_too_large/);
  const tooMany = wire(); tooMany.rules.items[0].publications = Array(101).fill(publication()); assert.throws(() => parse(tooMany));
});

test("DST, skipped interior dates and 2100 inclusive end use day boundaries, not fixed 24-hour arithmetic", () => {
  for (const [fromDate, throughDate, zone, expectedHours] of [
    ["2026-10-25", "2026-10-25", "Europe/Madrid", 25], ["2026-03-29", "2026-03-29", "Europe/Madrid", 23],
    ["2011-12-29", "2011-12-31", "Pacific/Apia", 48], ["2100-12-31", "2100-12-31", "UTC", 24],
  ] as const) {
    const q = { ...query, fromDate, throughDate }, raw = wire(q, zone); raw.attendance.base.items = [];
    const year = fromDate.slice(0, 4); raw.readAt = `${year}-12-31T12:00:00.000001Z`; raw.attendance.base.asOf = `${year}-12-31T12:00:00.000000Z`;
    const result = parse(raw, q); assert.equal((Date.parse(result.toAt) - Date.parse(result.fromAt)) / 3600000, expectedHours);
    if (zone === "Pacific/Apia") assert.deepEqual(result.attendance.base.skippedDates, ["2011-12-30"]);
    if (year === "2100") assert.equal(result.toAt, "2101-01-01T00:00:00.000Z");
  }
});

test("an empty valid report remains distinct from unknown or truncated sources", () => {
  const raw = wire(); raw.attendance.base.items = [];
  const result = parse(raw); assert.equal(result.attendance.base.rows.length, 0); assert.equal(result.attendance.totals.selected.workedUs, 0);
  assert.ok(!result.warnings.some(w => w.endsWith("_truncated")));
  const hidden = { ...raw, warnings: ["all_clear"] }; assert.throws(() => parse(hidden));
});
