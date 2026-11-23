import { quoteMerchantOfferAmounts, parseMerchantCheckoutSelection, type MerchantCheckoutSelection } from "./merchantCheckoutCatalog";
import { parseCheckoutConfigurationSnapshot } from "./merchantCheckoutConfigurationStore.server";
import type { ConfiguredCheckoutOffer } from "./merchantCheckoutConfiguration";
import { quoteCheckoutCoupons } from "./merchantCheckoutCoupons";
import type { MerchantCouponRecord } from "./merchantCoupons";
import type { MerchantMembershipRecord } from "./merchantMemberships";
import { checkoutPrincipalKey, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";

import { parseOnSitePendingReceipt } from "./merchantCheckoutOnSiteTerms";
export { parseOnSitePendingReceipt, type OnSitePendingReceipt } from "./merchantCheckoutOnSiteTerms";
function need(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }

/** PRIVATE preparation primitive, not a submission endpoint. Inputs MUST be
 * current authoritative storage, never browser prices/member/coupon objects.
 * Source visibility, permissions, appointment availability, snapshot CAS and
 * final confirmation still belong to the future composite submission adapter.
 * This function neither reads/writes storage nor prepares point transactions. */
export function prepareOnSitePendingTerms(input: {
  siteId: string; offer: ConfiguredCheckoutOffer; selection: MerchantCheckoutSelection;
  principal: CheckoutPrincipal; membership: MerchantMembershipRecord; coupons: MerchantCouponRecord[];
  tags: string[]; now: string; resourceId: string;
}) {
  const data = structuredClone(input), { siteId, principal, membership: member } = data;
  checkoutPrincipalKey(principal);
  const offer = parseCheckoutConfigurationSnapshot({ version: data.offer.revision, offers: [data.offer] }, siteId).offers[0];
  const selection = parseMerchantCheckoutSelection(data.selection), amounts = quoteMerchantOfferAmounts(offer, selection);
  need(offer.cash && offer.allowOnSite && amounts.cashTotalMinor !== null, "checkout_on_site_unavailable");
  need(member.siteId === siteId && member.status === "active" && Boolean(member.accountId || member.userId)
    && (!member.accountId || member.accountId === principal.accountId) && (!member.userId || member.userId === principal.userId), "checkout_membership_unavailable");
  need(offer.source.kind !== "booking" || selection.quantity === 1, "checkout_quantity_unavailable");
  const quote = quoteCheckoutCoupons(data.coupons, { siteId, ...principal, membershipActive: true, method: "on_site", kind: offer.source.kind,
    targetId: offer.source.kind === "booking" ? offer.source.serviceId : offer.source.productId,
    tags: data.tags, quantity: selection.quantity, unitCashMinor: offer.cash.unitAmountMinor, unitPoints: null,
    voucherCouponIds: offer.checkoutBinding.voucherCouponIds, durationMinutes: offer.checkoutBinding.durationMinutes ?? undefined, now: data.now }, selection.couponClaims);
  need(typeof offer.couponReturnOnCancel === "boolean", "checkout_coupon_policy_required");
  const receipt = parseOnSitePendingReceipt({ version: 2, method: "on_site", resourceKind: offer.source.kind, resourceId: data.resourceId,
    currency: "eur", grossMinor: amounts.cashTotalMinor, discountMinor: quote.cashDiscountMinor, dueMinor: quote.payableCashMinor,
    capturedMinor: 0, totalPoints: null, couponCount: quote.claims.length, paymentState: quote.payableCashMinor === 0 ? "coupon_covered" : "unpaid" });
  return { offer: { id: offer.id, revision: offer.revision }, quantity: selection.quantity, membershipId: member.id,
    couponClaims: quote.claims, couponReturnOnCancel: offer.couponReturnOnCancel, receipt };
}
