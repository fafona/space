import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  clearResetRecoveryCookies,
  readResetRecoveryCookie,
  readResetRecoveryRefreshCookie,
  setResetRecoveryCookies,
} from "@/lib/resetPasswordRecoverySession";

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
      clearResetRecoveryCookies(response);
      return response;
    }

    const response = noStoreJson({ ready: true });
    if (accessToken !== cookieAccessToken || (refreshToken || "") !== (cookieRefreshToken || "")) {
      setResetRecoveryCookies(response, {
        accessToken,
        refreshToken,
        maxAgeSeconds: expiresIn ?? undefined,
      });
    }
    return response;
  } catch {
    const response = noStoreJson({ ready: false, error: "reset_password_session_unavailable" }, { status: 503 });
    clearResetRecoveryCookies(response);
    return response;
  }
}
