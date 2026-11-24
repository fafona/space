import { NextResponse } from "next/server";
import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { isMemberCheckoutHistoryReadEnabled } from "./merchantCheckoutHistoryPilot.server";
import { checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";
import { checkoutPrincipalKey } from "./merchantCheckoutQuote.server";
import { parseCheckoutHistoryRecovery, parseCheckoutHistoryRecoveryRequest, checkoutHistoryRecoveryReference } from "./merchantCheckoutHistoryRecovery";

const rpc = "faolla_member_checkout_history_original_v1";
const defaults = { enabled: isMemberCheckoutHistoryReadEnabled, session: resolvePersonalAccountSessionFromRequest,
  call: async (name: typeof rpc, args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => {
    const client = createServerMerchantCheckoutRuntimeClient(); if (!client) throw new Error("unavailable"); return client.rpc(name, args).abortSignal(signal);
  } };
export type CheckoutHistoryRecoveryDependencies = typeof defaults;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache",
  vary: "Cookie, Authorization, X-Checkout-Account-Scope", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" } });

/** Only reads the exact current principal's original nonce. No planner, order,
 * claim, acknowledgement, cart clearing, retry or legacy financial fallback. */
export async function handleCheckoutHistoryRecovery(request: Request, overrides: Partial<CheckoutHistoryRecoveryDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  const hint = request.headers.get("x-checkout-account-scope");
  if (request.headers.has("x-merchant-access-token") || !hint || !/^\d{8}$/.test(hint)) return json({ error: "checkout_unauthorized" }, 401);
  const deadline = Date.now() + 12_000, signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
  const guard = () => { if (signal.aborted || Date.now() >= deadline) throw new Error("checkout_history_unavailable"); };
  const bounded = async <T>(read: () => PromiseLike<T>): Promise<T> => {
    guard(); let stop: () => void = () => {};
    try { const result = await Promise.race([Promise.resolve().then(() => { guard(); return read(); }), new Promise<never>((_, reject) => {
      stop = () => reject(new Error("checkout_history_unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    })]); guard(); return result; } finally { signal.removeEventListener("abort", stop); }
  };
  try {
    if (new URL(request.url).search || !request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("checkout_invalid_request");
    const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", bytes = 0;
    try { while (true) { const part = await bounded(() => reader.read()); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 1024) throw new Error("body"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode();
    } catch { guard(); throw new Error("checkout_invalid_request"); } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    let raw: unknown; try { raw = JSON.parse(text); } catch { throw new Error("checkout_invalid_request"); }
    // Validate the exact two-field shape BEFORE authentication or storage IO.
    const parsed = parseCheckoutHistoryRecoveryRequest(raw), siteId = parsed.siteId;
    const enabled = () => { guard(); if (!deps.enabled(siteId)) throw new Error("checkout_history_unavailable"); };
    const authorize = async () => {
      enabled(); const session = await bounded(() => deps.session(request)); enabled();
      const stamp = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      if (!session || session.servicePaused || session.accountId !== hint || typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp))) throw new Error("checkout_unauthorized");
      return { accountId: session.accountId, userId: session.userId };
    };
    const principal = await authorize(), identity = checkoutSubmissionRecoveryIdentity(parsed, principal);
    const reference = await bounded(() => checkoutHistoryRecoveryReference(siteId, principal.accountId, parsed.nonce));
    enabled(); const value = await bounded(() => deps.call(rpc, { p_site_id: siteId, p_operation_key: identity.operationKey, p_principal_key: identity.principalKey }, signal)); enabled();
    if (!value || value.error !== null || !Object.hasOwn(value, "data")) throw new Error("checkout_history_unavailable");
    const recovery = parseCheckoutHistoryRecovery(value.data, identity), current = await authorize();
    if (checkoutPrincipalKey(current) !== identity.principalKey) throw new Error("checkout_unauthorized"); enabled();
    return json({ ok: true, readOnly: true, reference, recovery });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json({ error: code === "checkout_invalid_request" || code === "checkout_unauthorized" ? code : "checkout_history_unavailable" }, code === "checkout_invalid_request" ? 400 : code === "checkout_unauthorized" ? 401 : 503);
  }
}
