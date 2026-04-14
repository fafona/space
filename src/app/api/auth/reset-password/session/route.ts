import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  clearResetRecoveryCookies,
  readResetRecoveryCookie,
  readResetRecoveryRefreshCookie,
  setResetRecoveryCookies,
} from "@/lib/resetPasswordRecoverySession";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RecoveryOtpType = "email" | "magiclink" | "recovery";

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

function normalizeRecoveryType(value: unknown): RecoveryOtpType {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "email" || normalized === "magiclink" || normalized === "recovery") {
    return normalized;
  }
  return "recovery";
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

    if (!accessToken || !user) {
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
    const supabase = createServerSupabaseClient();
    if (!supabase) {
      return noStoreJson({ ok: false, error: "reset_password_env_missing" }, { status: 503 });
    }

    const payload = (await request.json().catch(() => null)) as
      | {
          accessToken?: unknown;
          refreshToken?: unknown;
          expiresIn?: unknown;
          tokenHash?: unknown;
          code?: unknown;
          type?: unknown;
        }
      | null;

    let accessToken = typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
    let refreshToken = typeof payload?.refreshToken === "string" ? payload.refreshToken.trim() : "";
    let expiresIn =
      typeof payload?.expiresIn === "number" && Number.isFinite(payload.expiresIn) ? payload.expiresIn : undefined;
    const tokenHash = typeof payload?.tokenHash === "string" ? payload.tokenHash.trim() : "";
    const code = typeof payload?.code === "string" ? payload.code.trim() : "";
    const recoveryType = normalizeRecoveryType(payload?.type);

    if (!accessToken && code) {
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

    if (!accessToken && tokenHash) {
      const { data, error } = await supabase.auth.verifyOtp({
        type: recoveryType,
        token_hash: tokenHash,
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
    }

    if (!accessToken) {
      const response = noStoreJson({ ok: false, error: "reset_password_missing_access_token" }, { status: 400 });
      clearResetRecoveryCookies(response, request);
      return response;
    }

    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) {
      const response = noStoreJson({ ok: false, error: "reset_password_invalid_access_token" }, { status: 401 });
      clearResetRecoveryCookies(response, request);
      return response;
    }

    const response = noStoreJson({
      ok: true,
      ready: true,
    });
    setResetRecoveryCookies(response, {
      accessToken,
      refreshToken,
      maxAgeSeconds: expiresIn,
    }, request);
    return response;
  } catch {
    const response = noStoreJson({ ok: false, error: "reset_password_session_unavailable" }, { status: 503 });
    clearResetRecoveryCookies(response, request);
    return response;
  }
}
