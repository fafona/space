import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { CORRECTION_CONTROL_ERRORS, correctionControlQueryString, correctionControlReceiptMatches, parseCorrectionControlCommand,
  parseCorrectionControlQuery, parseCorrectionControlResult, type CorrectionControlCommand, type CorrectionControlQuery } from "./merchantAttendanceCorrectionControls";
export async function executeCorrectionControls(input: { query: CorrectionControlQuery; command: CorrectionControlCommand | null; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const q = parseCorrectionControlQuery(`https://local.invalid/?${correctionControlQueryString(input.query)}`);
  const command = input.command ? parseCorrectionControlCommand({ siteId: q.siteId, ...input.command }).command : null;
  if (command && (q.operationId !== null || q.beforeRevision !== null)) throw new MerchantAttendanceError("attendance_invalid_request");
  const r = await service.rpc("faolla_attendance_correction_controls_v2", { p_site_id: q.siteId, p_auth_user_id: attendanceSelfUuid(input.authUserId),
    p_command: command, p_operation_id: q.operationId, p_before_revision: q.beforeRevision, p_allow_write: input.allowWrite });
  if (r.error) { const code = r.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(CORRECTION_CONTROL_ERRORS, code) ? code : "attendance_unavailable"); }
  try {
    const result = parseCorrectionControlResult(r.data, { ...q, operationId: command?.operationId ?? q.operationId },true);
    if (command && (!result.receipt || !correctionControlReceiptMatches(command, result.receipt))) throw Error("receipt_mismatch");
    return result;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
