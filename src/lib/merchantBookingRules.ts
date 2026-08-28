import type { Block } from "@/data/homeBlocks";
import { getBlocksForPage, getPagePlanConfigFromBlocks, type PagePlanConfig } from "./pagePlans";
import { getEmbeddedMobilePlanConfig } from "./planTemplateRuntime";
import {
  buildDefaultBookingItemOptions,
  buildDefaultBookingStoreOptions,
  buildDefaultBookingTitleOptions,
  normalizeBookingOptionList,
  normalizeMerchantBookingDateList,
  normalizeMerchantBookingTimeRangeOptions,
  normalizeMerchantBookingTimeSlotRules,
  type MerchantBookingTimeSlotRule,
} from "./merchantBookings";
import { canonicalizeSystemDefaultText } from "./editorSystemDefaults";
import { getUtf8ByteLength } from "./merchantProfileBinding";

export const MERCHANT_BOOKING_RULE_VIEWPORTS = ["desktop", "mobile"] as const;
export type MerchantBookingRuleViewport = (typeof MERCHANT_BOOKING_RULE_VIEWPORTS)[number];

export type MerchantBookingRuleLocator = {
  bookingBlockId?: string | null;
  bookingViewport?: MerchantBookingRuleViewport | string | null;
};

export type MerchantBookingRuleSnapshotEntry = {
  viewport: MerchantBookingRuleViewport;
  blockId: string;
  storeLabel?: string;
  itemLabel?: string;
  /** Canonical values copied from the published booking block. Missing arrays
   * are accepted only for snapshots written before this additive field existed. */
  storeOptions?: string[];
  itemOptions?: string[];
  titleOptions?: string[];
  availableTimeRanges: string[];
  timeSlotRules: MerchantBookingTimeSlotRule[];
  blockedDates: string[];
  holidayDates: string[];
  maxBookingsPerSlot: number | null;
};

export type MerchantBookingRulesSnapshot = {
  version: 1;
  siteId: string;
  publishedAt: string;
  entries: MerchantBookingRuleSnapshotEntry[];
};

const MERCHANT_BOOKING_RULES_VERSION = 1 as const;
export const MERCHANT_BOOKING_RULE_OPTION_MAX_BYTES = 160;
const MERCHANT_BOOKING_RULE_OPTION_CONTROL_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

export type MerchantBookingRuleSelection = {
  store: string;
  item: string;
  title: string;
};

export function normalizeMerchantBookingRuleOption(value: unknown) {
  if (typeof value !== "string") return "";
  if (MERCHANT_BOOKING_RULE_OPTION_CONTROL_PATTERN.test(value)) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const canonical = canonicalizeSystemDefaultText(trimmed);
  if (
    typeof canonical !== "string" ||
    !canonical ||
    MERCHANT_BOOKING_RULE_OPTION_CONTROL_PATTERN.test(canonical) ||
    getUtf8ByteLength(canonical) > MERCHANT_BOOKING_RULE_OPTION_MAX_BYTES
  ) {
    return "";
  }
  return canonical;
}

export function normalizeMerchantBookingRuleOptions(
  value: unknown,
  fallback: string[] = [],
) {
  const next: string[] = [];
  normalizeBookingOptionList(value, fallback).forEach((item) => {
    const normalized = normalizeMerchantBookingRuleOption(item);
    if (normalized && !next.includes(normalized)) next.push(normalized);
  });
  return next;
}

export function resolveMerchantBookingRuleOptionSets(
  entry: Pick<
    MerchantBookingRuleSnapshotEntry,
    "storeOptions" | "itemOptions" | "titleOptions"
  >,
  authoritativeSiteName: string,
) {
  const storeOptions = normalizeMerchantBookingRuleOptions(entry.storeOptions);
  const itemOptions = normalizeMerchantBookingRuleOptions(entry.itemOptions);
  const titleOptions = normalizeMerchantBookingRuleOptions(entry.titleOptions);
  return {
    store: Array.isArray(entry.storeOptions)
      ? storeOptions
      : normalizeMerchantBookingRuleOptions(
          undefined,
          buildDefaultBookingStoreOptions(authoritativeSiteName),
        ),
    item: Array.isArray(entry.itemOptions)
      ? itemOptions
      : normalizeMerchantBookingRuleOptions(
          undefined,
          buildDefaultBookingItemOptions(),
        ),
    title: Array.isArray(entry.titleOptions)
      ? titleOptions
      : normalizeMerchantBookingRuleOptions(
          undefined,
          buildDefaultBookingTitleOptions(),
        ),
  } as const;
}

