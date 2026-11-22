import { quoteMerchantInitialPayment } from "./faollaPaymentPolicy";
import { assertMerchantCheckoutOffer, parseMerchantCheckoutSelection, quoteMerchantOfferAmounts,
  type MerchantCheckoutOffer, type MerchantCheckoutSelection } from "./merchantCheckoutCatalog";
import type { MerchantSettlementMethod } from "./merchantSettlement";
import type { MerchantCouponRecord } from "./merchantCoupons";
import { checkoutCouponChoices, quoteCheckoutCoupons, type CheckoutCouponChoice, type CheckoutCouponClaim, type CheckoutCouponContext } from "./merchantCheckoutCoupons";

export type CheckoutPrincipal = { accountId: string; userId: string };
export type CheckoutMethodUnavailable = "login_required" | "membership_required" | "insufficient_points"
  | "module_unavailable" | "merchant_payments_unavailable" | "commission_not_configured" | "amount_below_minimum" | "coupon_not_applicable";
export type MerchantCheckoutMethodOption = {
  method: MerchantSettlementMethod; available: boolean; reason?: CheckoutMethodUnavailable;
  payNowMinor: number | null; remainingMinor: number | null; totalPoints: number | null;
  couponDiscountMinor?: number; couponDiscountPoints?: number; couponCount?: number;
};
export type MerchantCheckoutQuoteView = {
  version: 1; siteId: string; offerId: string; offerRevision: string; resourceKind: "booking" | "order";
  title: string; quantity: number; cashTotalMinor: number | null; totalPoints: number | null;
  ownPointBalance: number | null; options: MerchantCheckoutMethodOption[];
  // This is a selection preview, NOT a reserved slot, debit or paid receipt.
  reservationCreated: false;
  coupons?: { points: CheckoutCouponChoice[]; on_site: CheckoutCouponChoice[]; selected: CheckoutCouponClaim[];
    returnOnCancel: boolean | null; previewOnly: true };
};
export type CheckoutMembership = {
  id: string; siteId: string; accountId: string; userId: string;
  // Adapter must compute spendable points with the existing expiration/hold
  // rules without write-on-read. This is not permission to use a raw stale sum.
  status: "active" | "left"; pointBalance: number;
  // Effective per-unit price after the existing member-level discount. Null
  // only for cash-only offers. The adapter prepares BOTH from one snapshot.
  unitPoints: number | null;
};
export type CheckoutOnlineReadiness = {
  siteId: string; connectedAccountId: string; verifiedAt: number;
  settlementCurrency: string;
  chargesEnabled: boolean; platformFee: { policyId: string; basisPoints: number } | null;
};
/** Read-only server ports. Production adapters must resolve existing published
 * source IDs, real module permissions and current membership, not browser data.
 * No default Supabase connection, HTTP route, environment fallback or writes. */
export type MerchantCheckoutQuoteRepository = {
  pilot: (siteId: string) => Promise<{ enabled: boolean; bookings: boolean; orders: boolean; points: boolean; coupons?: boolean; onlinePayments?: boolean }>;
  offer: (siteId: string, offerId: string) => Promise<unknown>;
  sourceVisible: (offer: MerchantCheckoutOffer) => Promise<boolean>;
  availability: (offer: MerchantCheckoutOffer, selection: MerchantCheckoutSelection) => Promise<{ available: number }>;
  ownMembership: (siteId: string, principal: CheckoutPrincipal, offer: MerchantCheckoutOffer) => Promise<CheckoutMembership | null>;
  onlineReadiness: (siteId: string) => Promise<CheckoutOnlineReadiness | null>;
  coupons?: (siteId: string, principal: CheckoutPrincipal, offer: MerchantCheckoutOffer) => Promise<{
    rows: MerchantCouponRecord[]; voucherCouponIds: string[]; tags: string[]; durationMinutes?: number;
  }>;
};

export class MerchantCheckoutError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
const id = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(s);
export function checkoutPrincipalKey(p: CheckoutPrincipal) {
  if (!p || !/^\d{8}$/.test(p.accountId) || !id(p.userId)) throw new MerchantCheckoutError("checkout_unauthorized", 401);
  return `account:${p.accountId}:${p.userId}`;
}
function fail(code: string, status = 409): never { throw new MerchantCheckoutError(code, status); }

