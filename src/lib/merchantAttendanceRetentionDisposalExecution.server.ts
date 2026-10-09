// A local synthetic candidate only. SQL owns current-owner checks, locks,
// dependency coverage and the atomic three-field disposition.
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { uuid } from "./merchantAttendancePlanExceptionValidation";
import { DISPOSAL_EXECUTION_ERRORS, DISPOSAL_LOCAL_SITE, parseDisposalExecutionQuery, parseDisposalExecutionBody, parseDisposalExecutionResult,
  type DisposalExecutionQuery, type DisposalExecutionCommand } from "./merchantAttendanceRetentionDisposalExecution";

export { DISPOSAL_LOCAL_SITE } from "./merchantAttendanceRetentionDisposalExecution";
export type DisposalExecutionServiceInput = { query: DisposalExecutionQuery; command: DisposalExecutionCommand | null; authUserId: string; allowWrite: boolean };
export function disposalExecutionEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return siteId === DISPOSAL_LOCAL_SITE && env.FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_ENABLED === "1"
    && env.FAOLLA_ATTENDANCE_RETENTION_DISPOSAL_SITE_IDS === DISPOSAL_LOCAL_SITE;
}
export async function executeRetentionDisposal(input: DisposalExecutionServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseDisposalExecutionQuery(input.query), command = input.command === null ? null : parseDisposalExecutionBody({ query, command: input.command }).command;
  let actor: string; try { actor = uuid(input.authUserId); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
  if (typeof input.allowWrite !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  if (query.mode !== "recover" && query.siteId !== DISPOSAL_LOCAL_SITE) throw new MerchantAttendanceError("attendance_retention_disposal_disabled");
  if (!service) throw new MerchantAttendanceError("attendance_retention_disposal_invalid");
  let response;
  try { response = await service.rpc("faolla_attendance_retention_disposal_v1", { p_query: query, p_auth_user_id: actor, p_command: command, p_allow_write: input.allowWrite }); }
  catch { throw new MerchantAttendanceError("attendance_retention_disposal_invalid"); }
  if (response.error) { const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(DISPOSAL_EXECUTION_ERRORS, code) ? code : "attendance_retention_disposal_invalid"); }
  return parseDisposalExecutionResult(response.data, query, actor, command);
}
