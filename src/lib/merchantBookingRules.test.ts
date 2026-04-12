import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import type { PagePlanConfig } from "./pagePlans";
import { buildCombinedPersistedBlocks } from "./planTemplateRuntime";
import { buildMerchantBookingRulesSnapshot, resolveMerchantBookingRuleEntry } from "./merchantBookingRules";

function createBookingBlock(id: string, ranges: string[]): Block {
  return {
    id,
    type: "booking",
    props: {
      heading: "在线预约",
      text: "客户可提交预约",
      bookingStoreOptions: ["Faolla"],
      bookingItemOptions: ["咨询预约"],
      bookingAvailableTimeRanges: ranges,
      bookingTitleOptions: ["先生", "女士"],
      bookingSubmitLabel: "提交预约",
      bookingUpdateLabel: "修改预约",
      bookingCancelLabel: "取消预约",
      bookingSuccessTitle: "预约提交成功",
      bookingSuccessText: "我们已收到您的预约。",
      bookingNamePlaceholder: "请输入称谓或姓名",
      bookingNotePlaceholder: "可填写备注",
    },
  };
}

function createPlanConfig(blocks: Block[]): PagePlanConfig {
  return {
    activePlanId: "plan-1",
    plans: [
      {
        id: "plan-1",
        name: "方案一",
        blocks,
        pages: [{ id: "page-1", name: "页面1", blocks }],
        activePageId: "page-1",
      },
    ],
  };
}

test("buildMerchantBookingRulesSnapshot extracts booking rules for desktop and mobile independently", () => {
  const desktopBlock = createBookingBlock("booking-desktop", ["09:00-12:00"]);
  const mobileBlock = createBookingBlock("booking-mobile", ["14:00-18:00"]);
  const combinedBlocks = buildCombinedPersistedBlocks(
    createPlanConfig([desktopBlock]),
    createPlanConfig([mobileBlock]),
  );

  const snapshot = buildMerchantBookingRulesSnapshot("10000000", combinedBlocks, "2026-04-11T09:00:00.000Z");

  assert.deepEqual(snapshot.entries, [
    {
      viewport: "desktop",
      blockId: "booking-desktop",
      availableTimeRanges: ["09:00-12:00"],
      blockedDates: [],
      holidayDates: [],
      maxBookingsPerSlot: null,
    },
    {
      viewport: "mobile",
      blockId: "booking-mobile",
      availableTimeRanges: ["14:00-18:00"],
      blockedDates: [],
      holidayDates: [],
      maxBookingsPerSlot: null,
    },
  ]);
});

test("resolveMerchantBookingRuleEntry returns the exact viewport + block rule", () => {
  const snapshot = {
    version: 1 as const,
    siteId: "10000000",
    publishedAt: "2026-04-11T09:00:00.000Z",
    entries: [
      {
        viewport: "desktop" as const,
        blockId: "booking-shared",
        availableTimeRanges: ["09:00-12:00"],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
      {
        viewport: "mobile" as const,
        blockId: "booking-shared",
        availableTimeRanges: ["14:00-18:00"],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
    ],
  };

  assert.deepEqual(resolveMerchantBookingRuleEntry(snapshot, { bookingBlockId: "booking-shared", bookingViewport: "mobile" }), snapshot.entries[1]);
  assert.deepEqual(resolveMerchantBookingRuleEntry(snapshot, { bookingBlockId: "booking-shared", bookingViewport: "desktop" }), snapshot.entries[0]);
});

test("resolveMerchantBookingRuleEntry allows legacy records only when the rules are effectively identical", () => {
  const snapshot = {
    version: 1 as const,
    siteId: "10000000",
    publishedAt: "2026-04-11T09:00:00.000Z",
    entries: [
      {
        viewport: "desktop" as const,
        blockId: "booking-a",
        availableTimeRanges: ["09:00-12:00"],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
      {
        viewport: "mobile" as const,
        blockId: "booking-b",
        availableTimeRanges: ["09:00-12:00"],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
    ],
  };

  assert.equal(resolveMerchantBookingRuleEntry(snapshot, null)?.availableTimeRanges[0], "09:00-12:00");
});

test("resolveMerchantBookingRuleEntry rejects ambiguous legacy matches when rules differ", () => {
  const snapshot = {
    version: 1 as const,
    siteId: "10000000",
    publishedAt: "2026-04-11T09:00:00.000Z",
    entries: [
      {
        viewport: "desktop" as const,
        blockId: "booking-a",
        availableTimeRanges: ["09:00-12:00"],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
      {
        viewport: "mobile" as const,
        blockId: "booking-b",
        availableTimeRanges: ["14:00-18:00"],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
    ],
  };

  assert.equal(resolveMerchantBookingRuleEntry(snapshot, null), null);
});
