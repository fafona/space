import type {
  GoogleBusinessProfileAccount,
  GoogleBusinessProfileClientStatus,
  GoogleBusinessProfileLocation,
} from "@/lib/googleBusinessProfile";
import { findGoogleBusinessProfileLocation } from "@/lib/googleBusinessProfile";
import {
  decryptGoogleBusinessProfileSecret,
  encryptGoogleBusinessProfileSecret,
  isGoogleBusinessProfileCryptoConfigured,
} from "@/lib/googleBusinessProfileCrypto";
import type { GoogleBusinessProfileIntegration } from "@/lib/googleBusinessProfileStore";
import { normalizeGoogleBusinessProfileReviewList } from "@/lib/googleReviews";
import { resolveTrustedPublicOrigin } from "@/lib/requestOrigin";

const GOOGLE_BUSINESS_SCOPE = "https://www.googleapis.com/auth/business.manage";
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const GOOGLE_BUSINESS_INFORMATION_URL = "https://mybusinessbusinessinformation.googleapis.com/v1";
const GOOGLE_REVIEWS_URL = "https://mybusiness.googleapis.com/v4";
const REQUEST_TIMEOUT_MS = 15_000;

type GoogleOAuthTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
};

type AuthorizedJsonResult = {
  integration: GoogleBusinessProfileIntegration;
  payload: unknown;
};

export class GoogleBusinessProfileRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "google_business_profile_request_failed") {
    super(message);
    this.name = "GoogleBusinessProfileRequestError";
    this.status = status;
    this.code = code;
  }
}

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function trimText(value: unknown, maxLength = 4096) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readPositiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isValidHttpUrl(value: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readGoogleError(payload: unknown, fallback: string) {
  const record = toRecord(payload);
  const nested = toRecord(record?.error);
  return (
    trimText(record?.error_description, 1000) ||
    trimText(nested?.message, 1000) ||
    trimText(record?.message, 1000) ||
    trimText(record?.error, 200) ||
    fallback
  );
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new GoogleBusinessProfileRequestError("Google API 请求超时，请稍后重试。", 504, "google_api_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 1000) };
  }
}

function getOAuthClient() {
  return {
    clientId: readEnv("GOOGLE_BUSINESS_PROFILE_CLIENT_ID"),
    clientSecret: readEnv("GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET"),
  };
}

export function isGoogleBusinessProfileConfigured() {
  const client = getOAuthClient();
  return Boolean(client.clientId && client.clientSecret && isGoogleBusinessProfileCryptoConfigured());
}

export function resolveGoogleBusinessProfileRedirectUri(request: Request) {
  const configured = readEnv("GOOGLE_BUSINESS_PROFILE_REDIRECT_URI");
  if (configured && isValidHttpUrl(configured)) return configured;
  return `${resolveTrustedPublicOrigin(request)}/api/google-business-profile/callback`;
}

export function buildGoogleBusinessProfileAuthorizationUrl(input: {
  request: Request;
  state: string;
}) {
  const { clientId } = getOAuthClient();
  if (!isGoogleBusinessProfileConfigured()) {
    throw new GoogleBusinessProfileRequestError(
      "Google 商家资料授权尚未配置。请先配置 OAuth 客户端和令牌加密密钥。",
      503,
      "google_business_profile_not_configured",
    );
  }
  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", resolveGoogleBusinessProfileRedirectUri(input.request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_BUSINESS_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

async function requestOAuthToken(body: URLSearchParams) {
  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const payload = (await readResponsePayload(response)) as GoogleOAuthTokenResponse | null;
  if (!response.ok || !trimText(payload?.access_token, 12_000)) {
    const code = trimText(payload?.error, 200) || "google_oauth_token_failed";
    throw new GoogleBusinessProfileRequestError(readGoogleError(payload, "Google 授权令牌获取失败。"), response.status || 400, code);
  }
  return payload ?? {};
}

function applyOAuthTokenResponse(
  siteId: string,
  payload: GoogleOAuthTokenResponse,
  previous: GoogleBusinessProfileIntegration | null,
) {
  const accessToken = trimText(payload.access_token, 12_000);
  const refreshToken = trimText(payload.refresh_token, 12_000);
  if (!accessToken) throw new GoogleBusinessProfileRequestError("Google 未返回访问令牌。", 400, "google_access_token_missing");
  const now = new Date();
  const expiresIn = readPositiveNumber(payload.expires_in, 3600);
  const previousRefreshToken = previous?.tokens.refreshToken ?? null;
  const nextRefreshToken = refreshToken ? encryptGoogleBusinessProfileSecret(refreshToken) : previousRefreshToken;
  if (!nextRefreshToken) {
    throw new GoogleBusinessProfileRequestError(
      "Google 未返回长期授权令牌，请重新授权并允许离线访问。",
      400,
      "google_refresh_token_missing",
    );
  }
  return {
    version: 1 as const,
    siteId,
    tokens: {
      accessToken: encryptGoogleBusinessProfileSecret(accessToken),
      refreshToken: nextRefreshToken,
      expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
      tokenType: trimText(payload.token_type, 40) || previous?.tokens.tokenType || "Bearer",
      scope: trimText(payload.scope, 1000) || previous?.tokens.scope || GOOGLE_BUSINESS_SCOPE,
    },
    accounts: previous?.accounts ?? [],
    locations: previous?.locations ?? [],
    selectedAccountName: previous?.selectedAccountName ?? "",
    selectedLocationName: previous?.selectedLocationName ?? "",
    snapshot: previous?.snapshot ?? null,
    connectedAt: previous?.connectedAt || now.toISOString(),
    updatedAt: now.toISOString(),
    lastError: "",
    lastErrorAt: "",
  } satisfies GoogleBusinessProfileIntegration;
}

export async function exchangeGoogleBusinessProfileAuthorizationCode(input: {
  request: Request;
  siteId: string;
  code: string;
  previous: GoogleBusinessProfileIntegration | null;
}) {
  const { clientId, clientSecret } = getOAuthClient();
  if (!isGoogleBusinessProfileConfigured()) {
    throw new GoogleBusinessProfileRequestError("Google 商家资料授权尚未配置。", 503, "google_business_profile_not_configured");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: resolveGoogleBusinessProfileRedirectUri(input.request),
  });
  const payload = await requestOAuthToken(body);
  return applyOAuthTokenResponse(input.siteId, payload, input.previous);
}

async function refreshAccessToken(integration: GoogleBusinessProfileIntegration) {
  const refreshTokenRecord = integration.tokens.refreshToken;
  if (!refreshTokenRecord) {
    throw new GoogleBusinessProfileRequestError("Google 授权已失效，请重新连接。", 401, "google_reauthorization_required");
  }
  const { clientId, clientSecret } = getOAuthClient();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: decryptGoogleBusinessProfileSecret(refreshTokenRecord),
    grant_type: "refresh_token",
  });
  const payload = await requestOAuthToken(body);
  return applyOAuthTokenResponse(integration.siteId, payload, integration);
}

