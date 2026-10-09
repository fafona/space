import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { EMPLOYMENT_LIFECYCLE_ERRORS, parseEmploymentLifecycleQuery, parseEmploymentLifecycleBody, parseEmploymentLifecycleResult,
  employmentLifecycleCommandFingerprint, employmentLifecycleReceiptMatches, type EmploymentLifecycleQuery, type EmploymentLifecycleCommand } from "./merchantAttendanceEmploymentLifecycle";

/** Explicit switch AND bounded exact merchant allowlist; no wildcard or implicit rollout. */
export function employmentLifecycleEnabled(siteId: string, env: NodeJS.ProcessEnv = process.env) {
  if (!/^[0-9]{8}$/.test(siteId) || siteId.length !== 8 || env.FAOLLA_ATTENDANCE_EMPLOYMENT_LIFECYCLE_ENABLED !== "1") return false;
  const raw = env.FAOLLA_ATTENDANCE_EMPLOYMENT_LIFECYCLE_SITES;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(v => v.trim());
  return sites.length <= 64 && sites.every(v => v.length === 8 && /^[0-9]{8}$/.test(v)) && sites.includes(siteId);
}
export async function executeEmploymentLifecycle(input: { query: EmploymentLifecycleQuery; command: EmploymentLifecycleCommand | null; authUserId: string; allowWrite: boolean },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const query = parseEmploymentLifecycleQuery(input.query), command = input.command === null ? null : parseEmploymentLifecycleBody({ query, command: input.command }).command;
  if (typeof input.allowWrite !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
  const authUserId = attendanceSelfUuid(input.authUserId), fingerprint = command ? await employmentLifecycleCommandFingerprint(query.siteId, command) : null;
  const response = await service.rpc("faolla_attendance_employment_lifecycle_v1", { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: input.allowWrite });
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(EMPLOYMENT_LIFECYCLE_ERRORS, code) ? code : "attendance_unavailable"); }
  const result = parseEmploymentLifecycleResult(response.data, query, authUserId, command);
  if (command && (!result.receipt || !employmentLifecycleReceiptMatches(result.receipt, command, fingerprint!))) throw new MerchantAttendanceError("attendance_employment_lifecycle_invalid");
  return result;
}
