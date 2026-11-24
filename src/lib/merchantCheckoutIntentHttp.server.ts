import { NextResponse } from "next/server";
import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { isMemberCheckoutIntentPilotEnabled } from "./merchantCheckoutCartPilot.server";
import { checkoutPrincipalKey, MerchantCheckoutError } from "./merchantCheckoutQuote.server";
import { readPendingCheckoutIntent, readCheckoutIntentReview, acknowledgePendingCheckoutIntent, type CheckoutIntentRpc } from "./merchantCheckoutPendingIntent.server";
import { parseCheckoutIntentAcknowledgement } from "./merchantCheckoutPendingIntent";
const defaults = { enabled: isMemberCheckoutIntentPilotEnabled, session: resolvePersonalAccountSessionFromRequest,
  call: (async (name, args, signal) => { const client = createServerMerchantCheckoutRuntimeClient(); if (!client) throw new Error("unavailable");
    return client.rpc(name, args).abortSignal(signal); }) as CheckoutIntentRpc };
export type CheckoutIntentHttpDependencies = typeof defaults;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const safeErrors = new Set(["checkout_invalid_request", "checkout_unauthorized", "checkout_intent_busy", "checkout_intent_not_found", "checkout_intent_changed", "checkout_intent_expired", "checkout_intent_review_required", "checkout_original_pending"]);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache",
  vary: "Cookie, Authorization, X-Checkout-Account-Scope", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin" } });
/** Independently default-closed. Exact same-origin POST, bounded UTF-8 body,
 * actual verified/unpaused personal identity bound to the browser's account
 * hint before/after every stage. A hint/operation key is never authorization. */
export async function handleCheckoutIntent(action: "pending" | "review" | "acknowledge", request: Request, overrides: Partial<CheckoutIntentHttpDependencies> = {}) {
  const notAfter = Date.now() + 11_000;
  const deps = { ...defaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  const accountId = request.headers.get("x-checkout-account-scope");
  if (request.headers.has("x-merchant-access-token") || !accountId || !/^\d{8}$/.test(accountId)) return json({ error: "checkout_unauthorized" }, 401);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]); let dispatched = false;
  const guard = () => { if (signal.aborted || Date.now() >= notAfter + 1000) throw new Error("checkout_intent_unavailable"); };
  const bounded = async <T>(run: () => PromiseLike<T>): Promise<T> => {
    guard(); let abort: () => void = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { guard(); return run(); }), new Promise<never>((_, reject) => {
      abort = () => reject(new Error("checkout_intent_unavailable")); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    })]); } finally { signal.removeEventListener("abort", abort); }
  };
  try {
    if (new URL(request.url).search || !request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new MerchantCheckoutError("checkout_invalid_request", 400);
    const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", bytes = 0;
    try { while (true) { const part = await bounded(() => reader.read()); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 2048) throw new Error("body"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    catch { if (signal.aborted || Date.now() >= notAfter + 1000) throw new Error("checkout_intent_unavailable"); throw new MerchantCheckoutError("checkout_invalid_request", 400); }
    finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    let raw: unknown; try { raw = JSON.parse(text); } catch { throw new MerchantCheckoutError("checkout_invalid_request", 400); }
    if (!object(raw) || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId)
      || action !== "acknowledge" && (Object.keys(raw).length !== (action === "pending" ? 1 : 2) || action === "review" && (typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey)))) throw new MerchantCheckoutError("checkout_invalid_request", 400);
    if (action === "acknowledge") { try { parseCheckoutIntentAcknowledgement(raw); } catch { throw new MerchantCheckoutError("checkout_invalid_request", 400); } }
    const siteId = raw.siteId, enabled = () => { guard(); if (!deps.enabled(siteId)) throw new Error("checkout_intent_unavailable"); };
    enabled();
    const authorize = async () => { enabled(); const session = await bounded(() => deps.session(request)); enabled();
      const stamp = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      return !session || session.servicePaused || session.accountId !== accountId || typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp)) ? null : { accountId: session.accountId, userId: session.userId }; };
    const principal = await authorize(); if (!principal) throw new MerchantCheckoutError("checkout_unauthorized", 401);
    const key = checkoutPrincipalKey(principal), call: CheckoutIntentRpc = async (name, args, inner) => {
      enabled(); if (inner.aborted) throw new Error("unavailable");
      if (name === "faolla_member_checkout_acknowledge_intent_v1") { if (Date.now() >= notAfter) throw new Error("unavailable");
        args = { ...args, p_not_after: new Date(Math.min(Date.parse(String(args.p_not_after)), notAfter)).toISOString() }; dispatched = true; }
      const result = await bounded(() => deps.call(name, args, AbortSignal.any([signal, inner]))); enabled(); return result;
    };
    const ports = { principal, authorize, signal };
    const value = action === "pending" ? { snapshot: await readPendingCheckoutIntent({ siteId }, ports, call) }
      : action === "review" ? { review: await readCheckoutIntentReview({ siteId, operationKey: raw.operationKey as string }, ports, call) }
        : { acknowledgement: await acknowledgePendingCheckoutIntent(raw, ports, call) };
    const current = await authorize(); if (!current || checkoutPrincipalKey(current) !== key) throw new Error("unavailable"); enabled();
    return json({ ok: true, ...value });
  } catch (error) {
    if (error instanceof MerchantCheckoutError && safeErrors.has(error.code) && (error.status === 409 || !dispatched && [400, 401].includes(error.status))) return json({ error: error.code }, error.status);
    return json({ error: dispatched ? "checkout_intent_unconfirmed" : "checkout_intent_unavailable" }, 503);
  }
}
