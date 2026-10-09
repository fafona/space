import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { CORRECTION_DELEGATION_ERRORS, parseCorrectionDelegationQuery, parseCorrectionDelegationBody, parseCorrectionDelegationResult,
  correctionDelegationCommandFingerprint, correctionDelegationReceiptMatches, type CorrectionDelegationQuery, type CorrectionDelegationCommand } from "./merchantAttendanceCorrectionDelegation";

export async function executeCorrectionDelegation(input: { query: CorrectionDelegationQuery; command: CorrectionDelegationCommand | null; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const query = parseCorrectionDelegationQuery(input.query), command = input.command === null ? null : parseCorrectionDelegationBody({ query, command: input.command }).command;
  if (typeof input.allowWrite !== "boolean" || query.mode === "decide" && !command) throw new MerchantAttendanceError("attendance_invalid_request");
  const authUserId = attendanceSelfUuid(input.authUserId);
  const fingerprint = command ? await correctionDelegationCommandFingerprint(query.siteId, query.access, command) : null;
  const r = await service.rpc(query.access === "owner" ? "faolla_attendance_correction_delegations_v1" : "faolla_attendance_delegated_corrections_v1",
    { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite });
  if (r.error) { const code = r.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(CORRECTION_DELEGATION_ERRORS, code) ? code : "attendance_unavailable"); }
  const result = parseCorrectionDelegationResult(r.data, query, { authUserId }, command);
  if (!input.allowWrite && result.canWrite) throw new MerchantAttendanceError("attendance_correction_delegation_invalid");
  if (command && (!result.receipt || !correctionDelegationReceiptMatches(result.receipt, command, fingerprint!))) throw new MerchantAttendanceError("attendance_correction_delegation_invalid");
  return result;
}
