import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";
import { isMemberCheckoutHistoryReadEnabled } from "./merchantCheckoutHistoryPilot.server";
/** Separate default-closed read scope; historical financial access alone does
 * not grant access to legacy ordinary-order storage or any mutation. */
export function isMemberCheckoutLegacyReviewEnabled(siteId: string, env: Record<string, string | undefined> = process.env) {
  return isMemberCheckoutHistoryReadEnabled(siteId, env) && isMemberCheckoutPilotEnabled(siteId, {
    MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: env.MERCHANT_MEMBER_CHECKOUT_LEGACY_REVIEW_SITES,
  });
}
