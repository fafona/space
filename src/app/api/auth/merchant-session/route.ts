import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  type MerchantAuthUserSummary,
} from "@/lib/merchantAuthIdentity";
import {
  clearMerchantAuthCookies,
  clearMerchantAuthMerchantIdCookie,
  readMerchantAuthMerchantIdCookie,
  readMerchantRequestAccessTokens,
  readMerchantRequestRefreshTokens,
  setMerchantAuthCookies,
} from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { type PlatformAccountType } from "@/lib/platformAccounts";
import {
  readPersonalAccountServiceConfigFromMetadata,
  type PersonalAccountServiceConfig,
} from "@/lib/personalAccountServiceConfig";
import { isOrdinaryAccountPrincipalError } from "@/lib/ordinaryAccountPrincipal.server";
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
  user: MerchantAuthUserSummary;
};

const MERCHANT_SESSION_AUTH_TIMEOUT_MS = 4500;
const MERCHANT_SESSION_TOKEN_TIMEOUT_MS = 6000;
const MERCHANT_SESSION_IDENTITY_TIMEOUT_MS = 4500;
const merchantSessionInflight = new Map<string, Promise<AuthenticatedMerchantSessionPayload | null>>();

type MerchantSessionGetUserResult = Awaited<
  ReturnType<NonNullable<ReturnType<typeof createServerSupabaseClient>>["auth"]["getUser"]>
>;

type MerchantSessionPlatformIdentity = {
  accountType: PlatformAccountType;
  accountId: string | null;
  merchantId: string | null;
  merchantIds: string[];
};

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
    if (typeof parsed === "string") return normalizeOAuthCodeVerifier(parsed);
  } catch {
    // Fall back to the raw cookie value below.
  }
  return raw.replace(/^"+|"+$/g, "").split("/")[0]?.trim() ?? "";
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

async function withFallbackTimeout<T>(task: PromiseLike<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(task),
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), Math.max(500, timeoutMs));
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, Math.max(500, timeoutMs));
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function createMerchantSessionAuthTimeoutResult(): MerchantSessionGetUserResult {
  return {
    data: { user: null },
    error: new Error("merchant_session_auth_timeout"),
  } as MerchantSessionGetUserResult;
}

async function readMerchantSessionUser(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseClient>>,
  accessToken: string,
) {
  const fallback = createMerchantSessionAuthTimeoutResult();
  try {
    return await withFallbackTimeout(
      supabase.auth.getUser(accessToken),
      MERCHANT_SESSION_AUTH_TIMEOUT_MS,
      fallback,
    );
  } catch (error) {
    if (isTransientMerchantSessionError(error)) return fallback;
    throw error;
  }
}

async function resolveMerchantSessionPlatformIdentity(
  supabase: PlatformIdentitySupabaseClient | null,
  user: MerchantAuthUserSummary | null,
  options: {
    preferredAccountType?: PlatformAccountType | null;
    preferredEmail?: string | null;
    preferredMerchantId?: string | null;
    strictPreferredMerchantId?: boolean;
  } = {},
) : Promise<MerchantSessionPlatformIdentity> {
  const identity = await withFallbackTimeout(
    resolvePlatformAccountIdentityForUser(supabase, user, options),
    MERCHANT_SESSION_IDENTITY_TIMEOUT_MS,
    null,
  );
  if (!identity) throw new Error("ordinary_account_identity_timeout");
  return identity;
}

function readGetPreferredMerchantId(request: Request) {
  const queryValue = new URL(request.url).searchParams.get("merchantId");
  if (queryValue !== null) {
    return { value: queryValue.trim().slice(0, 64), strict: true };
  }
  return { value: readMerchantAuthMerchantIdCookie(request), strict: false };
}

