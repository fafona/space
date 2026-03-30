import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadMerchantIdRulesFromStore } from "@/lib/merchantIdRuleStore";
import { findNextAllowedMerchantIdNumber, MERCHANT_ID_MAX, MERCHANT_ID_MIN, type MerchantIdRule } from "@/lib/merchantIdRules";
import {
  clearMerchantAuthCookies,
  readMerchantAuthCookie,
  readMerchantAuthRefreshCookie,
  setMerchantAuthCookies,
} from "@/lib/merchantAuthSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AuthUserSummary = {
  id?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

type RefreshPayload = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
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

function createServiceRoleSupabaseClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function normalizeEmail(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized) return normalized;
  }
  return "";
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

function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (typeof record.code === "string" && record.code === "23505") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return /duplicate key|already exists|unique constraint/i.test(message);
}

async function resolveMerchantIdForUser(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  user: AuthUserSummary | null,
) {
  if (!supabase || !user) return "";
  const fromMetadata = readMerchantIdFromMetadata(user);
  if (fromMetadata) return fromMetadata;

  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || !/^\d{8}$/.test(normalized) || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  const userId = String(user.id ?? "").trim();
  const email = normalizeEmail(user.email);
  const lookupTasks: Array<PromiseLike<{
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

async function readBlockedMerchantIdRules(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
): Promise<MerchantIdRule[]> {
  if (!supabase) return [];
  try {
    const { rules } = await loadMerchantIdRulesFromStore(supabase);
    return rules;
  } catch {
    return [];
  }
}

async function tryAllocateSequentialMerchantId(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  user: AuthUserSummary | null,
) {
  if (!supabase || !user) return "";
  const userId = String(user.id ?? "").trim();
  if (!userId) return "";
  const email = normalizeEmail(user.email);
  const blockedRules = await readBlockedMerchantIdRules(supabase);
  let candidate = MERCHANT_ID_MIN;
  while (candidate <= MERCHANT_ID_MAX) {
    const nextAllowed = findNextAllowedMerchantIdNumber(candidate, blockedRules);
    if (!nextAllowed) return "";
    candidate = nextAllowed;
    const candidateId = String(candidate);
    const { error } = await supabase.from("merchants").insert({
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

async function refreshMerchantSession(refreshToken: string) {
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
    tokenType: typeof payload?.token_type === "string" ? payload.token_type : "bearer",
    user:
      payload?.user && typeof payload.user === "object"
        ? (payload.user as AuthUserSummary)
        : null,
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
    const adminSupabase = createServiceRoleSupabaseClient();
    if (!supabase) {
      return noStoreJson({ error: "merchant_session_env_missing" }, { status: 503 });
    }

    const cookieAccessToken = readMerchantAuthCookie(request);
    const cookieRefreshToken = readMerchantAuthRefreshCookie(request);
    let accessToken = cookieAccessToken;
    let refreshToken = cookieRefreshToken;
    let user: AuthUserSummary | null = null;
    let expiresIn: number | null = null;
    let tokenType = "bearer";

    if (accessToken) {
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (!error && data.user) {
        user = data.user as AuthUserSummary;
      }
    }

    if (!user && refreshToken) {
      const refreshed = await refreshMerchantSession(refreshToken);
      if (refreshed) {
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        expiresIn = refreshed.expiresIn;
        tokenType = refreshed.tokenType;
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
      const response = noStoreJson({ authenticated: false }, { status: 401 });
      clearMerchantAuthCookies(response);
      return response;
    }

    let merchantId = await resolveMerchantIdForUser(adminSupabase, user);
    if (!merchantId) {
      merchantId = await tryAllocateSequentialMerchantId(adminSupabase, user);
    }

    const response = noStoreJson({
      authenticated: true,
      accessToken,
      refreshToken: refreshToken || null,
      expiresIn,
      tokenType,
      merchantId: merchantId || null,
      user,
    });
    if (
      accessToken !== cookieAccessToken ||
      (refreshToken || "") !== (cookieRefreshToken || "")
    ) {
      setMerchantAuthCookies(response, {
        accessToken,
        refreshToken,
        maxAgeSeconds: expiresIn ?? undefined,
      });
    }
    return response;
  } catch {
    return noStoreJson({ authenticated: false, error: "merchant_session_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseClient();
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
      clearMerchantAuthCookies(response);
      return response;
    }

    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) {
      const response = noStoreJson({ ok: false, error: "merchant_session_invalid_access_token" }, { status: 401 });
      clearMerchantAuthCookies(response);
      return response;
    }

    const response = noStoreJson({
      ok: true,
      authenticated: true,
      accessToken,
      refreshToken: refreshToken || null,
      expiresIn: expiresIn ?? null,
      user: data.user,
    });
    setMerchantAuthCookies(response, {
      accessToken,
      refreshToken,
      maxAgeSeconds: expiresIn,
    });
    return response;
  } catch {
    return noStoreJson({ ok: false, error: "merchant_session_sync_unavailable" }, { status: 503 });
  }
}
