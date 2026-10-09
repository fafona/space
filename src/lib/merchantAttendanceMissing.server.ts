import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseMissingBody, parseMissingQuery, parseMissingResult, missingQueryString, MISSING_ERRORS, type MissingCommand, type MissingQuery } from "./merchantAttendanceMissing";

export async function executeAttendanceMissing(input: { query: MissingQuery; command: MissingCommand | null; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const query = parseMissingQuery(`https://local.invalid/?${missingQueryString(input.query)}`);
  const command = input.command ? parseMissingBody({ query, command: input.command }).command : null;
  const result = await service.rpc("faolla_attendance_missing_v1", { p_query: query, p_auth_user_id: attendanceSelfUuid(input.authUserId), p_command: command, p_allow_write: input.allowWrite });
  if (result.error) { const code = result.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(MISSING_ERRORS, code) ? code : "attendance_unavailable"); }
  try {
    const response = parseMissingResult(result.data, { ...query, operationId: command?.operationId ?? query.operationId }, false);
    if (command && (!response.receipt || JSON.stringify(response.receipt.command) !== JSON.stringify(command))) throw Error("receipt_mismatch");
    return response;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
