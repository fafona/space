import { parseMerchantCheckoutSelection } from "./merchantCheckoutCatalog";
import { parseCheckoutCouponClaims, checkoutCouponClaimKey, type CheckoutCouponChoice } from "./merchantCheckoutCoupons";
import { parseCartCheckoutResult, type CartCheckoutResult } from "./merchantCheckoutCartResult";
import { parseCheckoutOriginalResult, type CheckoutOriginalResult } from "./merchantCheckoutOriginalResult";
import type { CheckoutCartQuote } from "./merchantCheckoutCartQuote.server";

export type CartClientSelection = { siteId: string; method: "points" | "on_site";
  lines: Array<{ offerId: string; offerRevision: string; quantity: number; couponClaims?: Array<{ couponId: string; claimEventId: string }> }> };
export type CartClientReview = { quote: CheckoutCartQuote; confirmationHash: string; couponChoices: Array<{ offerId: string; choices: CheckoutCouponChoice[] }> };
export type CartClientOriginal = { kind: "cart"; result: CartCheckoutResult } | { kind: "single"; original: CheckoutOriginalResult };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const natural = (v: unknown, max = 99_999_999): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function need(v: unknown): asserts v { if (!v) throw new Error("checkout_invalid_response"); }
export function parseCartClientSelection(raw: unknown): CartClientSelection {
  need(object(raw) && Object.keys(raw).length === 3 && typeof raw.siteId === "string" && /^\d{8}$/.test(raw.siteId)
    && (raw.method === "points" || raw.method === "on_site") && Array.isArray(raw.lines) && raw.lines.length >= 1 && raw.lines.length <= 20);
  const ids = new Set<string>(), claims = new Set<string>();
  const lines = raw.lines.map(line => {
    need(object(line) && Object.keys(line).every(k => ["offerId", "offerRevision", "quantity", "couponClaims"].includes(k)));
    const parsed = parseMerchantCheckoutSelection(line);
    need(!ids.has(parsed.offerId) && parsed.offerId === parsed.offerId.toLowerCase() && parsed.offerRevision === parsed.offerRevision.toLowerCase()); ids.add(parsed.offerId);
    for (const c of parsed.couponClaims ?? []) { need(!claims.has(checkoutCouponClaimKey(c))); claims.add(checkoutCouponClaimKey(c)); }
    return { offerId: parsed.offerId, offerRevision: parsed.offerRevision, quantity: parsed.quantity, couponClaims: parsed.couponClaims ?? [] };
  }).sort((a, b) => a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0);
  need(lines.reduce((s, l) => s + l.quantity, 0) <= 999 && claims.size <= 20);
  return { siteId: raw.siteId, method: raw.method, lines };
}
function choices(raw: unknown): CheckoutCouponChoice[] {
  need(Array.isArray(raw) && raw.length <= 1000);
  const seen = new Set<string>();
  return raw.map(c => {
    need(object(c)); const claim = parseCheckoutCouponClaims([{ couponId: c.couponId, claimEventId: c.claimEventId }])[0];
    need(!seen.has(checkoutCouponClaimKey(claim))); seen.add(checkoutCouponClaimKey(claim));
    need(typeof c.title === "string" && c.title.length <= 500 && typeof c.available === "boolean" && c.singleUse === true
      && ["points_voucher", "product_voucher", "exchange_voucher", "ticket_voucher", "amount_off", "threshold_amount_off", "percent_off", "stored_value"].includes(String(c.kind))
      && natural(c.pointsDiscount) && natural(c.cashDiscountMinor) && natural(c.coveredQuantity, 999)
      && (c.validUntil === null || typeof c.validUntil === "string" && c.validUntil.length <= 64 && Number.isFinite(Date.parse(c.validUntil)))
      && (c.reason === undefined || ["inactive", "not_started", "expired", "used", "scenario", "target", "minimum", "wrong_units", "invalid"].includes(String(c.reason))));
    return { ...claim, title: c.title, kind: c.kind as CheckoutCouponChoice["kind"], available: c.available, singleUse: true,
      validUntil: c.validUntil as string | null, pointsDiscount: c.pointsDiscount, cashDiscountMinor: c.cashDiscountMinor, coveredQuantity: c.coveredQuantity,
      ...(c.reason ? { reason: c.reason as CheckoutCouponChoice["reason"] } : {}) };
  });
}
/** Browser display validation only. Never a price/permission authority. All
 * fields are reconstructed; malformed sums, allocations and other-scope data
 * cannot produce a confirmable review. No raw records enter component state. */