async function ensureAccessToken(integration: GoogleBusinessProfileIntegration, forceRefresh = false) {
  const expiresAt = new Date(integration.tokens.expiresAt).getTime();
  const shouldRefresh = forceRefresh || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000;
  const nextIntegration = shouldRefresh ? await refreshAccessToken(integration) : integration;
  return {
    accessToken: decryptGoogleBusinessProfileSecret(nextIntegration.tokens.accessToken),
    integration: nextIntegration,
  };
}

async function authorizedJson(
  integration: GoogleBusinessProfileIntegration,
  url: string,
): Promise<AuthorizedJsonResult> {
  let authorized = await ensureAccessToken(integration);
  let response = await fetchWithTimeout(url, {
    headers: { authorization: `Bearer ${authorized.accessToken}`, accept: "application/json" },
  });
  if (response.status === 401) {
    authorized = await ensureAccessToken(authorized.integration, true);
    response = await fetchWithTimeout(url, {
      headers: { authorization: `Bearer ${authorized.accessToken}`, accept: "application/json" },
    });
  }
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new GoogleBusinessProfileRequestError(
      readGoogleError(payload, "Google Business Profile API 请求失败。"),
      response.status,
      response.status === 403 ? "google_business_profile_access_denied" : "google_business_profile_request_failed",
    );
  }
  return { integration: authorized.integration, payload };
}

