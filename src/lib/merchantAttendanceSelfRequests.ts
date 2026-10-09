import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const SELF_REQUEST_KINDS = ["correction", "revision", "missing"] as const;
export const SELF_REQUEST_STATUSES = ["submitted", "approved", "rejected", "withdrawn"] as const;
export type SelfRequestKind = typeof SELF_REQUEST_KINDS[number];
export type SelfRequestStatus = typeof SELF_REQUEST_STATUSES[number];
export type SelfRequestsCursor = { recordedAt: string; kind: SelfRequestKind; requestId: string };
export type SelfRequestsQuery = { siteId: string; expectedEmployeeId: string; expectedWorkerId: string;
  kind: "all" | SelfRequestKind; status: "all" | SelfRequestStatus; asOf: string | null;
  cursorAt: string | null; cursorKind: SelfRequestKind | null; cursorId: string | null };
export type SelfRequestsItem = { kind: SelfRequestKind; requestId: string; rootRequestId: string; workerId: string; employeeId: string;
  workerName: string; workerNo: string; submittedAt: string; proposedStartAt: string; proposedEndAt: string;
  status: SelfRequestStatus; closedAt: string | null };
export type SelfRequestsResult = { protocol: "self-requests-v1"; readOnly: true; siteId: string; employeeId: string; workerId: string;
  asOf: string; items: SelfRequestsItem[]; scanned: number; nextCursor: SelfRequestsCursor | null };
export const SELF_REQUESTS_ERRORS: Readonly<Record<string, number>> = {
  attendance_invalid_request: 400, attendance_invalid_instant: 400, attendance_access_denied: 403,
  attendance_settings_required: 409, attendance_worker_changed: 409, attendance_rate_limited: 429,
  attendance_not_available: 404, attendance_self_requests_invalid: 503, attendance_self_requests_too_large: 422, attendance_unavailable: 503,
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) fail();
  return record;
}
const instant = (value: unknown) => { const parsed = attendanceRecordInstant(value); return parsed === value ? parsed : fail(); };
const kind = (value: unknown): SelfRequestKind => SELF_REQUEST_KINDS.includes(value as SelfRequestKind) ? value as SelfRequestKind : fail();
const status = (value: unknown): SelfRequestStatus => SELF_REQUEST_STATUSES.includes(value as SelfRequestStatus) ? value as SelfRequestStatus : fail();
const label = (value: unknown, max: number) => typeof value === "string" && value.trim() && [...value].length <= max
  && !/[\u0000-\u001f\u007f-\u009f]/.test(value) ? value : fail();
// DESC on the complete (microsecond, source rank, UUID) tuple. Never locale sort.
function compare(a: SelfRequestsCursor, b: SelfRequestsCursor): number {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
  const rank = SELF_REQUEST_KINDS.indexOf(a.kind) - SELF_REQUEST_KINDS.indexOf(b.kind);
  return rank || (a.requestId === b.requestId ? 0 : a.requestId < b.requestId ? -1 : 1);
}
export function parseSelfRequestsQuery(raw: unknown): SelfRequestsQuery {
  const v = exact(raw, ["siteId", "expectedEmployeeId", "expectedWorkerId", "kind", "status", "asOf", "cursorAt", "cursorKind", "cursorId"]);
  const filter = v.kind === "all" ? "all" : kind(v.kind), state = v.status === "all" ? "all" : status(v.status);
  const asOf = v.asOf === null ? null : instant(v.asOf), cursorAt = v.cursorAt === null ? null : instant(v.cursorAt);
  const cursorKind = v.cursorKind === null ? null : kind(v.cursorKind), cursorId = v.cursorId === null ? null : attendanceSelfUuid(v.cursorId);
  if ((cursorAt === null) !== (cursorKind === null) || (cursorAt === null) !== (cursorId === null)
    || cursorAt && (!asOf || cursorAt > asOf || filter !== "all" && cursorKind !== filter)) fail();
  return { siteId: attendanceSelfSite(v.siteId), expectedEmployeeId: attendanceSelfUuid(v.expectedEmployeeId), expectedWorkerId: attendanceSelfUuid(v.expectedWorkerId),
    kind: filter, status: state, asOf, cursorAt, cursorKind, cursorId };
}
export function parseSelfRequestsHttpQuery(url: string) {
  const params = new URL(url).searchParams, v: Record<string, unknown> = { asOf: null, cursorAt: null, cursorKind: null, cursorId: null };
  for (const [key, value] of params) { if (params.getAll(key).length !== 1) fail(); v[key] = value; }
  return parseSelfRequestsQuery(v);
}
export const selfRequestsQueryString = (q: SelfRequestsQuery) => new URLSearchParams(Object.entries(q)
  .filter((entry): entry is [string, string] => entry[1] !== null)).toString();
