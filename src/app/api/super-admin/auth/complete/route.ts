import { NextResponse } from "next/server";
import {
  readSuperAdminChallengeToken,
  verifySuperAdminEmailProofToken,
} from "@/lib/superAdminVerification";
import { finalizeSuperAdminLogin } from "@/lib/superAdminLoginCompletion";
import { readRequestClientIp } from "@/lib/superAdminServer";

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

    return finalizeSuperAdminLogin(challengePayload, {
      loginIp: readRequestClientIp(request),
      request,
    });
  } catch {
    return NextResponse.json({ error: "super_admin_verification_failed" }, { status: 503 });
  }
}
