import { quoteMerchantInitialPayment, type MerchantInitialPaymentPolicy } from "./faollaPaymentPolicy";
import { parseCheckoutCouponClaims, type CheckoutCouponClaim } from "./merchantCheckoutCoupons";

export type MerchantCheckoutSource =
  | { kind: "booking"; blockId: string; serviceId: string; timeZone: string }
  | { kind: "order"; blockId: string; collectionId: string; productId: string };
export type MerchantCheckoutOffer = {
  version: 1; id: string; siteId: string; revision: string; enabled: boolean;
  title: string; source: MerchantCheckoutSource; maxQuantity: number;
  cash: { currency: "eur"; unitAmountMinor: number; initialPolicy: MerchantInitialPaymentPolicy } | null;
  unitPoints: number | null; allowOnSite: boolean;
  // New merchant-authored policy; copied into the original checkout. An old
  // offer with no decision cannot start a coupon checkout. Never infer true.
  couponReturnOnCancel?: boolean;
};
export type MerchantCheckoutSelection = {
  offerId: string; offerRevision: string; quantity: number; slotKey?: string; couponClaims?: CheckoutCouponClaim[];
};

const uuid = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s);
const id = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(s);
const record = (s: unknown): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s)
  && (Object.getPrototypeOf(s) === Object.prototype || Object.getPrototypeOf(s) === null);
function need(v: unknown, code = "checkout_invalid_offer"): asserts v { if (!v) throw new Error(code); }

export function parseMerchantCheckoutSelection(raw: unknown): MerchantCheckoutSelection {
  const code = "checkout_invalid_selection";
  need(record(raw) && Object.keys(raw).every(key => ["offerId", "offerRevision", "quantity", "slotKey", "couponClaims"].includes(key)), code);
  need(["offerId", "offerRevision", "quantity"].every(key => Object.hasOwn(raw, key)), code);
  need(uuid(raw.offerId) && uuid(raw.offerRevision) && Number.isSafeInteger(raw.quantity) && Number(raw.quantity) >= 1 && Number(raw.quantity) <= 999, code);
  need(raw.slotKey === undefined || id(raw.slotKey), code);
  return { offerId: raw.offerId, offerRevision: raw.offerRevision, quantity: Number(raw.quantity),
    ...(raw.slotKey !== undefined ? { slotKey: raw.slotKey } : {}),
    ...(raw.couponClaims !== undefined ? { couponClaims: parseCheckoutCouponClaims(raw.couponClaims) } : {}) };
}

/** Validate trusted server storage without coercing missing price/points to zero.
 * Stable IDs are configured explicitly; never infer bindings from item names. */
export function assertMerchantCheckoutOffer(value: unknown): asserts value is MerchantCheckoutOffer {
  need(record(value) && value.version === 1 && uuid(value.id) && uuid(value.revision));
  need(typeof value.siteId === "string" && /^\d{8}$/.test(value.siteId) && typeof value.enabled === "boolean");
  need(typeof value.title === "string" && value.title.trim() === value.title && value.title.length > 0 && value.title.length <= 200);
  need(Number.isSafeInteger(value.maxQuantity) && Number(value.maxQuantity) > 0 && Number(value.maxQuantity) <= 999);
  need(typeof value.allowOnSite === "boolean" && record(value.source) && id(value.source.blockId));
  need(value.couponReturnOnCancel === undefined || typeof value.couponReturnOnCancel === "boolean");
  if (value.source.kind === "booking") {
    need(id(value.source.serviceId) && typeof value.source.timeZone === "string" && value.source.timeZone.length < 100);
    try { new Intl.DateTimeFormat("en", { timeZone: value.source.timeZone }).format(); } catch { need(false); }
  } else {
    need(value.source.kind === "order" && id(value.source.collectionId) && id(value.source.productId));
  }
  if (value.cash !== null) {
    need(record(value.cash) && value.cash.currency === "eur" && Number.isSafeInteger(value.cash.unitAmountMinor)
      && Number(value.cash.unitAmountMinor) > 0 && Number(value.cash.unitAmountMinor) <= 99_999_999);
    need(quoteMerchantInitialPayment(value.cash.unitAmountMinor, value.cash.initialPolicy, { basisPoints: 0 }).ok);
    need(value.source.kind !== "order" || (record(value.cash.initialPolicy) && value.cash.initialPolicy.mode === "full"));
  }
  need(value.unitPoints === null || (Number.isSafeInteger(value.unitPoints) && Number(value.unitPoints) > 0 && Number(value.unitPoints) <= 99_999_999));
  need(value.cash !== null || value.unitPoints !== null);
  need(!value.allowOnSite || value.cash !== null);
}

export function quoteMerchantOfferAmounts(offer: MerchantCheckoutOffer, selection: MerchantCheckoutSelection) {
  assertMerchantCheckoutOffer(offer);
  selection = parseMerchantCheckoutSelection(selection);
  need(offer.enabled && offer.id === selection.offerId, "checkout_offer_not_found");
  need(offer.revision === selection.offerRevision, "checkout_quote_changed");
  need(selection.quantity <= offer.maxQuantity, "checkout_quantity_unavailable");
  need((offer.source.kind === "booking") === (selection.slotKey !== undefined), "checkout_invalid_selection");
  const cashTotalMinor = offer.cash ? offer.cash.unitAmountMinor * selection.quantity : null;
  const totalPoints = offer.unitPoints !== null ? offer.unitPoints * selection.quantity : null;
  // Pilot provider and ledger limits. Do not silently clamp a large order.
  need((cashTotalMinor === null || cashTotalMinor <= 99_999_999) && (totalPoints === null || totalPoints <= 99_999_999), "checkout_total_too_large");
  return { cashTotalMinor, totalPoints };
}
