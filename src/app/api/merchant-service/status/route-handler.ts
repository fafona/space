import { NextResponse } from "next/server";
import { GET as readCanonicalSession } from "@/app/api/auth/merchant-session/route";
import { authorizeMerchantServiceOrigin, merchantServiceTenantOrigin } from "@/lib/merchantServiceOrigin.server";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { readMerchantAuthCookie, readMerchantAuthRefreshCookie } from "@/lib/merchantAuthSession";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { normalizePersonalFavorites, favoriteMatchesMerchant } from "@/lib/personalFavorites";

export const merchantServiceStatusDependencies = { authorize: authorizeMerchantServiceOrigin, renew: readCanonicalSession, resolveSession: resolvePersonalAccountSessionFromRequest, loadSite: loadCurrentMerchantSnapshotSiteBySiteId };
const deps = merchantServiceStatusDependencies;
export async function handleMerchantServiceStatus(request: Request, dependencies = deps) {
  if (!isCanonicalPortalRequest(request)) return NextResponse.json({ error: "portal_origin_required" }, { status: 421 });
  const origin = request.headers.get("origin") || new URL(request.url).origin;
  const siteId = new URL(request.url).searchParams.get("siteId") || "";
  const headers = { "cache-control": "private, no-store", vary: "Origin, Cookie", "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
  try {
    if (!await dependencies.authorize(request, origin, siteId)) return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
    if (request.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET" } });
    if (request.method !== "GET") return new NextResponse(null, { status: 405 });
    // Only this boolean, site-bound projection may cross origins. No identity, PII or tokens.
    if (!readMerchantAuthCookie(request) && !readMerchantAuthRefreshCookie(request)) return NextResponse.json({ ok: true, authenticated: false, favorited: false }, { headers });
    const renewed = await dependencies.renew(request);
    if (renewed.status === 401) {
      const response = NextResponse.json({ ok: true, authenticated: false, favorited: false }, { headers });
      for (const cookie of renewed.cookies.getAll()) response.cookies.set(cookie);
      return response;
    }
    if (!renewed.ok) return NextResponse.json({ ok: false, error: "service_status_unavailable" }, { status: 503, headers });
    const cookieMap = new Map((request.headers.get("cookie") || "").split(";").map(item => item.trim().split(/=(.*)/)).filter(parts => parts.length >= 2).map(parts => [parts[0], parts[1]]));
    for (const cookie of renewed.cookies.getAll()) cookieMap.set(cookie.name, cookie.value);
    const nextHeaders = new Headers(request.headers); nextHeaders.set("cookie", [...cookieMap].map(([name,value]) => `${name}=${value}`).join("; "));
    const session = await dependencies.resolveSession(new Request(request.url, { headers: nextHeaders }));
    const profile = session?.user.user_metadata?.personal_profile as { favoriteSites?: unknown } | undefined;
    const favorites = normalizePersonalFavorites(profile?.favoriteSites);
    let favorited = favorites.some(site => favoriteMatchesMerchant(site, siteId));
    if (!favorited && favorites.length) {
      const site = await dependencies.loadSite(siteId);
      const tenantOrigin = site ? merchantServiceTenantOrigin(site) : "";
      favorited = favorites.some(favorite => favoriteMatchesMerchant(favorite, siteId, tenantOrigin));
    }
    const response = NextResponse.json({ ok: true, authenticated: Boolean(session), favorited }, { headers });
    for (const cookie of renewed.cookies.getAll()) response.cookies.set(cookie);
    return response;
  } catch { return NextResponse.json({ ok: false, error: "service_status_unavailable" }, { status: 503, headers }); }
}
export async function GET(request: Request) { return handleMerchantServiceStatus(request); }
export async function OPTIONS(request: Request) { return handleMerchantServiceStatus(request); }
