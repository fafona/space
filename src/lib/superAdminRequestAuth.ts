import { isCanonicalSuperAdminRequest } from "@/lib/canonicalSuperAdminRequest";
import { parseCookieValues } from "@/lib/merchantAuthSession";
import {
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
} from "@/lib/superAdminSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { loadSuperAdminTrustedDevicesFromStore } from "@/lib/superAdminTrustedDevices";
import {
  readSuperAdminSessionToken,
  readSuperAdminTrustedDeviceToken,
} from "@/lib/superAdminVerification";

type SuperAdminAuthorizationDependencies = {
  loadActiveDeviceIds?: () => Promise<string[]>;
};

async function loadActiveDeviceIdsFromStore() {
  const serviceSupabase = createServerSupabaseServiceClient();
  if (!serviceSupabase) throw new Error("super_admin_trusted_devices_unavailable");
  const { devices } = await loadSuperAdminTrustedDevicesFromStore(serviceSupabase);
  return devices.map((device) => device.deviceId);
}

export async function readSuperAdminAuthorizedSession(
  request: Request,
  dependencies: SuperAdminAuthorizationDependencies = {},
) {
  if (!isCanonicalSuperAdminRequest(request)) return null;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessions = parseCookieValues(cookieHeader, SUPER_ADMIN_SESSION_COOKIE)
    .map((token) => readSuperAdminSessionToken(String(token ?? "").trim()))
    .filter((item): item is NonNullable<ReturnType<typeof readSuperAdminSessionToken>> => !!item);
  const trustedDevices = parseCookieValues(cookieHeader, SUPER_ADMIN_TRUSTED_DEVICE_COOKIE)
    .map((token) => readSuperAdminTrustedDeviceToken(String(token ?? "").trim()))
    .filter((item): item is NonNullable<ReturnType<typeof readSuperAdminTrustedDeviceToken>> => !!item);
  if (sessions.length === 0 || trustedDevices.length === 0) return null;

  try {
    const deviceIds = await (dependencies.loadActiveDeviceIds ?? loadActiveDeviceIdsFromStore)();
    for (const session of sessions) {
      if (
        trustedDevices.some((trustedDevice) => trustedDevice.deviceId === session.deviceId) &&
        deviceIds.includes(session.deviceId)
      ) {
        return session;
      }
    }
  } catch {
    // Super-admin authorization must fail closed when revocation state is unavailable.
  }
  return null;
}

export async function isSuperAdminRequestAuthorized(
  request: Request,
  dependencies: SuperAdminAuthorizationDependencies = {},
) {
  return !!(await readSuperAdminAuthorizedSession(request, dependencies));
}
