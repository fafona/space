import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { uuid } from "./merchantAttendancePlanExceptionValidation";
import { outageSiteEnabled } from "./merchantAttendanceOutage.server";
import { OUTAGE_SUBJECT_ERRORS, parseOutageSubjectQuery, parseOutageSubjectResult, type OutageSubjectQuery } from "./merchantAttendanceOutageSubject";

export async function executeOutageSubject(input: { query: OutageSubjectQuery; authUserId: string; moduleEnabled?: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseOutageSubjectQuery(input.query);
  let authUserId: string;
  try { authUserId = uuid(input.authUserId); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
  const moduleEnabled = input.moduleEnabled ?? false;
  if (typeof moduleEnabled !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_outage_subject_v1", { p_query: query, p_auth_user_id: authUserId,
    p_allow_write: moduleEnabled && outageSiteEnabled(query.siteId) }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(OUTAGE_SUBJECT_ERRORS, code) ? code : "attendance_unavailable");
  }
  return parseOutageSubjectResult(response.data, query, authUserId);
}
