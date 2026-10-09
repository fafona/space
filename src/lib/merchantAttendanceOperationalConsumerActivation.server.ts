import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { reviewRoutingEnabled } from "./merchantAttendanceReviewRouting.server";
import { cycleIntentEnabled } from "./merchantAttendanceCycleIntent.server";
import { attendanceRemindersSiteEnabled } from "./merchantAttendanceReminders.server";
import { OPERATIONAL_CONSUMER_ACTIVATION_ERRORS, parseOperationalConsumerActivationBody, parseOperationalConsumerActivationQuery, parseOperationalConsumerActivationResult,
  type OperationalConsumerActivationQuery, type OperationalConsumerActivationCommand } from "./merchantAttendanceOperationalConsumerActivation";
export function operationalConsumerEnabled(siteId: string, consumer = "application_window") { if (consumer === "reminders") return attendanceRemindersSiteEnabled(siteId); if (consumer === "timesheet_cycle") return cycleIntentEnabled(siteId); if (consumer === "review_routing") return reviewRoutingEnabled(siteId); if (consumer !== "application_window" || process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED !== "1") return false;
  const ids = process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_SITE_IDS ?? "", list = ids.split(","); return ids.length <= 899 && list.length <= 100 && list.every(id => id.length === 8 && /^[0-9]{8}$/.test(id)) && list.includes(siteId); }
export async function executeOperationalConsumerActivation(input: { query: OperationalConsumerActivationQuery; command: OperationalConsumerActivationCommand | null; authUserId: string; allowActivate: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseOperationalConsumerActivationQuery(input.query), command = input.command === null ? null : parseOperationalConsumerActivationBody({ query, command: input.command }).command, actor = attendanceSelfUuid(input.authUserId);
  if (typeof input.allowActivate !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request"); if (!service) throw new MerchantAttendanceError("attendance_operational_consumer_invalid");
  const allowActivate = input.allowActivate && (query.consumer === "application_window" || query.consumer === "review_routing" || query.consumer === "timesheet_cycle" || query.consumer === "reminders");
  let response; try { response = await service.rpc("faolla_attendance_operational_consumer_activation_v1", { p_query: query, p_auth_user_id: actor, p_command: command, p_allow_activate: allowActivate }); } catch { throw new MerchantAttendanceError("attendance_operational_consumer_invalid"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(OPERATIONAL_CONSUMER_ACTIVATION_ERRORS, code) ? code : "attendance_operational_consumer_invalid"); }
  const result = await parseOperationalConsumerActivationResult(response.data, query, actor, command); if (!allowActivate && result.canActivate) throw new MerchantAttendanceError("attendance_operational_consumer_invalid"); return result;
}


