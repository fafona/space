import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractMerchantPrefixFromHost } from "@/lib/siteRouting";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";
import {
  MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE,
  MERCHANT_AUTH_COOKIE,
  MERCHANT_AUTH_MERCHANT_ID_COOKIE,
  MERCHANT_AUTH_REFRESH_COOKIE,
} from "@/lib/merchantAuthSession";
import {
  LEGACY_SUPER_ADMIN_DEVICE_ID_COOKIE,
  LEGACY_SUPER_ADMIN_SESSION_COOKIE,
  LEGACY_SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
} from "@/lib/superAdminSession";
import { appendLegacyCookieExpiration } from "@/lib/legacyCookieCleanup";
import {
  isCanonicalPortalRequest,
  resolveCanonicalPortalHostname,
  resolveCanonicalPortalOrigin,
} from "@/lib/canonicalPortalRequest";
import {
  isCanonicalSuperAdminRequest,
  resolveCanonicalSuperAdminOrigin,
} from "@/lib/canonicalSuperAdminRequest";

const RESERVED_SUBDOMAIN_PREFIXES = new Set(["www", "main", "portal", "console", "public", "admin", "launch"]);
const RESERVED_PATH_SEGMENTS = new Set([
  "admin",
  "api",
  "auth",
  "card",
  "connect",
  "icon.svg",
  "industry",
  "launch",
  "me",
  "login",
  "portal",
  "reset-password",
  "share",
  "site",
  "super-admin",
]);
const TRUSTED_PLATFORM_ROOT_ASSET_PATHS = new Set([
  "/apple-icon.png",
  "/apple-touch-icon.png",
  "/favicon.ico",
  "/faolla-app-icon.svg",
  "/faolla-app-icon-192.png",
  "/faolla-app-icon-512.png",
  "/faolla-login-logo.png",
  "/faolla-logo-f.png",
  "/faolla-sw.js",
  "/file.svg",
  "/globe.svg",
  "/icon.png",
  "/icon.svg",
  "/manifest.webmanifest",
  "/next.svg",
  "/robots.txt",
  "/sitemap.xml",
  "/vercel.svg",
  "/window.svg",
  "/loading-progress-desktop-en.webp",
  "/loading-progress-desktop-zh.webp",
  "/loading-progress-mobile-en.webp",
  "/loading-progress-mobile-zh.webp",
]);
const SUPER_ADMIN_CONSOLE_SHARED_API_PATHS = new Set([
  "/api/assets/upload",
  "/api/merchant-chat-business-card",
  "/api/merchant-draft",
  "/api/publish",
  "/api/site-published",
]);
const LEGACY_CROSS_SUBDOMAIN_COOKIE_NAMES = new Set([
  "merchant-space-account-type",
  "merchant-space-merchant-auth",
  "merchant-space-merchant-id",
  "merchant-space-merchant-refresh",
  "merchant-space-reset-recovery",
  "merchant-space-reset-recovery-refresh",
  "faolla-legacy-personal-recovery",
  "faolla-google-oauth-entry",
  LEGACY_SUPER_ADMIN_DEVICE_ID_COOKIE,
  LEGACY_SUPER_ADMIN_SESSION_COOKIE,
  LEGACY_SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
]);
const LEGACY_BROWSER_AUTH_COOKIE_NAME_PATTERN = /^faolla-auth-storage\.[A-Za-z0-9_-]{1,80}$/;
const MAX_LEGACY_COOKIE_EXPIRATIONS_PER_RESPONSE = 16;
const INTERNAL_MERCHANT_REWRITE_PARAM = "__merchantInternalRewrite";
const HTTPS_REDIRECT_STATUS = 308;
const FORWARDED_PROTO_HEADER = "x-forwarded-proto";
const FORWARDED_HOST_HEADER = "x-forwarded-host";
const FAOLLA_SECTION_PARAM = "section";
const FAOLLA_SECTION_VALUE = "faolla";
const FAOLLA_URL_PARAM = "faollaUrl";
const FAOLLA_APP_SHELL_PARAM = "appShell";
const FAOLLA_APP_SHELL_VALUE = "faolla";
const FAOLLA_INLINE_BUILD_PARAM = "__faollaInlineBuild";
const FAOLLA_INLINE_BUILD_ID = String(process.env.NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID ?? "").trim();
const I18N_URL_PARAM = "uiLocale";
const DEFAULT_LOCALE = "zh-CN";
const SITE_RESOLVE_QUERY_TIMEOUT_MS = 900;
const SITE_RESOLVE_CACHE_TTL_MS = 60_000;
const SITE_RESOLVE_MISS_CACHE_TTL_MS = 5_000;
const PROXY_HINT_HEADERS = [
  FORWARDED_HOST_HEADER,
  "x-forwarded-for",
  "x-forwarded-port",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "forwarded",
  "via",
];

