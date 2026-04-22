import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  type MerchantAuthUserSummary,
  normalizeMerchantEmail,
} from "@/lib/merchantAuthIdentity";
import { setMerchantAuthCookies } from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import {
  isPersonalAccountNumericId,
  readPlatformAccountIdFromMetadata,
  readPlatformAccountTypeFromMetadata,
  readPlatformUsernameFromMetadata,
  type PlatformAccountType,
} from "@/lib/platformAccounts";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AuthMetadata = Record<string, unknown> | null | undefined;

type ResolvedAccountIdentity = {
  email: string;
  accountType: PlatformAccountType | "";
  accountId: string;
  merchantId: string;
};

type PasswordGrantPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user?: unknown;
  msg?: unknown;
  message?: unknown;
  error?: unknown;
  error_code?: unknown;
  error_description?: unknown;
} | null;

type AdminListUsersClient = PlatformIdentitySupabaseClient & {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        limit: (count: number) => PromiseLike<{
          data: Record<string, string | null | undefined>[] | null;
          error: Error | null;
        }> & {
          maybeSingle: () => Promise<{
            data: Record<string, string | null | undefined> | null;
            error: Error | null;
          }>;
        };
      };
    };
    insert: (values: Record<string, unknown>) => Promise<{ error: Error | null }>;
  };
};

const AUTH_USERS_CACHE_TTL_MS = 60_000;
const ACCOUNT_IDENTITY_CACHE_TTL_MS = 60_000;
let authUsersCache:
  | {
      expiresAt: number;
      users: MerchantAuthUserSummary[];
    }
  | null = null;
const accountIdentityCache = new Map<string, { expiresAt: number; identity: ResolvedAccountIdentity }>();

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function normalizeAccountValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isEightDigitAccountId(value: string | null | undefined) {
  return /^\d{8}$/.test(String(value ?? "").trim());
}

function buildManualUserEmail(accountType: PlatformAccountType, accountId: string) {
  return `${accountType === "personal" ? "personal" : "merchant"}-${accountId}@manual.merchant-space.invalid`;
}

function isTransientBackendLookupError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (code === "PGRST002") return true;
  if (Number(record.status) === 503) return true;
  return /schema cache|retrying|temporarily|timeout|connection|database error finding users/i.test(message);
}

