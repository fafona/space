import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ATTENDANCE_LOCATION_REVIEW_ERRORS, parseAttendanceLocationReviewResult, type AttendanceLocationReviewQuery, type AttendanceLocationReviewCommand } from "./merchantAttendanceLocationReview";
export type AttendanceLocationReviewInput = { query: AttendanceLocationReviewQuery; authUserId: string; command: AttendanceLocationReviewCommand | null };
export async function executeAttendanceLocationReview(input: AttendanceLocationReviewInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const { siteId, ...query } = input.query;
  if (input.command && (query.mode !== "detail" || query.eventId !== input.command.eventId || query.operationId !== null)) throw new MerchantAttendanceError("attendance_invalid_request");
  const result = await service.rpc("faolla_attendance_location_reviews_v1", { p_site_id: siteId, p_auth_user_id: input.authUserId, p_query: query, p_command: input.command });
  if (result.error) {
    const code = result.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_LOCATION_REVIEW_ERRORS, code) ? code : "attendance_unavailable");
  }
  try {
    const parsed = parseAttendanceLocationReviewResult(result.data, input.command ? { siteId, mode: "detail", eventId: input.command.eventId, operationId: input.command.operationId } : input.query);
    if (input.command && (parsed.mode !== "detail" || parsed.receipt?.revision !== input.command.expectedRevision + 1 || parsed.receipt.outcome !== input.command.outcome || parsed.receipt.note !== input.command.note)) throw Error("receipt_mismatch");
    return parsed;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
