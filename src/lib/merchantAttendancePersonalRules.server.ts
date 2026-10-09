import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parsePersonalRulesQuery, parsePersonalRulesBody, parsePersonalRulesResult, PERSONAL_RULES_ERRORS,
  type PersonalRulesQuery, type PersonalRulesCommand } from "./merchantAttendancePersonalRules";

// A separate candidate ledger: this service never applies rules to clock facts.
export async function executePersonalRules(input: {
  query: PersonalRulesQuery; command: PersonalRulesCommand | null; authUserId: string; allowWrite: boolean;
}, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parsePersonalRulesQuery(input.query);
  const command = input.command === null ? null : parsePersonalRulesBody({ query, command: input.command }).command;
  const authUserId = attendanceSelfUuid(input.authUserId);
  if (typeof input.allowWrite !== "boolean" || !service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try {
    response = await service.rpc("faolla_attendance_personal_rules_v1", {
      p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite,
    });
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(PERSONAL_RULES_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { return parsePersonalRulesResult(response.data, query, command, authUserId); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
