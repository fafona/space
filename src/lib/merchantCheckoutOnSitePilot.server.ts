import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";
/** Separate, default-off gate. The existing points allowlist alone cannot
 * enable a new cash interface or substitute for migration/ACL acceptance. */
export function isMemberCheckoutOnSitePilotEnabled(siteId: string, env: Record<string, string | undefined> = process.env) {
  const raw = env.MERCHANT_MEMBER_CHECKOUT_ON_SITE_PILOT_SITES ?? "", sites = raw.split(",").map(s => s.trim());
  return isMemberCheckoutPilotEnabled(siteId, env) && Boolean(raw.trim()) && sites.length <= 50
    && sites.every(s => /^\d{8}$/.test(s)) && sites.includes(siteId);
}
export function isMemberCheckoutOnSiteCollectionEnabled(siteId: string, env: Record<string, string | undefined> = process.env) {
  const raw = env.MERCHANT_MEMBER_CHECKOUT_ON_SITE_COLLECTION_PILOT_SITES ?? "", sites = raw.split(",").map(s => s.trim());
  return isMemberCheckoutOnSitePilotEnabled(siteId, env) && Boolean(raw.trim()) && sites.length <= 50
    && sites.every(s => /^\d{8}$/.test(s)) && sites.includes(siteId);
}
