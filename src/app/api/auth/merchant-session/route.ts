import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  type MerchantAuthUserSummary,
  listMerchantIdsForUser,
} from "@/lib/merchantAuthIdentity";
import {
  clearMerchantAuthCookies,
  readMerchantAuthCookie,
  readMerchantAuthRefreshCookie,
  readMerchantRequestAccessTokens,
  readMerchantRequestRefreshTokens,
  setMerchantAuthCookies,
} from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import {
  readPlatformAccountIdFromMetadata,
  readPlatformAccountTypeHintFromMetadata,
  type PlatformAccountType,
} from "@/lib/platformAccounts";
import {
  readPersonalAccountServiceConfigFromMetadata,
  type PersonalAccountServiceConfig,
} from "@/lib/personalAccountServiceConfig";
import { createFrontendAuthProof } from "@/lib/frontendAuthProof.server";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RefreshPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  user?: unknown;
  error?: unknown;
  error_code?: unknown;
  error_description?: unknown;
  msg?: unknown;
  message?: unknown;
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
  accountType: PlatformAccountType;
  accountId: string | null;
  merchantId: string | null;
  merchantIds: string[];
  personalServiceConfig: PersonalAccountServiceConfig | null;
  personalServicePaused: boolean;
  frontendAuthProof?: string;
  user: MerchantAuthUserSummary;
};

type PublicMerchantSessionPayload = {
  authenticated: true;
  accountType: PlatformAccountType;
  accountId: string | null;
  merchantId: string | null;
  merchantIds: string[];
  accessToken?: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  tokenType?: string;
  personalServiceConfig: PersonalAccountServiceConfig | null;
  personalServicePaused: boolean;
  frontendAuthProof?: string;
  user: MerchantAuthUserSummary;
};

