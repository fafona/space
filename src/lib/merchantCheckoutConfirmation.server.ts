import { createHash } from "node:crypto";
import { checkoutPrincipalKey, type CheckoutPrincipal, type MerchantCheckoutQuoteView } from "./merchantCheckoutQuote.server";

/** Confirmation fingerprint only, never financial authority. The server must
 * independently recalculate the quote again inside the submission snapshot. */
export function checkoutConfirmationHash(quote: MerchantCheckoutQuoteView, principal: CheckoutPrincipal,
  slot: { key: string; appointmentAt: string; timeZone: string } | null) {
  const points = quote.options.find(option => option.method === "points");
  if (!points?.available || points.totalPoints === null) return null;
  return createHash("sha256").update(JSON.stringify(["member-checkout-confirmation-v2", checkoutPrincipalKey(principal),
    quote.siteId, quote.offerId, quote.offerRevision, quote.resourceKind, quote.quantity, quote.cashTotalMinor,
    quote.totalPoints, points.totalPoints, points.couponCount ?? 0, quote.coupons?.selected ?? [],
    slot ? [slot.key, slot.appointmentAt, slot.timeZone] : null])).digest("hex");
}
