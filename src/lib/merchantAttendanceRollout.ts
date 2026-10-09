type AttendanceEnvironment = Readonly<Record<string, string | undefined>>;

/** Release admission is separate from saved platform and employee permissions.
 * Unset retains the existing local/test behavior; production explicitly enables
 * this guard and provides the exact approved cohort. No wildcard is accepted. */
export function attendanceRolloutSiteEnabled(siteId: unknown, env: AttendanceEnvironment = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_ROLLOUT_ENABLED !== "1") return true;
  const raw = env.FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS ?? "";
  const sites = raw.split(",").map(value => value.trim());
  if (sites.length > 100 || sites.some(value => !/^\d{8}$/.test(value)) || new Set(sites).size !== sites.length) return false;
  return typeof siteId === "string" && /^\d{8}$/.test(siteId) && sites.includes(siteId);
}

export type AttendanceUiAdmission = { scope: string; enabled: boolean };

/** A late successful response must not enable the new site/account's controls. */
export function attendanceUiAdmissionCurrent(value: AttendanceUiAdmission | null, scope: string): boolean {
  return value?.enabled === true && value.scope === scope;
}
