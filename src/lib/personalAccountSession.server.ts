import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import {
  buildPersonalAccountPermissionConfig,
  readPersonalAccountServiceConfigFromMetadata,
  type PersonalAccountServiceConfig,
} from "@/lib/personalAccountServiceConfig";
import { readMerchantAuthCookie, readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import type { FrontendAuthProofPayload } from "@/lib/frontendAuthProof.server";

export type PersonalAccountSession = {
  adminSupabase: PlatformIdentitySupabaseClient;
  user: MerchantAuthUserSummary;
  accountId: string;
  userId: string;
  email: string;
  serviceConfig: PersonalAccountServiceConfig;
  servicePaused: boolean;
  permissionConfig: ReturnType<typeof buildPersonalAccountPermissionConfig>;
};

type AdminGetUserByIdResult = {
  data?: { user?: MerchantAuthUserSummary | null } | null;
  error?: unknown;
};

type PersonalAccountServiceSupabaseClient = PlatformIdentitySupabaseClient & {
  auth: PlatformIdentitySupabaseClient["auth"] & {
    admin: PlatformIdentitySupabaseClient["auth"]["admin"] & {
      getUserById?: (userId: string) => Promise<AdminGetUserByIdResult>;
    };
  };
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function loadFreshAuthUser(
  adminSupabase: PlatformIdentitySupabaseClient,
  userId: string,
): Promise<MerchantAuthUserSummary | null> {
  const getUserById = (adminSupabase as PersonalAccountServiceSupabaseClient).auth.admin.getUserById;
  if (typeof getUserById !== "function") return null;
  try {
    const { data, error } = await getUserById(userId);
    return error || !data?.user ? null : data.user;
  } catch {
    return null;
  }
}

export async function resolvePersonalAccountSessionFromRequest(request: Request): Promise<PersonalAccountSession | null> {
  const authSupabase = createServerSupabaseAuthClient();
  const adminSupabase = createServerSupabaseServiceClient() as unknown as PlatformIdentitySupabaseClient | null;
  if (!authSupabase || !adminSupabase) return null;

  const candidates = [...readMerchantRequestAccessTokens(request), readMerchantAuthCookie(request)]
    .map((value) => trimText(value))
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);

  let user: MerchantAuthUserSummary | null = null;
  for (const accessToken of candidates) {
    const { data, error } = await authSupabase.auth.getUser(accessToken).catch(() => ({ data: null, error: true }));
    if (!error && data?.user) {
      user = data.user as MerchantAuthUserSummary;
      break;
    }
  }

  const userId = trimText(user?.id, 128);
  if (!user || !userId) return null;
  user = (await loadFreshAuthUser(adminSupabase, userId)) ?? user;

  const identity = await resolvePlatformAccountIdentityForUser(adminSupabase, user);
  const accountId = trimText(identity.accountId, 128) || userId;
  if (identity.accountType !== "personal") return null;
  const serviceConfig = readPersonalAccountServiceConfigFromMetadata(user);

  return {
    adminSupabase,
    user,
    accountId,
    userId,
    email: trimText(user.email, 320).toLowerCase(),
    serviceConfig,
    servicePaused: serviceConfig.servicePaused,
    permissionConfig: buildPersonalAccountPermissionConfig(serviceConfig),
  };
}

export async function resolvePersonalAccountSessionFromFrontendAuthProofPayload(
  payload: FrontendAuthProofPayload | null | undefined,
): Promise<PersonalAccountSession | null> {
  if (!payload || payload.accountType !== "personal") return null;
  const adminSupabase = createServerSupabaseServiceClient() as unknown as PlatformIdentitySupabaseClient | null;
  if (!adminSupabase) return null;

  const userId = trimText(payload.userId, 128);
  if (!userId) return null;
  const user = await loadFreshAuthUser(adminSupabase, userId);
  if (!user) return null;

  const identity = await resolvePlatformAccountIdentityForUser(adminSupabase, user, {
    preferredAccountType: "personal",
    preferredAccountId: payload.accountId,
  });
  const accountId = trimText(identity.accountId, 128) || userId;
  if (identity.accountType !== "personal") return null;
  const proofAccountId = trimText(payload.accountId, 128);
  if (proofAccountId && accountId && proofAccountId !== accountId) return null;

  const serviceConfig = readPersonalAccountServiceConfigFromMetadata(user);
  return {
    adminSupabase,
    user,
    accountId,
    userId,
    email: trimText(user.email, 320).toLowerCase() || trimText(payload.email, 320).toLowerCase(),
    serviceConfig,
    servicePaused: serviceConfig.servicePaused,
    permissionConfig: buildPersonalAccountPermissionConfig(serviceConfig),
  };
}
