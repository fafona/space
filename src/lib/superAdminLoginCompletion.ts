import { NextResponse } from "next/server";
import {
  createSuperAdminSessionToken,
  createSuperAdminTrustedDeviceToken,
  type SuperAdminChallengePayload,
} from "@/lib/superAdminVerification";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  canRegisterAnotherSuperAdminDevice,
  loadSuperAdminTrustedDevicesFromStore,
  saveSuperAdminTrustedDevicesToStore,
  upsertSuperAdminTrustedDevice,
} from "@/lib/superAdminTrustedDevices";
import {
  SUPER_ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS,
  SUPER_ADMIN_DEVICE_ID_COOKIE,
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
  resolveSuperAdminCookieDomain,
  resolveSuperAdminCookieSecureFlag,
} from "@/lib/superAdminSession";

export async function finalizeSuperAdminLogin(
  challengePayload: SuperAdminChallengePayload,
  options?: { loginIp?: string | null; request?: Request },
) {
  const sessionToken = createSuperAdminSessionToken({
    deviceId: challengePayload.deviceId,
    deviceLabel: challengePayload.deviceLabel,
  });
  const trustedDeviceToken = createSuperAdminTrustedDeviceToken({
    deviceId: challengePayload.deviceId,
    deviceLabel: challengePayload.deviceLabel,
  });
  const serviceSupabase = createServerSupabaseServiceClient();
  if (serviceSupabase) {
    try {
      const { rowId, maxDevices, devices } = await loadSuperAdminTrustedDevicesFromStore(serviceSupabase);
      if (!canRegisterAnotherSuperAdminDevice(devices, maxDevices, challengePayload.deviceId)) {
        return NextResponse.json(
          {
            error: "device_limit_reached",
            message: `白名单设备已达到上限（${maxDevices} 台），请先移除旧设备后再登录。`,
            maxDevices,
            currentCount: devices.length,
          },
          { status: 403 },
        );
      }
      await saveSuperAdminTrustedDevicesToStore(
        serviceSupabase,
        rowId,
        maxDevices,
        upsertSuperAdminTrustedDevice(devices, {
          deviceId: challengePayload.deviceId,
          deviceLabel: challengePayload.deviceLabel,
          loginIp: options?.loginIp,
          loginStatus: "success",
        }),
      );
    } catch {
      // Keep login available even if the whitelist store is temporarily unavailable.
    }
  }

  const response = NextResponse.json({
    ok: true,
    nextPath: challengePayload.nextPath,
    deviceLabel: challengePayload.deviceLabel,
  });
  const cookieDomain = resolveSuperAdminCookieDomain(options?.request);
  const secure = resolveSuperAdminCookieSecureFlag(options?.request);
  response.cookies.set(SUPER_ADMIN_SESSION_COOKIE, sessionToken, {
    path: "/",
    maxAge: SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure,
    httpOnly: true,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  response.cookies.set(SUPER_ADMIN_DEVICE_ID_COOKIE, challengePayload.deviceId, {
    path: "/",
    maxAge: SUPER_ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  response.cookies.set(SUPER_ADMIN_TRUSTED_DEVICE_COOKIE, trustedDeviceToken, {
    path: "/",
    maxAge: SUPER_ADMIN_TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure,
    httpOnly: true,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  return response;
}
