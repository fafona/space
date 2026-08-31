import { NextResponse } from "next/server";
import {
  isAuthRateLimitError,
  isValidAuthEmail,
  isValidAuthVerificationCode,
  normalizeAuthEmail,
  normalizeAuthVerificationCode,
} from "@/lib/authCredentialValidation";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import {
  activatePasswordRecoveryGrant,
  createPasswordRecoveryProofToken,
} from "@/lib/passwordRecoveryGrant.server";
import {
  setResetRecoveryCookies,
  setResetRecoveryProofCookie,
} from "@/lib/resetPasswordRecoverySession";
import {
  createServerSupabaseAuthClient,
  createServerSupabaseServiceClient,
} from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RequestBody = {
  email?: unknown;
  code?: unknown;
};

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const body = (await request.json().catch(() => null)) as RequestBody | null;
    const email = normalizeAuthEmail(body?.email);
    const code = normalizeAuthVerificationCode(body?.code);
    if (!isValidAuthEmail(email)) {
      return noStoreJson({ ok: false, error: "reset_password_invalid_email" }, { status: 400 });
    }
    if (!isValidAuthVerificationCode(code)) {
      return noStoreJson({ ok: false, error: "reset_password_invalid_code" }, { status: 400 });
    }

    const supabase = createServerSupabaseAuthClient();
    const service = createServerSupabaseServiceClient();
    if (!supabase || !service) {
      return noStoreJson({ ok: false, error: "reset_password_env_missing" }, { status: 503 });
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "recovery",
    });

    const accessToken = String(data.session?.access_token ?? "").trim();
    const refreshToken = String(data.session?.refresh_token ?? "").trim();
    if (error || !accessToken) {
      if (isAuthRateLimitError(error)) {
        return noStoreJson({ ok: false, error: "auth_rate_limited" }, { status: 429 });
      }
      return noStoreJson(
        {
          ok: false,
          error: "reset_password_invalid_or_expired_code",
        },
        { status: 401 },
      );
    }

    const claimsResult = await supabase.auth.getClaims(accessToken);
    const claims = claimsResult.data?.claims;
    const user = data.user ?? data.session?.user;
    const authUserId = String(user?.id ?? "").trim().toLowerCase();
    const sessionId = String(claims?.session_id ?? "").trim();
    if (
      claimsResult.error ||
      !authUserId ||
      String(claims?.sub ?? "").trim().toLowerCase() !== authUserId ||
      !sessionId ||
      normalizeAuthEmail(user?.email) !== email
    ) {
      return noStoreJson(
        { ok: false, error: "reset_password_invalid_or_expired_code" },
        { status: 401 },
      );
    }

    const proofToken = createPasswordRecoveryProofToken();
    await activatePasswordRecoveryGrant(service, {
      proofToken,
      email,
      authUserId,
      sessionId,
      proofKind: "typed_recovery",
    });

    const response = noStoreJson({
      ok: true,
      ready: true,
    });
    setResetRecoveryCookies(response, {
      accessToken,
      refreshToken,
      maxAgeSeconds: data.session?.expires_in,
    }, request);
    setResetRecoveryProofCookie(response, proofToken);
    return response;
  } catch {
    return noStoreJson({ ok: false, error: "reset_password_verify_unavailable" }, { status: 503 });
  }
}
