export type GoogleOAuthUrlTokens = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
};

const GOOGLE_OAUTH_TRANSIENT_SEARCH_PARAMS = [
  "code",
  "state",
  "oauth",
  "oauth_error",
  "error",
  "error_code",
  "error_description",
];

function readParamsFromUrlPart(value: string) {
  const trimmed = String(value ?? "").replace(/^[?#]/, "");
  return new URLSearchParams(trimmed);
}

function readPositiveNumber(value: string | null) {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function readGoogleOAuthUrlTokens(href: string): GoogleOAuthUrlTokens | null {
  try {
    const url = new URL(href, "https://faolla.com");
    const candidates = [readParamsFromUrlPart(url.hash), url.searchParams];
    for (const params of candidates) {
      const accessToken = (params.get("access_token") ?? "").trim();
      const refreshToken = (params.get("refresh_token") ?? "").trim();
      if (!accessToken || !refreshToken) continue;
      const tokenType = (params.get("token_type") ?? "").trim();
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: readPositiveNumber(params.get("expires_in")),
        token_type: tokenType || undefined,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function hasGoogleOAuthCode(href: string) {
  try {
    return Boolean((new URL(href, "https://faolla.com").searchParams.get("code") ?? "").trim());
  } catch {
    return false;
  }
}

export function hasGoogleOAuthReturnPayload(href: string) {
  try {
    const url = new URL(href, "https://faolla.com");
    const hashParams = readParamsFromUrlPart(url.hash);
    return (
      Boolean((url.searchParams.get("code") ?? "").trim()) ||
      Boolean((url.searchParams.get("state") ?? "").trim()) ||
      Boolean((url.searchParams.get("error") ?? url.searchParams.get("error_code") ?? "").trim()) ||
      Boolean((url.searchParams.get("oauth_error") ?? "").trim()) ||
      Boolean((hashParams.get("access_token") ?? "").trim()) ||
      Boolean((hashParams.get("refresh_token") ?? "").trim()) ||
      Boolean((hashParams.get("error") ?? hashParams.get("error_code") ?? "").trim())
    );
  } catch {
    return false;
  }
}

export function buildCleanGoogleOAuthReturnPath(href: string) {
  try {
    const url = new URL(href, "https://faolla.com");
    for (const key of GOOGLE_OAUTH_TRANSIENT_SEARCH_PARAMS) {
      url.searchParams.delete(key);
    }
    url.hash = "";
    return `${url.pathname}${url.search}${url.hash}` || "/login";
  } catch {
    return "/login";
  }
}
