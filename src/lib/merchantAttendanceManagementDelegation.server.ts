//202 owner foundation only. SQL owns original-receipt recovery, current-owner
//authorization, identity/generation checks and append. No family executor.
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MANAGEMENT_DELEGATION_ERRORS, parseManagementDelegationQuery, parseManagementDelegationBody,
  parseManagementDelegationResult, type ManagementDelegationQuery, type ManagementDelegationCommand } from "./merchantAttendanceManagementDelegation";

export const MANAGEMENT_DELEGATION_RPC = "faolla_attendance_management_delegations_v1";
export function managementDelegationSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env.FAOLLA_ATTENDANCE_MANAGEMENT_DELEGATIONS_SITE_IDS;
  if (env.FAOLLA_ATTENDANCE_MANAGEMENT_DELEGATIONS_ENABLED !== "1" || !/^[0-9]{8}$/.test(siteId) || typeof value !== "string" || value.length > 575) return false;
  const sites = value.split(","); return sites.length <= 64 && new Set(sites).size === sites.length
    && sites.every(s => /^[0-9]{8}$/.test(s)) && sites.includes(siteId);
}
export async function executeManagementDelegation(input: Readonly<{ query: ManagementDelegationQuery;
  command?: ManagementDelegationCommand | null; authUserId: string; allowGrant?: boolean; signal?: AbortSignal }>,
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseManagementDelegationQuery(input.query), authUserId = attendanceSelfUuid(input.authUserId);
  const command = input.command == null ? null : parseManagementDelegationBody({ query, command: input.command }).command;
  const allowGrant = input.allowGrant ?? false;
  if (typeof allowGrant !== "boolean" || (query.mode === "write") !== (command !== null)) throw new MerchantAttendanceError("attendance_invalid_request");
  const guard = () => { if (input.signal?.aborted) throw new MerchantAttendanceError("attendance_unavailable"); }; guard();
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let result;
  try { result = await service.rpc(MANAGEMENT_DELEGATION_RPC, { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_grant: allowGrant }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  guard();
  if (result.error) { const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(MANAGEMENT_DELEGATION_ERRORS, code) ? code : "attendance_unavailable"); }
  const projected = await parseManagementDelegationResult(result.data, query, authUserId, command); guard();
  if (!allowGrant && (projected.kind === "list" || projected.kind === "detail") && projected.canGrant) throw new MerchantAttendanceError("attendance_management_delegation_invalid");
  return projected;
}
