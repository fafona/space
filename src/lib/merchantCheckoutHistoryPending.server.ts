import { NextResponse } from "next/server";
import { handleCheckoutIntent, type CheckoutIntentHttpDependencies } from "./merchantCheckoutIntentHttp.server";
import { isMemberCheckoutHistoryReadEnabled } from "./merchantCheckoutHistoryPilot.server";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";

const pendingRpc = "faolla_member_checkout_pending_intent_v1";
export type CheckoutHistoryPendingDependencies = Omit<CheckoutIntentHttpDependencies, "call"> & {
  call: (name: typeof pendingRpc, args: Record<string, unknown>, signal: AbortSignal) => ReturnType<CheckoutIntentHttpDependencies["call"]>;
};
const defaults: CheckoutHistoryPendingDependencies = {
  enabled: isMemberCheckoutHistoryReadEnabled, session: resolvePersonalAccountSessionFromRequest,
  call: async (name, args, signal) => {
    const client = createServerMerchantCheckoutRuntimeClient(); if (!client) throw new Error("unavailable");
    return client.rpc(name, args).abortSignal(signal);
  },
};

/** Independent read-only adapter, not a wider intent grant. Reuse the exact
 * bounded body/session/principal/DTO checks, but fix BOTH action and RPC. No
 * review, acknowledgement, nonce clearing or financial port is exposed. */
export async function handleCheckoutHistoryPending(request: Request, overrides: Partial<CheckoutHistoryPendingDependencies> = {}) {
  const deps = { ...defaults, ...overrides }, deadline = Date.now() + 12_000;
  const response = await handleCheckoutIntent("pending", request, {
    enabled: deps.enabled, session: deps.session,
    call: (name, args, signal) => {
      if (name !== pendingRpc) throw new Error("unavailable");
      return deps.call(name, args, signal);
    },
  });
  if (!response.ok) return response;
  try {
    const value = await response.json();
    // Envelope conversion must not revive an aborted/expired or revoked read.
    if (request.signal.aborted || Date.now() >= deadline || !deps.enabled(value.snapshot.siteId)) throw new Error("unavailable");
    return NextResponse.json({ ...value, readOnly: true }, { status: response.status, headers: response.headers });
  } catch { return NextResponse.json({ error: "checkout_intent_unavailable" }, { status: 503, headers: response.headers }); }
}
