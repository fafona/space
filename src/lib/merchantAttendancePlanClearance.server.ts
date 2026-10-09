// This is a separate fresh-write rollout gate. Historical reads/replays are
// never rejected here: SQL decides whether an exact operation already exists.
export function planClearanceSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED !== "1" || typeof siteId !== "string" || !/^[0-9]{8}$/.test(siteId) || siteId.length !== 8) return false;
  const raw = env.FAOLLA_ATTENDANCE_PLAN_CLEARANCE_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(value => value.trim());
  return sites.length <= 100 && sites.every(value => value.length === 8 && /^[0-9]{8}$/.test(value)) && sites.includes(siteId);
}
