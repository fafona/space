import {
  resolveMerchantIdentityForUser,
  type MerchantAuthUserSummary,
  type MerchantIdentitySupabaseClient,
} from "@/lib/merchantAuthIdentity";
import {
  buildPlatformAccountMetadataPatch,
  isPersonalAccountNumericId,
  normalizePlatformAccountNumericId,
  readPlatformAccountIdFromMetadata,
  readPlatformAccountTypeFromMetadata,
  type PlatformAccountType,
  PERSONAL_ACCOUNT_ID_MAX,
  PERSONAL_ACCOUNT_ID_MIN,
} from "@/lib/platformAccounts";

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

export type PlatformIdentitySupabaseClient = MerchantIdentitySupabaseClient & {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<AdminListUsersResult>;
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
  preferredAccountType?: PlatformAccountType | null;
  preferredAccountId?: string | null;
  preferredMerchantId?: string | null;
  preferredMerchantIds?: string[] | null;
  preferredEmail?: string | null;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (typeof record.code === "string" && record.code === "23505") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return /duplicate key|already exists|unique constraint/i.test(message);
}

async function listAuthUsers(supabase: PlatformIdentitySupabaseClient) {
  const users: MerchantAuthUserSummary[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const chunk = (data?.users ?? []).map((user) => ({
      id: user.id,
      email: user.email ?? null,
      user_metadata: user.user_metadata ?? null,
      app_metadata: user.app_metadata ?? null,
    }));
    users.push(...chunk);
    if (chunk.length < 200) break;
    page += 1;
  }
  return users;
}

async function merchantIdExists(supabase: MerchantIdentitySupabaseClient, accountId: string) {
  const result = await supabase.from("merchants").select("id").eq("id", accountId).limit(1);
  if (result.error) return false;
  if (Array.isArray(result.data)) return result.data.length > 0;
  return Boolean(result.data);
}

async function allocateSequentialPersonalAccountId(supabase: PlatformIdentitySupabaseClient) {
  const authUsers = await listAuthUsers(supabase);
  const usedAccountIds = new Set(
    authUsers
      .map((user) => readPlatformAccountIdFromMetadata(user))
      .filter((value) => isPersonalAccountNumericId(value)),
  );
  let candidate = Math.max(
    PERSONAL_ACCOUNT_ID_MIN,
    ...[...usedAccountIds].map((value) => Number.parseInt(value, 10)).filter(Number.isFinite),
  );
  if (usedAccountIds.size > 0) {
    candidate += 1;
  }
  while (candidate <= PERSONAL_ACCOUNT_ID_MAX) {
    const nextAccountId = String(candidate);
    if (!usedAccountIds.has(nextAccountId) && !(await merchantIdExists(supabase, nextAccountId))) {
      return nextAccountId;
    }
    candidate += 1;
  }
  return "";
}

async function persistPlatformAccountMetadata(
  supabase: PlatformIdentitySupabaseClient,
  user: MerchantAuthUserSummary | null | undefined,
  accountType: PlatformAccountType,
  accountId: string,
) {
  const userId = trimText(user?.id);
  const normalizedAccountId = normalizePlatformAccountNumericId(accountId);
  if (!userId || !normalizedAccountId) return;

  const patch = buildPlatformAccountMetadataPatch(user, accountType, normalizedAccountId);
  const { error } = await supabase.auth.admin.updateUserById(userId, patch);
  if (error && !isDuplicateKeyError(error)) {
    throw error;
  }
}

export async function resolvePlatformAccountIdentityForUser(
  supabase: PlatformIdentitySupabaseClient | null,
  user: MerchantAuthUserSummary | null,
  options: PlatformAccountIdentityOptions = {},
) {
  const metadataAccountType = readPlatformAccountTypeFromMetadata(user, "");
  const currentAccountId = readPlatformAccountIdFromMetadata(user);
  const inferredAccountType =
    metadataAccountType ||
    (isPersonalAccountNumericId(currentAccountId) ? "personal" : currentAccountId ? "merchant" : "");
  const accountType = options.preferredAccountType || inferredAccountType || "merchant";

  if (accountType === "merchant") {
    const merchantIdentity = await resolveMerchantIdentityForUser(supabase, user, {
      preferredMerchantId: options.preferredMerchantId || options.preferredAccountId,
      preferredMerchantIds: options.preferredMerchantIds ?? undefined,
      preferredEmail: options.preferredEmail,
    });
    const merchantId = merchantIdentity.merchantId ?? "";
    if (merchantId && supabase) {
      await persistPlatformAccountMetadata(supabase, user, "merchant", merchantId);
    }
    return {
      accountType: "merchant" as const,
      accountId: merchantId || null,
      merchantId: merchantId || null,
      merchantIds: merchantIdentity.merchantIds,
    };
  }

  let personalAccountId = normalizePlatformAccountNumericId(options.preferredAccountId) || currentAccountId;
  if (!isPersonalAccountNumericId(personalAccountId)) {
    personalAccountId = supabase ? await allocateSequentialPersonalAccountId(supabase) : "";
  }
  if (personalAccountId && supabase) {
    await persistPlatformAccountMetadata(supabase, user, "personal", personalAccountId);
  }
  return {
    accountType: "personal" as const,
    accountId: personalAccountId || null,
    merchantId: null,
    merchantIds: [] as string[],
  };
}