async function quote(input: {
  siteId: string; selection: unknown; authorize: () => Promise<CheckoutPrincipal | null>;
  repository: MerchantCheckoutQuoteRepository; now?: () => number;
}): Promise<MerchantCheckoutQuoteView> {
  if (!/^\d{8}$/.test(input.siteId)) fail("checkout_invalid_site", 400);
  const selection = parseMerchantCheckoutSelection(input.selection), repo = input.repository;
  const principal = await input.authorize();
  const scope = principal ? checkoutPrincipalKey(principal) : null;
  const pilot = await repo.pilot(input.siteId);
  if (pilot.enabled !== true) fail("checkout_disabled", 503);
  const raw = await repo.offer(input.siteId, selection.offerId);
  if (!raw) fail("checkout_offer_not_found", 404);
  const offer = structuredClone(raw);
  assertMerchantCheckoutOffer(offer);
  if (offer.siteId !== input.siteId || offer.id !== selection.offerId || !offer.enabled) fail("checkout_offer_not_found", 404);
  if (!(offer.source.kind === "booking" ? pilot.bookings === true : pilot.orders === true)) fail("checkout_module_unavailable", 403);
  if (!(await repo.sourceVisible(structuredClone(offer)))) fail("checkout_offer_not_found", 404);
  const amounts = quoteMerchantOfferAmounts(offer, selection);
  const availability = await repo.availability(structuredClone(offer), structuredClone(selection));
  if (!Number.isSafeInteger(availability.available) || availability.available < 0) fail("checkout_unavailable", 503);
  if (selection.quantity > availability.available) fail("checkout_quantity_unavailable");
  const member = principal && ((pilot.points === true && amounts.totalPoints !== null) || pilot.coupons === true)
    ? await repo.ownMembership(input.siteId, structuredClone(principal), structuredClone(offer)) : null;
  if (member && (member.siteId !== input.siteId || typeof member.id !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(member.id) ||
    (member.accountId !== "" && member.accountId !== principal!.accountId) ||
    (member.userId !== "" && member.userId !== principal!.userId) ||
    (!member.accountId && !member.userId) || !Number.isSafeInteger(member.pointBalance) || member.pointBalance < 0 ||
    !["active", "left"].includes(member.status))) fail("checkout_membership_scope_mismatch", 403);
  const ownPointBalance = member?.status === "active" ? member.pointBalance : null;
  let unitPoints = offer.unitPoints;
  if (member?.status === "active" && unitPoints !== null && pilot.points === true) {
    if (!Number.isSafeInteger(member.unitPoints) || member.unitPoints === null || member.unitPoints <= 0 || member.unitPoints > unitPoints) fail("checkout_membership_pricing_unavailable", 503);
    unitPoints = member.unitPoints;
    amounts.totalPoints = unitPoints * selection.quantity;
  }
  const selectedCoupons = selection.couponClaims ?? [];
  if (selectedCoupons.length && typeof offer.couponReturnOnCancel !== "boolean") fail("checkout_coupon_policy_required");
  if (selectedCoupons.length && (!principal || member?.status !== "active" || pilot.coupons !== true || !repo.coupons)) fail("checkout_coupon_unavailable");
  const ledger = principal && member?.status === "active" && pilot.coupons === true && repo.coupons
    ? await repo.coupons(input.siteId, structuredClone(principal), structuredClone(offer)) : null;
  const quoteTime = (input.now ?? Date.now)();
  const couponContext = (method: "points" | "on_site"): CheckoutCouponContext => ({ siteId: input.siteId,
    accountId: principal!.accountId, userId: principal!.userId, membershipActive: true, kind: offer.source.kind, method,
    targetId: offer.source.kind === "booking" ? offer.source.serviceId : offer.source.productId,
    tags: ledger!.tags, voucherCouponIds: ledger!.voucherCouponIds, quantity: selection.quantity,
    unitCashMinor: offer.cash?.unitAmountMinor ?? null, unitPoints, durationMinutes: ledger!.durationMinutes,
    now: new Date(quoteTime).toISOString() });
  const couponChoices = {
    points: ledger && offer.unitPoints !== null ? checkoutCouponChoices(ledger.rows, couponContext("points")) : [],
    on_site: ledger && offer.cash ? checkoutCouponChoices(ledger.rows, couponContext("on_site")) : [],
  };
  let couponCompatible = false;
  const discounted = (method: "points" | "on_site") => {
    if (!selectedCoupons.length || !ledger) return null;
    try { const value = quoteCheckoutCoupons(ledger.rows, couponContext(method), selectedCoupons); couponCompatible = true; return value; }
    catch (error) {
      if (!(error instanceof Error) || !["checkout_coupon_unavailable", "checkout_coupon_stack_not_allowed", "checkout_coupon_no_benefit"].includes(error.message)) throw error;
      return false;
    }
  };
  const options: MerchantCheckoutMethodOption[] = [];
  // Stripe is deferred. No account readiness/provider work until explicitly
  // enabled by the trusted server pilot; this is never a browser setting.
  if (pilot.onlinePayments === true && offer.cash && amounts.cashTotalMinor !== null) {
    const readiness = await repo.onlineReadiness(input.siteId), now = quoteTime;
    const fresh = readiness && readiness.siteId === input.siteId && readiness.settlementCurrency === "eur" && /^acct_[A-Za-z0-9]+$/.test(readiness.connectedAccountId)
      && Number.isFinite(now) && Number.isFinite(readiness.verifiedAt) && now >= readiness.verifiedAt && now - readiness.verifiedAt <= 300_000
      && readiness.chargesEnabled === true;
    const fee = readiness?.platformFee;
    const priced = quoteMerchantInitialPayment(amounts.cashTotalMinor, offer.cash.initialPolicy,
      fee && id(fee.policyId) ? { basisPoints: fee.basisPoints } : null);
    let reason: CheckoutMethodUnavailable | undefined = !fresh ? "merchant_payments_unavailable"
      : !priced.ok ? "commission_not_configured" : priced.value.payNowMinor < 50 ? "amount_below_minimum" : undefined;
    // An invalid policy/amount in trusted storage is corruption, not permission
    // to charge the entire price or silently choose another payment method.
    if (!priced.ok && !["commission_not_configured", "invalid_commission"].includes(priced.error)) fail("checkout_invalid_offer", 503);
    if (!pilot.bookings && offer.source.kind === "booking") reason = "module_unavailable";
    if (selectedCoupons.length) reason = "coupon_not_applicable";
    options.push({ method: "online", available: reason === undefined, ...(reason ? { reason } : {}),
      payNowMinor: priced.ok ? priced.value.payNowMinor : null, remainingMinor: priced.ok ? priced.value.remainingMinor : null, totalPoints: null });
  }
  if (amounts.totalPoints !== null) {
    const couponQuote = discounted("points"), payable = couponQuote ? couponQuote.payablePoints! : amounts.totalPoints;
    const reason: CheckoutMethodUnavailable | undefined = pilot.points !== true ? "module_unavailable" : !principal ? "login_required"
      : ownPointBalance === null ? "membership_required" : couponQuote === false ? "coupon_not_applicable"
        : ownPointBalance < payable ? "insufficient_points" : undefined;
    options.push({ method: "points", available: reason === undefined, ...(reason ? { reason } : {}),
      payNowMinor: null, remainingMinor: null, totalPoints: payable,
      ...(couponQuote ? { couponDiscountPoints: couponQuote.pointsDiscount, couponCount: couponQuote.claims.length } : {}) });
  }
  if (offer.allowOnSite) {
    const couponQuote = discounted("on_site");
    options.push({ method: "on_site", available: couponQuote !== false, ...(couponQuote === false ? { reason: "coupon_not_applicable" as const } : {}),
      payNowMinor: 0, remainingMinor: couponQuote ? couponQuote.payableCashMinor : amounts.cashTotalMinor, totalPoints: null,
      ...(couponQuote ? { couponDiscountMinor: couponQuote.cashDiscountMinor, couponCount: couponQuote.claims.length } : {}) });
  }
  if (selectedCoupons.length && !couponCompatible) fail("checkout_coupon_unavailable");
  const current = await input.authorize();
  if ((current ? checkoutPrincipalKey(current) : null) !== scope) fail("checkout_identity_changed", 401);
  return { version: 1, siteId: input.siteId, offerId: offer.id, offerRevision: offer.revision, resourceKind: offer.source.kind,
    title: offer.title, quantity: selection.quantity, ...amounts, ownPointBalance, options, reservationCreated: false,
    ...(ledger ? { coupons: { ...couponChoices, selected: selectedCoupons, returnOnCancel: offer.couponReturnOnCancel ?? null,
      previewOnly: true as const } } : {}) };
}

const SAFE_CODES = new Set(["checkout_invalid_selection", "checkout_invalid_offer", "checkout_offer_not_found", "checkout_quote_changed",
  "checkout_quantity_unavailable", "checkout_total_too_large", "checkout_invalid_site", "checkout_disabled", "checkout_unauthorized",
  "checkout_module_unavailable", "checkout_unavailable", "checkout_membership_scope_mismatch", "checkout_identity_changed", "checkout_coupon_unavailable",
  "checkout_invalid_coupon_selection", "checkout_coupon_store_ambiguous", "checkout_coupon_policy_required", "checkout_membership_pricing_unavailable",
  "checkout_source_changed", "checkout_slot_unavailable", "checkout_booking_quantity_unsupported", "checkout_membership_unavailable"]);
export async function quoteMerchantCheckout(input: Parameters<typeof quote>[0]): Promise<MerchantCheckoutQuoteView> {
  try { return await quote(input); }
  catch (error) {
    const code = error instanceof Error && SAFE_CODES.has(error.message) ? error.message : "checkout_unavailable";
    throw new MerchantCheckoutError(code, error instanceof MerchantCheckoutError && SAFE_CODES.has(error.code) ? error.status : 503);
  }
}
