import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { EVENT_NOTIFICATIONS_ERRORS, eventNotificationsUuid, parseEventNotificationsBody, parseEventNotificationsQuery, parseEventNotificationsResult,
  type EventNotificationsCommand, type EventNotificationsQuery } from "./merchantAttendanceEventNotifications";

export function eventNotificationsEnabled(siteId: string, mode: "capture" | "read", env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (typeof siteId !== "string" || siteId.length !== 8 || !/^\d{8}$/.test(siteId) || mode !== "capture" && mode !== "read") return false;
  const prefix = `FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_${mode.toUpperCase()}`;
  if (env[`${prefix}_ENABLED`] !== "1") return false; const raw = env[`${prefix}_SITES`]; if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(value => value.trim()); return sites.length <= 64 && sites.every(value => value.length === 8 && /^\d{8}$/.test(value)) && sites.includes(siteId);
}
export async function executeEventNotifications(input: { query: EventNotificationsQuery; command: EventNotificationsCommand | null; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseEventNotificationsQuery(input.query), command = input.command === null ? null : parseEventNotificationsBody({ query, command: input.command }).command;
  const authUserId = eventNotificationsUuid(input.authUserId); if (!service || typeof input.allowWrite !== "boolean") throw new MerchantAttendanceError("attendance_unavailable");
  let r; try { r = await service.rpc("faolla_attendance_event_notifications_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (r.error) { const code = r.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(EVENT_NOTIFICATIONS_ERRORS, code) ? code : "attendance_unavailable"); }
  return parseEventNotificationsResult(r.data, query, authUserId, command);
}
