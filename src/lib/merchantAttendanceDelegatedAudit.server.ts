import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { DELEGATED_AUDIT_ERRORS, delegatedAuditUuid, parseDelegatedAuditQuery, parseDelegatedAuditBody,
  type DelegatedAuditQuery, type DelegatedAuditCommand } from "./merchantAttendanceDelegatedAudit";
import { projectDelegatedAuditSource } from "./merchantAttendanceDelegatedAuditSource.server";

export const DELEGATED_AUDIT_RPC = "faolla_attendance_delegated_audit_v1";
export function delegatedAuditSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env.FAOLLA_ATTENDANCE_DELEGATED_AUDIT_SITE_IDS;
  if (env.FAOLLA_ATTENDANCE_DELEGATED_AUDIT_ENABLED !== "1" || !/^[0-9]{8}$/.test(siteId) || typeof value !== "string" || value.length > 575) return false;
  const sites = value.split(","); return sites.length <= 64 && new Set(sites).size === sites.length && sites.every(id => /^[0-9]{8}$/.test(id)) && sites.includes(siteId);
}
export async function executeDelegatedAudit(input: Readonly<{ query: DelegatedAuditQuery; command?: DelegatedAuditCommand | null;
  authUserId: string; allowAccess?: boolean; signal?: AbortSignal }>, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseDelegatedAuditQuery(input.query), authUserId = delegatedAuditUuid(input.authUserId);
  const command = input.command == null ? null : parseDelegatedAuditBody({ query, command: input.command }).command;
  const allowAccess = input.allowAccess ?? false;
  if (typeof allowAccess !== "boolean" || (query.mode === "export") !== (command !== null)) throw new MerchantAttendanceError("attendance_invalid_request");
  const guard = () => { if (input.signal?.aborted) throw new MerchantAttendanceError("attendance_unavailable"); }; guard();
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let result;
  try { result = await service.rpc(DELEGATED_AUDIT_RPC, { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_access: allowAccess }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  guard(); if (result.error) { const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(DELEGATED_AUDIT_ERRORS, code) ? code : "attendance_unavailable"); }
  const projected = await projectDelegatedAuditSource(result.data, query, authUserId, command); guard();
  if (!allowAccess && projected.kind !== "receipt") throw new MerchantAttendanceError("attendance_delegated_audit_invalid");
  return projected;
}
