import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import type { OrdinaryAccountAuthorizationStoreClient } from "@/lib/ordinaryAccountAuthorization.server";
import { loadActiveOrdinaryAccountAuthorization } from "@/lib/ordinaryAccountPrincipal.server";
import { normalizeCanonicalPersonalAccountId } from "@/lib/personalAccountId";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

type AuthUserRecord = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

type PersonalBindingQueryResult = {
  data: { auth_user_id?: unknown; personal_account_id?: unknown; status?: unknown } | null;
  error: unknown;
};

type PersonalBindingQuery = {
  select: (columns: string) => PersonalBindingQuery;
  eq: (column: string, value: unknown) => PersonalBindingQuery;
  limit: (count: number) => PersonalBindingQuery;
  maybeSingle: () => Promise<PersonalBindingQueryResult>;
};

export type PersonalPublicProfileSupabaseClient =
  OrdinaryAccountAuthorizationStoreClient & {
  auth: {
    admin: {
      getUserById: (userId: string) => Promise<{
        data: { user: AuthUserRecord | null } | null;
        error: unknown;
      }>;
    };
  };
  from: (table: string) => PersonalBindingQuery;
};

export type PublicPersonalProfile = {
  accountId: string;
  displayName: string;
  avatarUrl: string;
  signature: string;
  country: string;
  province: string;
  city: string;
  address: string;
};

function readMetadataString(metadata: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readMetadataRecord(
  metadata: Record<string, unknown> | null | undefined,
  ...keys: string[]
) {
  if (!metadata || typeof metadata !== "object") return null;
  for (const key of keys) {
    const value = metadata[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function readPublicPersonalProfile(user: MerchantAuthUserSummary | null | undefined, accountId: string) {
  const userMetadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : null;
  const appMetadata = user?.app_metadata && typeof user.app_metadata === "object" ? user.app_metadata : null;
  const profile =
    userMetadata?.personal_profile && typeof userMetadata.personal_profile === "object"
      ? (userMetadata.personal_profile as Record<string, unknown>)
      : null;
  const publicVisibility =
    readMetadataRecord(profile, "publicVisibility", "public_visibility") ??
    readMetadataRecord(
      userMetadata,
      "personalProfilePublicVisibility",
      "personal_profile_public_visibility",
    );
  const isExplicitlyPublic = (field: "country" | "province" | "city") =>
    publicVisibility?.[field] === true;
  const displayName =
    readMetadataString(profile, "displayName", "display_name", "username", "name") ||
    readMetadataString(userMetadata, "displayName", "display_name", "username", "name") ||
    readMetadataString(appMetadata, "displayName", "display_name", "username", "name") ||
    accountId;
  return {
    accountId,
    displayName,
    avatarUrl: normalizePublicAssetUrl(
      readMetadataString(profile, "avatarUrl", "avatar_url", "personalAvatarUrl", "chatAvatarImageUrl") ||
        readMetadataString(userMetadata, "avatarUrl", "avatar_url", "personalAvatarUrl", "chatAvatarImageUrl"),
    ),
    signature:
      readMetadataString(profile, "signature", "bio") || readMetadataString(userMetadata, "signature", "bio"),
    country: isExplicitlyPublic("country")
      ? readMetadataString(profile, "country") || readMetadataString(userMetadata, "country")
      : "",
    province:
      isExplicitlyPublic("province")
        ? readMetadataString(profile, "province", "state") || readMetadataString(userMetadata, "province", "state")
        : "",
    city: isExplicitlyPublic("city")
      ? readMetadataString(profile, "city") || readMetadataString(userMetadata, "city")
      : "",
    // Street-level addresses are deliberately outside the public allowlist.
    // Legacy records have no visibility contract and remain private.
    address: "",
  } satisfies PublicPersonalProfile;
}

export async function loadPublicPersonalProfileByAccountId(
  supabase: PersonalPublicProfileSupabaseClient | null,
  accountId: string,
): Promise<PublicPersonalProfile | null> {
  const normalizedAccountId = normalizeCanonicalPersonalAccountId(accountId);
  if (!supabase || !normalizedAccountId) return null;

  const binding = await supabase
    .from("faolla_personal_accounts")
    .select("auth_user_id,personal_account_id,status")
    .eq("personal_account_id", normalizedAccountId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle()
    .catch(() => null);
  const authUserId =
    binding && !binding.error && typeof binding.data?.auth_user_id === "string"
      ? binding.data.auth_user_id.trim()
      : "";
  if (!authUserId) return null;

  const authUserResult = await supabase.auth.admin
    .getUserById(authUserId)
    .catch(() => null);
  const user = authUserResult && !authUserResult.error
    ? authUserResult.data?.user ?? null
    : null;
  if (!user || user.id !== authUserId) return null;
  const summary = {
    id: user.id,
    email: user.email ?? null,
    user_metadata: user.user_metadata ?? null,
    app_metadata: user.app_metadata ?? null,
  } satisfies MerchantAuthUserSummary;
  const authorization = await loadActiveOrdinaryAccountAuthorization(
    supabase,
    summary,
  ).catch(() => null);
  if (
    !authorization ||
    authorization.accountType !== "personal" ||
    authorization.personalAccountId !== normalizedAccountId
  ) {
    return null;
  }
  return readPublicPersonalProfile(summary, normalizedAccountId);
}
