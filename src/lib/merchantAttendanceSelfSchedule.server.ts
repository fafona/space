import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceClockRpcName } from "./merchantAttendanceRuleBindingDispatch.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseSelfScheduleBody, parseSelfScheduleQuery, parseSelfScheduleResult, SELF_SCHEDULE_ERRORS, type SelfScheduleParseInput } from "./merchantAttendanceSelfSchedule";

type Environment = Readonly<Record<string, string | undefined>>;
export function attendanceSelfScheduleEnabled(siteId: string, env: Environment = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_SELF_SCHEDULE_ENABLED !== "1" || siteId.length !== 8 || !/^\d{8}$/.test(siteId)) return false;
  const raw = env.FAOLLA_ATTENDANCE_SELF_SCHEDULE_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim());
  return sites.length <= 100 && sites.every(s => s.length === 8 && /^\d{8}$/.test(s)) && sites.includes(siteId);
}
export function attendanceSelfScheduleBindRules(siteId: string): boolean {
  return attendanceClockRpcName("self", siteId) === "faolla_attendance_self_bound_v1";
}
export type AttendanceSelfScheduleInput = SelfScheduleParseInput & { authUserId: string; allowWrite: boolean; bindRules: boolean };
export async function executeAttendanceSelfSchedule(input: AttendanceSelfScheduleInput,
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  if (input.command) {
    parseSelfScheduleBody({ siteId: input.siteId, command: input.command, selection: input.selection ?? null });
    if (input.operationId !== null) throw new MerchantAttendanceError("attendance_invalid_request");
    if (!input.allowWrite) throw new MerchantAttendanceError("attendance_self_schedule_disabled");
  } else {
    const query = new URLSearchParams({ siteId: input.siteId }); if (input.operationId !== null) query.set("operationId", input.operationId);
    parseSelfScheduleQuery(`https://local.invalid/?${query}`);
    if (input.selection != null) throw new MerchantAttendanceError("attendance_invalid_request");
  }
  const response = await service.rpc("faolla_attendance_self_schedule_v1", {
    p_site_id: input.siteId, p_auth_user_id: input.authUserId, p_command: input.command,
    p_selection: input.selection ?? null, p_operation_id: input.operationId,
    p_allow_write: input.allowWrite, p_bind_rules: input.bindRules,
  });
  if (response.error) {
    const message = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(SELF_SCHEDULE_ERRORS, message) ? message : "attendance_unavailable");
  }
  // GET carries no choice. Its SQL null parameter is not an assertion that the
  // original operation chose none; only the pending client knows that choice.
  const parseInput = input.command ? input : { siteId: input.siteId, command: null, operationId: input.operationId };
  try { return parseSelfScheduleResult(response.data, parseInput); }
  catch { throw new MerchantAttendanceError("attendance_self_schedule_invalid"); }
}
