import { NextResponse } from "next/server";
import { createClient, type EmailOtpType } from "@supabase/supabase-js";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { type PlatformAccountType } from "@/lib/platformAccounts";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RequestBody = {
  email?: unknown;
  code?: unknown;
  accountType?: unknown;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeCode(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "") : "";
}

function normalizeRequestedAccountType(value: unknown): PlatformAccountType | null {
  if (value === "personal") return "personal";
  if (value === "merchant") return "merchant";
  return null;
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

async function verifySignupCode(input: {
  supabase: NonNullable<ReturnType<typeof createAnonSupabaseClient>>;
  email: string;
  code: string;
}) {
  const candidateTypes: EmailOtpType[] = ["signup", "email"];
  let lastError: Error | null = null;
  for (const type of candidateTypes) {
    const { data, error } = await input.supabase.auth.verifyOtp({
      email: input.email,
      token: input.code,
      type,
    });
    if (!error && data.user) return { data, type };
    lastError = error ?? lastError;
  }
  return { data: null, type: null, error: lastError };
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const body = (await request.json().catch(() => null)) as RequestBody | null;
    const email = normalizeEmail(body?.email);
    const code = normalizeCode(body?.code);
    const requestedAccountType = normalizeRequestedAccountType(body?.accountType);
    if (!email || !email.includes("@")) {
      return noStoreJson({ ok: false, error: "signup_code_invalid_email" }, { status: 400 });
    }
    if (!code || code.length < 4) {
      return noStoreJson({ ok: false, error: "signup_code_invalid_code" }, { status: 400 });
    }

    const supabase = createAnonSupabaseClient();
    const adminSupabase = createServiceRoleSupabaseClient();
    if (!supabase) {
      return noStoreJson({ ok: false, error: "signup_code_env_missing" }, { status: 503 });
    }

    const result = await verifySignupCode({ supabase, email, code });
    const authUser = (result.data?.user ?? null) as MerchantAuthUserSummary | null;
    if (!authUser) {
      return noStoreJson(
        {
          ok: false,
          error: result.error?.message || "signup_code_invalid_or_expired",
        },
        { status: 401 },
      );
    }

    const platformIdentity = await resolvePlatformAccountIdentityForUser(adminSupabase, authUser, {
      preferredAccountType: requestedAccountType,
      preferredEmail: email,
    });

    return noStoreJson({
      ok: true,
      verified: true,
      accountType: platformIdentity.accountType,
      accountId: platformIdentity.accountId,
      merchantId: platformIdentity.merchantId,
      merchantIds: platformIdentity.merchantIds,
      user: authUser,
    });
  } catch {
    return noStoreJson({ ok: false, error: "signup_code_verify_unavailable" }, { status: 503 });
  }
}
