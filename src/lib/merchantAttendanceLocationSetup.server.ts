import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { LOCATION_SETUP_ERRORS, parseLocationSetupResult, setupReceiptMatches, type LocationSetupCommand, type LocationSetupQuery } from "./merchantAttendanceLocationSetup";
export type LocationSetupInput = LocationSetupQuery & { authUserId: string; command: LocationSetupCommand | null; allowPrepare: boolean };
export async function executeLocationSetup(input: LocationSetupInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  if (input.command && input.operationId !== null) throw new MerchantAttendanceError("attendance_invalid_request");
  const result = await service.rpc("faolla_attendance_location_setup_v1", { p_site_id: input.siteId, p_auth_user_id: input.authUserId, p_location_id: input.locationId,
    p_command: input.command, p_operation_id: input.operationId, p_allow_prepare: input.allowPrepare });
  if (result.error) { const code = result.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(LOCATION_SETUP_ERRORS, code) ? code : "attendance_unavailable"); }
  try {
    const parsed = parseLocationSetupResult(result.data, { ...input, ownerId: input.authUserId, operationId: input.command?.operationId ?? input.operationId });
    if (input.command && (!parsed.receipt || !setupReceiptMatches(parsed.receipt, input.command))) throw Error("receipt_mismatch");
    return parsed;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
