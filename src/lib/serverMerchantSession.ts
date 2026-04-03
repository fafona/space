import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { readMerchantAuthCookie, readMerchantAuthRefreshCookie } from "@/lib/merchantAuthSession";

type AuthUserSummary = {
  id?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

type CachedMerchantSession = {
  merchantId: string;
  merchantEmail: string;
  merchantName: string;
};

type RefreshPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user?: unknown;
};

export type ResolvedMerchantSession = {
  merchantId: string;
  merchantEmail: string;
  merchantName: string;
};

const MERCHANT_SESSION_CACHE_TTL_MS = 20_000;
const merchantSessionCache = new Map<string, { expiresAt: number; session: CachedMerchantSession }>();

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized) return normalized;
  }
  return "";
}

function normalizeMerchantId(value: unknown) {
  const normalized = trimText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function readMetadataString(metadata: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
}

function readMerchantIdFromMetadata(user: AuthUserSummary | null) {
  const candidate =
    readMetadataString(user?.user_metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId") ||
    readMetadataString(user?.app_metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId");
  return /^\d{8}$/.test(candidate) ? candidate : "";
}

function buildCacheKey(accessToken: string, refreshToken: string) {
  return accessToken || refreshToken;
}

function readCachedSession(accessToken: string, refreshToken: string) {
  const cacheKey = buildCacheKey(accessToken, refreshToken);
  if (!cacheKey) return null;
  const cached = merchantSessionCache.get(cacheKey) ?? null;
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    merchantSessionCache.delete(cacheKey);
    return null;
  }
  return cached.session;
}

function writeCachedSession(accessToken: string, refreshToken: string, session: CachedMerchantSession) {
  const cacheKey = buildCacheKey(accessToken, refreshToken);
  if (!cacheKey) return;
  merchantSessionCache.set(cacheKey, {
    expiresAt: Date.now() + MERCHANT_SESSION_CACHE_TTL_MS,
    session,
  });
}

async function refreshMerchantSession(refreshToken: string) {
  const supabaseUrl = trimText(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = trimText(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
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
  }).catch(() => null);

  if (!response?.ok) return null;
  const payload = (await response.json().catch(() => null)) as RefreshPayload | null;
  const accessToken = trimText(payload?.access_token);
  const nextRefreshToken = trimText(payload?.refresh_token);
  if (!accessToken || !nextRefreshToken) return null;

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    user: payload?.user && typeof payload.user === "object" ? (payload.user as AuthUserSummary) : null,
  };
}

async function resolveMerchantIdForUser(user: AuthUserSummary | null) {
  if (!user) return "";
  const fromMetadata = readMerchantIdFromMetadata(user);
  if (fromMetadata) return fromMetadata;

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) return "";

  const candidates: string[] = [];
  const push = (value: unknown) => {
    const normalized = normalizeMerchantId(value);
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  const userId = trimText(user.id);
  const email = normalizeEmail(user.email);
  const lookupTasks: Array<PromiseLike<{ data?: unknown; error?: { message?: string } | null }>> = [];

  if (userId) {
    [
      "user_id",
      "auth_user_id",
      "owner_user_id",
      "owner_id",
      "auth_id",
      "created_by",
      "created_by_user_id",
    ].forEach((column) => {
      lookupTasks.push(supabase.from("merchants").select("id").eq(column, userId).limit(1).maybeSingle());
    });
  }

  if (email) {
    ["email", "owner_email", "contact_email", "user_email"].forEach((column) => {
      lookupTasks.push(supabase.from("merchants").select("id").eq(column, email).limit(1).maybeSingle());
    });
  }

  const settled = await Promise.allSettled(lookupTasks);
  settled.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.error) return;
    const record = (result.value.data ?? null) as { id?: unknown } | null;
    push(record?.id);
  });

  return candidates[0] ?? "";
}

export async function resolveMerchantSessionFromRequest(request: Request): Promise<ResolvedMerchantSession | null> {
  const hintedSiteId = trimText(request.headers.get("x-merchant-site-id"));
  const hintedEmail = normalizeEmail(request.headers.get("x-merchant-email"));
  const hintedName = trimText(request.headers.get("x-merchant-name"));
  const hintedMerchantId = normalizeMerchantId(hintedSiteId);
  const accessToken = trimText(request.headers.get("x-merchant-access-token")) || readMerchantAuthCookie(request);
  const refreshToken = trimText(request.headers.get("x-merchant-refresh-token")) || readMerchantAuthRefreshCookie(request);
  const fallbackMerchantId = hintedSiteId || hintedEmail || hintedName;

  const cached = readCachedSession(accessToken, refreshToken);
  if (cached) {
    return {
      merchantId: cached.merchantId,
      merchantEmail: cached.merchantEmail || hintedEmail,
      merchantName: cached.merchantName || hintedName,
    };
  }

  const authSupabase = createServerSupabaseAuthClient();
  let user: AuthUserSummary | null = null;
  let validatedAccessToken = accessToken;
  let validatedRefreshToken = refreshToken;

  if (authSupabase && validatedAccessToken) {
    const { data, error } = await authSupabase.auth.getUser(validatedAccessToken).catch(() => ({ data: null, error: true }));
    if (!error && data?.user) {
      user = data.user as AuthUserSummary;
    }
  }

  if (!user && authSupabase && validatedRefreshToken) {
    const refreshed = await refreshMerchantSession(validatedRefreshToken);
    if (refreshed) {
      validatedAccessToken = refreshed.accessToken;
      validatedRefreshToken = refreshed.refreshToken;
      user = refreshed.user;
      if (!user) {
        const { data, error } = await authSupabase.auth.getUser(validatedAccessToken).catch(() => ({ data: null, error: true }));
        if (!error && data?.user) {
          user = data.user as AuthUserSummary;
        }
      }
    }
  }

  if (!user) {
    if (!fallbackMerchantId) return null;
    return {
      merchantId: fallbackMerchantId,
      merchantEmail: hintedEmail,
      merchantName: hintedName,
    };
  }

  const merchantId =
    hintedMerchantId ||
    (await resolveMerchantIdForUser(user)) ||
    normalizeMerchantId(user.email) ||
    fallbackMerchantId;
  if (!merchantId) return null;

  const resolved = {
    merchantId,
    merchantEmail: normalizeEmail(user.email, hintedEmail),
    merchantName: hintedName,
  } satisfies CachedMerchantSession;
  writeCachedSession(validatedAccessToken, validatedRefreshToken, resolved);
  return resolved;
}
