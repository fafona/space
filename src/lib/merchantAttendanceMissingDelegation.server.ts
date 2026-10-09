import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MISSING_DELEGATION_ERRORS, parseMissingDelegationQuery, parseMissingDelegationBody, parseMissingDelegationResult,
  missingDelegationCommandFingerprint, missingDelegationReceiptMatches, type MissingDelegationQuery, type MissingDelegationCommand } from "./merchantAttendanceMissingDelegation";

export async function executeMissingDelegation(input: { query: MissingDelegationQuery; command: MissingDelegationCommand | null; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const query = parseMissingDelegationQuery(input.query), command = input.command === null ? null : parseMissingDelegationBody({ query, command: input.command }).command;
  if (typeof input.allowWrite !== "boolean" || query.mode === "decide" && !command) throw new MerchantAttendanceError("attendance_invalid_request");
  const authUserId = attendanceSelfUuid(input.authUserId);
  const fingerprint = command ? await missingDelegationCommandFingerprint(query.siteId, query.access, command) : null;
  const r = await service.rpc(query.access === "owner" ? "faolla_attendance_missing_delegations_v1" : "faolla_attendance_delegated_missing_v1",
    { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite });
  if (r.error) { const code = r.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(MISSING_DELEGATION_ERRORS, code) ? code : "attendance_unavailable"); }
  const result = parseMissingDelegationResult(r.data, query, { authUserId }, command);
  if (command && (!result.receipt || !missingDelegationReceiptMatches(result.receipt, command, fingerprint!))) throw new MerchantAttendanceError("attendance_missing_delegation_invalid");
  return result;
}
