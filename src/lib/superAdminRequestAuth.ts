import { parseCookieValue } from "@/lib/merchantAuthSession";
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
  const sessionToken = parseCookieValue(cookieHeader, SUPER_ADMIN_SESSION_COOKIE).trim();
  const trustedDeviceToken = parseCookieValue(cookieHeader, SUPER_ADMIN_TRUSTED_DEVICE_COOKIE).trim();
  const session = readSuperAdminSessionToken(sessionToken);
  const trustedDevice = readSuperAdminTrustedDeviceToken(trustedDeviceToken);
  if (!session || !trustedDevice) return null;
  if (trustedDevice.deviceId !== session.deviceId) return null;
  return session;
}

export function isSuperAdminRequestAuthorized(request: Request) {
  return !!readSuperAdminAuthorizedSession(request);
}
