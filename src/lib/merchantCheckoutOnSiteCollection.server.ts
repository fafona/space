import { NextResponse } from "next/server";
import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";
import { MerchantBusinessAccessError } from "./merchantBusinessActor.server";
import { authorizeCheckoutOwner, checkoutOwnerDependencies } from "./merchantCheckoutOwnerAccess.server";
import { isMemberCheckoutOnSiteCollectionEnabled } from "./merchantCheckoutOnSitePilot.server";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { parseOnSiteCollectionReceipt } from "./merchantCheckoutOnSiteCollection";
const defaults = { ...checkoutOwnerDependencies, enabled: isMemberCheckoutOnSiteCollectionEnabled,
  call: async (args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: { message?: string } | null }> => {
    const client = createServerMerchantCheckoutRuntimeClient(); if (!client) throw new Error("unavailable");
    return client.rpc("faolla_checkout_on_site_collect_v1", args).abortSignal(signal);
  } };
export type OnSiteCollectionDependencies = typeof defaults;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie, Authorization",
  "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" } });
async function body(request: Request) {
  if (!request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("invalid");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
    if (bytes > 4096) { await reader.cancel(); throw new Error("invalid"); } text += decoder.decode(part.value, { stream: true }); }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally { reader.releaseLock(); }
}
/** Explicit full receipt registration, never an online charge/refund or a
 * permission derived from booking/order editing. Exactly one write attempt. */
export async function handleOnSiteCollection(request: Request, overrides: Partial<OnSiteCollectionDependencies> = {}) {
  const deps = { ...defaults, ...overrides }; let dispatched = false;
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  let raw: unknown;
  try { if (new URL(request.url).search) throw new Error("invalid"); raw = await body(request); } catch { return json({ error: "checkout_invalid_request" }, 400); }
  const r = raw as { siteId?: unknown; operationKey?: unknown; expectedUpdatedAt?: unknown; expectedDueMinor?: unknown; received?: unknown } | null;
  if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length !== 5 || r.received !== true
    || typeof r.siteId !== "string" || !/^\d{8}$/.test(r.siteId) || typeof r.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(r.operationKey)
    || typeof r.expectedUpdatedAt !== "string" || r.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(r.expectedUpdatedAt))
    || typeof r.expectedDueMinor !== "number" || !Number.isSafeInteger(r.expectedDueMinor) || r.expectedDueMinor < 1 || r.expectedDueMinor > 99_999_999) return json({ error: "checkout_invalid_request" }, 400);
  const { siteId, operationKey, expectedUpdatedAt, expectedDueMinor } = r;
  if (!deps.enabled(siteId)) return json({ error: "checkout_disabled" }, 503);
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]), owner = await authorizeCheckoutOwner(request, siteId, deps);
    const expected = request.headers.get("x-checkout-owner-scope");
    if (expected !== null && expected !== owner.identityKey) throw new MerchantBusinessAccessError("permission_denied", 403);
    await owner.reauthorize(); if (signal.aborted || !deps.enabled(siteId)) throw new Error("unavailable");
    dispatched = true;
    const response = await deps.call({ p_site_id: siteId, p_operation_key: operationKey, p_actor_key: owner.actorKey, p_expected_updated_at: expectedUpdatedAt,
      p_expected_due_minor: expectedDueMinor, p_not_after: new Date(Date.now() + 12_000).toISOString() }, signal);
    if (response.error) {
      const code = response.error.message;
      if (["checkout_conflict", "checkout_collection_not_allowed", "checkout_collection_review_required", "checkout_not_found"].includes(code ?? "")) return json({ error: code }, 409);
      throw new Error("unconfirmed");
    }
    await owner.reauthorize(); if (signal.aborted || !deps.enabled(siteId)) throw new Error("unconfirmed");
    return json({ ok: true, receipt: parseOnSiteCollectionReceipt(response.data, { siteId, operationKey, amountMinor: expectedDueMinor }) });
  } catch (error) {
    if (!dispatched && error instanceof MerchantBusinessAccessError) return json({ error: error.code }, error.status);
    return json({ error: dispatched ? "checkout_unconfirmed" : "checkout_unavailable" }, 503);
  }
}
