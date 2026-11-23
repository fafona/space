import { parseCartCheckoutResult, type CartCheckoutResult } from "./merchantCheckoutCartResult";
import { parseCheckoutReportingSnapshot } from "./merchantCheckoutReporting";
import { normalizeMerchantOrderRecord, type MerchantOrderRecord } from "./merchantOrders";
import { MerchantCheckoutError } from "./merchantCheckoutQuote.server";
import { checkoutOwnerDependencies } from "./merchantCheckoutOwnerAccess.server";
import { getMerchantServiceState } from "./merchantServiceStatus";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import type { MerchantBusinessActor } from "./merchantBusinessActor.server";
import type { CheckoutLegacyBoundaryInput } from "./merchantCheckoutLegacyBoundary.server";

export type CartManagementDependencies = {
  enabled(siteId: string): boolean;
  actor: typeof checkoutOwnerDependencies.actor;
  site: typeof checkoutOwnerDependencies.site;
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(v);
const actorKey = (a: MerchantBusinessActor) => JSON.stringify([a.type, a.siteId, a.authUserId, a.principalKey, a.authorizationVersion, a.businessPermissions, a.collaborationPermissions]);
const immutable = (r: CartCheckoutResult) => JSON.stringify([r.siteId, r.operationKey, r.resourceId, r.method, r.currency, r.totalPoints, r.grossMinor, r.discountMinor, r.dueMinor, r.capturedMinor, r.couponCount, r.lines]);
const safe = new Set(["checkout_not_found", "checkout_conflict", "checkout_cancellation_review_required", "checkout_cancellation_not_allowed", "checkout_cancellation_requires_refund"]);
type Link = { record: MerchantOrderRecord; result: CartCheckoutResult; refundRequired: boolean };
function parseLink(raw: unknown, siteId: string, orderId: string): Link | null {
  if (raw === null) return null;
  if (!object(raw) || raw.siteId !== siteId || raw.kind !== "order" || raw.id !== orderId || typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey)
    || !object(raw.record) || raw.record.id !== orderId || raw.record.siteId !== siteId || typeof raw.refundRequired !== "boolean") throw new Error("invalid");
  const result = parseCartCheckoutResult(raw.cart, { siteId, operationKey: raw.operationKey });
  if (result.resourceId !== orderId || !result.resource || result.resource.status !== raw.record.status || result.resource.updatedAt !== raw.record.updatedAt) throw new Error("invalid");
  const record = normalizeMerchantOrderRecord(raw.record as Partial<MerchantOrderRecord>);
  if (!record) throw new Error("invalid");
  return { record, result, refundRequired: raw.refundRequired };
}
/** The existing merchant PATCH remains the usage path. A positive linked
 * result never falls back to a raw legacy cancellation. Authority is resolved
 * from the actual request, not the customer principal or a browser receipt.
 * Off/unlinked/single originals keep the original bridge. */