function normalizeAccount(value: unknown): GoogleBusinessProfileAccount | null {
  const record = toRecord(value);
  const name = trimText(record?.name, 240);
  if (!/^accounts\//.test(name)) return null;
  return {
    name,
    displayName: trimText(record?.accountName, 240) || trimText(record?.displayName, 240) || name,
    type: trimText(record?.type, 80),
    role: trimText(record?.role, 80),
  };
}

function formatAddress(value: unknown) {
  const record = toRecord(value);
  if (!record) return "";
  const addressLines = Array.isArray(record.addressLines)
    ? record.addressLines.map((item) => trimText(item, 240)).filter(Boolean)
    : [];
  return [
    ...addressLines,
    trimText(record.locality, 160),
    trimText(record.administrativeArea, 160),
    trimText(record.postalCode, 80),
    trimText(record.regionCode, 20),
  ].filter(Boolean).join(", ");
}

function normalizeLocation(value: unknown, accountName: string): GoogleBusinessProfileLocation | null {
  const record = toRecord(value);
  const metadata = toRecord(record?.metadata);
  const name = trimText(record?.name, 240);
  if (!/^locations\//.test(name)) return null;
  return {
    accountName,
    name,
    title: trimText(record?.title, 300) || name,
    address: formatAddress(record?.storefrontAddress),
    mapsUri: trimText(metadata?.mapsUri, 2000),
    newReviewUri: trimText(metadata?.newReviewUri, 2000),
    websiteUri: trimText(record?.websiteUri, 2000),
  };
}

export async function discoverGoogleBusinessProfileResources(integration: GoogleBusinessProfileIntegration) {
  let current = integration;
  const accounts: GoogleBusinessProfileAccount[] = [];
  let accountPageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(GOOGLE_ACCOUNTS_URL);
    url.searchParams.set("pageSize", "20");
    if (accountPageToken) url.searchParams.set("pageToken", accountPageToken);
    const result = await authorizedJson(current, url.toString());
    current = result.integration;
    const record = toRecord(result.payload);
    const pageAccounts = Array.isArray(record?.accounts) ? record.accounts : [];
    pageAccounts.forEach((item) => {
      const account = normalizeAccount(item);
      if (account && !accounts.some((existing) => existing.name === account.name)) accounts.push(account);
    });
    accountPageToken = trimText(record?.nextPageToken, 1000);
    if (!accountPageToken) break;
  }

  const locations: GoogleBusinessProfileLocation[] = [];
  let firstLocationError: unknown = null;
  for (const account of accounts.slice(0, 50)) {
    let locationPageToken = "";
    try {
      for (let page = 0; page < 5; page += 1) {
        const url = new URL(`${GOOGLE_BUSINESS_INFORMATION_URL}/${account.name}/locations`);
        url.searchParams.set("readMask", "name,title,storefrontAddress,metadata,websiteUri");
        url.searchParams.set("pageSize", "100");
        if (locationPageToken) url.searchParams.set("pageToken", locationPageToken);
        const result = await authorizedJson(current, url.toString());
        current = result.integration;
        const record = toRecord(result.payload);
        const pageLocations = Array.isArray(record?.locations) ? record.locations : [];
        pageLocations.forEach((item) => {
          const location = normalizeLocation(item, account.name);
          if (location && !locations.some((existing) => existing.accountName === location.accountName && existing.name === location.name)) {
            locations.push(location);
          }
        });
        locationPageToken = trimText(record?.nextPageToken, 1000);
        if (!locationPageToken) break;
      }
    } catch (error) {
      firstLocationError ??= error;
    }
  }

  if (accounts.length > 0 && locations.length === 0 && firstLocationError) throw firstLocationError;
  const selectedStillExists = findGoogleBusinessProfileLocation(
    locations,
    current.selectedAccountName,
    current.selectedLocationName,
  );
  const singleLocation = locations.length === 1 ? locations[0] : null;
  const selectedLocation = selectedStillExists ?? singleLocation;
  const selectionUnchanged = Boolean(
    selectedLocation &&
      selectedLocation.accountName === current.selectedAccountName &&
      selectedLocation.name === current.selectedLocationName,
  );
  const now = new Date().toISOString();
  return {
    ...current,
    accounts,
    locations,
    selectedAccountName: selectedLocation?.accountName ?? "",
    selectedLocationName: selectedLocation?.name ?? "",
    snapshot: selectionUnchanged ? current.snapshot : null,
    updatedAt: now,
    lastError: "",
    lastErrorAt: "",
  } satisfies GoogleBusinessProfileIntegration;
}

export async function syncGoogleBusinessProfileReviews(integration: GoogleBusinessProfileIntegration) {
  const location = findGoogleBusinessProfileLocation(
    integration.locations,
    integration.selectedAccountName,
    integration.selectedLocationName,
  );
  if (!location) {
    throw new GoogleBusinessProfileRequestError("请先选择要同步评论的 Google 商家地点。", 400, "google_location_not_selected");
  }
  let current = integration;
  const collectedReviews: unknown[] = [];
  let averageRating = 0;
  let totalReviewCount = 0;
  let pageToken = "";
  for (let page = 0; page < 2; page += 1) {
    const url = new URL(`${GOOGLE_REVIEWS_URL}/${location.accountName}/${location.name}/reviews`);
    url.searchParams.set("pageSize", "50");
    url.searchParams.set("orderBy", "updateTime desc");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await authorizedJson(current, url.toString());
    current = result.integration;
    const record = toRecord(result.payload);
    if (Array.isArray(record?.reviews)) collectedReviews.push(...record.reviews);
    const normalized = normalizeGoogleBusinessProfileReviewList(result.payload);
    if (page === 0) {
      averageRating = normalized.averageRating;
      totalReviewCount = normalized.totalReviewCount;
    }
    pageToken = normalized.nextPageToken;
    if (!pageToken) break;
  }
  const normalized = normalizeGoogleBusinessProfileReviewList({
    reviews: collectedReviews,
    averageRating,
    totalReviewCount,
  });
  const syncedAt = new Date().toISOString();
  return {
    ...current,
    snapshot: {
      reviews: normalized.reviews,
      averageRating: normalized.averageRating,
      totalReviewCount: normalized.totalReviewCount,
      syncedAt,
    },
    updatedAt: syncedAt,
    lastError: "",
    lastErrorAt: "",
  } satisfies GoogleBusinessProfileIntegration;
}

export function markGoogleBusinessProfileError(
  integration: GoogleBusinessProfileIntegration,
  error: unknown,
) {
  const now = new Date().toISOString();
  return {
    ...integration,
    updatedAt: now,
    lastError: toGoogleBusinessProfileUserMessage(error),
    lastErrorAt: now,
  } satisfies GoogleBusinessProfileIntegration;
}

export function toGoogleBusinessProfileClientStatus(
  integration: GoogleBusinessProfileIntegration | null,
): GoogleBusinessProfileClientStatus {
  const selectedLocation = integration
    ? findGoogleBusinessProfileLocation(
        integration.locations,
        integration.selectedAccountName,
        integration.selectedLocationName,
      )
    : null;
  return {
    configured: isGoogleBusinessProfileConfigured(),
    connected: Boolean(integration),
    accounts: integration?.accounts ?? [],
    locations: integration?.locations ?? [],
    selectedAccountName: integration?.selectedAccountName ?? "",
    selectedLocationName: integration?.selectedLocationName ?? "",
    selectedLocation,
    snapshot: integration?.snapshot ?? null,
    connectedAt: integration?.connectedAt ?? "",
    updatedAt: integration?.updatedAt ?? "",
    lastError: integration?.lastError ?? "",
    lastErrorAt: integration?.lastErrorAt ?? "",
  };
}

export function toGoogleBusinessProfileUserMessage(error: unknown) {
  if (error instanceof GoogleBusinessProfileRequestError) {
    if (error.code === "invalid_grant" || error.code === "google_reauthorization_required") {
      return "Google 授权已失效，请断开后重新连接。";
    }
    if (error.status === 403 || error.code === "google_business_profile_access_denied") {
      return "Google 拒绝了访问。请确认项目已获 Google Business Profile API 访问资格，并已启用 Account Management、Business Information 和 Business Profile API。";
    }
    if (error.status === 429) return "Google API 请求过于频繁，请稍后再试。";
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : "Google 商家资料操作失败。";
}

export async function revokeGoogleBusinessProfileAuthorization(integration: GoogleBusinessProfileIntegration) {
  const token = integration.tokens.refreshToken
    ? decryptGoogleBusinessProfileSecret(integration.tokens.refreshToken)
    : decryptGoogleBusinessProfileSecret(integration.tokens.accessToken);
  try {
    await fetchWithTimeout(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Local disconnect must still complete when Google's revoke endpoint is temporarily unavailable.
  }
}
