// 194: real-self transport only. Never substitutes an owner or bypasses an old
// submit check; SQL owns the atomic old application + immutable window proof.
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseApplicationWindowQuery, parseApplicationWindowCommand, parseApplicationWindowRpcResult, applicationWindowErrors,
  type ApplicationWindowQuery, type ApplicationWindowCommand, type ApplicationWindowFamily } from "./merchantAttendanceApplicationWindow";
export type ApplicationWindowServiceInput = { query: ApplicationWindowQuery; command: ApplicationWindowCommand | null; authUserId: string; allowWrite: boolean };
export function applicationWindowEnabled(siteId: string, family: ApplicationWindowFamily): boolean {
  if (process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED !== "1") return false;
  const text = process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_SITE_IDS ?? "", ids = text.split(",");
  if (text.length > 899 || ids.length > 100 || ids.some(id => id.length !== 8 || !/^[0-9]{8}$/.test(id)) || !ids.includes(siteId)) return false;
  if (family === "missing" || family === "missing_revision") return process.env.FAOLLA_ATTENDANCE_MISSING_ENABLED === "1";
  if (process.env.FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED !== "1" || process.env.FAOLLA_ATTENDANCE_SELF_ENABLED !== "1") return false;
  return family === "correction" || family === "correction_revision" && process.env.FAOLLA_ATTENDANCE_REVISION_REQUESTS_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_REVISION_CYCLES_ENABLED === "1";
}
export async function executeApplicationWindow(input: ApplicationWindowServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseApplicationWindowQuery(input.query), command = input.command === null ? null : parseApplicationWindowCommand(input.command, query), authUserId = input.authUserId;
  if (typeof input.allowWrite !== "boolean" || typeof authUserId !== "string" || authUserId.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(authUserId)) throw new MerchantAttendanceError("attendance_invalid_request");
  if (!service) throw new MerchantAttendanceError("attendance_application_window_invalid"); let response;
  try { response = await service.rpc("faolla_attendance_application_window_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite }); }
  catch { throw new MerchantAttendanceError("attendance_application_window_invalid"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(applicationWindowErrors(query.family), code) ? code : "attendance_application_window_invalid"); }
  return parseApplicationWindowRpcResult(response.data, { query, command, authUserId, allowWrite: input.allowWrite });
}