type SiteResolveRow = {
  merchant_id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type SiteResolveCacheEntry = {
  expiresAt: number;
  pending?: Promise<string>;
  siteId?: string;
};

const siteResolveCache = new Map<string, SiteResolveCacheEntry>();

function getFallbackPrefixFromHost(host: string) {
  const hostname = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    ?.split(":")[0]
    ?.trim() ?? "";
  if (!hostname) return "";
  if (hostname === "localhost" || hostname === "127.0.0.1") return "";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return "";
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 3) return "";
  const candidate = labels[0] ?? "";
  if (!candidate || RESERVED_SUBDOMAIN_PREFIXES.has(candidate)) return "";
  return candidate;
}

function readEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

function readForwardedHeaderValue(headers: Headers, name: string) {
  return (headers.get(name) ?? "")
    .split(",")[0]
    ?.trim() ?? "";
}

function normalizeRequestHostname(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";

  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return new URL(candidate).hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "")
      .replace(/^\[|\]$/g, "");
  }
}

function parseRequestHost(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return { hostname: "", port: "" };

  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const url = new URL(candidate);
    return {
      hostname: url.hostname.trim().toLowerCase(),
      port: url.port.trim(),
    };
  } catch {
    return {
      hostname: normalizeRequestHostname(trimmed),
      port: "",
    };
  }
}

export function isLocalLikeRequestHostname(value: string) {
  const hostname = normalizeRequestHostname(value);
  return (
    !hostname ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
    hostname.includes(":")
  );
}

function readRequestPublicHost(headers: Headers, requestUrl: URL) {
  const host = (headers.get("host") ?? "").trim();
  if (host && !isLocalLikeRequestHostname(host)) return host;
  return readForwardedHeaderValue(headers, FORWARDED_HOST_HEADER) || host || requestUrl.host;
}

function hasProxyHints(headers: Headers) {
  return PROXY_HINT_HEADERS.some((name) => (headers.get(name) ?? "").trim().length > 0);
}

export function resolveHttpsRedirectUrl(requestUrl: URL, headers: Headers) {
  const publicHost = readRequestPublicHost(headers, requestUrl);
  if (isLocalLikeRequestHostname(publicHost || requestUrl.hostname)) return null;

  const forwardedProto = readForwardedHeaderValue(headers, FORWARDED_PROTO_HEADER).toLowerCase();
  if (forwardedProto && forwardedProto !== "http") return null;
  if (!forwardedProto && hasProxyHints(headers)) return null;

  const requestProtocol = forwardedProto || requestUrl.protocol.replace(/:$/, "").trim().toLowerCase();
  if (requestProtocol !== "http") return null;

  const redirectUrl = new URL(requestUrl.toString());
  redirectUrl.protocol = "https:";
  if (publicHost) {
    try {
      const { hostname, port } = parseRequestHost(publicHost);
      if (hostname) redirectUrl.hostname = hostname;
      redirectUrl.port = port;
    } catch {
      return redirectUrl;
    }
  }
  return redirectUrl;
}

