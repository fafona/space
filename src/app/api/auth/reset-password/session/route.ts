import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeAuthEmail } from "@/lib/authCredentialValidation";
import {
  readResetRecoveryProofCookie,
  clearResetRecoveryCookies,
  readResetRecoveryCookie,
  readResetRecoveryRefreshCookie,
  setResetRecoveryCookies,
  setResetRecoveryProofCookie,
} from "@/lib/resetPasswordRecoverySession";
import {
  activatePasswordRecoveryGrant,
  createPasswordRecoveryProofToken,
  PasswordRecoveryGrantError,
  resolveRecoverySessionActivationEvidence,
  validatePasswordRecoveryGrant,
} from "@/lib/passwordRecoveryGrant.server";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AuthUserSummary = {
  id?: string | null;
};

type RefreshPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user?: unknown;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function createServerSupabaseClient() {
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

async function refreshRecoverySession(refreshToken: string) {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey || !refreshToken) return null;

  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as RefreshPayload | null;
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
  const nextRefreshToken = typeof payload?.refresh_token === "string" ? payload.refresh_token.trim() : "";
  if (!accessToken || !nextRefreshToken) return null;

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresIn: typeof payload?.expires_in === "number" ? payload.expires_in : null,
    user: payload?.user && typeof payload.user === "object" ? (payload.user as AuthUserSummary) : null,
  };
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function resolveVerifiedRecoverySession(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseClient>>,
  accessToken: string,
) {
  const [claimsResult, userResult] = await Promise.all([
    supabase.auth.getClaims(accessToken).catch(() => null),
    supabase.auth.getUser(accessToken).catch(() => null),
  ]);
  const claims = claimsResult?.data?.claims;
  const user = userResult?.data?.user;
  const authUserId = String(user?.id ?? "").trim().toLowerCase();
  const sessionId = String(claims?.session_id ?? "").trim();
  const email = normalizeAuthEmail(user?.email);
  if (
    claimsResult?.error ||
    userResult?.error ||
    !claims ||
    !authUserId ||
    String(claims.sub ?? "").trim().toLowerCase() !== authUserId ||
    !sessionId ||
    !email
  ) {
    return null;
  }
  return { authUserId, sessionId, email, user };
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
    if (!supabase) {
      return noStoreJson({ ready: false, error: "reset_password_env_missing" }, { status: 503 });
    }

    const cookieAccessToken = readResetRecoveryCookie(request);
    const cookieRefreshToken = readResetRecoveryRefreshCookie(request);
    let accessToken = cookieAccessToken;
    let refreshToken = cookieRefreshToken;
    let user: AuthUserSummary | null = null;
    let expiresIn: number | null = null;

    if (accessToken) {
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (!error && data.user) {
        user = data.user as AuthUserSummary;
      }
    }

    if (!user && refreshToken) {
      const refreshed = await refreshRecoverySession(refreshToken);
      if (refreshed) {
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        expiresIn = refreshed.expiresIn;
        user = refreshed.user;
        if (!user && accessToken) {
          const { data, error } = await supabase.auth.getUser(accessToken);
          if (!error && data.user) {
            user = data.user as AuthUserSummary;
          }
        }
      }
    }

    const service = createServerSupabaseServiceClient();
    const proofToken = readResetRecoveryProofCookie(request);
    const identity = accessToken
      ? await resolveVerifiedRecoverySession(supabase, accessToken)
      : null;
    const grantValid =
      service &&
      identity &&
      /^[A-Za-z0-9_-]{43}$/.test(proofToken)
        ? await validatePasswordRecoveryGrant(service, {
            proofToken,
            authUserId: identity.authUserId,
            sessionId: identity.sessionId,
          })
        : false;

    if (!accessToken || !user || !identity || !grantValid) {
      const response = noStoreJson({ ready: false }, { status: 401 });
      clearResetRecoveryCookies(response, request);
      return response;
    }

    const response = noStoreJson({ ready: true });
    if (accessToken !== cookieAccessToken || (refreshToken || "") !== (cookieRefreshToken || "")) {
      setResetRecoveryCookies(response, {
        accessToken,
        refreshToken,
        maxAgeSeconds: expiresIn ?? undefined,
      }, request);
    }
    return response;
  } catch {
    const response = noStoreJson({ ready: false, error: "reset_password_session_unavailable" }, { status: 503 });
    clearResetRecoveryCookies(response, request);
    return response;
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const payload = (await request.json().catch(() => null)) as
      | {
          accessToken?: unknown;
          refreshToken?: unknown;
          expiresIn?: unknown;
          tokenHash?: unknown;
          code?: unknown;
          type?: unknown;
          recoveryIntent?: unknown;
        }
      | null;

    let accessToken = typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
    let refreshToken = typeof payload?.refreshToken === "string" ? payload.refreshToken.trim() : "";
    let expiresIn =
      typeof payload?.expiresIn === "number" && Number.isFinite(payload.expiresIn) ? payload.expiresIn : undefined;
    const tokenHash = typeof payload?.tokenHash === "string" ? payload.tokenHash.trim() : "";
    const code = typeof payload?.code === "string" ? payload.code.trim() : "";
    const evidence = resolveRecoverySessionActivationEvidence({
      tokenHash,
      type: payload?.type,
      recoveryIntent: payload?.recoveryIntent,
    });
    if (!evidence) {
      const response = noStoreJson(
        { ok: false, error: "reset_password_missing_recovery_proof" },
        { status: 401 },
      );
      clearResetRecoveryCookies(response, request);
      return response;
    }

    const supabase = createServerSupabaseClient();
    if (!supabase) {
      return noStoreJson({ ok: false, error: "reset_password_env_missing" }, { status: 503 });
    }

    let hasTypedRecoveryProof = false;

    if (evidence.kind === "typed_recovery") {
      const { data, error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: evidence.tokenHash,
      });
      accessToken = String(data.session?.access_token ?? "").trim();
      refreshToken = String(data.session?.refresh_token ?? "").trim();
      if (typeof data.session?.expires_in === "number" && Number.isFinite(data.session.expires_in)) {
        expiresIn = data.session.expires_in;
      }
      if (error || !accessToken) {
        const response = noStoreJson({ ok: false, error: "reset_password_invalid_access_token" }, { status: 401 });
        clearResetRecoveryCookies(response, request);
        return response;
      }
      hasTypedRecoveryProof = true;
    } else if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      accessToken = String(data.session?.access_token ?? "").trim();
      refreshToken = String(data.session?.refresh_token ?? "").trim();
      if (typeof data.session?.expires_in === "number" && Number.isFinite(data.session.expires_in)) {
        expiresIn = data.session.expires_in;
      }
      if (error || !accessToken) {
        const response = noStoreJson({ ok: false, error: "reset_password_invalid_code" }, { status: 401 });
        clearResetRecoveryCookies(response, request);
        return response;
      }
    }

    if (!accessToken) {
      const response = noStoreJson({ ok: false, error: "reset_password_missing_access_token" }, { status: 400 });
      clearResetRecoveryCookies(response, request);
      return response;
    }

    const identity = await resolveVerifiedRecoverySession(supabase, accessToken);
    if (!identity) {
      const response = noStoreJson({ ok: false, error: "reset_password_invalid_access_token" }, { status: 401 });
      clearResetRecoveryCookies(response, request);
      return response;
    }

    const service = createServerSupabaseServiceClient();
    if (!service) {
      return noStoreJson(
        { ok: false, error: "reset_password_env_missing" },
        { status: 503 },
      );
    }
    const proofToken = hasTypedRecoveryProof
      ? createPasswordRecoveryProofToken()
      : evidence.proofToken;
    await activatePasswordRecoveryGrant(service, {
      proofToken,
      email: identity.email,
      authUserId: identity.authUserId,
      sessionId: identity.sessionId,
      proofKind: hasTypedRecoveryProof
        ? "typed_recovery"
        : "requested_intent",
    });

    const response = noStoreJson({
      ok: true,
      ready: true,
    });
    setResetRecoveryCookies(response, {
      accessToken,
      refreshToken,
      maxAgeSeconds: expiresIn,
    }, request);
    setResetRecoveryProofCookie(response, proofToken);
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
    const response = noStoreJson({ ok: false, error: "reset_password_session_unavailable" }, { status: 503 });
    clearResetRecoveryCookies(response, request);
    return response;
  }
}
