import { NextResponse } from "next/server";
import { isAuthRateLimitError, isValidAuthEmail, normalizeAuthEmail } from "@/lib/authCredentialValidation";
import {
  buildAuthResetRedirectUrl,
  normalizeAuthResetReturnPath,
} from "@/lib/authResetReturnPath";
import { preparePasswordRecoveryRequest } from "@/lib/passwordRecoveryRequest.server";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import {
  createServerSupabaseAuthClient,
  createServerSupabaseServiceClient,
  maskEmailAddress,
  resolvePublicOrigin,
} from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RequestBody = {
  email?: unknown;
  returnTo?: unknown;
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
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "email,returnTo"
    ) {
      return noStoreJson({ ok: false, error: "reset_password_invalid_request" }, { status: 400 });
    }
    const email = normalizeAuthEmail(body?.email);
    const returnTo = normalizeAuthResetReturnPath(body.returnTo, "");
    if (!isValidAuthEmail(email)) {
      return noStoreJson({ ok: false, error: "reset_password_invalid_email" }, { status: 400 });
    }
    if (!returnTo) {
      return noStoreJson({ ok: false, error: "reset_password_invalid_return_path" }, { status: 400 });
    }

    const supabase = createServerSupabaseAuthClient();
    const service = createServerSupabaseServiceClient();
    if (!supabase || !service) {
      return noStoreJson({ ok: false, error: "reset_password_env_missing" }, { status: 503 });
    }

    const requestUrl = new URL(request.url);
    const publicOrigin = resolvePublicOrigin(request, requestUrl);
    const prepared = await preparePasswordRecoveryRequest(service, {
      email,
      redirectTo: buildAuthResetRedirectUrl(publicOrigin, returnTo),
      source: "reset_email",
    });

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: prepared.redirectTo,
    });

    if (error) {
      const message = String(error.message ?? "").trim().toLowerCase();
      if (message.includes("user not found") || message.includes("email not found") || message.includes("no user")) {
        return noStoreJson({
          ok: true,
          maskedEmail: maskEmailAddress(email),
        });
      }
      if (isAuthRateLimitError(error)) {
        return noStoreJson({ ok: false, error: "auth_rate_limited" }, { status: 429 });
      }
      return noStoreJson(
        {
          ok: false,
          error: "reset_password_request_failed",
        },
        { status: 503 },
      );
    }

    return noStoreJson({
      ok: true,
      maskedEmail: maskEmailAddress(email),
    });
  } catch {
    return noStoreJson({ ok: false, error: "reset_password_request_failed" }, { status: 503 });
  }
}