function toTimestamp(value: string | null | undefined) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function choosePreferredSiteResolveRow(current: SiteResolveRow | null, candidate: SiteResolveRow) {
  if (!current) return candidate;
  const currentMerchantId = String(current.merchant_id ?? "").trim();
  const candidateMerchantId = String(candidate.merchant_id ?? "").trim();
  const currentNumeric = isMerchantNumericId(currentMerchantId);
  const candidateNumeric = isMerchantNumericId(candidateMerchantId);
  if (candidateNumeric && !currentNumeric) return candidate;
  if (currentNumeric && !candidateNumeric) return current;

  const currentUpdatedAt = Math.max(toTimestamp(current.updated_at), toTimestamp(current.created_at));
  const candidateUpdatedAt = Math.max(toTimestamp(candidate.updated_at), toTimestamp(candidate.created_at));
  return candidateUpdatedAt >= currentUpdatedAt ? candidate : current;
}

function pickResolvedSiteRow(rows: SiteResolveRow[]) {
  return rows
    .filter((item) => String(item.merchant_id ?? "").trim().length > 0)
    .reduce<SiteResolveRow | null>((best, item) => choosePreferredSiteResolveRow(best, item), null);
}

export function __clearMiddlewareSiteResolveCacheForTests() {
  siteResolveCache.clear();
}

function readCachedSiteResolve(prefix: string) {
  const cached = siteResolveCache.get(prefix);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) siteResolveCache.delete(prefix);
    return null;
  }
  return cached;
}

function writeSiteResolveCache(prefix: string, siteId: string) {
  siteResolveCache.set(prefix, {
    expiresAt: Date.now() + (siteId ? SITE_RESOLVE_CACHE_TTL_MS : SITE_RESOLVE_MISS_CACHE_TTL_MS),
    siteId,
  });
}

function shouldNoStoreAppShellPath(pathname: string) {
  return (
    pathname === "/launch" ||
    pathname === "/admin" ||
    pathname === "/me" ||
    pathname === "/login" ||
    pathname.startsWith("/super-admin") ||
    pathname.startsWith("/api/super-admin") ||
    SUPER_ADMIN_CONSOLE_SHARED_API_PATHS.has(pathname) ||
    pathname.startsWith("/me/") ||
    /^\/\d{8}(?:\/|$)/.test(pathname)
  );
}

function shouldNoStoreRootRequest(request: NextRequest) {
  if (request.nextUrl.pathname !== "/") return false;
  const params = request.nextUrl.searchParams;
  return (
    params.get("appShell") === "faolla" ||
    params.get("nativeStart") === "1" ||
    params.has("nativeBuild") ||
    params.has("__faollaInlineBuild")
  );
}

function isMobileRequest(request: NextRequest) {
  const chMobile = (request.headers.get("sec-ch-ua-mobile") ?? "").trim();
  if (chMobile === "?1") return true;

  const viewportWidth = Number.parseInt((request.headers.get("viewport-width") ?? "").trim(), 10);
  if (Number.isFinite(viewportWidth) && viewportWidth > 0) return viewportWidth <= 768;

  const userAgent = request.headers.get("user-agent") ?? "";
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Windows Phone/i.test(userAgent);
}

function isFaollaHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "faolla.com" || normalized.endsWith(".faolla.com");
}

function isTrustedFaollaShellTarget(targetUrl: URL, requestUrl: URL) {
  if (targetUrl.origin === requestUrl.origin) return true;
  if (isFaollaHostname(targetUrl.hostname) && isFaollaHostname(requestUrl.hostname)) return true;
  return normalizeRequestHostname(targetUrl.hostname) === normalizeRequestHostname(requestUrl.hostname);
}

function isBackendOrApiShellPath(pathname: string) {
  return /^\/(?:\d{8}|admin|api|login|me|super-admin)(?:\/|$)/i.test(pathname);
}

function isAuthenticatedOwnMerchantRequest(request: NextRequest, merchantId: string) {
  const sessionToken = String(request.cookies.get(MERCHANT_AUTH_COOKIE)?.value ?? "").trim();
  const refreshToken = String(request.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.value ?? "").trim();
  if (!sessionToken && !refreshToken) return false;

  const accountType = String(request.cookies.get(MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE)?.value ?? "")
    .trim()
    .toLowerCase();
  const sessionMerchantId = String(request.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.value ?? "").trim();
  return accountType === "merchant" && sessionMerchantId === merchantId;
}

