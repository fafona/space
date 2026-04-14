export type ResetPasswordRecoveryPayload = {
  accessToken: string;
  refreshToken: string;
  tokenHash: string;
  code: string;
  type: string;
  capturedAt: number;
};

export const RESET_RECOVERY_STORAGE_KEY = "merchant-space:password-reset-recovery:v1";
export const RESET_RECOVERY_STORAGE_TTL_MS = 30 * 60 * 1000;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeResetPasswordRecoveryPayload(
  input: Partial<ResetPasswordRecoveryPayload> | null | undefined,
): ResetPasswordRecoveryPayload | null {
  const accessToken = normalizeText(input?.accessToken);
  const refreshToken = normalizeText(input?.refreshToken);
  const tokenHash = normalizeText(input?.tokenHash);
  const code = normalizeText(input?.code);
  const type = normalizeText(input?.type);
  const capturedAt =
    typeof input?.capturedAt === "number" && Number.isFinite(input.capturedAt) ? input.capturedAt : Date.now();
  if (!accessToken && !tokenHash && !code) return null;
  if (Date.now() - capturedAt > RESET_RECOVERY_STORAGE_TTL_MS) return null;
  return {
    accessToken,
    refreshToken,
    tokenHash,
    code,
    type,
    capturedAt,
  };
}

export function stripDirectResetPasswordRecoveryPayloadTokens(
  payload: ResetPasswordRecoveryPayload | null | undefined,
): ResetPasswordRecoveryPayload | null {
  const normalized = normalizeResetPasswordRecoveryPayload(payload);
  if (!normalized) return null;
  return {
    ...normalized,
    accessToken: "",
    refreshToken: "",
  };
}

export function readResetPasswordRecoveryHashParams(url: URL) {
  return new URLSearchParams(url.hash.replace(/^#/, ""));
}

export function readResetPasswordRecoveryPayloadFromUrl(url: URL) {
  const hashParams = readResetPasswordRecoveryHashParams(url);
  return normalizeResetPasswordRecoveryPayload({
    accessToken: hashParams.get("access_token") ?? "",
    refreshToken: hashParams.get("refresh_token") ?? "",
    tokenHash: url.searchParams.get("token_hash") ?? url.searchParams.get("token") ?? "",
    code: url.searchParams.get("code") ?? "",
    type: hashParams.get("type") ?? url.searchParams.get("type") ?? "",
    capturedAt: Date.now(),
  });
}

export function persistResetPasswordRecoveryPayload(payload: ResetPasswordRecoveryPayload | null) {
  if (typeof window === "undefined") return;
  try {
    const sanitized = stripDirectResetPasswordRecoveryPayloadTokens(payload);
    if (!payload) {
      window.sessionStorage.removeItem(RESET_RECOVERY_STORAGE_KEY);
      return;
    }
    if (!sanitized) {
      window.sessionStorage.removeItem(RESET_RECOVERY_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(RESET_RECOVERY_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore browser storage failures.
  }
}

export function readStoredResetPasswordRecoveryPayload() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RESET_RECOVERY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResetPasswordRecoveryPayload>;
    const normalized = normalizeResetPasswordRecoveryPayload(parsed);
    if (!normalized) {
      window.sessionStorage.removeItem(RESET_RECOVERY_STORAGE_KEY);
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export function clearStoredResetPasswordRecoveryPayload() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RESET_RECOVERY_STORAGE_KEY);
  } catch {
    // Ignore browser storage cleanup failures.
  }
}

export function hasDirectResetPasswordRecoveryPayload(
  payload: ResetPasswordRecoveryPayload | null | undefined,
) {
  if (!payload) return false;
  return Boolean((payload.accessToken && payload.refreshToken) || payload.tokenHash);
}

export function buildResetPasswordRecoveryUrl(
  target: string | URL,
  payload: Partial<ResetPasswordRecoveryPayload> | null | undefined,
) {
  const url = typeof target === "string" ? new URL(target, "http://localhost") : new URL(target.toString());
  const normalized = stripDirectResetPasswordRecoveryPayloadTokens(
    normalizeResetPasswordRecoveryPayload(payload),
  );
  if (!normalized) return url;

  const hashParams = new URLSearchParams();
  if (normalized.type) hashParams.set("type", normalized.type);
  if (normalized.tokenHash) hashParams.set("token_hash", normalized.tokenHash);
  if (normalized.code) hashParams.set("code", normalized.code);
  url.hash = hashParams.toString();
  return url;
}
