import { NextResponse } from "next/server";
import { handleMemberCheckoutPreview, type MemberCheckoutPreviewHttpDependencies } from "../preview/route-handler";
import { handleMemberCheckoutSubmit, type MemberCheckoutSubmitDependencies } from "../submit/route-handler";
import { handleOnSiteCheckout, type OnSiteHttpDependencies } from "@/lib/merchantCheckoutOnSiteHttp.server";
import { isMemberCheckoutIntentPilotEnabled } from "@/lib/merchantCheckoutCartPilot.server";
import { isMemberCheckoutOnSitePilotEnabled } from "@/lib/merchantCheckoutOnSitePilot.server";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { submitMemberCheckout } from "@/lib/merchantCheckoutSubmission.server";
type SingleRpc = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<{ data: unknown; error: { message?: string } | null }>;
const defaults = { enabled: isMemberCheckoutIntentPilotEnabled, cashEnabled: isMemberCheckoutOnSitePilotEnabled, session: resolvePersonalAccountSessionFromRequest,
  call: (async (name, args, signal) => { const client = createServerSupabaseServiceClient(); if (!client) throw Error("unavailable"); return client.rpc(name, args).abortSignal(signal); }) as SingleRpc };
export type SingleIntentHttpDependencies = Partial<typeof defaults> & { pointsPreview?: Partial<MemberCheckoutPreviewHttpDependencies>; pointsSubmit?: Partial<MemberCheckoutSubmitDependencies>; onSite?: Partial<OnSiteHttpDependencies> };
const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache", vary: "Cookie, Authorization, X-Checkout-Account-Scope", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin", "x-content-type-options": "nosniff" } });
/** Independent adapter; old HTTP handlers and atomic financial planners stay
 * unchanged. Exact account/session, full rollout gates and a bounded request
 * also apply to the old handler's repeated authorization before any write. */
export async function handleSingleIntentCheckout(method: string, action: string, request: Request, overrides: SingleIntentHttpDependencies = {}) {
  const deps = { ...defaults, ...overrides };
  if (!['points', 'on-site'].includes(method) || !['preview', 'submit'].includes(action)) return json("checkout_invalid_request", 400);
  if (request.method !== "POST") return json("method_not_allowed", 405);
  if (!isTrustedSameOriginMutationRequest(request)) return json("forbidden_origin", 403);
  const accountId = request.headers.get("x-checkout-account-scope");
  if (!accountId || !/^\d{8}$/.test(accountId) || request.headers.has("x-merchant-access-token")) return json("checkout_unauthorized", 401);
  const abort = new AbortController(), signal = AbortSignal.any([request.signal, abort.signal]); let stop: () => void = () => {};
  let principal: string | null = null, boundSite: string | null = null, rollback: string | null = null;
  const enabled = (siteId: string) => { if (boundSite !== null && boundSite !== siteId) return false; boundSite = siteId;
    return !signal.aborted && deps.enabled(siteId) && (method === "points" || deps.cashEnabled(siteId)); };
  const session = async (input: Request) => {
    if (!boundSite || !enabled(boundSite)) throw Error("unavailable"); const value = await deps.session(input); if (!enabled(boundSite)) throw Error("unavailable");
    const stamp = (value?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
    if (!value || value.accountId !== accountId || value.servicePaused || typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp))) return null;
    const key = JSON.stringify([value.accountId, value.userId]); if (principal !== null && principal !== key) return null; principal = key; return value;
  };
  const call: SingleRpc = async (name, args, inner) => {
    if (!boundSite || !enabled(boundSite) || inner.aborted || !/^faolla_member_checkout_(?:submission_(?:snapshot|commit)_v2|on_site_(?:snapshot|commit)_v1)$/.test(name)) throw Error("unavailable");
    const response = await (method === "on-site" && overrides.onSite?.call ? overrides.onSite.call(name, args, inner) : deps.call(name, args, inner));
    // Only an explicit private SQL transaction rejection proves no write.
    // Timeout, thrown transport errors and post-write auth failures do not.
    if (name.includes("commit") && response.data === null && ["checkout_original_pending", "checkout_intent_review_required"].includes(response.error?.message ?? "")) rollback = response.error!.message!;
    return response;
  };
  const timer = setTimeout(() => abort.abort(), 12_000);
  const unavailable = () => json(action === "submit" ? "checkout_unconfirmed" : "checkout_unavailable", 503);
  try {
    const bounded = new Promise<Response>(resolve => { stop = () => resolve(unavailable()); signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop(); });
    const owned = new Request(request, { signal });
    const result = await Promise.race([method === "on-site" ? handleOnSiteCheckout(action as "preview" | "submit", owned, { ...overrides.onSite, call, session, enabled })
      : action === "preview" ? handleMemberCheckoutPreview(owned, { ...overrides.pointsPreview, session, enabled }) : handleMemberCheckoutSubmit(owned, { submit: input => submitMemberCheckout(input, (name, args, inner) => call(name, args, inner ?? signal)), ...overrides.pointsSubmit, session, enabled }), bounded]);
    if (signal.aborted || boundSite !== null && !enabled(boundSite)) return unavailable();
    if (rollback) { const current = await Promise.race([session(owned), bounded.then(() => null)]); if (!current || signal.aborted) return unavailable(); return json(rollback, 409); }
    const headers = new Headers(result.headers); headers.set("vary", "Cookie, Authorization, X-Checkout-Account-Scope");
    return new Response(result.body, { status: result.status, headers });
  } catch { return unavailable(); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", stop); abort.abort(); }
}
