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
  ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY,
  ORDINARY_SIGNUP_INTENT_COOKIE,
  ORDINARY_SIGNUP_INTENT_TTL_SECONDS,
  completeOrdinarySignupIntentRecord,
  createOrdinarySignupIntent,
  matchesOrdinarySignupIntent,
  readOrdinarySignupIntentCookie,
  readOrdinarySignupIntentRecord,
  reissueOrdinarySignupIntent,
  verifyOrdinarySignupIntentToken,
  type OrdinarySignupIntentRecord,
} from "@/lib/ordinarySignupIntent.server";
import {
  bootstrapPlatformAccountIdentityForUser,
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { isOrdinaryAccountPrincipalError } from "@/lib/ordinaryAccountPrincipal.server";
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

type SignupIntentAdminClient = PlatformIdentitySupabaseClient & {
  auth: PlatformIdentitySupabaseClient["auth"] & {
    admin: PlatformIdentitySupabaseClient["auth"]["admin"] & {
      getUserById: (userId: string) => Promise<{
        data: { user: MerchantAuthUserSummary | null } | null;
        error: unknown;
      }>;
    };
  };
};

type SignupAuthUser = MerchantAuthUserSummary & {
  email_confirmed_at?: string | null;
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

function normalizeRequestedAccountType(value: unknown): PlatformAccountType | null {
  if (value === "personal") return "personal";
  if (value === "merchant") return "merchant";
  return null;
}

function hasTopLevelEmailConfirmation(
  user: SignupAuthUser | null | undefined,
) {
  return (
    typeof user?.email_confirmed_at === "string" &&
    Boolean(user.email_confirmed_at.trim())
  );
}

export function signUpNeedsEmailConfirmation(data: {
  session?: { user?: SignupAuthUser | null } | null;
  user?: SignupAuthUser | null;
}) {
  const user = data.session?.user ?? data.user ?? null;
  return !(data.session || hasTopLevelEmailConfirmation(user));
}

async function loadFreshSignupAuthUser(
  supabase: SignupIntentAdminClient,
  candidate: SignupAuthUser,
  expectedEmail: string,
) {
  const candidateId = String(candidate.id ?? "").trim().toLowerCase();
  if (!candidateId) return null;
  const result = await supabase.auth.admin
    .getUserById(candidateId)
    .catch(() => null);
  const freshUser =
    result && !result.error
      ? ((result.data?.user ?? null) as SignupAuthUser | null)
      : null;
  if (
    !freshUser ||
    String(freshUser.id ?? "").trim().toLowerCase() !== candidateId ||
    normalizeAuthEmail(freshUser.email) !== expectedEmail
  ) {
    return null;
  }
  return freshUser;
}

function isObfuscatedExistingSignupUser(user: unknown) {
  if (!user || typeof user !== "object") return false;
  const identities = (user as { identities?: unknown }).identities;
  return Array.isArray(identities) && identities.length === 0;
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

async function persistSignupIntent(
  supabase: SignupIntentAdminClient,
  user: MerchantAuthUserSummary,
  email: string,
  accountType: PlatformAccountType,
) {
  if (normalizeAuthEmail(user.email) !== normalizeAuthEmail(email)) return null;
  if (readOrdinarySignupIntentRecord(user.app_metadata) !== null) return null;
  const created = createOrdinarySignupIntent({
    userId: String(user.id ?? ""),
    email,
    accountType,
  });
  if (!created) return null;
  const appMetadata = {
    ...(user.app_metadata && typeof user.app_metadata === "object"
      ? user.app_metadata
      : {}),
    [ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY]: created.record,
  };
  const updated = await supabase.auth.admin
    .updateUserById(created.payload.userId, { app_metadata: appMetadata })
    .catch((error) => ({ data: null, error }));
  const updatedUser = updated.data?.user ?? null;
  if (
    !updated.error &&
    updatedUser &&
    sameSignupIntentRecord(
      readOrdinarySignupIntentRecord(updatedUser.app_metadata),
      created.record,
    )
  ) {
    return { ...created, user: updatedUser as MerchantAuthUserSummary };
  }
  const reread = await supabase.auth.admin
    .getUserById(created.payload.userId)
    .catch(() => null);
  const rereadUser = reread && !reread.error ? reread.data?.user ?? null : null;
  if (
    rereadUser &&
    sameSignupIntentRecord(
      readOrdinarySignupIntentRecord(rereadUser.app_metadata),
      created.record,
    )
  ) {
    return { ...created, user: rereadUser as MerchantAuthUserSummary };
  }
  return null;
}

async function completeSignupIntent(
  supabase: SignupIntentAdminClient,
  user: MerchantAuthUserSummary,
  record: OrdinarySignupIntentRecord,
) {
  const userId = String(user.id ?? "").trim();
  if (!userId) return false;
  const completed = completeOrdinarySignupIntentRecord(record);
  const appMetadata = {
    ...(user.app_metadata && typeof user.app_metadata === "object"
      ? user.app_metadata
      : {}),
    [ORDINARY_SIGNUP_INTENT_APP_METADATA_KEY]: completed,
  };
  const updated = await supabase.auth.admin
    .updateUserById(userId, { app_metadata: appMetadata })
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
  const reread = await supabase.auth.admin.getUserById(userId).catch(() => null);
  return Boolean(
    reread &&
      !reread.error &&
      sameSignupIntentRecord(
        readOrdinarySignupIntentRecord(reread.data?.user?.app_metadata),
        completed,
      ),
  );
}

function resolvePersistedSignupIntent(
  request: Request,
  user: MerchantAuthUserSummary,
  email: string,
  accountType: PlatformAccountType,
) {
  const userId = String(user.id ?? "").trim().toLowerCase();
  const userEmail = normalizeAuthEmail(user.email);
  if (!userId || userEmail !== normalizeAuthEmail(email)) return null;
  const record = readOrdinarySignupIntentRecord(user.app_metadata);
  const rawToken = readOrdinarySignupIntentCookie(request);
  const token = verifyOrdinarySignupIntentToken(rawToken);
  if (
    matchesOrdinarySignupIntent({
      record,
      token,
      userId,
      email: userEmail,
      accountType,
      requirePending: true,
    })
  ) {
    return {
      token: rawToken,
      payload: token!,
      record: record!,
      user,
      reissued: false,
    };
  }
  const reissued = reissueOrdinarySignupIntent({
    record,
    userId,
    email: userEmail,
    accountType,
  });
  return reissued ? { ...reissued, user, reissued: true } : null;
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

function buildResolvedSignupResponse(input: {
  request: Request;
  email: string;
  user: MerchantAuthUserSummary;
  identity: Awaited<ReturnType<typeof resolvePlatformAccountIdentityForUser>>;
  session?: {
    access_token?: string | null;
    refresh_token?: string | null;
    expires_in?: number;
  } | null;
}) {
  const response = noStoreJson({
    ok: true,
    needsConfirmation: false,
    codeSent: false,
    maskedEmail: maskEmailAddress(input.email),
    accountType: input.identity.accountType,
    accountId: input.identity.accountId,
    merchantId: input.identity.merchantId,
    merchantIds: input.identity.merchantIds,
    user: input.user,
  });
  clearSignupIntentCookie(response, input.request);
  if (input.session?.access_token && input.session.refresh_token) {
    setMerchantAuthCookies(response, {
      accessToken: input.session.access_token,
      refreshToken: input.session.refresh_token,
      maxAgeSeconds: input.session.expires_in,
      merchantId: input.identity.merchantId,
      accountType: input.identity.accountType,
    }, input.request);
  }
  return response;
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
  if (!accountType) {
    return noStoreJson(
      { ok: false, error: "invalid_account_type" },
      { status: 400 },
    );
  }

  const supabase = createAnonSupabaseClient();
  const adminSupabase = createServiceRoleSupabaseClient();
  if (!supabase || !adminSupabase) {
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

  let effectiveSession = data.session;
  let authUser = (data.session?.user ?? data.user ?? null) as SignupAuthUser | null;
  let resumedExistingAuthUser = false;
  if (authUser && isObfuscatedExistingSignupUser(authUser)) {
    // Supabase intentionally obscures duplicate signup identities. The
    // password grant identifies the exact Auth UUID, but an unbound UUID still
    // needs its server-owned pending signup intent and browser proof below.
    const resumed = await supabase.auth.signInWithPassword({ email, password });
    if (!resumed.error && resumed.data.user && resumed.data.session) {
      authUser = resumed.data.user as MerchantAuthUserSummary;
      effectiveSession = resumed.data.session;
      resumedExistingAuthUser = true;
    }
  }
  let needsConfirmation = signUpNeedsEmailConfirmation({
    session: effectiveSession,
    user: authUser,
  });
  if (!authUser || isObfuscatedExistingSignupUser(authUser)) {
    return noStoreJson({
      ok: true,
      needsConfirmation: true,
      codeSent: true,
      maskedEmail: maskEmailAddress(email),
      accountType,
      accountId: null,
      merchantId: null,
      merchantIds: [],
      user: null,
    });
  }
  if (normalizeAuthEmail(authUser.email) !== email) {
    return noStoreJson(
      { ok: false, error: "ordinary_signup_intent_mismatch" },
      { status: 403 },
    );
  }
  if (!effectiveSession && !needsConfirmation) {
    const freshAuthUser = await loadFreshSignupAuthUser(
      adminSupabase as SignupIntentAdminClient,
      authUser,
      email,
    );
    if (!freshAuthUser) {
      return noStoreJson(
        { ok: false, error: "ordinary_signup_confirmation_lookup_unavailable" },
        { status: 503 },
      );
    }
    authUser = freshAuthUser;
    needsConfirmation = !hasTopLevelEmailConfirmation(freshAuthUser);
  }
  if (resumedExistingAuthUser) {
    try {
      const existingIdentity = await resolvePlatformAccountIdentityForUser(
        adminSupabase,
        authUser,
      );
      if (existingIdentity.accountType !== accountType) {
        return noStoreJson(
          { ok: false, error: "ordinary_account_principal_type_conflict" },
          { status: 409 },
        );
      }
      return buildResolvedSignupResponse({
        request,
        email,
        user: authUser,
        identity: existingIdentity,
        session: effectiveSession,
      });
    } catch (error) {
      if (
        !isOrdinaryAccountPrincipalError(error) ||
        error.code !== "ordinary_account_principal_unbound"
      ) {
        if (isOrdinaryAccountPrincipalError(error)) {
          return noStoreJson(
            { ok: false, error: error.code },
            { status: error.status },
          );
        }
        return noStoreJson(
          { ok: false, error: "ordinary_account_principal_unavailable" },
          { status: 503 },
        );
      }
    }

    const freshAuthResult = await (
      adminSupabase as SignupIntentAdminClient
    ).auth.admin
      .getUserById(String(authUser.id ?? "").trim())
      .catch(() => null);
    const freshAuthUser =
      freshAuthResult && !freshAuthResult.error
        ? freshAuthResult.data?.user ?? null
        : null;
    if (
      !freshAuthUser ||
      String(freshAuthUser.id ?? "").trim() !== String(authUser.id ?? "").trim() ||
      normalizeAuthEmail(freshAuthUser.email) !== email
    ) {
      return noStoreJson(
        { ok: false, error: "ordinary_signup_intent_lookup_unavailable" },
        { status: 503 },
      );
    }
    authUser = freshAuthUser;
  }

  const freshSignupIntent = resumedExistingAuthUser
    ? null
    : await persistSignupIntent(
        adminSupabase as SignupIntentAdminClient,
        authUser,
        email,
        accountType,
      );
  const signupIntent = resumedExistingAuthUser
    ? resolvePersistedSignupIntent(request, authUser, email, accountType)
    : freshSignupIntent
      ? { ...freshSignupIntent, reissued: false }
      : null;
  if (!signupIntent) {
    return noStoreJson(
      {
        ok: false,
        error: resumedExistingAuthUser
          ? "ordinary_signup_recovery_not_allowed"
          : "ordinary_signup_intent_persist_failed",
      },
      { status: resumedExistingAuthUser ? 409 : 503 },
    );
  }
  if (resumedExistingAuthUser && signupIntent.reissued) {
    const response = noStoreJson(
      {
        ok: false,
        error: "ordinary_signup_intent_reissued",
        retryable: true,
      },
      { status: 409 },
    );
    setSignupIntentCookie(response, request, signupIntent.token);
    return response;
  }

  if (needsConfirmation) {
    const response = noStoreJson({
      ok: true,
      needsConfirmation: true,
      codeSent: true,
      maskedEmail: maskEmailAddress(email),
      accountType,
      accountId: null,
      merchantId: null,
      merchantIds: [],
      user: null,
    });
    setSignupIntentCookie(response, request, signupIntent.token);
    return response;
  }
  const platformIdentity = await bootstrapPlatformAccountIdentityForUser(
    adminSupabase,
    authUser,
    accountType,
  ).catch(() => null);
  if (!platformIdentity) {
    const response = noStoreJson(
      { ok: false, error: "ordinary_account_bootstrap_unavailable" },
      { status: 503 },
    );
    setSignupIntentCookie(response, request, signupIntent.token);
    if (effectiveSession?.access_token && effectiveSession.refresh_token) {
      setMerchantAuthCookies(response, {
        accessToken: effectiveSession.access_token,
        refreshToken: effectiveSession.refresh_token,
        maxAgeSeconds: effectiveSession.expires_in,
        merchantId: null,
        accountType,
      }, request);
    }
    return response;
  }

  if (
    !(await completeSignupIntent(
      adminSupabase as SignupIntentAdminClient,
      signupIntent.user,
      signupIntent.record,
    ))
  ) {
    const response = noStoreJson(
      { ok: false, error: "ordinary_signup_intent_completion_unavailable" },
      { status: 503 },
    );
    setSignupIntentCookie(response, request, signupIntent.token);
    return response;
  }

  return buildResolvedSignupResponse({
    request,
    email,
    user: authUser,
    identity: platformIdentity,
    session: effectiveSession,
  });
}
