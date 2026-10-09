import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parsePlanRuleApprovalsQuery, parsePlanRuleApprovalsBody, parsePlanRuleApprovalsResult,
  PLAN_RULE_APPROVALS_ERRORS, type PlanRuleApprovalsQuery, type PlanRuleApprovalsCommand } from "./merchantAttendancePlanRuleApprovals";

// The single RPC rereads candidate facts under retained locks. Its archive reader
// verifies the saved JSONB bytes/hash; no browser-provided rule values are used.
export async function executePlanRuleApprovals(input: { query: PlanRuleApprovalsQuery; authUserId: string;
  command?: PlanRuleApprovalsCommand | null; moduleEnabled?: boolean },
service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<unknown> {
  const query = parsePlanRuleApprovalsQuery(input.query);
  const command = input.command == null ? null : parsePlanRuleApprovalsBody({ query, command: input.command }).command;
  if ((query.mode === "approve") !== (command !== null)) throw new MerchantAttendanceError("attendance_invalid_request");
  const authUserId = attendanceSelfUuid(input.authUserId), moduleEnabled = input.moduleEnabled ?? false;
  if (typeof moduleEnabled !== "boolean" || !service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_plan_rule_approvals_v1", {
    p_query: query, p_auth_user_id: authUserId, p_command: command, p_module_enabled: moduleEnabled,
  }); } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(PLAN_RULE_APPROVALS_ERRORS, code) ? code : "attendance_unavailable");
  }
  return parsePlanRuleApprovalsResult(response.data, query, authUserId, command);
}
