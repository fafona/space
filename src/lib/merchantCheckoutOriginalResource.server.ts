import { createServerSupabaseServiceClient } from "./superAdminServer";
import { resolvePersonalAccountSessionFromRequest } from "./personalAccountSession.server";
import { isMemberCheckoutOnSitePilotEnabled } from "./merchantCheckoutOnSitePilot.server";
import { checkoutPrincipalKey } from "./merchantCheckoutQuote.server";
import { CheckoutLegacyBoundaryError } from "./merchantCheckoutLegacyBoundary.server";
import { parseCheckoutOriginalResult } from "./merchantCheckoutOriginalResult";
const defaults = { enabled: isMemberCheckoutOnSitePilotEnabled, session: resolvePersonalAccountSessionFromRequest,
  call: async (args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => {
    const client = createServerSupabaseServiceClient(); if (!client) throw new Error("unavailable");
    return client.rpc("faolla_member_checkout_original_resource_v1", args).abortSignal(signal);
  } };
export async function readPersonalCheckoutOriginalResource(input: { request: Request; siteId: string; kind: "booking" | "order"; id: string; expectedAccountId?: string }, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides }, stable = { ...input };
  if (!/^\d{8}$/.test(stable.siteId) || !["booking", "order"].includes(stable.kind) || !/^[A-Za-z0-9:_-]{1,160}$/.test(stable.id)) throw new CheckoutLegacyBoundaryError("checkout_invalid_request", 400);
  if (!deps.enabled(stable.siteId)) throw new CheckoutLegacyBoundaryError("checkout_unavailable", 503);
  const signal = AbortSignal.any([stable.request.signal, AbortSignal.timeout(12_000)]);
  const authorize = async () => {
    if (signal.aborted || !deps.enabled(stable.siteId)) throw new CheckoutLegacyBoundaryError("checkout_unavailable", 503);
    const session = await deps.session(stable.request), verified = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
    if (signal.aborted || !session || session.servicePaused || typeof verified !== "string" || !Number.isFinite(Date.parse(verified))
      || stable.expectedAccountId !== undefined && stable.expectedAccountId !== session.accountId) throw new CheckoutLegacyBoundaryError("checkout_unauthorized", 401);
    return checkoutPrincipalKey(session);
  };
  const principalKey = await authorize();
  try {
    const response = await deps.call({ p_site_id: stable.siteId, p_kind: stable.kind, p_id: stable.id, p_principal_key: principalKey }, signal);
    if (await authorize() !== principalKey) throw new CheckoutLegacyBoundaryError("checkout_unauthorized", 401);
    if (!response || !Object.hasOwn(response, "data") || response.error !== null) throw new Error("unavailable");
    if (response.data === null) return null;
    const raw = response.data as { result?: { operationKey?: unknown } };
    if (typeof raw?.result?.operationKey !== "string") throw new Error("invalid");
    const original = parseCheckoutOriginalResult(raw, { siteId: stable.siteId, operationKey: raw.result.operationKey });
    const kind = original.method === "on_site" ? original.result.terms.resourceKind : original.result.resourceKind;
    const id = original.method === "on_site" ? original.result.terms.resourceId : original.result.resourceId;
    if (kind !== stable.kind || id !== stable.id) throw new Error("invalid"); return original;
  } catch (error) { if (error instanceof CheckoutLegacyBoundaryError) throw error; throw new CheckoutLegacyBoundaryError("checkout_unavailable", 503); }
}
