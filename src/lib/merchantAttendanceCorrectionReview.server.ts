import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { CORRECTION_REVIEW_ERRORS, correctionReviewQueryString, parseCorrectionReviewQuery, parseCorrectionReviewResult, type CorrectionReviewQuery } from "./merchantAttendanceCorrectionReview";
export async function executeCorrectionReview(input: { query: CorrectionReviewQuery; authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const query = parseCorrectionReviewQuery(`https://local.invalid/?${correctionReviewQueryString(input.query)}`), { siteId, ...rpcQuery } = query;
  const result = await service.rpc("faolla_attendance_correction_owner_review_v3", { p_site_id: siteId, p_auth_user_id: attendanceSelfUuid(input.authUserId), p_query: rpcQuery });
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(CORRECTION_REVIEW_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseCorrectionReviewResult(result.data, query, true, true); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
