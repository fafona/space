import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { eventNotificationsEnabled } from "./merchantAttendanceEventNotifications.server";
import { APPLICATION_DELEGATION_ERRORS, parseApplicationDelegationQuery, parseApplicationDelegationBody, parseApplicationDelegationResult,
  applicationDelegationCommandFingerprint, applicationDelegationReceiptMatches, type ApplicationDelegationQuery, type ApplicationDelegationCommand } from "./merchantAttendanceApplicationDelegation";

export async function executeApplicationDelegation(input: { query: ApplicationDelegationQuery; command: ApplicationDelegationCommand | null; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const query = parseApplicationDelegationQuery(input.query), command = input.command === null ? null : parseApplicationDelegationBody({ query, command: input.command }).command;
  if (typeof input.allowWrite !== "boolean" || query.mode === "decide" && !command) throw new MerchantAttendanceError("attendance_invalid_request");
  const authUserId = attendanceSelfUuid(input.authUserId);
  const fingerprint = command ? await applicationDelegationCommandFingerprint(query.siteId, query.access, command) : null;
  const captureNotifications = process.env.FAOLLA_ATTENDANCE_LEAVE_NOTIFICATIONS_ENABLED === "1" && query.access === "delegate" && command !== null && "decision" in command;
  const captureEvents = query.access === "delegate" && command !== null && "decision" in command && eventNotificationsEnabled(query.siteId, "capture");
  const r = await service.rpc(query.access === "owner" ? "faolla_attendance_application_delegations_v1" : captureEvents ? "faolla_attendance_delegated_applications_event_v1" : "faolla_attendance_delegated_applications_v1",
    { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite, p_capture_notifications: captureNotifications });
  if (r.error) { const code = r.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(APPLICATION_DELEGATION_ERRORS, code) ? code : "attendance_unavailable"); }
  const result = parseApplicationDelegationResult(r.data, query, { authUserId }, command);
  if (command && (!result.receipt || !applicationDelegationReceiptMatches(result.receipt, command, fingerprint!))) throw new MerchantAttendanceError("attendance_application_delegation_invalid");
  return result;
}
