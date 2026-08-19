type AuthMetadata = Record<string, unknown> | null | undefined;

export type MerchantAuthUserSummary = {
  id?: string | null;
  email?: string | null;
  user_metadata?: AuthMetadata;
  app_metadata?: AuthMetadata;
};

export function normalizeMerchantEmail(
  ...values: Array<string | null | undefined>
) {
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized) return normalized;
  }
  return "";
}
