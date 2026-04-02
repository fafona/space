export const RESET_PASSWORD_EMAIL_REQUEST_STORAGE_KEY = "merchant-space:password-reset-email-request:v1";
const RESET_PASSWORD_EMAIL_REQUEST_TTL_MS = 30 * 60 * 1000;

type ResetPasswordEmailRequest = {
  email: string;
  capturedAt: number;
};

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeResetPasswordEmailRequest(
  input: Partial<ResetPasswordEmailRequest> | null | undefined,
): ResetPasswordEmailRequest | null {
  const email = normalizeEmail(input?.email);
  const capturedAt =
    typeof input?.capturedAt === "number" && Number.isFinite(input.capturedAt) ? input.capturedAt : Date.now();
  if (!email || !email.includes("@")) return null;
  if (Date.now() - capturedAt > RESET_PASSWORD_EMAIL_REQUEST_TTL_MS) return null;
  return {
    email,
    capturedAt,
  };
}

export function persistResetPasswordEmailRequest(email: string | null | undefined) {
  if (typeof window === "undefined") return;
  try {
    const normalized = normalizeResetPasswordEmailRequest({
      email: email ?? undefined,
      capturedAt: Date.now(),
    });
    if (!normalized) {
      window.localStorage.removeItem(RESET_PASSWORD_EMAIL_REQUEST_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(RESET_PASSWORD_EMAIL_REQUEST_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore localStorage write failures.
  }
}

export function readStoredResetPasswordEmailRequest() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RESET_PASSWORD_EMAIL_REQUEST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResetPasswordEmailRequest>;
    const normalized = normalizeResetPasswordEmailRequest(parsed);
    if (!normalized) {
      window.localStorage.removeItem(RESET_PASSWORD_EMAIL_REQUEST_STORAGE_KEY);
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export function clearStoredResetPasswordEmailRequest() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RESET_PASSWORD_EMAIL_REQUEST_STORAGE_KEY);
  } catch {
    // Ignore localStorage cleanup failures.
  }
}
