import { NextResponse } from "next/server";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { isMemberCheckoutHistoryReadEnabled } from "./merchantCheckoutHistoryPilot.server";
import { checkoutPrincipalKey } from "./merchantCheckoutQuote.server";
import { parseCheckoutHistoryInventory, parseCheckoutHistoryInventoryRequest } from "./merchantCheckoutHistoryInventory";

const rpc = "faolla_member_checkout_history_inventory_v1";
const defaults = { enabled: isMemberCheckoutHistoryReadEnabled, session: resolvePersonalAccountSessionFromRequest,
  call: async (name: typeof rpc, args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => {
    const client = createServerSupabaseServiceClient(); if (!client) throw new Error("unavailable"); return client.rpc(name, args).abortSignal(signal);
  } };
export type CheckoutHistoryInventoryDependencies = typeof defaults;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "private, no-store, max-age=0", pragma: "no-cache",
  vary: "Cookie, Authorization, X-Checkout-Account-Scope", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" } });

/** Fixed read RPC. Missing nonce does NOT authorize repair, claim, ack, cart
 * release or finance. All IO and final identity checks share one budget. */
export async function handleCheckoutHistoryInventory(request: Request, overrides: Partial<CheckoutHistoryInventoryDependencies> = {}) {
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
    const scope = parseCheckoutHistoryInventoryRequest(raw), enabled = () => { guard(); if (!deps.enabled(scope.siteId)) throw new Error("checkout_history_unavailable"); };
    const authorize = async () => {
      enabled(); const session = await bounded(() => deps.session(request)); enabled();
      const stamp = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
      if (!session || session.servicePaused || session.accountId !== hint || typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp))) throw new Error("checkout_unauthorized");
      return checkoutPrincipalKey({ accountId: session.accountId, userId: session.userId });
    };
    const principal = await authorize();
    const value = await bounded(() => deps.call(rpc, { p_site_id: scope.siteId, p_principal_key: principal, p_after: scope.after }, signal)); enabled();
    if (!value || value.error !== null || !Object.hasOwn(value, "data")) throw new Error("checkout_history_unavailable");
    const inventory = parseCheckoutHistoryInventory(value.data, scope), current = await authorize();
    if (current !== principal) throw new Error("checkout_unauthorized"); enabled();
    return json({ ok: true, readOnly: true, inventory });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json({ error: code === "checkout_invalid_request" || code === "checkout_unauthorized" ? code : "checkout_history_unavailable" }, code === "checkout_invalid_request" ? 400 : code === "checkout_unauthorized" ? 401 : 503);
  }
}
