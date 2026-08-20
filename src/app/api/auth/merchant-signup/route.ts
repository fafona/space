import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isAuthRateLimitError,
  isValidAuthEmail,
  isValidAuthPassword,
  normalizeAuthEmail,
  readAuthPassword,
} from "@/lib/authCredentialValidation";
import {
  type MerchantAuthUserSummary,
} from "@/lib/merchantAuthIdentity";
import { setMerchantAuthCookies } from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { type PlatformAccountType } from "@/lib/platformAccounts";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveTrustedPublicOrigin } from "@/lib/requestOrigin";
import { maskEmailAddress } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MerchantSignupBody = {
  email?: unknown;
  password?: unknown;
  accountType?: unknown;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function createAnonSupabaseClient() {
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

function normalizeRequestedAccountType(value: unknown): PlatformAccountType {
  return value === "personal" ? "personal" : "merchant";
}

export function signUpNeedsEmailConfirmation(data: {
  session?: { user?: { email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> | null } | null } | null;
  user?: { email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> | null } | null;
}) {
  const user = data.session?.user ?? data.user ?? null;
  return !(data.session || user?.email_confirmed_at);
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  let body: MerchantSignupBody | null = null;
  try {
    body = (await request.json()) as MerchantSignupBody;
  } catch {
    return noStoreJson({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeAuthEmail(body?.email);
  const password = readAuthPassword(body?.password);
  const accountType = normalizeRequestedAccountType(body?.accountType);
  if (!isValidAuthEmail(email)) {
    return noStoreJson({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  if (!isValidAuthPassword(password)) {
    return noStoreJson({ ok: false, error: "invalid_password" }, { status: 400 });
  }

  const supabase = createAnonSupabaseClient();
  const adminSupabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    return noStoreJson({ ok: false, error: "merchant_signup_env_missing" }, { status: 503 });
  }

  const publicOrigin = resolveTrustedPublicOrigin(new URL(request.url));
  const emailRedirectTo = new URL("/login", publicOrigin).toString();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
      data: {
        account_type: accountType,
        accountType,
      },
    },
  });

  if (error) {
    const code = typeof (error as { code?: unknown }).code === "string" ? String((error as { code?: unknown }).code) : "";
    if (code === "user_already_exists" || /user already registered/i.test(error.message)) {
      return noStoreJson({ ok: false, error: "user_already_exists" }, { status: 409 });
    }
    if (isAuthRateLimitError(error)) {
      return noStoreJson({ ok: false, error: "auth_rate_limited" }, { status: 429 });
    }
    return noStoreJson({ ok: false, error: "merchant_signup_failed" }, { status: 400 });
  }

  const needsConfirmation = signUpNeedsEmailConfirmation(data);
  const authUser = (data.session?.user ?? data.user ?? null) as MerchantAuthUserSummary | null;
  const platformIdentity = await resolvePlatformAccountIdentityForUser(adminSupabase, authUser, {
    preferredAccountType: accountType,
    preferredEmail: email,
  });

  if (needsConfirmation || !data.session?.access_token || !data.session.refresh_token) {
    return noStoreJson({
      ok: true,
      needsConfirmation: true,
      codeSent: needsConfirmation,
      maskedEmail: maskEmailAddress(email),
      accountType: platformIdentity.accountType,
      accountId: platformIdentity.accountId,
      merchantId: platformIdentity.merchantId,
      merchantIds: platformIdentity.merchantIds,
      user: authUser,
    });
  }

  const response = NextResponse.json({
    ok: true,
    needsConfirmation: false,
    accountType: platformIdentity.accountType,
    accountId: platformIdentity.accountId,
    merchantId: platformIdentity.merchantId,
    merchantIds: platformIdentity.merchantIds,
    user: authUser,
  });
  response.headers.set("cache-control", "no-store");
  setMerchantAuthCookies(response, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    maxAgeSeconds: data.session.expires_in,
    merchantId: platformIdentity.merchantId,
    accountType: platformIdentity.accountType,
  }, request);
  return response;
}
