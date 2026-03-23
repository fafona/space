import { NextResponse } from "next/server";
import {
  createSuperAdminTrustedDeviceToken,
  readSuperAdminChallengeToken,
  verifySuperAdminEmailProofToken,
} from "@/lib/superAdminVerification";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_SESSION_VALUE,
  SUPER_ADMIN_TRUSTED_DEVICE_COOKIE,
} from "@/lib/superAdminSession";
import {
  loadSuperAdminTrustedDevicesFromStore,
  saveSuperAdminTrustedDevicesToStore,
  upsertSuperAdminTrustedDevice,
} from "@/lib/superAdminTrustedDevices";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CompleteBody = {
  challenge?: unknown;
  proof?: unknown;
  deviceId?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CompleteBody | null;
    const challenge = typeof body?.challenge === "string" ? body.challenge.trim() : "";
    const proof = typeof body?.proof === "string" ? body.proof.trim() : "";
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";

    const challengePayload = readSuperAdminChallengeToken(challenge);
    if (!challengePayload) {
      return NextResponse.json({ error: "invalid_or_expired_challenge" }, { status: 400 });
    }
    if (!deviceId || deviceId !== challengePayload.deviceId) {
      return NextResponse.json({ error: "device_mismatch" }, { status: 401 });
    }
    if (!verifySuperAdminEmailProofToken(proof, challenge)) {
      return NextResponse.json({ error: "invalid_email_proof" }, { status: 401 });
    }

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
  } catch {
    return NextResponse.json({ error: "super_admin_verification_failed" }, { status: 503 });
  }
}
