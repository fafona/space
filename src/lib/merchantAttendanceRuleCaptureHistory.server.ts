import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseRuleCaptureHistoryQuery, parseRuleCaptureHistoryResult, RULE_CAPTURE_HISTORY_ERRORS, type RuleCaptureHistoryQuery } from "./merchantAttendanceRuleCaptureHistory";

// Metadata only. Never call a source reader, archive-content reader or writer.
export async function executeRuleCaptureHistory(input: { query: RuleCaptureHistoryQuery; authUserId: string },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<unknown> {
  const query = parseRuleCaptureHistoryQuery(input.query), authUserId = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_rule_capture_history_v1", { p_query: query, p_auth_user_id: authUserId }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(RULE_CAPTURE_HISTORY_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { parseRuleCaptureHistoryResult(response.data, query, authUserId); }
  catch (error) {
    if (error instanceof MerchantAttendanceError && error.code === "attendance_rule_capture_history_too_large") throw error;
    throw new MerchantAttendanceError("attendance_rule_capture_history_invalid");
  }
  return response.data;
}
