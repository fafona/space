import { NextResponse } from "next/server";
import { createClient, type EmailOtpType } from "@supabase/supabase-js";
import {
  isAuthRateLimitError,
  isValidAuthEmail,
  isValidAuthVerificationCode,
  normalizeAuthEmail,
  normalizeAuthVerificationCode,
} from "@/lib/authCredentialValidation";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import {
  setMerchantAuthCookies,
} from "@/lib/merchantAuthSession";
import {
  ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY,
  ORDINARY_SIGNUP_INTENT_COOKIE,
  ORDINARY_SIGNUP_INTENT_TTL_SECONDS,
  completeOrdinarySignupIntentRecord,
  matchesOrdinarySignupIntent,
  readOrdinarySignupIntentCookie,
  readOrdinarySignupIntentRecord,
  reissueOrdinarySignupIntent,
  verifyOrdinarySignupIntentToken,
  type OrdinarySignupIntentRecord,
} from "@/lib/ordinarySignupIntent.server";
import {
  bootstrapPlatformAccountIdentityForUser,
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

type SignupIntentAuthUser = MerchantAuthUserSummary & {
  email_confirmed_at?: string | null;
};

type SignupIntentAdminClient = PlatformIdentitySupabaseClient & {
  auth: PlatformIdentitySupabaseClient["auth"] & {
    admin: PlatformIdentitySupabaseClient["auth"]["admin"] & {
      getUserById: (userId: string) => Promise<{
        data: { user: SignupIntentAuthUser | null } | null;
        error: unknown;
      }>;
    };
  };
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
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
    if (isAuthRateLimitError(error)) break;
  }
  return { data: null, type: null, error: lastError };
}

function sameSignupIntentRecord(
  left: OrdinarySignupIntentRecord | null,
  right: OrdinarySignupIntentRecord,
) {
  return Boolean(
    left &&
      left.version === right.version &&
      left.status === right.status &&
      left.accountType === right.accountType &&
      left.emailHash === right.emailHash &&
      left.nonceHash === right.nonceHash &&
      left.createdAt === right.createdAt &&
      left.expiresAt === right.expiresAt &&
      left.completedAt === right.completedAt,
  );
}

function setSignupIntentCookie(
  response: NextResponse,
  request: Request,
  token: string,
) {
  response.cookies.set(ORDINARY_SIGNUP_INTENT_COOKIE, token, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: ORDINARY_SIGNUP_INTENT_TTL_SECONDS,
  });
}

