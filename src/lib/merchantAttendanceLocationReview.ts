import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceInstant, MerchantAttendanceError } from "./merchantAttendanceTime";
import { attendanceRecordInstant, parseAttendanceRecordPage, parseAttendanceRecordsQuery, type AttendanceRecord } from "./merchantAttendanceManagement";
import { ATTENDANCE_POSITION_FAILURES } from "./merchantAttendanceLocationClock";

export const ATTENDANCE_REVIEW_REASONS = ["outside", "uncertain", "stale", "future", ...ATTENDANCE_POSITION_FAILURES] as const;
export type AttendanceReviewReason = typeof ATTENDANCE_REVIEW_REASONS[number];
export type AttendanceReviewOutcome = "noted" | "follow_up" | "reopen";
export type AttendanceReviewState = "pending" | "reviewed" | "follow_up";
export type AttendanceLocationReviewQuery = { siteId: string } & (
  { mode: "list"; fromAt: string; toAt: string; workerId: string | null; locationId: string | null; status: "all" | AttendanceReviewState; asOf: string | null; cursorAt: string | null; cursorId: string | null } |
  { mode: "detail"; eventId: string; operationId: string | null });
export type AttendanceLocationReviewCommand = { eventId: string; operationId: string; expectedRevision: number; outcome: AttendanceReviewOutcome; note: string };
export type AttendanceLocationReviewItem = AttendanceRecord & { reason: AttendanceReviewReason; reviewState: AttendanceReviewState; reviewRevision: number };
export type AttendanceReviewEntry = { revision: number; outcome: AttendanceReviewOutcome; note: string; recordedAt: string; actorRef: string; byCurrentOwner: boolean };
export type AttendanceLocationReviewResult = { siteId: string; asOf: string } & (
  { mode: "list"; items: AttendanceLocationReviewItem[]; scanned: number; nextCursor: { occurredAt: string; id: string } | null } |
  { mode: "detail"; item: AttendanceLocationReviewItem; summary: { capturedAt: string | null; accuracyMeters: number | null; distanceMeters: number | null; settingsVersion: number; workerVersion: number; locationVersion: number; algorithmVersion: 1 };
    history: AttendanceReviewEntry[]; historyTruncated: boolean; receipt: (AttendanceReviewEntry & { operationId: string }) | null });
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function object(v: unknown, fields?: string[]) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  const o = v as Record<string, unknown>;
  if (fields && (Object.keys(o).length !== fields.length || fields.some(k => !Object.hasOwn(o, k)))) fail();
  return o;
}
function integer(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER - 1) { return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail(); }
function note(v: unknown) { return typeof v === "string" && v.trim() && Array.from(v.trim()).length <= 500 && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : fail(); }
function outcome(v: unknown): AttendanceReviewOutcome { return v === "noted" || v === "follow_up" || v === "reopen" ? v : fail(); }
export function attendanceReviewState(v: AttendanceReviewOutcome | null): AttendanceReviewState { return v === "noted" ? "reviewed" : v === "follow_up" ? "follow_up" : "pending"; }
export function attendanceLocationReviewQueryString(q: AttendanceLocationReviewQuery) {
  return new URLSearchParams(Object.entries(q).filter((entry): entry is [string, string] => entry[1] !== null)).toString();
}
export function parseAttendanceLocationReviewQuery(url: string): AttendanceLocationReviewQuery {
  const q = new URL(url).searchParams, siteId = attendanceSelfSite(q.get("siteId"));
  const mode = q.get("mode");
  const allowed = mode === "list" ? ["siteId", "mode", "fromAt", "toAt", "workerId", "locationId", "status", "asOf", "cursorAt", "cursorId"] : mode === "detail" ? ["siteId", "mode", "eventId", "operationId"] : fail();
  for (const k of q.keys()) if (!allowed.includes(k) || q.getAll(k).length !== 1) fail();
  if (mode === "detail") return { siteId, mode, eventId: attendanceSelfUuid(q.get("eventId")), operationId: q.has("operationId") ? attendanceSelfUuid(q.get("operationId")) : null };
  const status = q.get("status"); if (!["all", "pending", "reviewed", "follow_up"].includes(status ?? "")) return fail();
  const derived = new URLSearchParams(q); derived.delete("mode"); derived.delete("status"); derived.set("access", "owner");
  const parsed = parseAttendanceRecordsQuery(`https://local.invalid/?${derived}`);
  const { access: _access, ...rest } = parsed; void _access;
  return { ...rest, mode: "list", status: status as "all" | AttendanceReviewState };
}
export function parseAttendanceLocationReviewCommand(input: unknown): { siteId: string; command: AttendanceLocationReviewCommand } {
  const v = object(input, ["siteId", "eventId", "operationId", "expectedRevision", "outcome", "note"]);
  return { siteId: attendanceSelfSite(v.siteId), command: { eventId: attendanceSelfUuid(v.eventId), operationId: attendanceSelfUuid(v.operationId),
    expectedRevision: integer(v.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 2), outcome: outcome(v.outcome), note: note(v.note) } };
}
function entry(input: unknown, asOf: string): AttendanceReviewEntry {
  const v = object(input), recordedAt = attendanceRecordInstant(v.recordedAt);
  if (recordedAt > asOf || typeof v.byCurrentOwner !== "boolean" || typeof v.actorRef !== "string" || !/^[0-9a-f]{32}$/.test(v.actorRef)) return fail();
  return { revision: integer(v.revision, 1), outcome: outcome(v.outcome), note: note(v.note), recordedAt, actorRef: v.actorRef, byCurrentOwner: v.byCurrentOwner };
}
function item(input: unknown, asOf: string): AttendanceLocationReviewItem {
  const v = object(input);
  const record = parseAttendanceRecordPage({ asOf, items: [v], nextCursor: null }, { fromAt: "2000-01-01T00:00:00.000000Z", toAt: "2101-01-01T00:00:00.000000Z", workerId: null, locationId: null, asOf, cursorAt: null, cursorId: null }).items[0];
  if (!ATTENDANCE_REVIEW_REASONS.includes(v.reason as AttendanceReviewReason) || typeof v.reviewState !== "string" || !["pending", "reviewed", "follow_up"].includes(v.reviewState)) return fail();
  const reviewRevision = integer(v.reviewRevision);
  if (reviewRevision === 0 && v.reviewState !== "pending") return fail();
  return { ...record, reason: v.reason as AttendanceReviewReason, reviewRevision, reviewState: v.reviewState as AttendanceReviewState };
}
export function parseAttendanceLocationReviewResult(input: unknown, expected: AttendanceLocationReviewQuery): AttendanceLocationReviewResult {
  const v = object(input), asOf = attendanceRecordInstant(v.asOf);
  if (v.siteId !== expected.siteId || v.mode !== expected.mode) return fail();
  const base = { siteId: expected.siteId, asOf };
  if (expected.mode === "list") {
    const scanned = integer(v.scanned, 0, 50);
    if (expected.asOf !== null && asOf !== expected.asOf || !Array.isArray(v.items) || v.items.length > scanned) return fail();
    let previous = expected.cursorId ? { occurredAt: expected.cursorAt!, id: expected.cursorId } : null;
    const items = Array.from(v.items as unknown[], raw => {
      const r = item(raw, asOf);
      if (r.occurredAt < expected.fromAt || r.occurredAt >= expected.toAt || expected.workerId && r.workerId !== expected.workerId || expected.locationId && r.locationId !== expected.locationId || expected.status !== "all" && r.reviewState !== expected.status
        || previous && (r.occurredAt > previous.occurredAt || r.occurredAt === previous.occurredAt && r.id >= previous.id)) return fail();
      previous = r; return r;
    });
    if (new Set(items.map(r => r.id)).size !== items.length) return fail();
    let nextCursor: { occurredAt: string; id: string } | null = null;
    if (v.nextCursor !== null) {
      const c = object(v.nextCursor); nextCursor = { occurredAt: attendanceRecordInstant(c.occurredAt), id: attendanceSelfUuid(c.id) };
      if (scanned !== 50 || nextCursor.occurredAt < expected.fromAt || nextCursor.occurredAt >= expected.toAt || nextCursor.occurredAt >= asOf
        || expected.cursorId && (nextCursor.occurredAt > expected.cursorAt! || nextCursor.occurredAt === expected.cursorAt && nextCursor.id >= expected.cursorId)
        || previous && (nextCursor.occurredAt > previous.occurredAt || nextCursor.occurredAt === previous.occurredAt && nextCursor.id > previous.id)) return fail();
    }
    return { ...base, mode: "list", items, scanned, nextCursor };
  }
  const record = item(v.item, asOf), summary = object(v.summary);
  if (record.id !== expected.eventId || summary.algorithmVersion !== 1 || !Array.isArray(v.history) || v.history.length > 20 || typeof v.historyTruncated !== "boolean") return fail();
  const measured = ["outside", "uncertain", "stale", "future"].includes(record.reason);
  let capturedAt: string | null = null, accuracyMeters: number | null = null, distanceMeters: number | null = null;
  if (measured) {
    capturedAt = attendanceRecordInstant(summary.capturedAt);
    if (typeof summary.accuracyMeters !== "number" || !Number.isFinite(summary.accuracyMeters) || summary.accuracyMeters < 0 || summary.accuracyMeters > 40100000) return fail();
    accuracyMeters = summary.accuracyMeters; distanceMeters = integer(summary.distanceMeters, 0, 20100000);
    const age = attendanceInstant(`${record.occurredAt.slice(0, 23)}Z`) - attendanceInstant(`${capturedAt.slice(0, 23)}Z`);
    if (record.reason === "stale" ? age <= 60000 : record.reason === "future" ? age >= -5000 : age < -5000 || age > 60000) return fail();
  } else if (summary.capturedAt !== null || summary.accuracyMeters !== null || summary.distanceMeters !== null) return fail();
  const history = Array.from(v.history as unknown[], (raw, index) => {
    const h = entry(raw, asOf); if (h.revision !== record.reviewRevision - index || h.recordedAt < record.occurredAt) return fail(); return h;
  });
  if (history.length !== Math.min(record.reviewRevision, 20) || v.historyTruncated !== (record.reviewRevision > 20) || attendanceReviewState(history[0]?.outcome ?? null) !== record.reviewState
    || history.some((h, i) => i > 0 && h.recordedAt > history[i - 1].recordedAt)) return fail();
  let receipt: Extract<AttendanceLocationReviewResult, { mode: "detail" }>["receipt"] = null;
  if (v.receipt !== null) {
    const r = object(v.receipt), h = entry(r, asOf);
    if (r.operationId !== expected.operationId || !h.byCurrentOwner || h.revision > record.reviewRevision || h.recordedAt < record.occurredAt) return fail();
    const same = history.find(x => x.revision === h.revision); if (same && JSON.stringify(same) !== JSON.stringify(h)) return fail();
    receipt = { ...h, operationId: attendanceSelfUuid(r.operationId) };
  }
  return { ...base, mode: "detail", item: record, summary: { capturedAt, accuracyMeters, distanceMeters, settingsVersion: integer(summary.settingsVersion, 1), workerVersion: integer(summary.workerVersion, 1), locationVersion: integer(summary.locationVersion, 1), algorithmVersion: 1 }, history, historyTruncated: v.historyTruncated, receipt };
}
export const ATTENDANCE_LOCATION_REVIEW_ERRORS: Readonly<Record<string, number>> = { attendance_invalid_request: 400, attendance_invalid_instant: 400,
  attendance_body_too_large: 413, attendance_invalid_content_type: 415, attendance_access_denied: 403, attendance_review_not_found: 404,
  attendance_operation_conflict: 409, attendance_version_conflict: 409, attendance_rate_limited: 429 };