/**
 * Returns canonical published choices. `unchanged` exists only so a normal
 * legacy record can still be edited after its old option was removed; it does
 * not make that legacy value safe for the redacted employee projection.
 */
export function resolveMerchantBookingRuleSelection(
  value: MerchantBookingRuleSelection,
  entry: Pick<
    MerchantBookingRuleSnapshotEntry,
    "storeOptions" | "itemOptions" | "titleOptions"
  >,
  authoritativeSiteName: string,
  unchanged?: Partial<MerchantBookingRuleSelection> | null,
): MerchantBookingRuleSelection | null {
  const allowed = resolveMerchantBookingRuleOptionSets(
    entry,
    authoritativeSiteName,
  );
  const next = {
    store: normalizeMerchantBookingRuleOption(value.store),
    item: normalizeMerchantBookingRuleOption(value.item),
    title: normalizeMerchantBookingRuleOption(value.title),
  };
  if (!next.store || !next.item || !next.title) return null;

  for (const key of ["store", "item", "title"] as const) {
    if (allowed[key].includes(next[key])) continue;
    const previous = normalizeMerchantBookingRuleOption(unchanged?.[key]);
    if (!previous || previous !== next[key]) return null;
  }
  return next;
}

export function projectMerchantBookingRuleSelection(
  value: MerchantBookingRuleSelection,
  entry: Pick<
    MerchantBookingRuleSnapshotEntry,
    "storeOptions" | "itemOptions" | "titleOptions"
  >,
  authoritativeSiteName: string,
): MerchantBookingRuleSelection {
  const allowed = resolveMerchantBookingRuleOptionSets(
    entry,
    authoritativeSiteName,
  );
  const project = (key: keyof MerchantBookingRuleSelection) => {
    const normalized = normalizeMerchantBookingRuleOption(value[key]);
    return normalized && allowed[key].includes(normalized)
      ? String(value[key]).trim()
      : "";
  };
  return {
    store: project("store"),
    item: project("item"),
    title: project("title"),
  };
}

function normalizeSiteId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBlockId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeViewport(value: unknown): MerchantBookingRuleViewport | null {
  return value === "mobile" || value === "desktop" ? value : null;
}

function normalizeEntry(entry: MerchantBookingRuleSnapshotEntry): MerchantBookingRuleSnapshotEntry {
  const timeSlotRules = normalizeMerchantBookingTimeSlotRules(entry.timeSlotRules, entry.availableTimeRanges);
  const storeLabel = typeof entry.storeLabel === "string" ? entry.storeLabel.trim() : "";
  const itemLabel = typeof entry.itemLabel === "string" ? entry.itemLabel.trim() : "";
  return {
    viewport: entry.viewport,
    blockId: normalizeBlockId(entry.blockId),
    ...(storeLabel ? { storeLabel } : {}),
    ...(itemLabel ? { itemLabel } : {}),
    ...(Array.isArray(entry.storeOptions)
      ? { storeOptions: normalizeMerchantBookingRuleOptions(entry.storeOptions) }
      : {}),
    ...(Array.isArray(entry.itemOptions)
      ? { itemOptions: normalizeMerchantBookingRuleOptions(entry.itemOptions) }
      : {}),
    ...(Array.isArray(entry.titleOptions)
      ? { titleOptions: normalizeMerchantBookingRuleOptions(entry.titleOptions) }
      : {}),
    availableTimeRanges: timeSlotRules.map((item) => item.timeRange),
    timeSlotRules,
    blockedDates: normalizeMerchantBookingDateList(entry.blockedDates),
    holidayDates: normalizeMerchantBookingDateList(entry.holidayDates),
    maxBookingsPerSlot:
      typeof entry.maxBookingsPerSlot === "number" && Number.isFinite(entry.maxBookingsPerSlot)
        ? Math.max(1, Math.trunc(entry.maxBookingsPerSlot))
        : null,
  };
}