function clearSignupIntentCookie(response: NextResponse, request: Request) {
  response.cookies.set(ORDINARY_SIGNUP_INTENT_COOKIE, "", {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

async function completeSignupIntent(
  supabase: SignupIntentAdminClient,
  user: SignupIntentAuthUser,
  record: OrdinarySignupIntentRecord,
) {
  const completed = completeOrdinarySignupIntentRecord(record);
  const appMetadata = {
    ...(user.app_metadata && typeof user.app_metadata === "object"
      ? user.app_metadata
      : {}),
    [ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY]: completed,
  };
  const updated = await supabase.auth.admin
    .updateUserById(String(user.id ?? ""), { app_metadata: appMetadata })
    .catch((error) => ({ data: null, error }));
  if (
    !updated.error &&
    sameSignupIntentRecord(
      readOrdinarySignupIntentRecord(updated.data?.user?.app_metadata),
      completed,
    )
  ) {
    return true;
  }
  const reread = await supabase.auth.admin
    .getUserById(String(user.id ?? ""))
    .catch(() => null);
  return Boolean(
    reread &&
      !reread.error &&
      sameSignupIntentRecord(
        readOrdinarySignupIntentRecord(reread.data?.user?.app_metadata),
        completed,
      ),
  );
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const body = (await request.json().catch(() => null)) as RequestBody | null;
    const email = normalizeAuthEmail(body?.email);
    const code = normalizeAuthVerificationCode(body?.code);
    const requestedAccountType = normalizeRequestedAccountType(body?.accountType);
    if (!isValidAuthEmail(email)) {
      return noStoreJson({ ok: false, error: "signup_code_invalid_email" }, { status: 400 });
    }
    if (!isValidAuthVerificationCode(code)) {
      return noStoreJson({ ok: false, error: "signup_code_invalid_code" }, { status: 400 });
    }
    if (!requestedAccountType) {
      return noStoreJson(
        { ok: false, error: "signup_code_invalid_account_type" },
        { status: 400 },
      );
    }

    const supabase = createAnonSupabaseClient();
    const adminSupabase = createServiceRoleSupabaseClient();
    if (!supabase || !adminSupabase) {
      return noStoreJson({ ok: false, error: "signup_code_env_missing" }, { status: 503 });
    }

    const rawSignupIntent = readOrdinarySignupIntentCookie(request);
    const signupIntent = verifyOrdinarySignupIntentToken(rawSignupIntent);
    if (
      rawSignupIntent &&
      (!signupIntent ||
        signupIntent.email !== email ||
        signupIntent.accountType !== requestedAccountType)
    ) {
      return noStoreJson(
        { ok: false, error: "ordinary_signup_intent_required" },
        { status: 401 },
      );
    }

    const result = await verifySignupCode({ supabase, email, code });
    const freshlyVerifiedUser = (result.data?.user ?? null) as SignupIntentAuthUser | null;
    let authUser: SignupIntentAuthUser | null = null;
    let recoveredAfterConsumedOtp = false;
    if (freshlyVerifiedUser) {
      const freshUserId = String(freshlyVerifiedUser.id ?? "").trim();
      const stored = freshUserId
        ? await (adminSupabase as SignupIntentAdminClient).auth.admin
            .getUserById(freshUserId)
            .catch(() => null)
        : null;
      const candidate = stored && !stored.error ? stored.data?.user ?? null : null;
      if (
        !candidate ||
        String(candidate.id ?? "").trim() !== freshUserId ||
        normalizeAuthEmail(freshlyVerifiedUser.email) !== email ||
        normalizeAuthEmail(candidate.email) !== email
      ) {
        return noStoreJson(
          { ok: false, error: "ordinary_signup_intent_mismatch" },
          { status: candidate ? 403 : 503 },
        );
      }
      authUser = candidate;
    } else if (signupIntent) {
      const stored = await (adminSupabase as SignupIntentAdminClient).auth.admin
        .getUserById(signupIntent.userId)
        .catch(() => null);
      const candidate = stored && !stored.error ? stored.data?.user ?? null : null;
      if (candidate?.email_confirmed_at) {
        authUser = candidate;
        recoveredAfterConsumedOtp = true;
      }
    }
    if (!authUser) {
      if (!signupIntent) {
        return noStoreJson(
          { ok: false, error: "ordinary_signup_intent_required" },
          { status: 401 },
        );
      }
      if (isAuthRateLimitError(result.error)) {
        return noStoreJson({ ok: false, error: "auth_rate_limited" }, { status: 429 });
      }
      return noStoreJson(
        {
          ok: false,
          error: "signup_code_invalid_or_expired",
        },
        { status: 401 },
      );
    }

    const authUserId = String(authUser.id ?? "").trim().toLowerCase();
    const authUserEmail = normalizeAuthEmail(authUser.email);
    const signupIntentRecord = readOrdinarySignupIntentRecord(
      authUser.app_metadata,
    );
    const cookieIntentMatches = matchesOrdinarySignupIntent({
      record: signupIntentRecord,
      token: signupIntent,
      userId: authUserId,
      email: authUserEmail,
      accountType: requestedAccountType,
      requirePending: true,
    });
    const freshIntentWithoutCookie =
      freshlyVerifiedUser && !rawSignupIntent
        ? reissueOrdinarySignupIntent({
            record: signupIntentRecord,
            userId: authUserId,
            email: authUserEmail,
            accountType: requestedAccountType,
          })
        : null;
    if (
      (!cookieIntentMatches && !freshIntentWithoutCookie) ||
      (recoveredAfterConsumedOtp && !authUser.email_confirmed_at)
    ) {
      return noStoreJson(
        { ok: false, error: "ordinary_signup_intent_mismatch" },
        { status: 403 },
      );
    }
    const recoveryIntentToken =
      rawSignupIntent || freshIntentWithoutCookie?.token || "";

    let platformIdentity: Awaited<
      ReturnType<typeof bootstrapPlatformAccountIdentityForUser>
    >;
    try {
      platformIdentity = await bootstrapPlatformAccountIdentityForUser(
        adminSupabase,
        authUser,
        requestedAccountType,
      );
    } catch {
      const response = noStoreJson(
        { ok: false, error: "ordinary_account_bootstrap_unavailable", retryable: true },
        { status: 503 },
      );
      const session = result.data?.session;
      if (session?.access_token && session.refresh_token) {
        setMerchantAuthCookies(response, {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          maxAgeSeconds: session.expires_in,
          accountType: requestedAccountType,
          merchantId: null,
        }, request);
      }
      if (recoveryIntentToken) {
        setSignupIntentCookie(response, request, recoveryIntentToken);
      }
      return response;
    }

    if (
      !signupIntentRecord ||
      !(await completeSignupIntent(
        adminSupabase as SignupIntentAdminClient,
        authUser,
        signupIntentRecord,
      ))
    ) {
      const response = noStoreJson(
        {
          ok: false,
          error: "ordinary_signup_intent_completion_unavailable",
          retryable: true,
        },
        { status: 503 },
      );
      if (recoveryIntentToken) {
        setSignupIntentCookie(response, request, recoveryIntentToken);
      }
      return response;
    }

    const response = noStoreJson({
      ok: true,
      verified: true,
      accountType: platformIdentity.accountType,
      accountId: platformIdentity.accountId,
      merchantId: platformIdentity.merchantId,
      merchantIds: platformIdentity.merchantIds,
      user: authUser,
    });
    clearSignupIntentCookie(response, request);
    return response;
  } catch {
    return noStoreJson({ ok: false, error: "signup_code_verify_unavailable" }, { status: 503 });
  }
}
