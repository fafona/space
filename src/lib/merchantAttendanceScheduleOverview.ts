import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceInstant, attendanceLocalDate, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { scheduleDate } from "./merchantAttendanceSchedule";

export type ScheduleOverviewCursor = { workDate: string; startAt: string; slotId: string };
export type ScheduleOverviewQuery = { siteId: string; workerIds: string[]; fromDate: string; throughDate: string; revision: number | null;
  cursorDate: string | null; cursorStart: string | null; cursorId: string | null };
export type ScheduleOverviewItem = { id: string; workerId: string; workerName: string; locationId: string; locationName: string; timeZone: string;
  workDate: string; startAt: string; endAt: string; revision: number; cancelled: boolean; cancelRevision: number | null };
export type ScheduleOverviewResult = { protocol: "schedule-overview-v1"; readOnly: true; siteId: string; ownerId: string; workerIds: string[];
  fromDate: string; throughDate: string; revision: number; items: ScheduleOverviewItem[]; scanned: number; nextCursor: ScheduleOverviewCursor | null };
export const SCHEDULE_OVERVIEW_ERRORS: Readonly<Record<string, number>> = { attendance_invalid_request: 400, attendance_invalid_instant: 400,
  attendance_access_denied: 403, attendance_settings_required: 409, attendance_schedule_overview_invalid: 503,
  attendance_rate_limited: 429, attendance_not_available: 404, attendance_unavailable: 503 };
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const exact = (raw: unknown, keys: string[]) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
  return value;
};
const integer = (raw: unknown, min = 0, max = 9007199254740989) => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= min && raw <= max ? raw : fail();
const instant = (raw: unknown) => { if (typeof raw !== "string" || attendanceInstant(raw) % 60000) return fail(); return raw; };
const label = (raw: unknown) => typeof raw === "string" && !!raw && raw === raw.trim() && [...raw].length <= 120 && !/[\u0000-\u001f\u007f-\u009f]/.test(raw) ? raw : fail();
function workers(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) return fail();
  const result = raw.map(attendanceSelfUuid);
  if (result.some((id, i) => i > 0 && id <= result[i - 1])) fail();
  return result;
}
export function compareScheduleOverviewCursor(a: ScheduleOverviewCursor, b: ScheduleOverviewCursor) {
  for (const key of ["workDate", "startAt", "slotId"] as const) { if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1; }
  return 0;
}
const itemCursor = (item: ScheduleOverviewItem): ScheduleOverviewCursor => ({ workDate: item.workDate, startAt: item.startAt, slotId: item.id });
function cursor(raw: unknown): ScheduleOverviewCursor {
  const c = exact(raw, ["workDate", "startAt", "slotId"]);
  return { workDate: scheduleDate(c.workDate), startAt: instant(c.startAt), slotId: attendanceSelfUuid(c.slotId) };
}
export function parseScheduleOverviewQuery(raw: unknown): ScheduleOverviewQuery {
  const q = exact(raw, ["siteId", "workerIds", "fromDate", "throughDate", "revision", "cursorDate", "cursorStart", "cursorId"]);
  const fromDate = scheduleDate(q.fromDate), throughDate = scheduleDate(q.throughDate);
  if (throughDate < fromDate || (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 > 30) fail();
  const revision = q.revision === null ? null : integer(q.revision);
  const c = q.cursorDate === null && q.cursorStart === null && q.cursorId === null ? null : cursor({ workDate: q.cursorDate, startAt: q.cursorStart, slotId: q.cursorId });
  if (c && (revision === null || c.workDate < fromDate || c.workDate > throughDate)) fail();
  return { siteId: attendanceSelfSite(q.siteId), workerIds: workers(q.workerIds), fromDate, throughDate, revision,
    cursorDate: c?.workDate ?? null, cursorStart: c?.startAt ?? null, cursorId: c?.slotId ?? null };
}
export function parseScheduleOverviewHttpQuery(url: string) {
  const params = new URL(url).searchParams, q: Record<string, unknown> = { revision: null, cursorDate: null, cursorStart: null, cursorId: null };
  for (const [key, value] of params) {
    if (params.getAll(key).length !== 1) fail();
    if (key === "revision") { if (!/^(0|[1-9]\d{0,15})$/.test(value)) fail(); q[key] = Number(value); }
    else q[key] = key === "workerIds" ? value.split(",") : value;
  }
  return parseScheduleOverviewQuery(q);
}
export function scheduleOverviewQueryString(input: ScheduleOverviewQuery) {
  const q = parseScheduleOverviewQuery(input);
  return new URLSearchParams(Object.entries(q).filter(([, value]) => value !== null).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : String(value)])).toString();
}
export function parseScheduleOverviewResult(raw: unknown, input: ScheduleOverviewQuery): ScheduleOverviewResult {
  const q = parseScheduleOverviewQuery(input), v = exact(raw, ["protocol", "readOnly", "siteId", "ownerId", "workerIds", "fromDate", "throughDate", "revision", "items", "scanned", "nextCursor"]);
  const revision = integer(v.revision), scanned = integer(v.scanned, 0, 50), workerIds = workers(v.workerIds);
  if (v.protocol !== "schedule-overview-v1" || v.readOnly !== true || v.siteId !== q.siteId || v.fromDate !== q.fromDate || v.throughDate !== q.throughDate
    || JSON.stringify(workerIds) !== JSON.stringify(q.workerIds) || q.revision !== null && revision !== q.revision || !Array.isArray(v.items) || v.items.length > scanned) fail();
  let previous: ScheduleOverviewCursor | null = q.cursorDate ? { workDate: q.cursorDate, startAt: q.cursorStart!, slotId: q.cursorId! } : null;
  const seen = new Set<string>();
  const items = (v.items as unknown[]).map(rawItem => {
    const item = exact(rawItem, ["id", "workerId", "workerName", "locationId", "locationName", "timeZone", "workDate", "startAt", "endAt", "revision", "cancelled", "cancelRevision"]);
    const timeZone = attendanceTimeZone(item.timeZone as string), workDate = scheduleDate(item.workDate), startAt = instant(item.startAt), endAt = instant(item.endAt);
    const publishRevision = integer(item.revision, 1), cancelRevision = item.cancelRevision === null ? null : integer(item.cancelRevision, 1);
    const value: ScheduleOverviewItem = { id: attendanceSelfUuid(item.id), workerId: attendanceSelfUuid(item.workerId), workerName: label(item.workerName),
      locationId: attendanceSelfUuid(item.locationId), locationName: label(item.locationName), timeZone, workDate, startAt, endAt,
      revision: publishRevision, cancelled: item.cancelled as boolean, cancelRevision };
    const next = itemCursor(value), duration = Date.parse(endAt) - Date.parse(startAt);
    if (!workerIds.includes(value.workerId) || seen.has(value.id) || workDate < q.fromDate || workDate > q.throughDate || attendanceLocalDate(startAt, timeZone) !== workDate
      || duration <= 0 || duration > 86400000 || publishRevision > revision || typeof item.cancelled !== "boolean"
      || value.cancelled !== (cancelRevision !== null) || cancelRevision !== null && (cancelRevision <= publishRevision || cancelRevision > revision)
      || previous && compareScheduleOverviewCursor(next, previous) <= 0) fail();
    seen.add(value.id); previous = next; return value;
  });
  const nextCursor = v.nextCursor === null ? null : cursor(v.nextCursor);
  if (nextCursor && (scanned !== 50 || nextCursor.workDate < q.fromDate || nextCursor.workDate > q.throughDate
    || previous && compareScheduleOverviewCursor(nextCursor, previous) < (items.length ? 0 : 1))) fail();
  return { protocol: "schedule-overview-v1", readOnly: true, siteId: q.siteId, ownerId: attendanceSelfUuid(v.ownerId), workerIds,
    fromDate: q.fromDate, throughDate: q.throughDate, revision, items, scanned, nextCursor };
}
export function parseScheduleOverviewResponse(raw: unknown, q: ScheduleOverviewQuery) {
  const v = exact(raw, ["ok", "moduleEnabled", "protocol", "readOnly", "siteId", "ownerId", "workerIds", "fromDate", "throughDate", "revision", "items", "scanned", "nextCursor"]);
  if (v.ok !== true || typeof v.moduleEnabled !== "boolean") fail();
  const { ok, moduleEnabled, ...result } = v; void ok;
  return { ...parseScheduleOverviewResult(result, q), moduleEnabled: moduleEnabled as boolean };
}
