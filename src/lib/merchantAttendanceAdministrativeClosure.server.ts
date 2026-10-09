// 195: actual authenticated actor only. SQL owns current-owner/self binding,
// source locks, the case CAS, and atomic append-only administrative evidence.
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ADMINISTRATIVE_CLOSURE_ERRORS, parseAdministrativeClosureQuery, parseAdministrativeClosureBody, parseAdministrativeClosureResult,
  type AdministrativeClosureQuery, type AdministrativeClosureCommand } from "./merchantAttendanceAdministrativeClosure";

export type AdministrativeClosureServiceInput = { query: AdministrativeClosureQuery; command: AdministrativeClosureCommand | null; authUserId: string; allowClose: boolean };
export function administrativeClosureEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (typeof siteId !== "string" || siteId.length !== 8 || !/^[0-9]{8}$/.test(siteId) || env.FAOLLA_ATTENDANCE_ADMINISTRATIVE_CLOSURES_ENABLED !== "1") return false;
  const raw = env.FAOLLA_ATTENDANCE_ADMINISTRATIVE_CLOSURES_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 899) return false;
  const ids = raw.split(","); return ids.length <= 100 && new Set(ids).size === ids.length && ids.every(id => id.length === 8 && /^[0-9]{8}$/.test(id)) && ids.includes(siteId);
}
export async function executeAdministrativeClosure(input: AdministrativeClosureServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseAdministrativeClosureQuery(input.query), command = input.command === null ? null : parseAdministrativeClosureBody({ query, command: input.command }).command;
  const authUserId = input.authUserId;
  if (typeof input.allowClose !== "boolean" || typeof authUserId !== "string" || authUserId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(authUserId)) throw new MerchantAttendanceError("attendance_invalid_request");
  if (!service) throw new MerchantAttendanceError("attendance_administrative_closure_invalid");
  let response;
  try { response = await service.rpc("faolla_attendance_administrative_closures_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_close: input.allowClose }); }
  catch { throw new MerchantAttendanceError("attendance_administrative_closure_invalid"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(ADMINISTRATIVE_CLOSURE_ERRORS, code) ? code : "attendance_administrative_closure_invalid"); }
  return parseAdministrativeClosureResult(response.data, query, authUserId, command);
}
