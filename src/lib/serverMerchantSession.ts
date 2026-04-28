import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  readMerchantAuthCookie,
  readMerchantRequestAccessTokens,
} from "@/lib/merchantAuthSession";

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

type MerchantSessionHintInput = {
  hintedMerchantId?: string | null;
  hintedMerchantEmail?: string | null;
  hintedMerchantName?: string | null;
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

function buildCacheKey(accessToken: string, hintedMerchantId: string) {
  if (!accessToken) return "";
  return `${accessToken}::${hintedMerchantId || "default"}`;
}

function readCachedSession(accessToken: string, hintedMerchantId: string) {
  const cacheKey = buildCacheKey(accessToken, hintedMerchantId);
  if (!cacheKey) return null;
  const cached = merchantSessionCache.get(cacheKey) ?? null;
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    merchantSessionCache.delete(cacheKey);
    return null;
  }
  return cached.session;
}

function writeCachedSession(
  accessToken: string,
  hintedMerchantId: string,
  session: CachedMerchantSession,
) {
  const cacheKey = buildCacheKey(accessToken, hintedMerchantId);
  if (!cacheKey) return;
  merchantSessionCache.set(cacheKey, {
    expiresAt: Date.now() + MERCHANT_SESSION_CACHE_TTL_MS,
    session,
  });
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

async function listAuthorizedMerchantIdsForUser(user: AuthUserSummary | null) {
  if (!user) return [];

  const merchantIds: string[] = [];
  const push = (value: unknown) => {
    const normalized = normalizeMerchantId(value);
    if (!normalized || merchantIds.includes(normalized)) return;
    merchantIds.push(normalized);
  };

  push(readMerchantIdFromMetadata(user));

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) return merchantIds;

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
      lookupTasks.push(supabase.from("merchants").select("id").eq(column, userId).limit(20));
    });
  }

  if (email) {
    ["email", "owner_email", "contact_email", "user_email"].forEach((column) => {
      lookupTasks.push(supabase.from("merchants").select("id").eq(column, email).limit(20));
    });
  }

  const settled = await Promise.allSettled(lookupTasks);
  settled.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.error) return;
    const rows = Array.isArray(result.value.data) ? result.value.data : [];
    rows.forEach((row) => {
      push((row as { id?: unknown } | null)?.id);
    });
  });

  return merchantIds;
}

function readMerchantSessionHints(request: Request, hintInput?: MerchantSessionHintInput) {
  const requestUrl = new URL(request.url);
  const hintedSiteId =
    trimText(hintInput?.hintedMerchantId) ||
    trimText(request.headers.get("x-merchant-site-id")) ||
    trimText(requestUrl.searchParams.get("siteId"));
  const hintedEmail =
    normalizeEmail(hintInput?.hintedMerchantEmail) ||
    normalizeEmail(request.headers.get("x-merchant-email")) ||
    normalizeEmail(requestUrl.searchParams.get("merchantEmail"));
  const hintedName =
    trimText(hintInput?.hintedMerchantName) ||
    trimText(request.headers.get("x-merchant-name")) ||
    trimText(requestUrl.searchParams.get("merchantName"));

  return {
    hintedMerchantId: normalizeMerchantId(hintedSiteId),
    hintedEmail,
    hintedName,
  };
}

export async function resolveMerchantSessionFromRequest(
  request: Request,
  hintInput?: MerchantSessionHintInput,
): Promise<ResolvedMerchantSession | null> {
  const { hintedMerchantId, hintedEmail, hintedName } = readMerchantSessionHints(request, hintInput);
  const accessTokens = readMerchantRequestAccessTokens(request);
  const accessToken = accessTokens[0] ?? readMerchantAuthCookie(request);

  const cached = readCachedSession(accessToken, hintedMerchantId);
  if (cached) {
    return {
      merchantId: cached.merchantId,
      merchantEmail: cached.merchantEmail || hintedEmail,
      merchantName: hintedName || cached.merchantName,
    };
  }

  const authSupabase = createServerSupabaseAuthClient();
  let user: AuthUserSummary | null = null;
  let validatedAccessToken = accessToken;

  if (authSupabase) {
    const candidates = [...accessTokens, accessToken].map((value) => trimText(value)).filter(Boolean);
    for (const candidateAccessToken of candidates) {
      const { data, error } = await authSupabase.auth
        .getUser(candidateAccessToken)
        .catch(() => ({ data: null, error: true }));
      if (!error && data?.user) {
        validatedAccessToken = candidateAccessToken;
        user = data.user as AuthUserSummary;
        break;
      }
    }
  }

  if (!user) {
    return null;
  }

  const authorizedMerchantIds = await listAuthorizedMerchantIdsForUser(user);
  const merchantId =
    (hintedMerchantId && authorizedMerchantIds.includes(hintedMerchantId) ? hintedMerchantId : "") ||
    authorizedMerchantIds[0] ||
    (await resolveMerchantIdForUser(user)) ||
    normalizeMerchantId(user.email);
  if (!merchantId) return null;

  const resolved = {
    merchantId,
    merchantEmail: normalizeEmail(user.email, hintedEmail),
    merchantName: hintedName,
  } satisfies CachedMerchantSession;
  writeCachedSession(validatedAccessToken, hintedMerchantId, resolved);
  return resolved;
}
