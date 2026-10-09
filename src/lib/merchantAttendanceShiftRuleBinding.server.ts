import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseShiftRuleBindingQuery, parseShiftRuleBindingResult, SHIFT_RULE_BINDING_ERRORS, type ShiftRuleBindingQuery } from "./merchantAttendanceShiftRuleBinding";

// Exact one-event read only. No fallback collector, archive writer or backfill.
export async function executeShiftRuleBinding(input: { query: ShiftRuleBindingQuery; authUserId: string },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<unknown> {
  const query = parseShiftRuleBindingQuery(input.query), authUserId = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_shift_rule_binding_v1", { p_query: query, p_auth_user_id: authUserId }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(SHIFT_RULE_BINDING_ERRORS, code) ? code : "attendance_unavailable");
  }
  return parseShiftRuleBindingResult(response.data, query, authUserId);
}
