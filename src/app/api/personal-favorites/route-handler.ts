import { NextResponse } from "next/server";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { joinMerchantMembership, leaveMerchantMembership, readPersonalMembershipProfileFromSession } from "@/lib/merchantMemberships.server";
import { readPersonalMembershipCardsFromUserMetadata, toPersonalMembershipCard } from "@/lib/merchantMemberships";
import { normalizePersonalFavorites, projectMembershipFavorite, readFavoriteSiteId, favoriteMatchesMerchant } from "@/lib/personalFavorites";
import { merchantServiceTenantOrigin } from "@/lib/merchantServiceOrigin.server";
import { loadCurrentMerchantSnapshotSiteBySiteId, loadPublishedMerchantServiceStateByTargetUrl } from "@/lib/publishedMerchantService";
import { isTrustedSameOriginMutationRequest, getTrustedMutationRequestErrorResponse } from "@/lib/requestMutationGuard";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status,
  headers: { "cache-control": "private, no-store", vary: "Cookie, Authorization" } });
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export const favoriteDependencies = { resolveSession: resolvePersonalAccountSessionFromRequest,
  join: joinMerchantMembership, leave: leaveMerchantMembership,
  loadSite: loadCurrentMerchantSnapshotSiteBySiteId, resolveTarget: loadPublishedMerchantServiceStateByTargetUrl };
type Dependencies = typeof favoriteDependencies;

function readFavorites(metadata: Record<string, unknown> | null | undefined = {}) {
  const profile = metadata?.personal_profile as { favoriteSites?: unknown } | undefined;
  return normalizePersonalFavorites(profile?.favoriteSites);
}

export async function handleFavoriteRead(request: Request, deps: Dependencies = favoriteDependencies) {
  if (!isCanonicalPortalRequest(request)) return json({ error: "portal_origin_required" }, 421);
  try {
    const session = await deps.resolveSession(request);
    // A guest is a normal storefront visitor, not an authentication error.
    if (!session) return json({ ok: true, authenticated: false, favoriteSites: [] });
    return json({ ok: true, authenticated: true, accountId: session.accountId,
      favoriteSites: readFavorites(session.user.user_metadata),
      memberships: readPersonalMembershipCardsFromUserMetadata(session.user.user_metadata ?? {}),
      profile: readPersonalMembershipProfileFromSession(session) });
  } catch { return json({ ok: false, error: "favorite_state_unavailable" }, 503); }
}

export async function handleFavoriteMutation(request: Request, deps: Dependencies = favoriteDependencies) {
  if (!isCanonicalPortalRequest(request)) return json({ error: "portal_origin_required" }, 421);
  if (!isTrustedSameOriginMutationRequest(request)) return getTrustedMutationRequestErrorResponse();
  if (request.headers.has("x-merchant-access-token")) return json({ ok: false, error: "personal_account_required" }, 403);
  try {
    const session = await deps.resolveSession(request);
    if (!session) return json({ ok: false, error: "unauthorized" }, 401);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = text(body?.action);
    if (action !== "favorite" && action !== "unfavorite") return json({ ok: false, error: "invalid_action" }, 400);
    let siteId = text(body?.siteId);
    const previousId = text(body?.favoriteId);
    const favorites = readFavorites(session.user.user_metadata);
    const previous = favorites.find(item => item.id === previousId);
    // Legacy favorites may have a domain-shaped ID. Resolve it, never accept an arbitrary target from the client.
    if (action === "unfavorite" && previous) {
      const resolvedId = readFavoriteSiteId(previous) || (await deps.resolveTarget(previous.url))?.siteId || "";
      if (siteId && resolvedId && siteId !== resolvedId) return json({ ok: false, error: "favorite_target_mismatch" }, 400);
      siteId = resolvedId;
    }
    if (!/^\d{8}$/.test(siteId)) return json({ ok: false, error: "invalid_site_id" }, 400);
    let membership;
    if (action === "favorite") {
      const site = await deps.loadSite(siteId);
      if (!site) return json({ ok: false, error: "site_not_found" }, 404);
      const name = site.merchantName || site.name || siteId;
      membership = await deps.join({ siteId, siteName: name, session, profile: body?.profile,
        previousFavoriteId: favorites.find(favorite => favoriteMatchesMerchant(favorite, siteId, merchantServiceTenantOrigin(site)))?.id,
        favorite: { id: siteId, name, url: `https://faolla.com/site/${siteId}`, subtitle: "", addedAt: new Date().toISOString() } });
    } else {
      try { membership = await deps.leave({ siteId, session, removeFavorite: true, previousFavoriteId: previous?.id }); }
      catch (error) {
        // A legacy bookmark without a membership can still be removed. Other failures must not be hidden.
        if (!(error instanceof Error) || error.message !== "membership_not_found" || !previous) throw error;
        const metadata = projectMembershipFavorite(session.user.user_metadata ?? {}, { siteId, remove: true, previousId: previous.id });
        const { error: saveError } = await session.adminSupabase.auth.admin.updateUserById(session.userId, { user_metadata: metadata });
        if (saveError) throw saveError;
      }
    }
    return json({ ok: true, ...(membership ? { membership: toPersonalMembershipCard(membership) } : {}),
      favorited: action === "favorite", siteId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "favorite_save_failed";
    const validation = /请填写|格式不正确/.test(message);
    return json({ ok: false, error: "favorite_save_failed", message: validation ? message : "收藏状态暂时无法保存，请重新读取后重试。" }, validation ? 422 : 503);
  }
}

export async function GET(request: Request) { return handleFavoriteRead(request); }
export async function POST(request: Request) { return handleFavoriteMutation(request); }
