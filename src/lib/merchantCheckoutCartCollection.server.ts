import { NextResponse } from "next/server";
import { MerchantBusinessAccessError } from "./merchantBusinessActor.server";
import { authorizeCheckoutOwner, checkoutOwnerDependencies } from "./merchantCheckoutOwnerAccess.server";
import { isMemberCheckoutCartCollectionEnabled } from "./merchantCheckoutCartPilot.server";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { parseOnSiteCollectionReceipt } from "./merchantCheckoutOnSiteCollection";
import { parseCartCheckoutResult } from "./merchantCheckoutCartResult";
import { createServerSupabaseServiceClient } from "./superAdminServer";

const defaults = { ...checkoutOwnerDependencies, enabled: isMemberCheckoutCartCollectionEnabled,
  call: async (name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: { message?: string } | null }> => {
    const client = createServerSupabaseServiceClient(); if (!client) throw new Error("unavailable");
    return client.rpc(name, args).abortSignal(signal);
  } };
export type CartCollectionDependencies = typeof defaults;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie, Authorization",
  "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" } });
async function readBody(request: Request, signal: AbortSignal) {
  if (!request.body) throw new Error("invalid");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", abort, { once: true });
  try { for (;;) { const part = await reader.read(); if (signal.aborted) throw new Error("aborted"); if (part.done) break;
    size += part.value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error("invalid"); } text += decoder.decode(part.value, { stream: true }); }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
const frozen = (r: ReturnType<typeof parseCartCheckoutResult>) => JSON.stringify([r.siteId, r.operationKey, r.resourceId, r.method, r.currency, r.totalPoints, r.grossMinor, r.discountMinor, r.dueMinor, r.capturedMinor, r.couponCount, r.lines]);
/** One explicit full cart venue receipt, never a charge, refund or points
 * award. Independent owner/gate verification surrounds every read and write.
 * Only the financial RPC's own known rejection proves atomic no-write. */
export async function handleCartCollection(request: Request, overrides: Partial<CartCollectionDependencies> = {}) {
  const deps = { ...defaults, ...overrides }, started = Date.now(), signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
  let dispatched = false, siteId = "";
  const guard = () => { if (signal.aborted || Date.now() >= started + 12_000 || siteId && !deps.enabled(siteId)) throw new Error("unavailable"); };
  const bounded = async <T>(run: () => PromiseLike<T>) => {
    guard(); let abort = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { guard(); return run(); }), new Promise<never>((_, reject) => {
      abort = () => reject(new Error("unavailable")); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    })]); } finally { signal.removeEventListener("abort", abort); }
  };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (new URL(request.url).search || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "checkout_invalid_request" }, 400);
  let raw: unknown;
  try { raw = await bounded(() => readBody(request, signal)); } catch { return json({ error: signal.aborted ? "checkout_unavailable" : "checkout_invalid_request" }, signal.aborted ? 503 : 400); }
  if (!object(raw) || Object.keys(raw).length !== 5 || raw.received !== true || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId)
    || typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey) || typeof raw.expectedUpdatedAt !== "string" || raw.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(raw.expectedUpdatedAt))
    || !Number.isSafeInteger(raw.expectedDueMinor) || Number(raw.expectedDueMinor) < 1 || Number(raw.expectedDueMinor) > 99_999_999) return json({ error: "checkout_invalid_request" }, 400);
  siteId = raw.siteId; const operationKey = raw.operationKey, expectedUpdatedAt = raw.expectedUpdatedAt, amountMinor = raw.expectedDueMinor as number;
  if (!deps.enabled(siteId)) return json({ error: "checkout_disabled" }, 503);
  try {
    const owner = await bounded(() => authorizeCheckoutOwner(request, siteId, { ...deps, site: async id => {
      const site = await deps.site(id);
      if (!site?.permissionConfig?.allowOrderManagement) throw new MerchantBusinessAccessError("permission_denied", 403);
      return site;
    } })); guard();
    const hint = request.headers.get("x-checkout-owner-scope"); if (hint !== null && hint !== owner.identityKey) throw new MerchantBusinessAccessError("permission_denied", 403);
    const authorize = async () => { await bounded(owner.reauthorize); guard(); };
    const read = async () => {
      const response = await bounded(() => deps.call("faolla_checkout_cart_collection_read_v1", { p_site_id: siteId, p_operation_key: operationKey }, signal)); guard();
      if (response.error || response.data === null) throw new Error("unavailable"); return parseCartCheckoutResult(response.data, { siteId, operationKey });
    };
    await authorize(); const original = await read(); await authorize();
    if (original.reviewRequired || original.closed || !original.resource || !["pending", "confirmed", "completed"].includes(original.resource.status)) return json({ error: "checkout_collection_review_required" }, 409);
    if (original.method !== "on_site" || original.dueMinor !== amountMinor) return json({ error: "checkout_collection_not_allowed" }, 409);
    if (original.collection) return json({ ok: true, receipt: { version: 1, siteId, operationKey, resourceKind: "order", resourceId: original.resourceId, replayed: true, ...original.collection } });
    if (original.resource.updatedAt !== expectedUpdatedAt) return json({ error: "checkout_conflict" }, 409);
    await authorize(); if (Date.now() >= started + 11_000) throw new Error("expired");
    dispatched = true;
    const response = await bounded(() => deps.call("faolla_checkout_cart_collect_v1", { p_site_id: siteId, p_operation_key: operationKey, p_actor_key: owner.actorKey,
      p_expected_updated_at: expectedUpdatedAt, p_expected_due_minor: amountMinor, p_not_after: new Date(started + 11_000).toISOString() }, signal)); guard();
    if (response.error) {
      const code = response.error.message;
      if (["checkout_conflict", "checkout_collection_not_allowed", "checkout_collection_review_required", "checkout_not_found", "checkout_disabled"].includes(code ?? "")) return json({ error: code }, code === "checkout_disabled" ? 503 : 409);
      throw new Error("unconfirmed");
    }
    await authorize(); const receipt = parseOnSiteCollectionReceipt(response.data, { siteId, operationKey, amountMinor });
    if (receipt.resourceKind !== "order" || receipt.resourceId !== original.resourceId) throw new Error("unconfirmed");
    const final = await read(); await authorize();
    if (frozen(final) !== frozen(original) || final.reviewRequired || final.closed || !final.collection || final.collection.amountMinor !== receipt.amountMinor
      || final.collection.recordedAt !== receipt.recordedAt) throw new Error("unconfirmed");
    return json({ ok: true, receipt });
  } catch (error) {
    if (!dispatched && error instanceof MerchantBusinessAccessError) return json({ error: error.code }, error.status);
    return json({ error: dispatched ? "checkout_unconfirmed" : "checkout_unavailable" }, 503);
  }
}
