import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";
import { isMemberCheckoutOnSitePilotEnabled } from "./merchantCheckoutOnSitePilot.server";

/** Independent default-closed gate. This does not register SQL, grant access,
 * turn on DB pilots, collect cash or enable Stripe. */
export function isMemberCheckoutCartPilotEnabled(siteId: string, method: "points" | "on_site", env: Record<string, string | undefined> = process.env) {
  const raw = env.MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES ?? "", sites = raw.split(",").map(s => s.trim());
  return isMemberCheckoutPilotEnabled(siteId, env) && Boolean(raw.trim()) && sites.length <= 50
    && sites.every(s => /^\d{8}$/.test(s)) && sites.includes(siteId)
    && (method === "points" || isMemberCheckoutOnSitePilotEnabled(siteId, env));
}
