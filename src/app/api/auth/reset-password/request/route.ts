import { NextResponse } from "next/server";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseAuthClient, maskEmailAddress, resolvePublicOrigin } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RequestBody = {
  email?: unknown;
};

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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
    if (!email || !email.includes("@")) {
      return noStoreJson({ ok: false, error: "reset_password_invalid_email" }, { status: 400 });
    }

    const supabase = createServerSupabaseAuthClient();
    if (!supabase) {
      return noStoreJson({ ok: false, error: "reset_password_env_missing" }, { status: 503 });
    }

    const requestUrl = new URL(request.url);
    const publicOrigin = resolvePublicOrigin(request, requestUrl);
    const redirectUrl = new URL("/reset-password/bridge", publicOrigin);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl.toString(),
    });

    if (error) {
      const message = String(error.message ?? "").trim().toLowerCase();
      if (message.includes("user not found") || message.includes("email not found") || message.includes("no user")) {
        return noStoreJson({
          ok: true,
          maskedEmail: maskEmailAddress(email),
        });
      }
      return noStoreJson(
        {
          ok: false,
          error: error.message || "reset_password_request_failed",
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
