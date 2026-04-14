import type { NextResponse } from "next/server";
import { resolveSecureCookieFlag } from "@/lib/requestOrigin";

export const SUPER_ADMIN_LOGIN_PATH = "/super-admin/login";
export const SUPER_ADMIN_SESSION_KEY = "merchant-space:super-admin-session:v1";
export const SUPER_ADMIN_SESSION_COOKIE = "merchant-space-super-admin";
export const SUPER_ADMIN_SESSION_VALUE = "ok";
export const SUPER_ADMIN_DEVICE_ID_KEY = "merchant-space:super-admin-device-id:v1";
export const SUPER_ADMIN_DEVICE_ID_COOKIE = "merchant-space-super-admin-device-id";
export const SUPER_ADMIN_TRUSTED_DEVICE_COOKIE = "merchant-space-super-admin-device";
export const SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;
export const SUPER_ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
export const SUPER_ADMIN_TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

function normalizeCookieBaseDomain(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const hostname = new URL(candidate).hostname.trim().toLowerCase();
    const cleaned = hostname.replace(/^\.+/, "");
    const labels = cleaned.split(".").filter(Boolean);
    if (labels.length >= 3 && labels[0] === "www") {
      return labels.slice(-2).join(".");
    }
    return cleaned;
  } catch {
    const cleaned = trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^\.+/, "");
    const labels = cleaned.split(".").filter(Boolean);
    if (labels.length >= 3 && labels[0] === "www") {
      return labels.slice(-2).join(".");
    }
    return cleaned;
  }
}

export function resolveSuperAdminCookieDomainFromHostname(hostname: string | null | undefined) {
  const requestHost = String(hostname ?? "").trim().toLowerCase();
  if (!requestHost || requestHost === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(requestHost)) {
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

export function resolveSuperAdminCookieDomain(request?: Request) {
  if (!request) return undefined;
  const hostHeader = (request.headers.get("host") ?? "").trim().toLowerCase();
  if (hostHeader) {
    return resolveSuperAdminCookieDomainFromHostname(hostHeader);
  }
  try {
    return resolveSuperAdminCookieDomainFromHostname(new URL(request.url).hostname);
  } catch {
    return undefined;
  }
}

export function resolveSuperAdminCookieSecureFlag(request?: Request) {
  return resolveSecureCookieFlag(request);
}

export function clearSuperAdminSessionCookies(response: NextResponse, request?: Request) {
  const cookieDomain = resolveSuperAdminCookieDomain(request);
  const secure = resolveSuperAdminCookieSecureFlag(request);
  response.cookies.set(SUPER_ADMIN_SESSION_COOKIE, "", {
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure,
    httpOnly: true,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}
