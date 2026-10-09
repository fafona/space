import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { OPERATIONAL_PUNCH_ACTIVATION_ERRORS, parseOperationalPunchActivationBody, parseOperationalPunchActivationQuery, parseOperationalPunchActivationResult,
  type OperationalPunchActivationQuery, type OperationalPunchActivationCommand } from "./merchantAttendanceOperationalPunchActivation";
export function operationalPunchEnabled(siteId: string) { if (process.env.FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_ENABLED !== "1") return false;
  const ids = process.env.FAOLLA_ATTENDANCE_OPERATIONAL_PUNCH_SITE_IDS ?? "", list = ids.split(","); return ids.length <= 899 && list.length <= 100 && list.every(id => id.length === 8 && /^[0-9]{8}$/.test(id)) && list.includes(siteId); }
export async function executeOperationalPunchActivation(input: { query: OperationalPunchActivationQuery; command: OperationalPunchActivationCommand | null; authUserId: string; allowActivate: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseOperationalPunchActivationQuery(input.query), command = input.command === null ? null : parseOperationalPunchActivationBody({ query, command: input.command }).command, actor = attendanceSelfUuid(input.authUserId);
  if (typeof input.allowActivate !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request"); if (!service) throw new MerchantAttendanceError("attendance_operational_punch_invalid");
  let response; try { response = await service.rpc("faolla_attendance_operational_punch_activation_v1", { p_query: query, p_auth_user_id: actor, p_command: command, p_allow_activate: input.allowActivate }); } catch { throw new MerchantAttendanceError("attendance_operational_punch_invalid"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(OPERATIONAL_PUNCH_ACTIVATION_ERRORS, code) ? code : "attendance_operational_punch_invalid"); }
  const result = await parseOperationalPunchActivationResult(response.data, query, actor, command); if (!input.allowActivate && result.canActivate) throw new MerchantAttendanceError("attendance_operational_punch_invalid"); return result;
}
