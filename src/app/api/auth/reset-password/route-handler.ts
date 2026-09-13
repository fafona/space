import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthRateLimitError, isValidAuthPassword, readAuthPassword } from "@/lib/authCredentialValidation";
import { isDefinitiveAuthMutationRejection } from "@/lib/authMutationOutcome.server";
import {
  clearResetRecoveryCookies,
  readResetRecoveryCookie,
  readResetRecoveryProofCookie,
  readResetRecoveryRefreshCookie,
} from "@/lib/resetPasswordRecoverySession";
import {
  activatePasswordRecoveryGrant,
  claimPasswordRecoveryGrant,
  completePasswordRecoveryGrant,
  createPasswordRecoveryProofToken,
  PasswordRecoveryGrantError,
  releasePasswordRecoveryGrant,
} from "@/lib/passwordRecoveryGrant.server";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import {
  hasImmutableMerchantStaffPrincipal,
  MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY,
} from "@/lib/merchantStaffPrincipal.server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ResetPasswordPayload = {
  password?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  tokenHash?: unknown;
  token?: unknown;
};

export function shouldReleaseRecoveryGrantAfterAuthError(error: unknown) {
  return isDefinitiveAuthMutationRejection(error);
}

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function createAnonSupabaseClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return null;
  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function createServiceRoleSupabaseClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function resolveRecoveryAccessTokenContext(
  anonSupabase: ReturnType<typeof createAnonSupabaseClient>,
  accessToken: string,
) {
  if (!anonSupabase || !accessToken) return null;
  const [claimsResult, userResult] = await Promise.all([
    anonSupabase.auth.getClaims(accessToken).catch(() => null),
    anonSupabase.auth.getUser(accessToken).catch(() => null),
  ]);
  const claims = claimsResult?.data?.claims;
  const userId = String(userResult?.data?.user?.id ?? "").trim();
  const sessionId = String(claims?.session_id ?? "").trim();
  const email = String(userResult?.data?.user?.email ?? "").trim().toLowerCase();
  if (
    claimsResult?.error ||
    userResult?.error ||
    !claims ||
    !userId ||
    String(claims.sub ?? "").trim() !== userId ||
    !sessionId ||
    !email
  ) {
    return null;
  }
  return { userId, sessionId, email, accessToken };
}

