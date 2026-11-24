import { NextResponse } from "next/server";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { isMemberCheckoutHistoryReadEnabled } from "./merchantCheckoutHistoryPilot.server";
import { checkoutPrincipalKey } from "./merchantCheckoutQuote.server";
import { parseOriginalServiceRequest, parseOriginalServiceReview, parseOriginalServiceCancellation } from "./merchantCheckoutOriginalService";
export function isMemberCheckoutOriginalServiceEnabled(siteId: string, env: Record<string, string | undefined> = process.env) {
  const raw = env.MERCHANT_MEMBER_CHECKOUT_ORIGINAL_SERVICE_SITES ?? "", sites = raw.split(",").map(s => s.trim());
  return isMemberCheckoutHistoryReadEnabled(siteId, env) && !!raw.trim() && sites.length <= 50 && sites.every(s => /^\d{8}$/.test(s)) && sites.includes(siteId);
}
type Rpc = "faolla_member_checkout_original_service_review_v1" | "faolla_member_checkout_original_service_cancel_v1";
const defaults = { enabled: isMemberCheckoutOriginalServiceEnabled, session: resolvePersonalAccountSessionFromRequest,
  call: async (name: Rpc, args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: { message?: string } | null }> => {
    const client = createServerSupabaseServiceClient(); if (!client) throw Error("unavailable"); return client.rpc(name, args).abortSignal(signal);
  } };
export type OriginalServiceDependencies = typeof defaults;
const json = (v: unknown, status = 200) => NextResponse.json(v, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache", "referrer-policy": "no-referrer",
  vary: "Cookie, Authorization, X-Checkout-Account-Scope", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" } });
const safe = new Set(["checkout_service_busy", "checkout_service_disabled", "checkout_service_changed", "checkout_service_expired", "checkout_not_found", "checkout_conflict",
  "checkout_cancellation_review_required", "checkout_cancellation_not_allowed", "checkout_cancellation_deadline", "checkout_refund_required", "checkout_cancellation_requires_refund", "booking_atomic_inactive"]);
/** Only exact existing-original review or one atomic original cancellation.
 * No purchase gate fallback, quote, enrollment, ack, charge or local storage. */
export async function handleCheckoutOriginalService(cancel: boolean, request: Request, overrides: Partial<OriginalServiceDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json({ error: "forbidden_origin" }, 403);
  const account = request.headers.get("x-checkout-account-scope");
  if (!account || !/^\d{8}$/.test(account) || request.headers.has("x-merchant-access-token")) return json({ error: "checkout_unauthorized" }, 401);
  const deadline = Date.now() + 12_000, notAfter = deadline - 1000, signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]); let writing = false;
  const guard = () => { if (signal.aborted || Date.now() >= deadline) throw Error("checkout_service_unavailable"); };
  const bounded = async <T>(run: () => PromiseLike<T>): Promise<T> => {
    guard(); let stop: () => void = () => {};
    try { const v = await Promise.race([Promise.resolve().then(() => { guard(); return run(); }), new Promise<never>((_, reject) => {
      stop = () => reject(Error("checkout_service_unavailable")); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    })]); guard(); return v; } finally { signal.removeEventListener("abort", stop); }
  };
  try {
    if (new URL(request.url).search || !request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Error("checkout_invalid_request");
    const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", bytes = 0;
    try { while (true) { const part = await bounded(() => reader.read()); if (part.done) break; bytes += part.value.byteLength; if (bytes > 2048) throw Error("body"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    catch { guard(); throw Error("checkout_invalid_request"); } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    let raw: unknown; try { raw = JSON.parse(text); } catch { throw Error("checkout_invalid_request"); }
    const input = parseOriginalServiceRequest(raw, cancel), enabled = () => { guard(); if (!deps.enabled(input.siteId)) throw Error("checkout_service_unavailable"); };
    const authorize = async () => { enabled(); const s = await bounded(() => deps.session(request)); enabled(); const stamp = (s?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      if (!s || s.servicePaused || s.accountId !== account || typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp))) throw Error("checkout_unauthorized");
      return checkoutPrincipalKey({ accountId: s.accountId, userId: s.userId }); };
    const principal = await authorize(); if (await authorize() !== principal) throw Error("checkout_unauthorized");
    const result = await bounded(() => { enabled(); if (cancel && Date.now() >= notAfter) throw Error("checkout_service_unavailable"); writing = cancel;
      return deps.call(cancel ? "faolla_member_checkout_original_service_cancel_v1" : "faolla_member_checkout_original_service_review_v1", {
        p_site_id: input.siteId, p_operation_key: input.operationKey, p_principal_key: principal,
        ...(cancel ? { p_review_hash: input.reviewHash, p_expected_updated_at: input.expectedUpdatedAt, p_not_after: new Date(notAfter).toISOString() } : {}),
      }, signal); });
    if (await authorize() !== principal) throw Error("checkout_unauthorized"); enabled();
    if (result.error || !Object.hasOwn(result, "data")) { if (safe.has(result.error?.message ?? "")) return json({ error: result.error!.message }, result.error!.message === "checkout_not_found" ? 404 : 409); throw Error("unavailable"); }
    const v = cancel ? { cancellation: parseOriginalServiceCancellation(result.data, { ...input, reviewHash: input.reviewHash! }) }
      : { readOnly: true, review: parseOriginalServiceReview(result.data, input) };
    if (await authorize() !== principal) throw Error("checkout_unauthorized"); enabled(); return json({ ok: true, ...v });
  } catch (error) { const code = error instanceof Error ? error.message : "";
    if (!writing && ["checkout_invalid_request", "checkout_unauthorized"].includes(code)) return json({ error: code }, code === "checkout_invalid_request" ? 400 : 401);
    return json({ error: writing ? "checkout_service_unconfirmed" : "checkout_service_unavailable" }, 503); }
}
