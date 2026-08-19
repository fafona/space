export const PERSONAL_ACCOUNT_ID_MIN = 50_010_105;
export const PERSONAL_ACCOUNT_ID_MAX = 59_999_999;
export const PERSONAL_ACCOUNT_ID_REGEX = /^\d{8}$/;

/**
 * The 035 table accepts wider text for shadow/backfill compatibility, but the
 * product identity contract is the reserved eight-digit numeric range below.
 * Reject instead of trimming or truncating so every runtime consumer agrees.
 */
export function normalizeCanonicalPersonalAccountId(value: unknown) {
  if (typeof value !== "string" || value !== value.trim()) return "";
  if (!PERSONAL_ACCOUNT_ID_REGEX.test(value)) return "";
  const numericValue = Number(value);
  return numericValue >= PERSONAL_ACCOUNT_ID_MIN &&
    numericValue <= PERSONAL_ACCOUNT_ID_MAX
    ? value
    : "";
}

export function isCanonicalPersonalAccountId(value: unknown) {
  return Boolean(normalizeCanonicalPersonalAccountId(value));
}
