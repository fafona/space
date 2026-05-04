export const FAOLLA_WEB_BUILD_ENV_KEYS = [
  "NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID",
  "FAOLLA_WEB_BUILD_ID",
  "GITHUB_SHA",
] as const;

export const FALLBACK_FAOLLA_WEB_BUILD_ID = "local";

export function normalizeFaollaWebBuildId(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || "";
}

export function resolveFaollaWebBuildId(env: Record<string, string | undefined> = process.env) {
  for (const key of FAOLLA_WEB_BUILD_ENV_KEYS) {
    const value = normalizeFaollaWebBuildId(env[key]);
    if (value) return value;
  }
  return FALLBACK_FAOLLA_WEB_BUILD_ID;
}

export function resolveFaollaWebReleasedAt(env: Record<string, string | undefined> = process.env) {
  const value = normalizeFaollaWebBuildId(env.FAOLLA_WEB_RELEASED_AT);
  if (value) return value;
  return "";
}
