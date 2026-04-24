import {
  normalizePlatformAccountNumericId,
  readPlatformAccountIdFromMetadata,
  readPlatformAccountTypeFromMetadata,
} from "@/lib/platformAccounts";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";

type AuthUserRecord = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

type AdminListUsersResult = {
  data: { users: AuthUserRecord[] } | null;
  error: Error | null;
};

export type PersonalPublicProfileSupabaseClient = {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<AdminListUsersResult>;
    };
  };
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

function readPublicPersonalProfile(user: MerchantAuthUserSummary | null | undefined, accountId: string) {
  const userMetadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : null;
  const appMetadata = user?.app_metadata && typeof user.app_metadata === "object" ? user.app_metadata : null;
  const profile =
    userMetadata?.personal_profile && typeof userMetadata.personal_profile === "object"
      ? (userMetadata.personal_profile as Record<string, unknown>)
      : null;
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
    country: readMetadataString(profile, "country") || readMetadataString(userMetadata, "country"),
    province:
      readMetadataString(profile, "province", "state") || readMetadataString(userMetadata, "province", "state"),
    city: readMetadataString(profile, "city") || readMetadataString(userMetadata, "city"),
    address: readMetadataString(profile, "address", "contactAddress") || readMetadataString(userMetadata, "address", "contactAddress"),
  } satisfies PublicPersonalProfile;
}

export async function loadPublicPersonalProfileByAccountId(
  supabase: PersonalPublicProfileSupabaseClient | null,
  accountId: string,
): Promise<PublicPersonalProfile | null> {
  const normalizedAccountId = normalizePlatformAccountNumericId(accountId);
  if (!supabase || !normalizedAccountId) return null;

  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const users = data?.users ?? [];
    const matched = users.find((user) => {
      const summary = {
        id: user.id,
        email: user.email ?? null,
        user_metadata: user.user_metadata ?? null,
        app_metadata: user.app_metadata ?? null,
      } satisfies MerchantAuthUserSummary;
      return (
        readPlatformAccountTypeFromMetadata(summary, "") === "personal" &&
        readPlatformAccountIdFromMetadata(summary) === normalizedAccountId
      );
    });
    if (matched) {
      return readPublicPersonalProfile(
        {
          id: matched.id,
          email: matched.email ?? null,
          user_metadata: matched.user_metadata ?? null,
          app_metadata: matched.app_metadata ?? null,
        },
        normalizedAccountId,
      );
    }
    if (users.length < 200) break;
    page += 1;
  }

  return null;
}
