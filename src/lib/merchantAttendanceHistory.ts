import { attendanceRecordInstant, parseAttendanceRecordPage, type AttendanceRecord } from "./merchantAttendanceManagement";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type AttendanceHistoryQuery = { siteId: string; fromAt: string; toAt: string; expectedWorkerId: string | null;
  asOf: string | null; cursorAt: string | null; cursorId: string | null };
export type AttendanceHistoryResult = { siteId: string; employeeId: string; workerId: string; asOf: string;
  items: AttendanceRecord[]; nextCursor: { occurredAt: string; id: string } | null };
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const micros = (v: string) => BigInt(Date.parse(`${v.slice(0,23)}Z`)) * BigInt(1000) + BigInt(v.slice(23,26));
export function parseAttendanceHistoryQuery(url: string): AttendanceHistoryQuery {
  const q = new URL(url).searchParams;
  for (const key of q.keys()) if (!["siteId","fromAt","toAt","expectedWorkerId","asOf","cursorAt","cursorId"].includes(key) || q.getAll(key).length !== 1) fail();
  const fromAt = attendanceRecordInstant(q.get("fromAt")), toAt = attendanceRecordInstant(q.get("toAt"));
  if (toAt <= fromAt || micros(toAt) - micros(fromAt) > BigInt(2678400000000)) fail();
  const asOf = q.has("asOf") ? attendanceRecordInstant(q.get("asOf")) : null;
  const cursorAt = q.has("cursorAt") ? attendanceRecordInstant(q.get("cursorAt")) : null;
  const cursorId = q.has("cursorId") ? attendanceSelfUuid(q.get("cursorId")) : null;
  const expectedWorkerId = q.has("expectedWorkerId") ? attendanceSelfUuid(q.get("expectedWorkerId")) : null;
  if ((cursorAt === null) !== (cursorId === null) || (cursorId && (!asOf || !expectedWorkerId || cursorAt! < fromAt || cursorAt! >= toAt || cursorAt! >= asOf))) fail();
  return { siteId: attendanceSelfSite(q.get("siteId")), fromAt, toAt, expectedWorkerId, asOf, cursorAt, cursorId };
}
export function parseAttendanceHistoryResult(value: unknown, expected: AttendanceHistoryQuery): AttendanceHistoryResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const o = value as Record<string, unknown>, employeeId = attendanceSelfUuid(o.employeeId), workerId = attendanceSelfUuid(o.workerId);
  if (o.siteId !== expected.siteId || (expected.expectedWorkerId && workerId !== expected.expectedWorkerId)) fail();
  return { siteId: expected.siteId, employeeId, workerId,
    ...parseAttendanceRecordPage(value, { ...expected, workerId, locationId: null }) };
}
export const ATTENDANCE_HISTORY_ERRORS: Readonly<Record<string, number>> = {
  attendance_invalid_request: 400, attendance_invalid_instant: 400, attendance_access_denied: 403,
  attendance_settings_required: 409, attendance_worker_changed: 409, attendance_rate_limited: 429,
};
