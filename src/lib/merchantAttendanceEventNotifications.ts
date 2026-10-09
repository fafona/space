import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { validateApplicationDelegationTree } from "./merchantAttendanceApplicationDelegation";

export const EVENT_NOTIFICATIONS_API = "/api/merchant-enterprise/attendance/event-notifications";
export const EVENT_NOTIFICATIONS_BYTE_LIMIT = 131072;
export const EVENT_NOTIFICATIONS_BODY_BYTE_LIMIT = 4096;
export type EventNotificationsQuery = { siteId: string; expectedEmployeeId: string; expectedWorkerId: string | null; notificationId: string | null; beforeAt: string | null; beforeId: string | null };
export type EventNotificationsCommand = { action: "mark_read"; notificationId: string };
type ItemBase = { notificationId: string; sourceOperationId: string; sourceId: string; occurredAt: string; readAt: string | null };
export type EventNotificationsItem = ItemBase & (
  { sourceCategory: "schedule"; sourceRevision: null; type: "published" | "cancelled" }
  | { sourceCategory: "work_arrangement"; sourceRevision: 2 | 3; type: "approved" | "rejected" | "approval_cancelled" }
  | { sourceCategory: "plan_exception"; sourceRevision: number; type: "confirmed" | "excused" | "follow_up" | "cleared" | "not_applicable" });
export type EventNotificationsSegment = { slotId: string; startAt: string; endAt: string; timeZone: string };
export type EventNotificationsDetail =
  | Extract<EventNotificationsItem, { sourceCategory: "schedule" }> & { summary: { segments: EventNotificationsSegment[] } }
  | Extract<EventNotificationsItem, { sourceCategory: "work_arrangement" }> & { summary: { kind: "trip" | "field" | "remote"; startAt: string; endAt: string; timeZone: string } }
  | Extract<EventNotificationsItem, { sourceCategory: "plan_exception" }> & { summary: EventNotificationsSegment & { outcome: "confirmed" | "excused" | "follow_up" | "cleared" | "not_applicable" } };
export type EventNotificationsResult = { protocol: "event-notifications-v1"; siteId: string; actorId: string; employeeId: string; workerId: string | null;
  items: EventNotificationsItem[]; nextCursor: { at: string; id: string } | null; detail: EventNotificationsDetail | null; canMarkRead: boolean };
export type EventNotificationsResponse = EventNotificationsResult;
export const EVENT_NOTIFICATIONS_ERRORS: Readonly<Record<string, number>> = Object.freeze({ attendance_event_notification_invalid: 503,
  attendance_event_notification_not_found: 404, attendance_event_notification_too_large: 422, attendance_worker_changed: 409,
  attendance_access_denied: 403, attendance_settings_required: 409, attendance_platform_paused: 403, attendance_invalid_request: 400,
  attendance_unavailable: 503, attendance_rate_limited: 429, attendance_not_available: 404, attendance_body_too_large: 413, attendance_invalid_content_type: 415 });
const fail = (code = "attendance_event_notification_invalid"): never => { throw new MerchantAttendanceError(code); };
const exact = captureBrowserExact;
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export function validateEventNotificationsTree(raw: unknown, limit = EVENT_NOTIFICATIONS_BYTE_LIMIT) { try { validateApplicationDelegationTree(raw, limit); } catch { fail(); } }
export const eventNotificationsUuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const id = eventNotificationsUuid;
const nullableId = (v: unknown) => v === null ? null : id(v);
function site(v: unknown): string { return typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : fail(); }
function stamp(v: unknown): string { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) || v.startsWith("0000")) return fail();
  const ms = v.slice(0, 23) + "Z", n = Date.parse(ms); if (!Number.isFinite(n) || new Date(n).toISOString() !== ms) fail(); return v; }
