import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseLeaveSummary, type LeaveSummary } from "./merchantAttendanceLeave";

export type LeaveReviewQuery = { siteId: string; afterAt: string | null; afterId: string | null };
export type LeaveReviewItem = LeaveSummary & { status: "submitted"; revision: 1 };
export type LeaveReviewResult = { protocol: "leave-review-v1"; siteId: string; ownerId: string; items: LeaveReviewItem[];
  scanned: number; nextCursor: { at: string; id: string } | null };
export type LeaveReviewResponse = LeaveReviewResult & { moduleEnabled: boolean };
export const LEAVE_REVIEW_ERRORS: Readonly<Record<string, number>> = {
  attendance_leave_review_invalid: 503, attendance_leave_invalid: 503, attendance_invalid_request: 400,
  attendance_access_denied: 403, attendance_settings_required: 409, attendance_unavailable: 503,
  attendance_rate_limited: 429, attendance_not_available: 404,
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function exact(raw: unknown, keys: readonly string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail();
  return v;
}
function instant(raw: unknown) { try { const at = attendanceRecordInstant(raw); return raw === at ? at : fail(); } catch { return fail(); } }
const compare = (at: string, id: string, otherAt: string, otherId: string) => at === otherAt ? (id === otherId ? 0 : id < otherId ? -1 : 1) : at < otherAt ? -1 : 1;
export function parseLeaveReviewQuery(raw: unknown): LeaveReviewQuery {
  const q = exact(raw, ["siteId", "afterAt", "afterId"]);
  if ((q.afterAt === null) !== (q.afterId === null)) fail();
  return { siteId: attendanceSelfSite(q.siteId), afterAt: q.afterAt === null ? null : instant(q.afterAt), afterId: q.afterId === null ? null : attendanceSelfUuid(q.afterId) };
}
export function parseLeaveReviewHttpQuery(url: string) {
  const params = new URL(url).searchParams, q: Record<string, unknown> = { afterAt: null, afterId: null };
  for (const [key, value] of params) { if (params.getAll(key).length !== 1) fail(); q[key] = value; }
  return parseLeaveReviewQuery(q);
}
export const leaveReviewQueryString = (q: LeaveReviewQuery) => new URLSearchParams(Object.entries(parseLeaveReviewQuery(q)).filter((e): e is [string, string] => e[1] !== null)).toString();
const resultKeys = ["protocol", "siteId", "ownerId", "items", "scanned", "nextCursor"];
export function parseLeaveReviewResult(raw: unknown, input: LeaveReviewQuery, expectedOwnerId?: string): LeaveReviewResult {
  const q = parseLeaveReviewQuery(input), v = exact(raw, resultKeys), ownerId = attendanceSelfUuid(v.ownerId);
  if (v.protocol !== "leave-review-v1" || v.siteId !== q.siteId || expectedOwnerId !== undefined && ownerId !== expectedOwnerId
    || typeof v.scanned !== "number" || !Number.isInteger(v.scanned) || v.scanned < 0 || v.scanned > 50
    || !Array.isArray(v.items) || v.items.length > v.scanned) return fail();
  let priorAt = q.afterAt, priorId = q.afterId;
  const seen = new Set<string>();
  const items = v.items.map(rawItem => {
    const item = parseLeaveSummary(rawItem);
    if (item.status !== "submitted" || item.revision !== 1 || seen.has(item.requestId)
      || priorAt !== null && compare(item.submittedAt, item.requestId, priorAt, priorId!) <= 0) fail();
    seen.add(item.requestId); priorAt = item.submittedAt; priorId = item.requestId;
    return item as LeaveReviewItem;
  });
  let nextCursor: LeaveReviewResult["nextCursor"] = null;
  if (v.nextCursor !== null) {
    const c = exact(v.nextCursor, ["at", "id"]); nextCursor = { at: instant(c.at), id: attendanceSelfUuid(c.id) };
    if (v.scanned !== 50 || q.afterAt !== null && compare(nextCursor.at, nextCursor.id, q.afterAt, q.afterId!) <= 0
      || items.length > 0 && compare(nextCursor.at, nextCursor.id, priorAt!, priorId!) < 0
      || items.length === 50 && compare(nextCursor.at, nextCursor.id, priorAt!, priorId!) !== 0) fail();
  }
  return { protocol: "leave-review-v1", siteId: q.siteId, ownerId, items, scanned: v.scanned, nextCursor };
}
export function parseLeaveReviewResponse(raw: unknown, query: LeaveReviewQuery, expectedOwnerId?: string): LeaveReviewResponse {
  const v = exact(raw, [...resultKeys, "ok", "moduleEnabled"]);
  if (v.ok !== true || typeof v.moduleEnabled !== "boolean") return fail();
  const { ok, moduleEnabled, ...rest } = v; void ok;
  return { ...parseLeaveReviewResult(rest, query, expectedOwnerId), moduleEnabled };
}
