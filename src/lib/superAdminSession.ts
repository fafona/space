import type { NextResponse } from "next/server";
import { resolveCanonicalPortalHostname } from "@/lib/canonicalPortalRequest";
import { appendLegacyCookieExpiration } from "@/lib/legacyCookieCleanup";

export const SUPER_ADMIN_LOGIN_PATH = "/super-admin/login";
export const SUPER_ADMIN_SESSION_KEY = "merchant-space:super-admin-session:v1";
export const SUPER_ADMIN_SESSION_COOKIE = "__Host-faolla-super-admin-v2";
export const SUPER_ADMIN_SESSION_VALUE = "ok";
export const SUPER_ADMIN_DEVICE_ID_KEY = "merchant-space:super-admin-device-id:v1";
export const SUPER_ADMIN_DEVICE_ID_COOKIE = "__Host-faolla-super-admin-device-id-v2";
export const SUPER_ADMIN_TRUSTED_DEVICE_COOKIE = "__Host-faolla-super-admin-device-v2";
export const SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 15;
export const SUPER_ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const SUPER_ADMIN_TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export const LEGACY_SUPER_ADMIN_SESSION_COOKIE = "merchant-space-super-admin";
export const LEGACY_SUPER_ADMIN_DEVICE_ID_COOKIE = "merchant-space-super-admin-device-id";
export const LEGACY_SUPER_ADMIN_TRUSTED_DEVICE_COOKIE = "merchant-space-super-admin-device";

function legacyCookieDomain() {
  const portalHostname = resolveCanonicalPortalHostname();
  return portalHostname.startsWith("www.") ? portalHostname.slice(4) : portalHostname;
}

function expireCookie(
  response: NextResponse,
  name: string,
  options?: { httpOnly?: boolean; domain?: string },
) {
  appendLegacyCookieExpiration(response, name, options);
}

export function expireLegacySuperAdminCookies(response: NextResponse) {
  const domain = legacyCookieDomain();
  const legacy = [
    [LEGACY_SUPER_ADMIN_SESSION_COOKIE, true],
    [LEGACY_SUPER_ADMIN_DEVICE_ID_COOKIE, false],
    [LEGACY_SUPER_ADMIN_TRUSTED_DEVICE_COOKIE, true],
  ] as const;
  for (const [name, httpOnly] of legacy) {
    expireCookie(response, name, { httpOnly });
    if (domain) expireCookie(response, name, { httpOnly, domain });
  }
}

export function clearSuperAdminSessionCookies(response: NextResponse, request?: Request) {
  void request;
  expireLegacySuperAdminCookies(response);
  expireCookie(response, SUPER_ADMIN_SESSION_COOKIE, { httpOnly: true });
  expireCookie(response, SUPER_ADMIN_DEVICE_ID_COOKIE);
  expireCookie(response, SUPER_ADMIN_TRUSTED_DEVICE_COOKIE, { httpOnly: true });
}
