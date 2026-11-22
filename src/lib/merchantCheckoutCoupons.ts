import { merchantCouponSupportsUsageScenario, redeemMerchantCoupon, type MerchantCouponRecord, type MerchantCouponDiscountType } from "./merchantCoupons";
import { appendMutationOperationMarker, buildMutationOperationMarker } from "./mutationOperationId";

export type CheckoutCouponClaim = { couponId: string; claimEventId: string };
export type CheckoutCouponReason = "inactive" | "not_started" | "expired" | "used" | "scenario" | "target"
  | "minimum" | "wrong_units" | "invalid";
export type CheckoutCouponChoice = CheckoutCouponClaim & {
  title: string; kind: MerchantCouponDiscountType; validUntil: string | null;
  available: boolean; reason?: CheckoutCouponReason; cashDiscountMinor: number; pointsDiscount: number;
  coveredQuantity: number; singleUse: true;
};
/** Trusted catalog/session data only. Names and browser totals never bind a
 * voucher to a product/service. Vouchers need an explicit merchant-owned ID
 * mapping; money/points remain separate units. */
export type CheckoutCouponContext = {
  siteId: string; accountId: string; userId: string; membershipActive: boolean;
  kind: "booking" | "order"; method: "points" | "on_site";
  targetId: string; tags: string[]; quantity: number; unitCashMinor: number | null; unitPoints: number | null;
  voucherCouponIds: string[]; durationMinutes?: number; now: string;
};
export type CheckoutCouponQuote = {
  claims: CheckoutCouponClaim[]; grossCashMinor: number | null; grossPoints: number | null;
  payableCashMinor: number | null; payablePoints: number | null;
  cashDiscountMinor: number; pointsDiscount: number; coveredQuantity: number;
};

const key = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 99_999_999;
const own = (claim: { accountId: string; userId: string }, ctx: CheckoutCouponContext) => Boolean(claim.accountId || claim.userId)
  && (!claim.accountId || claim.accountId === ctx.accountId) && (!claim.userId || claim.userId === ctx.userId);
