import { NextResponse } from "next/server";
import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { checkoutPrincipalKey } from "./merchantCheckoutQuote.server";
import { parseLegacyReviewRequest, parseLegacyOrderReview } from "./merchantCheckoutLegacyReview";
import { isMemberCheckoutLegacyReviewEnabled } from "./merchantCheckoutLegacyReviewPilot.server";
const rpc = "faolla_member_checkout_legacy_review_v1";
const defaults = { enabled: isMemberCheckoutLegacyReviewEnabled, session: resolvePersonalAccountSessionFromRequest,
  call: async (name: typeof rpc, args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => {
    const client = createServerMerchantCheckoutRuntimeClient(); if (!client) throw new Error("unavailable"); return client.rpc(name, args).abortSignal(signal);
  } };
export type LegacyReviewDependencies = typeof defaults;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache",
  vary: "Cookie, Authorization, X-Checkout-Account-Scope", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" } });
/** A separate, explicit read. No old personal-list/email fallback, finance,
 * ownership backfill, local draft migration or claim acknowledgement. */
export async function handleCheckoutLegacyReview(request: Request, overrides: Partial<LegacyReviewDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  const hint = request.headers.get("x-checkout-account-scope");
  if (request.headers.has("x-merchant-access-token") || !hint || !/^\d{8}$/.test(hint)) return json({ error: "checkout_unauthorized" }, 401);
  const deadline = Date.now() + 12_000, signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
  const guard = () => { if (signal.aborted || Date.now() >= deadline) throw new Error("checkout_legacy_review_unavailable"); };
  const bounded = async <T>(run: () => PromiseLike<T>): Promise<T> => {
    guard(); let stop: () => void = () => {};
    try { const v = await Promise.race([Promise.resolve().then(() => { guard(); return run(); }), new Promise<never>((_, reject) => {
      stop = () => reject(new Error("checkout_legacy_review_unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    })]); guard(); return v; } finally { signal.removeEventListener("abort", stop); }
  };
  try {
    if (new URL(request.url).search || !request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new Error("checkout_legacy_review_invalid");
    const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", bytes = 0;
    try { while (true) { const part = await bounded(() => reader.read()); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 1024) throw new Error("invalid"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode();
    } catch { guard(); throw new Error("checkout_legacy_review_invalid"); } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    let raw: unknown; try { raw = JSON.parse(text); } catch { throw new Error("checkout_legacy_review_invalid"); }
    const query = parseLegacyReviewRequest(raw);
    const enabled = () => { guard(); if (!deps.enabled(query.siteId)) throw new Error("checkout_legacy_review_unavailable"); };
    const authorize = async () => {
      enabled(); const session = await bounded(() => deps.session(request)); enabled();
      const stamp = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      if (!session || session.accountId !== hint || session.servicePaused || typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp))) throw new Error("checkout_unauthorized");
      const key = checkoutPrincipalKey(session);
      if (!/^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$/.test(key)) throw new Error("checkout_unauthorized"); return key;
    };
    const principal = await authorize(); enabled();
    const result = await bounded(() => deps.call(rpc, { p_site_id: query.siteId, p_block_id: query.blockId, p_request_id: query.requestId,
      p_principal_key: principal, p_not_after: new Date(deadline - 500).toISOString() }, signal)); enabled();
    if (!result || result.error !== null) throw new Error("checkout_legacy_review_unavailable");
    const review = (() => { try { return parseLegacyOrderReview(result.data, query); } catch { throw new Error("checkout_legacy_review_unavailable"); } })(), current = await authorize();
    if (current !== principal) throw new Error("checkout_unauthorized"); guard();
    return json({ ok: true, readOnly: true, review });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json({ error: code === "checkout_unauthorized" ? code : code === "checkout_legacy_review_invalid" ? code : "checkout_legacy_review_unavailable" }, code === "checkout_unauthorized" ? 401 : code === "checkout_legacy_review_invalid" ? 400 : 503);
  }
}
