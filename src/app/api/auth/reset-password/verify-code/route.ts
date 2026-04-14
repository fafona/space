import { NextResponse } from "next/server";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseAuthClient } from "@/lib/superAdminServer";
import { setResetRecoveryCookies } from "@/lib/resetPasswordRecoverySession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RequestBody = {
  email?: unknown;
  code?: unknown;
};

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeCode(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "") : "";
}

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
    const email = normalizeEmail(body?.email);
    const code = normalizeCode(body?.code);
    if (!email || !email.includes("@")) {
      return noStoreJson({ ok: false, error: "reset_password_invalid_email" }, { status: 400 });
    }
    if (!code || code.length < 4) {
      return noStoreJson({ ok: false, error: "reset_password_invalid_code" }, { status: 400 });
    }

    const supabase = createServerSupabaseAuthClient();
    if (!supabase) {
      return noStoreJson({ ok: false, error: "reset_password_env_missing" }, { status: 503 });
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    const accessToken = String(data.session?.access_token ?? "").trim();
    const refreshToken = String(data.session?.refresh_token ?? "").trim();
    if (error || !accessToken) {
      return noStoreJson(
        {
          ok: false,
          error: error?.message || "reset_password_invalid_or_expired_code",
        },
        { status: 401 },
      );
    }

    const response = noStoreJson({
      ok: true,
      ready: true,
    });
    setResetRecoveryCookies(response, {
      accessToken,
      refreshToken,
      maxAgeSeconds: data.session?.expires_in,
    }, request);
    return response;
  } catch {
    return noStoreJson({ ok: false, error: "reset_password_verify_unavailable" }, { status: 503 });
  }
}