function buildFaollaSectionRedirectUrl(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const segments = pathname.split("/").filter(Boolean);
  const merchantId = segments[0] ?? "";
  if (segments.length !== 1 || !isMerchantNumericId(merchantId)) return null;
  if ((request.nextUrl.searchParams.get(FAOLLA_SECTION_PARAM) ?? "").trim().toLowerCase() !== FAOLLA_SECTION_VALUE) {
    return null;
  }
  if (isAuthenticatedOwnMerchantRequest(request, merchantId)) return null;

  const rawTarget = (request.nextUrl.searchParams.get(FAOLLA_URL_PARAM) ?? "").trim() || "/";
  let targetUrl: URL;
  try {
    targetUrl = new URL(rawTarget, request.nextUrl.origin);
  } catch {
    targetUrl = new URL("/", request.nextUrl.origin);
  }

  if (!isTrustedFaollaShellTarget(targetUrl, request.nextUrl) || isBackendOrApiShellPath(targetUrl.pathname)) {
    targetUrl = new URL("/", request.nextUrl.origin);
  }

  const locale = (request.nextUrl.searchParams.get(I18N_URL_PARAM) ?? "").trim() || DEFAULT_LOCALE;
  targetUrl.searchParams.set(I18N_URL_PARAM, locale);
  targetUrl.searchParams.set(FAOLLA_APP_SHELL_PARAM, FAOLLA_APP_SHELL_VALUE);
  if (FAOLLA_INLINE_BUILD_ID) {
    targetUrl.searchParams.set(FAOLLA_INLINE_BUILD_PARAM, FAOLLA_INLINE_BUILD_ID.slice(0, 12));
  }
  return targetUrl;
}

function buildBadOauthStateRedirectUrl(request: NextRequest) {
  if (request.nextUrl.pathname !== "/") return null;
  if ((request.nextUrl.searchParams.get("error_code") ?? "").trim().toLowerCase() !== "bad_oauth_state") {
    return null;
  }
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  redirectUrl.search = "";
  redirectUrl.searchParams.set("oauth_error", "bad_oauth_state");
  const appShell = (request.nextUrl.searchParams.get("appShell") ?? "").trim();
  const loginFrom = (request.nextUrl.searchParams.get("loginFrom") ?? "").trim();
  if (appShell) redirectUrl.searchParams.set("appShell", appShell);
  if (loginFrom) redirectUrl.searchParams.set("loginFrom", loginFrom);
  return redirectUrl;
}

function withAppShellNoStore(response: NextResponse, request: NextRequest) {
  const nextResponse =
    shouldNoStoreAppShellPath(request.nextUrl.pathname) || shouldNoStoreRootRequest(request)
      ? withNoStore(response)
      : response;
  return withSecurityHeaders(nextResponse, request);
}

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function isTrustedPlatformRootAssetPath(pathname: string) {
  return TRUSTED_PLATFORM_ROOT_ASSET_PATHS.has(pathname.toLowerCase());
}

function isSensitiveUiOrAuthPath(pathname: string) {
  return /^(?:\/(?:admin|login|launch|me|reset-password|super-admin))(?:\/|$)/i.test(pathname) ||
    /^\/api\/(?:auth|super-admin)(?:\/|$)/i.test(pathname);
}

