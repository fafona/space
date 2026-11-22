export type MemberCheckoutCancellation = { pointsReturned: number; couponsReturned: number; stockReleased: number; cancelledAt: string };
export type MemberCheckoutResult = {
  version: 1; siteId: string; operationKey: string; resourceKind: "booking" | "order"; resourceId: string;
  totalPoints: number; couponCount: number; closed: boolean;
  resource: { status: string; updatedAt: string } | null;
  cancellationAvailable: boolean;
  cancellationPolicy: { returnPoints: boolean; returnCoupons: boolean; advanceMinutes: number; cancellableUntil: string | null } | null;
  cancellation: MemberCheckoutCancellation | null;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const date = (value: unknown): value is string => typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
function need(value: unknown): asserts value { if (!value) throw new Error("checkout_invalid_response"); }
export function parseMemberCheckoutCancellation(value: unknown): MemberCheckoutCancellation {
  need(object(value) && integer(value.pointsReturned, 99_999_999) && integer(value.couponsReturned, 20)
    && integer(value.stockReleased, 19_980) && date(value.cancelledAt));
  return { pointsReturned: value.pointsReturned, couponsReturned: value.couponsReturned, stockReleased: value.stockReleased, cancelledAt: value.cancelledAt };
}
/** Deliberate allowlist projection: private member IDs, claims, operation
 * fingerprints, point histories and coupon settlement codes never escape. */
export function parseMemberCheckoutResult(value: unknown, scope: { siteId: string; operationKey: string }): MemberCheckoutResult {
  need(object(value) && value.version === 1 && value.siteId === scope.siteId && value.operationKey === scope.operationKey
    && ["booking", "order"].includes(String(value.resourceKind)) && typeof value.resourceId === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(value.resourceId)
    && integer(value.totalPoints, 99_999_999) && integer(value.couponCount, 20) && (value.totalPoints > 0 || value.couponCount > 0)
    && typeof value.closed === "boolean" && typeof value.cancellationAvailable === "boolean");
  let resource: MemberCheckoutResult["resource"] = null;
  if (value.resource !== null) {
    need(object(value.resource) && typeof value.resource.status === "string" && ["active", "pending", "confirmed", "completed", "no_show", "cancelled"].includes(value.resource.status) && date(value.resource.updatedAt));
    resource = { status: value.resource.status, updatedAt: value.resource.updatedAt };
  }
  let policy: MemberCheckoutResult["cancellationPolicy"] = null;
  if (value.cancellationPolicy !== null) {
    const p = value.cancellationPolicy;
    need(object(p) && typeof p.returnPoints === "boolean" && typeof p.returnCoupons === "boolean" && integer(p.advanceMinutes, 43_200)
      && (p.cancellableUntil === null || date(p.cancellableUntil)) && (value.resourceKind !== "booking" || date(p.cancellableUntil)));
    policy = { returnPoints: p.returnPoints, returnCoupons: p.returnCoupons, advanceMinutes: p.advanceMinutes, cancellableUntil: p.cancellableUntil };
  }
  const cancellation = value.cancellation === null ? null : parseMemberCheckoutCancellation(value.cancellation);
  need(value.closed === Boolean(cancellation) && (!cancellation || cancellation.pointsReturned <= value.totalPoints && cancellation.couponsReturned <= value.couponCount)
    && (!value.cancellationAvailable || !value.closed && policy !== null && resource !== null && ["active", "pending", "confirmed"].includes(resource.status)));
  return { version: 1, siteId: scope.siteId, operationKey: scope.operationKey, resourceKind: value.resourceKind as "booking" | "order", resourceId: value.resourceId, totalPoints: value.totalPoints,
    couponCount: value.couponCount, closed: value.closed, resource, cancellationAvailable: value.cancellationAvailable, cancellationPolicy: policy, cancellation };
}
