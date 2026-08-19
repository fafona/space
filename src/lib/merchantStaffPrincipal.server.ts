export const MERCHANT_STAFF_PRINCIPAL_TYPE = "merchant_staff";

export type MerchantStaffPrincipalUser = {
  id?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

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
  // Mutable user metadata is never a principal signal, even for denial. The
  // database resolver remains authoritative for staff-registry membership;
  // this immutable marker is only an early defense-in-depth rejection.
  return hasImmutableMerchantStaffPrincipal(user);
}
