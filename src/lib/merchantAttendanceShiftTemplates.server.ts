import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseShiftTemplatesQuery, parseShiftTemplatesBody, parseShiftTemplatesResult, SHIFT_TEMPLATE_ERRORS, type ShiftTemplatesQuery, type ShiftTemplateCommand } from "./merchantAttendanceShiftTemplates";
export async function executeShiftTemplates(input: { query: ShiftTemplatesQuery; command: ShiftTemplateCommand | null; authUserId: string; allowWrite: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseShiftTemplatesQuery(input.query), command = input.command === null ? null : parseShiftTemplatesBody({ query, command: input.command }).command;
  // Body parsing must not include server-supplied authentication or write authority.
  const authUserId = attendanceSelfUuid(input.authUserId);
  if (typeof input.allowWrite !== "boolean" || !service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_shift_templates_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(SHIFT_TEMPLATE_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parseShiftTemplatesResult(response.data, query, command); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