function withSecurityHeaders(response: NextResponse, request: NextRequest) {
  expireLegacyCrossSubdomainCookies(response, request);
  const sensitive = isSensitiveUiOrAuthPath(request.nextUrl.pathname) || isCanonicalSuperAdminRequest(request);
  const frameAncestors = sensitive
    ? "'none'"
    : `'self' ${resolveCanonicalPortalOrigin()}`;
  response.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${frameAncestors}; object-src 'none'; base-uri 'self'; form-action 'self'`,
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), payment=()");
  if (sensitive) response.headers.set("X-Frame-Options", "DENY");
  else response.headers.delete("X-Frame-Options");
  return response;
}

function expireLegacyCrossSubdomainCookies(response: NextResponse, request: NextRequest) {
  const names = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("=")[0]?.trim() ?? "")
    .filter(
      (name, index, values) =>
        Boolean(name) &&
        (LEGACY_CROSS_SUBDOMAIN_COOKIE_NAMES.has(name) || LEGACY_BROWSER_AUTH_COOKIE_NAME_PATTERN.test(name)) &&
        values.indexOf(name) === index,
    )
    .sort(
      (left, right) =>
        Number(LEGACY_CROSS_SUBDOMAIN_COOKIE_NAMES.has(right)) -
        Number(LEGACY_CROSS_SUBDOMAIN_COOKIE_NAMES.has(left)),
    )
    .slice(0, MAX_LEGACY_COOKIE_EXPIRATIONS_PER_RESPONSE);
  if (names.length === 0) return;

  const portalHostname = resolveCanonicalPortalHostname();
  const rootHostname = portalHostname.startsWith("www.") ? portalHostname.slice(4) : portalHostname;
  const requestHostname = normalizeRequestHostname(readRequestPublicHost(request.headers, request.nextUrl));
  const canClearRootDomain =
    Boolean(rootHostname) &&
    (requestHostname === rootHostname || requestHostname.endsWith(`.${rootHostname}`));

  for (const name of names) {
    appendLegacyCookieExpiration(response, name);
    if (canClearRootDomain) {
      appendLegacyCookieExpiration(response, name, { domain: rootHostname });
    }
  }
}

function redirectToOrigin(request: NextRequest, origin: string, pathname = request.nextUrl.pathname) {
  const target = new URL(pathname, origin);
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, HTTPS_REDIRECT_STATUS);
}

function isCanonicalLaunchHost(request: NextRequest) {
  const portalHostname = resolveCanonicalPortalHostname();
  const rootHostname = portalHostname.startsWith("www.") ? portalHostname.slice(4) : portalHostname;
  if (!rootHostname) return false;
  const requestHostname = normalizeRequestHostname(readRequestPublicHost(request.headers, request.nextUrl));
  return requestHostname === `launch.${rootHostname}`;
}

function resolvePublicContentOrigin() {
  const portalHostname = resolveCanonicalPortalHostname();
  const rootHostname = portalHostname.startsWith("www.") ? portalHostname.slice(4) : portalHostname;
  return rootHostname ? `https://public.${rootHostname}` : "";
}

function wrongOriginResponse(request: NextRequest, error: string) {
  return withSecurityHeaders(
    NextResponse.json({ error }, { status: 421 }),
    request,
  );
}

function buildTenantOriginRedirect(request: NextRequest, entry: string, pathname = "/") {
  const normalizedEntry = normalizeDomainPrefix(entry);
  if (!normalizedEntry || RESERVED_PATH_SEGMENTS.has(normalizedEntry)) return null;
  const portalHostname = resolveCanonicalPortalHostname();
  const rootHostname = portalHostname.startsWith("www.") ? portalHostname.slice(4) : portalHostname;
  if (!rootHostname || isLocalLikeRequestHostname(rootHostname)) return null;
  const target = new URL(pathname, `https://${normalizedEntry}.${rootHostname}/`);
  target.search = request.nextUrl.search;
  return target;
}

function isAuthenticatedRequest(request: NextRequest) {
  const sessionToken = String(request.cookies.get(MERCHANT_AUTH_COOKIE)?.value ?? "").trim();
  const refreshToken = String(request.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.value ?? "").trim();
  return Boolean(sessionToken || refreshToken);
}

