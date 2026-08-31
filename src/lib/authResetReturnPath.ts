export const DEFAULT_AUTH_RESET_RETURN_PATH = "/login";

const AUTH_RESET_RETURN_PATH_PATTERN =
  /^(?:\/login|\/enterprise(?:\/[0-9]{8})?)$/;

export function normalizeAuthResetReturnPath(
  value: unknown,
  fallback = DEFAULT_AUTH_RESET_RETURN_PATH,
) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return AUTH_RESET_RETURN_PATH_PATTERN.test(candidate) ? candidate : fallback;
}

export function resolveAuthResetReturnPath(
  params: URLSearchParams,
  fallback = DEFAULT_AUTH_RESET_RETURN_PATH,
) {
  if (params.getAll("returnTo").length !== 1) return fallback;
  const candidate = params.get("returnTo")?.trim() ?? "";
  return normalizeAuthResetReturnPath(candidate, fallback);
}

export function buildAuthResetRedirectUrl(origin: string, returnTo: string) {
  const url = new URL("/reset-password", origin);
  const safeReturnTo = normalizeAuthResetReturnPath(returnTo);
  url.searchParams.set("returnTo", safeReturnTo);
  return url.toString();
}
