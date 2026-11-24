import { NextResponse } from "next/server";
import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { checkoutPrincipalKey, MerchantCheckoutError } from "./merchantCheckoutQuote.server";
import { checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";
import { parseCartSubmissionRequest } from "./merchantCheckoutCartSubmissionPlan.server";
import { cancelCartCheckout, previewCartSubmission, submitCartCheckout } from "./merchantCheckoutCartSubmission.server";
import { parseCartCheckoutResult } from "./merchantCheckoutCartResult";
import { parseCheckoutOriginalResult } from "./merchantCheckoutOriginalResult";
import { isMemberCheckoutCartPilotEnabled, isMemberCheckoutIntentPilotEnabled } from "./merchantCheckoutCartPilot.server";

export type CartHttpAction = "preview" | "submit" | "recover" | "result" | "cancel";
const defaults = { session: resolvePersonalAccountSessionFromRequest, enabled: isMemberCheckoutCartPilotEnabled,
  call: async (name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: { message?: string } | null }> => {
    const client = createServerMerchantCheckoutRuntimeClient(); if (!client) throw new Error("checkout_unavailable");
    return client.rpc(name, args).abortSignal(signal);
  } };
export type CartHttpDependencies = typeof defaults & { intentEnabled?: (siteId: string) => boolean };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const invalid = (): never => { throw new Error("checkout_invalid_request"); };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin", vary: "Cookie, Authorization" } });
const bad = new Set(["checkout_invalid_request", "checkout_invalid_cart", "checkout_invalid_selection", "checkout_invalid_customer", "checkout_invalid_coupon_selection"]);
const conflicts = new Set(["checkout_conflict", "checkout_quote_changed", "checkout_quote_expired", "checkout_operation_conflict", "checkout_offer_not_found",
  "checkout_membership_unavailable", "checkout_source_changed", "checkout_quantity_unavailable", "checkout_coupon_unavailable", "checkout_coupon_stack_not_allowed",
  "checkout_cart_coupon_reused", "checkout_cart_duplicate_product", "checkout_cart_source_mismatch", "checkout_cart_method_unavailable", "checkout_insufficient_points",
  "checkout_total_too_large", "checkout_cancellation_not_allowed", "checkout_cancellation_review_required", "checkout_refund_required", "checkout_original_pending", "checkout_intent_review_required"]);

/** New route family only. POST + exact origin + bounded streaming UTF-8 body;
 * actual verified/unpaused personal identity before/after every asynchronous
 * stage. No browser actor, financial totals or staff impersonation. */
export async function handleCartCheckout(action: CartHttpAction, request: Request, overrides: Partial<CartHttpDependencies> = {}) {
  const deps = { ...defaults, intentEnabled: isMemberCheckoutIntentPilotEnabled, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  if (request.headers.has("x-merchant-access-token")) return json({ error: "checkout_unauthorized" }, 401);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
  let dispatched = false;
  const bounded = async <T>(run: () => PromiseLike<T>): Promise<T> => {
    if (signal.aborted) throw new Error("checkout_unavailable");
    let abort: () => void = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { if (signal.aborted) throw new Error("checkout_unavailable"); return run(); }), new Promise<never>((_, reject) => {
      abort = () => reject(new Error("checkout_unavailable")); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    })]); } finally { signal.removeEventListener("abort", abort); }
  };
  try {
    if (new URL(request.url).search || !request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return invalid();
    const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", bytes = 0;
    try { while (true) { const part = await bounded(() => reader.read()); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 16_384) return invalid(); text += decoder.decode(part.value, { stream: true });
    } text += decoder.decode(); } catch (error) { if (signal.aborted) throw error; return invalid(); } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    let raw: unknown; try { raw = JSON.parse(text); } catch { return invalid(); }
    if (!object(raw) || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId)) return invalid();
    const siteId = raw.siteId, buying = action === "preview" || action === "submit", intentMode = deps.intentEnabled(siteId);
    const accountHint = request.headers.get("x-checkout-account-scope");
    if (intentMode && (!accountHint || !/^\d{8}$/.test(accountHint))) return json({ error: "checkout_unauthorized" }, 401);
    if (buying) parseCartSubmissionRequest(raw);
    else if (action === "recover") {
      if (Object.keys(raw).length !== 2 || typeof raw.nonce !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(raw.nonce)) return invalid();
    } else if (Object.keys(raw).length !== (action === "cancel" ? 3 : 2) || typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey)
      || action === "cancel" && (typeof raw.expectedUpdatedAt !== "string" || raw.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(raw.expectedUpdatedAt)))) return invalid();
    const method = raw.method === "on_site" ? "on_site" : "points";
    if (buying && !deps.enabled(siteId, method)) return json({ error: "checkout_disabled" }, 503);
    const authorize = async () => {
      const session = await bounded(() => deps.session(request)), stamp = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      if (signal.aborted) throw new Error("checkout_unavailable");
      return !session || session.servicePaused || intentMode && accountHint !== session.accountId || typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp)) ? null : { accountId: session.accountId, userId: session.userId };
    };
    const principal = await authorize(); if (!principal) return json({ error: "checkout_unauthorized" }, 401);
    const principalKey = checkoutPrincipalKey(principal);
    const call = async (name: string, args: Record<string, unknown>, inner: AbortSignal = signal) => bounded(async () => {
      if (inner.aborted || intentMode !== deps.intentEnabled(siteId) || buying && !deps.enabled(siteId, method)) throw new Error("checkout_unavailable");
      if (name === "faolla_member_checkout_cart_commit_v1" || name === "faolla_member_checkout_cart_cancel_v1") dispatched = true;
      const response = await deps.call(intentMode && name === "faolla_member_checkout_cart_commit_v1" ? "faolla_member_checkout_intent_cart_commit_v1" : name, args, AbortSignal.any([signal, inner]));
      if (signal.aborted || inner.aborted) throw new Error("checkout_unavailable"); return response;
    });
    const scope = { siteId, operationKey: action === "recover" ? checkoutSubmissionRecoveryIdentity(raw, principal).operationKey : raw.operationKey as string };
    const input = { principal, authorize, signal, enabled: (id: string) => deps.enabled(id, method) };
    let response: Record<string, unknown>;
    if (buying) response = await (action === "preview" ? previewCartSubmission : submitCartCheckout)({ ...input, request: raw }, call);
    else if (action === "cancel") response = await cancelCartCheckout(raw, input, call);
    else {
      const args = { p_site_id: siteId, p_operation_key: scope.operationKey, p_principal_key: principalKey };
      const read = await call("faolla_member_checkout_cart_result_v1", args);
      if (!object(read) || read.error !== null || !Object.hasOwn(read, "data")) throw new Error("checkout_unavailable");
      if (read.data !== null) response = { state: "confirmed", original: { kind: "cart", result: parseCartCheckoutResult(read.data, scope) } };
      else {
        // A previous single-item original uses the SAME nonce key. This older
        // SQL projection returns only versions 1/2; a concurrent cart commit
        // remains unknown, never an authorization to clear/start another.
        const legacy = await call("faolla_member_checkout_original_result_v1", args);
        if (!object(legacy) || legacy.error !== null || !Object.hasOwn(legacy, "data")) throw new Error("checkout_unavailable");
        response = legacy.data === null ? { state: "unconfirmed" } : { state: "confirmed", original: { kind: "single", original: parseCheckoutOriginalResult(legacy.data, scope) } };
      }
    }
    const current = await authorize();
    if (!current || checkoutPrincipalKey(current) !== principalKey || intentMode !== deps.intentEnabled(siteId) || buying && !deps.enabled(siteId, method)) throw new Error(dispatched ? "checkout_unconfirmed" : "checkout_unauthorized");
    return json({ ok: true, ...response });
  } catch (error) {
    const code = error instanceof MerchantCheckoutError ? error.code : error instanceof Error ? error.message : "";
    const status = bad.has(code) && !dispatched ? 400 : conflicts.has(code) ? 409 : code === "checkout_unauthorized" && !dispatched ? 401
      : code === "checkout_module_unavailable" && !dispatched ? 403 : 503;
    return json({ error: status < 500 || error instanceof MerchantCheckoutError && code === "checkout_intent_disabled" ? code : dispatched ? "checkout_unconfirmed" : "checkout_unavailable" }, status);
  }
}
