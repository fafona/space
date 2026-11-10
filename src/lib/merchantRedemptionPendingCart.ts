import type {
  MerchantRedemptionCheckoutContext, MerchantRedemptionCheckoutQuote, MerchantRedemptionPendingCart, MerchantRedemptionPendingMember,
} from "@/lib/merchantRedemptionCheckout";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 200;
const quoteKeys = ["totalQuantity", "grossPoints", "couponPointDiscountTotal", "totalPoints", "couponCount", "lines"];
const lineKeys = ["code", "name", "categoryName", "quantity", "unitPoints", "subtotalPoints", "couponDiscountLabel", "couponPointDiscount"];

export function isMerchantRedemptionCheckoutQuote(value: unknown): value is MerchantRedemptionCheckoutQuote {
  if (!record(value) || Object.keys(value).some(key => !quoteKeys.includes(key)) ||
    ![value.totalQuantity, value.grossPoints, value.couponPointDiscountTotal, value.totalPoints, value.couponCount].every(integer) ||
    !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 100) return false;
  let quantity = 0, gross = 0, discount = 0;
  for (const line of value.lines) {
    if (!record(line) || Object.keys(line).some(key => !lineKeys.includes(key)) ||
      !text(line.code) || !text(line.name) || !line.name.trim() || !text(line.categoryName) || !text(line.couponDiscountLabel) ||
      !integer(line.quantity) || line.quantity < 1 || line.quantity > 9999 || !integer(line.unitPoints) ||
      !integer(line.subtotalPoints) || line.subtotalPoints !== line.unitPoints * line.quantity || !integer(line.couponPointDiscount)) return false;
    quantity += line.quantity; gross += line.subtotalPoints; discount += line.couponPointDiscount;
  }
  return [quantity, gross, discount].every(Number.isSafeInteger) && quantity === value.totalQuantity &&
    gross === value.grossPoints && discount === value.couponPointDiscountTotal && discount <= gross &&
    value.totalPoints === gross - discount && Number(value.couponCount) <= value.lines.length;
}

export function isMerchantRedemptionPendingCart(value: unknown, siteId: string, operationId: string): value is MerchantRedemptionPendingCart {
  return record(value) && Object.keys(value).every(key => ["version", "siteId", "operationId", "quote"].includes(key)) &&
    value.version === 1 && value.siteId === siteId && value.operationId === operationId &&
    /^[A-Za-z0-9_.:-]{1,120}$/.test(operationId) && isMerchantRedemptionCheckoutQuote(value.quote);
}

export function isMerchantRedemptionPendingMember(value: unknown): value is MerchantRedemptionPendingMember {
  return record(value) && Object.keys(value).length === 4 &&
    Object.keys(value).every(key => ["memberNo", "name", "pointBalance", "balanceAmount"].includes(key)) &&
    text(value.memberNo) && Boolean(value.memberNo.trim()) && text(value.name) && Boolean(value.name.trim()) &&
    integer(value.pointBalance) && typeof value.balanceAmount === "number" &&
    Number.isFinite(value.balanceAmount) && value.balanceAmount >= 0 && value.balanceAmount <= Number.MAX_SAFE_INTEGER;
}

export function buildMerchantRedemptionPendingMember(member: MerchantRedemptionPendingMember | null) {
  if (member !== null && !isMerchantRedemptionPendingMember(member)) throw new Error("redemption_checkout_response_invalid");
  return structuredClone(member);
}

/** Called only after actor-scoped lookup and reauthorization. No raw request,
 * membership IDs, claim/settlement tokens, notes or private versions are exposed. */
export function buildMerchantRedemptionPendingCart(
  context: MerchantRedemptionCheckoutContext,
  siteId: string,
): MerchantRedemptionPendingCart {
  if (context.status !== "pending" || context.acknowledgedAt !== null ||
    !/^[A-Za-z0-9_.:-]{1,120}$/.test(context.operationId) || !isMerchantRedemptionCheckoutQuote(context.request.quote)) {
    throw new Error("redemption_checkout_response_invalid");
  }
  return { version: 1, siteId, operationId: context.operationId, quote: structuredClone(context.request.quote) };
}
