import type { NextResponse } from "next/server";
import {
  isCanonicalPortalRequest,
  resolveCanonicalPortalHostname,
  resolvePublicRequestHostname,
} from "@/lib/canonicalPortalRequest";
import { appendLegacyCookieExpiration } from "@/lib/legacyCookieCleanup";

export const MERCHANT_AUTH_COOKIE = "__Host-faolla-merchant-auth-v2";
export const MERCHANT_AUTH_REFRESH_COOKIE = "__Host-faolla-merchant-refresh-v2";
export const MERCHANT_AUTH_MERCHANT_ID_COOKIE = "__Host-faolla-merchant-id-v2";
export const MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE = "__Host-faolla-account-type-v2";
export const MERCHANT_AUTH_ACCESS_COOKIE_FALLBACK_MAX_AGE_SECONDS = 60 * 60;
export const MERCHANT_AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const LEGACY_MERCHANT_AUTH_COOKIE_NAMES = [
  "merchant-space-merchant-auth",
  "merchant-space-merchant-refresh",
  "merchant-space-merchant-id",
  "merchant-space-account-type",
] as const;

type MerchantAuthAccountType = "merchant" | "personal";

function normalizeMerchantId(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeMerchantAccountType(value: unknown): MerchantAuthAccountType | "" {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "merchant" || normalized === "personal" ? normalized : "";
}

function normalizeCookieMaxAge(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(60, Math.round(parsed));
}

function canUseMerchantAuthentication(request: Request) {
  return isCanonicalPortalRequest(request);
}

function resolveLegacyMerchantCookieDomain(canonicalHostname: string) {
  return canonicalHostname.replace(/^www\./, "");
}

function expireLegacyMerchantAuthCookies(response: NextResponse, request?: Request) {
  const canonicalHostname = resolveCanonicalPortalHostname();
  const legacyCookieDomain = resolveLegacyMerchantCookieDomain(canonicalHostname);
  const requestHostname = request ? resolvePublicRequestHostname(request) : "";
  const mayClearDomainCookie =
    legacyCookieDomain &&
    (requestHostname === legacyCookieDomain || requestHostname.endsWith(`.${legacyCookieDomain}`));

  for (const name of LEGACY_MERCHANT_AUTH_COOKIE_NAMES) {
    appendLegacyCookieExpiration(response, name, { httpOnly: true });
    if (mayClearDomainCookie) {
      appendLegacyCookieExpiration(response, name, {
        domain: legacyCookieDomain,
        httpOnly: true,
      });
    }
  }
}

export function parseCookieValues(cookieHeader: string, key: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${key}=`))
    .map((part) => part.slice(key.length + 1));
}

export function parseCookieValue(cookieHeader: string, key: string) {
  const values = parseCookieValues(cookieHeader, key).map((value) => value.trim()).filter(Boolean);
  return values.at(-1) ?? "";
}

function uniqueCookieCandidates(values: string[]) {
  const candidates: string[] = [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const normalized = String(values[index] ?? "").trim();
    if (!normalized || candidates.includes(normalized)) continue;
    candidates.push(normalized);
  }
  return candidates;
}

function readMerchantCookieCandidates(request: Request, key: string) {
  if (!canUseMerchantAuthentication(request)) return [];
  return uniqueCookieCandidates(parseCookieValues(request.headers.get("cookie") ?? "", key));
}

export function readMerchantAuthCookie(request: Request) {
  return readMerchantCookieCandidates(request, MERCHANT_AUTH_COOKIE)[0] ?? "";
}

export function readMerchantAuthRefreshCookie(request: Request) {
  return readMerchantCookieCandidates(request, MERCHANT_AUTH_REFRESH_COOKIE)[0] ?? "";
}

export function readMerchantAuthMerchantIdCookie(request: Request) {
  if (!canUseMerchantAuthentication(request)) return "";
  return normalizeMerchantId(parseCookieValue(request.headers.get("cookie") ?? "", MERCHANT_AUTH_MERCHANT_ID_COOKIE));
}

export function readMerchantAuthAccountTypeCookie(request: Request) {
  if (!canUseMerchantAuthentication(request)) return "";
  return normalizeMerchantAccountType(parseCookieValue(request.headers.get("cookie") ?? "", MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE));
}

function readRequestTokenHeader(request: Request, key: string) {
  if (!canUseMerchantAuthentication(request)) return [];
  const normalized = request.headers.get(key)?.trim() ?? "";
  return normalized ? [normalized] : [];
}

function uniqueRequestTokenCandidates(values: string[]) {
  const candidates: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || candidates.includes(normalized)) continue;
    candidates.push(normalized);
  }
  return candidates;
}

export function readMerchantRequestAccessTokens(request: Request) {
  return uniqueRequestTokenCandidates([
    ...readRequestTokenHeader(request, "x-merchant-access-token"),
    ...readMerchantCookieCandidates(request, MERCHANT_AUTH_COOKIE),
  ]);
}

export function readMerchantRequestRefreshTokens(request: Request) {
  return uniqueRequestTokenCandidates([
    ...readRequestTokenHeader(request, "x-merchant-refresh-token"),
    ...readMerchantCookieCandidates(request, MERCHANT_AUTH_REFRESH_COOKIE),
  ]);
}

export function setMerchantAuthCookie(response: NextResponse, accessToken: string, maxAgeSeconds?: unknown, request?: Request) {
  setMerchantAuthCookies(response, { accessToken, maxAgeSeconds }, request);
}

export function setMerchantAuthCookies(
  response: NextResponse,
  input: {
    accessToken: string;
    refreshToken?: string | null;
    maxAgeSeconds?: unknown;
    merchantId?: string | null;
    accountType?: MerchantAuthAccountType | null;
    preserveRefreshToken?: boolean;
  },
  request?: Request,
) {
  if (request && !canUseMerchantAuthentication(request)) {
    expireLegacyMerchantAuthCookies(response, request);
    return;
  }
  const normalizedAccessToken = String(input.accessToken ?? "").trim();
  const normalizedRefreshToken = String(input.refreshToken ?? "").trim();
  const normalizedMerchantId = normalizeMerchantId(input.merchantId);
  const normalizedAccountType = normalizeMerchantAccountType(input.accountType);
  const accessCookieMaxAge = normalizeCookieMaxAge(
    input.maxAgeSeconds,
    MERCHANT_AUTH_ACCESS_COOKIE_FALLBACK_MAX_AGE_SECONDS,
  );
  if (!normalizedAccessToken) {
    clearMerchantAuthCookies(response, request);
    return;
  }

  response.cookies.set(MERCHANT_AUTH_COOKIE, normalizedAccessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: accessCookieMaxAge,
  });

  if (normalizedRefreshToken) {
    response.cookies.set(MERCHANT_AUTH_REFRESH_COOKIE, normalizedRefreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: MERCHANT_AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS,
    });
  } else if (!input.preserveRefreshToken) {
    response.cookies.set(MERCHANT_AUTH_REFRESH_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
  }

  if (normalizedMerchantId) {
    response.cookies.set(MERCHANT_AUTH_MERCHANT_ID_COOKIE, normalizedMerchantId, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: MERCHANT_AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS,
    });
  } else {
    response.cookies.set(MERCHANT_AUTH_MERCHANT_ID_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
  }

  if (normalizedAccountType) {
    response.cookies.set(MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE, normalizedAccountType, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: MERCHANT_AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS,
    });
  } else if (!(input.preserveRefreshToken && input.accountType === undefined)) {
    response.cookies.set(MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
  }
  expireLegacyMerchantAuthCookies(response, request);
}

export function clearMerchantAuthCookie(response: NextResponse, request?: Request) {
  clearMerchantAuthCookies(response, request);
}

export function clearMerchantAuthMerchantIdCookie(
  response: NextResponse,
  request?: Request,
) {
  const cookieDomain = resolveMerchantCookieDomain(request);
  const secure = resolveMerchantCookieSecureFlag(request);
  response.cookies.set(MERCHANT_AUTH_MERCHANT_ID_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}

export function clearMerchantAuthCookies(response: NextResponse, request?: Request) {
  response.cookies.set(MERCHANT_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(MERCHANT_AUTH_REFRESH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(MERCHANT_AUTH_MERCHANT_ID_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(MERCHANT_AUTH_ACCOUNT_TYPE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  expireLegacyMerchantAuthCookies(response, request);
}
