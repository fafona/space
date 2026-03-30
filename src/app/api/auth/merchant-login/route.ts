import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { loadMerchantIdRulesFromStore } from "@/lib/merchantIdRuleStore";
import { findNextAllowedMerchantIdNumber, MERCHANT_ID_MAX, MERCHANT_ID_MIN, type MerchantIdRule } from "@/lib/merchantIdRules";
import { setMerchantAuthCookies } from "@/lib/merchantAuthSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AuthMetadata = Record<string, unknown> | null | undefined;

type AuthUserSummary = {
  id?: string | null;
  email?: string | null;
  user_metadata?: AuthMetadata;
  app_metadata?: AuthMetadata;
};

type AdminListUsersClient = {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: AuthUserSummary[] } | null;
        error: Error | null;
      }>;
    };
  };
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        limit: (count: number) => {
          maybeSingle: () => Promise<{
            data: Record<string, string | null | undefined> | null;
            error: Error | null;
          }>;
        };
      };
    };
  };
};

const AUTH_USERS_CACHE_TTL_MS = 60_000;
let authUsersCache:
  | {
      expiresAt: number;
      users: AuthUserSummary[];
    }
  | null = null;

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function normalizeEmail(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized) return normalized;
  }
  return "";
}

function normalizeAccountValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (typeof record.code === "string" && record.code === "23505") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return /duplicate key|already exists|unique constraint/i.test(message);
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

function readAccountKeys(user: AuthUserSummary) {
  const username =
    readMetadataString(user.user_metadata, "username", "display_name", "name") ||
    readMetadataString(user.app_metadata, "username", "display_name", "name");
  const loginId =
    readMetadataString(user.user_metadata, "login_id", "loginId", "merchant_id", "merchantId", "merchantID") ||
    readMetadataString(user.app_metadata, "login_id", "loginId", "merchant_id", "merchantId", "merchantID");
  const merchantId =
    readMetadataString(user.user_metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId") ||
    readMetadataString(user.app_metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId");

  return [username, loginId, merchantId].map(normalizeAccountValue).filter(Boolean);
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
  const users: AuthUserSummary[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
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

async function resolveAccountEmail(supabase: AdminListUsersClient, account: string) {
  const normalizedAccount = normalizeAccountValue(account);
  if (!normalizedAccount) return "";
  if (normalizedAccount.includes("@")) return normalizedAccount;

  if (isMerchantNumericId(normalizedAccount)) {
    const { data: merchant, error } = await supabase
      .from("merchants")
      .select("id,name,email,owner_email,contact_email,user_email")
      .eq("id", normalizedAccount)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const email = normalizeEmail(
      merchant?.user_email,
      merchant?.email,
      merchant?.owner_email,
      merchant?.contact_email,
    );
    if (email) return email;
  }

  for (const merchantName of [account.trim(), normalizedAccount]) {
    if (!merchantName) continue;
    const { data: merchantByName, error } = await supabase
      .from("merchants")
      .select("id,name,email,owner_email,contact_email,user_email")
      .eq("name", merchantName)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const email = normalizeEmail(
      merchantByName?.user_email,
      merchantByName?.email,
      merchantByName?.owner_email,
      merchantByName?.contact_email,
    );
    if (email) return email;
  }

  const authUsers = await listAuthUsers(supabase);
  const matchedUser = authUsers.find((user) => readAccountKeys(user).includes(normalizedAccount));
  return normalizeEmail(matchedUser?.email);
}

function readMerchantIdFromMetadata(...metadatas: AuthMetadata[]) {
  for (const metadata of metadatas) {
    const candidate = readMetadataString(metadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId");
    if (isMerchantNumericId(candidate)) return candidate;
  }
  return "";
}

async function resolveMerchantId(
  supabase: AdminListUsersClient,
  account: string,
  email: string,
  user?: AuthUserSummary | null,
) {
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || !isMerchantNumericId(normalized) || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  push(isMerchantNumericId(account) ? account : "");
  push(readMerchantIdFromMetadata(user?.user_metadata, user?.app_metadata));
  if (candidates[0]) {
    return candidates[0];
  }

  const userId = String(user?.id ?? "").trim();
  const lookupTasks: Array<Promise<{
    data: Record<string, string | null | undefined> | null;
    error: Error | null;
  }>> = [];

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
    push(result.value.data?.id);
  });

  return candidates[0] ?? "";
}

async function readBlockedMerchantIdRules(supabase: AdminListUsersClient): Promise<MerchantIdRule[]> {
  try {
    const { rules } = await loadMerchantIdRulesFromStore(supabase);
    return rules;
  } catch {
    return [];
  }
}

async function tryAllocateSequentialMerchantId(
  supabase: AdminListUsersClient,
  user: AuthUserSummary | null,
  email: string,
): Promise<string> {
  const userId = String(user?.id ?? "").trim();
  if (!userId) return "";
  const blockedRules = await readBlockedMerchantIdRules(supabase);
  let candidate = MERCHANT_ID_MIN;
  while (candidate <= MERCHANT_ID_MAX) {
    const nextAllowed = findNextAllowedMerchantIdNumber(candidate, blockedRules);
    if (!nextAllowed) return "";
    candidate = nextAllowed;
    const candidateId = String(candidate);
    const { error } = await (supabase as unknown as {
      from: (table: string) => {
        insert: (values: Record<string, unknown>) => Promise<{ error: Error | null }>;
      };
    })
      .from("merchants")
      .insert({
        id: candidateId,
        name: "",
        email: email || null,
        owner_email: email || null,
        contact_email: email || null,
        user_email: email || null,
        user_id: userId,
        auth_user_id: userId,
        owner_user_id: userId,
        owner_id: userId,
        auth_id: userId,
        created_by: userId,
        created_by_user_id: userId,
      });
    if (!error) return candidateId;
    if (!isDuplicateKeyError(error)) return "";
    candidate += 1;
  }
  return "";
}

export async function POST(request: Request) {
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

    const email = await resolveAccountEmail(supabase, account);
    if (!email) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }

    const upstreamResponse = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`, {
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

    const upstreamPayload = (await upstreamResponse.json().catch(() => null)) as
      | {
          access_token?: unknown;
          refresh_token?: unknown;
          expires_in?: unknown;
          user?: unknown;
          msg?: unknown;
          message?: unknown;
          error?: unknown;
          error_code?: unknown;
          error_description?: unknown;
        }
      | null;

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
        ? (upstreamPayload.user as AuthUserSummary)
        : null;
    let merchantId = await resolveMerchantId(supabase, account, email, authUser);
    if (!merchantId) {
      merchantId = await tryAllocateSequentialMerchantId(supabase, authUser, email);
    }

    const response = NextResponse.json({
      email,
      merchantId: merchantId || null,
      session: upstreamPayload,
      user: authUser,
    });
    setMerchantAuthCookies(response, {
      accessToken,
      refreshToken,
      maxAgeSeconds: upstreamPayload?.expires_in,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "merchant_login_failed" }, { status: 503 });
  }
}