export function parseCartClientReview(raw: unknown, supplied: CartClientSelection): CartClientReview {
  const selection = parseCartClientSelection(supplied);
  need(object(raw) && raw.ok === true && raw.replayed === false && object(raw.quote) && hash(raw.confirmationHash));
  const q = raw.quote, points = selection.method === "points";
  need(q.version === 1 && q.purpose === "product_cart_quote" && q.siteId === selection.siteId && q.method === selection.method
    && q.previewOnly === true && q.canSubmit === false && q.reservationCreated === false && q.capturedMinor === 0 && hash(q.quoteHash)
    && typeof q.methodAvailable === "boolean" && natural(q.couponCount, 20) && natural(q.quantity, 999)
    && Array.isArray(q.lines) && q.lines.length === selection.lines.length && Array.isArray(raw.couponChoices) && raw.couponChoices.length === q.lines.length);
  const products = new Set<string>();
  const lines = q.lines.map((rawLine, i) => {
    const selected = selection.lines[i]; need(object(rawLine)); const l = rawLine;
    need(l.offerId === selected.offerId && l.offerRevision === selected.offerRevision && l.quantity === selected.quantity
      && typeof l.productId === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(l.productId) && !products.has(l.productId)
      && typeof l.title === "string" && l.title.length > 0 && l.title.length <= 200
      && JSON.stringify(parseCheckoutCouponClaims(l.couponClaims)) === JSON.stringify(selected.couponClaims)); products.add(l.productId);
    need(points ? l.grossMinor === null && l.discountMinor === null && l.dueMinor === null && natural(l.grossPoints) && natural(l.discountPoints) && natural(l.duePoints) && l.grossPoints === l.discountPoints + l.duePoints
      : l.grossPoints === null && l.discountPoints === null && l.duePoints === null && natural(l.grossMinor) && natural(l.discountMinor) && natural(l.dueMinor) && l.grossMinor === l.discountMinor + l.dueMinor);
    need(object(l.cancellationPolicy) && typeof l.cancellationPolicy.returnPoints === "boolean" && typeof l.cancellationPolicy.returnCoupons === "boolean" && natural(l.cancellationPolicy.advanceMinutes, 43_200));
    return { offerId: selected.offerId, offerRevision: selected.offerRevision, productId: l.productId, title: l.title, quantity: selected.quantity,
      grossMinor: l.grossMinor as number | null, discountMinor: l.discountMinor as number | null, dueMinor: l.dueMinor as number | null,
      grossPoints: l.grossPoints as number | null, discountPoints: l.discountPoints as number | null, duePoints: l.duePoints as number | null,
      couponClaims: parseCheckoutCouponClaims(l.couponClaims), cancellationPolicy: { returnPoints: l.cancellationPolicy.returnPoints, returnCoupons: l.cancellationPolicy.returnCoupons, advanceMinutes: l.cancellationPolicy.advanceMinutes } };
  });
  const sum = (key: "grossMinor" | "discountMinor" | "dueMinor" | "grossPoints" | "discountPoints" | "duePoints") => lines.reduce((s, l) => s + (l[key] ?? 0), 0);
  need(q.quantity === lines.reduce((s, l) => s + l.quantity, 0) && q.couponCount === lines.reduce((s, l) => s + l.couponClaims.length, 0));
  need(points ? q.currency === null && q.grossMinor === null && q.discountMinor === null && q.dueMinor === null
    && natural(q.grossPoints) && q.grossPoints === sum("grossPoints") && natural(q.discountPoints) && q.discountPoints === sum("discountPoints") && natural(q.duePoints) && q.duePoints === sum("duePoints")
    && natural(q.ownPointBalance, Number.MAX_SAFE_INTEGER) && q.methodAvailable === (q.ownPointBalance >= q.duePoints) && (q.duePoints > 0 || q.couponCount > 0)
    : q.currency === "eur" && q.grossPoints === null && q.discountPoints === null && q.duePoints === null && q.ownPointBalance === null && q.methodAvailable === true
      && natural(q.grossMinor) && q.grossMinor > 0 && q.grossMinor === sum("grossMinor") && natural(q.discountMinor) && q.discountMinor === sum("discountMinor") && natural(q.dueMinor) && q.dueMinor === sum("dueMinor"));
  need(q.methodAvailable ? q.reason === undefined : q.reason === "insufficient_points");
  const couponChoices = raw.couponChoices.map((row, i) => {
    need(object(row) && row.offerId === lines[i].offerId); const wallet = choices(row.choices);
    need(lines[i].couponClaims.every(c => wallet.some(w => w.available && checkoutCouponClaimKey(w) === checkoutCouponClaimKey(c))));
    return { offerId: lines[i].offerId, choices: wallet };
  });
  return { confirmationHash: raw.confirmationHash, couponChoices, quote: { version: 1, purpose: "product_cart_quote", siteId: selection.siteId, method: selection.method,
    previewOnly: true, canSubmit: false, reservationCreated: false, capturedMinor: 0, quantity: q.quantity, currency: points ? null : "eur",
    grossMinor: points ? null : Number(q.grossMinor), discountMinor: points ? null : Number(q.discountMinor), dueMinor: points ? null : Number(q.dueMinor),
    grossPoints: points ? Number(q.grossPoints) : null, discountPoints: points ? Number(q.discountPoints) : null, duePoints: points ? Number(q.duePoints) : null,
    ownPointBalance: points ? Number(q.ownPointBalance) : null, methodAvailable: q.methodAvailable, ...(!q.methodAvailable ? { reason: "insufficient_points" } : {}), couponCount: q.couponCount, quoteHash: q.quoteHash, lines } };
}
export function parseCartClientOriginal(raw: unknown, siteId: string): CartClientOriginal {
  need(object(raw) && /^\d{8}$/.test(siteId));
  if (raw.kind === "cart") { need(object(raw.result) && hash(raw.result.operationKey)); return { kind: "cart", result: parseCartCheckoutResult(raw.result, { siteId, operationKey: raw.result.operationKey }) }; }
  need(raw.kind === "single" && object(raw.original) && object(raw.original.result) && hash(raw.original.result.operationKey));
  return { kind: "single", original: parseCheckoutOriginalResult(raw.original, { siteId, operationKey: raw.original.result.operationKey }) };
}
export const cartClientOriginalKey = (original: CartClientOriginal) => original.kind === "cart" ? original.result.operationKey : original.original.result.operationKey;
