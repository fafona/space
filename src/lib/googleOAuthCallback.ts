export type GoogleOAuthUrlTokens = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
};

export type GoogleOAuthUrlErrorDetails = {
  code: string;
  description: string;
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

function readGoogleOAuthParam(href: string, ...keys: string[]) {
  try {
    const url = new URL(href, "https://faolla.com");
    const candidates = [url.searchParams, readParamsFromUrlPart(url.hash)];
    for (const params of candidates) {
      for (const key of keys) {
        const value = (params.get(key) ?? "").trim();
        if (value) return value;
      }
    }
  } catch {
    return "";
  }
  return "";
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

export function readGoogleOAuthUrlCode(href: string) {
  return readGoogleOAuthParam(href, "code");
}

export function readGoogleOAuthUrlError(href: string) {
  return readGoogleOAuthParam(href, "oauth_error", "error_code", "error", "error_description");
}

export function readGoogleOAuthUrlErrorDetails(href: string): GoogleOAuthUrlErrorDetails | null {
  try {
    const url = new URL(href, "https://faolla.com");
    const candidates = [url.searchParams, readParamsFromUrlPart(url.hash)];
    for (const params of candidates) {
      const code = (
        params.get("oauth_error") ??
        params.get("error_code") ??
        params.get("error") ??
        ""
      ).trim();
      const description = (params.get("error_description") ?? "").trim();
      if (code || description) {
        return {
          code: code || description,
          description,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function hasGoogleOAuthCode(href: string) {
  return Boolean(readGoogleOAuthUrlCode(href));
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
      Boolean((hashParams.get("code") ?? "").trim()) ||
      Boolean((hashParams.get("state") ?? "").trim()) ||
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
