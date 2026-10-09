import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseScheduleBody, parseScheduleQuery, parseScheduleResult, scheduleQueryString, SCHEDULE_ERRORS, type ScheduleCommand, type ScheduleQuery } from "./merchantAttendanceSchedule";
import { attendanceSchedulePublicationRpcName } from "./merchantAttendanceSchedulePublicationDispatch.server";
import { eventNotificationsEnabled } from "./merchantAttendanceEventNotifications.server";

export async function executeAttendanceSchedule(input: { query: ScheduleQuery; command: ScheduleCommand | null; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const query = parseScheduleQuery(`https://local.invalid/?${scheduleQueryString(input.query)}`);
  const command = input.command ? parseScheduleBody({ query, command: input.command }).command : null;
  const originalRpc = attendanceSchedulePublicationRpcName(query.siteId, command?.action ?? null);
  const capture = query.access === "owner" && command !== null && eventNotificationsEnabled(query.siteId, "capture");
  const result = await service.rpc(capture ? "faolla_attendance_schedule_event_v1" : originalRpc, { p_query: query, p_auth_user_id: attendanceSelfUuid(input.authUserId), p_command: command, p_allow_write: input.allowWrite,
    ...(capture ? { p_capture_publication_evidence: originalRpc === "faolla_attendance_schedule_evidenced_v1" } : {}) });
  if (result.error) { const code = result.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(SCHEDULE_ERRORS, code) ? code : "attendance_unavailable"); }
  try {
    const response = parseScheduleResult(result.data, { ...query, operationId: command?.operationId ?? query.operationId }, false);
    if (command && (!response.receipt || JSON.stringify(response.receipt.command) !== JSON.stringify(command))) throw Error("receipt_mismatch");
    return response;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
