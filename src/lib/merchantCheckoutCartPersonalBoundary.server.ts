import { checkoutPrincipalKey, MerchantCheckoutError } from "./merchantCheckoutQuote.server";
import { parseCartCheckoutResult, type CartCheckoutResult } from "./merchantCheckoutCartResult";
import { normalizeMerchantOrderRecord, type MerchantOrderRecord } from "./merchantOrders";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import type { CheckoutLegacyBoundaryInput } from "./merchantCheckoutLegacyBoundary.server";
import type { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";

export type CartPersonalBoundaryDependencies = {
  enabled(siteId: string): boolean;
  session: typeof resolvePersonalAccountSessionFromRequest;
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const immutable = (r: CartCheckoutResult) => JSON.stringify([r.siteId, r.operationKey, r.resourceId, r.method, r.currency, r.totalPoints, r.grossMinor, r.discountMinor, r.dueMinor, r.capturedMinor, r.couponCount, r.lines]);
const rejectionCodes = new Set(["checkout_not_found", "checkout_conflict", "checkout_cancellation_review_required", "checkout_cancellation_not_allowed", "checkout_cancellation_requires_refund"]);
function personalKey(session: Awaited<ReturnType<CartPersonalBoundaryDependencies["session"]>>) {
  const verified = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
  if (!session || session.servicePaused || typeof verified !== "string" || !Number.isFinite(Date.parse(verified))) return null;
  try { return checkoutPrincipalKey(session); } catch { return null; }
}
function parseLink(raw: unknown, siteId: string, orderId: string, principal: string) {
  if (raw === null) return null;
  if (!object(raw) || raw.siteId !== siteId || raw.kind !== "order" || raw.id !== orderId || typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey)
    || !object(raw.record) || raw.record.id !== orderId || raw.record.siteId !== siteId || typeof raw.refundRequired !== "boolean"
    || raw.record.customerAccountId !== principal.split(":")[1] || raw.record.customerUserId !== principal.split(":")[2]) throw new Error("invalid");
  const result = parseCartCheckoutResult(raw.cart, { siteId, operationKey: raw.operationKey });
  if (result.resourceId !== orderId || !result.resource || result.resource.status !== raw.record.status || result.resource.updatedAt !== raw.record.updatedAt) throw new Error("invalid");
  const record = normalizeMerchantOrderRecord(raw.record as Partial<MerchantOrderRecord>);
  if (!record) throw new Error("invalid");
  return { record, result, refundRequired: raw.refundRequired };
}
/** Existing personal /api/orders PATCH, strict original account ownership.
 * null is reserved for an explicitly unlinked/old-single record. Once a cart
 * is found, no old writer, email/guest match or fallback may cancel it. */
export async function bridgeCartCheckoutPersonalCancellation(input: CheckoutLegacyBoundaryInput, deps: CartPersonalBoundaryDependencies): Promise<{ kind: "order"; record: MerchantOrderRecord } | null> {
  if (input.mode !== "personal" || input.kind !== "order" || !input.siteId || !deps.enabled(input.siteId)
    || !input.ids.some(id => /^[A-Za-z0-9:_-]{1,160}$/.test(id))) return null;
  const siteId = input.siteId, started = Date.now(), signal = AbortSignal.any([input.request.signal, AbortSignal.timeout(12_000)]);
  let dispatched = false, atomicRejection: MerchantCheckoutError | null = null;
  const guard = () => { if (signal.aborted || Date.now() >= started + 12_000 || !deps.enabled(siteId)) throw new Error("unavailable"); };
  const bounded = async <T>(run: () => PromiseLike<T>): Promise<T> => {
    guard(); let abort = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { guard(); return run(); }), new Promise<never>((_, reject) => {
      abort = () => reject(new Error("unavailable")); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    })]); } finally { signal.removeEventListener("abort", abort); }
  };
  const call = async (name: string, args: Record<string, unknown>, writing = false) => {
    const response = await bounded(() => deps.call(name, args, signal)); guard();
    if (!object(response) || !Object.hasOwn(response, "data") || response.error !== null && !object(response.error)) throw new Error("invalid");
    if (response.error) {
      const code = response.error.message === "checkout_refund_required" ? "checkout_cancellation_requires_refund" : response.error.message === "checkout_quote_expired" ? "checkout_conflict" : response.error.message;
      if (rejectionCodes.has(code ?? "")) {
        const error = new MerchantCheckoutError(code!, code === "checkout_not_found" ? 404 : 409);
        if (writing) atomicRejection = error;
        throw error;
      }
      throw new Error("unavailable");
    }
    return response.data;
  };
  try {
    if (input.request.method !== "PATCH" || !isTrustedSameOriginMutationRequest(input.request) || input.request.headers.has("x-merchant-access-token") || !/^\d{8}$/.test(siteId)) throw new MerchantCheckoutError("checkout_unauthorized", 401);
    if (input.batch || input.ids.length !== 1) throw new MerchantCheckoutError("checkout_batch_requires_single", 409);
    const principal = personalKey(await bounded(() => deps.session(input.request))); guard();
    // Do not broaden the new protocol to old unverified/guest identities.
    // The unchanged single boundary still rejects linked originals for them.
    if (!principal) return null;
    const hint = input.request.headers.get("x-checkout-account-scope");
    if (hint !== null && hint !== principal.split(":")[1]) throw new MerchantCheckoutError("checkout_unauthorized", 401);
    const authorize = async () => {
      if (personalKey(await bounded(() => deps.session(input.request))) !== principal) throw new MerchantCheckoutError("checkout_unauthorized", 401);
      guard();
    };
    const read = async () => parseLink(await call("faolla_checkout_cart_personal_resource_link_v1", { p_site_id: siteId, p_id: input.ids[0], p_principal_key: principal }), siteId, input.ids[0], principal);
    const link = await read(); await authorize(); if (!link) return null;
    const original = link.result;
    if (input.action !== "cancel" || input.status !== undefined && input.status !== "cancelled" || input.items !== undefined || input.updates !== undefined
      || input.bookingBlockId !== undefined || input.bookingViewport !== undefined) throw new MerchantCheckoutError("checkout_change_requires_review", 409);
    if (original.reviewRequired) throw new MerchantCheckoutError("checkout_cancellation_review_required", 409);
    if (link.refundRequired || original.collection) throw new MerchantCheckoutError("checkout_cancellation_requires_refund", 409);
    if (original.closed) return { kind: "order", record: link.record };
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== original.resource!.updatedAt) throw new MerchantCheckoutError("checkout_conflict", 409);
    if (!original.cancellationAvailable) throw new MerchantCheckoutError("checkout_cancellation_not_allowed", 409);
    await authorize(); guard(); if (Date.now() >= started + 11_000) throw new Error("expired");
    dispatched = true;
    const raw = await call("faolla_member_checkout_cart_cancel_v1", { p_site_id: siteId, p_operation_key: original.operationKey, p_principal_key: principal,
      p_expected_updated_at: original.resource!.updatedAt, p_not_after: new Date(started + 11_000).toISOString() }, true);
    await authorize();
    if (!object(raw) || typeof raw.replayed !== "boolean") throw new Error("invalid");
    const result = parseCartCheckoutResult(raw.result, original);
    if (!result.closed || result.resource?.status !== "cancelled" || result.reviewRequired || immutable(result) !== immutable(original)) throw new Error("invalid");
    const final = await read(); await authorize();
    if (!final || !final.result.closed || final.result.resource?.status !== "cancelled" || final.result.reviewRequired || final.refundRequired
      || immutable(final.result) !== immutable(original) || JSON.stringify(final.result.cancellation) !== JSON.stringify(result.cancellation)) throw new Error("invalid");
    return { kind: "order", record: final.record };
  } catch (error) {
    if (error instanceof MerchantCheckoutError && (!dispatched || error === atomicRejection)) throw error;
    throw new MerchantCheckoutError(dispatched ? "checkout_unconfirmed" : "checkout_unavailable", 503);
  }
}
