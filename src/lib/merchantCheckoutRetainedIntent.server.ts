import { NextResponse } from "next/server";
import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { isMemberCheckoutAccountDraftPilotEnabled } from "./merchantCheckoutCartPilot.server";
import { checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";
import { checkoutPrincipalKey } from "./merchantCheckoutQuote.server";
import { parseRetainedIntentRequest, parseRetainedIntentReview, parseRetainedIntentRegistration } from "./merchantCheckoutRetainedIntent";

export function isMemberCheckoutRetainedIntentEnabled(siteId: string, env: Record<string, string | undefined> = process.env) {
  const raw = env.MERCHANT_MEMBER_CHECKOUT_RETAINED_INTENT_SITES ?? "", sites = raw.split(",").map(s => s.trim());
  return isMemberCheckoutAccountDraftPilotEnabled(siteId, env) && !!raw.trim() && sites.length <= 50 && sites.every(s => /^\d{8}$/.test(s)) && sites.includes(siteId);
}
type Rpc = "faolla_member_checkout_retained_intent_review_v1" | "faolla_member_checkout_register_retained_intent_v1";
const defaults = { enabled: isMemberCheckoutRetainedIntentEnabled, session: resolvePersonalAccountSessionFromRequest,
  call: async (name: Rpc, args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => {
    const client = createServerMerchantCheckoutRuntimeClient(); if (!client) throw new Error("unavailable"); return client.rpc(name, args).abortSignal(signal);
  } };
export type RetainedIntentDependencies = typeof defaults;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache",
  vary: "Cookie, Authorization, X-Checkout-Account-Scope", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" } });
const conflicts = new Set(["checkout_intent_busy", "checkout_intent_not_found", "checkout_intent_changed", "checkout_intent_expired", "checkout_intent_review_required", "checkout_original_pending", "checkout_intent_disabled"]);
/** Exact nonce + real dual principal. The explicit append only registers an
 * already-existing original. It never charges, acknowledges or clears a cart. */
export async function handleRetainedCheckoutIntent(register: boolean, request: Request, overrides: Partial<RetainedIntentDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  const hint = request.headers.get("x-checkout-account-scope");
  if (request.headers.has("x-merchant-access-token") || !hint || !/^\d{8}$/.test(hint)) return json({ error: "checkout_unauthorized" }, 401);
  const deadline = Date.now() + 12_000, notAfter = deadline - 1000, signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]); let dispatched = false;
  const guard = () => { if (signal.aborted || Date.now() >= deadline) throw new Error("checkout_intent_unavailable"); };
  const bounded = async <T>(run: () => PromiseLike<T>): Promise<T> => {
    guard(); let stop: () => void = () => {};
    try { const value = await Promise.race([Promise.resolve().then(() => { guard(); return run(); }), new Promise<never>((_, reject) => {
      stop = () => reject(new Error("checkout_intent_unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    })]); guard(); return value; } finally { signal.removeEventListener("abort", stop); }
  };
  try {
    if (new URL(request.url).search || !request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("checkout_invalid_request");
    const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", bytes = 0;
    try { while (true) { const part = await bounded(() => reader.read()); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 1024) throw new Error("body"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    catch { guard(); throw new Error("checkout_invalid_request"); } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    let raw: unknown; try { raw = JSON.parse(text); } catch { throw new Error("checkout_invalid_request"); }
    const input = parseRetainedIntentRequest(raw, register), siteId = input.siteId;
    const enabled = () => { guard(); if (!deps.enabled(siteId)) throw new Error("checkout_intent_unavailable"); };
    const authorize = async () => {
      enabled(); const session = await bounded(() => deps.session(request)); enabled();
      const stamp = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      if (!session || session.servicePaused || session.accountId !== hint || typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp))) throw new Error("checkout_unauthorized");
      return { accountId: session.accountId, userId: session.userId };
    };
    const principal = await authorize(), identity = checkoutSubmissionRecoveryIdentity({ siteId, nonce: input.nonce }, principal);
    // Recheck immediately before the only dispatch; no delayed write after a
    // body/auth timeout, identity loss or scope closure.
    const current = await authorize(); if (checkoutPrincipalKey(current) !== identity.principalKey) throw new Error("checkout_unauthorized");
    enabled(); if (register && Date.now() >= notAfter) throw new Error("checkout_intent_unavailable");
    const args = { p_site_id: siteId, p_operation_key: identity.operationKey, p_principal_key: identity.principalKey,
      ...(register ? { p_review_hash: input.reviewHash, p_not_after: new Date(notAfter).toISOString() } : {}) };
    const value = await bounded(() => { enabled(); if (register && Date.now() >= notAfter) throw new Error("checkout_intent_unavailable"); dispatched = register;
      return deps.call(register ? "faolla_member_checkout_register_retained_intent_v1" : "faolla_member_checkout_retained_intent_review_v1", args, signal); });
    const after = await authorize(); if (checkoutPrincipalKey(after) !== identity.principalKey) throw new Error("checkout_unauthorized"); enabled();
    if (!value || value.error !== null || !Object.hasOwn(value, "data")) {
      const code = (value?.error as { message?: unknown } | null)?.message;
      if (typeof code === "string" && conflicts.has(code)) return json({ error: code }, 409);
      throw new Error("checkout_intent_unavailable");
    }
    const proposal = register ? null : parseRetainedIntentReview(value.data, { siteId, operationKey: identity.operationKey });
    const result = register ? { registration: parseRetainedIntentRegistration(value.data, { siteId, operationKey: identity.operationKey, reviewHash: input.reviewHash! }) }
      : { proposal: proposal ? { reviewHash: proposal.reviewHash, original: proposal.original, reviewRequired: proposal.reviewRequired } : null };
    const final = await authorize(); if (checkoutPrincipalKey(final) !== identity.principalKey) throw new Error("checkout_unauthorized"); enabled();
    return json({ ok: true, ...(!register ? { readOnly: true } : {}), ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (!dispatched && ["checkout_invalid_request", "checkout_unauthorized"].includes(code)) return json({ error: code }, code === "checkout_invalid_request" ? 400 : 401);
    return json({ error: dispatched ? "checkout_intent_unconfirmed" : "checkout_intent_unavailable" }, 503);
  }
}
