import type {
  GoogleBusinessProfileAccount,
  GoogleBusinessProfileLocation,
  GoogleBusinessProfileReviewSnapshot,
} from "@/lib/googleBusinessProfile";
import type { EncryptedGoogleBusinessProfileSecret } from "@/lib/googleBusinessProfileCrypto";
import { normalizeGoogleReviewAverage, normalizeGoogleReviewItems, normalizeGoogleReviewTotalCount } from "@/lib/googleReviews";

const GOOGLE_BUSINESS_PROFILE_SLUG_PREFIX = "__google_business_profile__:";

export type GoogleBusinessProfileStoredTokens = {
  accessToken: EncryptedGoogleBusinessProfileSecret;
  refreshToken: EncryptedGoogleBusinessProfileSecret | null;
  expiresAt: string;
  tokenType: string;
  scope: string;
};

export type GoogleBusinessProfileIntegration = {
  version: 1;
  siteId: string;
  tokens: GoogleBusinessProfileStoredTokens;
  accounts: GoogleBusinessProfileAccount[];
  locations: GoogleBusinessProfileLocation[];
  selectedAccountName: string;
  selectedLocationName: string;
  snapshot: GoogleBusinessProfileReviewSnapshot | null;
  connectedAt: string;
  updatedAt: string;
  lastError: string;
  lastErrorAt: string;
};

export type GoogleBusinessProfileStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type StoredRow = {
  id?: string | number | null;
  slug?: unknown;
  blocks?: unknown;
};

function trimText(value: unknown, maxLength = 4096) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeEncryptedSecret(value: unknown): EncryptedGoogleBusinessProfileSecret | null {
  const record = toRecord(value);
  if (
    record?.version !== 1 ||
    record.algorithm !== "aes-256-gcm" ||
    !trimText(record.iv, 256) ||
    !trimText(record.authTag, 256) ||
    !trimText(record.ciphertext, 16_000)
  ) {
    return null;
  }
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: trimText(record.iv, 256),
    authTag: trimText(record.authTag, 256),
    ciphertext: trimText(record.ciphertext, 16_000),
  };
}

function normalizeAccounts(value: unknown): GoogleBusinessProfileAccount[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    const record = toRecord(item);
    const name = trimText(record?.name, 240);
    if (!/^accounts\//.test(name)) return [];
    return [{
      name,
      displayName: trimText(record?.displayName, 240),
      type: trimText(record?.type, 80),
      role: trimText(record?.role, 80),
    }];
  });
}

function normalizeLocations(value: unknown): GoogleBusinessProfileLocation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((item) => {
    const record = toRecord(item);
    const accountName = trimText(record?.accountName, 240);
    const name = trimText(record?.name, 240);
    if (!/^accounts\//.test(accountName) || !/^locations\//.test(name)) return [];
    return [{
      accountName,
      name,
      title: trimText(record?.title, 300),
      address: trimText(record?.address, 800),
      mapsUri: trimText(record?.mapsUri, 2000),
      newReviewUri: trimText(record?.newReviewUri, 2000),
      websiteUri: trimText(record?.websiteUri, 2000),
    }];
  });
}

function normalizeSnapshot(value: unknown): GoogleBusinessProfileReviewSnapshot | null {
  const record = toRecord(value);
  if (!record) return null;
  const syncedAt = trimText(record.syncedAt, 80);
  if (!syncedAt) return null;
  const reviews = normalizeGoogleReviewItems(record.reviews, 100);
  return {
    reviews,
    averageRating: normalizeGoogleReviewAverage(record.averageRating, 0),
    totalReviewCount: normalizeGoogleReviewTotalCount(record.totalReviewCount, reviews.length),
    syncedAt,
  };
}

function buildSlug(siteId: string) {
  return `${GOOGLE_BUSINESS_PROFILE_SLUG_PREFIX}${siteId}`;
}

export function normalizeGoogleBusinessProfileIntegration(
  siteId: string,
  value: unknown,
): GoogleBusinessProfileIntegration | null {
  const normalizedSiteId = trimText(siteId, 64);
  const record = toRecord(value);
  const tokenRecord = toRecord(record?.tokens);
  const accessToken = normalizeEncryptedSecret(tokenRecord?.accessToken);
  if (!/^\d{8}$/.test(normalizedSiteId) || !record || !accessToken) return null;
  return {
    version: 1,
    siteId: normalizedSiteId,
    tokens: {
      accessToken,
      refreshToken: normalizeEncryptedSecret(tokenRecord?.refreshToken),
      expiresAt: trimText(tokenRecord?.expiresAt, 80),
      tokenType: trimText(tokenRecord?.tokenType, 40) || "Bearer",
      scope: trimText(tokenRecord?.scope, 1000),
    },
    accounts: normalizeAccounts(record.accounts),
    locations: normalizeLocations(record.locations),
    selectedAccountName: trimText(record.selectedAccountName, 240),
    selectedLocationName: trimText(record.selectedLocationName, 240),
    snapshot: normalizeSnapshot(record.snapshot),
    connectedAt: trimText(record.connectedAt, 80),
    updatedAt: trimText(record.updatedAt, 80),
    lastError: trimText(record.lastError, 2000),
    lastErrorAt: trimText(record.lastErrorAt, 80),
  };
}

async function findStoredRow(supabase: GoogleBusinessProfileStoreClient, siteId: string) {
  const slug = buildSlug(siteId);
  const result = await supabase
    .from("pages")
    .select("id,slug,blocks")
    .eq("merchant_id", siteId)
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(`google_business_profile_store_read_failed:${result.error.message ?? "unknown_error"}`);
  return (result.data ?? null) as StoredRow | null;
}

export async function loadGoogleBusinessProfileIntegration(
  supabase: GoogleBusinessProfileStoreClient,
  siteId: string,
) {
  const normalizedSiteId = trimText(siteId, 64);
  if (!/^\d{8}$/.test(normalizedSiteId)) return null;
  const row = await findStoredRow(supabase, normalizedSiteId);
  return row ? normalizeGoogleBusinessProfileIntegration(normalizedSiteId, row.blocks) : null;
}

export async function saveGoogleBusinessProfileIntegration(
  supabase: GoogleBusinessProfileStoreClient,
  integration: GoogleBusinessProfileIntegration,
) {
  const normalized = normalizeGoogleBusinessProfileIntegration(integration.siteId, integration);
  if (!normalized) throw new Error("google_business_profile_store_payload_invalid");
  const row = await findStoredRow(supabase, normalized.siteId);
  const payload = { blocks: normalized, updated_at: normalized.updatedAt || new Date().toISOString() };
  const result = row?.id
    ? await supabase.from("pages").update(payload).eq("id", row.id)
    : await supabase.from("pages").insert({
        ...payload,
        merchant_id: normalized.siteId,
        slug: buildSlug(normalized.siteId),
      });
  if (result.error) throw new Error(`google_business_profile_store_write_failed:${result.error.message ?? "unknown_error"}`);
  return normalized;
}

export async function deleteGoogleBusinessProfileIntegration(
  supabase: GoogleBusinessProfileStoreClient,
  siteId: string,
) {
  const normalizedSiteId = trimText(siteId, 64);
  if (!/^\d{8}$/.test(normalizedSiteId)) return;
  const result = await supabase
    .from("pages")
    .delete()
    .eq("merchant_id", normalizedSiteId)
    .eq("slug", buildSlug(normalizedSiteId));
  if (result.error) throw new Error(`google_business_profile_store_delete_failed:${result.error.message ?? "unknown_error"}`);
}
