import { checkoutPrincipalKey, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";
import { parseOnSitePendingReceipt, type OnSitePendingReceipt } from "./merchantCheckoutOnSitePending.server";
import type { MemberCheckoutResultRpc } from "./merchantMemberCheckoutResult.server";

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

// authorize must resolve the current verified, non-paused personal session;
// call must use a bounded transport. Neither port accepts browser identity.
type Ports = { authorize(): Promise<CheckoutPrincipal | null>; call: MemberCheckoutResultRpc };
async function authorize(ports: Ports) {
  const principal = await ports.authorize();
  if (!principal) throw new Error("checkout_unauthorized");
  return checkoutPrincipalKey(principal);
}
/** Explicit injected ports only: no live client, env fallback, default IO or
 * production enablement. Never accept principal/member identity from a body. */
export async function readOnSiteCheckoutResult(input: Scope, ports: Ports) {
  scope(input);
  if (Object.keys(input).length !== 2) throw new Error("checkout_invalid_request");
  const stable = { ...input }, principalKey = await authorize(ports);
  const result = await Promise.resolve().then(() => ports.call("faolla_member_checkout_on_site_result_v1", { p_site_id: stable.siteId, p_operation_key: stable.operationKey, p_principal_key: principalKey }))
    .catch(() => { throw new Error("checkout_unavailable"); });
  if (await authorize(ports) !== principalKey) throw new Error("checkout_identity_changed");
  if (!object(result) || !Object.hasOwn(result, "data") || !Object.hasOwn(result, "error")
    || result.error !== null && !object(result.error)) throw new Error("checkout_unavailable");
  if (result.error) throw new Error("checkout_unavailable");
  return result.data === null ? null : parseOnSiteCheckoutResult(result.data, stable);
}
const known = new Set(["checkout_not_found", "checkout_conflict", "checkout_cancellation_review_required", "checkout_cancellation_not_allowed",
  "checkout_cancellation_deadline", "checkout_cancellation_requires_refund", "booking_atomic_inactive"]);
/** One original cancellation, no retry/compensation. If authorization changes
 * or response is lost AFTER dispatch, retain the original key and reconcile. */
export async function cancelOnSiteCheckout(input: Scope & { expectedUpdatedAt: string }, ports: Ports) {
  scope(input);
  if (Object.keys(input).length !== 3 || !date(input.expectedUpdatedAt)) throw new Error("checkout_invalid_request");
  const stable = { ...input }, principalKey = await authorize(ports);
  const result = await Promise.resolve().then(() => ports.call("faolla_member_checkout_on_site_cancel_v1", {
    p_site_id: stable.siteId, p_operation_key: stable.operationKey, p_principal_key: principalKey, p_expected_updated_at: stable.expectedUpdatedAt,
  })).catch(() => { throw new Error("checkout_unconfirmed"); });
  try { if (await authorize(ports) !== principalKey) throw new Error("checkout_identity_changed"); }
  catch { throw new Error("checkout_unconfirmed"); }
  if (!object(result) || !Object.hasOwn(result, "data") || !Object.hasOwn(result, "error")
    || result.error !== null && !object(result.error)) throw new Error("checkout_unconfirmed");
  if (result.error) {
    const error = result.error.message ?? "";
    if (["order_update_conflict", "merchant_memberships_conflict", "merchant_membership_settings_conflict", "merchant_coupons_conflict"].includes(error)) throw new Error("checkout_conflict");
    throw new Error(known.has(error) ? error : "checkout_unconfirmed");
  }
  try {
    need(object(result.data) && typeof result.data.replayed === "boolean");
    return { replayed: result.data.replayed, cancellation: parseOnSiteCancellation(result.data.receipt, stable) };
  } catch { throw new Error("checkout_unconfirmed"); }
}