function buildMobileGuestShellRedirectUrl(request: NextRequest, sourceUrl: URL) {
  if (!isMobileRequest(request)) return null;
  if (isAuthenticatedRequest(request)) return null;
  if ((request.nextUrl.searchParams.get(FAOLLA_APP_SHELL_PARAM) ?? "").trim().toLowerCase() === FAOLLA_APP_SHELL_VALUE) {
    return null;
  }
  if ((request.nextUrl.searchParams.get("entry") ?? "").trim().toLowerCase() === "card") return null;
  if ((request.nextUrl.searchParams.get("stayPublic") ?? "").trim() === "1") return null;

  const cleanedSource = new URL(sourceUrl.toString());
  cleanedSource.searchParams.delete(FAOLLA_APP_SHELL_PARAM);
  cleanedSource.searchParams.delete(FAOLLA_INLINE_BUILD_PARAM);
  cleanedSource.searchParams.delete("__faollaWebBuild");
  cleanedSource.searchParams.delete("nativeBuild");

  const redirectUrl = new URL(sourceUrl.toString());
  redirectUrl.pathname = "/me";
  redirectUrl.search = "";
  redirectUrl.searchParams.set(FAOLLA_SECTION_PARAM, FAOLLA_SECTION_VALUE);
  redirectUrl.searchParams.set(FAOLLA_URL_PARAM, cleanedSource.toString());
  const locale = (request.nextUrl.searchParams.get(I18N_URL_PARAM) ?? "").trim();
  if (locale) redirectUrl.searchParams.set(I18N_URL_PARAM, locale);
  return redirectUrl;
}

function buildPublicRequestUrl(request: NextRequest) {
  const publicUrl = request.nextUrl.clone();
  const publicHost = readRequestPublicHost(request.headers, request.nextUrl);
  if (publicHost) {
    const { hostname, port } = parseRequestHost(publicHost);
    if (hostname) publicUrl.hostname = hostname;
    publicUrl.port = port;
  }

  const forwardedProto = readForwardedHeaderValue(request.headers, FORWARDED_PROTO_HEADER).toLowerCase();
  const normalizedProto =
    forwardedProto ||
    (publicHost && !isLocalLikeRequestHostname(publicHost) && isLocalLikeRequestHostname(request.nextUrl.host)
      ? "https"
      : request.nextUrl.protocol.replace(/:$/, "").trim().toLowerCase());
  if (normalizedProto === "http" || normalizedProto === "https") {
    publicUrl.protocol = `${normalizedProto}:`;
  }
  return publicUrl;
}

function buildLaunchSessionRedirectUrl(request: NextRequest) {
  if (request.nextUrl.pathname !== "/launch") return null;

  const accessToken = String(request.cookies.get(MERCHANT_AUTH_COOKIE)?.value ?? "").trim();
  const refreshToken = String(request.cookies.get(MERCHANT_AUTH_REFRESH_COOKIE)?.value ?? "").trim();
  if (!accessToken && !refreshToken) return null;

  const accountType = String(request.cookies.get(MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE)?.value ?? "")
    .trim()
    .toLowerCase();
  const merchantId = String(request.cookies.get(MERCHANT_AUTH_MERCHANT_ID_COOKIE)?.value ?? "").trim();
  const targetPath =
    accountType === "personal" ? "/me" : isMerchantNumericId(merchantId) ? `/${merchantId}` : "";
  if (!targetPath) return null;

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = targetPath;
  redirectUrl.search = "";
  redirectUrl.searchParams.set(FAOLLA_APP_SHELL_PARAM, FAOLLA_APP_SHELL_VALUE);
  return redirectUrl;
}