const MERCHANT_SESSION_CACHE_TTL_MS = 20_000;
const merchantSessionCache = new Map<string, { expiresAt: number; payload: AuthenticatedMerchantSessionPayload }>();
const merchantSessionInflight = new Map<string, Promise<AuthenticatedMerchantSessionPayload | null>>();

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function readCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const prefix = `${name}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(trimmed.slice(prefix.length));
    } catch {
      return trimmed.slice(prefix.length);
    }
  }
  return "";
}

function buildBrowserAuthStorageCookieName(storageKey: string) {
  return `faolla-auth-storage.${String(storageKey).replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function readSupabaseStorageProjectRef() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  try {
    return new URL(supabaseUrl).hostname.split(".")[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

function normalizeOAuthCodeVerifier(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "string") return parsed.trim();
  } catch {
    // Fall back to the raw cookie value below.
  }
  return raw.replace(/^"+|"+$/g, "").trim();
}

function readOAuthCodeVerifierFromRequest(request: Request) {
  const projectRef = readSupabaseStorageProjectRef();
  const storageKeys = [
    projectRef ? `sb-${projectRef}-auth-token-code-verifier` : "",
    projectRef ? `sb-${projectRef}-auth-token-code_verifier` : "",
  ].filter(Boolean);
  for (const storageKey of storageKeys) {
    const cookieValue = readCookieValue(request, buildBrowserAuthStorageCookieName(storageKey));
    const verifier = normalizeOAuthCodeVerifier(cookieValue);
    if (verifier) return verifier;
  }
  return "";
}

function normalizeSessionPreferredAccountType(value: unknown): PlatformAccountType | null {
  if (value === "personal") return "personal";
  if (value === "merchant") return "merchant";
  return null;
}

function readExistingSessionAccountType(user: MerchantAuthUserSummary | null): PlatformAccountType | "" {
  const metadataAccountType = readPlatformAccountTypeHintFromMetadata(user, "");
  if (metadataAccountType) return metadataAccountType;
  const accountId = readPlatformAccountIdFromMetadata(user);
  return accountId ? "merchant" : "";
}

async function resolveMerchantSessionPlatformIdentity(
  supabase: PlatformIdentitySupabaseClient | null,
  user: MerchantAuthUserSummary | null,
  options: { preferredAccountType?: PlatformAccountType | null; preferredEmail?: string | null } = {},
) {
  const metadataAccountType = readPlatformAccountTypeHintFromMetadata(user, "");
  const metadataAccountId = readPlatformAccountIdFromMetadata(user);
  const email = String(options.preferredEmail ?? user?.email ?? "").trim().toLowerCase();

  if (metadataAccountType || metadataAccountId) {
    return resolvePlatformAccountIdentityForUser(supabase, user, {
      preferredEmail: email,
    });
  }

  const matchedMerchantIds = await listMerchantIdsForUser(supabase, user).catch(() => [] as string[]);
  if (matchedMerchantIds.length > 0) {
    return resolvePlatformAccountIdentityForUser(supabase, user, {
      preferredAccountType: "merchant",
      preferredMerchantIds: matchedMerchantIds,
      preferredEmail: email,
    });
  }

  return resolvePlatformAccountIdentityForUser(supabase, user, {
    preferredAccountType: options.preferredAccountType ?? null,
    preferredEmail: email,
  });
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

function createServiceRoleSupabaseClient(): PlatformIdentitySupabaseClient | null {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as PlatformIdentitySupabaseClient;
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

async function exchangeOAuthCodeForSession(authCode: string, codeVerifier: string): Promise<MerchantRefreshResult> {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey || !authCode || !codeVerifier) return { status: "invalid" };

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        auth_code: authCode,
        code_verifier: codeVerifier,
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
    const refreshToken = typeof payload?.refresh_token === "string" ? payload.refresh_token.trim() : "";
    if (!accessToken || !refreshToken) return { status: "invalid" };

    return {
      status: "ok",
      accessToken,
      refreshToken,
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

function readMerchantSessionCacheFromCandidates(accessTokens: string[], refreshTokens: string[]) {
  for (const refreshToken of refreshTokens) {
    const cached = readMerchantSessionCache("", refreshToken);
    if (cached) return cached;
  }
  for (const accessToken of accessTokens) {
    const cached = readMerchantSessionCache(accessToken, "");
    if (cached) return cached;
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

function clearMerchantSessionCacheFromCandidates(accessTokens: string[], refreshTokens: string[]) {
  const attempted = new Set<string>();
  [...refreshTokens, ...accessTokens].forEach((token) => {
    const normalized = String(token ?? "").trim();
    if (!normalized || attempted.has(normalized)) return;
    attempted.add(normalized);
    clearMerchantSessionCache(normalized, "");
  });
}

function shouldIncludeAccountSwitchTokens(request: Request) {
  try {
    return new URL(request.url).searchParams.get("accountSwitch") === "1";
  } catch {
    return false;
  }
}

function toPublicMerchantSessionPayload(
  payload: AuthenticatedMerchantSessionPayload,
  options?: { includeAccountSwitchTokens?: boolean },
): PublicMerchantSessionPayload {
  return {
    authenticated: true,
    accountType: payload.accountType,
    accountId: payload.accountId,
    merchantId: payload.merchantId,
    merchantIds: payload.merchantIds,
    ...(options?.includeAccountSwitchTokens
      ? {
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          expiresIn: payload.expiresIn,
          tokenType: payload.tokenType,
        }
      : {}),
    personalServiceConfig: payload.personalServiceConfig,
    personalServicePaused: payload.personalServicePaused,
    frontendAuthProof: createFrontendAuthProof({
      accountType: payload.accountType,
      accountId: payload.accountId ?? payload.merchantId,
      userId: payload.user.id,
      email: payload.user.email,
    }),
    user: payload.user,
  };
}

function respondWithMerchantSession(request: Request, payload: AuthenticatedMerchantSessionPayload) {
  const response = noStoreJson(
    toPublicMerchantSessionPayload(payload, {
      includeAccountSwitchTokens: shouldIncludeAccountSwitchTokens(request),
    }),
  );
  setMerchantAuthCookies(response, {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    maxAgeSeconds: payload.expiresIn ?? undefined,
    merchantId: payload.merchantId,
    accountType: payload.accountType,
  }, request);
  return response;
}

export async function GET(request: Request) {
  try {
    const cookieAccessTokens = readMerchantRequestAccessTokens(request);
    const cookieRefreshTokens = readMerchantRequestRefreshTokens(request);
    const cookieAccessToken = cookieAccessTokens[0] ?? readMerchantAuthCookie(request);
    const cookieRefreshToken = cookieRefreshTokens[0] ?? readMerchantAuthRefreshCookie(request);
    const cached = readMerchantSessionCacheFromCandidates(cookieAccessTokens, cookieRefreshTokens);
    if (cached) {
      const needsAccountSwitchRefreshToken =
        shouldIncludeAccountSwitchTokens(request) &&
        !String(cached.refreshToken ?? "").trim() &&
        cookieRefreshTokens.length > 0;
      if (!needsAccountSwitchRefreshToken) {
        return respondWithMerchantSession(request, cached);
      }
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

      for (const candidateAccessToken of cookieAccessTokens) {
        const { data, error } = await supabase.auth.getUser(candidateAccessToken);
        if (!error && data.user) {
          accessToken = candidateAccessToken;
          user = data.user as MerchantAuthUserSummary;
          break;
        }
        if (error && isTransientMerchantSessionError(error)) {
          authUnavailable = true;
        }
      }

      if (!user) {
        for (const candidateRefreshToken of cookieRefreshTokens) {
          const refreshed = await refreshMerchantSession(candidateRefreshToken);
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
            if (user) break;
          } else if (refreshed.status === "unavailable") {
            authUnavailable = true;
          }
        }
      }

      if (!accessToken || !user) {
        if (authUnavailable) {
          throw new Error("merchant_session_transient_unavailable");
        }
        clearMerchantSessionCacheFromCandidates(cookieAccessTokens, cookieRefreshTokens);
        return null;
      }

      const platformIdentity = await resolveMerchantSessionPlatformIdentity(adminSupabase, user);
      const personalServiceConfig =
        platformIdentity.accountType === "personal" ? readPersonalAccountServiceConfigFromMetadata(user) : null;

      const payload = {
        authenticated: true,
        accessToken,
        refreshToken: refreshToken || null,
        expiresIn,
        tokenType,
        accountType: platformIdentity.accountType,
        accountId: platformIdentity.accountId,
        merchantId: platformIdentity.merchantId,
        merchantIds: platformIdentity.merchantIds,
        personalServiceConfig,
        personalServicePaused: personalServiceConfig?.servicePaused === true,
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
            authCode?: unknown;
            codeVerifier?: unknown;
            preferredAccountType?: unknown;
            authProvider?: unknown;
          }
      | null;

    let accessToken = typeof payload?.accessToken === "string" ? payload.accessToken.trim() : "";
    let refreshToken = typeof payload?.refreshToken === "string" ? payload.refreshToken.trim() : "";
    let expiresIn = typeof payload?.expiresIn === "number" && Number.isFinite(payload.expiresIn) ? payload.expiresIn : undefined;
    const authCode = typeof payload?.authCode === "string" ? payload.authCode.trim() : "";
    const providedCodeVerifier = normalizeOAuthCodeVerifier(payload?.codeVerifier);

    if (!accessToken && authCode) {
      const exchanged = await exchangeOAuthCodeForSession(
        authCode,
        providedCodeVerifier || readOAuthCodeVerifierFromRequest(request),
      );
      if (exchanged.status === "unavailable") {
        return noStoreJson({ ok: false, error: "merchant_session_google_code_unavailable" }, { status: 503 });
      }
      if (exchanged.status === "ok") {
        accessToken = exchanged.accessToken;
        refreshToken = exchanged.refreshToken;
        expiresIn = exchanged.expiresIn ?? expiresIn;
      }
    }

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

    const requestedPreferredAccountType = normalizeSessionPreferredAccountType(payload?.preferredAccountType);
    const platformIdentity = await resolveMerchantSessionPlatformIdentity(adminSupabase, user, {
      preferredAccountType: requestedPreferredAccountType,
      preferredEmail: user.email,
    });
    const existingAccountType = readExistingSessionAccountType(user);
    const entrySwitched = Boolean(
      requestedPreferredAccountType &&
        platformIdentity.accountType !== requestedPreferredAccountType &&
        (existingAccountType || platformIdentity.accountId || platformIdentity.merchantId),
    );
    const personalServiceConfig =
      platformIdentity.accountType === "personal" ? readPersonalAccountServiceConfigFromMetadata(user) : null;

    const response = noStoreJson({
      ok: true,
      ...toPublicMerchantSessionPayload({
        authenticated: true,
        accessToken: verifiedAccessToken,
        refreshToken: verifiedRefreshToken || null,
        expiresIn: verifiedExpiresIn ?? null,
        tokenType: "bearer",
        accountType: platformIdentity.accountType,
        accountId: platformIdentity.accountId,
        merchantId: platformIdentity.merchantId,
        merchantIds: platformIdentity.merchantIds,
        personalServiceConfig,
        personalServicePaused: personalServiceConfig?.servicePaused === true,
        user,
      }),
      requestedAccountType: requestedPreferredAccountType || null,
      entrySwitched,
      message: entrySwitched
        ? platformIdentity.accountType === "personal"
          ? "您是个人用户，已帮您切换入口进行登录。"
          : "您是商户，已帮您切换入口进行登录。"
        : undefined,
    });
    setMerchantAuthCookies(response, {
      accessToken: verifiedAccessToken,
      refreshToken: verifiedRefreshToken,
      maxAgeSeconds: verifiedExpiresIn,
      merchantId: platformIdentity.merchantId,
      accountType: platformIdentity.accountType,
      preserveRefreshToken: !verifiedRefreshToken,
    }, request);
    return response;
  } catch {
    return noStoreJson({ ok: false, error: "merchant_session_sync_unavailable" }, { status: 503 });
  }
}
