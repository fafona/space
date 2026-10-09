import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { validateApplicationDelegationTree } from "./merchantAttendanceApplicationDelegation";

export const OWNER_NOTIFICATIONS_API = "/api/merchant-enterprise/attendance/owner-notifications";
export const OWNER_NOTIFICATIONS_BYTE_LIMIT = 131072;
export const OWNER_NOTIFICATIONS_BODY_BYTE_LIMIT = 4096;
export type OwnerNotificationsQuery = { siteId: string; mode: "list" | "detail" | "recover"; notificationId: string | null; operationId: string | null; beforeAt: string | null; beforeId: string | null };
export type OwnerNotificationsCommand = { action: "mark_read"; operationId: string; notificationId: string };
type ItemBase = { notificationId: string; sourceOperationId: string; sourceId: string; sourceRevision: number; workerId: string; employeeId: string; employeeAuthUserId: string; occurredAt: string; readAt: string | null };
export type OwnerNotificationsItem = ItemBase & (
  { sourceCategory: "plan_exception"; target: { slotId: string } }
  | { sourceCategory: "period"; target: { periodId: string; fromDate: string; throughDate: string } });
export type OwnerNotificationsReceipt = { operationId: string; notificationId: string; actorId: string; readAt: string };
type ResultBase = { protocol: "owner-attendance-notifications-v1"; siteId: string; actorId: string };
export type OwnerNotificationsResult = ResultBase & (
  { kind: "list"; items: OwnerNotificationsItem[]; nextCursor: { at: string; id: string } | null }
  | { kind: "detail"; item: OwnerNotificationsItem; canMarkRead: boolean }
  | { kind: "receipt"; receipt: OwnerNotificationsReceipt | null });