function readPostPreferredMerchantId(
  request: Request,
  payload: Record<string, unknown> | null,
) {
  const hasPreferred = Boolean(
    payload &&
      (Object.prototype.hasOwnProperty.call(payload, "preferredMerchantId") ||
        Object.prototype.hasOwnProperty.call(payload, "merchantId")),
  );
  if (!hasPreferred) {
    return { value: readMerchantAuthMerchantIdCookie(request), strict: false };
  }
  const value = Object.prototype.hasOwnProperty.call(
    payload,
    "preferredMerchantId",
  )
    ? payload?.preferredMerchantId
    : payload?.merchantId;
  if (value === null) return { value: "", strict: true };
  if (typeof value !== "string") {
    return { value: "__invalid_merchant_selection__", strict: true };
  }
  return { value: value.trim().slice(0, 64), strict: true };
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
    const response = await fetchWithTimeout(
      `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`,
      {
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
      },
      MERCHANT_SESSION_TOKEN_TIMEOUT_MS,
    );

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
    const response = await fetchWithTimeout(
      `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=pkce`,
      {
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
      },
      MERCHANT_SESSION_TOKEN_TIMEOUT_MS,
    );

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

function buildMerchantSessionInflightKey(
  accessTokens: string[],
  refreshTokens: string[],
  preferredMerchantId: string,
  strictPreferredMerchantId: boolean,
) {
  if (accessTokens.length === 0 && refreshTokens.length === 0) return "";
  return JSON.stringify({
    accessTokens,
    refreshTokens,
    preferredMerchantId: preferredMerchantId || null,
    strictPreferredMerchantId,
  });
}

async function refreshMerchantSessionWithVerifiedUser(
  supabase: Parameters<typeof readMerchantSessionUser>[0],
  refreshToken: string,
) {
  const refreshed = await refreshMerchantSession(refreshToken);
  if (refreshed.status !== "ok") return { status: refreshed.status } as const;
  let user = refreshed.user;
  if (!user) {
    const checked = await readMerchantSessionUser(supabase, refreshed.accessToken);
    if (!checked.error && checked.data.user) {
      user = checked.data.user as MerchantAuthUserSummary;
    } else if (checked.error && isTransientMerchantSessionError(checked.error)) {
      return { status: "unavailable" } as const;
    }
  }
  if (!user) return { status: "invalid" } as const;
  return { status: "ok", refreshed, user } as const;
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
    // Cross-subdomain proof issuance is disabled until a site-scoped,
    // one-time exchange with bounded audience and replay protection exists.
    // Same-origin callers continue to use the HttpOnly session cookie.
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
    const adminSupabase = createServiceRoleSupabaseClient();
    const preferredSelection = readGetPreferredMerchantId(request);
    const preferredMerchantId = preferredSelection.value;
    const supabase = createServerSupabaseClient();
    if (!supabase) {
      return noStoreJson({ error: "merchant_session_env_missing" }, { status: 503 });
    }

    const inflightKey = buildMerchantSessionInflightKey(
      cookieAccessTokens,
      cookieRefreshTokens,
      preferredMerchantId,
      preferredSelection.strict,
    );
    if (inflightKey) {
      const inFlight = merchantSessionInflight.get(inflightKey);
      if (inFlight) {
        const payload = await inFlight;
        if (payload) return respondWithMerchantSession(request, payload);
      }
    }

    const task = (async () => {
      let accessToken = "";
      let refreshToken = "";
      let user: MerchantAuthUserSummary | null = null;
      let expiresIn: number | null = null;
      let tokenType = "bearer";
      let authUnavailable = false;

      for (const candidateAccessToken of cookieAccessTokens) {
        const { data, error } = await readMerchantSessionUser(supabase, candidateAccessToken);
        if (!error && data.user) {
          accessToken = candidateAccessToken;
          user = data.user as MerchantAuthUserSummary;
          break;
        }
        if (error && isTransientMerchantSessionError(error)) {
          authUnavailable = true;
        }
      }

      if (user && cookieRefreshTokens.length > 0) {
        const accessUserId = String(user.id ?? "").trim();
        for (const candidateRefreshToken of cookieRefreshTokens) {
          const refreshed = await refreshMerchantSession(candidateRefreshToken);
          if (refreshed.status === "unavailable") {
            authUnavailable = true;
            continue;
          }
          if (refreshed.status !== "ok") continue;
          let refreshedUser = refreshed.user;
          if (!refreshedUser) {
            const checked = await readMerchantSessionUser(
              supabase,
              refreshed.accessToken,
            );
            if (!checked.error && checked.data.user) {
              refreshedUser = checked.data.user as MerchantAuthUserSummary;
            } else if (checked.error && isTransientMerchantSessionError(checked.error)) {
              authUnavailable = true;
            }
          }
          if (
            !refreshedUser ||
            String(refreshedUser.id ?? "").trim() !== accessUserId
          ) {
            continue;
          }
          accessToken = refreshed.accessToken;
          refreshToken = refreshed.refreshToken;
          expiresIn = refreshed.expiresIn;
          tokenType = refreshed.tokenType;
          user = refreshedUser;
          break;
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
              const { data, error } = await readMerchantSessionUser(supabase, accessToken);
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
        return null;
      }

      const platformIdentity = await resolveMerchantSessionPlatformIdentity(
        adminSupabase,
        user,
        {
          preferredMerchantId,
          strictPreferredMerchantId:
            preferredSelection.strict && Boolean(preferredMerchantId),
        },
      );
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
      return payload;
    })();

    if (inflightKey) {
      merchantSessionInflight.set(inflightKey, task);
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
      if (inflightKey && merchantSessionInflight.get(inflightKey) === task) {
        merchantSessionInflight.delete(inflightKey);
      }
    }
  } catch (error) {
    if (isOrdinaryAccountPrincipalError(error)) {
      const response = noStoreJson(
        { authenticated: false, error: error.code },
        { status: error.status },
      );
      if (error.status === 403) {
        if (error.code === "ordinary_account_merchant_selection_forbidden") {
          clearMerchantAuthMerchantIdCookie(response, request);
        } else {
          clearMerchantAuthCookies(response, request);
        }
      }
      return response;
    }
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
            preferredMerchantId?: unknown;
            merchantId?: unknown;
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
      } else {
        return noStoreJson(
          {
            ok: false,
            error: "merchant_session_google_code_invalid",
            message: "Google 登录授权已失效，请重新点击 Google 登录。",
          },
          { status: 401 },
        );
      }
    }

    if (!accessToken) {
      const response = noStoreJson({ ok: false, error: "merchant_session_missing_access_token" }, { status: 400 });
      clearMerchantAuthCookies(response, request);
      return response;
    }

    const refreshTokenCandidates = [
      refreshToken,
      ...readMerchantRequestRefreshTokens(request),
    ].filter(
      (value, index, values): value is string =>
        Boolean(value) && values.indexOf(value) === index,
    );

    let verifiedAccessToken = accessToken;
    let verifiedRefreshToken = "";
    let verifiedExpiresIn = expiresIn;
    let user: MerchantAuthUserSummary | null = null;
    let sessionRefreshed = false;

    const { data, error } = await readMerchantSessionUser(supabase, accessToken);
    if (!error && data.user) {
      user = data.user as MerchantAuthUserSummary;
    } else if (error && isTransientMerchantSessionError(error)) {
      return noStoreJson({ ok: false, error: "merchant_session_sync_unavailable" }, { status: 503 });
    } else if (refreshTokenCandidates.length > 0) {
      let refreshUnavailable = false;
      for (const candidateRefreshToken of refreshTokenCandidates) {
        const candidate = await refreshMerchantSessionWithVerifiedUser(
          supabase,
          candidateRefreshToken,
        );
        if (candidate.status === "unavailable") {
          refreshUnavailable = true;
          continue;
        }
        if (candidate.status !== "ok") continue;
        sessionRefreshed = true;
        verifiedAccessToken = candidate.refreshed.accessToken;
        verifiedRefreshToken = candidate.refreshed.refreshToken;
        verifiedExpiresIn = candidate.refreshed.expiresIn ?? expiresIn;
        user = candidate.user;
        break;
      }
      if (!user && refreshUnavailable) {
        return noStoreJson(
          { ok: false, error: "merchant_session_sync_unavailable" },
          { status: 503 },
        );
      }
    }

    if (user && refreshTokenCandidates.length > 0 && !sessionRefreshed) {
      const accessUserId = String(user.id ?? "").trim();
      let refreshUnavailable = false;
      for (const candidateRefreshToken of refreshTokenCandidates) {
        const candidate = await refreshMerchantSessionWithVerifiedUser(
          supabase,
          candidateRefreshToken,
        );
        if (candidate.status === "unavailable") {
          refreshUnavailable = true;
          continue;
        }
        if (
          candidate.status !== "ok" ||
          String(candidate.user.id ?? "").trim() !== accessUserId
        ) {
          continue;
        }
        verifiedAccessToken = candidate.refreshed.accessToken;
        verifiedRefreshToken = candidate.refreshed.refreshToken;
        verifiedExpiresIn = candidate.refreshed.expiresIn ?? expiresIn;
        user = candidate.user;
        break;
      }
      if (!verifiedRefreshToken && refreshUnavailable) {
        return noStoreJson(
          { ok: false, error: "merchant_session_sync_unavailable" },
          { status: 503 },
        );
      }
    }

    if (!user) {
      const response = noStoreJson({ ok: false, error: "merchant_session_invalid_access_token" }, { status: 401 });
      clearMerchantAuthCookies(response, request);
      return response;
    }

    const requestedPreferredAccountType = normalizeSessionPreferredAccountType(payload?.preferredAccountType);
    const requestedPreferredSelection = readPostPreferredMerchantId(
      request,
      payload as Record<string, unknown> | null,
    );
    const platformIdentity = await resolveMerchantSessionPlatformIdentity(adminSupabase, user, {
      preferredAccountType: requestedPreferredAccountType,
      preferredEmail: user.email,
      preferredMerchantId: requestedPreferredSelection.value,
      strictPreferredMerchantId:
        requestedPreferredSelection.strict &&
        Boolean(requestedPreferredSelection.value),
    });
    const entrySwitched = Boolean(
      requestedPreferredAccountType &&
        platformIdentity.accountType !== requestedPreferredAccountType,
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
    }, request);
    return response;
  } catch (error) {
    if (isOrdinaryAccountPrincipalError(error)) {
      const response = noStoreJson(
        { ok: false, error: error.code },
        { status: error.status },
      );
      if (error.status === 403) {
        if (error.code === "ordinary_account_merchant_selection_forbidden") {
          clearMerchantAuthMerchantIdCookie(response, request);
        } else {
          clearMerchantAuthCookies(response, request);
        }
      }
      return response;
    }
    return noStoreJson({ ok: false, error: "merchant_session_sync_unavailable" }, { status: 503 });
  }
}
