import { createClient } from "@supabase/supabase-js";
import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import { loadStoredPlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "@/lib/platformMerchantSnapshotStore";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { extractMerchantPrefixFromHost } from "@/lib/siteRouting";
import {
  getMerchantServiceState,
  normalizeServiceExpiresAt,
  normalizeSiteStatus,
  type MerchantServiceRestrictionReason,
} from "@/lib/merchantServiceStatus";
import {
  PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  readPlatformMerchantSnapshotFromBlocks,
} from "@/lib/platformMerchantSnapshot";
import { collectPublishedMerchantSnapshotsFromBlocks, mergePublishedMerchantSnapshots, loadPublishedPlatformHomeBlocks } from "@/lib/platformPublished";

type QueryErrorLike = { message?: string } | null;
type QueryResult<T> = { data: T | null; error: QueryErrorLike };
type QueryBuilder<T> = PromiseLike<QueryResult<T[]>> & {
  select: (columns: string) => QueryBuilder<T>;
  is: (column: string, value: unknown) => QueryBuilder<T>;
  eq: (column: string, value: unknown) => QueryBuilder<T>;
  limit: (value: number) => QueryBuilder<T>;
  maybeSingle: () => Promise<QueryResult<T>>;
};
type LooseSupabaseClient = {
  from: <T = Record<string, unknown>>(table: string) => QueryBuilder<T>;
};

type SnapshotRow = {
  blocks?: unknown;
};

export type PublishedMerchantServiceState = {
  siteId: string;
  merchantName: string;
  status: "online" | "maintenance" | "offline";
  serviceExpiresAt: string | null;
  expired: boolean;
  maintenance: boolean;
  reason: MerchantServiceRestrictionReason;
};

function readEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isMissingMerchantIdColumn(message: string) {
  return (
    /column\s+pages\.merchant_id\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]merchant_id['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMerchantNumericId(value: string | null | undefined) {
  return /^\d{8}$/.test(String(value ?? "").trim());
}

function createServerSupabaseClient() {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey =
    readEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  }) as unknown as LooseSupabaseClient;
}

async function loadSnapshotBlocks() {
  const supabase = createServerSupabaseClient();
  if (!supabase) return null;

  const scoped = await supabase
    .from<SnapshotRow>("pages")
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", PLATFORM_MERCHANT_SNAPSHOT_SLUG)
    .limit(1)
    .maybeSingle();
  if (!scoped.error) return scoped.data?.blocks ?? null;

  const scopedMessage = normalizeText(scoped.error?.message);
  if (isMissingMerchantIdColumn(scopedMessage)) {
    const fallback = await supabase
      .from<SnapshotRow>("pages")
      .select("blocks")
      .eq("slug", PLATFORM_MERCHANT_SNAPSHOT_SLUG)
      .limit(1)
      .maybeSingle();
    if (!fallback.error) return fallback.data?.blocks ?? null;
    if (!isMissingSlugColumn(normalizeText(fallback.error?.message))) return null;
  }
  return null;
}

async function loadSnapshotSites() {
  const [homeResult, blocks] = await Promise.all([
    loadPublishedPlatformHomeBlocks().catch(() => ({ blocks: null as SnapshotRow["blocks"] | null, error: "home_snapshot_load_failed" })),
    loadSnapshotBlocks(),
  ]);
  const storedSnapshot = readPlatformMerchantSnapshotFromBlocks(blocks)?.snapshot ?? [];
  const homeSnapshot = Array.isArray(homeResult.blocks) ? collectPublishedMerchantSnapshotsFromBlocks(homeResult.blocks) : [];

  if (homeSnapshot.length === 0) return storedSnapshot;
  if (storedSnapshot.length === 0) return homeSnapshot;

  const mergedCurrent = mergePublishedMerchantSnapshots(homeSnapshot, storedSnapshot);
  const mergedIds = new Set(mergedCurrent.map((site) => site.id));
  const appendedStored = storedSnapshot.filter((site) => !mergedIds.has(site.id));
  return [...mergedCurrent, ...appendedStored];
}

async function loadCurrentSnapshotSites() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) return [] as MerchantListPublishedSite[];
  const payload = await loadStoredPlatformMerchantSnapshot(
    supabase as unknown as PlatformMerchantSnapshotStoreClient,
  ).catch(() => null);
  return payload?.snapshot ?? [];
}

