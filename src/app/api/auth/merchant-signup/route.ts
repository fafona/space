import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  type MerchantAuthUserSummary,
  type MerchantIdentitySupabaseClient,
  resolveMerchantIdentityForUser,
} from "@/lib/merchantAuthIdentity";
import { setMerchantAuthCookies } from "@/lib/merchantAuthSession";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveTrustedPublicOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MerchantSignupBody = {
  email?: unknown;
  password?: unknown;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePassword(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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

function signUpNeedsEmailConfirmation(data: {
  session?: { user?: { email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> | null } | null } | null;
  user?: { email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> | null } | null;
}) {
  const user = data.session?.user ?? data.user ?? null;
  const metadata = user?.user_metadata;
  const emailVerified =
    metadata && typeof metadata === "object" ? (metadata.email_verified as boolean | undefined) === true : false;
  return !(data.session || user?.email_confirmed_at || emailVerified);
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  let body: MerchantSignupBody | null = null;
  try {
    body = (await request.json()) as MerchantSignupBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeEmail(body?.email);
  const password = normalizePassword(body?.password);
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ ok: false, error: "invalid_password" }, { status: 400 });
  }

  const supabase = createAnonSupabaseClient();
  const adminSupabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "merchant_signup_env_missing" }, { status: 503 });
  }

  const publicOrigin = resolveTrustedPublicOrigin(new URL(request.url));
  const emailRedirectTo = new URL("/login", publicOrigin).toString();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
    },
  });

  if (error) {
    const code = typeof (error as { code?: unknown }).code === "string" ? String((error as { code?: unknown }).code) : "";
    if (code === "user_already_exists" || /user already registered/i.test(error.message)) {
      return NextResponse.json({ ok: false, error: "user_already_exists", message: error.message }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "merchant_signup_failed", message: error.message }, { status: 400 });
  }

  const needsConfirmation = signUpNeedsEmailConfirmation(data);
  const authUser = (data.session?.user ?? data.user ?? null) as MerchantAuthUserSummary | null;

  if (needsConfirmation || !data.session?.access_token || !data.session.refresh_token) {
    return NextResponse.json({
      ok: true,
      needsConfirmation: true,
      user: authUser,
    });
  }

  const merchantIdentity = await resolveMerchantIdentityForUser(adminSupabase, authUser, {
    preferredEmail: email,
  });
  const response = NextResponse.json({
    ok: true,
    needsConfirmation: false,
    merchantId: merchantIdentity.merchantId,
    merchantIds: merchantIdentity.merchantIds,
    user: authUser,
  });
  setMerchantAuthCookies(response, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    maxAgeSeconds: data.session.expires_in,
    merchantId: merchantIdentity.merchantId,
  }, request);
  return response;
}
