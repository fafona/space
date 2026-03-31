import type { Block, MerchantListPublishedSite } from "@/data/homeBlocks";
import {
  MERCHANT_INDUSTRY_OPTIONS,
  MERCHANT_SORT_RULES,
  createDefaultMerchantSortConfig,
  type MerchantIndustry,
  type MerchantSortConfig,
  type MerchantSortRule,
  type PlatformState,
  type Site,
  type SiteLocation,
} from "@/data/platformControlStore";

export const PLATFORM_MERCHANT_SNAPSHOT_SLUG = "__platform_merchant_snapshot__";
const PLATFORM_MERCHANT_SNAPSHOT_BLOCK_ID = "__platform_merchant_snapshot__";
const PLATFORM_MERCHANT_SNAPSHOT_VERSION = 1;

export type PlatformMerchantSnapshotPayload = {
  snapshot: MerchantListPublishedSite[];
  defaultSortRule: MerchantSortRule;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMerchantId(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeMerchantIndustry(value: unknown): MerchantIndustry {
  const normalized = normalizeText(value);
  return MERCHANT_INDUSTRY_OPTIONS.find((item) => item === normalized) ?? "";
}

function normalizeMerchantSortRule(value: unknown): MerchantSortRule {
  const normalized = normalizeText(value);
  return MERCHANT_SORT_RULES.find((item) => item === normalized) ?? "created_desc";
}

function normalizeNullableRank(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(1, Math.round(value));
}

function normalizeMerchantSortConfig(value: unknown): MerchantSortConfig {
  const fallback = createDefaultMerchantSortConfig();
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<MerchantSortConfig>;
  return {
    recommendedCountryRank: normalizeNullableRank(input.recommendedCountryRank),
    recommendedProvinceRank: normalizeNullableRank(input.recommendedProvinceRank),
    recommendedCityRank: normalizeNullableRank(input.recommendedCityRank),
    industryCountryRank: normalizeNullableRank(input.industryCountryRank),
    industryProvinceRank: normalizeNullableRank(input.industryProvinceRank),
    industryCityRank: normalizeNullableRank(input.industryCityRank),
  };
}

function normalizeSiteLocation(value: unknown): SiteLocation {
  if (!value || typeof value !== "object") {
    return {
      countryCode: "",
      country: "",
      provinceCode: "",
      province: "",
      city: "",
    };
  }
  const input = value as Partial<SiteLocation>;
  return {
    countryCode: normalizeText(input.countryCode).toUpperCase(),
    country: normalizeText(input.country),
    provinceCode: normalizeText(input.provinceCode),
    province: normalizeText(input.province),
    city: normalizeText(input.city),
  };
}

function toTimestamp(value: string | null | undefined) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeUnitInterval(value: unknown, fallback = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeSnapshotSite(input: unknown): MerchantListPublishedSite | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<MerchantListPublishedSite>;
  const id = normalizeMerchantId(value.id);
  if (!id) return null;
  const merchantName = normalizeText(value.merchantName);
  const name = normalizeText(value.name) || merchantName || id;
  const domainPrefix = normalizeText(value.domainPrefix).toLowerCase();
  const domainSuffix = normalizeText(value.domainSuffix).toLowerCase();
  return {
    id,
    merchantName,
    domainPrefix,
    domainSuffix,
    name,
    domain: normalizeText(value.domain) || domainPrefix || domainSuffix || id,
    category: normalizeText(value.category),
    industry: normalizeMerchantIndustry(value.industry),
    location: normalizeSiteLocation(value.location),
    contactAddress: normalizeText(value.contactAddress),
    contactName: normalizeText(value.contactName),
    contactPhone: normalizeText(value.contactPhone),
    contactEmail: normalizeText(value.contactEmail),
    merchantCardImageUrl: normalizeText(value.merchantCardImageUrl),
    merchantCardImageOpacity: normalizeUnitInterval(value.merchantCardImageOpacity, 1),
    sortConfig: normalizeMerchantSortConfig(value.sortConfig),
    createdAt: normalizeText(value.createdAt),
  };
}

function sortSnapshotSites(sites: MerchantListPublishedSite[]) {
  return [...sites].sort((left, right) => {
    const delta = toTimestamp(right.createdAt) - toTimestamp(left.createdAt);
    if (delta !== 0) return delta;
    return left.id.localeCompare(right.id, "zh-CN");
  });
}

export function normalizePlatformMerchantSnapshotPayload(input: unknown): PlatformMerchantSnapshotPayload {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawSnapshot = Array.isArray(value.snapshot)
    ? value.snapshot
    : Array.isArray(value.sites)
      ? value.sites
      : Array.isArray(value.publishedMerchantSnapshot)
        ? value.publishedMerchantSnapshot
      : [];
  const snapshot = sortSnapshotSites(rawSnapshot.map((item) => normalizeSnapshotSite(item)).filter((item): item is MerchantListPublishedSite => !!item));
  return {
    snapshot,
    defaultSortRule: normalizeMerchantSortRule(
      value.defaultSortRule ?? value.publishedMerchantDefaultSortRule,
    ),
  };
}

export function buildPlatformMerchantSnapshotPayloadFromSites(
  sites: Site[],
  defaultSortRule: MerchantSortRule = "created_desc",
): PlatformMerchantSnapshotPayload {
  const snapshotItems: MerchantListPublishedSite[] = [];
  sites.forEach((site) => {
    const id = normalizeMerchantId(site.id);
    if (!id) return;
    const merchantName = normalizeText(site.merchantName);
    const domainPrefix = normalizeText(site.domainPrefix ?? site.domainSuffix).toLowerCase();
    const domainSuffix = normalizeText(site.domainSuffix ?? site.domainPrefix).toLowerCase();
    snapshotItems.push({
      id,
      merchantName,
      domainPrefix,
      domainSuffix,
      name: normalizeText(site.name) || merchantName || id,
      domain: normalizeText(site.domain) || domainPrefix || domainSuffix || id,
      category: normalizeText(site.category),
      industry: normalizeMerchantIndustry(site.industry),
      location: normalizeSiteLocation(site.location),
      contactAddress: normalizeText(site.contactAddress),
      contactName: normalizeText(site.contactName),
      contactPhone: normalizeText(site.contactPhone),
      contactEmail: normalizeText(site.contactEmail),
      merchantCardImageUrl: normalizeText(site.merchantCardImageUrl),
      merchantCardImageOpacity: normalizeUnitInterval(site.merchantCardImageOpacity, 1),
      sortConfig: normalizeMerchantSortConfig(site.sortConfig),
      createdAt: normalizeText(site.createdAt),
    } satisfies MerchantListPublishedSite);
  });
  const snapshot = sortSnapshotSites(snapshotItems);

  return {
    snapshot,
    defaultSortRule: normalizeMerchantSortRule(defaultSortRule),
  };
}

export function buildPlatformMerchantSnapshotPayloadFromState(
  state: Pick<PlatformState, "sites" | "homeLayout">,
): PlatformMerchantSnapshotPayload {
  return buildPlatformMerchantSnapshotPayloadFromSites(
    state.sites,
    state.homeLayout?.merchantDefaultSortRule ?? "created_desc",
  );
}

export function buildPlatformMerchantSnapshotBlocks(
  payload: PlatformMerchantSnapshotPayload,
): Block[] {
  return [
    {
      id: PLATFORM_MERCHANT_SNAPSHOT_BLOCK_ID,
      type: "common",
      props: {
        platformMerchantSnapshotVersion: PLATFORM_MERCHANT_SNAPSHOT_VERSION,
        publishedMerchantSnapshot: payload.snapshot,
        publishedMerchantDefaultSortRule: payload.defaultSortRule,
      } as never,
    },
  ];
}

export function buildPlatformMerchantSnapshotSite(
  input: Partial<Site> & {
    id: string;
    merchantName?: string | null;
    domainPrefix?: string | null;
    domainSuffix?: string | null;
    domain?: string | null;
    category?: string | null;
    industry?: MerchantIndustry | null;
    location?: Partial<SiteLocation> | null;
    contactAddress?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    merchantCardImageUrl?: string | null;
    merchantCardImageOpacity?: number | null;
    createdAt?: string | null;
    sortConfig?: Partial<MerchantSortConfig> | null;
    name?: string | null;
  },
): MerchantListPublishedSite | null {
  return normalizeSnapshotSite({
    id: input.id,
    merchantName: input.merchantName,
    domainPrefix: input.domainPrefix,
    domainSuffix: input.domainSuffix,
    name: input.name,
    domain: input.domain,
    category: input.category,
    industry: input.industry,
    location: input.location,
    contactAddress: input.contactAddress,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
    merchantCardImageUrl: input.merchantCardImageUrl,
    merchantCardImageOpacity: input.merchantCardImageOpacity,
    sortConfig: input.sortConfig,
    createdAt: input.createdAt,
  });
}

export function upsertPlatformMerchantSnapshotSite(
  sites: MerchantListPublishedSite[],
  nextSite: MerchantListPublishedSite,
): MerchantListPublishedSite[] {
  return sortSnapshotSites(
    [...sites.filter((site) => site.id !== nextSite.id), nextSite]
      .map((site) => normalizeSnapshotSite(site))
      .filter((site): site is MerchantListPublishedSite => !!site),
  );
}

export function readPlatformMerchantSnapshotFromBlocks(
  blocks: unknown,
): PlatformMerchantSnapshotPayload | null {
  if (!Array.isArray(blocks)) return null;
  const target = blocks.find((item) => {
    if (!item || typeof item !== "object") return false;
    const block = item as { id?: unknown; props?: unknown };
    const blockId = normalizeText(block.id);
    if (blockId === PLATFORM_MERCHANT_SNAPSHOT_BLOCK_ID) return true;
    if (!block.props || typeof block.props !== "object") return false;
    return (block.props as { platformMerchantSnapshotVersion?: unknown }).platformMerchantSnapshotVersion === PLATFORM_MERCHANT_SNAPSHOT_VERSION;
  }) as { props?: unknown } | undefined;

  if (!target?.props || typeof target.props !== "object") return null;
  const payload = normalizePlatformMerchantSnapshotPayload(target.props);
  return payload.snapshot.length > 0 ? payload : null;
}
