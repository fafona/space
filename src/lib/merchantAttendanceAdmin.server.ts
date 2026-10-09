import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import type { AttendanceSelfRpc } from "@/lib/merchantAttendanceSelf.server";
import { ATTENDANCE_ADMIN_ERRORS, parseAttendanceAdminResult, type AttendanceAdminCommand, type AttendanceAdminQuery } from "@/lib/merchantAttendanceAdmin";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";

export type AttendanceAdminInput = AttendanceAdminQuery & { authUserId: string; command: AttendanceAdminCommand | null };
export async function executeAttendanceAdmin(input: AttendanceAdminInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const result = await service.rpc("faolla_attendance_admin_v1", {
    p_site_id: input.siteId, p_auth_user_id: input.authUserId,
    p_query: { view: input.view, cursor: input.cursor, search: input.search },
    p_command: input.command, p_operation_id: input.operationId,
  });
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_ADMIN_ERRORS, code) ? code : "attendance_unavailable");
  }
  try {
    const parsed = parseAttendanceAdminResult(result.data, { ...input, operationId: input.command?.operationId ?? input.operationId });
    if (input.command && (!parsed.receipt || parsed.receipt.kind !== input.command.kind
      || parsed.receipt.targetId !== (input.command.kind === "settings" ? null : input.command.values.id))) throw Error("receipt_mismatch");
    return parsed;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