export const OWNER_NOTIFICATIONS_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_owner_notification_invalid: 503, attendance_owner_notification_not_found: 404, attendance_owner_notification_disabled: 403,
  attendance_owner_notification_too_large: 422, attendance_operation_conflict: 409, attendance_access_denied: 403,
  attendance_settings_required: 409, attendance_platform_paused: 403, attendance_invalid_request: 400,
  attendance_unavailable: 503, attendance_rate_limited: 429, attendance_not_available: 404, attendance_body_too_large: 413,
  attendance_invalid_content_type: 415,
});
const fail = (code = "attendance_owner_notification_invalid"): never => { throw new MerchantAttendanceError(code); };
const exact = captureBrowserExact;
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export const ownerNotificationsUuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const id = ownerNotificationsUuid, nullableId = (v: unknown) => v === null ? null : id(v);
const site = (v: unknown): string => typeof v === "string" && /^[0-9]{8}$/.test(v) && v.length === 8 ? v : fail();
function stamp(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) || v.startsWith("0000")) return fail();
  const short = v.slice(0, 23) + "Z", n = Date.parse(short); if (!Number.isFinite(n) || new Date(n).toISOString() !== short) fail(); return v;
}
function date(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith("0000")) return fail();
  const n = Date.parse(v + "T00:00:00Z"); if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== v) fail(); return v;
}
export function validateOwnerNotificationsTree(raw: unknown, limit = OWNER_NOTIFICATIONS_BYTE_LIMIT) { try { validateApplicationDelegationTree(raw, limit); } catch { fail(); } }
export function parseOwnerNotificationsJson(text: string, kind: "request" | "response" = "response"): unknown {
  try { const limit = kind === "request" ? OWNER_NOTIFICATIONS_BODY_BYTE_LIMIT : OWNER_NOTIFICATIONS_BYTE_LIMIT;
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > limit) fail();
    const raw = parseCaptureBrowserJson(text); validateOwnerNotificationsTree(raw, limit); return raw;
  } catch { return fail(kind === "request" ? "attendance_invalid_request" : undefined); }
}
export function parseOwnerNotificationsQuery(raw: unknown): OwnerNotificationsQuery {
  try { validateOwnerNotificationsTree(raw, OWNER_NOTIFICATIONS_BODY_BYTE_LIMIT);
    const q = exact(raw, ["siteId", "mode", "notificationId", "operationId", "beforeAt", "beforeId"]);
    if (q.mode !== "list" && q.mode !== "detail" && q.mode !== "recover") return fail();
    const result: OwnerNotificationsQuery = { siteId: site(q.siteId), mode: q.mode, notificationId: nullableId(q.notificationId), operationId: nullableId(q.operationId),
      beforeAt: q.beforeAt === null ? null : stamp(q.beforeAt), beforeId: nullableId(q.beforeId) };
    if ((result.beforeAt === null) !== (result.beforeId === null)
      || result.mode === "list" && (result.notificationId !== null || result.operationId !== null)
      || result.mode !== "list" && (result.notificationId === null || result.beforeAt !== null)
      || (result.mode === "recover") !== (result.operationId !== null)) fail();
    return freeze(result);
  } catch { return fail("attendance_invalid_request"); }
}
export function parseOwnerNotificationsCommand(raw: unknown): OwnerNotificationsCommand {
  try { validateOwnerNotificationsTree(raw, OWNER_NOTIFICATIONS_BODY_BYTE_LIMIT); const c = exact(raw, ["action", "operationId", "notificationId"]);
    if (c.action !== "mark_read") return fail(); return freeze({ action: c.action, operationId: id(c.operationId), notificationId: id(c.notificationId) });
  } catch { return fail("attendance_invalid_request"); }
}
export function parseOwnerNotificationsBody(raw: unknown) {
  try { validateOwnerNotificationsTree(raw, OWNER_NOTIFICATIONS_BODY_BYTE_LIMIT); const b = exact(raw, ["query", "command"]);
    const query = parseOwnerNotificationsQuery(b.query), command = parseOwnerNotificationsCommand(b.command);
    if (query.mode !== "detail" || query.notificationId !== command.notificationId) fail(); return freeze({ query, command });
  } catch { return fail("attendance_invalid_request"); }
}
export function parseOwnerNotificationsHttpQuery(url: string): OwnerNotificationsQuery {
  try { const params = new URL(url).searchParams, keys = ["siteId", "mode", "notificationId", "operationId", "beforeAt", "beforeId"];
    if (params.size > 6 || [...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length !== 1)) fail();
    return parseOwnerNotificationsQuery(Object.fromEntries(keys.map(key => [key, params.get(key)])));
  } catch { return fail("attendance_invalid_request"); }
}
export function ownerNotificationsQueryString(raw: OwnerNotificationsQuery) {
  const q = parseOwnerNotificationsQuery(raw), params = new URLSearchParams(); for (const [key, value] of Object.entries(q)) if (value !== null) params.set(key, value); return params.toString();
}
export function parseOwnerNotificationsItem(raw: unknown): OwnerNotificationsItem {
  const v = exact(raw, ["notificationId", "sourceCategory", "sourceOperationId", "sourceId", "sourceRevision", "workerId", "employeeId", "employeeAuthUserId", "occurredAt", "readAt", "target"]);
  const base: ItemBase = { notificationId: id(v.notificationId), sourceOperationId: id(v.sourceOperationId), sourceId: id(v.sourceId), sourceRevision: Number(v.sourceRevision),
    workerId: id(v.workerId), employeeId: id(v.employeeId), employeeAuthUserId: id(v.employeeAuthUserId), occurredAt: stamp(v.occurredAt), readAt: v.readAt === null ? null : stamp(v.readAt) };
  if (typeof v.sourceRevision !== "number" || !Number.isSafeInteger(v.sourceRevision) || v.sourceRevision < 1 || base.readAt !== null && base.readAt < base.occurredAt) fail();
  if (v.sourceCategory === "plan_exception") { const target = exact(v.target, ["slotId"]); return freeze({ ...base, sourceCategory: "plan_exception", target: { slotId: id(target.slotId) } }); }
  if (v.sourceCategory === "period") { const t = exact(v.target, ["periodId", "fromDate", "throughDate"]), target = { periodId: id(t.periodId), fromDate: date(t.fromDate), throughDate: date(t.throughDate) };
    if (target.periodId !== base.sourceId || target.fromDate > target.throughDate || Date.parse(target.throughDate) - Date.parse(target.fromDate) > 30 * 86400000) fail();
    return freeze({ ...base, sourceCategory: "period", target }); }
  return fail();
}
export function ownerNotificationsReceiptMatches(receipt: OwnerNotificationsReceipt, command: OwnerNotificationsCommand, actorId: string) {
  return receipt.operationId === command.operationId && receipt.notificationId === command.notificationId && receipt.actorId === actorId;
}
export function parseOwnerNotificationsResult(raw: unknown, input: OwnerNotificationsQuery, actorId: string, command: OwnerNotificationsCommand | null = null): OwnerNotificationsResult {
  try { validateOwnerNotificationsTree(raw); const q = parseOwnerNotificationsQuery(input); id(actorId);
    if (command) parseOwnerNotificationsBody({ query: q, command });
    const kind = command || q.mode === "recover" ? "receipt" : q.mode;
    const keys = kind === "list" ? ["items", "nextCursor"] : kind === "detail" ? ["item", "canMarkRead"] : ["receipt"];
    const v = exact(raw, ["protocol", "siteId", "actorId", "kind", ...keys]);
    if (v.protocol !== "owner-attendance-notifications-v1" || v.siteId !== q.siteId || v.actorId !== actorId || v.kind !== kind) fail();
    const base: ResultBase = { protocol: "owner-attendance-notifications-v1", siteId: q.siteId, actorId };
    if (kind === "receipt") { let receipt: OwnerNotificationsReceipt | null = null;
      if (v.receipt !== null) { const r = exact(v.receipt, ["operationId", "notificationId", "actorId", "readAt"]);
        receipt = { operationId: id(r.operationId), notificationId: id(r.notificationId), actorId: id(r.actorId), readAt: stamp(r.readAt) };
        if (receipt.actorId !== actorId || receipt.notificationId !== q.notificationId || receipt.operationId !== (command?.operationId ?? q.operationId)) fail(); }
      if (command && receipt === null) fail(); return freeze({ ...base, kind, receipt }); }
    if (kind === "detail") { const item = parseOwnerNotificationsItem(v.item);
      if (item.notificationId !== q.notificationId || typeof v.canMarkRead !== "boolean") fail(); return freeze({ ...base, kind, item, canMarkRead: v.canMarkRead as boolean }); }
    if (!Array.isArray(v.items) || v.items.length > 25) return fail();
    let previousAt = q.beforeAt, previousId = q.beforeId; const seen = new Set<string>();
    const items = v.items.map(rawItem => { const item = parseOwnerNotificationsItem(rawItem);
      if (seen.has(item.notificationId) || previousAt !== null && (item.occurredAt > previousAt || item.occurredAt === previousAt && item.notificationId >= previousId!)) fail();
      seen.add(item.notificationId); previousAt = item.occurredAt; previousId = item.notificationId; return item; });
    let nextCursor: { at: string; id: string } | null = null;
    if (v.nextCursor !== null) { const c = exact(v.nextCursor, ["at", "id"]); nextCursor = { at: stamp(c.at), id: id(c.id) };
      if (items.length !== 25 || nextCursor.at !== previousAt || nextCursor.id !== previousId) fail(); }
    return freeze({ ...base, kind: "list", items, nextCursor });
  } catch { return fail(); }
}
export function parseOwnerNotificationsResponse(raw: unknown, q: OwnerNotificationsQuery, actorId: string, command: OwnerNotificationsCommand | null = null) {
  try { validateOwnerNotificationsTree(raw); if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail();
    const { ok, ...value } = raw as Record<string, unknown>; if (ok !== true) fail(); return parseOwnerNotificationsResult(value, q, actorId, command);
  } catch { return fail(); }
}
