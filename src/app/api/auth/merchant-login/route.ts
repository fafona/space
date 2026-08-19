import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isValidAuthAccount,
  isValidAuthPassword,
  normalizeAuthAccount,
  readAuthPassword,
} from "@/lib/authCredentialValidation";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  type MerchantAuthUserSummary,
} from "@/lib/merchantAuthIdentity";
import { loadOrdinaryAccountAuthorization } from "@/lib/ordinaryAccountAuthorization.server";
import {
  clearMerchantAuthCookies,
  setMerchantAuthCookies,
} from "@/lib/merchantAuthSession";
import { isOrdinaryAccountPrincipalError } from "@/lib/ordinaryAccountPrincipal.server";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { type PlatformAccountType } from "@/lib/platformAccounts";
import { normalizeCanonicalPersonalAccountId } from "@/lib/personalAccountId";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  auth: PlatformIdentitySupabaseClient["auth"] & {
    admin: PlatformIdentitySupabaseClient["auth"]["admin"] & {
      getUserById: (userId: string) => Promise<{
        data: { user: MerchantAuthUserSummary | null } | null;
        error: Error | null;
      }>;
    };
  };
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
  };
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function normalizeAccountValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeRequestedAccountType(value: unknown): PlatformAccountType | null {
  if (value === "personal") return "personal";
  if (value === "merchant") return "merchant";
  return null;
}

function buildAutoSwitchedEntryMessage(actualAccountType: PlatformAccountType) {
  return actualAccountType === "personal"
    ? "您是个人用户，已帮您切换入口进行登录。"
    : "您是商户，已帮您切换入口进行登录。";
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
  if (status === 429) return false;
  if (status >= 500) return true;
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

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function runBackendLookupWithRetry<T extends { error?: unknown }>(task: () => PromiseLike<T>, attempts = 3) {
  let result = await task();
  for (let attempt = 1; attempt < attempts && result.error && isTransientBackendLookupError(result.error); attempt += 1) {
    await wait(300 * attempt);
    result = await task();
  }
  return result;
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

const AUTH_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MERCHANT_AUTH_UUID_COLUMNS = [
  "user_id",
  "auth_user_id",
  "owner_user_id",
  "owner_id",
  "auth_id",
  "created_by",
  "created_by_user_id",
] as const;

function readConsistentMerchantAuthUserId(
  row: Record<string, string | null | undefined> | null,
) {
  if (!row) return "";
  const values = new Set(
    MERCHANT_AUTH_UUID_COLUMNS.map((column) =>
      String(row[column] ?? "").trim().toLowerCase(),
    ).filter(Boolean),
  );
  if (values.size !== 1) return "";
  const [authUserId] = values;
  return AUTH_UUID_PATTERN.test(authUserId) ? authUserId : "";
}

async function loadResolvedLoginCandidate(
  supabase: AdminListUsersClient,
  authUserId: string,
  accountType: PlatformAccountType,
  accountId: string,
): Promise<ResolvedAccountIdentity | null> {
  if (!AUTH_UUID_PATTERN.test(authUserId)) {
    throw new Error("ordinary_account_binding_conflict");
  }
  const [authUserResult, authorization] = await Promise.all([
    supabase.auth.admin.getUserById(authUserId),
    loadOrdinaryAccountAuthorization(supabase, authUserId),
  ]);
  if (authUserResult.error) throw authUserResult.error;
  const user = authUserResult.data?.user ?? null;
  const exactBinding =
    authorization.status === "resolved" &&
    authorization.accountType === accountType &&
    (authorization.accountType === "merchant"
      ? authorization.merchantIds.includes(accountId)
      : authorization.personalAccountId === accountId);
  if (!user || String(user.id ?? "").trim() !== authUserId || !exactBinding) {
    throw new Error("ordinary_account_binding_conflict");
  }
  const email = String(user.email ?? "").trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    accountType,
    accountId,
    merchantId: accountType === "merchant" ? accountId : "",
  };
}

async function resolveMerchantLoginCandidate(
  supabase: AdminListUsersClient,
  column: "id" | "name",
  value: string,
) {
  const { data, error } = await runBackendLookupWithRetry(() =>
    supabase
      .from("merchants")
      .select(`id,${MERCHANT_AUTH_UUID_COLUMNS.join(",")}`)
      .eq(column, value)
      .limit(column === "id" ? 1 : 2),
  );
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1) return null;
  const accountId = String(rows[0]?.id ?? "").trim();
  if (!isMerchantNumericId(accountId)) return null;
  const authUserId = readConsistentMerchantAuthUserId(rows[0]);
  if (!authUserId) throw new Error("ordinary_account_binding_conflict");
  return loadResolvedLoginCandidate(
    supabase,
    authUserId,
    "merchant",
    accountId,
  );
}

async function resolvePersonalLoginCandidate(
  supabase: AdminListUsersClient,
  accountId: string,
) {
  const normalizedAccountId = normalizeCanonicalPersonalAccountId(accountId);
  if (!normalizedAccountId) return null;
  const { data, error } = await runBackendLookupWithRetry(() =>
    supabase
      .from("faolla_personal_accounts")
      .select("auth_user_id,personal_account_id,status")
      .eq("personal_account_id", normalizedAccountId)
      .limit(1),
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] ?? null : null;
  if (!row || row.status !== "active") return null;
  const authUserId = String(row.auth_user_id ?? "").trim().toLowerCase();
  return loadResolvedLoginCandidate(
    supabase,
    authUserId,
    "personal",
    normalizedAccountId,
  );
}

