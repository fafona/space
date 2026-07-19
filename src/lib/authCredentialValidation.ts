export const AUTH_ACCOUNT_MAX_LENGTH = 320;
export const AUTH_EMAIL_MAX_LENGTH = 254;
export const AUTH_PASSWORD_MIN_LENGTH = 6;
export const AUTH_PASSWORD_MAX_LENGTH = 1024;
export const AUTH_VERIFICATION_CODE_MAX_LENGTH = 12;

export function normalizeAuthAccount(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidAuthAccount(value: string) {
  return (
    value.length > 0 &&
    value.length <= AUTH_ACCOUNT_MAX_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function normalizeAuthEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidAuthEmail(value: string) {
  return (
    value.length > 0 &&
    value.length <= AUTH_EMAIL_MAX_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

export function readAuthPassword(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function isValidAuthPassword(value: string) {
  return value.length >= AUTH_PASSWORD_MIN_LENGTH && value.length <= AUTH_PASSWORD_MAX_LENGTH;
}

export function normalizeAuthVerificationCode(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "") : "";
}

export function isValidAuthVerificationCode(value: string) {
  return /^\d{4,12}$/.test(value);
}

export function isAuthRateLimitError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { status?: unknown; code?: unknown; message?: unknown };
  if (Number(record.status) === 429) return true;
  const text = [record.code, record.message]
    .map((value) => (typeof value === "string" ? value : ""))
    .join(" ");
  return /rate.?limit|too many requests/i.test(text);
}
