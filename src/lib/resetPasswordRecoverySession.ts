import type { NextResponse } from "next/server";
import { resolveSecureCookieFlag } from "@/lib/requestOrigin";

export const RESET_PASSWORD_RECOVERY_COOKIE = "merchant-space-reset-recovery";
export const RESET_PASSWORD_RECOVERY_REFRESH_COOKIE = "merchant-space-reset-recovery-refresh";

function normalizeMaxAge(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 15 * 60;
  return Math.max(60, Math.min(60 * 60, Math.round(parsed)));
}

function parseCookieValue(cookieHeader: string, key: string) {
  return (
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${key}=`))
      ?.slice(key.length + 1) ?? ""
  );
}

export function readResetRecoveryCookie(request: Request) {
  return parseCookieValue(request.headers.get("cookie") ?? "", RESET_PASSWORD_RECOVERY_COOKIE).trim();
}

export function readResetRecoveryRefreshCookie(request: Request) {
  return parseCookieValue(request.headers.get("cookie") ?? "", RESET_PASSWORD_RECOVERY_REFRESH_COOKIE).trim();
}

export function setResetRecoveryCookies(
  response: NextResponse,
  input: { accessToken: string; refreshToken?: string | null; maxAgeSeconds?: unknown },
  request?: Request,
) {
  const accessToken = String(input.accessToken ?? "").trim();
  const refreshToken = String(input.refreshToken ?? "").trim();
  const maxAge = normalizeMaxAge(input.maxAgeSeconds);
  const secure = resolveSecureCookieFlag(request);

  if (!accessToken) {
    clearResetRecoveryCookies(response, request);
    return;
  }

  response.cookies.set(RESET_PASSWORD_RECOVERY_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });

  if (refreshToken) {
    response.cookies.set(RESET_PASSWORD_RECOVERY_REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge,
    });
  } else {
    response.cookies.set(RESET_PASSWORD_RECOVERY_REFRESH_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 0,
    });
  }
}

export function clearResetRecoveryCookies(response: NextResponse, request?: Request) {
  const secure = resolveSecureCookieFlag(request);
  response.cookies.set(RESET_PASSWORD_RECOVERY_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(RESET_PASSWORD_RECOVERY_REFRESH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
}
