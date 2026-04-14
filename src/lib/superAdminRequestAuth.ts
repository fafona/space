import { parseCookieValues } from "@/lib/merchantAuthSession";
import {
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
} from "@/lib/superAdminSession";
import {
  readSuperAdminSessionToken,
  readSuperAdminTrustedDeviceToken,
} from "@/lib/superAdminVerification";

export function readSuperAdminAuthorizedSession(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessions = parseCookieValues(cookieHeader, SUPER_ADMIN_SESSION_COOKIE)
    .map((token) => readSuperAdminSessionToken(String(token ?? "").trim()))
    .filter((item): item is NonNullable<ReturnType<typeof readSuperAdminSessionToken>> => !!item);
  const trustedDevices = parseCookieValues(cookieHeader, SUPER_ADMIN_TRUSTED_DEVICE_COOKIE)
    .map((token) => readSuperAdminTrustedDeviceToken(String(token ?? "").trim()))
    .filter((item): item is NonNullable<ReturnType<typeof readSuperAdminTrustedDeviceToken>> => !!item);
  if (sessions.length === 0 || trustedDevices.length === 0) return null;
  for (const session of sessions) {
    if (trustedDevices.some((trustedDevice) => trustedDevice.deviceId === session.deviceId)) {
      return session;
    }
  }
  return null;
}

export function isSuperAdminRequestAuthorized(request: Request) {
  return !!readSuperAdminAuthorizedSession(request);
}