function isTransientAuthPasswordError(status: number, payload: unknown) {
  if (status >= 500 || status === 429) return true;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as { msg?: unknown; message?: unknown; error?: unknown; error_code?: unknown };
  const text = [record.msg, record.message, record.error, record.error_code]
    .map((value) => (typeof value === "string" ? value : ""))
    .join(" ");
  return /unexpected_failure|database error|querying schema|temporarily|timeout|connection/i.test(text);
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runBackendLookupWithRetry<T extends { error?: unknown }>(task: () => PromiseLike<T>, attempts = 3) {
  let result = await task();
  for (let attempt = 1; attempt < attempts && result.error && isTransientBackendLookupError(result.error); attempt += 1) {
    await wait(300 * attempt);
    result = await task();
  }
  return result;
}

function buildManualIdentityFallback(account: string): ResolvedAccountIdentity {
  const accountId = normalizeAccountValue(account);
  if (!isEightDigitAccountId(accountId)) {
    return { email: "", accountType: "", accountId: "", merchantId: "" };
  }
  const accountType: PlatformAccountType = isPersonalAccountNumericId(accountId) ? "personal" : "merchant";
  return {
    email: buildManualUserEmail(accountType, accountId),
    accountType,
    accountId,
    merchantId: accountType === "merchant" ? accountId : "",
  };
}

function readMetadataString(metadata: AuthMetadata, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
}

function readAccountKeys(user: MerchantAuthUserSummary) {
  const username = readPlatformUsernameFromMetadata(user);
  const loginId =
    readMetadataString(
      user.user_metadata,
      "login_id",
      "loginId",
      "account_id",
      "accountId",
      "personal_id",
      "personalId",
      "merchant_id",
      "merchantId",
      "merchantID",
    ) ||
    readMetadataString(
      user.app_metadata,
      "login_id",
      "loginId",
      "account_id",
      "accountId",
      "personal_id",
      "personalId",
      "merchant_id",
      "merchantId",
      "merchantID",
    );
  const accountId = readPlatformAccountIdFromMetadata(user);
  const merchantId =
    readMetadataString(user.user_metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId") ||
    readMetadataString(user.app_metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId");

  return [username, loginId, accountId, merchantId].map(normalizeAccountValue).filter(Boolean);
}

function createServerSupabaseClient(): AdminListUsersClient | null {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as AdminListUsersClient;
}

async function listAuthUsers(supabase: AdminListUsersClient) {
  if (authUsersCache && authUsersCache.expiresAt > Date.now()) {
    return authUsersCache.users;
  }
  const users: MerchantAuthUserSummary[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await runBackendLookupWithRetry(() => supabase.auth.admin.listUsers({ page, perPage: 200 }));
    if (error) throw error;
    const chunk = (data?.users ?? []).map((user) => ({
      email: user.email,
      user_metadata: user.user_metadata ?? null,
      app_metadata: user.app_metadata ?? null,
    }));
    users.push(...chunk);
    if (chunk.length < 200) break;
    page += 1;
  }
  authUsersCache = {
    expiresAt: Date.now() + AUTH_USERS_CACHE_TTL_MS,
    users,
  };
  return users;
}

function readCachedAccountIdentity(account: string): ResolvedAccountIdentity | null {
  const cacheKey = normalizeAccountValue(account);
  if (!cacheKey) return null;
  const cached = accountIdentityCache.get(cacheKey) ?? null;
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    accountIdentityCache.delete(cacheKey);
    return null;
  }
  return cached.identity;
}

function writeCachedAccountIdentity(account: string, identity: ResolvedAccountIdentity) {
  const cacheKey = normalizeAccountValue(account);
  if (!cacheKey || !identity.email) return;
  accountIdentityCache.set(cacheKey, {
    expiresAt: Date.now() + ACCOUNT_IDENTITY_CACHE_TTL_MS,
    identity,
  });
}

async function resolveAccountIdentity(supabase: AdminListUsersClient, account: string): Promise<ResolvedAccountIdentity> {
  const cached = readCachedAccountIdentity(account);
  if (cached) return cached;
  const normalizedAccount = normalizeAccountValue(account);
  if (!normalizedAccount) {
    return { email: "", accountType: "", accountId: "", merchantId: "" };
  }
  if (normalizedAccount.includes("@")) {
    const identity: ResolvedAccountIdentity = {
      email: normalizedAccount,
      accountType: "",
      accountId: "",
      merchantId: "",
    };
    writeCachedAccountIdentity(account, identity);
    return identity;
  }

  if (isMerchantNumericId(normalizedAccount)) {
    const { data: merchantRows, error } = await runBackendLookupWithRetry(() =>
      supabase
        .from("merchants")
        .select("id,name,email,owner_email,contact_email,user_email")
        .eq("id", normalizedAccount)
        .limit(1),
    );
    if (error) {
      const fallbackIdentity = buildManualIdentityFallback(normalizedAccount);
      if (fallbackIdentity.email && isTransientBackendLookupError(error)) {
        writeCachedAccountIdentity(account, fallbackIdentity);
        return fallbackIdentity;
      }
      throw error;
    }
    const merchant = Array.isArray(merchantRows) ? merchantRows[0] ?? null : null;
    const email = normalizeMerchantEmail(
      merchant?.user_email,
      merchant?.email,
      merchant?.owner_email,
      merchant?.contact_email,
    );
    if (email) {
      const identity: ResolvedAccountIdentity = {
        email,
        accountType: "merchant" as const,
        accountId: normalizedAccount,
        merchantId: normalizedAccount,
      };
      writeCachedAccountIdentity(account, identity);
      return identity;
    }
  }

  for (const merchantName of [account.trim(), normalizedAccount]) {
    if (!merchantName) continue;
    const { data: merchantRowsByName, error } = await runBackendLookupWithRetry(() =>
      supabase
        .from("merchants")
        .select("id,name,email,owner_email,contact_email,user_email")
        .eq("name", merchantName)
        .limit(1),
    );
    if (error) throw error;
    const merchantByName = Array.isArray(merchantRowsByName) ? merchantRowsByName[0] ?? null : null;
    const email = normalizeMerchantEmail(
      merchantByName?.user_email,
      merchantByName?.email,
      merchantByName?.owner_email,
      merchantByName?.contact_email,
    );
    if (email) {
      const identity: ResolvedAccountIdentity = {
        email,
        accountType: "merchant" as const,
        accountId: isMerchantNumericId(String(merchantByName?.id ?? "").trim()) ? String(merchantByName?.id ?? "").trim() : "",
        merchantId: isMerchantNumericId(String(merchantByName?.id ?? "").trim()) ? String(merchantByName?.id ?? "").trim() : "",
      };
      writeCachedAccountIdentity(account, identity);
      return identity;
    }
  }

  let authUsers: MerchantAuthUserSummary[] = [];
  try {
    authUsers = await listAuthUsers(supabase);
  } catch (error) {
    const fallbackIdentity = buildManualIdentityFallback(normalizedAccount);
    if (fallbackIdentity.email && isTransientBackendLookupError(error)) {
      writeCachedAccountIdentity(account, fallbackIdentity);
      return fallbackIdentity;
    }
    throw error;
  }
  const matchedUser = authUsers.find((user) => readAccountKeys(user).includes(normalizedAccount));
  const accountId = readPlatformAccountIdFromMetadata(matchedUser);
  const metadataAccountType = readPlatformAccountTypeFromMetadata(matchedUser, "");
  const identity: ResolvedAccountIdentity = {
    email: normalizeMerchantEmail(matchedUser?.email),
    accountType:
      metadataAccountType || (isPersonalAccountNumericId(accountId) ? "personal" : accountId ? "merchant" : ""),
    accountId,
    merchantId: metadataAccountType === "merchant" || (!metadataAccountType && accountId && !isPersonalAccountNumericId(accountId)) ? accountId : "",
  };
  writeCachedAccountIdentity(account, identity);
  return identity;
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const payload = (await request.json().catch(() => null)) as { account?: unknown; password?: unknown } | null;
    const account = typeof payload?.account === "string" ? payload.account.trim() : "";
    const password = typeof payload?.password === "string" ? payload.password : "";

    if (!account) {
      return NextResponse.json({ error: "invalid_account" }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ error: "invalid_password" }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!supabase || !supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "merchant_login_env_missing" }, { status: 503 });
    }

    const resolvedAccount = await resolveAccountIdentity(supabase, account);
    const email = resolvedAccount.email;
    if (!email) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }

    let upstreamResponse: Response | null = null;
    let upstreamPayload: PasswordGrantPayload = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      upstreamResponse = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
        cache: "no-store",
      });
      upstreamPayload = (await upstreamResponse.json().catch(() => null)) as PasswordGrantPayload;
      if (!isTransientAuthPasswordError(upstreamResponse.status, upstreamPayload) || attempt >= 3) {
        break;
      }
      await wait(300 * attempt);
    }

    if (!upstreamResponse) {
      return NextResponse.json({ error: "merchant_login_failed", message: "auth_request_not_started" }, { status: 503 });
    }

    if (!upstreamResponse.ok) {
      const errorCode = String(upstreamPayload?.error_code ?? "").trim().toLowerCase();
      const message =
        (typeof upstreamPayload?.msg === "string" && upstreamPayload.msg) ||
        (typeof upstreamPayload?.message === "string" && upstreamPayload.message) ||
        (typeof upstreamPayload?.error_description === "string" && upstreamPayload.error_description) ||
        (typeof upstreamPayload?.error === "string" && upstreamPayload.error) ||
        "merchant_login_failed";

      if (errorCode === "invalid_credentials" || /invalid login credentials/i.test(message)) {
        return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
      }
      if (/email not confirmed/i.test(message)) {
        return NextResponse.json({ error: "email_not_confirmed" }, { status: 403 });
      }
      return NextResponse.json({ error: "merchant_login_failed", message }, { status: 503 });
    }

    const accessToken = typeof upstreamPayload?.access_token === "string" ? upstreamPayload.access_token.trim() : "";
    const refreshToken = typeof upstreamPayload?.refresh_token === "string" ? upstreamPayload.refresh_token.trim() : "";
    if (!accessToken || !refreshToken) {
      return NextResponse.json({ error: "merchant_login_failed", message: "session_tokens_missing" }, { status: 503 });
    }

    const authUser =
      upstreamPayload?.user && typeof upstreamPayload.user === "object"
        ? (upstreamPayload.user as MerchantAuthUserSummary)
        : null;
    const platformIdentity = await resolvePlatformAccountIdentityForUser(supabase, authUser, {
      preferredAccountType: resolvedAccount.accountType || null,
      preferredAccountId: resolvedAccount.accountId || null,
      preferredMerchantId: resolvedAccount.merchantId,
      preferredEmail: email,
    });
    const merchantId = platformIdentity.merchantId ?? "";

    const response = NextResponse.json({
      email,
      accountType: platformIdentity.accountType,
      accountId: platformIdentity.accountId,
      merchantId: merchantId || null,
      merchantIds: platformIdentity.merchantIds,
      user: authUser,
    });
    setMerchantAuthCookies(response, {
      accessToken,
      refreshToken,
      maxAgeSeconds: upstreamPayload?.expires_in,
      merchantId,
    }, request);
    return response;
  } catch {
    return NextResponse.json({ error: "merchant_login_failed" }, { status: 503 });
  }
}
