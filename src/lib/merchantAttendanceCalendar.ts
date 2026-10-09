import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceInstant, attendanceTimeZone, attendanceDayUtcRange, MerchantAttendanceError } from "./merchantAttendanceTime";

export type CalendarKind = "holiday" | "closure";
export type CalendarQuery = { siteId: string; locationId: string | null; fromDate: string | null; throughDate: string | null; entryId: string | null; operationId: string | null; beforeAt: string | null; beforeId: string | null };
export type CalendarCommand = { operationId: string; reason: string } & (
  { action: "create"; kind: CalendarKind; title: string; fromDate: string; throughDate: string; expectedSettingsVersion: number; locationId: string | null; expectedLocationVersion: number | null; timeZone: string } |
  { action: "cancel"; entryId: string; expectedRevision: 1 });
export type CalendarSummary = { entryId: string; locationId: string | null; locationName: string | null; timeZone: string; kind: CalendarKind; title: string; fromDate: string; throughDate: string; createdAt: string; revision: 1 | 2; status: "created" | "cancelled" };
export type CalendarDetail = CalendarSummary & { reason: string; cancelReason: string | null; cancelledAt: string | null; canCancel: boolean };
export type CalendarResult = { protocol: "calendar-v1"; siteId: string; actorId: string; settingsVersion: number; locationId: string | null; locationName: string | null; locationVersion: number | null;
  timeZone: string; canCreate: boolean; items: CalendarSummary[]; nextCursor: { at: string; id: string } | null; detail: CalendarDetail | null; receipt: { command: CalendarCommand; item: CalendarSummary } | null };