async function resolveRecoveryContext(payload: {
  accessToken: string;
  refreshToken: string;
  tokenHash: string;
}) {
  const anonSupabase = createAnonSupabaseClient();
  if (!anonSupabase) {
    return { context: null, error: "reset_password_env_missing", typedRecovery: false };
  }

  const accessToken = payload.accessToken.trim();
  const refreshToken = payload.refreshToken.trim();
  const tokenHash = payload.tokenHash.trim();

  if (tokenHash) {
    try {
      const { data, error } = await anonSupabase.auth.verifyOtp({
        type: "recovery",
        token_hash: tokenHash,
      });
      const sessionAccessToken = String(data.session?.access_token ?? "").trim();
      const context = !error && sessionAccessToken
        ? await resolveRecoveryAccessTokenContext(anonSupabase, sessionAccessToken)
        : null;
      if (context) {
        return { context, error: "", typedRecovery: true };
      }
    } catch {
      // Treat as expired recovery link below.
    }
    return { context: null, error: "reset_password_session_expired", typedRecovery: false };
  }

  if (accessToken && refreshToken) {
    try {
      const { data, error } = await anonSupabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      const sessionAccessToken = String(data.session?.access_token ?? accessToken).trim();
      const context = !error
        ? await resolveRecoveryAccessTokenContext(anonSupabase, sessionAccessToken)
        : null;
      if (context) {
        return { context, error: "", typedRecovery: false };
      }
    } catch {
      // Fall through to direct token validation below.
    }
  }

  if (accessToken) {
    try {
      const context = await resolveRecoveryAccessTokenContext(
        anonSupabase,
        accessToken,
      );
      if (context) {
        return { context, error: "", typedRecovery: false };
      }
    } catch {
      // Fall through to token-hash verification below.
    }
  }

  return { context: null, error: "reset_password_session_expired", typedRecovery: false };
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const payload = (await request.json().catch(() => null)) as ResetPasswordPayload | null;
    const password = readAuthPassword(payload?.password);
    const tokenHash = typeof payload?.tokenHash === "string" ? payload.tokenHash : typeof payload?.token === "string" ? payload.token : "";
    // Access and refresh tokens supplied by the browser may belong to an
    // ordinary password, OAuth, invite, or magic-link session. Final reset may
    // use only the HttpOnly recovery session established by the session or
    // verify-code route, or a token hash verified as type=recovery below.
    const accessToken = readResetRecoveryCookie(request);
    const refreshToken = readResetRecoveryRefreshCookie(request);
    const cookieProofToken = readResetRecoveryProofCookie(request);

    if (!isValidAuthPassword(password)) {
      return noStoreJson({ ok: false, error: "reset_password_invalid_password" }, { status: 400 });
    }

    if (!accessToken.trim() && !tokenHash.trim()) {
      return noStoreJson({ ok: false, error: "reset_password_missing_recovery_payload" }, { status: 400 });
    }

    const resolved = await resolveRecoveryContext({
      accessToken,
      refreshToken,
      tokenHash,
    });
    if (!resolved.context) {
      const errorCode = resolved.error || "reset_password_session_expired";
      const response = noStoreJson(
        { ok: false, error: errorCode },
        { status: /env_missing|unavailable/i.test(errorCode) ? 503 : 401 },
      );
      clearResetRecoveryCookies(response, request);
      return response;
    }

    const serviceSupabase = createServiceRoleSupabaseClient();
    if (!serviceSupabase) {
      const response = noStoreJson({ ok: false, error: "reset_password_env_missing" }, { status: 503 });
      clearResetRecoveryCookies(response);
      return response;
    }

    const proofToken = resolved.typedRecovery
      ? createPasswordRecoveryProofToken()
      : /^[A-Za-z0-9_-]{43}$/.test(cookieProofToken)
        ? cookieProofToken
        : "";
    if (!proofToken) {
      const response = noStoreJson(
        { ok: false, error: "reset_password_missing_recovery_proof" },
        { status: 401 },
      );
      clearResetRecoveryCookies(response, request);
      return response;
    }
    if (resolved.typedRecovery) {
      await activatePasswordRecoveryGrant(serviceSupabase, {
        proofToken,
        email: resolved.context.email,
        authUserId: resolved.context.userId,
        sessionId: resolved.context.sessionId,
        proofKind: "typed_recovery",
      });
    }
    const grant = await claimPasswordRecoveryGrant(serviceSupabase, {
      proofToken,
      authUserId: resolved.context.userId,
      sessionId: resolved.context.sessionId,
      password,
    });
    if (grant.state === "completed") {
      const response = noStoreJson({ ok: true });
      clearResetRecoveryCookies(response, request);
      return response;
    }

    const existing = await serviceSupabase.auth.admin.getUserById(
      resolved.context.userId,
    );
    if (existing.error || !existing.data.user) {
      await releasePasswordRecoveryGrant(serviceSupabase, {
        proofToken,
        authUserId: resolved.context.userId,
        sessionId: resolved.context.sessionId,
        passwordFingerprint: grant.passwordFingerprint,
      });
      const response = noStoreJson(
        { ok: false, error: "reset_password_update_failed" },
        { status: 503 },
      );
      return response;
    }
    const existingAppMetadata =
      existing.data.user.app_metadata &&
      typeof existing.data.user.app_metadata === "object"
        ? existing.data.user.app_metadata
        : {};
    const { error } = await serviceSupabase.auth.admin.updateUserById(resolved.context.userId, {
      password,
      ...(hasImmutableMerchantStaffPrincipal(existing.data.user)
        ? {
            app_metadata: {
              ...existingAppMetadata,
              [MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY]: true,
            },
          }
        : {}),
    });
    if (error) {
      const releaseGrant = shouldReleaseRecoveryGrantAfterAuthError(error);
      if (releaseGrant) {
        await releasePasswordRecoveryGrant(serviceSupabase, {
          proofToken,
          authUserId: resolved.context.userId,
          sessionId: resolved.context.sessionId,
          passwordFingerprint: grant.passwordFingerprint,
        });
      }
      const rateLimited = isAuthRateLimitError(error);
      const response = noStoreJson(
        {
          ok: false,
          error: rateLimited ? "auth_rate_limited" : "reset_password_update_failed",
        },
        { status: rateLimited ? 429 : releaseGrant ? 400 : 503 },
      );
      if (/session|expired|invalid/i.test(String(error.message ?? ""))) {
        clearResetRecoveryCookies(response, request);
      }
      return response;
    }

    await completePasswordRecoveryGrant(serviceSupabase, {
      proofToken,
      authUserId: resolved.context.userId,
      sessionId: resolved.context.sessionId,
      passwordFingerprint: grant.passwordFingerprint,
    });

    const response = noStoreJson({ ok: true });
    clearResetRecoveryCookies(response, request);
    return response;
  } catch (error) {
    if (error instanceof PasswordRecoveryGrantError) {
      const response = noStoreJson(
        { ok: false, error: error.code },
        { status: error.status },
      );
      if (error.status < 500) clearResetRecoveryCookies(response, request);
      return response;
    }
    const response = noStoreJson({ ok: false, error: "reset_password_unavailable" }, { status: 503 });
    clearResetRecoveryCookies(response, request);
    return response;
  }
}
