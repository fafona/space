import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";

/** Explicit server-only READ scope, independent of purchase/collection gates.
 * Empty/malformed is closed. This does not install SQL, grant DB privileges,
 * enroll a customer, acknowledge an intent, cancel, collect, debit or refund. */
export function isMemberCheckoutHistoryReadEnabled(siteId: string, env: Record<string, string | undefined> = process.env) {
  return isMemberCheckoutPilotEnabled(siteId, { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: env.MERCHANT_MEMBER_CHECKOUT_HISTORY_READ_SITES });
}
