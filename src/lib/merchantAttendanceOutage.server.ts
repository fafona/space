import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { uuid } from "./merchantAttendancePlanExceptionValidation";
import { OUTAGE_ERRORS, assertOutageWriteQuery, outageCommandFingerprintText, parseOutageCommand, parseOutageQuery, parseOutageResult } from "./merchantAttendanceOutage";
import type { OutageCommand, OutageQuery } from "./merchantAttendanceOutageContract";

// Route and UI wiring does not enable creation. Deployment/pilot authorization
// and both explicit server switches remain necessary; existing reads may recover.
export function outageSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_OUTAGE_ENABLED !== "1" || typeof siteId !== "string" || !/^\d{8}$/.test(siteId) || siteId.length !== 8) return false;
  const raw = env.FAOLLA_ATTENDANCE_OUTAGE_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim());
  return sites.length <= 100 && sites.every(s => s.length === 8 && /^\d{8}$/.test(s)) && sites.includes(siteId);
}
export function outageCommandFingerprint(q: OutageQuery, c: OutageCommand): string {
  return createHash("sha256").update(outageCommandFingerprintText(q, c), "utf8").digest("hex");
}
export function projectOutageResult(raw: unknown, q: OutageQuery, actorId: string, command: OutageCommand | null = null) {
  const result = parseOutageResult(raw, q, actorId, command);
  if (command && result.receipt?.commandFingerprint !== outageCommandFingerprint(q, command)) throw new MerchantAttendanceError("attendance_outage_invalid");
  return result;
}
export async function executeOutage(input: { query: OutageQuery; authUserId: string; command?: OutageCommand | null; moduleEnabled?: boolean }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parseOutageQuery(input.query), command = input.command == null ? null : parseOutageCommand(input.command);
  let authUserId: string;
  try { authUserId = uuid(input.authUserId); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
  const moduleEnabled = input.moduleEnabled ?? false;
  if (typeof moduleEnabled !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  if (command) assertOutageWriteQuery(query, command, authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_outage_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: moduleEnabled && outageSiteEnabled(query.siteId) }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(OUTAGE_ERRORS, code) ? code : "attendance_unavailable");
  }
  return projectOutageResult(response.data, query, authUserId, command);
}
