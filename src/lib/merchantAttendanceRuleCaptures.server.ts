import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseRuleCapturesQuery, parseRuleCapturesBody, parseRuleCapturesResult, RULE_CAPTURES_ERRORS,
  type RuleCapturesQuery, type RuleCapturesCommand } from "./merchantAttendanceRuleCaptures";

// Only the dedicated capture RPC can create its immutable, server-read source.
// No client source JSON, old report/writer RPC, timezone replay or resolution.
export async function executeRuleCaptures(input: { query: RuleCapturesQuery; authUserId: string;
  command?: RuleCapturesCommand | null; moduleEnabled?: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<unknown> {
  const query = parseRuleCapturesQuery(input.query), command = input.command == null ? null : parseRuleCapturesBody({ query, command: input.command }).command;
  const authUserId = attendanceSelfUuid(input.authUserId), moduleEnabled = input.moduleEnabled === undefined ? false : input.moduleEnabled;
  if (typeof moduleEnabled !== "boolean" || !service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_rule_captures_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_module_enabled: moduleEnabled }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(RULE_CAPTURES_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { parseRuleCapturesResult(response.data, query, command, authUserId); }
  catch { throw new MerchantAttendanceError("attendance_rule_capture_invalid"); }
  return response.data;
}
