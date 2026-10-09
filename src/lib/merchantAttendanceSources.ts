// Current read-only evidence, not a frozen historical policy or an assessment.
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange, attendanceInstant, attendanceLocalDate, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { groupDate, parseGroupAssignmentDetail, parseGroupItem, parseGroupWorker, type GroupAssignmentDetail, type GroupItem, type GroupWorker } from "./merchantAttendanceGroups";
import { parseRulesItem, type RulesItem } from "./merchantAttendanceRules";
import { parseLeaveSummary, type LeaveSummary } from "./merchantAttendanceLeave";
import { parseCalendarSummary, type CalendarSummary } from "./merchantAttendanceCalendar";
import type { ScheduleEntry } from "./merchantAttendanceSchedule";
import { parseUnifiedSource, UNIFIED_REPORT_ERRORS, type UnifiedReport } from "./merchantAttendanceUnifiedTimesheet";

export type SourcesQuery = { siteId: string; workerId: string; fromDate: string; throughDate: string };
export type SourcesSection<T> = { limited: boolean; items: T[] };
export type SourcesAssignment = { detail: GroupAssignmentDetail; currentGroup: GroupItem; fromAt: string; toAt: string | null; inPeriod: boolean; originalInPeriod: boolean };
export type SourcesRules = { groupId: string | null; revision: number; publications: RulesItem[] };
export type SourcesLeave = { workerId: string; employeeId: string; summary: LeaveSummary; operationId: string; recordedAt: string };
export type SourcesResult = {
  protocol: "sources-v1"; siteId: string; actorId: string; fromDate: string; throughDate: string; worker: GroupWorker;
  settingsVersion: number; timeZone: string; fromAt: string; toAt: string; readAt: string; attendance: UnifiedReport;
  assignments: SourcesSection<SourcesAssignment>; rules: SourcesSection<SourcesRules>; schedule: SourcesSection<ScheduleEntry>;
  leave: SourcesSection<SourcesLeave>; calendar: SourcesSection<CalendarSummary>; warnings: string[];
};
export type SourcesResponse = SourcesResult & { moduleEnabled: boolean };
export const SOURCES_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  ...UNIFIED_REPORT_ERRORS, attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404,
  attendance_worker_not_found: 404, attendance_settings_required: 409, attendance_unavailable: 503, attendance_rate_limited: 429,
  attendance_sources_invalid: 503, attendance_sources_too_large: 422, attendance_group_invalid: 503,
  attendance_rule_invalid: 503, attendance_leave_invalid: 503, attendance_calendar_invalid: 503,
});
function fail(code = "attendance_sources_invalid"): never { throw new MerchantAttendanceError(code); }
const MAX = 9007199254740990;
const queryKeys = ["siteId", "workerId", "fromDate", "throughDate"];
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  if (proto !== null && proto !== Object.prototype || Reflect.ownKeys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key) || !("value" in descriptors[key]))) return fail();
  return value as Record<string, unknown>;
}
// Imported legacy parsers may ignore unknown fields. The wire boundary checks
// every raw shape too, and rejects getters, prototypes, symbols and sparse arrays.
function jsonTree(value: unknown) {
  let nodes = 0;
  const seen = new Set<object>();
  function visit(v: unknown, depth: number) {
    if (++nodes > 100000 || depth > 20) fail("attendance_sources_too_large");
    if (v === null || typeof v === "boolean" || typeof v === "string") return;
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || seen.has(v)) fail();
    seen.add(v);
    const proto = Object.getPrototypeOf(v), descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 4000 || keys.length !== v.length + 1) fail();
      for (let n = 0; n < v.length; n++) {
        const d = descriptors[String(n)]; if (!d || !("value" in d)) fail(); visit(d.value, depth + 1);
      }
    } else {
      if (proto !== null && proto !== Object.prototype) fail();
      for (const key of keys) {
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) fail();
        const d = descriptors[key]; if (!("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1);
      }
    }
    seen.delete(v);
  }
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 1048576) fail("attendance_sources_too_large");
}
const integer = (v: unknown, minimum = 1, maximum = MAX): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= minimum && v <= maximum ? v : fail();
const boolean = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const uuid = (v: unknown) => attendanceSelfUuid(v);
function zone(v: unknown): string { if (typeof v !== "string") return fail(); return attendanceTimeZone(v); }
function recordAt(v: unknown): string { const parsed = attendanceRecordInstant(v); return parsed === v ? parsed : fail(); }
function instant(v: unknown): string { if (typeof v !== "string") return fail(); attendanceInstant(v); return v; }
const micros = (v: string) => attendanceRecordInstant(v);
const beforeRead = (at: string, readAt: string) => { if (micros(at) > readAt) fail(); };
function label(v: unknown, max: number): string {
  return typeof v === "string" && !!v && v === v.trim() && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
}
function section<T>(raw: unknown, parse: (item: unknown) => T): SourcesSection<T> {
  const v = exact(raw, ["limited", "items"]), limited = boolean(v.limited);
  if (!Array.isArray(v.items) || v.items.length > 100 || limited && v.items.length !== 0) return fail();
  return { limited, items: v.items.map(parse) };
}
function ordered<T>(items: T[], key: (item: T) => string) {
  for (let n = 1; n < items.length; n++) if (key(items[n]) <= key(items[n - 1])) fail();
}
function unique<T>(items: T[], key: (item: T) => string) {
  if (new Set(items.map(key)).size !== items.length) fail();
}
const overlap = (start: string, end: string | null, from: string, to: string) => micros(start) < micros(to) && (end === null || micros(end) > micros(from));

