import { attendanceSelfSite, attendanceSelfUuid, ATTENDANCE_SELF_ERROR_STATUS } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
export type AttendanceSelfContext = { siteId: string; employeeId: string; workerId: string; locationId: string | null };
export const ATTENDANCE_SELF_CONTEXT_ERRORS = ATTENDANCE_SELF_ERROR_STATUS;
export function parseAttendanceSelfContextQuery(url: string) {
  const q = new URL(url).searchParams;
  if ([...q.keys()].some(k => k !== "siteId") || q.getAll("siteId").length !== 1) throw new MerchantAttendanceError("attendance_invalid_request");
  return { siteId: attendanceSelfSite(q.get("siteId")) };
}
export function parseAttendanceSelfContext(data: unknown, siteId: string): AttendanceSelfContext {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new MerchantAttendanceError("attendance_unavailable");
  const v = data as Record<string, unknown>;
  if (v.siteId !== attendanceSelfSite(siteId)) throw new MerchantAttendanceError("attendance_unavailable");
  return { siteId, employeeId: attendanceSelfUuid(v.employeeId), workerId: attendanceSelfUuid(v.workerId), locationId: v.locationId === null ? null : attendanceSelfUuid(v.locationId) };
}
