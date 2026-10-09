import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseCalendarQuery, parseCalendarBody, parseCalendarResult, CALENDAR_ERRORS, type CalendarQuery, type CalendarCommand } from "./merchantAttendanceCalendar";
export async function executeCalendar(input: { query: CalendarQuery; command: CalendarCommand | null; authUserId: string; allowWrite: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseCalendarQuery(input.query), command = input.command === null ? null : parseCalendarBody({ query, command: input.command }).command;
  const authUserId = attendanceSelfUuid(input.authUserId);
  if (typeof input.allowWrite !== "boolean" || !service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_calendar_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(CALENDAR_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseCalendarResult(response.data, query, command, authUserId); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
