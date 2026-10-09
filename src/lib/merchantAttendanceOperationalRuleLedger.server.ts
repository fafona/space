// 240: no impersonation, no adoption into existing attendance writers.
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { OPERATIONAL_RULE_LEDGER_ERRORS, parseOperationalRuleLedgerBody, parseOperationalRuleLedgerQuery, parseOperationalRuleLedgerResult,
  type OperationalRuleLedgerCommand, type OperationalRuleLedgerQuery } from "./merchantAttendanceOperationalRuleLedger";
export async function executeOperationalRuleLedger(input: { query: OperationalRuleLedgerQuery; command: OperationalRuleLedgerCommand | null; authUserId: string; allowWrite: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_operational_rule_invalid");
  const query = parseOperationalRuleLedgerQuery(input.query), command = input.command === null ? null : parseOperationalRuleLedgerBody({ query, command: input.command }).command;
  const actorId = attendanceSelfUuid(input.authUserId); if (typeof input.allowWrite !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  const response = await service.rpc("faolla_attendance_operational_rules_v1", { p_query: query, p_auth_user_id: actorId, p_command: command, p_allow_write: input.allowWrite });
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(OPERATIONAL_RULE_LEDGER_ERRORS, code) ? code : "attendance_operational_rule_invalid"); }
  const result = await parseOperationalRuleLedgerResult(response.data, query, actorId, command);
  if (!input.allowWrite && result.canWrite) throw new MerchantAttendanceError("attendance_operational_rule_invalid"); return result;
}
