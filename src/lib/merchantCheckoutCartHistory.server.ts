import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { isMemberCheckoutCartPilotEnabled } from "./merchantCheckoutCartPilot.server";
import { checkoutPrincipalKey } from "./merchantCheckoutQuote.server";
import { CheckoutLegacyBoundaryError } from "./merchantCheckoutLegacyBoundary.server";
import { parseCartClientOriginal } from "./merchantCheckoutCartReview";
const defaults = { enabled: (siteId: string) => isMemberCheckoutCartPilotEnabled(siteId, "points"), session: resolvePersonalAccountSessionFromRequest,
  call: async (args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => {
    const client = createServerMerchantCheckoutRuntimeClient(); if (!client) throw new Error("unavailable");
    return client.rpc("faolla_member_checkout_original_resource_v2", args).abortSignal(signal);
  } };
export type CartHistoryDependencies = typeof defaults;
/** Read-only original lookup. Actual own account, not email/guest ownership or
 * a browser member ID; private SQL whitelists all three versions in one MVCC
 * statement. A failure is never retried as an older, incomplete projection. */
export async function readPersonalCheckoutCartResource(input: { request: Request; siteId: string; kind: "booking" | "order"; id: string; expectedAccountId?: string }, overrides: Partial<CartHistoryDependencies> = {}) {
  const deps = { ...defaults, ...overrides }, stable = { ...input };
  if (!/^\d{8}$/.test(stable.siteId) || !["booking", "order"].includes(stable.kind) || !/^[A-Za-z0-9:_-]{1,160}$/.test(stable.id)
    || stable.expectedAccountId !== undefined && !/^\d{8}$/.test(stable.expectedAccountId)) throw new CheckoutLegacyBoundaryError("checkout_invalid_request", 400);
  const signal = AbortSignal.any([stable.request.signal, AbortSignal.timeout(12_000)]);
  const guard = () => { if (signal.aborted || !deps.enabled(stable.siteId)) throw new CheckoutLegacyBoundaryError("checkout_unavailable", 503); };
  const bounded = async <T>(run: () => PromiseLike<T>): Promise<T> => {
    guard(); let abort: () => void = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { guard(); return run(); }), new Promise<never>((_, reject) => {
      abort = () => reject(new CheckoutLegacyBoundaryError("checkout_unavailable", 503)); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    })]); } finally { signal.removeEventListener("abort", abort); }
  };
  const authorize = async () => {
    const session = await bounded(() => deps.session(stable.request)), verified = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at; guard();
    if (!session || session.servicePaused || typeof verified !== "string" || !Number.isFinite(Date.parse(verified))
      || stable.expectedAccountId !== undefined && stable.expectedAccountId !== session.accountId) throw new CheckoutLegacyBoundaryError("checkout_unauthorized", 401);
    return checkoutPrincipalKey(session);
  };
  try {
    const principal = await authorize(), response = await bounded(() => deps.call({ p_site_id: stable.siteId, p_kind: stable.kind, p_id: stable.id, p_principal_key: principal }, signal));
    if (await authorize() !== principal) throw new CheckoutLegacyBoundaryError("checkout_unauthorized", 401);
    if (!response || !Object.hasOwn(response, "data") || response.error !== null) throw new Error("unavailable");
    if (response.data === null) return null;
    const original = parseCartClientOriginal(response.data, stable.siteId);
    const resource = original.kind === "cart" ? original.result : original.original.method === "on_site" ? original.original.result.terms : original.original.result;
    if (resource.resourceKind !== stable.kind || resource.resourceId !== stable.id) throw new Error("invalid"); return original;
  } catch (error) { if (error instanceof CheckoutLegacyBoundaryError) throw error; throw new CheckoutLegacyBoundaryError("checkout_unavailable", 503); }
}
