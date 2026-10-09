import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { DISCUSSION_ERRORS, parseDiscussionResult, type DiscussionQuery, type DiscussionCommand } from "./merchantAttendanceLocationDiscussion";
export type DiscussionInput = { query: DiscussionQuery; authUserId: string; command: DiscussionCommand | null };
export async function executeAttendanceDiscussion(input: DiscussionInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const { siteId, ...query } = input.query;
  if (input.command && (query.mode !== "detail" || query.eventId !== input.command.eventId || query.operationId !== null)) throw new MerchantAttendanceError("attendance_invalid_request");
  const result = await service.rpc("faolla_attendance_location_discussion_v1", { p_site_id: siteId, p_auth_user_id: input.authUserId, p_query: query, p_command: input.command });
  if (result.error) { const code = result.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(DISCUSSION_ERRORS, code) ? code : "attendance_unavailable"); }
  try {
    const parsed = parseDiscussionResult(result.data, input.command ? { ...input.query, mode: "detail", eventId: input.command.eventId, operationId: input.command.operationId } : input.query);
    if (input.command && (parsed.mode !== "detail" || parsed.receipt?.revision !== input.command.expectedRevision + 1 || parsed.receipt.note !== input.command.note)) throw Error("receipt_mismatch");
    return parsed;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
