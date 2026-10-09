import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseLeaveQuery, parseLeaveBody, parseLeaveResult, LEAVE_ERRORS, type LeaveQuery, type LeaveCommand } from "./merchantAttendanceLeave";
export async function executeLeave(input: { query: LeaveQuery; command: LeaveCommand | null; authUserId: string; allowWrite: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseLeaveQuery(input.query), command = input.command === null ? null : parseLeaveBody({ query, command: input.command }).command;
  const authUserId = attendanceSelfUuid(input.authUserId);
  if (typeof input.allowWrite !== "boolean" || !service) throw new MerchantAttendanceError("attendance_unavailable");
  // Opt-in local candidate: only fresh owner decisions can atomically produce a
  // notification. The wrapper itself distinguishes new writes from old replays.
  const notify = process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED === "1"
    && query.access === "owner" && command !== null && ["approve", "reject", "cancel"].includes(command.action);
  let response;
  try { response = await service.rpc(notify ? "faolla_attendance_leave_notify_v1" : "faolla_attendance_leave_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(LEAVE_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseLeaveResult(response.data, query, command, authUserId); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
