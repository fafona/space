import { NextResponse } from "next/server";
import { createSuperAdminTrustedDeviceToken, type SuperAdminChallengePayload } from "@/lib/superAdminVerification";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  loadSuperAdminTrustedDevicesFromStore,
  saveSuperAdminTrustedDevicesToStore,
  upsertSuperAdminTrustedDevice,
} from "@/lib/superAdminTrustedDevices";
import {
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_SESSION_VALUE,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
} from "@/lib/superAdminSession";

export async function finalizeSuperAdminLogin(challengePayload: SuperAdminChallengePayload) {
  const trustedDeviceToken = createSuperAdminTrustedDeviceToken({
    deviceId: challengePayload.deviceId,
    deviceLabel: challengePayload.deviceLabel,
  });
  const serviceSupabase = createServerSupabaseServiceClient();
  if (serviceSupabase) {
    try {
      const { rowId, devices } = await loadSuperAdminTrustedDevicesFromStore(serviceSupabase);
      await saveSuperAdminTrustedDevicesToStore(
        serviceSupabase,
        rowId,
        upsertSuperAdminTrustedDevice(devices, {
          deviceId: challengePayload.deviceId,
          deviceLabel: challengePayload.deviceLabel,
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
  response.cookies.set(SUPER_ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_VALUE, {
    path: "/",
    maxAge: 60 * 60 * 12,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  response.cookies.set(SUPER_ADMIN_TRUSTED_DEVICE_COOKIE, trustedDeviceToken, {
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });
  return response;
}