async function resolveAccountIdentity(
  supabase: AdminListUsersClient,
  account: string,
  preferredAccountType: PlatformAccountType | null = null,
): Promise<ResolvedAccountIdentity> {
  const normalizedAccount = normalizeAccountValue(account);
  const empty = { email: "", accountType: "", accountId: "", merchantId: "" } as const;
  if (!normalizedAccount || normalizedAccount === "site-main") return empty;
  if (normalizedAccount.includes("@")) {
    return { ...empty, email: normalizedAccount };
  }

  if (/^\d{8}$/.test(normalizedAccount)) {
    const [merchant, personal] = await Promise.all([
      preferredAccountType === "personal"
        ? Promise.resolve(null)
        : resolveMerchantLoginCandidate(supabase, "id", normalizedAccount),
      preferredAccountType === "merchant"
        ? Promise.resolve(null)
        : resolvePersonalLoginCandidate(supabase, normalizedAccount),
    ]);
    if (merchant && personal) {
      throw new Error("ordinary_account_identifier_collision");
    }
    return merchant ?? personal ?? empty;
  }

  if (preferredAccountType !== "personal") {
    return (
      (await resolveMerchantLoginCandidate(
        supabase,
        "name",
        account.trim(),
      )) ?? empty
    );
  }
  return empty;
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const payload = (await request.json().catch(() => null)) as
      | { account?: unknown; password?: unknown; preferredAccountType?: unknown }
      | null;
    const account = normalizeAuthAccount(payload?.account);
    const password = readAuthPassword(payload?.password);
    const requestedAccountType = normalizeRequestedAccountType(payload?.preferredAccountType);

    if (!isValidAuthAccount(account)) {
      return noStoreJson({ error: "invalid_account" }, { status: 400 });
    }
    if (!isValidAuthPassword(password)) {
      return noStoreJson({ error: "invalid_password" }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!supabase || !supabaseUrl || !anonKey) {
      return noStoreJson({ error: "merchant_login_env_missing" }, { status: 503 });
    }

    const resolvedAccount = await resolveAccountIdentity(supabase, account, requestedAccountType);
    const email = resolvedAccount.email;
    if (!email) {
      return noStoreJson({ error: "invalid_credentials" }, { status: 401 });
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
      return noStoreJson({ error: "merchant_login_failed" }, { status: 503 });
    }

    if (!upstreamResponse.ok) {
      const errorCode = String(upstreamPayload?.error_code ?? "").trim().toLowerCase();
      const message =
        (typeof upstreamPayload?.msg === "string" && upstreamPayload.msg) ||
        (typeof upstreamPayload?.message === "string" && upstreamPayload.message) ||
        (typeof upstreamPayload?.error_description === "string" && upstreamPayload.error_description) ||
        (typeof upstreamPayload?.error === "string" && upstreamPayload.error) ||
        "merchant_login_failed";

      if (upstreamResponse.status === 429) {
        const response = noStoreJson({ error: "auth_rate_limited" }, { status: 429 });
        const retryAfter = upstreamResponse.headers.get("retry-after")?.trim();
        if (retryAfter) response.headers.set("retry-after", retryAfter);
        return response;
      }
      if (errorCode === "invalid_credentials" || /invalid login credentials/i.test(message)) {
        return noStoreJson({ error: "invalid_credentials" }, { status: 401 });
      }
      if (errorCode === "email_not_confirmed" || /email not confirmed/i.test(message)) {
        return noStoreJson({ error: "email_not_confirmed" }, { status: 403 });
      }
      return noStoreJson({ error: "merchant_login_failed" }, { status: 503 });
    }

    const accessToken = typeof upstreamPayload?.access_token === "string" ? upstreamPayload.access_token.trim() : "";
    const refreshToken = typeof upstreamPayload?.refresh_token === "string" ? upstreamPayload.refresh_token.trim() : "";
    if (!accessToken || !refreshToken) {
      return noStoreJson({ error: "merchant_login_failed" }, { status: 503 });
    }

    const authUser =
      upstreamPayload?.user && typeof upstreamPayload.user === "object"
        ? (upstreamPayload.user as MerchantAuthUserSummary)
        : null;
    const platformIdentity = await resolvePlatformAccountIdentityForUser(supabase, authUser, {
      preferredAccountType: requestedAccountType || resolvedAccount.accountType || null,
      preferredAccountId: resolvedAccount.accountId || null,
      preferredMerchantId: resolvedAccount.merchantId,
      preferredEmail: email,
    });
    const entrySwitched = Boolean(requestedAccountType && platformIdentity.accountType !== requestedAccountType);
    const merchantId = platformIdentity.merchantId ?? "";

    const response = NextResponse.json({
      email,
      accountType: platformIdentity.accountType,
      accountId: platformIdentity.accountId,
      merchantId: merchantId || null,
      merchantIds: platformIdentity.merchantIds,
      requestedAccountType: requestedAccountType || null,
      entrySwitched,
      message: entrySwitched ? buildAutoSwitchedEntryMessage(platformIdentity.accountType) : undefined,
      user: authUser,
    });
    response.headers.set("cache-control", "no-store");
    setMerchantAuthCookies(response, {
      accessToken,
      refreshToken,
      maxAgeSeconds: upstreamPayload?.expires_in,
      merchantId,
      accountType: platformIdentity.accountType,
    }, request);
    return response;
  } catch (error) {
    if (isOrdinaryAccountPrincipalError(error)) {
      const response = noStoreJson(
        { error: error.code },
        { status: error.status },
      );
      if (error.status === 403) clearMerchantAuthCookies(response, request);
      return response;
    }
    return noStoreJson({ error: "merchant_login_failed" }, { status: 503 });
  }
}
