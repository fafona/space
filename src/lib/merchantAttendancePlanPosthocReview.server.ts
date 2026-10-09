// Fresh v3 decisions only. Never use this gate to reject a historical read or
//exact operation replay before SQL has checked the immutable receipt.
export function planPosthocReviewSiteEnabled(siteId: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED !== "1" || typeof siteId !== "string" || siteId.length !== 8 || !/^[0-9]{8}$/.test(siteId)) return false;
  const raw = env.FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(value => value.trim());
  return sites.length <= 100 && sites.every(value => value.length === 8 && /^[0-9]{8}$/.test(value)) && sites.includes(siteId);
}
