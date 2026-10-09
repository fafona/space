import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseLeaveReviewQuery, parseLeaveReviewResult, LEAVE_REVIEW_ERRORS, type LeaveReviewQuery } from "./merchantAttendanceLeaveReview";
export async function executeLeaveReview(input: { query: LeaveReviewQuery; authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseLeaveReviewQuery(input.query), authUserId = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_leave_review_v1", { p_query: query, p_auth_user_id: authUserId }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(LEAVE_REVIEW_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseLeaveReviewResult(response.data, query, authUserId); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