export function parseSelfRequestsResult(raw: unknown, input: SelfRequestsQuery): SelfRequestsResult {
  const q = parseSelfRequestsQuery(input), v = exact(raw, ["protocol", "readOnly", "siteId", "employeeId", "workerId", "asOf", "items", "scanned", "nextCursor"]);
  const asOf = instant(v.asOf);
  if (v.protocol !== "self-requests-v1" || v.readOnly !== true || v.siteId !== q.siteId || v.employeeId !== q.expectedEmployeeId || v.workerId !== q.expectedWorkerId
    || q.asOf !== null && q.asOf !== asOf || q.cursorAt && q.cursorAt > asOf || !Number.isInteger(v.scanned) || Number(v.scanned) < 0 || Number(v.scanned) > 50
    || !Array.isArray(v.items) || v.items.length > Number(v.scanned)) fail();
  const initial = q.cursorAt ? { recordedAt: q.cursorAt, kind: q.cursorKind!, requestId: q.cursorId! } : null;
  let previous: SelfRequestsCursor | null = initial;
  const identities = new Set<string>();
  const items = (v.items as unknown[]).map(rawItem => {
    const r = exact(rawItem, ["kind", "requestId", "rootRequestId", "workerId", "employeeId", "workerName", "workerNo", "submittedAt", "proposedStartAt", "proposedEndAt", "status", "closedAt"]);
    const source = kind(r.kind), state = status(r.status), requestId = attendanceSelfUuid(r.requestId), rootRequestId = attendanceSelfUuid(r.rootRequestId);
    const submittedAt = instant(r.submittedAt), proposedStartAt = instant(r.proposedStartAt), proposedEndAt = instant(r.proposedEndAt), closedAt = r.closedAt === null ? null : instant(r.closedAt);
    const position = { recordedAt: submittedAt, kind: source, requestId }, identity = `${source}:${requestId}`;
    if (r.workerId !== q.expectedWorkerId || r.employeeId !== q.expectedEmployeeId || q.kind !== "all" && source !== q.kind || q.status !== "all" && state !== q.status
      || source === "correction" && rootRequestId !== requestId || source === "revision" && rootRequestId === requestId
      || submittedAt > asOf || proposedStartAt >= proposedEndAt || proposedEndAt > submittedAt || (state === "submitted") !== (closedAt === null)
      || closedAt && (closedAt < submittedAt || closedAt > asOf) || identities.has(identity) || previous && compare(position, previous) >= 0) fail();
    identities.add(identity); previous = position;
    return { kind: source, requestId, rootRequestId, workerId: q.expectedWorkerId, employeeId: q.expectedEmployeeId,
      workerName: label(r.workerName, 120), workerNo: label(r.workerNo, 40), submittedAt, proposedStartAt, proposedEndAt, status: state, closedAt };
  });
  let nextCursor: SelfRequestsCursor | null = null;
  if (v.nextCursor !== null) {
    const c = exact(v.nextCursor, ["recordedAt", "kind", "requestId"]);
    nextCursor = { recordedAt: instant(c.recordedAt), kind: kind(c.kind), requestId: attendanceSelfUuid(c.requestId) };
    if (v.scanned !== 50 || nextCursor.recordedAt > asOf || q.kind !== "all" && nextCursor.kind !== q.kind
      || initial && compare(nextCursor, initial) >= 0 || previous && compare(nextCursor, previous) > 0) fail();
  }
  return { protocol: "self-requests-v1", readOnly: true, siteId: q.siteId, employeeId: q.expectedEmployeeId, workerId: q.expectedWorkerId,
    asOf, items, scanned: Number(v.scanned), nextCursor };
}
export function parseSelfRequestsResponse(raw: unknown, q: SelfRequestsQuery) {
  const v = exact(raw, ["ok", "moduleEnabled", "protocol", "readOnly", "siteId", "employeeId", "workerId", "asOf", "items", "scanned", "nextCursor"]);
  if (v.ok !== true || typeof v.moduleEnabled !== "boolean") fail();
  const { ok, moduleEnabled, ...body } = v; void ok;
  return { ...parseSelfRequestsResult(body, q), moduleEnabled: moduleEnabled as boolean };
}
