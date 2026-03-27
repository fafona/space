import type { NextResponse } from "next/server";

export const MERCHANT_AUTH_COOKIE = "merchant-space-merchant-auth";

function isSecureCookieEnabled() {
  return process.env.NODE_ENV === "production";
}

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
  const normalizedToken = String(accessToken ?? "").trim();
  if (!normalizedToken) {
    clearMerchantAuthCookie(response);
    return;
  }

  response.cookies.set(MERCHANT_AUTH_COOKIE, normalizedToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieEnabled(),
    path: "/",
    maxAge: normalizeMaxAge(maxAgeSeconds),
  });
}

export function clearMerchantAuthCookie(response: NextResponse) {
  response.cookies.set(MERCHANT_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieEnabled(),
    path: "/",
    maxAge: 0,
  });
}