export function parseSourcesQuery(raw: unknown): SourcesQuery {
  try {
    const q = exact(raw, queryKeys), fromDate = groupDate(q.fromDate), throughDate = groupDate(q.throughDate);
    const days = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 + 1;
    if (days < 1 || days > 7 || !Number.isInteger(days)) fail();
    return { siteId: attendanceSelfSite(q.siteId), workerId: uuid(q.workerId), fromDate, throughDate };
  } catch { return fail("attendance_invalid_request"); }
}
export function parseSourcesHttpQuery(url: string): SourcesQuery {
  try {
    const params = new URL(url).searchParams, raw = Object.create(null) as Record<string, string>;
    for (const [key, value] of params) {
      if (!queryKeys.includes(key) || params.getAll(key).length !== 1) fail(); raw[key] = value;
    }
    return parseSourcesQuery(raw);
  } catch { return fail("attendance_invalid_request"); }
}
export const sourcesQueryString = (query: SourcesQuery) => new URLSearchParams(parseSourcesQuery(query)).toString();

function rawAttendanceShape(raw: unknown, currentEmployeeId: string | null, locations: Set<string>, warnings: Set<string>) {
  const v = exact(raw, ["version", "access", "base", "missing", "complete", "payrollReady"]);
  const base = exact(v.base, ["siteId", "workerId", "employeeId", "workerName", "workerNo", "fromDate", "throughDate", "fromAt", "toAt", "timeZone", "asOf", "sourceVersion", "complete", "items"]);
  if (!Array.isArray(base.items) || base.items.length > 100 || !Array.isArray(v.missing) || v.missing.length > 100) fail();
  const proposalShape = (rawProposal: unknown) => {
    const p = exact(rawProposal, ["startAt", "endAt", "breaks"]);
    if (!Array.isArray(p.breaks) || p.breaks.length > 1000) fail();
    p.breaks.forEach(b => exact(b, ["startAt", "endAt", "paid"]));
  };
  for (const rawRow of base.items) {
    const row = exact(rawRow, ["startEventId", "events", "effect"]);
    if (!Array.isArray(row.events) || row.events.length > 2002) fail();
    for (const event of row.events) {
      const e = exact(event, ["id", "locationId", "sequence", "action", "occurredAt", "timeZone", "breakPaid", "source"]);
      locations.add(uuid(e.locationId));
    }
    if (row.effect !== null) {
      const e = exact(row.effect, ["requestId", "operationId", "revision", "policyRevision", "action", "originalLastEventId", "recordedAt", "employeeId", "timeZone", "proposal", "calculationVersion", "elapsedUs", "workedUs", "breakUs", "paidBreakUs", "lineage"]);
      const employeeId = e.employeeId === null ? null : uuid(e.employeeId);
      if (employeeId !== currentEmployeeId) warnings.add("identity_changed");
      proposalShape(e.proposal); exact(e.lineage, ["rootRequestId", "rootOperationId", "rootRecordedAt", "previousOperationId"]);
    }
  }
  for (const missing of v.missing) {
    const m = exact(missing, ["source", "requestId", "operationId", "workerId", "employeeId", "workerName", "locationId", "locationName", "timeZone", "policyRevision", "proposal", "submittedAt", "approvedAt"]);
    locations.add(uuid(m.locationId)); proposalShape(m.proposal);
  }
}
function scheduleEntry(raw: unknown, query: SourcesQuery, fromAt: string, toAt: string): ScheduleEntry {
  const v = exact(raw, ["id", "workerId", "workerName", "locationId", "locationName", "timeZone", "workDate", "startAt", "endAt", "revision", "cancelled", "reason", "cancelReason"]);
  const startAt = instant(v.startAt), endAt = instant(v.endAt), timeZone = zone(v.timeZone), workDate = groupDate(v.workDate), cancelled = boolean(v.cancelled);
  const start = attendanceInstant(startAt), end = attendanceInstant(endAt);
  if (v.workerId !== query.workerId || start % 60000 || end % 60000 || end <= start || end - start > 86400000
    || attendanceLocalDate(startAt, timeZone) !== workDate || !overlap(startAt, endAt, fromAt, toAt)
    || cancelled !== (v.cancelReason !== null)) fail();
  return { id: uuid(v.id), workerId: uuid(v.workerId), workerName: label(v.workerName, 120), locationId: uuid(v.locationId), locationName: label(v.locationName, 120),
    timeZone, workDate, startAt, endAt, revision: integer(v.revision, 1, MAX - 1), cancelled, reason: label(v.reason, 200), cancelReason: v.cancelReason === null ? null : label(v.cancelReason, 200) };
}

