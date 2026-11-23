import { parseMemberCheckoutCancellation, type MemberCheckoutCancellation } from "./merchantMemberCheckoutResult";

export type CartResultLine = { offerId: string; offerRevision: string; productId: string; title: string; quantity: number;
  points: number | null; grossMinor: number | null; discountMinor: number | null; dueMinor: number | null;
  returnPoints: boolean; returnCoupons: boolean; couponCount: number };
export type CartCheckoutResult = { version: 3; purpose: "product_cart_result"; siteId: string; operationKey: string; resourceKind: "order"; resourceId: string;
  method: "points" | "on_site"; currency: "eur" | null; totalPoints: number | null; grossMinor: number | null; discountMinor: number | null; dueMinor: number | null;
  capturedMinor: 0; couponCount: number; lines: CartResultLine[]; closed: boolean; reviewRequired: boolean; cancellationAvailable: boolean;
  resource: { status: string; updatedAt: string } | null; cancellation: MemberCheckoutCancellation | null };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, max = 99_999_999): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const date = (v: unknown): v is string => typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v));
function need(v: unknown): asserts v { if (!v) throw new Error("checkout_invalid_response"); }

/** Whitelist only; never return member IDs, claims/codes, raw orders, contacts,
 * internal transactions, stock bindings or original request fingerprints. */
export function parseCartCheckoutResult(raw: unknown, scope: { siteId: string; operationKey: string }): CartCheckoutResult {
  need(object(raw) && raw.version === 3 && raw.purpose === "product_cart_result" && raw.siteId === scope.siteId && raw.operationKey === scope.operationKey
    && raw.resourceKind === "order" && typeof raw.resourceId === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(raw.resourceId)
    && (raw.method === "points" || raw.method === "on_site") && raw.capturedMinor === 0 && integer(raw.couponCount, 20)
    && typeof raw.closed === "boolean" && typeof raw.reviewRequired === "boolean" && typeof raw.cancellationAvailable === "boolean"
    && Array.isArray(raw.lines) && raw.lines.length > 0 && raw.lines.length <= 20);
  const points = raw.method === "points", seen = new Set<string>();
  const lines: CartResultLine[] = raw.lines.map(line => {
    need(object(line) && uuid(line.offerId) && uuid(line.offerRevision) && typeof line.productId === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(line.productId)
      && typeof line.title === "string" && line.title.length > 0 && line.title.length <= 200 && integer(line.quantity, 999) && line.quantity > 0
      && typeof line.returnPoints === "boolean" && typeof line.returnCoupons === "boolean" && integer(line.couponCount, 20) && !seen.has(line.productId)); seen.add(line.productId);
    need(points ? integer(line.points) && line.grossMinor === null && line.discountMinor === null && line.dueMinor === null
      : line.points === null && integer(line.grossMinor) && integer(line.discountMinor) && integer(line.dueMinor) && line.grossMinor === line.discountMinor + line.dueMinor);
    return { offerId: line.offerId, offerRevision: line.offerRevision, productId: line.productId, title: line.title, quantity: line.quantity,
      points: line.points as number | null, grossMinor: line.grossMinor as number | null, discountMinor: line.discountMinor as number | null, dueMinor: line.dueMinor as number | null,
      returnPoints: line.returnPoints, returnCoupons: line.returnCoupons, couponCount: line.couponCount };
  });
  need(new Set(lines.map(line => line.offerId)).size === lines.length && lines.reduce((s, l) => s + l.quantity, 0) <= 999
    && lines.reduce((s, l) => s + l.couponCount, 0) === raw.couponCount);
  need(points ? raw.currency === null && integer(raw.totalPoints) && (raw.totalPoints > 0 || raw.couponCount > 0)
    && raw.totalPoints === lines.reduce((s, l) => s + l.points!, 0) && raw.grossMinor === null && raw.discountMinor === null && raw.dueMinor === null
    : raw.currency === "eur" && raw.totalPoints === null && integer(raw.grossMinor) && raw.grossMinor > 0 && integer(raw.discountMinor) && integer(raw.dueMinor)
      && raw.grossMinor === raw.discountMinor + raw.dueMinor && raw.grossMinor === lines.reduce((s, l) => s + l.grossMinor!, 0)
      && raw.discountMinor === lines.reduce((s, l) => s + l.discountMinor!, 0) && raw.dueMinor === lines.reduce((s, l) => s + l.dueMinor!, 0));
  let resource: CartCheckoutResult["resource"] = null;
  if (raw.resource !== null) { need(object(raw.resource) && typeof raw.resource.status === "string" && ["pending", "confirmed", "completed", "cancelled"].includes(raw.resource.status) && date(raw.resource.updatedAt));
    resource = { status: raw.resource.status, updatedAt: raw.resource.updatedAt }; }
  const cancellation = raw.cancellation === null ? null : parseMemberCheckoutCancellation(raw.cancellation);
  need(raw.closed === Boolean(cancellation) && (!cancellation || cancellation.pointsReturned <= ((raw.totalPoints ?? 0) as number) && cancellation.couponsReturned <= raw.couponCount)
    && (!cancellation || cancellation.pointsReturned === lines.reduce((s, l) => s + (l.returnPoints ? l.points ?? 0 : 0), 0)
      && cancellation.couponsReturned === lines.reduce((s, l) => s + (l.returnCoupons ? l.couponCount : 0), 0) && cancellation.stockReleased <= lines.reduce((s, l) => s + l.quantity, 0))
    && (raw.reviewRequired || resource !== null && raw.closed === (resource.status === "cancelled"))
    && (!raw.cancellationAvailable || !raw.reviewRequired && !raw.closed && resource !== null && ["pending", "confirmed"].includes(resource.status)));
  return { version: 3, purpose: "product_cart_result", siteId: scope.siteId, operationKey: scope.operationKey, resourceKind: "order", resourceId: raw.resourceId,
    method: raw.method, currency: points ? null : "eur", totalPoints: raw.totalPoints as number | null, grossMinor: raw.grossMinor as number | null,
    discountMinor: raw.discountMinor as number | null, dueMinor: raw.dueMinor as number | null, capturedMinor: 0, couponCount: raw.couponCount, lines,
    closed: raw.closed, reviewRequired: raw.reviewRequired, cancellationAvailable: raw.cancellationAvailable, resource, cancellation };
}
