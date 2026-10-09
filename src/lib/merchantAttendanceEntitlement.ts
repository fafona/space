import type { AttendanceAction } from "@/lib/merchantAttendance";
import { attendanceRolloutSiteEnabled } from "./merchantAttendanceRollout";

/** Platform admission switch, not employee authorization. Reads and closing an
 * already-open shift still require the current owner/member/role DB checks.
 * Enterprise disablement, auth failures and emergency release gates remain
 * hard denials; this policy must never bypass them. */
export function attendanceModuleEnabled(site: { id?: unknown; permissionConfig?: { allowEnterpriseManagement?: unknown; allowEmployeeAttendance?: unknown } } | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env) {
  return site?.permissionConfig?.allowEnterpriseManagement === true && site.permissionConfig.allowEmployeeAttendance === true
    && attendanceRolloutSiteEnabled(site.id, env);
}
export function attendanceActionAllowed(moduleEnabled: boolean, action: AttendanceAction) {
  return moduleEnabled || action === "break_end" || action === "clock_out";
}
