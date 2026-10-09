import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseGroupsQuery, parseGroupsBody, parseGroupsResult, GROUPS_ERRORS, type GroupsQuery, type GroupsCommand } from "./merchantAttendanceGroups";
export async function executeGroups(input: { query: GroupsQuery; command: GroupsCommand | null; authUserId: string; allowWrite: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseGroupsQuery(input.query), command = input.command === null ? null : parseGroupsBody({ query, command: input.command }).command;
  const authUserId = attendanceSelfUuid(input.authUserId);
  if (typeof input.allowWrite !== "boolean" || !service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_groups_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(GROUPS_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseGroupsResult(response.data, query, command, authUserId); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
