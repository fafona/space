import type { MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import type { OrdinaryAccountAuthorizationStoreClient } from "@/lib/ordinaryAccountAuthorization.server";
import {
  buildOrdinaryAccountPlatformIdentity,
  bootstrapActiveOrdinaryAccountAuthorization,
  resolveOrdinaryAccountPlatformIdentity,
} from "@/lib/ordinaryAccountPrincipal.server";
import type { PlatformAccountType } from "@/lib/platformAccounts";

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

type AdminUpdateUserResult = {
  data?: { user?: AuthUserRecord | null } | null;
  error: Error | null;
};

export type PlatformIdentitySupabaseClient =
  OrdinaryAccountAuthorizationStoreClient & {
    auth: {
      admin: {
        listUsers: (params: {
          page: number;
          perPage: number;
        }) => Promise<AdminListUsersResult>;
        updateUserById: (
          userId: string,
          attributes: {
            user_metadata?: Record<string, unknown>;
            app_metadata?: Record<string, unknown>;
          },
        ) => Promise<AdminUpdateUserResult>;
      };
    };
  };

type PlatformAccountIdentityOptions = {
  // Entry, cookie and metadata-derived values are selection hints only. The
  // authoritative resolver must positively bind every returned identifier.
  preferredAccountType?: PlatformAccountType | null;
  preferredAccountId?: string | null;
  preferredMerchantId?: string | null;
  preferredMerchantIds?: string[] | null;
  strictPreferredMerchantId?: boolean;
  preferredEmail?: string | null;
};

export async function resolvePlatformAccountIdentityForUser(
  supabase: PlatformIdentitySupabaseClient | null,
  user: MerchantAuthUserSummary | null,
  options: PlatformAccountIdentityOptions = {},
) {
  // Account type and email are deliberately not passed to the authorization
  // layer. They can help the UI choose an entry but can never establish a
  // merchant or personal principal.
  void options.preferredAccountType;
  void options.preferredEmail;
  return resolveOrdinaryAccountPlatformIdentity(supabase, user, {
    preferredAccountId: options.preferredAccountId,
    preferredMerchantId: options.preferredMerchantId,
    preferredMerchantIds: options.preferredMerchantIds,
    strictPreferredMerchantId: options.strictPreferredMerchantId,
  });
}

export async function bootstrapPlatformAccountIdentityForUser(
  supabase: PlatformIdentitySupabaseClient | null,
  user: MerchantAuthUserSummary | null,
  accountType: PlatformAccountType,
) {
  const authorization = await bootstrapActiveOrdinaryAccountAuthorization(
    supabase,
    user,
    accountType,
  );
  return buildOrdinaryAccountPlatformIdentity(authorization);
}
