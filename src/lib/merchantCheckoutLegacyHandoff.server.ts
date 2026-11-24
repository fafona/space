import { handleCheckoutLegacyReview, type LegacyReviewDependencies } from "./merchantCheckoutLegacyReview.server";
import { isMemberCheckoutLegacyHandoffEnabled } from "./merchantCheckoutLegacyHandoffPilot.server";
/** Same read-only evidence, with a SEPARATE explicit scope. No database write
 * or server acknowledgement; the user's local decision is not a payment proof. */
export function handleCheckoutLegacyHandoffReview(request: Request, overrides: Partial<LegacyReviewDependencies> = {}) {
  return handleCheckoutLegacyReview(request, { ...overrides, enabled: overrides.enabled ?? isMemberCheckoutLegacyHandoffEnabled });
}
