import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { eventNotificationsEnabled } from "./merchantAttendanceEventNotifications.server";
import { parseWorkArrangementQuery, parseWorkArrangementBody, parseWorkArrangementResult, WORK_ARRANGEMENT_ERRORS,
  type WorkArrangementQuery, type WorkArrangementCommand } from "./merchantAttendanceWorkArrangement";

export async function executeWorkArrangement(input: { query: WorkArrangementQuery; command: WorkArrangementCommand | null;
  authUserId: string; allowWrite: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseWorkArrangementQuery(input.query), command = input.command === null ? null : parseWorkArrangementBody({ query, command: input.command }).command;
  const authUserId = attendanceSelfUuid(input.authUserId);
  if (!service || typeof input.allowWrite !== "boolean" || authUserId !== input.authUserId) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  const capture = query.access === "owner" && command !== null && ["approve", "reject", "cancel"].includes(command.action) && eventNotificationsEnabled(query.siteId, "capture");
  try { response = await service.rpc(capture ? "faolla_attendance_work_arrangement_event_v1" : "faolla_attendance_work_arrangement_v1", {
    p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite,
  }); } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(WORK_ARRANGEMENT_ERRORS, code) ? code : "attendance_unavailable"); }
  return parseWorkArrangementResult(response.data, query, command, { authUserId });
}
