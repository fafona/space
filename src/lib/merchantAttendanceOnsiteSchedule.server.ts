import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceClockRpcName } from "./merchantAttendanceRuleBindingDispatch.server";
import { verifyOnsiteToken } from "./merchantAttendanceOnsiteQr.server";
import type { OnsiteClaims } from "./merchantAttendanceOnsiteQr";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseOnsiteScheduleBody, parseOnsiteScheduleQuery, parseOnsiteScheduleResult, ONSITE_SCHEDULE_ERRORS,
  type OnsiteScheduleParseInput, type OnsiteScheduleResult } from "./merchantAttendanceOnsiteSchedule";

type Environment = Readonly<Record<string, string | undefined>>;
export function attendanceOnsiteScheduleEnabled(siteId: string, env: Environment = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_ONSITE_SCHEDULE_ENABLED !== "1" || !/^\d{8}$/.test(siteId)) return false;
  const raw = env.FAOLLA_ATTENDANCE_ONSITE_SCHEDULE_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim());
  return sites.length <= 100 && sites.every(s => /^\d{8}$/.test(s)) && sites.includes(siteId);
}
export function attendanceOnsiteScheduleBindRules(siteId: string): boolean {
  return attendanceClockRpcName("onsite", siteId) === "faolla_attendance_onsite_clock_bound_v1";
}
export type AttendanceOnsiteScheduleInput = OnsiteScheduleParseInput & {
  authUserId: string; token: string | null; moduleEnabled: boolean; allowWrite: boolean; bindRules: boolean;
};

/** Keep the original HMAC verifier and the 108/134 SQL clock as authorities.
 * The sole RPC adds relation/adoption in that same event + nonce transaction.
 * GET never authenticates or receives a QR; its choices are planning hints. */
export async function executeAttendanceOnsiteSchedule(input: AttendanceOnsiteScheduleInput,
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<OnsiteScheduleResult> {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const authUserId = attendanceSelfUuid(input.authUserId);
  if ([input.moduleEnabled, input.allowWrite, input.bindRules].some(v => typeof v !== "boolean")) throw new MerchantAttendanceError("attendance_invalid_request");
  let claims: OnsiteClaims | null = null;
  let expected: OnsiteScheduleParseInput;
  if (input.command !== null) {
    if (input.operationId !== null || !Object.hasOwn(input, "selection") || input.selection === undefined) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = parseOnsiteScheduleBody({ siteId: input.siteId, token: input.token, command: input.command, selection: input.selection });
    if (!input.moduleEnabled) throw new MerchantAttendanceError("attendance_platform_paused");
    if (!input.allowWrite) throw new MerchantAttendanceError("attendance_onsite_schedule_disabled");
    claims = verifyOnsiteToken(parsed.token);
    if (claims.siteId !== parsed.siteId || claims.locationId !== parsed.command.locationId) throw new MerchantAttendanceError("attendance_qr_invalid");
    expected = { siteId: parsed.siteId, operationId: null, command: parsed.command, selection: parsed.selection, authUserId };
  } else {
    if (input.token !== null || input.selection !== undefined) throw new MerchantAttendanceError("attendance_invalid_request");
    const query = new URLSearchParams({ siteId: input.siteId });
    if (input.operationId !== null) query.set("operationId", input.operationId);
    expected = { ...parseOnsiteScheduleQuery(`https://local.invalid/?${query}`), command: null, authUserId };
  }
  let result: Awaited<ReturnType<AttendanceSelfRpc["rpc"]>>;
  try {
    result = await service.rpc("faolla_attendance_onsite_schedule_v1", {
      p_site: expected.siteId, p_auth: authUserId, p_claims: claims, p_command: expected.command, p_operation: expected.operationId,
      p_allow_new: input.moduleEnabled, p_selection: expected.command ? expected.selection ?? null : null,
      p_allow_schedule: input.allowWrite, p_bind_rules: input.bindRules,
    });
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(ONSITE_SCHEDULE_ERRORS, code) ? code : "attendance_unavailable");
  }
  return parseOnsiteScheduleResult(result.data, expected);
}
