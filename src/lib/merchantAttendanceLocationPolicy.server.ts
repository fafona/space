import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ATTENDANCE_LOCATION_POLICY_ERRORS, parseAttendanceLocationPolicyResult, type AttendanceLocationPolicyCommand, type AttendanceLocationPolicyQuery } from "./merchantAttendanceLocationPolicy";

export type AttendanceLocationPolicyInput = AttendanceLocationPolicyQuery & { authUserId: string; command: AttendanceLocationPolicyCommand | null; allowWrite: boolean };
export async function executeAttendanceLocationPolicy(input: AttendanceLocationPolicyInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  if (input.command && input.operationId !== null) throw new MerchantAttendanceError("attendance_invalid_request");
  const result = await service.rpc("faolla_attendance_location_policy_draft_v1", {
    p_site_id: input.siteId, p_auth_user_id: input.authUserId, p_location_id: input.locationId, p_command: input.command,
    p_operation_id: input.operationId, p_allow_write: input.allowWrite,
  });
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_LOCATION_POLICY_ERRORS, code) ? code : "attendance_unavailable");
  }
  try {
    const parsed = parseAttendanceLocationPolicyResult(result.data, { ...input, operationId: input.command?.operationId ?? input.operationId });
    if (input.command && parsed.receipt?.revision !== input.command.expectedRevision + 1) throw Error("receipt_mismatch");
    return parsed;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
