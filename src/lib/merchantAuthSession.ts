import type { NextResponse } from "next/server";

export const MERCHANT_AUTH_COOKIE = "merchant-space-merchant-auth";
export const MERCHANT_AUTH_REFRESH_COOKIE = "merchant-space-merchant-refresh";
export const MERCHANT_AUTH_ACCESS_COOKIE_FALLBACK_MAX_AGE_SECONDS = 60 * 60;
export const MERCHANT_AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

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

function normalizeCookieBaseDomain(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const hostname = new URL(candidate).hostname.trim().toLowerCase();
    return hostname.replace(/^\.+/, "");
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^\.+/, "");
  }
}

function isLocalLikeHostname(value: string) {
  const hostname = String(value ?? "").trim().toLowerCase();
  return !hostname || hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
}

function resolveMerchantCookieDomain(request?: Request) {
  if (!request) return undefined;
  const requestHost = (() => {
    try {
      return new URL(request.url).hostname.trim().toLowerCase();
    } catch {
      return "";
    }
  })();
  if (isLocalLikeHostname(requestHost)) {
    return undefined;
  }
  const configuredBaseDomain = normalizeCookieBaseDomain(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
  const fallbackBaseDomain = requestHost.split(".").length >= 2 ? requestHost.split(".").slice(-2).join(".") : "";
  const baseDomain = configuredBaseDomain || fallbackBaseDomain;
  if (!baseDomain) return undefined;
  if (requestHost !== baseDomain && !requestHost.endsWith(`.${baseDomain}`)) {
    return undefined;
  }
  return baseDomain;
}

function resolveMerchantCookieSecureFlag(request?: Request) {
  if (!request) return false;
  const requestHost = (() => {
    try {
      return new URL(request.url).hostname.trim().toLowerCase();
    } catch {
      return "";
    }
  })();
  // Public merchant auth cookies should not be sent over cleartext transport.
  return !isLocalLikeHostname(requestHost);
}

export function parseCookieValue(cookieHeader: string, key: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? "";
}

export function readMerchantAuthCookie(request: Request) {
  return parseCookieValue(request.headers.get("cookie") ?? "", MERCHANT_AUTH_COOKIE).trim();
}

export function readMerchantAuthRefreshCookie(request: Request) {
  return parseCookieValue(request.headers.get("cookie") ?? "", MERCHANT_AUTH_REFRESH_COOKIE).trim();
}

export function readBearerAccessToken(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return tokenMatch?.[1]?.trim() ?? "";
}

export function readMerchantAccessTokenHeader(request: Request) {
  return (request.headers.get("x-merchant-access-token") ?? "").trim();
}

export function readMerchantRequestAccessTokens(request: Request) {
  const tokens: string[] = [];
  [readBearerAccessToken(request), readMerchantAccessTokenHeader(request), readMerchantAuthCookie(request)].forEach((token) => {
    if (!token || tokens.includes(token)) return;
    tokens.push(token);
  });
  return tokens;
}

export function setMerchantAuthCookie(response: NextResponse, accessToken: string, maxAgeSeconds?: unknown, request?: Request) {
  setMerchantAuthCookies(response, { accessToken, maxAgeSeconds }, request);
}

export function setMerchantAuthCookies(
  response: NextResponse,
  input: { accessToken: string; refreshToken?: string | null; maxAgeSeconds?: unknown },
  request?: Request,
) {
  const normalizedAccessToken = String(input.accessToken ?? "").trim();
  const normalizedRefreshToken = String(input.refreshToken ?? "").trim();
  const accessCookieMaxAge = normalizeCookieMaxAge(
    input.maxAgeSeconds,
    MERCHANT_AUTH_ACCESS_COOKIE_FALLBACK_MAX_AGE_SECONDS,
  );
  const cookieDomain = resolveMerchantCookieDomain(request);
  const secure = resolveMerchantCookieSecureFlag(request);
  if (!normalizedAccessToken) {
    clearMerchantAuthCookies(response, request);
    return;
  }

  response.cookies.set(MERCHANT_AUTH_COOKIE, normalizedAccessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: accessCookieMaxAge,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  if (normalizedRefreshToken) {
    response.cookies.set(MERCHANT_AUTH_REFRESH_COOKIE, normalizedRefreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: MERCHANT_AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });
  } else {
    response.cookies.set(MERCHANT_AUTH_REFRESH_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 0,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });
  }
}

export function clearMerchantAuthCookie(response: NextResponse, request?: Request) {
  clearMerchantAuthCookies(response, request);
}

export function clearMerchantAuthCookies(response: NextResponse, request?: Request) {
  const cookieDomain = resolveMerchantCookieDomain(request);
  const secure = resolveMerchantCookieSecureFlag(request);
  response.cookies.set(MERCHANT_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  response.cookies.set(MERCHANT_AUTH_REFRESH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}
