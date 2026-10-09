import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ACCOUNT_SUSPENSION_ERRORS, parseAccountSuspensionQuery, parseAccountSuspensionBody, parseAccountSuspensionResult,
  accountSuspensionCommandFingerprint, accountSuspensionReceiptMatches, type AccountSuspensionQuery, type AccountSuspensionCommand } from "./merchantAttendanceAccountSuspension";

export function accountSuspensionEnabled(env: NodeJS.ProcessEnv = process.env) { return env.FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED === "1"; }
export async function executeAccountSuspension(input: { query: AccountSuspensionQuery; command: AccountSuspensionCommand | null; authUserId: string; allowRestore: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const query = parseAccountSuspensionQuery(input.query), command = input.command === null ? null : parseAccountSuspensionBody({ query, command: input.command }).command;
  if (typeof input.allowRestore !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  const actorId = attendanceSelfUuid(input.authUserId), fingerprint = command ? await accountSuspensionCommandFingerprint(query.siteId, command) : null;
  const response = await service.rpc("faolla_attendance_account_suspensions_v1", { p_query: query, p_auth_user_id: actorId, p_command: command, p_allow_restore: input.allowRestore });
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(ACCOUNT_SUSPENSION_ERRORS, code) ? code : "attendance_unavailable"); }
  const result = parseAccountSuspensionResult(response.data, query, actorId, command);
  if (command && (!result.receipt || !accountSuspensionReceiptMatches(result.receipt, command, fingerprint!))) throw new MerchantAttendanceError("attendance_account_suspension_invalid");
  return result;
}
