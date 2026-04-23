import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import { readMerchantAuthCookie, readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export type PersonalAccountSession = {
  adminSupabase: PlatformIdentitySupabaseClient;
  user: MerchantAuthUserSummary;
  accountId: string;
  userId: string;
  email: string;
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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

  const identity = await resolvePlatformAccountIdentityForUser(adminSupabase, user);
  const accountId = trimText(identity.accountId, 32);
  if (identity.accountType !== "personal" || !/^\d{8}$/.test(accountId)) return null;

  return {
    adminSupabase,
    user,
    accountId,
    userId,
    email: trimText(user.email, 320).toLowerCase(),
  };
}
