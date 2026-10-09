import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseSelfRequestsQuery, parseSelfRequestsResult, SELF_REQUESTS_ERRORS, type SelfRequestsQuery } from "./merchantAttendanceSelfRequests";
export type SelfRequestsInput = { query: SelfRequestsQuery; authUserId: string };
export async function executeSelfRequests(input: SelfRequestsInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const q = parseSelfRequestsQuery(input.query), { siteId, ...query } = q, authUserId = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_self_requests_v1", { p_site_id: siteId, p_auth_user_id: authUserId, p_query: query }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(SELF_REQUESTS_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseSelfRequestsResult(response.data, q); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
