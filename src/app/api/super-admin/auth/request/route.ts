import { NextResponse } from "next/server";
import { readSuperAdminTrustedDeviceToken, createSuperAdminChallengeToken, normalizeSuperAdminNextPath } from "@/lib/superAdminVerification";
import {
  createServerSupabaseAuthClient,
  createServerSupabaseServiceClient,
  maskEmailAddress,
  readRequestClientIp,
  readSuperAdminVerificationEmail,
  resolvePublicOrigin,
  validateSuperAdminCredentials,
} from "@/lib/superAdminServer";
import { SUPER_ADMIN_TRUSTED_DEVICE_COOKIE } from "@/lib/superAdminSession";
import { canRegisterAnotherSuperAdminDevice, loadSuperAdminTrustedDevicesFromStore } from "@/lib/superAdminTrustedDevices";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RequestBody = {
  account?: unknown;
  password?: unknown;
  next?: unknown;
  deviceId?: unknown;
  deviceLabel?: unknown;
};

function parseCookieValue(cookieHeader: string, key: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as RequestBody | null;
    const account = typeof body?.account === "string" ? body.account.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
    const deviceLabel = typeof body?.deviceLabel === "string" ? body.deviceLabel.trim() : "";
    const nextPath = normalizeSuperAdminNextPath(typeof body?.next === "string" ? body.next : "");

    if (!account || !password) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });
    }
    if (!deviceId || deviceId.length < 8) {
      return NextResponse.json({ error: "invalid_device" }, { status: 400 });
    }
    if (!validateSuperAdminCredentials(account, password)) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }

    const supabase = createServerSupabaseAuthClient();
    if (!supabase) {
      return NextResponse.json({ error: "verification_env_missing" }, { status: 503 });
    }

    const challengeToken = createSuperAdminChallengeToken({
      deviceId,
      deviceLabel,
      nextPath,
    });
    if (!challengeToken) {
      return NextResponse.json({ error: "invalid_device" }, { status: 400 });
    }

    const requestUrl = new URL(request.url);
    const publicOrigin = resolvePublicOrigin(request, requestUrl);
    const redirectUrl = new URL("/super-admin/login", publicOrigin);
    redirectUrl.searchParams.set("next", nextPath);
    redirectUrl.searchParams.set("superAdminChallenge", challengeToken);

    const verificationEmail = readSuperAdminVerificationEmail();
    const trustedDeviceToken = parseCookieValue(request.headers.get("cookie") ?? "", SUPER_ADMIN_TRUSTED_DEVICE_COOKIE);
    const trustedDevice = readSuperAdminTrustedDeviceToken(trustedDeviceToken);
    let currentDeviceTrusted = trustedDevice?.deviceId === deviceId;
    let maxDevices: number | null = null;
    let currentCount = 0;
    const serviceSupabase = createServerSupabaseServiceClient();
    if (serviceSupabase) {
      try {
        const { devices, maxDevices: storedMaxDevices } = await loadSuperAdminTrustedDevicesFromStore(serviceSupabase);
        currentDeviceTrusted = devices.some((item) => item.deviceId === deviceId);
        maxDevices = storedMaxDevices;
        currentCount = devices.length;
        if (!canRegisterAnotherSuperAdminDevice(devices, storedMaxDevices, deviceId)) {
          return NextResponse.json(
            {
              error: "device_limit_reached",
              message: `白名单设备已达到上限（${storedMaxDevices} 台），请先移除旧设备后再登录。`,
              maxDevices: storedMaxDevices,
              currentCount: devices.length,
              trustedDevice: currentDeviceTrusted,
              requestIp: readRequestClientIp(request),
            },
            { status: 403 },
          );
        }
      } catch {
        // Keep the cookie-based fallback if the device whitelist store is temporarily unavailable.
      }
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: verificationEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectUrl.toString(),
      },
    });

    if (error) {
      return NextResponse.json(
        {
          error: "verification_send_failed",
          message: error.message || "verification_send_failed",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      nextPath,
      maskedEmail: maskEmailAddress(verificationEmail),
      trustedDevice: currentDeviceTrusted,
      challenge: challengeToken,
      maxDevices,
      currentCount,
      requestIp: readRequestClientIp(request),
    });
  } catch {
    return NextResponse.json({ error: "verification_send_failed" }, { status: 503 });
  }
}
