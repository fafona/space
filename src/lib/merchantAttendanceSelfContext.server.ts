import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { ATTENDANCE_SELF_CONTEXT_ERRORS, parseAttendanceSelfContext } from "./merchantAttendanceSelfContext";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
export async function executeAttendanceSelfContext(input: { siteId: string; authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const result = await service.rpc("faolla_attendance_self_context_v1", { p_site_id: input.siteId, p_auth_user_id: input.authUserId });
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_SELF_CONTEXT_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseAttendanceSelfContext(result.data, input.siteId); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
