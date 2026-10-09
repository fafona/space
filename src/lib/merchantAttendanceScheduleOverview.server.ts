import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseScheduleOverviewQuery, parseScheduleOverviewResult, SCHEDULE_OVERVIEW_ERRORS, type ScheduleOverviewQuery } from "./merchantAttendanceScheduleOverview";
export async function executeScheduleOverview(input: { query: ScheduleOverviewQuery; authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseScheduleOverviewQuery(input.query), authUserId = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_schedule_overview_v1", { p_query: query, p_auth_user_id: authUserId }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(SCHEDULE_OVERVIEW_ERRORS, code) ? code : "attendance_unavailable"); }
  try { const result = parseScheduleOverviewResult(response.data, query); if (result.ownerId !== authUserId) throw Error("owner_mismatch"); return result; }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