export async function bridgeCartCheckoutManagement(input: CheckoutLegacyBoundaryInput, deps: CartManagementDependencies): Promise<{
  linked: boolean; value: { kind: "order"; record: MerchantOrderRecord } | null;
}> {
  const none = { linked: false, value: null };
  if (input.mode !== "merchant" || input.kind !== "order" || !input.siteId || !deps.enabled(input.siteId)) return none;
  const siteId = input.siteId, ids = [...new Set(input.ids)].filter(id);
  if (!ids.length) return none;
  const started = Date.now(), deadline = started + 12_000, signal = AbortSignal.any([input.request.signal, AbortSignal.timeout(12_000)]);
  let dispatched = false;
  let atomicRejection: MerchantCheckoutError | null = null;
  const signature = input.actor ? actorKey(input.actor) : null;
  let serviceSignature: string | null = null;
  const guard = () => { if (signal.aborted || Date.now() >= deadline || !deps.enabled(siteId)) throw new Error("unavailable"); };
  const bounded = async <T>(run: () => PromiseLike<T>): Promise<T> => {
    guard(); let abort: () => void = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { guard(); return run(); }), new Promise<never>((_, reject) => {
      abort = () => reject(new Error("unavailable")); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    })]); } finally { signal.removeEventListener("abort", abort); }
  };
  const authorize = async () => {
    await bounded(async () => { await input.assertAuthorizationCurrent?.(); });
    const current = await bounded(() => deps.actor(input.request, { siteId }));
    const site = await bounded(() => deps.site(siteId)); guard();
    if (!signature || actorKey(current) !== signature || current.siteId !== siteId || !site || site.id !== siteId || site.status !== "online"
      || getMerchantServiceState(site.status, site.serviceExpiresAt).reason !== null) throw new MerchantCheckoutError("checkout_unauthorized", 401);
    const stamp = JSON.stringify([site.permissionConfig, site.serviceExpiresAt]);
    if (serviceSignature !== null && stamp !== serviceSignature) throw new MerchantCheckoutError("checkout_unauthorized", 401);
    serviceSignature = stamp; return current;
  };
  const call = async (name: string, args: Record<string, unknown>, writing = false) => {
    guard(); const response = await bounded(() => deps.call(name, args, signal)); guard();
    if (!object(response) || !Object.hasOwn(response, "data") || response.error !== null && !object(response.error)) throw new Error("invalid");
    if (response.error) {
      const code = response.error.message === "checkout_refund_required" ? "checkout_cancellation_requires_refund" : response.error.message;
      if (safe.has(code ?? "") || writing && code === "checkout_quote_expired") {
        const rejection = new MerchantCheckoutError(code === "checkout_quote_expired" ? "checkout_conflict" : code!, code === "checkout_not_found" ? 404 : 409);
        // Only this financial RPC's explicit atomic rejection proves that no
        // cancellation happened. A later read/auth error cannot undo success.
        if (writing) atomicRejection = rejection;
        throw rejection;
      }
      throw new Error("unavailable");
    } return response.data;
  };
  const read = async (orderId: string) => parseLink(await call("faolla_checkout_cart_resource_link_v1", { p_site_id: siteId, p_id: orderId }), siteId, orderId);
  try {
    if (input.request.method !== "PATCH" || !isTrustedSameOriginMutationRequest(input.request) || !/^\d{8}$/.test(siteId) || ids.length > 1000) throw new MerchantCheckoutError("checkout_unauthorized", 401);
    const actor = await authorize();
    const cancelling = input.action === "cancel" || input.status === "cancelled";
    if (input.batch || input.ids.length > 1) {
      let cart = false;
      for (let offset = 0; offset < ids.length; offset += 50) {
        const scope = { siteId, resources: ids.slice(offset, offset + 50).map(id => ({ kind: "order" as const, id })) };
        const report = parseCheckoutReportingSnapshot(await call("faolla_member_checkout_reporting_v3", { p_site_id: siteId, p_resources: scope.resources }), scope);
        if (report.version !== 3) throw new Error("invalid"); cart ||= report.rows.some(row => !!row.cart);
      }
      await authorize();
      if (!cart) return none;
      if (cancelling || input.action === "restore" || input.action === "uncomplete" || input.items !== undefined || input.updates !== undefined) throw new MerchantCheckoutError("checkout_batch_requires_single", 409);
      return { linked: true, value: null };
    }
    const link = await read(ids[0]); await authorize(); if (!link) return none;
    const original = link.result;
    if (input.items !== undefined || input.updates !== undefined || input.bookingBlockId !== undefined || input.bookingViewport !== undefined
      || input.action !== undefined && input.status !== undefined && (input.action !== "cancel" || input.status !== "cancelled")) throw new MerchantCheckoutError("checkout_change_requires_review", 409);
    if (original.closed && !cancelling && input.action !== "touch" && input.action !== "print" && (input.status !== undefined || input.action !== undefined)) throw new MerchantCheckoutError("checkout_original_cancellation_required", 409);
    if (!cancelling) {
      if (original.reviewRequired) throw new MerchantCheckoutError("checkout_cancellation_review_required", 409);
      return { linked: true, value: null }; // business status != cash receipt
    }
    if (actor.type !== "owner") throw new MerchantCheckoutError("checkout_owner_required", 403);
    if (link.refundRequired) throw new MerchantCheckoutError("checkout_cancellation_requires_refund", 409);
    if (original.reviewRequired) throw new MerchantCheckoutError("checkout_cancellation_review_required", 409);
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== original.resource!.updatedAt && !original.closed) throw new MerchantCheckoutError("checkout_conflict", 409);
    if (original.closed) return { linked: true, value: { kind: "order", record: link.record } };
    if (!original.cancellationAvailable) throw new MerchantCheckoutError("checkout_cancellation_not_allowed", 409);
    await authorize(); guard(); if (Date.now() >= started + 11_000) throw new Error("expired");
    dispatched = true;
    const raw = await call("faolla_checkout_cart_merchant_cancel_v1", { p_site_id: siteId, p_operation_key: original.operationKey, p_actor_key: actor.principalKey,
      p_expected_updated_at: original.resource!.updatedAt, p_not_after: new Date(started + 11_000).toISOString() }, true);
    await authorize();
    if (!object(raw) || typeof raw.replayed !== "boolean") throw new Error("invalid");
    const result = parseCartCheckoutResult(raw.result, original);
    if (!result.closed || result.resource?.status !== "cancelled" || result.reviewRequired || immutable(result) !== immutable(original)) throw new Error("invalid");
    const final = await read(ids[0]); await authorize();
    if (!final || !final.result.closed || final.result.resource?.status !== "cancelled" || final.result.reviewRequired || final.refundRequired
      || immutable(final.result) !== immutable(original) || JSON.stringify(final.result.cancellation) !== JSON.stringify(result.cancellation)) throw new Error("invalid");
    return { linked: true, value: { kind: "order", record: final.record } };
  } catch (error) {
    if (error instanceof MerchantCheckoutError && (!dispatched || error === atomicRejection)) throw error;
    throw new MerchantCheckoutError(dispatched ? "checkout_unconfirmed" : "checkout_unavailable", 503);
  }
}
