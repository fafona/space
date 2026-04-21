import type { MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";

export type PlatformAccountType = "merchant" | "personal";

export const PERSONAL_ACCOUNT_ID_MIN = 50_010_105;
export const PERSONAL_ACCOUNT_ID_MAX = 59_999_999;
export const PLATFORM_ACCOUNT_ID_REGEX = /^\d{8}$/;

type AuthMetadata = Record<string, unknown> | null | undefined;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readMetadataString(metadata: AuthMetadata, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
}

function cloneMetadata(metadata: AuthMetadata) {
  return metadata && typeof metadata === "object" ? { ...metadata } : {};
}

export function normalizePlatformAccountNumericId(value: unknown) {
  const normalized = trimText(value);
  return PLATFORM_ACCOUNT_ID_REGEX.test(normalized) ? normalized : "";
}

export function isPersonalAccountNumericId(value: unknown) {
  const normalized = normalizePlatformAccountNumericId(value);
  if (!normalized) return false;
  const numericValue = Number(normalized);
  return numericValue >= PERSONAL_ACCOUNT_ID_MIN && numericValue <= PERSONAL_ACCOUNT_ID_MAX;
}

export function normalizePlatformAccountType(
  value: unknown,
  fallback: PlatformAccountType | "" = "merchant",
): PlatformAccountType | "" {
  if (value === "personal") return "personal";
  if (value === "merchant") return "merchant";
  return fallback;
}

export function readPlatformAccountTypeFromMetadata(
  user: MerchantAuthUserSummary | null | undefined,
  fallback: PlatformAccountType | "" = "",
) {
  return normalizePlatformAccountType(
    readMetadataString(user?.user_metadata, "account_type", "accountType") ||
      readMetadataString(user?.app_metadata, "account_type", "accountType"),
    fallback,
  );
}

export function readPlatformAccountIdFromMetadata(user: MerchantAuthUserSummary | null | undefined) {
  return normalizePlatformAccountNumericId(
    readMetadataString(
      user?.user_metadata,
      "account_id",
      "accountId",
      "personal_id",
      "personalId",
      "merchant_id",
      "merchantId",
      "merchantID",
      "login_id",
      "loginId",
    ) ||
      readMetadataString(
        user?.app_metadata,
        "account_id",
        "accountId",
        "personal_id",
        "personalId",
        "merchant_id",
        "merchantId",
        "merchantID",
        "login_id",
        "loginId",
      ),
  );
}

export function readPlatformUsernameFromMetadata(user: MerchantAuthUserSummary | null | undefined) {
  return (
    readMetadataString(user?.user_metadata, "display_name", "displayName", "username", "name") ||
    readMetadataString(user?.app_metadata, "display_name", "displayName", "username", "name")
  );
}

export function buildPlatformAccountMetadataPatch(
  user: MerchantAuthUserSummary | null | undefined,
  accountType: PlatformAccountType,
  accountId: string,
) {
  const normalizedAccountId = normalizePlatformAccountNumericId(accountId);
  const userMetadata = cloneMetadata(user?.user_metadata);
  const appMetadata = cloneMetadata(user?.app_metadata);
  const nextLoginId = normalizedAccountId || trimText(userMetadata.login_id) || trimText(userMetadata.loginId);

  userMetadata.account_type = accountType;
  userMetadata.accountType = accountType;
  userMetadata.account_id = normalizedAccountId;
  userMetadata.accountId = normalizedAccountId;
  userMetadata.login_id = nextLoginId;
  userMetadata.loginId = nextLoginId;

  appMetadata.account_type = accountType;
  appMetadata.accountType = accountType;
  appMetadata.account_id = normalizedAccountId;
  appMetadata.accountId = normalizedAccountId;
  appMetadata.login_id = nextLoginId;
  appMetadata.loginId = nextLoginId;

  if (accountType === "merchant") {
    userMetadata.merchant_id = normalizedAccountId;
    userMetadata.merchantId = normalizedAccountId;
    appMetadata.merchant_id = normalizedAccountId;
    appMetadata.merchantId = normalizedAccountId;
    delete userMetadata.personal_id;
    delete userMetadata.personalId;
    delete appMetadata.personal_id;
    delete appMetadata.personalId;
  } else {
    userMetadata.personal_id = normalizedAccountId;
    userMetadata.personalId = normalizedAccountId;
    appMetadata.personal_id = normalizedAccountId;
    appMetadata.personalId = normalizedAccountId;
    delete userMetadata.merchant_id;
    delete userMetadata.merchantId;
    delete appMetadata.merchant_id;
    delete appMetadata.merchantId;
  }

  return {
    user_metadata: userMetadata,
    app_metadata: appMetadata,
  };
}
