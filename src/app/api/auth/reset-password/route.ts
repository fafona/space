import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  clearResetRecoveryCookies,
  readResetRecoveryCookie,
  readResetRecoveryRefreshCookie,
} from "@/lib/resetPasswordRecoverySession";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ResetPasswordPayload = {
  password?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  tokenHash?: unknown;
  token?: unknown;
};

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

async function resolveRecoveryUserId(payload: {
  accessToken: string;
  refreshToken: string;
  tokenHash: string;
}) {
  const anonSupabase = createAnonSupabaseClient();
  if (!anonSupabase) {
    return { userId: "", error: "reset_password_env_missing" };
  }

  const accessToken = payload.accessToken.trim();
  const refreshToken = payload.refreshToken.trim();
  const tokenHash = payload.tokenHash.trim();

  if (accessToken && refreshToken) {
    try {
      const { data, error } = await anonSupabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      const userId = String(data.session?.user?.id ?? data.user?.id ?? "").trim();
      if (!error && userId) {
        return { userId, error: "" };
      }
    } catch {
      // Fall through to direct token validation below.
    }
  }

  if (accessToken) {
    try {
      const { data, error } = await anonSupabase.auth.getUser(accessToken);
      const userId = String(data.user?.id ?? "").trim();
      if (!error && userId) {
        return { userId, error: "" };
      }
    } catch {
      // Fall through to token-hash verification below.
    }
  }

  if (tokenHash) {
    try {
      const { data, error } = await anonSupabase.auth.verifyOtp({
        type: "recovery",
        token_hash: tokenHash,
      });
      const userId = String(data.user?.id ?? data.session?.user?.id ?? "").trim();
      if (!error && userId) {
        return { userId, error: "" };
      }
    } catch {
      // Treat as expired recovery link below.
    }
  }

  return { userId: "", error: "reset_password_session_expired" };
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const payload = (await request.json().catch(() => null)) as ResetPasswordPayload | null;
    const password = typeof payload?.password === "string" ? payload.password : "";
    const accessTokenFromBody = typeof payload?.accessToken === "string" ? payload.accessToken : "";
    const refreshTokenFromBody = typeof payload?.refreshToken === "string" ? payload.refreshToken : "";
    const tokenHash = typeof payload?.tokenHash === "string" ? payload.tokenHash : typeof payload?.token === "string" ? payload.token : "";
    const accessToken = accessTokenFromBody.trim() || readResetRecoveryCookie(request);
    const refreshToken = refreshTokenFromBody.trim() || readResetRecoveryRefreshCookie(request);

    if (!password || password.length < 6) {
      return noStoreJson({ ok: false, error: "reset_password_invalid_password" }, { status: 400 });
    }

    if (!accessToken.trim() && !tokenHash.trim()) {
      return noStoreJson({ ok: false, error: "reset_password_missing_recovery_payload" }, { status: 400 });
    }

    const resolved = await resolveRecoveryUserId({
      accessToken,
      refreshToken,
      tokenHash,
    });
    if (!resolved.userId) {
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

    const { error } = await serviceSupabase.auth.admin.updateUserById(resolved.userId, {
      password,
    });
    if (error) {
      const response = noStoreJson(
        {
          ok: false,
          error: error.message || "reset_password_update_failed",
        },
        { status: 400 },
      );
      if (/session|expired|invalid/i.test(String(error.message ?? ""))) {
        clearResetRecoveryCookies(response, request);
      }
      return response;
    }

    const response = noStoreJson({ ok: true });
    clearResetRecoveryCookies(response, request);
    return response;
  } catch {
    const response = noStoreJson({ ok: false, error: "reset_password_unavailable" }, { status: 503 });
    clearResetRecoveryCookies(response, request);
    return response;
  }
}
