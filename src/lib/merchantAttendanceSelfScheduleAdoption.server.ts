import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceSelfScheduleEnabled, attendanceSelfScheduleBindRules } from "./merchantAttendanceSelfSchedule.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseSelfScheduleAdoptionBody, parseSelfScheduleAdoptionQuery, parseSelfScheduleAdoptionResult,
  SELF_SCHEDULE_ADOPTION_ERRORS, type SelfScheduleAdoptionParseInput, type SelfScheduleAdoptionResult } from "./merchantAttendanceSelfScheduleAdoption";

type Environment = Readonly<Record<string, string | undefined>>;
export function attendanceSelfScheduleAdoptionEnabled(siteId: string, env: Environment = process.env): boolean {
  if (!attendanceSelfScheduleEnabled(siteId, env) || env.FAOLLA_ATTENDANCE_SELF_SCHEDULE_ADOPTION_ENABLED !== "1") return false;
  const raw = env.FAOLLA_ATTENDANCE_SELF_SCHEDULE_ADOPTION_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim());
  return sites.length <= 100 && sites.every(s => s.length === 8 && /^\d{8}$/.test(s)) && sites.includes(siteId);
}
export const attendanceSelfScheduleAdoptionBindRules = attendanceSelfScheduleBindRules;
export type AttendanceSelfScheduleAdoptionInput = SelfScheduleAdoptionParseInput & {
  authUserId: string; moduleEnabled: boolean; allowWrite: boolean; bindRules: boolean;
};
/** New endpoint and intent only. Never upgrade/replay an existing137 intent
 * through144, and never compensate for failure by calling137 separately. */
export async function executeAttendanceSelfScheduleAdoption(input: AttendanceSelfScheduleAdoptionInput,
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<SelfScheduleAdoptionResult> {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const authUserId = attendanceSelfUuid(input.authUserId);
  if ([input.moduleEnabled, input.allowWrite, input.bindRules].some(v => typeof v !== "boolean")) throw new MerchantAttendanceError("attendance_invalid_request");
  let expected: SelfScheduleAdoptionParseInput;
  if (input.command !== null) {
    if (input.operationId !== null || !Object.hasOwn(input, "selection") || input.selection === undefined) throw new MerchantAttendanceError("attendance_invalid_request");
    const body = parseSelfScheduleAdoptionBody({ siteId: input.siteId, command: input.command, selection: input.selection });
    if (!input.moduleEnabled) throw new MerchantAttendanceError("attendance_platform_paused");
    if (!input.allowWrite) throw new MerchantAttendanceError("attendance_self_schedule_adoption_disabled");
    expected = { ...body, operationId: null, authUserId };
  } else {
    if (input.selection !== undefined) throw new MerchantAttendanceError("attendance_invalid_request");
    const query = new URLSearchParams({ siteId: input.siteId }); if (input.operationId !== null) query.set("operationId", input.operationId);
    expected = { ...parseSelfScheduleAdoptionQuery(`https://local.invalid/?${query}`), command: null, authUserId };
  }
  let response: Awaited<ReturnType<AttendanceSelfRpc["rpc"]>>;
  try { response = await service.rpc("faolla_attendance_self_schedule_adoption_v1", {
    p_site_id: expected.siteId, p_auth_user_id: authUserId, p_command: expected.command,
    p_selection: expected.command ? expected.selection ?? null : null, p_operation_id: expected.operationId,
    p_allow_write: input.moduleEnabled && input.allowWrite, p_bind_rules: input.bindRules,
  }); } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(SELF_SCHEDULE_ADOPTION_ERRORS, code) ? code : "attendance_unavailable");
  }
  return parseSelfScheduleAdoptionResult(response.data, expected);
}
