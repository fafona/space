import { isMemberCheckoutRetainedIntentEnabled } from "./merchantCheckoutRetainedIntent.server";
/** UI-only opt-in for standalone single forms. It does not broaden the shared
 * registration HTTP/SQL authority, install SQL, or enable any rollout. */
export function isMemberCheckoutSingleRetainedIntentEnabled(siteId: string, env: Record<string, string | undefined> = process.env) {
  const raw = env.MERCHANT_MEMBER_CHECKOUT_SINGLE_RETAINED_UI_SITES ?? "", sites = raw.split(",").map(s => s.trim());
  return isMemberCheckoutRetainedIntentEnabled(siteId, env) && !!raw.trim() && sites.length <= 50 && sites.every(s => /^\d{8}$/.test(s)) && sites.includes(siteId);
}
