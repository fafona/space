import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { ATTENDANCE_HISTORY_ERRORS, parseAttendanceHistoryResult, type AttendanceHistoryQuery } from "./merchantAttendanceHistory";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type AttendanceHistoryInput = AttendanceHistoryQuery & { authUserId: string };
export async function executeAttendanceHistory(input: AttendanceHistoryInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const result = await service.rpc("faolla_attendance_self_history_v1", {
    p_site_id: input.siteId, p_auth_user_id: input.authUserId, p_query: {
      fromAt: input.fromAt, toAt: input.toAt, expectedWorkerId: input.expectedWorkerId,
      asOf: input.asOf, cursorAt: input.cursorAt, cursorId: input.cursorId,
    },
  });
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_HISTORY_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseAttendanceHistoryResult(result.data, input); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
