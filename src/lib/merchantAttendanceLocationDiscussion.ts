import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { parseAttendanceHistoryQuery } from "./merchantAttendanceHistory";
import { ATTENDANCE_REVIEW_REASONS, ATTENDANCE_LOCATION_REVIEW_ERRORS, type AttendanceReviewReason, type AttendanceReviewState } from "./merchantAttendanceLocationReview";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type DiscussionAccess = "self" | "owner";
type Base = { siteId: string; access: DiscussionAccess; expectedWorkerId: string | null };
export type DiscussionQuery = Base & ({ mode: "list"; fromAt: string; toAt: string; asOf: string | null; cursorAt: string | null; cursorId: string | null } |
  { mode: "detail"; eventId: string; operationId: string | null });
export type DiscussionCommand = { eventId: string; operationId: string; expectedRevision: number; note: string };
export type DiscussionEntry = { revision: number; author: DiscussionAccess; note: string; recordedAt: string };
export type DiscussionItem = { eventId: string; workerId: string; workerName: string; occurredAt: string; action: "clock_in" | "clock_out" | "break_start" | "break_end";
  reason: AttendanceReviewReason; reviewState: AttendanceReviewState; revision: number; lastAuthor: DiscussionAccess | null };
export type DiscussionResult = { siteId: string; access: DiscussionAccess; employeeId: string | null; workerId: string | null; canPost: boolean; asOf: string } & (
  { mode: "list"; items: DiscussionItem[]; scanned: number; nextCursor: { occurredAt: string; id: string } | null } |
  { mode: "detail"; item: DiscussionItem; history: DiscussionEntry[]; historyTruncated: boolean; receipt: (DiscussionEntry & { operationId: string }) | null });
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function obj(v: unknown, keys?: string[]) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  const o = v as Record<string, unknown>;
  if (keys && (Object.keys(o).length !== keys.length || keys.some(k => !Object.hasOwn(o, k)))) fail();
  return o;
}
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER - 1) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
const access = (v: unknown): DiscussionAccess => v === "self" || v === "owner" ? v : fail();
function note(v: unknown) { return typeof v === "string" && v.trim() && Array.from(v.trim()).length <= 500 && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : fail(); }
export const discussionQueryString = (q: DiscussionQuery) => new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => e[1] !== null)).toString();
export function parseDiscussionQuery(url: string): DiscussionQuery {
  const q = new URL(url).searchParams, a = access(q.get("access")), mode = q.get("mode");
  const keys = mode === "list" ? ["siteId", "access", "mode", "expectedWorkerId", "fromAt", "toAt", "asOf", "cursorAt", "cursorId"] : mode === "detail" ? ["siteId", "access", "mode", "expectedWorkerId", "eventId", "operationId"] : fail();
  for (const k of q.keys()) if (!keys.includes(k) || q.getAll(k).length !== 1) fail();
  const base = { siteId: attendanceSelfSite(q.get("siteId")), access: a, expectedWorkerId: q.has("expectedWorkerId") ? attendanceSelfUuid(q.get("expectedWorkerId")) : null };
  if (a === "owner" && base.expectedWorkerId || a === "self" && mode === "detail" && !base.expectedWorkerId) return fail();
  if (mode === "detail") return { ...base, mode, eventId: attendanceSelfUuid(q.get("eventId")), operationId: q.has("operationId") ? attendanceSelfUuid(q.get("operationId")) : null };
  const derived = new URLSearchParams(q); derived.delete("access"); derived.delete("mode");
  // Reuse exact microsecond/date bounds. Owner pagination has no employee pin.
  if (a === "owner" && q.has("cursorId")) derived.set("expectedWorkerId", "00000000-0000-4000-8000-000000000001");
  const validated = parseAttendanceHistoryQuery(`https://local.invalid/?${derived}`);
  return { ...validated, ...base, mode: "list" };
}
export function parseDiscussionCommand(input: unknown) {
  const v = obj(input, ["siteId", "access", "expectedWorkerId", "eventId", "operationId", "expectedRevision", "note"]);
  const a = access(v.access), expectedWorkerId = v.expectedWorkerId === null ? null : attendanceSelfUuid(v.expectedWorkerId);
  if ((a === "owner") !== (expectedWorkerId === null)) return fail();
  return { siteId: attendanceSelfSite(v.siteId), access: a, expectedWorkerId, command: { eventId: attendanceSelfUuid(v.eventId), operationId: attendanceSelfUuid(v.operationId),
    expectedRevision: integer(v.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 2), note: note(v.note) } };
}
export function parseDiscussionResult(input: unknown, q: DiscussionQuery): DiscussionResult {
  const v = obj(input), asOf = attendanceRecordInstant(v.asOf);
  if (v.siteId !== q.siteId || v.access !== q.access || v.mode !== q.mode || typeof v.canPost !== "boolean") return fail();
  const employeeId = q.access === "self" ? attendanceSelfUuid(v.employeeId) : null, workerId = q.access === "self" ? attendanceSelfUuid(v.workerId) : null;
  if (q.access === "owner" && (v.employeeId !== null || v.workerId !== null || !v.canPost) || q.expectedWorkerId && workerId !== q.expectedWorkerId) return fail();
  const base = { siteId: q.siteId, access: q.access, employeeId, workerId, canPost: v.canPost, asOf };
  function item(raw: unknown): DiscussionItem {
    const x = obj(raw), occurredAt = attendanceRecordInstant(x.occurredAt), revision = integer(x.revision), lastAuthor = x.lastAuthor === null ? null : access(x.lastAuthor);
    if (occurredAt > asOf || (revision === 0) !== (lastAuthor === null) || typeof x.workerName !== "string" || !x.workerName.trim() || x.workerName.length > 500
      || typeof x.action !== "string" || !["clock_in", "clock_out", "break_start", "break_end"].includes(x.action)
      || !ATTENDANCE_REVIEW_REASONS.includes(x.reason as AttendanceReviewReason) || typeof x.reviewState !== "string" || !["pending", "reviewed", "follow_up"].includes(x.reviewState)) return fail();
    const w = attendanceSelfUuid(x.workerId); if (workerId && w !== workerId) return fail();
    return { eventId: attendanceSelfUuid(x.eventId), workerId: w, workerName: x.workerName, occurredAt, action: x.action as DiscussionItem["action"], reason: x.reason as AttendanceReviewReason, reviewState: x.reviewState as AttendanceReviewState, revision, lastAuthor };
  }
  const before = (a: { occurredAt: string; id: string }, b: { occurredAt: string; id: string }) => a.occurredAt < b.occurredAt || a.occurredAt === b.occurredAt && a.id < b.id;
  if (q.mode === "list") {
    const scanned = integer(v.scanned, 0, 50); if (!Array.isArray(v.items) || v.items.length > scanned || q.asOf && asOf !== q.asOf) return fail();
    let previous = q.cursorId ? { occurredAt: q.cursorAt!, id: q.cursorId } : null;
    const items = Array.from(v.items as unknown[], raw => { const r = item(raw), key = { occurredAt: r.occurredAt, id: r.eventId };
      if (r.occurredAt < q.fromAt || r.occurredAt >= q.toAt || r.occurredAt >= asOf || previous && !before(key, previous)) return fail(); previous = key; return r; });
    if (new Set(items.map(x => x.eventId)).size !== items.length) return fail();
    let nextCursor = null;
    if (v.nextCursor !== null) {
      const c = obj(v.nextCursor); nextCursor = { occurredAt: attendanceRecordInstant(c.occurredAt), id: attendanceSelfUuid(c.id) };
      if (scanned !== 50 || nextCursor.occurredAt < q.fromAt || nextCursor.occurredAt >= q.toAt || nextCursor.occurredAt >= asOf
        || q.cursorId && !before(nextCursor, { occurredAt: q.cursorAt!, id: q.cursorId }) || previous && before(previous, nextCursor)) return fail();
    }
    return { ...base, mode: "list", items, scanned, nextCursor };
  }
  const current = item(v.item); if (current.eventId !== q.eventId || !Array.isArray(v.history) || v.history.length !== Math.min(current.revision, 20) || v.historyTruncated !== (current.revision > 20)) return fail();
  function entry(raw: unknown): DiscussionEntry {
    const x = obj(raw), recordedAt = attendanceRecordInstant(x.recordedAt);
    if (recordedAt > asOf || recordedAt < current.occurredAt) return fail();
    return { revision: integer(x.revision, 1), author: access(x.author), note: note(x.note), recordedAt };
  }
  const history = Array.from(v.history as unknown[], entry);
  if (history.some((h, i) => h.revision !== current.revision - i || i > 0 && h.recordedAt > history[i - 1].recordedAt) || (history[0]?.author ?? null) !== current.lastAuthor) return fail();
  let receipt = null;
  if (v.receipt !== null) {
    const r = obj(v.receipt), h = entry(r); if (r.operationId !== q.operationId || h.author !== q.access || h.revision > current.revision) return fail();
    const same = history.find(x => x.revision === h.revision); if (same && JSON.stringify(same) !== JSON.stringify(h)) return fail();
    receipt = { ...h, operationId: attendanceSelfUuid(r.operationId) };
  }
  return { ...base, mode: "detail", item: current, history, historyTruncated: current.revision > 20, receipt };
}
export const DISCUSSION_ERRORS: Readonly<Record<string, number>> = { ...ATTENDANCE_LOCATION_REVIEW_ERRORS, attendance_settings_required: 409, attendance_worker_changed: 409 };
