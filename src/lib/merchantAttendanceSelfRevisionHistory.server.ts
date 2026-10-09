import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseSelfRevisionHistoryQuery, parseSelfRevisionHistoryResult, SELF_REVISION_HISTORY_ERRORS, type SelfRevisionHistoryQuery } from "./merchantAttendanceSelfRevisionHistory";
export type SelfRevisionHistoryInput = { query: SelfRevisionHistoryQuery; authUserId: string };
export async function executeSelfRevisionHistory(input: SelfRevisionHistoryInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const q = parseSelfRevisionHistoryQuery(input.query), { siteId, ...query } = q;
  const authUserId = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_self_revision_history_v1", { p_site_id: siteId, p_auth_user_id: authUserId, p_query: query }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(SELF_REVISION_HISTORY_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseSelfRevisionHistoryResult(response.data, q); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
