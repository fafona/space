import type { Block } from "@/data/homeBlocks";
import { getBlocksForPage, getPagePlanConfigFromBlocks, type PagePlanConfig } from "./pagePlans";
import { getEmbeddedMobilePlanConfig } from "./planTemplateRuntime";
import {
  normalizeMerchantBookingDateOptions,
  normalizeMerchantBookingSlotCapacityRules,
  normalizeMerchantBookingTimeRangeOptions,
  type MerchantBookingSlotCapacityRule,
} from "./merchantBookings";

export const MERCHANT_BOOKING_RULE_VIEWPORTS = ["desktop", "mobile"] as const;
export type MerchantBookingRuleViewport = (typeof MERCHANT_BOOKING_RULE_VIEWPORTS)[number];

export type MerchantBookingRuleLocator = {
  bookingBlockId?: string | null;
  bookingViewport?: MerchantBookingRuleViewport | string | null;
};

export type MerchantBookingRuleSnapshotEntry = {
  viewport: MerchantBookingRuleViewport;
  blockId: string;
  availableTimeRanges: string[];
  blockedDates: string[];
  holidayDates: string[];
  slotCapacityRules: MerchantBookingSlotCapacityRule[];
  maxBookingsPerSlot: number | null;
};

export type MerchantBookingRulesSnapshot = {
  version: 1;
  siteId: string;
  publishedAt: string;
  entries: MerchantBookingRuleSnapshotEntry[];
};

const MERCHANT_BOOKING_RULES_VERSION = 1 as const;

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
  return {
    viewport: entry.viewport,
    blockId: normalizeBlockId(entry.blockId),
    availableTimeRanges: normalizeMerchantBookingTimeRangeOptions(entry.availableTimeRanges),
    blockedDates: normalizeMerchantBookingDateOptions(entry.blockedDates),
    holidayDates: normalizeMerchantBookingDateOptions(entry.holidayDates),
    slotCapacityRules: normalizeMerchantBookingSlotCapacityRules(entry.slotCapacityRules),
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
        availableTimeRanges: Array.isArray(record.availableTimeRanges) ? record.availableTimeRanges : [],
        blockedDates: Array.isArray(record.blockedDates) ? record.blockedDates.filter((entry) => typeof entry === "string") : [],
        holidayDates: Array.isArray(record.holidayDates) ? record.holidayDates.filter((entry) => typeof entry === "string") : [],
        slotCapacityRules: Array.isArray(record.slotCapacityRules) ? record.slotCapacityRules : [],
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
        next.push(
          normalizeEntry({
            viewport,
            blockId,
            availableTimeRanges: block.props.bookingAvailableTimeRanges ?? [],
            blockedDates: block.props.bookingBlockedDates ?? [],
            holidayDates: block.props.bookingHolidayDates ?? [],
            slotCapacityRules: normalizeMerchantBookingSlotCapacityRules(block.props.bookingSlotCapacityRules),
            maxBookingsPerSlot: null,
          }),
        );
      }
    }
  }
  return next;
}

function buildRuleEquivalenceKey(entry: MerchantBookingRuleSnapshotEntry) {
  return JSON.stringify({
    availableTimeRanges: normalizeMerchantBookingTimeRangeOptions(entry.availableTimeRanges),
    blockedDates: [...entry.blockedDates].sort(),
    holidayDates: [...entry.holidayDates].sort(),
    slotCapacityRules: [...normalizeMerchantBookingSlotCapacityRules(entry.slotCapacityRules)].sort((left, right) =>
      left.slot.localeCompare(right.slot),
    ),
    maxBookingsPerSlot: entry.maxBookingsPerSlot ?? null,
  });
}

export function buildMerchantBookingRulesSnapshot(
  siteId: string,
  blocks: Block[],
  publishedAt: string,
): MerchantBookingRulesSnapshot {
  const normalizedSiteId = normalizeSiteId(siteId);
  const normalizedPublishedAt = String(publishedAt ?? "").trim() || new Date().toISOString();
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      version: MERCHANT_BOOKING_RULES_VERSION,
      siteId: normalizedSiteId,
      publishedAt: normalizedPublishedAt,
      entries: [],
    };
  }
  const desktopConfig = getPagePlanConfigFromBlocks(blocks);
  const mobileConfig = getEmbeddedMobilePlanConfig(blocks);
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
