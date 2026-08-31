export const MERCHANT_STAFF_PRINCIPAL_TYPE = "merchant_staff";
export const MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY =
  "merchant_staff_password_initialized";

export type MerchantStaffPrincipalUser = {
  id?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

export type MerchantStaffPrincipalStoreClient = {
  // Supabase builders are intentionally structural so every server-side
  // service-role client can use this guard without importing browser types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export class MerchantStaffPrincipalError extends Error {
  readonly code: "merchant_staff_identity_forbidden" | "merchant_staff_check_unavailable";
  readonly status: 403 | 503;

  constructor(
    code: "merchant_staff_identity_forbidden" | "merchant_staff_check_unavailable",
    status: 403 | 503,
  ) {
    super(code);
    this.name = "MerchantStaffPrincipalError";
    this.code = code;
    this.status = status;
  }
}

function normalizeText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function hasImmutableMerchantStaffPrincipal(
  user: MerchantStaffPrincipalUser | null | undefined,
) {
  return (
    normalizeText(user?.app_metadata?.principal_type, 80).toLowerCase() ===
    MERCHANT_STAFF_PRINCIPAL_TYPE
  );
}

export function hasMerchantStaffPrincipalDenyHint(
  user: MerchantStaffPrincipalUser | null | undefined,
) {
  return (
    hasImmutableMerchantStaffPrincipal(user) ||
    normalizeText(user?.user_metadata?.principal_type, 80).toLowerCase() ===
      MERCHANT_STAFF_PRINCIPAL_TYPE
  );
}

export async function isMerchantStaffPrincipal(
  client: MerchantStaffPrincipalStoreClient | null,
  user: MerchantStaffPrincipalUser | null | undefined,
) {
  if (hasMerchantStaffPrincipalDenyHint(user)) return true;

  const authUserId = normalizeText(user?.id, 80);
  if (!authUserId) {
    throw new MerchantStaffPrincipalError("merchant_staff_check_unavailable", 503);
  }
  if (!client) {
    throw new MerchantStaffPrincipalError("merchant_staff_check_unavailable", 503);
  }

  const result = await client
    .from("merchant_enterprise_employees")
    .select("id")
    .eq("auth_user_id", authUserId)
    .limit(1);
  if (result.error) {
    throw new MerchantStaffPrincipalError("merchant_staff_check_unavailable", 503);
  }
  return Array.isArray(result.data) ? result.data.length > 0 : Boolean(result.data);
}

export async function assertLegacyMerchantIdentityAllowed(
  client: MerchantStaffPrincipalStoreClient | null,
  user: MerchantStaffPrincipalUser | null | undefined,
) {
  if (await isMerchantStaffPrincipal(client, user)) {
    throw new MerchantStaffPrincipalError("merchant_staff_identity_forbidden", 403);
  }
}

export function isMerchantStaffPrincipalError(
  error: unknown,
): error is MerchantStaffPrincipalError {
  return error instanceof MerchantStaffPrincipalError;
}