export type CalendarResponse = CalendarResult & { moduleEnabled: boolean };
export const CALENDAR_ERRORS: Readonly<Record<string, number>> = {
  attendance_calendar_not_found: 404, attendance_calendar_closed: 409, attendance_calendar_location_inactive: 409, attendance_calendar_invalid: 503,
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_settings_required: 409, attendance_platform_paused: 403,
  attendance_version_conflict: 409, attendance_operation_conflict: 409, attendance_unavailable: 503, attendance_rate_limited: 429,
  attendance_not_available: 404, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function exact(raw: unknown, keys: readonly string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail();
  return v;
}
const positive = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 9007199254740990 ? v : fail();
const bool = (v: unknown) => typeof v === "boolean" ? v : fail();
const uuidOrNull = (v: unknown) => v === null ? null : attendanceSelfUuid(v);
const time = (v: unknown) => { try { const t = attendanceRecordInstant(v); return t === v ? t : fail(); } catch { return fail(); } };
const zone = (v: unknown) => { try { return typeof v === "string" ? attendanceTimeZone(v) : fail(); } catch { return fail(); } };
function label(v: unknown, max: number): string {
  if (typeof v !== "string" || !v || v !== v.trim() || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return fail();
  return v;
}
export const calendarReason = (v: unknown) => label(v, 200);
function date(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31") return fail();
  try { attendanceInstant(v + "T00:00:00.000Z"); } catch { return fail(); } return v;
}
export function calendarDateRange(fromDate: unknown, throughDate: unknown) {
  const from = date(fromDate), through = date(throughDate), days = (Date.parse(through) - Date.parse(from)) / 86400000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > 366) fail();
  return { fromDate: from, throughDate: through, days };
}
export function calendarEntryRange(fromDate: unknown, throughDate: unknown, timeZone: unknown) {
  const range = calendarDateRange(fromDate, throughDate), validZone = zone(timeZone);
  try { attendanceDayUtcRange(range.fromDate, validZone); attendanceDayUtcRange(range.throughDate, validZone); } catch { return fail(); }
  return { ...range, timeZone: validZone };
}
export function parseCalendarQuery(raw: unknown): CalendarQuery {
  const q = exact(raw, ["siteId", "locationId", "fromDate", "throughDate", "entryId", "operationId", "beforeAt", "beforeId"]);
  if ((q.fromDate === null) !== (q.throughDate === null) || (q.beforeAt === null) !== (q.beforeId === null)
    || q.fromDate !== null && (q.entryId !== null || q.operationId !== null) || q.beforeAt !== null && q.fromDate === null) fail();
  const range = q.fromDate === null ? null : calendarDateRange(q.fromDate, q.throughDate);
  return { siteId: attendanceSelfSite(q.siteId), locationId: uuidOrNull(q.locationId), fromDate: range?.fromDate ?? null, throughDate: range?.throughDate ?? null,
    entryId: uuidOrNull(q.entryId), operationId: uuidOrNull(q.operationId), beforeAt: q.beforeAt === null ? null : time(q.beforeAt), beforeId: uuidOrNull(q.beforeId) };
}
export function parseCalendarHttpQuery(url: string) {
  const params = new URL(url).searchParams, q: Record<string, unknown> = { locationId: null, fromDate: null, throughDate: null, entryId: null, operationId: null, beforeAt: null, beforeId: null };
  for (const [key, value] of params) { if (params.getAll(key).length !== 1) fail(); q[key] = value; }
  return parseCalendarQuery(q);
}
export const calendarQueryString = (q: CalendarQuery) => new URLSearchParams(Object.entries(parseCalendarQuery(q)).filter((e): e is [string, string] => e[1] !== null)).toString();
export function parseCalendarCommand(raw: unknown): CalendarCommand {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const create = (raw as Record<string, unknown>).action === "create";
  const c = exact(raw, create ? ["operationId", "action", "reason", "kind", "title", "fromDate", "throughDate", "expectedSettingsVersion", "locationId", "expectedLocationVersion", "timeZone"]
    : ["operationId", "action", "reason", "entryId", "expectedRevision"]);
  const base = { operationId: attendanceSelfUuid(c.operationId), reason: calendarReason(c.reason) };
  if (create) {
    const locationId = uuidOrNull(c.locationId);
    if ((locationId === null) !== (c.expectedLocationVersion === null) || c.kind !== "holiday" && c.kind !== "closure") return fail();
    const range = calendarEntryRange(c.fromDate, c.throughDate, c.timeZone);
    return { ...base, action: "create", kind: c.kind, title: label(c.title, 80), fromDate: range.fromDate, throughDate: range.throughDate, timeZone: range.timeZone,
      expectedSettingsVersion: positive(c.expectedSettingsVersion), locationId, expectedLocationVersion: c.expectedLocationVersion === null ? null : positive(c.expectedLocationVersion) };
  }
  if (c.action !== "cancel" || c.expectedRevision !== 1) return fail();
  return { ...base, action: "cancel", entryId: attendanceSelfUuid(c.entryId), expectedRevision: 1 };
}
export function parseCalendarBody(raw: unknown) {
  const v = exact(raw, ["query", "command"]), query = parseCalendarQuery(v.query), command = parseCalendarCommand(v.command);
  if (query.operationId !== null || query.fromDate !== null || query.beforeAt !== null
    || query.entryId !== (command.action === "create" ? null : command.entryId) || command.action === "create" && command.locationId !== query.locationId) fail();
  return { query, command };
}
const summaryKeys = ["entryId", "locationId", "locationName", "timeZone", "kind", "title", "fromDate", "throughDate", "createdAt", "revision", "status"];
export function parseCalendarSummary(raw: unknown): CalendarSummary {
  const v = exact(raw, summaryKeys), locationId = uuidOrNull(v.locationId), range = calendarEntryRange(v.fromDate, v.throughDate, v.timeZone);
  if ((locationId === null) !== (v.locationName === null) || v.kind !== "holiday" && v.kind !== "closure"
    || v.status !== "created" && v.status !== "cancelled" || v.revision !== (v.status === "created" ? 1 : 2)) return fail();
  return { entryId: attendanceSelfUuid(v.entryId), locationId, locationName: v.locationName === null ? null : label(v.locationName, 120), timeZone: range.timeZone,
    kind: v.kind, title: label(v.title, 80), fromDate: range.fromDate, throughDate: range.throughDate, createdAt: time(v.createdAt), revision: v.revision as 1 | 2, status: v.status };
}
export function parseCalendarDetail(raw: unknown): CalendarDetail {
  const v = exact(raw, [...summaryKeys, "reason", "cancelReason", "cancelledAt", "canCancel"]);
  const summary = parseCalendarSummary(Object.fromEntries(summaryKeys.map(k => [k, v[k]])));
  const cancelReason = v.cancelReason === null ? null : calendarReason(v.cancelReason), cancelledAt = v.cancelledAt === null ? null : time(v.cancelledAt), canCancel = bool(v.canCancel);
  if (summary.status === "created" ? cancelReason !== null || cancelledAt !== null : cancelReason === null || cancelledAt === null || canCancel) fail();
  if (cancelledAt && cancelledAt < summary.createdAt) fail();
  return { ...summary, reason: calendarReason(v.reason), cancelReason, cancelledAt, canCancel };
}
export function sameCalendarCommand(a: CalendarCommand, b: CalendarCommand) { return JSON.stringify(parseCalendarCommand(a)) === JSON.stringify(parseCalendarCommand(b)); }
const resultKeys = ["protocol", "siteId", "actorId", "settingsVersion", "locationId", "locationName", "locationVersion", "timeZone", "canCreate", "items", "nextCursor", "detail", "receipt"];
export function parseCalendarResult(raw: unknown, input: CalendarQuery, command: CalendarCommand | null = null, expectedActorId?: string): CalendarResult {
  const q = parseCalendarQuery(input), v = exact(raw, resultKeys), actorId = attendanceSelfUuid(v.actorId);
  if (command) parseCalendarBody({ query: q, command });
  if (v.protocol !== "calendar-v1" || v.siteId !== q.siteId || v.locationId !== q.locationId || expectedActorId !== undefined && actorId !== expectedActorId
    || !Array.isArray(v.items) || v.items.length > 25 || (q.fromDate === null || command) && (v.items.length || v.nextCursor !== null)) return fail();
  const locationName = v.locationName === null ? null : label(v.locationName, 120), locationVersion = v.locationVersion === null ? null : positive(v.locationVersion), canCreate = bool(v.canCreate);
  if (q.locationId === null ? locationName !== null || locationVersion !== null || !canCreate : locationName === null || locationVersion === null) fail();
  let previousAt = q.beforeAt, previousId = q.beforeId;
  const ids = new Set<string>();
  const items = v.items.map(rawItem => {
    const item = parseCalendarSummary(rawItem);
    if (item.locationId !== q.locationId || ids.has(item.entryId) || q.fromDate === null || item.throughDate < q.fromDate || item.fromDate > q.throughDate!
      || previousAt && (item.createdAt > previousAt || item.createdAt === previousAt && item.entryId >= previousId!)) fail();
    ids.add(item.entryId); previousAt = item.createdAt; previousId = item.entryId; return item;
  });
  let nextCursor: CalendarResult["nextCursor"] = null;
  if (v.nextCursor !== null) {
    const c = exact(v.nextCursor, ["at", "id"]); nextCursor = { at: time(c.at), id: attendanceSelfUuid(c.id) };
    if (items.length !== 25 || nextCursor.at !== previousAt || nextCursor.id !== previousId) fail();
  }
  const detail = v.detail === null ? null : parseCalendarDetail(v.detail);
  if (detail && (detail.locationId !== q.locationId || q.entryId !== null && detail.entryId !== q.entryId) || q.entryId && !detail) fail();
  let receipt: CalendarResult["receipt"] = null;
  if (v.receipt !== null) {
    const r = exact(v.receipt, ["command", "item"]), c = parseCalendarCommand(r.command), item = parseCalendarSummary(r.item);
    if (c.operationId !== (command?.operationId ?? q.operationId) || item.locationId !== q.locationId
      || item.entryId !== (c.action === "create" ? c.operationId : c.entryId) || item.revision !== (c.action === "create" ? 1 : 2)
      || command && !sameCalendarCommand(c, command)) fail();
    if (c.action === "create" && (c.locationId !== item.locationId || c.timeZone !== item.timeZone || c.title !== item.title
      || c.kind !== item.kind || c.fromDate !== item.fromDate || c.throughDate !== item.throughDate)) fail();
    if (!detail || detail.entryId !== item.entryId || detail.revision < item.revision
      || summaryKeys.filter(k => k !== "revision" && k !== "status").some(k => detail[k as keyof CalendarSummary] !== item[k as keyof CalendarSummary])
      || c.reason !== (c.action === "create" ? detail.reason : detail.cancelReason)) fail();
    receipt = { command: c, item };
  }
  if (command && !receipt || detail && !q.entryId && !receipt && !command) fail();
  return { protocol: "calendar-v1", siteId: q.siteId, actorId, settingsVersion: positive(v.settingsVersion), locationId: q.locationId,
    locationName, locationVersion, timeZone: zone(v.timeZone), canCreate, items, nextCursor, detail, receipt };
}
export function parseCalendarResponse(raw: unknown, q: CalendarQuery, command: CalendarCommand | null = null, expectedActorId?: string): CalendarResponse {
  const v = exact(raw, ["ok", "moduleEnabled", ...resultKeys]);
  if (v.ok !== true || typeof v.moduleEnabled !== "boolean") return fail();
  const { ok, moduleEnabled, ...rest } = v; void ok;
  return { ...parseCalendarResult(rest, q, command, expectedActorId), moduleEnabled };
}