const resultKeys = ["protocol", "siteId", "actorId", "fromDate", "throughDate", "worker", "settingsVersion", "timeZone", "fromAt", "toAt", "readAt", "attendance", "assignments", "rules", "schedule", "leave", "calendar"];
export function parseSourcesResult(raw: unknown, input: SourcesQuery, expectedActorId: string): SourcesResult {
  const query = parseSourcesQuery(input);
  try {
    jsonTree(raw);
    const v = exact(raw, resultKeys), actorId = uuid(v.actorId), worker = parseGroupWorker(v.worker), settingsVersion = integer(v.settingsVersion);
    const timeZone = zone(v.timeZone), fromAt = instant(v.fromAt), toAt = instant(v.toAt), readAt = recordAt(v.readAt);
    if (v.protocol !== "sources-v1" || v.siteId !== query.siteId || actorId !== uuid(expectedActorId) || worker.workerId !== query.workerId
      || v.fromDate !== query.fromDate || v.throughDate !== query.throughDate
      || fromAt !== attendanceDayUtcRange(query.fromDate, timeZone).startAt || toAt !== attendanceDayUtcRange(query.throughDate, timeZone).endAt
      || fromAt >= toAt || readAt < "2000-01-01" || readAt >= "2101-01-01") fail();
    const warnings = new Set<string>(["candidate_rules_not_applied", "historical_context_not_pinned", "personal_exceptions_not_supported"]), locations = new Set<string>();
    rawAttendanceShape(v.attendance, worker.employeeId, locations, warnings);
    const attendance = parseUnifiedSource(v.attendance, { ...query, access: "owner" }), base = attendance.base;
    if (!("employeeId" in base) || base.employeeId !== worker.employeeId || base.workerName !== worker.workerName || base.workerNo !== worker.workerNo
      || base.timeZone !== timeZone || base.fromAt !== micros(fromAt) || base.toAt !== micros(toAt) || base.asOf > readAt) fail();
    const assignments = section(v.assignments, rawItem => {
      const a = exact(rawItem, ["detail", "currentGroup"]), detail = parseGroupAssignmentDetail(a.detail), currentGroup = parseGroupItem(a.currentGroup);
      if (detail.workerId !== worker.workerId || detail.groupId !== currentGroup.groupId) fail();
      beforeRead(detail.updatedAt, readAt); beforeRead(currentGroup.updatedAt, readAt);
      const original = detail.history[0].command;
      if (original.action !== "assign" || original.expectedGroupRevision > currentGroup.revision || original.expectedSettingsVersion > settingsVersion
        || original.expectedWorkerVersion > worker.version || currentGroup.createdAt > detail.createdAt) fail();
      const start = attendanceDayUtcRange(detail.startsOn, detail.timeZone).startAt;
      const end = detail.endsOn === null ? null : attendanceDayUtcRange(detail.endsOn, detail.timeZone).endAt;
      // Collection conservatively includes the original assignment interval:
      // a later end/cancel must remain visible, not masquerade as no history.
      const originalItem = detail.history[0].item;
      const originalEnd = originalItem.endsOn === null ? null : attendanceDayUtcRange(originalItem.endsOn, originalItem.timeZone).endAt;
      if (!overlap(start, originalEnd, fromAt, toAt)) fail();
      if (detail.employeeId !== worker.employeeId) warnings.add("identity_changed");
      return { detail, currentGroup, fromAt: start, toAt: end, inPeriod: detail.status !== "cancelled" && overlap(start, end, fromAt, toAt), originalInPeriod: overlap(start, originalEnd, fromAt, toAt) };
    });
    ordered(assignments.items, a => a.detail.assignmentId);
    const groups = new Map<string, GroupItem>();
    for (const a of assignments.items) {
      const prior = groups.get(a.currentGroup.groupId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(a.currentGroup)) fail();
      groups.set(a.currentGroup.groupId, a.currentGroup);
    }
    const liveAssignments = assignments.items.filter(a => a.inPeriod);
    for (let i = 0; i < liveAssignments.length; i++) for (let j = i + 1; j < liveAssignments.length; j++) {
      const a = liveAssignments[i], b = liveAssignments[j];
      if ((a.toAt === null || b.fromAt < a.toAt) && (b.toAt === null || a.fromAt < b.toAt)) warnings.add("assignment_utc_overlap");
    }
    let publicationsSeen = 0;
    const rules = section(v.rules, rawItem => {
      const r = exact(rawItem, ["groupId", "revision", "publications"]), groupId = r.groupId === null ? null : uuid(r.groupId), revision = integer(r.revision, 0);
      if (groupId !== null && !groups.has(groupId) || !Array.isArray(r.publications) || (publicationsSeen += r.publications.length) > 100) return fail();
      const publications = r.publications.map(rawPublication => {
        const p = parseRulesItem(rawPublication, groupId);
        if (p.action !== "publish" || p.revision > revision || p.settingsVersion! > settingsVersion || p.effectiveAt! >= toAt
          || groupId !== null && p.groupRevision! > groups.get(groupId)!.revision) fail();
        beforeRead(p.recordedAt, readAt); return p;
      });
      unique(publications, p => p.operationId);
      if (publications.filter(p => p.effectiveAt! <= fromAt).length > 1) fail();
      for (let n = 1; n < publications.length; n++) if (publications[n].revision <= publications[n - 1].revision || publications[n].effectiveAt! <= publications[n - 1].effectiveAt!) fail();
      return { groupId, revision, publications };
    });
    ordered(rules.items, r => r.groupId ?? "");
    unique(rules.items.flatMap(r => r.publications), p => p.operationId);
    if (!rules.limited && (rules.items.length !== groups.size + 1 || rules.items[0]?.groupId !== null)) fail();
    if (assignments.limited && !rules.limited) fail();
    const schedule = section(v.schedule, item => scheduleEntry(item, query, fromAt, toAt));
    ordered(schedule.items, s => `${s.startAt}|${s.id}`); unique(schedule.items, s => s.id);
    const liveSchedule = schedule.items.filter(s => !s.cancelled);
    for (let n = 1; n < liveSchedule.length; n++) if (liveSchedule[n].startAt < liveSchedule[n - 1].endAt) fail();
    schedule.items.forEach(s => locations.add(s.locationId));
    const leave = section(v.leave, rawItem => {
      const l = exact(rawItem, ["workerId", "employeeId", "summary", "operationId", "recordedAt"]), workerId = uuid(l.workerId), employeeId = uuid(l.employeeId);
      const summary = parseLeaveSummary(l.summary), operationId = uuid(l.operationId), recordedAt = recordAt(l.recordedAt);
      if (workerId !== worker.workerId || !overlap(summary.startAt, summary.endAt, fromAt, toAt) || recordedAt < summary.submittedAt
        || summary.revision === 1 && (operationId !== summary.requestId || recordedAt !== summary.submittedAt)
        || summary.revision !== 1 && operationId === summary.requestId) fail();
      beforeRead(recordedAt, readAt);
      if (employeeId !== worker.employeeId) warnings.add("identity_changed");
      return { workerId, employeeId, summary, operationId, recordedAt };
    });
    ordered(leave.items, l => `${l.summary.startAt}|${l.summary.requestId}`);
    unique(leave.items, l => l.summary.requestId); unique(leave.items, l => l.operationId);
    const calendar = section(v.calendar, rawItem => {
      const c = parseCalendarSummary(rawItem);
      if (c.locationId !== null && !locations.has(c.locationId)
        || !overlap(attendanceDayUtcRange(c.fromDate, c.timeZone).startAt, attendanceDayUtcRange(c.throughDate, c.timeZone).endAt, fromAt, toAt)) fail();
      beforeRead(c.createdAt, readAt); return c;
    });
    ordered(calendar.items, c => `${c.fromDate}|${c.entryId}`); unique(calendar.items, c => c.entryId);
    if ((schedule.limited || locations.size > 100) && !calendar.limited) fail();
    for (const [name, part] of Object.entries({ assignments, rules, schedule, leave, calendar })) if (part.limited) warnings.add(`${name}_truncated`);
    return { protocol: "sources-v1", siteId: query.siteId, actorId, fromDate: query.fromDate, throughDate: query.throughDate, worker, settingsVersion, timeZone,
      fromAt, toAt, readAt, attendance, assignments, rules, schedule, leave, calendar, warnings: [...warnings] };
  } catch (error) {
    if (error instanceof MerchantAttendanceError && (error.code === "attendance_sources_too_large" || Object.hasOwn(UNIFIED_REPORT_ERRORS, error.code) && error.code !== "attendance_invalid_request")) throw error;
    return fail();
  }
}
export function parseSourcesResponse(raw: unknown, query: SourcesQuery, actorId: string): SourcesResponse {
  const v = exact(raw, ["ok", "moduleEnabled", "data"]);
  if (v.ok !== true) fail();
  return { ...parseSourcesResult(v.data, query, actorId), moduleEnabled: boolean(v.moduleEnabled) };
}
