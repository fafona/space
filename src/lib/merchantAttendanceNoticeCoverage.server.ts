import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { COVERAGE_ERRORS, parseCoverageResult, type CoverageQuery } from "./merchantAttendanceNoticeCoverage";
export type CoverageInput = { query: CoverageQuery; authUserId: string };
export async function executeAttendanceNoticeCoverage(input: CoverageInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const { siteId, ...query } = input.query;
  const result = await service.rpc("faolla_attendance_location_notice_coverage_v1", { p_site_id: siteId, p_auth_user_id: input.authUserId, p_query: query });
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(COVERAGE_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseCoverageResult(result.data, input.query); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
