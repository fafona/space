const PERSONAL_LOGIN_PATH = "/login";
const PERSONAL_ACCOUNT_TYPE = "personal";
const INTERNAL_ENTRY_PARAMS = [
  "appShell",
  "__faollaInlineBuild",
  "__faollaWebBuild",
  "nativeBuild",
] as const;

function normalizeLoginFrom(currentHref: string) {
  const trimmed = currentHref.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const hostname = url.hostname.toLowerCase();
    const trustedHostname =
      hostname === "faolla.com" ||
      hostname.endsWith(".faolla.com") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
    if (!trustedHostname) return "";
    for (const param of INTERNAL_ENTRY_PARAMS) url.searchParams.delete(param);
    return url.toString();
  } catch {
    return "";
  }
}

export function buildPersonalLoginHref(currentHref: string) {
  const params = new URLSearchParams({ accountType: PERSONAL_ACCOUNT_TYPE });
  const loginFrom = normalizeLoginFrom(currentHref);
  if (loginFrom) params.set("loginFrom", loginFrom);
  return `${PERSONAL_LOGIN_PATH}?${params.toString()}`;
}