const fail = (code = "checkout_coupon_unavailable"): never => { throw new Error(code); };
export const checkoutCouponClaimKey = (claim: CheckoutCouponClaim) => JSON.stringify([claim.couponId, claim.claimEventId]);
export function parseCheckoutCouponClaims(raw: unknown): CheckoutCouponClaim[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 20) return fail("checkout_invalid_coupon_selection");
  const claims = raw.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some(k => k !== "couponId" && k !== "claimEventId")
      || !Object.hasOwn(entry, "couponId") || !Object.hasOwn(entry, "claimEventId")
      || !key(entry.couponId) || !key(entry.claimEventId)) return fail("checkout_invalid_coupon_selection");
    return { couponId: entry.couponId, claimEventId: entry.claimEventId };
  });
  if (new Set(claims.map(checkoutCouponClaimKey)).size !== claims.length) return fail("checkout_invalid_coupon_selection");
  return claims.sort((a, b) => checkoutCouponClaimKey(a).localeCompare(checkoutCouponClaimKey(b), "en"));
}
function minor(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !/^\d+(\.\d{1,2})?$/.test(String(value))) return fail();
  const [whole, fraction = ""] = String(value).split(".");
  const amount = Number(BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0")));
  if (!integer(amount)) return fail();
  return amount;
}
function validate(ctx: CheckoutCouponContext) {
  if (!/^\d{8}$/.test(ctx.siteId) || !/^\d{8}$/.test(ctx.accountId) || !key(ctx.userId) || !key(ctx.targetId)
    || !["booking", "order"].includes(ctx.kind) || !["points", "on_site"].includes(ctx.method)
    || !integer(ctx.quantity) || ctx.quantity < 1 || ctx.quantity > 999
    || !Number.isFinite(Date.parse(ctx.now)) || !Array.isArray(ctx.tags) || !Array.isArray(ctx.voucherCouponIds)
    || ctx.voucherCouponIds.some(id => !key(id))
    || (ctx.unitCashMinor !== null && !integer(ctx.unitCashMinor)) || (ctx.unitPoints !== null && !integer(ctx.unitPoints))
    || (ctx.method === "points" ? ctx.unitPoints === null : ctx.unitCashMinor === null)) fail("checkout_invalid_coupon_context");
  for (const unit of [ctx.unitCashMinor, ctx.unitPoints]) if (unit !== null && !integer(unit * ctx.quantity)) fail("checkout_total_too_large");
}
function ownedClaims(coupons: MerchantCouponRecord[], ctx: CheckoutCouponContext) {
  if (ctx.membershipActive !== true) return [];
  const rows: Array<{ coupon: MerchantCouponRecord; claim: MerchantCouponRecord["claimEvents"][number] }> = [];
  const seen = new Set<string>();
  const couponIds = new Set<string>();
  for (const coupon of coupons) {
    if (coupon.siteId !== ctx.siteId) continue;
    if (couponIds.has(coupon.id)) fail("checkout_coupon_store_ambiguous");
    couponIds.add(coupon.id);
    for (const claim of coupon.claimEvents) {
      if (!own(claim, ctx)) continue;
      const id = checkoutCouponClaimKey({ couponId: coupon.id, claimEventId: claim.id });
      if (seen.has(id) || !key(coupon.id) || !key(claim.id)) fail("checkout_coupon_store_ambiguous");
      seen.add(id); rows.push({ coupon, claim });
    }
  }
  return rows;
}
function lifecycle(coupon: MerchantCouponRecord, claim: MerchantCouponRecord["claimEvents"][number], now: number): CheckoutCouponReason | undefined {
  if (coupon.status !== "active") return "inactive";
  if (!claim.settlementCode || coupon.claimEvents.filter(row => row.settlementCode === claim.settlementCode).length !== 1) return "invalid";
  if (!Number.isFinite(Date.parse(claim.at)) || Date.parse(claim.at) > now) return "invalid";
  for (const date of [coupon.startsAt, coupon.expiresAt, claim.validUntil]) if (date !== null && !Number.isFinite(Date.parse(date))) return "invalid";
  if (coupon.startsAt && Date.parse(coupon.startsAt) > now) return "not_started";
  if ([coupon.expiresAt, claim.validUntil].some(date => date !== null && Date.parse(date) < now)) return "expired";
  if (coupon.redeemEvents.some(event => event.claimEventId === claim.id || event.settlementCode === claim.settlementCode)) return "used";
}
function eligibility(coupon: MerchantCouponRecord, claim: MerchantCouponRecord["claimEvents"][number], ctx: CheckoutCouponContext): CheckoutCouponReason | undefined {
  const inactive = lifecycle(coupon, claim, Date.parse(ctx.now));
  if (inactive) return inactive;
  if (!merchantCouponSupportsUsageScenario(coupon, ctx.method === "points" ? "points_redemption" : "order_cart")) return "scenario";
  // Deliberately do NOT use unclaimed stock here. An already-issued claim stays
  // usable when all copies of the campaign have been issued to other customers.
  if ((coupon.applicableProductIds.length && !coupon.applicableProductIds.includes(ctx.targetId))
    || (coupon.applicableTags.length && !coupon.applicableTags.some(tag => ctx.tags.includes(tag)))) return "target";
  const voucher = ["product_voucher", "exchange_voucher", "ticket_voucher"].includes(coupon.discountType);
  if (voucher) {
    if (!ctx.voucherCouponIds.includes(coupon.id) || (coupon.discountType === "product_voucher" ? ctx.kind !== "order" : ctx.kind !== "booking")) return "target";
    if (coupon.discountType === "ticket_voucher" && (!integer(ctx.durationMinutes) || ctx.durationMinutes < 1
      || !integer(coupon.ticketDurationMinutes) || ctx.durationMinutes > coupon.ticketDurationMinutes)) return "target";
  } else if ((coupon.discountType === "points_voucher") !== (ctx.method === "points")) return "wrong_units";
  try {
    const minimum = minor(coupon.minimumAmount);
    if (minimum > 0 && (ctx.unitCashMinor === null || ctx.unitCashMinor * ctx.quantity < minimum)) return "minimum";
    if (coupon.discountType === "points_voucher" && (!integer(coupon.pointsVoucherMinimumRedeemPoints)
      || ctx.unitPoints! * ctx.quantity < coupon.pointsVoucherMinimumRedeemPoints)) return "minimum";
  } catch { return "invalid"; }
}

