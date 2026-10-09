import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseRuleSourcesQuery, parseRuleSourcesResult, RULE_SOURCES_ERRORS, type RuleSourcesQuery } from "./merchantAttendanceRuleSources";

// One dedicated, read-only RPC. Do not join separately authorized HTTP pages or
// imply a frozen snapshot of punches, schedules, leave or payroll from this read.
export async function executeRuleSources(input: { query: RuleSourcesQuery; authUserId: string },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<unknown> {
  const query = parseRuleSourcesQuery(input.query), actor = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_rule_sources_v1", { p_query: query, p_auth_user_id: actor }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(RULE_SOURCES_ERRORS, code) ? code : "attendance_unavailable");
  }
  try { parseRuleSourcesResult(response.data, query, actor); }
  catch { throw new MerchantAttendanceError("attendance_rule_sources_invalid"); }
  // Return validated wire data, not the normalized tree with derived warnings
  // and assignment boundaries; callers parse exactly the same raw contract.
  return response.data;
}
