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

type PersonalIdentityReference = {
  accountId?: unknown;
  userId?: unknown;
};

function readExactIdentityValue(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return { value: "", invalid: false };
  }
  if (typeof value !== "string" || value !== value.trim() || !value) {
    return { value: "", invalid: true };
  }
  return { value, invalid: false };
}

/**
 * Personal ownership is established only by server-resolved account/Auth IDs.
 * Every identifier already present on the stored record must agree. Records
 * with no canonical identifier are legacy-unattributed; email is deliberately
 * not accepted as an identity key.
 */
export function matchesExactPersonalIdentity(
  stored: PersonalIdentityReference,
  candidate: PersonalIdentityReference,
) {
  const storedAccountId = readExactIdentityValue(stored.accountId);
  const storedUserId = readExactIdentityValue(stored.userId);
  const candidateAccountId = readExactIdentityValue(candidate.accountId);
  const candidateUserId = readExactIdentityValue(candidate.userId);
  if (
    storedAccountId.invalid ||
    storedUserId.invalid ||
    candidateAccountId.invalid ||
    candidateUserId.invalid
  ) {
    return false;
  }
  if (!storedAccountId.value && !storedUserId.value) return false;
  if (
    storedAccountId.value &&
    storedAccountId.value !== candidateAccountId.value
  ) {
    return false;
  }
  if (storedUserId.value && storedUserId.value !== candidateUserId.value) {
    return false;
  }
  return true;
}
