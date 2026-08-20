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
  pickLeastRecentlyVerifiedSuperAdminTrustedDevice,
  removeSuperAdminTrustedDevice,
  saveSuperAdminTrustedDevicesToStore,
  upsertSuperAdminTrustedDevice,
} from "@/lib/superAdminTrustedDevices";
import {
  SUPER_ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS,
  SUPER_ADMIN_DEVICE_ID_COOKIE,
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS,
  expireLegacySuperAdminCookies,
} from "@/lib/superAdminSession";
import { isCanonicalSuperAdminRequest } from "@/lib/canonicalSuperAdminRequest";

export async function finalizeSuperAdminLogin(
  challengePayload: SuperAdminChallengePayload,
  options?: { loginIp?: string | null; request?: Request },
) {
  if (!options?.request || !isCanonicalSuperAdminRequest(options.request)) {
    return NextResponse.json({ error: "super_admin_console_origin_required" }, { status: 421 });
  }
  const sessionToken = createSuperAdminSessionToken({
    deviceId: challengePayload.deviceId,
    deviceLabel: challengePayload.deviceLabel,
  });
  const trustedDeviceToken = createSuperAdminTrustedDeviceToken({
    deviceId: challengePayload.deviceId,
    deviceLabel: challengePayload.deviceLabel,
  });

  let replacedDeviceLabel = "";
  const serviceSupabase = createServerSupabaseServiceClient();
  if (!serviceSupabase) {
    return NextResponse.json({ error: "super_admin_trusted_devices_unavailable" }, { status: 503 });
  }
  try {
      const { rowId, maxDevices, devices } = await loadSuperAdminTrustedDevicesFromStore(serviceSupabase);
      let nextDevices = devices;

      if (!canRegisterAnotherSuperAdminDevice(devices, maxDevices, challengePayload.deviceId)) {
        const rotatedOutDevice = pickLeastRecentlyVerifiedSuperAdminTrustedDevice(devices);
        if (!rotatedOutDevice) {
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
        replacedDeviceLabel = rotatedOutDevice.deviceLabel;
        nextDevices = removeSuperAdminTrustedDevice(devices, rotatedOutDevice.deviceId);
      }

      await saveSuperAdminTrustedDevicesToStore(
        serviceSupabase,
        rowId,
        maxDevices,
        upsertSuperAdminTrustedDevice(nextDevices, {
          deviceId: challengePayload.deviceId,
          deviceLabel: challengePayload.deviceLabel,
          loginIp: options?.loginIp,
          loginStatus: "success",
          details: challengePayload.deviceDetails ?? null,
        }),
      );
  } catch {
    return NextResponse.json({ error: "super_admin_trusted_devices_unavailable" }, { status: 503 });
  }

  const response = NextResponse.json({
    ok: true,
    nextPath: challengePayload.nextPath,
    deviceLabel: challengePayload.deviceLabel,
    replacedDeviceLabel: replacedDeviceLabel || undefined,
  });
  response.cookies.set(SUPER_ADMIN_SESSION_COOKIE, sessionToken, {
    path: "/",
    maxAge: SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: true,
    httpOnly: true,
  });
  response.cookies.set(SUPER_ADMIN_DEVICE_ID_COOKIE, challengePayload.deviceId, {
    path: "/",
    maxAge: SUPER_ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: true,
  });
  response.cookies.set(SUPER_ADMIN_TRUSTED_DEVICE_COOKIE, trustedDeviceToken, {
    path: "/",
    maxAge: SUPER_ADMIN_TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: true,
    httpOnly: true,
  });
  expireLegacySuperAdminCookies(response);
  return response;
}
