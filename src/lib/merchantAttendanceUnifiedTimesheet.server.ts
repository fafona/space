import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseUnifiedQuery, unifiedQueryString, parseUnifiedSource, UNIFIED_REPORT_ERRORS, type UnifiedQuery } from "./merchantAttendanceUnifiedTimesheet";
export async function executeUnifiedTimesheet(input: { query: UnifiedQuery; authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const q = parseUnifiedQuery(`https://local.invalid/?${unifiedQueryString(input.query)}`);
  const query = q.access === "owner" ? { access: q.access, workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate } : {
    access: q.access, workerId: q.access === "manager" ? q.workerId : null, locationId: q.access === "manager" ? q.locationId : null,
    expectedWorkerId: q.access === "self" ? q.expectedWorkerId : null, fromDate: q.fromDate, throughDate: q.throughDate };
  const response = await service.rpc("faolla_attendance_unified_report_v1", { p_site_id: q.siteId, p_auth_user_id: attendanceSelfUuid(input.authUserId), p_query: query });
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(UNIFIED_REPORT_ERRORS, code) ? code : "attendance_unavailable"); }
  try { return parseUnifiedSource(response.data, q); }
  catch (e) { if (e instanceof MerchantAttendanceError && ["attendance_report_reconciliation_required", "attendance_report_overlap", "attendance_report_too_large", "attendance_session_invalid_records", "attendance_session_span_too_long"].includes(e.code)) throw e;
    throw new MerchantAttendanceError("attendance_unavailable"); }
}
