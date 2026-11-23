import { parseOnSitePendingReceipt, type OnSitePendingReceipt } from "./merchantCheckoutOnSiteTerms";
type Scope = { siteId: string; operationKey: string };
export type OnSiteCancellation = Scope & {
  version: 2; method: "on_site"; resourceKind: "booking" | "order"; resourceId: string;
  closed: true; pointsReturned: 0; cashReturnedMinor: 0; couponsReturned: number; stockReleased: number; cancelledAt: string;
};
export type OnSiteCheckoutResult = Scope & {
  version: 2; terms: OnSitePendingReceipt; resource: { status: string; updatedAt: string } | null; termsMatch: boolean;
  closed: boolean; cancellationAvailable: boolean;
  cancellationPolicy: { returnCoupons: boolean; advanceMinutes: number; cancellableUntil: string | null };
  collection: { amountMinor: number; currency: "eur"; recordedAt: string } | null;
  cancellation: OnSiteCancellation | null;
};
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v));
const integer = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
function need(v: unknown): asserts v { if (!v) throw new Error("checkout_invalid_response"); }
function scope(input: unknown): asserts input is Scope {
  if (!object(input) || typeof input.siteId !== "string" || !/^\d{8}$/.test(input.siteId)
    || typeof input.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(input.operationKey)) throw new Error("checkout_invalid_request");
}
export function parseOnSiteCancellation(raw: unknown, expected: Scope): OnSiteCancellation {
  scope(expected);
  need(object(raw) && raw.version === 2 && raw.method === "on_site" && raw.siteId === expected.siteId && raw.operationKey === expected.operationKey
    && ["booking", "order"].includes(String(raw.resourceKind)) && typeof raw.resourceId === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(raw.resourceId)
    && raw.closed === true && raw.pointsReturned === 0 && raw.cashReturnedMinor === 0 && integer(raw.couponsReturned, 1)
    && integer(raw.stockReleased, 999) && date(raw.cancelledAt));
  return { version: 2, method: "on_site", siteId: expected.siteId, operationKey: expected.operationKey,
    resourceKind: raw.resourceKind as "booking" | "order", resourceId: raw.resourceId, closed: true,
    pointsReturned: 0, cashReturnedMinor: 0, couponsReturned: raw.couponsReturned, stockReleased: raw.stockReleased, cancelledAt: raw.cancelledAt };
}
/** Deliberate whitelist. A merchant-recorded cash receipt is separate from the
 * immutable unpaid terms; business completion does not establish cash receipt. */
export function parseOnSiteCheckoutResult(raw: unknown, expected: Scope): OnSiteCheckoutResult {
  scope(expected);
  need(object(raw) && raw.version === 2 && raw.siteId === expected.siteId && raw.operationKey === expected.operationKey
    && typeof raw.closed === "boolean" && typeof raw.termsMatch === "boolean" && typeof raw.cancellationAvailable === "boolean");
  const terms = parseOnSitePendingReceipt(raw.terms), p = raw.cancellationPolicy;
  need(object(p) && typeof p.returnCoupons === "boolean" && integer(p.advanceMinutes, 43_200)
    && (p.cancellableUntil === null || date(p.cancellableUntil)) && (terms.resourceKind !== "booking" || date(p.cancellableUntil)));
  let resource: OnSiteCheckoutResult["resource"] = null, collection: OnSiteCheckoutResult["collection"] = null;
  if (raw.resource !== null) {
    need(object(raw.resource) && ["active", "pending", "confirmed", "completed", "no_show", "cancelled"].includes(String(raw.resource.status)) && date(raw.resource.updatedAt));
    resource = { status: raw.resource.status as string, updatedAt: raw.resource.updatedAt };
  }
  if (raw.collection !== null) {
    need(object(raw.collection) && integer(raw.collection.amountMinor, 99_999_999) && raw.collection.amountMinor > 0
      && raw.collection.amountMinor === terms.dueMinor && raw.collection.currency === "eur" && date(raw.collection.recordedAt));
    collection = { amountMinor: raw.collection.amountMinor, currency: "eur", recordedAt: raw.collection.recordedAt };
  }
  const cancellation = raw.cancellation === null ? null : parseOnSiteCancellation(raw.cancellation, expected);
  need(raw.closed === Boolean(cancellation) && !(collection && cancellation)
    && (!raw.termsMatch || resource !== null)
    && (!cancellation || cancellation.resourceId === terms.resourceId && cancellation.resourceKind === terms.resourceKind
      && cancellation.couponsReturned === (p.returnCoupons ? terms.couponCount : 0))
    && (!raw.cancellationAvailable || !raw.closed && collection === null && raw.termsMatch && resource !== null && ["active", "pending", "confirmed"].includes(resource.status)));
  return { version: 2, siteId: expected.siteId, operationKey: expected.operationKey, terms, resource, termsMatch: raw.termsMatch, closed: raw.closed, cancellationAvailable: raw.cancellationAvailable,
    cancellationPolicy: { returnCoupons: p.returnCoupons, advanceMinutes: p.advanceMinutes, cancellableUntil: p.cancellableUntil }, collection, cancellation };
}