async function resolveSiteIdByPrefix(prefix: string, request: NextRequest) {
  const normalizedPrefix = normalizeDomainPrefix(prefix);
  if (!normalizedPrefix) return "";

  const cached = readCachedSiteResolve(normalizedPrefix);
  if (cached?.pending) return cached.pending;
  if (cached?.siteId !== undefined) return cached.siteId;

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return "";

  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SITE_RESOLVE_QUERY_TIMEOUT_MS);
    const query = new URLSearchParams({
      select: "merchant_id,updated_at,created_at",
      slug: `eq.${normalizedPrefix}`,
      limit: "20",
    });
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/pages?${query.toString()}`, {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/json",
          "x-forwarded-host": readRequestPublicHost(request.headers, request.nextUrl),
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return "";

      const rows = (await response.json().catch(() => null)) as SiteResolveRow[] | null;
      if (!Array.isArray(rows) || rows.length === 0) return "";

      const chosen = pickResolvedSiteRow(rows);
      const siteId = String(chosen?.merchant_id ?? "").trim();
      return isMerchantNumericId(siteId) ? siteId : "";
    } catch {
      return "";
    } finally {
      clearTimeout(timeout);
    }
  })();

  siteResolveCache.set(normalizedPrefix, {
    expiresAt: Date.now() + SITE_RESOLVE_QUERY_TIMEOUT_MS,
    pending,
  });
  const siteId = await pending;
  writeSiteResolveCache(normalizedPrefix, siteId);
  return siteId;
}

export async function middleware(request: NextRequest) {
  const httpsRedirectUrl = resolveHttpsRedirectUrl(request.nextUrl, request.headers);
  if (httpsRedirectUrl) {
    return withSecurityHeaders(NextResponse.redirect(httpsRedirectUrl, HTTPS_REDIRECT_STATUS), request);
  }

  const pathname = request.nextUrl.pathname;
  const isConsoleHost = isCanonicalSuperAdminRequest(request);
  const isPortalHost = isCanonicalPortalRequest(request);

  if (!isPortalHost && pathname === "/" && isCanonicalLaunchHost(request)) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return wrongOriginResponse(request, "portal_origin_required");
    }
    const response = withSecurityHeaders(
      withNoStore(redirectToOrigin(request, resolveCanonicalPortalOrigin(), "/launch")),
      request,
    );
    response.headers.set("Clear-Site-Data", '"cache", "storage"');
    return response;
  }

  if (isConsoleHost) {
    if (pathname === "/") {
      return withSecurityHeaders(redirectToOrigin(request, resolveCanonicalSuperAdminOrigin(), "/super-admin"), request);
    }
    if (
      pathname.startsWith("/_next/") ||
      pathname === "/favicon.ico" ||
      pathname === "/icon.svg" ||
      isTrustedPlatformRootAssetPath(pathname) ||
      pathname === "/api/app-web-version" ||
      SUPER_ADMIN_CONSOLE_SHARED_API_PATHS.has(pathname) ||
      /^\/(?:super-admin|api\/super-admin)(?:\/|$)/i.test(pathname)
    ) {
      return withAppShellNoStore(NextResponse.next(), request);
    }
    return withSecurityHeaders(new NextResponse("Not Found", { status: 404 }), request);
  }

  if (/^\/(?:super-admin|api\/super-admin)(?:\/|$)/i.test(pathname)) {
    if (request.method === "GET" && !pathname.startsWith("/api/")) {
      return withSecurityHeaders(redirectToOrigin(request, resolveCanonicalSuperAdminOrigin()), request);
    }
    return wrongOriginResponse(request, "super_admin_console_origin_required");
  }

  if (!isPortalHost && /^\/api\/auth(?:\/|$)/i.test(pathname)) {
    return wrongOriginResponse(request, "portal_origin_required");
  }

  if (!isPortalHost && /^\/(?:admin|login|launch|me|reset-password)(?:\/|$)/i.test(pathname)) {
    if (request.method === "GET") {
      return withSecurityHeaders(redirectToOrigin(request, resolveCanonicalPortalOrigin()), request);
    }
    return wrongOriginResponse(request, "portal_origin_required");
  }

  if (isPortalHost && /^\/(?:card|share)(?:\/|$)/i.test(pathname)) {
    const publicContentOrigin = resolvePublicContentOrigin();
    if (publicContentOrigin) {
      return withSecurityHeaders(withNoStore(redirectToOrigin(request, publicContentOrigin)), request);
    }
  }

  if (isTrustedPlatformRootAssetPath(pathname)) {
    return withSecurityHeaders(NextResponse.next(), request);
  }

  const badOauthStateRedirectUrl = buildBadOauthStateRedirectUrl(request);
  if (badOauthStateRedirectUrl) {
    return withAppShellNoStore(NextResponse.redirect(badOauthStateRedirectUrl), request);
  }

  const launchSessionRedirectUrl = buildLaunchSessionRedirectUrl(request);
  if (launchSessionRedirectUrl) {
    return withAppShellNoStore(NextResponse.redirect(launchSessionRedirectUrl), request);
  }

  const faollaSectionRedirectUrl = buildFaollaSectionRedirectUrl(request);
  if (faollaSectionRedirectUrl) {
    return withAppShellNoStore(NextResponse.redirect(faollaSectionRedirectUrl), request);
  }

  const segments = pathname.split("/").filter(Boolean);

  const directPublishedSiteMatch = pathname.match(/^\/site\/(\d{8})(?:\/|$)/);
  if (isPortalHost && directPublishedSiteMatch) {
    const tenantUrl = buildTenantOriginRedirect(request, directPublishedSiteMatch[1] ?? "", pathname);
    if (tenantUrl) {
      return withSecurityHeaders(withNoStore(NextResponse.redirect(tenantUrl, HTTPS_REDIRECT_STATUS)), request);
    }
  }

  if (segments.length === 1 && isMerchantNumericId(segments[0] ?? "")) {
    if (isPortalHost && !isAuthenticatedOwnMerchantRequest(request, segments[0] ?? "")) {
      const tenantUrl = buildTenantOriginRedirect(request, segments[0] ?? "", pathname);
      if (tenantUrl) {
        return withSecurityHeaders(withNoStore(NextResponse.redirect(tenantUrl, HTTPS_REDIRECT_STATUS)), request);
      }
    }
    if (!isAuthenticatedOwnMerchantRequest(request, segments[0] ?? "")) {
      return withAppShellNoStore(NextResponse.next(), request);
    }
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = "/admin";
    rewriteUrl.searchParams.set("scope", `site-${segments[0]}`);
    rewriteUrl.searchParams.set(INTERNAL_MERCHANT_REWRITE_PARAM, "1");
    return withAppShellNoStore(NextResponse.rewrite(rewriteUrl), request);
  }

  if (pathname !== "/" && segments.length !== 1) return withAppShellNoStore(NextResponse.next(), request);

  const rewriteToPublishedSite = async (prefix: string) => {
    const resolvedSiteId = await resolveSiteIdByPrefix(prefix, request);
    if (!resolvedSiteId) return null;
    const guestShellRedirectUrl = buildMobileGuestShellRedirectUrl(request, buildPublicRequestUrl(request));
    if (guestShellRedirectUrl) return withNoStore(NextResponse.redirect(guestShellRedirectUrl));
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/site/${encodeURIComponent(resolvedSiteId)}`;
    return withNoStore(NextResponse.rewrite(rewriteUrl));
  };

  if (segments.length === 1) {
    const firstSegment = normalizeDomainPrefix(segments[0] ?? "");
    if (!firstSegment || RESERVED_PATH_SEGMENTS.has(firstSegment)) return withAppShellNoStore(NextResponse.next(), request);
    if (isPortalHost) {
      const tenantUrl = buildTenantOriginRedirect(request, firstSegment);
      if (tenantUrl) {
        return withSecurityHeaders(withNoStore(NextResponse.redirect(tenantUrl, HTTPS_REDIRECT_STATUS)), request);
      }
    }
    return withAppShellNoStore((await rewriteToPublishedSite(firstSegment)) ?? NextResponse.next(), request);
  }

  const host = readRequestPublicHost(request.headers, request.nextUrl);
  const baseDomain = process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "";
  const domainPrefix = extractMerchantPrefixFromHost(host, baseDomain) || getFallbackPrefixFromHost(host);
  if (!domainPrefix) return withAppShellNoStore(NextResponse.next(), request);

  const resolvedPrefixRewrite = await rewriteToPublishedSite(domainPrefix);
  if (resolvedPrefixRewrite) return withAppShellNoStore(resolvedPrefixRewrite, request);

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/${encodeURIComponent(domainPrefix)}`;
  return withSecurityHeaders(withNoStore(NextResponse.rewrite(rewriteUrl)), request);
}

export const config = {
  matcher: ["/", "/_next/static/:path*", "/((?!_next/image(?:/|$)).*)"],
};