function zone(v: unknown): string { return typeof v === "string" && v === v.trim() && [...v].length >= 1 && [...v].length <= 100 && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail(); }
function interval(v: Record<string, unknown>) { const startAt = stamp(v.startAt), endAt = stamp(v.endAt); if (startAt >= endAt) fail(); return { startAt, endAt, timeZone: zone(v.timeZone) }; }
export function parseEventNotificationsJson(text: string, kind: "request" | "response" = "response"): unknown { try {
  const limit = kind === "request" ? EVENT_NOTIFICATIONS_BODY_BYTE_LIMIT : EVENT_NOTIFICATIONS_BYTE_LIMIT;
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > limit) fail(); const raw = parseCaptureBrowserJson(text); validateEventNotificationsTree(raw, limit); return raw;
} catch { return fail(kind === "request" ? "attendance_invalid_request" : undefined); } }
export function parseEventNotificationsQuery(raw: unknown): EventNotificationsQuery { try {
  validateEventNotificationsTree(raw, EVENT_NOTIFICATIONS_BODY_BYTE_LIMIT); const q = exact(raw, ["siteId", "expectedEmployeeId", "expectedWorkerId", "notificationId", "beforeAt", "beforeId"]);
  const value = { siteId: site(q.siteId), expectedEmployeeId: id(q.expectedEmployeeId), expectedWorkerId: nullableId(q.expectedWorkerId), notificationId: nullableId(q.notificationId), beforeAt: q.beforeAt === null ? null : stamp(q.beforeAt), beforeId: nullableId(q.beforeId) };
  if ((value.beforeAt === null) !== (value.beforeId === null) || value.beforeAt !== null && value.notificationId !== null
    || (value.beforeAt !== null || value.notificationId !== null) && value.expectedWorkerId === null) fail(); return freeze(value);
} catch { return fail("attendance_invalid_request"); } }
export function parseEventNotificationsHttpQuery(url: string) { try { const params = new URL(url).searchParams, q: Record<string, unknown> = { expectedWorkerId: null, notificationId: null, beforeAt: null, beforeId: null };
  for (const [k, v] of params) { if (params.getAll(k).length !== 1) fail(); q[k] = v; } return parseEventNotificationsQuery(q);
} catch { return fail("attendance_invalid_request"); } }
export function eventNotificationsQueryString(raw: EventNotificationsQuery) { const q = parseEventNotificationsQuery(raw), p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, v); return p.toString(); }
export function parseEventNotificationsCommand(raw: unknown): EventNotificationsCommand { try { validateEventNotificationsTree(raw, EVENT_NOTIFICATIONS_BODY_BYTE_LIMIT);
  const c = exact(raw, ["action", "notificationId"]); if (c.action !== "mark_read") fail(); return freeze({ action: "mark_read", notificationId: id(c.notificationId) });
} catch { return fail("attendance_invalid_request"); } }
export function parseEventNotificationsBody(raw: unknown) { try { validateEventNotificationsTree(raw, EVENT_NOTIFICATIONS_BODY_BYTE_LIMIT); const b = exact(raw, ["query", "command"]), query = parseEventNotificationsQuery(b.query), command = parseEventNotificationsCommand(b.command);
  if (query.notificationId !== command.notificationId || query.beforeAt !== null || query.expectedWorkerId === null) fail(); return freeze({ query, command });
} catch { return fail("attendance_invalid_request"); } }
const ITEM_KEYS = ["notificationId", "sourceCategory", "sourceOperationId", "sourceId", "sourceRevision", "type", "occurredAt", "readAt"];
export function parseEventNotificationsItem(raw: unknown): EventNotificationsItem { validateEventNotificationsTree(raw); const v = exact(raw, ITEM_KEYS);
  const base = { notificationId: id(v.notificationId), sourceOperationId: id(v.sourceOperationId), sourceId: id(v.sourceId), occurredAt: stamp(v.occurredAt), readAt: v.readAt === null ? null : stamp(v.readAt) };
  if (base.readAt !== null && base.readAt < base.occurredAt) fail();
  if (v.sourceCategory === "schedule") { if (v.sourceRevision !== null || v.type !== "published" && v.type !== "cancelled" || v.type === "published" && base.sourceId !== base.sourceOperationId) fail();
    return freeze({ ...base, sourceCategory: v.sourceCategory, sourceRevision: null, type: v.type as "published" | "cancelled" }); }
  if (v.sourceCategory === "work_arrangement") { if (typeof v.type !== "string" || !["approved", "rejected", "approval_cancelled"].includes(v.type) || v.sourceRevision !== (v.type === "approval_cancelled" ? 3 : 2)) fail();
    return freeze({ ...base, sourceCategory: v.sourceCategory, sourceRevision: v.sourceRevision as 2 | 3, type: v.type as "approved" | "rejected" | "approval_cancelled" }); }
  if (v.sourceCategory !== "plan_exception" || typeof v.type !== "string" || !["confirmed", "excused", "follow_up", "cleared", "not_applicable"].includes(v.type) || typeof v.sourceRevision !== "number" || !Number.isSafeInteger(v.sourceRevision) || v.sourceRevision < 1 || v.sourceRevision >= Number.MAX_SAFE_INTEGER - 1 || (v.type === "cleared" || v.type === "not_applicable") && (v.sourceRevision <= 1 || base.sourceOperationId === base.sourceId)) return fail();
  return freeze({ ...base, sourceCategory: v.sourceCategory, sourceRevision: v.sourceRevision, type: v.type as "confirmed" | "excused" | "follow_up" | "cleared" | "not_applicable" });
}
export function parseEventNotificationsDetail(raw: unknown): EventNotificationsDetail { validateEventNotificationsTree(raw); const v = exact(raw, [...ITEM_KEYS, "summary"]), item = parseEventNotificationsItem(Object.fromEntries(ITEM_KEYS.map(k => [k, v[k]])));
  if (item.sourceCategory === "schedule") { const s = exact(v.summary, ["segments"]); if (!Array.isArray(s.segments) || s.segments.length < 1 || s.segments.length > 32 || item.type === "cancelled" && s.segments.length !== 1) return fail();
    let previous: EventNotificationsSegment | null = null; const ids = new Set<string>(); const segments = s.segments.map(rawSegment => { const r = exact(rawSegment, ["slotId", "startAt", "endAt", "timeZone"]), segment = { slotId: id(r.slotId), ...interval(r) };
      if (ids.has(segment.slotId) || previous && (segment.startAt < previous.startAt || segment.startAt === previous.startAt && segment.slotId <= previous.slotId)) fail(); ids.add(segment.slotId); previous = segment; return segment; });
    if (item.type === "cancelled" && segments[0].slotId !== item.sourceId) fail(); return freeze({ ...item, summary: { segments } }); }
  if (item.sourceCategory === "work_arrangement") { const s = exact(v.summary, ["kind", "startAt", "endAt", "timeZone"]); if (typeof s.kind !== "string" || !["trip", "field", "remote"].includes(s.kind)) return fail(); return freeze({ ...item, summary: { kind: s.kind as "trip" | "field" | "remote", ...interval(s) } }); }
  const s = exact(v.summary, ["slotId", "startAt", "endAt", "timeZone", "outcome"]); if (s.outcome !== item.type) fail(); return freeze({ ...item, summary: { slotId: id(s.slotId), ...interval(s), outcome: item.type } });
}
const RESULT_KEYS = ["protocol", "siteId", "actorId", "employeeId", "workerId", "items", "nextCursor", "detail", "canMarkRead"];
export function parseEventNotificationsResult(raw: unknown, input: EventNotificationsQuery, expectedActorId?: string, command: EventNotificationsCommand | null = null): EventNotificationsResult { try {
  validateEventNotificationsTree(raw); const q = parseEventNotificationsQuery(input), v = exact(raw, RESULT_KEYS), actorId = id(v.actorId), employeeId = id(v.employeeId), workerId = nullableId(v.workerId);
  if (command) parseEventNotificationsBody({ query: q, command });
  if (v.protocol !== "event-notifications-v1" || v.siteId !== q.siteId || employeeId !== q.expectedEmployeeId || expectedActorId !== undefined && actorId !== expectedActorId
    || q.expectedWorkerId !== null && workerId !== q.expectedWorkerId || typeof v.canMarkRead !== "boolean" || !Array.isArray(v.items) || v.items.length > 25) fail();
  const rawItems = v.items as unknown[]; // Array shape and bounded length checked above.
  if (q.notificationId !== null && (rawItems.length !== 0 || v.nextCursor !== null) || workerId === null && (rawItems.length !== 0 || v.nextCursor !== null || v.detail !== null || v.canMarkRead)) fail();
  let previousAt = q.beforeAt, previousId = q.beforeId; const ids = new Set<string>();
  const items = rawItems.map(rawItem => { const item = parseEventNotificationsItem(rawItem); if (ids.has(item.notificationId) || previousAt !== null && (item.occurredAt > previousAt || item.occurredAt === previousAt && item.notificationId >= previousId!)) fail(); ids.add(item.notificationId); previousAt = item.occurredAt; previousId = item.notificationId; return item; });
  let nextCursor: EventNotificationsResult["nextCursor"] = null;
  if (v.nextCursor !== null) { const c = exact(v.nextCursor, ["at", "id"]); nextCursor = { at: stamp(c.at), id: id(c.id) }; if (items.length !== 25 || nextCursor.at !== previousAt || nextCursor.id !== previousId) fail(); }
  const detail = v.detail === null ? null : parseEventNotificationsDetail(v.detail);
  if (q.notificationId === null ? detail !== null : detail === null || detail.notificationId !== q.notificationId) fail(); if (command && detail?.readAt == null) fail();
  return freeze({ protocol: "event-notifications-v1", siteId: q.siteId, actorId, employeeId, workerId, items, nextCursor, detail, canMarkRead: v.canMarkRead as boolean });
} catch { return fail(); } }
export function parseEventNotificationsResponse(raw: unknown, query: EventNotificationsQuery, expectedActorId?: string, command: EventNotificationsCommand | null = null): EventNotificationsResponse { try {
  validateEventNotificationsTree(raw); const v = exact(raw, ["ok", ...RESULT_KEYS]); if (v.ok !== true) fail(); const { ok, ...rest } = v; void ok; return parseEventNotificationsResult(rest, query, expectedActorId, command);
} catch { return fail(); } }
