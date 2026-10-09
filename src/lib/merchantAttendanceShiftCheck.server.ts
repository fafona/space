import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { projectShiftRuleView } from "./merchantAttendanceShiftRuleView.server";
import { parseShiftCheckQuery, parseShiftCheckData, parseShiftCheckResponse, validateShiftCheckTree, SHIFT_CHECK_ERRORS,
  type ShiftCheckQuery, type ShiftCheckData } from "./merchantAttendanceShiftCheck";

// The only database call supplies all sources under the same owner/settings
// locks. Full frozen source text is verified here, never sent to the browser.
export function projectShiftCheck(raw: unknown, input: ShiftCheckQuery, actorId: string): ShiftCheckData {
  const query = parseShiftCheckQuery(input);
  try {
    validateShiftCheckTree(raw);
    const v = captureBrowserExact(raw, ["protocol", "binding", "asOf", "events", "effect", "relation"]);
    if (v.protocol !== "shift-check-source-v1") throw new MerchantAttendanceError("attendance_shift_check_invalid");
    const rule = projectShiftRuleView(v.binding, query, actorId);
    const data = parseShiftCheckData({ protocol: "shift-check-v1", algorithmVersion: "single-shift-thresholds-v1", readOnly: true, formalReady: false,
      asOf: v.asOf, rule, events: v.events, effect: v.effect, relation: v.relation }, query, actorId);
    parseShiftCheckResponse({ ok: true, moduleEnabled: false, data }, query, actorId);
    return data;
  } catch (error) {
    if (error instanceof MerchantAttendanceError && error.code === "attendance_shift_check_too_large") throw error;
    throw new MerchantAttendanceError("attendance_shift_check_invalid");
  }
}
export async function executeShiftCheck(input: { query: ShiftCheckQuery; authUserId: string },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<ShiftCheckData> {
  const query = parseShiftCheckQuery(input.query), authUserId = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_shift_check_v1", { p_query: query, p_auth_user_id: authUserId }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(SHIFT_CHECK_ERRORS, code) ? code : "attendance_unavailable");
  }
  return projectShiftCheck(response.data, query, authUserId);
}