export type OwnCheckoutCoupon = CheckoutCouponClaim & {
  title: string; kind: MerchantCouponDiscountType; validUntil: string | null;
  discountValue: number; minimumAmount: number; singleUse: true; quoteRequired: true;
};
/** Inventory, not authority to settle: the offer-specific quote still has to
 * check scope, method, minimum, quantity and stacking. Never use metadata's
 * cached wallet as an authoritative issued/used coupon ledger. */
export function listOwnCheckoutCouponClaims(coupons: MerchantCouponRecord[], input: {
  siteId: string; accountId: string; userId: string; membershipActive: boolean; now: string;
}): OwnCheckoutCoupon[] {
  const ctx = { ...input, kind: "order", method: "on_site", targetId: "inventory-only", tags: [],
    quantity: 1, unitCashMinor: 1, unitPoints: null, voucherCouponIds: [] } satisfies CheckoutCouponContext;
  validate(ctx);
  return ownedClaims(coupons, ctx).filter(({ coupon, claim }) => !lifecycle(coupon, claim, Date.parse(ctx.now)))
    .sort((a, b) => Date.parse(b.claim.at) - Date.parse(a.claim.at) || a.claim.id.localeCompare(b.claim.id, "en"))
    .map(({ coupon, claim }) => ({ couponId: coupon.id, claimEventId: claim.id, title: coupon.displayTitle || coupon.title,
      kind: coupon.discountType, validUntil: [coupon.expiresAt, claim.validUntil].filter((v): v is string => v !== null)
        .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null,
      discountValue: coupon.discountValue, minimumAmount: coupon.minimumAmount, singleUse: true, quoteRequired: true }));
}

function discount(coupon: MerchantCouponRecord, ctx: CheckoutCouponContext) {
  let coveredQuantity = 0, cashDiscountMinor = 0, pointsDiscount = 0;
  switch (coupon.discountType) {
    case "product_voucher": coveredQuantity = coupon.productQuantity; break;
    case "exchange_voucher": coveredQuantity = coupon.exchangeQuantity; break;
    case "ticket_voucher": coveredQuantity = 1; break;
    case "points_voucher":
      if (!integer(coupon.discountValue) || coupon.discountValue === 0 || !integer(coupon.pointsVoucherMaxPerRedemption)) fail();
      pointsDiscount = Math.min(ctx.unitPoints! * ctx.quantity, coupon.discountValue); break;
    case "amount_off": case "threshold_amount_off": case "stored_value":
      cashDiscountMinor = Math.min(ctx.unitCashMinor! * ctx.quantity, minor(coupon.discountValue)); break;
    case "percent_off": {
      const bps = minor(coupon.discountValue);
      if (bps > 10000) fail();
      cashDiscountMinor = Number((BigInt(ctx.unitCashMinor! * ctx.quantity) * BigInt(bps) + BigInt(5000)) / BigInt(10000));
      const cap = minor(coupon.maxDiscountAmount);
      if (cap > 0) cashDiscountMinor = Math.min(cashDiscountMinor, cap);
      break;
    }
    default: fail();
  }
  if (!integer(coveredQuantity)) fail();
  coveredQuantity = Math.min(coveredQuantity, ctx.quantity);
  if (coveredQuantity) {
    if (ctx.method === "points") pointsDiscount = coveredQuantity * ctx.unitPoints!;
    else cashDiscountMinor = coveredQuantity * ctx.unitCashMinor!;
  }
  if (!(cashDiscountMinor > 0 || pointsDiscount > 0)) fail();
  return { coveredQuantity, cashDiscountMinor, pointsDiscount };
}

/** Safe display DTO: no settlement codes, other claim holders, email or raw
 * redemption history. A preview does not consume a coupon or reserve stock. */
export function checkoutCouponChoices(coupons: MerchantCouponRecord[], ctx: CheckoutCouponContext): CheckoutCouponChoice[] {
  validate(ctx);
  return ownedClaims(coupons, ctx).map(({ coupon, claim }) => {
    let reason = eligibility(coupon, claim, ctx), value = { coveredQuantity: 0, cashDiscountMinor: 0, pointsDiscount: 0 };
    if (!reason) { try { value = discount(coupon, ctx); } catch { reason = "invalid"; } }
    const dates = [coupon.expiresAt, claim.validUntil].filter((date): date is string => date !== null && Number.isFinite(Date.parse(date)));
    return { couponId: coupon.id, claimEventId: claim.id, title: coupon.displayTitle || coupon.title, kind: coupon.discountType,
      validUntil: dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null,
      available: !reason, ...(reason ? { reason } : {}), ...value, singleUse: true };
  });
}

