import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  type MerchantAuthUserSummary,
  type MerchantIdentitySupabaseClient,
  resolveMerchantIdentityForUser,
} from "@/lib/merchantAuthIdentity";
import {
  clearMerchantAuthCookies,
  readMerchantAuthCookie,
  readMerchantAuthRefreshCookie,
  setMerchantAuthCookies,
} from "@/lib/merchantAuthSession";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RefreshPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  user?: unknown;
};

type MerchantRefreshResult =
  | {
      status: "ok";
      accessToken: string;
      refreshToken: string;
      expiresIn: number | null;
      tokenType: string;
      user: MerchantAuthUserSummary | null;
    }
  | {
      status: "invalid";
    }
  | {
      status: "unavailable";
    };

type AuthenticatedMerchantSessionPayload = {
  authenticated: true;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  tokenType: string;
  merchantId: string | null;
  merchantIds: string[];
  user: MerchantAuthUserSummary;
};

type PublicMerchantSessionPayload = {
  authenticated: true;
  merchantId: string | null;
  merchantIds: string[];
  user: MerchantAuthUserSummary;
};

const MERCHANT_SESSION_CACHE_TTL_MS = 20_000;
const merchantSessionCache = new Map<string, { expiresAt: number; payload: AuthenticatedMerchantSessionPayload }>();
const merchantSessionInflight = new Map<string, Promise<AuthenticatedMerchantSessionPayload | null>>();

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function isTransientMerchantSessionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { message?: unknown; name?: unknown; status?: unknown; code?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  const name = typeof record.name === "string" ? record.name : "";
  const code = typeof record.code === "string" ? record.code : "";
  if (name === "AbortError") return true;
  if (Number(record.status) === 0) return true;
  return /timeout|temporarily|connection|network|fetch|load failed|unavailable|cooldown/i.test(message + code);
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

function createServiceRoleSupabaseClient(): MerchantIdentitySupabaseClient | null {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as MerchantIdentitySupabaseClient;
}

async function refreshMerchantSession(refreshToken: string): Promise<MerchantRefreshResult> {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey || !refreshToken) return { status: "invalid" };

  try {
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

    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        return { status: "unavailable" };
      }
      return { status: "invalid" };
    }
    const payload = (await response.json().catch(() => null)) as RefreshPayload | null;
    const accessToken = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
    const nextRefreshToken = typeof payload?.refresh_token === "string" ? payload.refresh_token.trim() : "";
    if (!accessToken || !nextRefreshToken) return { status: "invalid" };

    return {
      status: "ok",
      accessToken,
      refreshToken: nextRefreshToken,
      expiresIn: typeof payload?.expires_in === "number" ? payload.expires_in : null,
      tokenType: typeof payload?.token_type === "string" ? payload.token_type : "bearer",
      user:
        payload?.user && typeof payload.user === "object"
          ? (payload.user as MerchantAuthUserSummary)
          : null,
    };
  } catch (error) {
    if (isTransientMerchantSessionError(error)) {
      return { status: "unavailable" };
    }
    return { status: "invalid" };
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function readMerchantSessionCache(accessToken: string, refreshToken: string) {
  const keys = [refreshToken, accessToken].map((value) => String(value ?? "").trim()).filter(Boolean);
  for (const key of keys) {
    const cached = merchantSessionCache.get(key) ?? null;
    if (!cached) continue;
    if (cached.expiresAt <= Date.now()) {
      merchantSessionCache.delete(key);
      continue;
    }
    return cached.payload;
  }
  return null;
}

function writeMerchantSessionCache(payload: AuthenticatedMerchantSessionPayload) {
  const keys = [payload.refreshToken, payload.accessToken].map((value) => String(value ?? "").trim()).filter(Boolean);
  if (keys.length === 0) return;
  const entry = {
    expiresAt: Date.now() + MERCHANT_SESSION_CACHE_TTL_MS,
    payload,
  };
  keys.forEach((key) => {
    merchantSessionCache.set(key, entry);
  });
}

function clearMerchantSessionCache(accessToken: string, refreshToken: string) {
  [refreshToken, accessToken]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .forEach((key) => {
      merchantSessionCache.delete(key);
      merchantSessionInflight.delete(key);
    });
}

function toPublicMerchantSessionPayload(payload: AuthenticatedMerchantSessionPayload): PublicMerchantSessionPayload {
  return {
    authenticated: true,
    merchantId: payload.merchantId,
    merchantIds: payload.merchantIds,
    user: payload.user,
  };
}

function respondWithMerchantSession(request: Request, payload: AuthenticatedMerchantSessionPayload) {
  const response = noStoreJson(toPublicMerchantSessionPayload(payload));
  setMerchantAuthCookies(response, {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    maxAgeSeconds: payload.expiresIn ?? undefined,
    merchantId: payload.merchantId,
  }, request);
  return response;
}

export async function GET(request: Request) {
  try {
    const cookieAccessToken = readMerchantAuthCookie(request);
    const cookieRefreshToken = readMerchantAuthRefreshCookie(request);
    const cached = readMerchantSessionCache(cookieAccessToken, cookieRefreshToken);
    if (cached) {
      return respondWithMerchantSession(request, cached);
    }

    const supabase = createServerSupabaseClient();
    const adminSupabase = createServiceRoleSupabaseClient();
    if (!supabase) {
      return noStoreJson({ error: "merchant_session_env_missing" }, { status: 503 });
    }

    const cacheKey = [cookieRefreshToken, cookieAccessToken].map((value) => String(value ?? "").trim()).find(Boolean) ?? "";
    if (cacheKey) {
      const inFlight = merchantSessionInflight.get(cacheKey);
      if (inFlight) {
        const payload = await inFlight;
        if (payload) return respondWithMerchantSession(request, payload);
      }
    }

    const task = (async () => {
      let accessToken = cookieAccessToken;
      let refreshToken = cookieRefreshToken;
      let user: MerchantAuthUserSummary | null = null;
      let expiresIn: number | null = null;
      let tokenType = "bearer";
      let authUnavailable = false;

      if (accessToken) {
        const { data, error } = await supabase.auth.getUser(accessToken);
        if (!error && data.user) {
          user = data.user as MerchantAuthUserSummary;
        } else if (error && isTransientMerchantSessionError(error)) {
          authUnavailable = true;
        }
      }

      if (!user && refreshToken) {
        const refreshed = await refreshMerchantSession(refreshToken);
        if (refreshed.status === "ok") {
          accessToken = refreshed.accessToken;
          refreshToken = refreshed.refreshToken;
          expiresIn = refreshed.expiresIn;
          tokenType = refreshed.tokenType;
          user = refreshed.user;
          if (!user && accessToken) {
            const { data, error } = await supabase.auth.getUser(accessToken);
            if (!error && data.user) {
              user = data.user as MerchantAuthUserSummary;
            } else if (error && isTransientMerchantSessionError(error)) {
              authUnavailable = true;
            }
          }
        } else if (refreshed.status === "unavailable") {
          authUnavailable = true;
        }
      }

      if (!accessToken || !user) {
        if (authUnavailable) {
          throw new Error("merchant_session_transient_unavailable");
        }
        clearMerchantSessionCache(cookieAccessToken, cookieRefreshToken);
        return null;
      }

      const merchantIdentity = await resolveMerchantIdentityForUser(adminSupabase, user);

      const payload = {
        authenticated: true,
        accessToken,
        refreshToken: refreshToken || null,
        expiresIn,
        tokenType,
        merchantId: merchantIdentity.merchantId,
        merchantIds: merchantIdentity.merchantIds,
        user,
      } satisfies AuthenticatedMerchantSessionPayload;
      writeMerchantSessionCache(payload);
      return payload;
    })();

    if (cacheKey) {
      merchantSessionInflight.set(cacheKey, task);
    }
    try {
      const payload = await task;
      if (!payload) {
        const response = noStoreJson({ authenticated: false }, { status: 401 });
        clearMerchantAuthCookies(response, request);
        return response;
      }
      return respondWithMerchantSession(request, payload);
    } finally {
      if (cacheKey && merchantSessionInflight.get(cacheKey) === task) {
        merchantSessionInflight.delete(cacheKey);
      }
    }
  } catch {
    return noStoreJson({ authenticated: false, error: "merchant_session_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const supabase = createServerSupabaseClient();
    const adminSupabase = createServiceRoleSupabaseClient();
    if (!supabase) {
      return noStoreJson({ error: "merchant_session_env_missing" }, { status: 503 });
    }

    const payload = (await request.json().catch(() => null)) as
      | {
          accessToken?: unknown;
          refreshToken?: unknown;
          expiresIn?: unknown;
        }
      | null;

    const accessToken = typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
    const refreshToken = typeof payload?.refreshToken === "string" ? payload.refreshToken.trim() : "";
    const expiresIn = typeof payload?.expiresIn === "number" && Number.isFinite(payload.expiresIn) ? payload.expiresIn : undefined;

    if (!accessToken) {
      const response = noStoreJson({ ok: false, error: "merchant_session_missing_access_token" }, { status: 400 });
      clearMerchantAuthCookies(response, request);
      return response;
    }

    let verifiedAccessToken = accessToken;
    let verifiedRefreshToken = refreshToken;
    let verifiedExpiresIn = expiresIn;
    let user: MerchantAuthUserSummary | null = null;

    const { data, error } = await supabase.auth.getUser(accessToken);
    if (!error && data.user) {
      user = data.user as MerchantAuthUserSummary;
    } else if (error && isTransientMerchantSessionError(error)) {
      return noStoreJson({ ok: false, error: "merchant_session_sync_unavailable" }, { status: 503 });
    } else if (refreshToken) {
      const refreshed = await refreshMerchantSession(refreshToken);
      if (refreshed.status === "unavailable") {
        return noStoreJson({ ok: false, error: "merchant_session_sync_unavailable" }, { status: 503 });
      }
      if (refreshed.status === "ok") {
        verifiedAccessToken = refreshed.accessToken;
        verifiedRefreshToken = refreshed.refreshToken;
        verifiedExpiresIn = refreshed.expiresIn ?? expiresIn;
        user = refreshed.user;
        if (!user) {
          const retried = await supabase.auth.getUser(verifiedAccessToken);
          if (!retried.error && retried.data.user) {
            user = retried.data.user as MerchantAuthUserSummary;
          } else if (retried.error && isTransientMerchantSessionError(retried.error)) {
            return noStoreJson({ ok: false, error: "merchant_session_sync_unavailable" }, { status: 503 });
          }
        }
      }
    }

    if (!user) {
      const response = noStoreJson({ ok: false, error: "merchant_session_invalid_access_token" }, { status: 401 });
      clearMerchantAuthCookies(response, request);
      return response;
    }

    const merchantIdentity = await resolveMerchantIdentityForUser(adminSupabase, user);

    const response = noStoreJson({
      ok: true,
      ...toPublicMerchantSessionPayload({
        authenticated: true,
        accessToken: verifiedAccessToken,
        refreshToken: verifiedRefreshToken || null,
        expiresIn: verifiedExpiresIn ?? null,
        tokenType: "bearer",
        merchantId: merchantIdentity.merchantId,
        merchantIds: merchantIdentity.merchantIds,
        user,
      }),
    });
    setMerchantAuthCookies(response, {
      accessToken: verifiedAccessToken,
      refreshToken: verifiedRefreshToken,
      maxAgeSeconds: verifiedExpiresIn,
      merchantId: merchantIdentity.merchantId,
    }, request);
    return response;
  } catch {
    return noStoreJson({ ok: false, error: "merchant_session_sync_unavailable" }, { status: 503 });
  }
}
