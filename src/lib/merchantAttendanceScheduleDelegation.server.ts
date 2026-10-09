import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { eventNotificationsEnabled } from "./merchantAttendanceEventNotifications.server";
import { SCHEDULE_DELEGATION_ERRORS, parseScheduleDelegationQuery, parseScheduleDelegationBody, parseScheduleDelegationResult,
  scheduleDelegationCommandFingerprint, scheduleDelegationReceiptMatches, type ScheduleDelegationQuery, type ScheduleDelegationCommand } from "./merchantAttendanceScheduleDelegation";

/** Explicit switch AND bounded exact merchant allowlist; no wildcard or implicit rollout. */
export function scheduleDelegationEnabled(siteId: string, env: NodeJS.ProcessEnv = process.env) {
  if (!/^[0-9]{8}$/.test(siteId) || siteId.length !== 8 || env.FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED !== "1") return false;
  const raw = env.FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_SITES;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(v => v.trim());
  return sites.length <= 64 && sites.every(v => v.length === 8 && /^[0-9]{8}$/.test(v)) && sites.includes(siteId);
}
export async function executeScheduleDelegation(input: { query: ScheduleDelegationQuery; command: ScheduleDelegationCommand | null; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const query = parseScheduleDelegationQuery(input.query), command = input.command === null ? null : parseScheduleDelegationBody({ query, command: input.command }).command;
  if (typeof input.allowWrite !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  const authUserId = attendanceSelfUuid(input.authUserId), fingerprint = command ? await scheduleDelegationCommandFingerprint(query, command) : null;
  const capture = query.access === "delegate" && command !== null && "decision" in command && eventNotificationsEnabled(query.siteId, "capture");
  const response = await service.rpc(capture ? "faolla_attendance_schedule_delegation_event_v1" : "faolla_attendance_schedule_delegation_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite });
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(SCHEDULE_DELEGATION_ERRORS, code) ? code : "attendance_unavailable"); }
  const result = parseScheduleDelegationResult(response.data, query, { authUserId }, command);
  if (command && (!result.receipt || !scheduleDelegationReceiptMatches(result.receipt, query, command, fingerprint!))) throw new MerchantAttendanceError("attendance_schedule_delegation_invalid");
  return result;
}
