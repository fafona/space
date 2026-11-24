import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";
import { isMemberCheckoutLegacyReviewEnabled } from "./merchantCheckoutLegacyReviewPilot.server";
export function isMemberCheckoutLegacyHandoffEnabled(siteId: string, env: Record<string, string | undefined> = process.env) {
  return isMemberCheckoutLegacyReviewEnabled(siteId, env) && isMemberCheckoutPilotEnabled(siteId, { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: env.MERCHANT_MEMBER_CHECKOUT_LEGACY_HANDOFF_SITES });
}
