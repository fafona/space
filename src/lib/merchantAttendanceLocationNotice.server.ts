import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { NOTICE_ERRORS, parseNoticeResult, noticeReceiptMatches, type NoticeQuery, type NoticeCommand } from "./merchantAttendanceLocationNotice";
export type NoticeInput = { query: NoticeQuery; authUserId: string; command: NoticeCommand | null; allowPublish: boolean };
export async function executeAttendanceNotice(input: NoticeInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  if (input.command && (input.query.operationId !== null || (input.query.access === "self") !== (input.command.action === "acknowledge"))) throw new MerchantAttendanceError("attendance_invalid_request");
  const { siteId, ...query } = input.query;
  const result = await service.rpc("faolla_attendance_location_notice_v1", { p_site_id: siteId, p_auth_user_id: input.authUserId, p_query: query, p_command: input.command, p_allow_publish: input.allowPublish });
  if (result.error) { const code = result.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(NOTICE_ERRORS, code) ? code : "attendance_unavailable"); }
  try {
    const parsed = parseNoticeResult(result.data, { ...input.query, operationId: input.command?.operationId ?? input.query.operationId });
    if (input.command && (!parsed.receipt || !noticeReceiptMatches(parsed.receipt, input.command))) throw Error("receipt_mismatch");
    return parsed;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
