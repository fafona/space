/** Server-only, explicit merchant allowlist. Empty/malformed configuration is
 * disabled; never taken from a query string, browser storage or merchant JSON. */
export function isMemberCheckoutPilotEnabled(siteId: string, env: Record<string, string | undefined> = process.env) {
  const raw = env.MERCHANT_MEMBER_CHECKOUT_PILOT_SITES ?? "";
  if (!/^\d{8}$/.test(siteId) || !raw.trim()) return false;
  const sites = raw.split(",").map(value => value.trim());
  return sites.length <= 50 && sites.every(value => /^\d{8}$/.test(value)) && sites.includes(siteId);
}
