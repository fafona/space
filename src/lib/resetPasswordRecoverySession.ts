import type { NextResponse } from "next/server";
import { resolveCanonicalPortalHostname } from "@/lib/canonicalPortalRequest";
import { appendLegacyCookieExpiration } from "@/lib/legacyCookieCleanup";

export const RESET_PASSWORD_RECOVERY_COOKIE = "__Host-faolla-reset-recovery-v2";
export const RESET_PASSWORD_RECOVERY_REFRESH_COOKIE = "__Host-faolla-reset-recovery-refresh-v2";
export const LEGACY_RESET_PASSWORD_RECOVERY_COOKIE = "merchant-space-reset-recovery";
export const LEGACY_RESET_PASSWORD_RECOVERY_REFRESH_COOKIE = "merchant-space-reset-recovery-refresh";

function expireLegacyResetRecoveryCookies(response: NextResponse) {
  const canonicalHostname = resolveCanonicalPortalHostname();
  const rootHostname = canonicalHostname.replace(/^www\./, "");
  for (const name of [
    LEGACY_RESET_PASSWORD_RECOVERY_COOKIE,
    LEGACY_RESET_PASSWORD_RECOVERY_REFRESH_COOKIE,
  ]) {
    appendLegacyCookieExpiration(response, name, { httpOnly: true });
    if (rootHostname) {
      appendLegacyCookieExpiration(response, name, {
        domain: rootHostname,
        httpOnly: true,
      });
    }
  }
}

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

  if (!accessToken) {
    clearResetRecoveryCookies(response, request);
    return;
  }

  response.cookies.set(RESET_PASSWORD_RECOVERY_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge,
  });

  if (refreshToken) {
    response.cookies.set(RESET_PASSWORD_RECOVERY_REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge,
    });
  } else {
    response.cookies.set(RESET_PASSWORD_RECOVERY_REFRESH_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
  }
  expireLegacyResetRecoveryCookies(response);
}

export function clearResetRecoveryCookies(response: NextResponse, request?: Request) {
  void request;
  response.cookies.set(RESET_PASSWORD_RECOVERY_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(RESET_PASSWORD_RECOVERY_REFRESH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  expireLegacyResetRecoveryCookies(response);
}
