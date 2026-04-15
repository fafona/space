import { NextResponse } from "next/server";
import {
  createSuperAdminChallengeToken,
  normalizeSuperAdminNextPath,
  readSuperAdminTrustedDeviceToken,
} from "@/lib/superAdminVerification";
import {
  createServerSupabaseAuthClient,
  createServerSupabaseServiceClient,
  isSuperAdminAuthConfigured,
  listMissingSuperAdminAuthEnv,
  listMissingSuperAdminSupabaseAuthEnv,
  maskEmailAddress,
  readRequestClientIp,
  readSuperAdminVerificationEmail,
  resolvePublicOrigin,
  validateSuperAdminCredentials,
} from "@/lib/superAdminServer";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { SUPER_ADMIN_TRUSTED_DEVICE_COOKIE } from "@/lib/superAdminSession";
import {
  canRegisterAnotherSuperAdminDevice,
  loadSuperAdminTrustedDevicesFromStore,
  normalizeSuperAdminTrustedDeviceDetails,
  pickLeastRecentlyVerifiedSuperAdminTrustedDevice,
} from "@/lib/superAdminTrustedDevices";
import { finalizeSuperAdminLogin } from "@/lib/superAdminLoginCompletion";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RequestBody = {
  account?: unknown;
  password?: unknown;
  next?: unknown;
  deviceId?: unknown;
  deviceLabel?: unknown;
  deviceDetails?: unknown;
};

function parseCookieValue(cookieHeader: string, key: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? "";
}

function readRequestDeviceDetails(request: Request, rawDetails: unknown) {
  const normalized = normalizeSuperAdminTrustedDeviceDetails(rawDetails);
  const userAgent = request.headers.get("user-agent") ?? "";
  const acceptLanguage = request.headers.get("accept-language") ?? "";
  const requestLanguages = acceptLanguage
    .split(",")
    .map((item) => item.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 8);
  return normalizeSuperAdminTrustedDeviceDetails({
    ...normalized,
    userAgent: normalized?.userAgent || userAgent,
    language: normalized?.language || requestLanguages[0] || "",
    languages: normalized?.languages?.length ? normalized.languages : requestLanguages,
  });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const body = (await request.json().catch(() => null)) as RequestBody | null;
    const account = typeof body?.account === "string" ? body.account.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
    const deviceLabel = typeof body?.deviceLabel === "string" ? body.deviceLabel.trim() : "";
    const deviceDetails = readRequestDeviceDetails(request, body?.deviceDetails);
    const nextPath = normalizeSuperAdminNextPath(typeof body?.next === "string" ? body.next : "");
    const requestHost = new URL(request.url).host;

    if (!isSuperAdminAuthConfigured()) {
      console.error("[super-admin-auth] verification_env_missing", {
        host: requestHost,
        missingEnv: listMissingSuperAdminAuthEnv(),
      });
      return NextResponse.json({ error: "verification_env_missing" }, { status: 503 });
    }
    if (!account || !password) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });
    }
    if (!deviceId || deviceId.length < 8) {
      return NextResponse.json({ error: "invalid_device" }, { status: 400 });
    }
    if (!validateSuperAdminCredentials(account, password)) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }

    const challengeToken = createSuperAdminChallengeToken({
      deviceId,
      deviceLabel,
      nextPath,
      deviceDetails,
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
    let replacedDeviceLabel = "";

    const serviceSupabase = createServerSupabaseServiceClient();
    if (serviceSupabase) {
      try {
        const { devices, maxDevices: storedMaxDevices } = await loadSuperAdminTrustedDevicesFromStore(serviceSupabase);
        currentDeviceTrusted = currentDeviceTrusted || devices.some((item) => item.deviceId === deviceId);
        maxDevices = storedMaxDevices;
        currentCount = devices.length;
        if (!canRegisterAnotherSuperAdminDevice(devices, storedMaxDevices, deviceId)) {
          replacedDeviceLabel = pickLeastRecentlyVerifiedSuperAdminTrustedDevice(devices)?.deviceLabel ?? "";
        }
      } catch {
        // Keep the cookie-based fallback if the device whitelist store is temporarily unavailable.
      }
    }

    if (currentDeviceTrusted) {
      const challengePayload = readSuperAdminTrustedDeviceToken(trustedDeviceToken);
      return finalizeSuperAdminLogin(
        {
          kind: "challenge",
          issuedAt: Date.now(),
          expiresAt: Date.now() + 10 * 60 * 1000,
          deviceId,
          deviceLabel: deviceLabel || challengePayload?.deviceLabel || "Windows / Chrome",
          nextPath,
          deviceDetails,
        },
        {
          loginIp: readRequestClientIp(request),
          request,
        },
      );
    }

    const supabase = createServerSupabaseAuthClient();
    if (!supabase) {
      console.error("[super-admin-auth] verification_env_missing", {
        host: requestHost,
        missingEnv: listMissingSuperAdminSupabaseAuthEnv(),
      });
      return NextResponse.json({ error: "verification_env_missing" }, { status: 503 });
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
      replacedDeviceLabel: replacedDeviceLabel || undefined,
      requestIp: readRequestClientIp(request),
    });
  } catch {
    return NextResponse.json({ error: "verification_send_failed" }, { status: 503 });
  }
}