function buildPublishedMerchantServiceState(site: MerchantListPublishedSite): PublishedMerchantServiceState {
  const state = getMerchantServiceState(site.status, site.serviceExpiresAt);
  return {
    siteId: site.id,
    merchantName: normalizeText(site.merchantName) || normalizeText(site.name) || site.id,
    status: normalizeSiteStatus(site.status),
    serviceExpiresAt: normalizeServiceExpiresAt(site.serviceExpiresAt),
    expired: state.expired,
    maintenance: state.maintenance,
    reason: state.reason,
  };
}

function resolveTargetSiteSelector(targetUrl: string) {
  const normalized = normalizeText(targetUrl);
  if (!normalized) return { siteId: "", prefix: "" };
  try {
    const parsed = new URL(normalized);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const firstSegment = segments[0] ?? "";
    const secondSegment = segments[1] ?? "";
    if (firstSegment === "site" && isMerchantNumericId(secondSegment)) {
      return { siteId: secondSegment, prefix: "" };
    }
    if (isMerchantNumericId(firstSegment)) {
      return { siteId: firstSegment, prefix: "" };
    }

    const prefixFromHost = extractMerchantPrefixFromHost(
      parsed.host,
      readEnv("NEXT_PUBLIC_PORTAL_BASE_DOMAIN") || parsed.host,
    );
    if (prefixFromHost) {
      return { siteId: "", prefix: prefixFromHost };
    }

    return { siteId: "", prefix: normalizeText(firstSegment).toLowerCase() };
  } catch {
    return { siteId: "", prefix: "" };
  }
}

export async function loadPublishedMerchantServiceStateBySiteId(siteId: string | null | undefined) {
  const normalizedSiteId = normalizeText(siteId);
  if (!isMerchantNumericId(normalizedSiteId)) return null;
  const snapshot = await loadSnapshotSites();
  const site = snapshot.find((item) => item.id === normalizedSiteId) ?? null;
  return site ? buildPublishedMerchantServiceState(site) : null;
}

export async function loadPublishedMerchantSnapshotSiteBySiteId(siteId: string | null | undefined) {
  const normalizedSiteId = normalizeText(siteId);
  if (!isMerchantNumericId(normalizedSiteId)) return null;
  const snapshot = await loadSnapshotSites();
  return snapshot.find((item) => item.id === normalizedSiteId) ?? null;
}

export async function loadCurrentMerchantSnapshotSiteBySiteId(siteId: string | null | undefined) {
  const normalizedSiteId = normalizeText(siteId);
  if (!isMerchantNumericId(normalizedSiteId)) return null;
  const currentSnapshot = await loadCurrentSnapshotSites();
  const currentSite = currentSnapshot.find((item) => item.id === normalizedSiteId) ?? null;
  if (currentSite) return currentSite;
  return loadPublishedMerchantSnapshotSiteBySiteId(normalizedSiteId);
}

export async function loadPublishedMerchantServiceStatesBySiteIds(siteIds: string[]) {
  const uniqueIds = [...new Set(siteIds.map((item) => normalizeText(item)).filter((item) => isMerchantNumericId(item)))];
  if (uniqueIds.length === 0) return new Map<string, PublishedMerchantServiceState>();
  const snapshot = await loadSnapshotSites();
  const states = new Map<string, PublishedMerchantServiceState>();
  snapshot.forEach((site) => {
    if (!uniqueIds.includes(site.id)) return;
    states.set(site.id, buildPublishedMerchantServiceState(site));
  });
  return states;
}

export async function loadPublishedMerchantServiceStateByTargetUrl(targetUrl: string | null | undefined) {
  const selector = resolveTargetSiteSelector(normalizeText(targetUrl));
  const snapshot = await loadSnapshotSites();
  const site =
    (selector.siteId ? snapshot.find((item) => item.id === selector.siteId) : null) ??
    (selector.prefix
      ? snapshot.find(
          (item) =>
            normalizeText(item.domainPrefix).toLowerCase() === selector.prefix ||
            normalizeText(item.domainSuffix).toLowerCase() === selector.prefix,
        )
      : null) ??
    null;
  return site ? buildPublishedMerchantServiceState(site) : null;
}