function normalizeSnapshotEntries(value: unknown): MerchantBookingRuleSnapshotEntry[] {
  if (!Array.isArray(value)) return [];
  const next: MerchantBookingRuleSnapshotEntry[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Partial<MerchantBookingRuleSnapshotEntry>;
    const viewport = normalizeViewport(record.viewport);
    const blockId = normalizeBlockId(record.blockId);
    if (!viewport || !blockId) return;
    next.push(
      normalizeEntry({
        viewport,
        blockId,
        storeLabel: typeof record.storeLabel === "string" ? record.storeLabel : undefined,
        itemLabel: typeof record.itemLabel === "string" ? record.itemLabel : undefined,
        storeOptions: Array.isArray(record.storeOptions)
          ? record.storeOptions
          : undefined,
        itemOptions: Array.isArray(record.itemOptions)
          ? record.itemOptions
          : undefined,
        titleOptions: Array.isArray(record.titleOptions)
          ? record.titleOptions
          : undefined,
        availableTimeRanges: Array.isArray(record.availableTimeRanges) ? record.availableTimeRanges : [],
        timeSlotRules: Array.isArray(record.timeSlotRules) ? record.timeSlotRules : [],
        blockedDates: Array.isArray(record.blockedDates) ? record.blockedDates.filter((entry) => typeof entry === "string") : [],
        holidayDates: Array.isArray(record.holidayDates) ? record.holidayDates.filter((entry) => typeof entry === "string") : [],
        maxBookingsPerSlot:
          typeof record.maxBookingsPerSlot === "number" && Number.isFinite(record.maxBookingsPerSlot)
            ? record.maxBookingsPerSlot
            : null,
      }),
    );
  });
  return next;
}

function collectBookingRuleEntriesFromPlanConfig(
  config: PagePlanConfig | null | undefined,
  viewport: MerchantBookingRuleViewport,
) {
  if (!config) return [] as MerchantBookingRuleSnapshotEntry[];
  const next: MerchantBookingRuleSnapshotEntry[] = [];
  for (const plan of config.plans ?? []) {
    const pages =
      Array.isArray(plan.pages) && plan.pages.length > 0
        ? plan.pages
        : [{ id: plan.activePageId, name: "", blocks: getBlocksForPage(plan, plan.activePageId) }];
    for (const page of pages) {
      for (const block of page.blocks ?? []) {
        if (block.type !== "booking") continue;
        const blockId = normalizeBlockId(block.id);
        if (!blockId) continue;
        const timeSlotRules = normalizeMerchantBookingTimeSlotRules(
          block.props.bookingTimeSlotRules,
          block.props.bookingAvailableTimeRanges ?? [],
        );
        next.push(
          normalizeEntry({
            viewport,
            blockId,
            storeLabel: block.props.bookingStoreLabel,
            itemLabel: block.props.bookingItemLabel,
            ...(block.props.bookingStoreOptions !== undefined
              ? {
                  storeOptions: normalizeMerchantBookingRuleOptions(
                    block.props.bookingStoreOptions,
                  ),
                }
              : {}),
            ...(block.props.bookingItemOptions !== undefined
              ? {
                  itemOptions: normalizeMerchantBookingRuleOptions(
                    block.props.bookingItemOptions,
                  ),
                }
              : {}),
            ...(block.props.bookingTitleOptions !== undefined
              ? {
                  titleOptions: normalizeMerchantBookingRuleOptions(
                    block.props.bookingTitleOptions,
                  ),
                }
              : {}),
            availableTimeRanges: timeSlotRules.map((item) => item.timeRange),
            timeSlotRules,
            blockedDates: block.props.bookingBlockedDates ?? [],
            holidayDates: block.props.bookingHolidayDates ?? [],
            maxBookingsPerSlot: null,
          }),
        );
      }
    }
  }
  return next;
}

