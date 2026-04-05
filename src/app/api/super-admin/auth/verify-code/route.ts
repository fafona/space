import { NextResponse } from "next/server";
import { createServerSupabaseAuthClient, readRequestClientIp, readSuperAdminVerificationEmail } from "@/lib/superAdminServer";
import { finalizeSuperAdminLogin } from "@/lib/superAdminLoginCompletion";
import { readSuperAdminChallengeToken } from "@/lib/superAdminVerification";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type VerifyCodeBody = {
  challenge?: unknown;
  deviceId?: unknown;
  code?: unknown;
};

function normalizeCode(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "") : "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as VerifyCodeBody | null;
    const challenge = typeof body?.challenge === "string" ? body.challenge.trim() : "";
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
    const code = normalizeCode(body?.code);

    const challengePayload = readSuperAdminChallengeToken(challenge);
    if (!challengePayload) {
      return NextResponse.json({ error: "invalid_or_expired_challenge" }, { status: 400 });
    }
    if (!deviceId || deviceId !== challengePayload.deviceId) {
      return NextResponse.json({ error: "device_mismatch" }, { status: 401 });
    }
    if (!code || code.length < 4) {
      return NextResponse.json({ error: "invalid_email_code" }, { status: 400 });
    }

    const supabase = createServerSupabaseAuthClient();
    if (!supabase) {
      return NextResponse.json({ error: "verification_env_missing" }, { status: 503 });
    }

    const { error } = await supabase.auth.verifyOtp({
      email: readSuperAdminVerificationEmail(),
      token: code,
      type: "email",
    });
    if (error) {
      return NextResponse.json(
        {
          error: "invalid_or_expired_email_code",
          message: error.message || "invalid_or_expired_email_code",
        },
        { status: 401 },
      );
    }

    return finalizeSuperAdminLogin(challengePayload, {
      loginIp: readRequestClientIp(request),
      request,
    });
  } catch {
    return NextResponse.json({ error: "super_admin_verification_failed" }, { status: 503 });
  }
}
