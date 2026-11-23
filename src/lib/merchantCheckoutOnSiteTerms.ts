export type OnSitePendingReceipt = {
  version: 2; method: "on_site"; resourceKind: "booking" | "order"; resourceId: string;
  currency: "eur"; grossMinor: number; discountMinor: number; dueMinor: number;
  capturedMinor: 0; totalPoints: null; couponCount: number;
  paymentState: "unpaid" | "coupon_covered";
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const minor = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 99_999_999;
function need(value: unknown, code = "checkout_invalid_on_site_receipt"): asserts value { if (!value) throw new Error(code); }

/** Separate from the points-only V1 result. Zero cash due because of a coupon
 * is NOT cash captured, a debit, a refund, or authority to award consumption
 * points. Explicit allowlist also strips private claim/member/resource data. */
export function parseOnSitePendingReceipt(raw: unknown): OnSitePendingReceipt {
  need(object(raw) && raw.version === 2 && raw.method === "on_site" && raw.currency === "eur"
    && ["booking", "order"].includes(String(raw.resourceKind)) && typeof raw.resourceId === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(raw.resourceId)
    && minor(raw.grossMinor) && raw.grossMinor > 0 && minor(raw.discountMinor) && minor(raw.dueMinor)
    && raw.discountMinor <= raw.grossMinor && raw.dueMinor === raw.grossMinor - raw.discountMinor
    && raw.capturedMinor === 0 && raw.totalPoints === null && Number.isInteger(raw.couponCount) && Number(raw.couponCount) >= 0 && Number(raw.couponCount) <= 1
    && (raw.discountMinor > 0 ? raw.couponCount === 1 : raw.couponCount === 0)
    && raw.paymentState === (raw.dueMinor === 0 ? "coupon_covered" : "unpaid"));
  return { version: 2, method: "on_site", resourceKind: raw.resourceKind as "booking" | "order", resourceId: raw.resourceId,
    currency: "eur", grossMinor: raw.grossMinor, discountMinor: raw.discountMinor, dueMinor: raw.dueMinor,
    capturedMinor: 0, totalPoints: null, couponCount: raw.couponCount as number, paymentState: raw.dueMinor === 0 ? "coupon_covered" : "unpaid" };
}
