import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { leaveInterval } from "./merchantAttendanceLeave";

export type NotificationQuery = { siteId: string; expectedEmployeeId: string; expectedWorkerId: string | null; notificationId: string | null; beforeAt: string | null; beforeId: string | null };
export type NotificationCommand = { action: "mark_read"; notificationId: string };
export type NotificationItem = { notificationId: string; requestId: string; revision: 2 | 3; type: "approved" | "rejected" | "approval_cancelled";
  decidedAt: string; startAt: string; endAt: string; timeZone: string; readAt: string | null };
export type NotificationDetail = NotificationItem & { currentStatus: "approved" | "rejected" | "cancelled"; currentRevision: 2 | 3 };
export type NotificationsResult = { protocol: "leave-notifications-v1"; siteId: string; actorId: string; employeeId: string; workerId: string | null;
  items: NotificationItem[]; nextCursor: { at: string; id: string } | null; detail: NotificationDetail | null };
export type NotificationsResponse = NotificationsResult & { moduleEnabled: boolean };
export const NOTIFICATION_ERRORS: Readonly<Record<string, number>> = {
  attendance_notification_not_found: 404, attendance_notification_invalid: 503, attendance_worker_changed: 409,
  attendance_access_denied: 403, attendance_settings_required: 409, attendance_platform_paused: 403,
  attendance_invalid_request: 400, attendance_unavailable: 503, attendance_rate_limited: 429, attendance_not_available: 404,
  attendance_body_too_large: 413, attendance_invalid_content_type: 415,
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function exact(raw: unknown, keys: readonly string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) fail();
  return value;
}
const recordTime = (raw: unknown) => { try { const at = attendanceRecordInstant(raw); return at === raw ? at : fail(); } catch { return fail(); } };
export function parseNotificationQuery(raw: unknown): NotificationQuery {
  const q = exact(raw, ["siteId", "expectedEmployeeId", "expectedWorkerId", "notificationId", "beforeAt", "beforeId"]);
  if ((q.beforeAt === null) !== (q.beforeId === null) || q.beforeAt !== null && q.notificationId !== null
    || (q.beforeAt !== null || q.notificationId !== null) && q.expectedWorkerId === null) return fail();
  return { siteId: attendanceSelfSite(q.siteId), expectedEmployeeId: attendanceSelfUuid(q.expectedEmployeeId),
    expectedWorkerId: q.expectedWorkerId === null ? null : attendanceSelfUuid(q.expectedWorkerId), notificationId: q.notificationId === null ? null : attendanceSelfUuid(q.notificationId),
    beforeAt: q.beforeAt === null ? null : recordTime(q.beforeAt), beforeId: q.beforeId === null ? null : attendanceSelfUuid(q.beforeId) };
}
export function parseNotificationHttpQuery(url: string) {
  const params = new URL(url).searchParams, q: Record<string, unknown> = { expectedWorkerId: null, notificationId: null, beforeAt: null, beforeId: null };
  for (const [key, value] of params) { if (params.getAll(key).length !== 1) fail(); q[key] = value; }
  return parseNotificationQuery(q);
}
export const notificationQueryString = (q: NotificationQuery) => new URLSearchParams(Object.entries(parseNotificationQuery(q)).filter((e): e is [string, string] => e[1] !== null)).toString();
export function parseNotificationCommand(raw: unknown): NotificationCommand {
  const c = exact(raw, ["action", "notificationId"]); if (c.action !== "mark_read") return fail();
  return { action: "mark_read", notificationId: attendanceSelfUuid(c.notificationId) };
}
export function parseNotificationBody(raw: unknown) {
  const body = exact(raw, ["query", "command"]), query = parseNotificationQuery(body.query), command = parseNotificationCommand(body.command);
  if (query.notificationId !== command.notificationId || query.beforeAt !== null || query.beforeId !== null || query.expectedWorkerId === null) fail();
  return { query, command };
}
const itemKeys = ["notificationId", "requestId", "revision", "type", "decidedAt", "startAt", "endAt", "timeZone", "readAt"];
export function parseNotificationItem(raw: unknown): NotificationItem {
  const v = exact(raw, itemKeys), decidedAt = recordTime(v.decidedAt), readAt = v.readAt === null ? null : recordTime(v.readAt);
  if (v.type !== "approved" && v.type !== "rejected" && v.type !== "approval_cancelled" || v.revision !== (v.type === "approval_cancelled" ? 3 : 2)
    || readAt !== null && readAt < decidedAt) return fail();
  return { notificationId: attendanceSelfUuid(v.notificationId), requestId: attendanceSelfUuid(v.requestId), revision: v.revision as 2 | 3,
    type: v.type, decidedAt, ...leaveInterval(v.startAt, v.endAt, v.timeZone), readAt };
}
export function parseNotificationDetail(raw: unknown): NotificationDetail {
  const v = exact(raw, [...itemKeys, "currentStatus", "currentRevision"]), item = parseNotificationItem(Object.fromEntries(itemKeys.map(k => [k, v[k]])));
  if (!(item.type === "approved" ? v.currentStatus === "approved" && v.currentRevision === 2 || v.currentStatus === "cancelled" && v.currentRevision === 3
    : item.type === "rejected" ? v.currentStatus === "rejected" && v.currentRevision === 2 : v.currentStatus === "cancelled" && v.currentRevision === 3)) return fail();
  return { ...item, currentStatus: v.currentStatus as NotificationDetail["currentStatus"], currentRevision: v.currentRevision as 2 | 3 };
}
const resultKeys = ["protocol", "siteId", "actorId", "employeeId", "workerId", "items", "nextCursor", "detail"];
export function parseNotificationResult(raw: unknown, input: NotificationQuery, command: NotificationCommand | null = null, expectedActorId?: string): NotificationsResult {
  const q = parseNotificationQuery(input), v = exact(raw, resultKeys);
  if (command) parseNotificationBody({ query: q, command });
  const actorId = attendanceSelfUuid(v.actorId), employeeId = attendanceSelfUuid(v.employeeId), workerId = v.workerId === null ? null : attendanceSelfUuid(v.workerId);
  if (v.protocol !== "leave-notifications-v1" || v.siteId !== q.siteId || employeeId !== q.expectedEmployeeId
    || expectedActorId !== undefined && actorId !== expectedActorId || q.expectedWorkerId !== null && workerId !== q.expectedWorkerId
    || !Array.isArray(v.items) || v.items.length > 25) return fail();
  if (q.notificationId !== null && (v.items.length !== 0 || v.nextCursor !== null) || workerId === null && (v.items.length !== 0 || v.nextCursor !== null || v.detail !== null)) fail();
  let previousAt = q.beforeAt, previousId = q.beforeId;
  const ids = new Set<string>();
  const items = v.items.map(rawItem => {
    const item = parseNotificationItem(rawItem);
    if (ids.has(item.notificationId) || previousAt !== null && (item.decidedAt > previousAt || item.decidedAt === previousAt && item.notificationId >= previousId!)) fail();
    ids.add(item.notificationId); previousAt = item.decidedAt; previousId = item.notificationId; return item;
  });
  let nextCursor: NotificationsResult["nextCursor"] = null;
  if (v.nextCursor !== null) {
    const c = exact(v.nextCursor, ["at", "id"]); nextCursor = { at: recordTime(c.at), id: attendanceSelfUuid(c.id) };
    if (items.length !== 25 || nextCursor.at !== previousAt || nextCursor.id !== previousId) fail();
  }
  const detail = v.detail === null ? null : parseNotificationDetail(v.detail);
  if (q.notificationId === null ? detail !== null : detail === null || detail.notificationId !== q.notificationId) fail();
  if (command && detail?.readAt == null) fail();
  return { protocol: "leave-notifications-v1", siteId: q.siteId, actorId, employeeId, workerId, items, nextCursor, detail };
}
export function parseNotificationResponse(raw: unknown, q: NotificationQuery, command: NotificationCommand | null = null, expectedActorId?: string): NotificationsResponse {
  const v = exact(raw, ["ok", "moduleEnabled", ...resultKeys]);
  if (v.ok !== true || typeof v.moduleEnabled !== "boolean") return fail();
  const { ok, moduleEnabled, ...rest } = v; void ok;
  return { ...parseNotificationResult(rest, q, command, expectedActorId), moduleEnabled };
}
