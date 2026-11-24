import { NextResponse } from "next/server";
import { handleSingleIntentCheckout, type SingleIntentHttpDependencies } from "../app/api/member-checkout/single/route-handler";
import { handleCartCheckout, type CartHttpDependencies } from "./merchantCheckoutCartHttp.server";
import { isMemberCheckoutUnusedReferenceEnabled } from "./merchantCheckoutUnusedReference.server";
import { isMemberCheckoutCartPilotEnabled } from "./merchantCheckoutCartPilot.server";
import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";

type Rpc = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<{ data: unknown; error: { message?: string } | null }>;
const call: Rpc = async (name, args, signal) => {
  const client = createServerMerchantCheckoutRuntimeClient(); if (!client) throw Error("checkout_unavailable"); return client.rpc(name, args).abortSignal(signal);
};
type Dependencies = { enabled: (siteId: string) => boolean; call: Rpc; single?: SingleIntentHttpDependencies; cart?: Partial<CartHttpDependencies> };
const json = () => NextResponse.json({ error: "checkout_unauthorized" }, { status: 401, headers: { "cache-control": "private, no-store", vary: "Cookie, Authorization, X-Checkout-Account-Scope, X-Checkout-Operation-Scope", "referrer-policy": "no-referrer" } });
/** Separate, default-closed write route. A preflight operation is only a
 * consistency binding, NEVER price/session authority. Actual handlers retain
 * body bounds, verified dual identity, gates, deadlines and single dispatch. */
export async function handleBoundCheckoutSubmit(kind: "points" | "on-site" | "cart", request: Request, overrides: Partial<Dependencies> = {}) {
  const deps = { enabled: isMemberCheckoutUnusedReferenceEnabled, call, ...overrides };
  const expected = request.headers.get("x-checkout-operation-scope"), account = request.headers.get("x-checkout-account-scope");
  if (!expected || !/^[a-f0-9]{64}$/.test(expected) || !account || !/^\d{8}$/.test(account)) return json();
  const boundCall: Rpc = async (name, args, signal) => {
    if (signal.aborted || typeof args.p_site_id !== "string" || !deps.enabled(args.p_site_id) || args.p_operation_key !== expected
      || typeof args.p_principal_key !== "string" || !args.p_principal_key.startsWith(`account:${account}:`)) throw Error("checkout_unauthorized");
    return deps.call(name, args, signal);
  };
  const response = kind === "cart" ? await handleCartCheckout("submit", request, { ...deps.cart,
    enabled: (siteId, method) => deps.enabled(siteId) && (deps.cart?.enabled ?? isMemberCheckoutCartPilotEnabled)(siteId, method), call: boundCall })
    : await handleSingleIntentCheckout(kind, "submit", request, { ...deps.single, enabled: siteId => deps.enabled(siteId) && (deps.single?.enabled?.(siteId) ?? true), call: boundCall,
      // An injected on-site port must not bypass the binding wrapper.
      ...(deps.single?.onSite ? { onSite: { ...deps.single.onSite, call: boundCall } } : {}) });
  const headers = new Headers(response.headers); headers.set("vary", "Cookie, Authorization, X-Checkout-Account-Scope, X-Checkout-Operation-Scope");
  return new Response(response.body, { status: response.status, headers });
}