function buildRuleEquivalenceKey(entry: MerchantBookingRuleSnapshotEntry) {
  const optionKey = (value: string[] | undefined) =>
    Array.isArray(value)
      ? { source: "published", values: normalizeMerchantBookingRuleOptions(value).sort() }
      : { source: "legacy-default" };
  return JSON.stringify({
    storeOptions: optionKey(entry.storeOptions),
    itemOptions: optionKey(entry.itemOptions),
    titleOptions: optionKey(entry.titleOptions),
    availableTimeRanges: normalizeMerchantBookingTimeRangeOptions(entry.availableTimeRanges),
    timeSlotRules: normalizeMerchantBookingTimeSlotRules(entry.timeSlotRules, entry.availableTimeRanges),
    blockedDates: [...entry.blockedDates].sort(),
    holidayDates: [...entry.holidayDates].sort(),
    maxBookingsPerSlot: entry.maxBookingsPerSlot ?? null,
  });
}

export function buildMerchantBookingRulesSnapshotFromPlanConfigs(
  siteId: string,
  desktopConfig: PagePlanConfig | null | undefined,
  mobileConfig: PagePlanConfig | null | undefined,
  publishedAt: string,
): MerchantBookingRulesSnapshot {
  const normalizedSiteId = normalizeSiteId(siteId);
  const normalizedPublishedAt = String(publishedAt ?? "").trim() || new Date().toISOString();
  return {
    version: MERCHANT_BOOKING_RULES_VERSION,
    siteId: normalizedSiteId,
    publishedAt: normalizedPublishedAt,
    entries: [
      ...collectBookingRuleEntriesFromPlanConfig(desktopConfig, "desktop"),
      ...collectBookingRuleEntriesFromPlanConfig(mobileConfig, "mobile"),
    ],
  };
}

export function buildMerchantBookingRulesSnapshot(
  siteId: string,
  blocks: Block[],
  publishedAt: string,
): MerchantBookingRulesSnapshot {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return buildMerchantBookingRulesSnapshotFromPlanConfigs(siteId, null, null, publishedAt);
  }
  const desktopConfig = getPagePlanConfigFromBlocks(blocks);
  const mobileConfig = getEmbeddedMobilePlanConfig(blocks);
  return buildMerchantBookingRulesSnapshotFromPlanConfigs(siteId, desktopConfig, mobileConfig, publishedAt);
}

export function normalizeMerchantBookingRulesSnapshot(value: unknown): MerchantBookingRulesSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<MerchantBookingRulesSnapshot>;
  const siteId = normalizeSiteId(record.siteId);
  if (!siteId) return null;
  return {
    version: MERCHANT_BOOKING_RULES_VERSION,
    siteId,
    publishedAt: String(record.publishedAt ?? "").trim() || "",
    entries: normalizeSnapshotEntries(record.entries),
  };
}

export function resolveMerchantBookingRuleEntry(
  snapshot: MerchantBookingRulesSnapshot | null | undefined,
  locator?: MerchantBookingRuleLocator | null,
): MerchantBookingRuleSnapshotEntry | null {
  const entries = snapshot?.entries ?? [];
  if (entries.length === 0) return null;
  const bookingBlockId = normalizeBlockId(locator?.bookingBlockId);
  const bookingViewport = normalizeViewport(locator?.bookingViewport);

  let candidates = entries;
  if (bookingViewport) {
    const byViewport = entries.filter((entry) => entry.viewport === bookingViewport);
    if (byViewport.length === 0) return null;
    candidates = byViewport;
  }
  if (bookingBlockId) {
    const byBlock = candidates.filter((entry) => entry.blockId === bookingBlockId);
    if (byBlock.length === 1) return byBlock[0] ?? null;
    if (byBlock.length > 1) {
      const firstKey = buildRuleEquivalenceKey(byBlock[0]);
      if (byBlock.every((entry) => buildRuleEquivalenceKey(entry) === firstKey)) {
        return byBlock[0] ?? null;
      }
      return null;
    }
    return null;
  }
  if (candidates.length === 1) return candidates[0] ?? null;
  const firstKey = buildRuleEquivalenceKey(candidates[0]);
  if (candidates.every((entry) => buildRuleEquivalenceKey(entry) === firstKey)) {
    return candidates[0] ?? null;
  }
  return null;
}
