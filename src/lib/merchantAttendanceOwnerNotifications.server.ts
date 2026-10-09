import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { OWNER_NOTIFICATIONS_ERRORS, ownerNotificationsUuid, parseOwnerNotificationsQuery, parseOwnerNotificationsBody, parseOwnerNotificationsResult,
  type OwnerNotificationsQuery, type OwnerNotificationsCommand } from "./merchantAttendanceOwnerNotifications";

export function ownerNotificationsEnabled(siteId: string, mode: "capture" | "read", env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (typeof siteId !== "string" || siteId.length !== 8 || !/^[0-9]{8}$/.test(siteId) || mode !== "capture" && mode !== "read") return false;
  const prefix = `FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_${mode.toUpperCase()}`;
  if (env[`${prefix}_ENABLED`] !== "1") return false; const raw = env[`${prefix}_SITES`]; if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim()); return sites.length <= 64 && new Set(sites).size === sites.length && sites.every(s => /^[0-9]{8}$/.test(s) && s.length === 8) && sites.includes(siteId);
}
export async function executeOwnerNotifications(input: { query: OwnerNotificationsQuery; command: OwnerNotificationsCommand | null; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseOwnerNotificationsQuery(input.query), command = input.command === null ? null : parseOwnerNotificationsBody({ query, command: input.command }).command;
  const actor = ownerNotificationsUuid(input.authUserId);
  if (typeof input.allowWrite !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  if (command && !input.allowWrite) throw new MerchantAttendanceError("attendance_owner_notification_disabled");
  if (!service) throw new MerchantAttendanceError("attendance_unavailable"); let response;
  try { response = await service.rpc("faolla_attendance_owner_notifications_v1", { p_query: query, p_auth_user_id: actor, p_command: command, p_allow_write: input.allowWrite }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(OWNER_NOTIFICATIONS_ERRORS, code) ? code : "attendance_unavailable"); }
  return parseOwnerNotificationsResult(response.data, query, actor, command);
}
