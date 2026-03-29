import type { NextResponse } from "next/server";

export const MERCHANT_AUTH_COOKIE = "merchant-space-merchant-auth";
export const MERCHANT_AUTH_REFRESH_COOKIE = "merchant-space-merchant-refresh";

function normalizeMaxAge(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 60 * 60;
  return Math.max(60, Math.min(30 * 24 * 60 * 60, Math.round(parsed)));
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

export function readMerchantRequestAccessTokens(request: Request) {
  const tokens: string[] = [];
  [readBearerAccessToken(request), readMerchantAuthCookie(request)].forEach((token) => {
    if (!token || tokens.includes(token)) return;
    tokens.push(token);
  });
  return tokens;
}

export function setMerchantAuthCookie(response: NextResponse, accessToken: string, maxAgeSeconds?: unknown) {
  setMerchantAuthCookies(response, { accessToken, maxAgeSeconds });
}

export function setMerchantAuthCookies(
  response: NextResponse,
  input: { accessToken: string; refreshToken?: string | null; maxAgeSeconds?: unknown },
) {
  const normalizedAccessToken = String(input.accessToken ?? "").trim();
  const normalizedRefreshToken = String(input.refreshToken ?? "").trim();
  const normalizedMaxAge = normalizeMaxAge(input.maxAgeSeconds);
  if (!normalizedAccessToken) {
    clearMerchantAuthCookies(response);
    return;
  }

  response.cookies.set(MERCHANT_AUTH_COOKIE, normalizedAccessToken, {
    httpOnly: true,
    sameSite: "lax",
    // The merchant backend is still accessed over both http:// and https:// in production.
    // Keeping this cookie non-secure avoids dropping the session on the http admin entry.
    secure: false,
    path: "/",
    maxAge: normalizedMaxAge,
  });

  if (normalizedRefreshToken) {
    response.cookies.set(MERCHANT_AUTH_REFRESH_COOKIE, normalizedRefreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: normalizedMaxAge,
    });
  } else {
    response.cookies.set(MERCHANT_AUTH_REFRESH_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 0,
    });
  }
}

export function clearMerchantAuthCookie(response: NextResponse) {
  clearMerchantAuthCookies(response);
}

export function clearMerchantAuthCookies(response: NextResponse) {
  response.cookies.set(MERCHANT_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(MERCHANT_AUTH_REFRESH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 0,
  });
}
