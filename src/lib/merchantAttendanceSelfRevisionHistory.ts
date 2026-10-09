import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { REVISION_HISTORY_ERRORS, REVISION_HISTORY_STATUSES, type RevisionHistoryItem, type RevisionHistoryStatus } from "./merchantAttendanceRevisionHistory";

export type SelfRevisionHistoryQuery = { siteId: string; expectedWorkerId: string; status: RevisionHistoryStatus;
  asOf: string | null; cursorAt: string | null; cursorId: string | null };
export type SelfRevisionHistoryResult = { protocol: "self-revision-history-v1"; readOnly: true; siteId: string;
  employeeId: string; workerId: string; asOf: string; items: RevisionHistoryItem[]; scanned: number;
  nextCursor: { recordedAt: string; requestId: string } | null };
export const SELF_REVISION_HISTORY_ERRORS = REVISION_HISTORY_ERRORS;
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail();
  return v;
}
function instant(v: unknown) { const parsed = attendanceRecordInstant(v); return parsed === v ? parsed : fail(); }
const before = (a: { recordedAt: string; requestId: string }, b: { recordedAt: string; requestId: string }) =>
  a.recordedAt < b.recordedAt || a.recordedAt === b.recordedAt && a.requestId < b.requestId;
function label(v: unknown, max: number) {
  return typeof v === "string" && v.trim() && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
}
export function parseSelfRevisionHistoryQuery(raw: unknown): SelfRevisionHistoryQuery {
  const v = object(raw, ["siteId", "expectedWorkerId", "status", "asOf", "cursorAt", "cursorId"]);
  if (!REVISION_HISTORY_STATUSES.includes(v.status as RevisionHistoryStatus)) fail();
  const asOf = v.asOf === null ? null : instant(v.asOf), cursorAt = v.cursorAt === null ? null : instant(v.cursorAt);
  const cursorId = v.cursorId === null ? null : attendanceSelfUuid(v.cursorId);
  if ((cursorAt === null) !== (cursorId === null) || cursorAt && (!asOf || cursorAt > asOf)) fail();
  return { siteId: attendanceSelfSite(v.siteId), expectedWorkerId: attendanceSelfUuid(v.expectedWorkerId), status: v.status as RevisionHistoryStatus, asOf, cursorAt, cursorId };
}
export function parseSelfRevisionHistoryHttpQuery(url: string) {
  const params = new URL(url).searchParams, value: Record<string, unknown> = { asOf: null, cursorAt: null, cursorId: null };
  for (const [key, v] of params) { if (params.getAll(key).length !== 1) fail(); value[key] = v; }
  return parseSelfRevisionHistoryQuery(value);
}
export const selfRevisionHistoryQueryString = (q: SelfRevisionHistoryQuery) =>
  new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => e[1] !== null)).toString();

export function parseSelfRevisionHistoryResult(raw: unknown, input: SelfRevisionHistoryQuery): SelfRevisionHistoryResult {
  const q = parseSelfRevisionHistoryQuery(input);
  const v = object(raw, ["protocol", "readOnly", "siteId", "employeeId", "workerId", "asOf", "items", "scanned", "nextCursor"]);
  const employeeId = attendanceSelfUuid(v.employeeId), workerId = attendanceSelfUuid(v.workerId), asOf = instant(v.asOf);
  if (v.protocol !== "self-revision-history-v1" || v.readOnly !== true || v.siteId !== q.siteId || workerId !== q.expectedWorkerId
    || q.asOf !== null && asOf !== q.asOf || q.cursorAt && q.cursorAt > asOf
    || !Number.isInteger(v.scanned) || Number(v.scanned) < 0 || Number(v.scanned) > 50 || !Array.isArray(v.items) || v.items.length > Number(v.scanned)) fail();
  let previous = q.cursorAt ? { recordedAt: q.cursorAt, requestId: q.cursorId! } : null;
  const items = (v.items as unknown[]).map(rawItem => {
    const r = object(rawItem, ["requestId", "rootRequestId", "workerId", "employeeId", "workerName", "workerNo", "submittedRevision", "submittedAt", "proposedStartAt", "proposedEndAt", "status", "closedAt", "decisionOperationId"]);
    const requestId = attendanceSelfUuid(r.requestId), rootRequestId = attendanceSelfUuid(r.rootRequestId);
    const submittedAt = instant(r.submittedAt), proposedStartAt = instant(r.proposedStartAt), proposedEndAt = instant(r.proposedEndAt);
    const closedAt = r.closedAt === null ? null : instant(r.closedAt);
    const decisionOperationId = r.decisionOperationId === null ? null : attendanceSelfUuid(r.decisionOperationId);
    if (r.workerId !== workerId || r.employeeId !== employeeId || requestId === rootRequestId
      || !Number.isSafeInteger(r.submittedRevision) || Number(r.submittedRevision) < 1 || Number(r.submittedRevision) > 9007199254740989
      || submittedAt > asOf || proposedStartAt >= proposedEndAt || proposedEndAt > submittedAt
      || !["submitted", "approved", "rejected", "withdrawn"].includes(String(r.status)) || q.status !== "all" && r.status !== q.status
      || closedAt && (closedAt <= submittedAt || closedAt > asOf) || (r.status === "submitted") !== (closedAt === null)
      || (["approved", "rejected"].includes(String(r.status))) !== (decisionOperationId !== null)
      || decisionOperationId && [requestId, rootRequestId].includes(decisionOperationId)
      || previous && !before({ recordedAt: submittedAt, requestId }, previous)) fail();
    previous = { recordedAt: submittedAt, requestId };
    return { requestId, rootRequestId, workerId, employeeId, workerName: label(r.workerName, 120), workerNo: label(r.workerNo, 40),
      submittedRevision: Number(r.submittedRevision), submittedAt, proposedStartAt, proposedEndAt, status: r.status as RevisionHistoryItem["status"], closedAt, decisionOperationId };
  });
  if (new Set(items.map(r => r.requestId)).size !== items.length) fail();
  let nextCursor = null;
  if (v.nextCursor !== null) {
    const c = object(v.nextCursor, ["recordedAt", "requestId"]);
    nextCursor = { recordedAt: instant(c.recordedAt), requestId: attendanceSelfUuid(c.requestId) };
    // The cursor identifies the last scanned candidate, which need not match
    // this status filter. Never infer that an empty page is the end of history.
    if (v.scanned !== 50 || nextCursor.recordedAt > asOf || previous && before(previous, nextCursor)
      || q.cursorAt && !before(nextCursor, { recordedAt: q.cursorAt, requestId: q.cursorId! })) fail();
  }
  return { protocol: "self-revision-history-v1", readOnly: true, siteId: q.siteId, employeeId, workerId, asOf, scanned: Number(v.scanned), items, nextCursor };
}
export function parseSelfRevisionHistoryResponse(raw: unknown, q: SelfRevisionHistoryQuery) {
  const v = object(raw, ["ok", "moduleEnabled", "protocol", "readOnly", "siteId", "employeeId", "workerId", "asOf", "items", "scanned", "nextCursor"]);
  if (v.ok !== true || typeof v.moduleEnabled !== "boolean") fail();
  const { ok, moduleEnabled, ...body } = v; void ok;
  return { ...parseSelfRevisionHistoryResult(body, q), moduleEnabled: moduleEnabled as boolean };
}
