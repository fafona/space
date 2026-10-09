import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseCycleIntentQuery, parseCycleIntentCommand, type CycleIntentQuery, type CycleIntentCommand } from "./merchantAttendanceCycleIntent";
import { CYCLE_INTENT_ERRORS, parseCycleIntentResult } from "./merchantAttendanceCycleIntentResult";
export type CycleIntentServiceInput = { query: CycleIntentQuery; command: CycleIntentCommand | null; authUserId: string; allowAccept: boolean };
export function cycleIntentEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (siteId.length !== 8 || !/^[0-9]{8}$/.test(siteId) || env.FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_ENABLED !== "1") return false;
  const raw = env.FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_SITE_IDS; if (typeof raw !== "string" || raw.length > 899) return false;
  const ids = raw.split(","); return ids.length <= 100 && new Set(ids).size === ids.length && ids.every(id => id.length === 8 && /^[0-9]{8}$/.test(id)) && ids.includes(siteId);
}
export async function executeCycleIntent(input: CycleIntentServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseCycleIntentQuery(input.query), command = input.command === null ? null : parseCycleIntentCommand(input.command, query), auth = input.authUserId;
  if (typeof input.allowAccept !== "boolean" || typeof auth !== "string" || auth.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(auth)) throw new MerchantAttendanceError("attendance_invalid_request");
  if (!service) throw new MerchantAttendanceError("attendance_operational_cycle_invalid");
  let response; try { response = await service.rpc("faolla_attendance_operational_cycle_v1", { p_query: query, p_auth_user_id: auth, p_command: command, p_allow_accept: input.allowAccept }); }
  catch { throw new MerchantAttendanceError("attendance_operational_cycle_invalid"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(CYCLE_INTENT_ERRORS, code) ? code : "attendance_operational_cycle_invalid"); }
  return parseCycleIntentResult(response.data, query, auth, command, "sql");
}