export function quoteCheckoutCoupons(coupons: MerchantCouponRecord[], ctx: CheckoutCouponContext, selected: unknown): CheckoutCouponQuote {
  validate(ctx);
  const claims = parseCheckoutCouponClaims(selected), available = checkoutCouponChoices(coupons, ctx);
  const chosen = claims.map(claim => {
    const choice = available.find(row => checkoutCouponClaimKey(row) === checkoutCouponClaimKey(claim));
    if (!choice?.available) return fail();
    return choice;
  });
  // The existing model has no general cash/voucher stacking policy. Do not
  // invent one. Existing multi-points-voucher limits remain supported.
  if (chosen.length > 1 && chosen.some(row => row.kind !== "points_voucher")) fail("checkout_coupon_stack_not_allowed");
  if (chosen.length > 1) {
    const rows = ownedClaims(coupons, ctx);
    for (const claim of claims) {
      const coupon = rows.find(row => row.coupon.id === claim.couponId && row.claim.id === claim.claimEventId)!.coupon;
      if (coupon.pointsVoucherMaxPerRedemption > 0 && chosen.length > coupon.pointsVoucherMaxPerRedemption) fail("checkout_coupon_stack_not_allowed");
    }
  }
  const grossCashMinor = ctx.unitCashMinor === null ? null : ctx.unitCashMinor * ctx.quantity;
  const grossPoints = ctx.unitPoints === null ? null : ctx.unitPoints * ctx.quantity;
  const cashDiscountMinor = chosen.reduce((sum, row) => sum + row.cashDiscountMinor, 0);
  const rawPointsDiscount = chosen.reduce((sum, row) => sum + row.pointsDiscount, 0);
  const pointsDiscount = Math.min(grossPoints ?? 0, rawPointsDiscount);
  if (chosen.length > 1 && chosen.some(row => rawPointsDiscount - row.pointsDiscount >= grossPoints!)) fail("checkout_coupon_no_benefit");
  return { claims, grossCashMinor, grossPoints, cashDiscountMinor, pointsDiscount,
    payableCashMinor: grossCashMinor === null ? null : grossCashMinor - cashDiscountMinor,
    payablePoints: grossPoints === null ? null : grossPoints - pointsDiscount,
    coveredQuantity: chosen.reduce((sum, row) => sum + row.coveredQuantity, 0) };
}

/** Preparation only. Keep the returned private records SERVER-SIDE and commit
 * their CAS mutation together with stock/member/booking/order. Never call the
 * standalone coupon-save API first, and never use inverse compensation. */
export function prepareCheckoutCouponChanges(coupons: MerchantCouponRecord[], ctx: CheckoutCouponContext, selected: unknown, operationKey: string) {
  if (!/^[a-f0-9]{64}$/.test(operationKey)) fail("checkout_invalid_intent");
  const quote = quoteCheckoutCoupons(coupons, ctx, selected);
  const marker = buildMutationOperationMarker("member-checkout-coupon", operationKey);
  const nextById = new Map<string, MerchantCouponRecord>();
  for (const picked of quote.claims) {
    const current = nextById.get(picked.couponId) ?? coupons.find(row => row.siteId === ctx.siteId && row.id === picked.couponId)!;
    const claim = current.claimEvents.find(row => row.id === picked.claimEventId)!;
    const prepared = redeemMerchantCoupon(current, { settlementCode: claim.settlementCode, operatorId: `customer:${ctx.accountId}`,
      note: appendMutationOperationMarker("会员自助结算", marker), now: ctx.now });
    // Preserve unknown legacy fields and ALL historical redemptions. Do not
    // truncate financial evidence simply because the old UI displays a window.
    const next = { ...current, usedCount: prepared.usedCount, updatedAt: prepared.updatedAt,
      redeemEvents: [prepared.redeemEvents[0], ...current.redeemEvents] };
    nextById.set(current.id, next);
  }
  return { quote, changes: [...nextById].map(([id, next]) => ({ previous: coupons.find(row => row.siteId === ctx.siteId && row.id === id)!, next })) };
}
