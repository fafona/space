import { NextResponse } from "next/server";
import { listOwnCheckoutCouponClaims } from "@/lib/merchantCheckoutCoupons";
import { checkoutPrincipalKey } from "@/lib/merchantCheckoutQuote.server";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { loadStoredMerchantMemberships } from "@/lib/merchantMembershipsStore";
import { getMerchantCouponsSnapshot } from "@/lib/merchantCoupons.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { getMerchantServiceState } from "@/lib/merchantServiceStatus";

const defaults = {
  enabled: isMemberCheckoutPilotEnabled,
  session: resolvePersonalAccountSessionFromRequest,
  site: loadCurrentMerchantSnapshotSiteBySiteId,
  members: async (siteId: string) => {
    const client = createServerSupabaseServiceClient();
    if (!client) throw new Error("unavailable");
    return loadStoredMerchantMemberships(client, siteId);
  },
  coupons: getMerchantCouponsSnapshot,
  now: () => new Date().toISOString(),
};
export type MemberCheckoutCouponReadDependencies = typeof defaults;
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: {
    "cache-control": "private, no-store, max-age=0", "pragma": "no-cache", "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin", "referrer-policy": "no-referrer", "vary": "Cookie, Authorization",
  } });
}
function currentPrincipal(session: Awaited<ReturnType<typeof defaults.session>>) {
  const verified = (session?.user as { email_confirmed_at?: unknown } | undefined)?.email_confirmed_at;
  if (!session || session.servicePaused || typeof verified !== "string" || !Number.isFinite(Date.parse(verified))) return null;
  return checkoutPrincipalKey(session);
}
/** Read-only path. Does not call scheduled membership awards, claim/redeem,
 * snapshot repair, Stripe or any write RPC. Identity is never supplied by URL. */
export async function handleMemberCheckoutCouponGet(request: Request, overrides: Partial<MemberCheckoutCouponReadDependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  try {
    if (request.headers.has("x-merchant-access-token")) return json({ error: "business_scope_required" }, 403);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !["siteId", "offset", "limit"].includes(key))
      || ["siteId", "offset", "limit"].some(key => params.getAll(key).length > 1)) return json({ error: "checkout_invalid_request" }, 400);
    const siteId = params.get("siteId") ?? "", offset = params.get("offset") ?? "0", limit = params.get("limit") ?? "50";
    if (!/^\d{8}$/.test(siteId) || !/^\d{1,6}$/.test(offset) || !/^\d{1,3}$/.test(limit)
      || Number(limit) < 1 || Number(limit) > 100) return json({ error: "checkout_invalid_request" }, 400);
    if (!dependencies.enabled(siteId)) return json({ error: "checkout_disabled" }, 503);
    const session = await dependencies.session(request), principal = currentPrincipal(session);
    if (!principal || !session) return json({ error: "checkout_unauthorized" }, 401);
    const site = await dependencies.site(siteId);
    if (!site || site.id !== siteId || getMerchantServiceState(site.status, site.serviceExpiresAt).reason !== null
      || !site.permissionConfig?.allowMembershipManagement || !site.permissionConfig?.allowCouponModule) {
      return json({ error: "checkout_module_unavailable" }, 403);
    }
    const stored = await dependencies.members(siteId);
    if (stored && stored.siteId !== siteId) throw new Error("scope");
    const own = (stored?.memberships ?? []).filter(member => member.siteId === siteId
      && Boolean(member.accountId || member.userId) && (!member.accountId || member.accountId === session.accountId)
      && (!member.userId || member.userId === session.userId));
    if (own.length > 1) return json({ error: "checkout_membership_unavailable" }, 409);
    if (own[0]?.status !== "active") return json({ error: "checkout_membership_required" }, 403);
    const snapshot = await dependencies.coupons(siteId);
    const coupons = listOwnCheckoutCouponClaims(snapshot.coupons, { siteId, accountId: session.accountId, userId: session.userId,
      membershipActive: true, now: dependencies.now() });
    // Authentication is checked again after potentially slow data reads. Never
    // return the previous account's wallet after an account switch/revocation.
    if (currentPrincipal(await dependencies.session(request)) !== principal) return json({ error: "checkout_unauthorized" }, 401);
    return json({ ok: true, coupons: coupons.slice(Number(offset), Number(offset) + Number(limit)), total: coupons.length,
      offset: Number(offset), limit: Number(limit), hasMore: Number(offset) + Number(limit) < coupons.length });
  } catch { return json({ error: "checkout_coupons_unavailable" }, 503); }
}
export async function GET(request: Request) { return handleMemberCheckoutCouponGet(request); }
