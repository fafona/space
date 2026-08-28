import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import type { PagePlanConfig } from "./pagePlans";
import { buildCombinedPersistedBlocks } from "./planTemplateRuntime";
import {
  buildMerchantBookingRulesSnapshot,
  buildMerchantBookingRulesSnapshotFromPlanConfigs,
  MERCHANT_BOOKING_RULE_OPTION_MAX_BYTES,
  normalizeMerchantBookingRuleOption,
  projectMerchantBookingRuleSelection,
  resolveMerchantBookingRuleEntry,
  resolveMerchantBookingRuleSelection,
} from "./merchantBookingRules";
import { localizeSystemDefaultText } from "./editorSystemDefaults";

function createBookingBlock(id: string, ranges: string[], labels?: { storeLabel?: string; itemLabel?: string }): Block {
  return {
    id,
    type: "booking",
    props: {
      heading: "在线预约",
      text: "客户可提交预约",
      bookingStoreOptions: ["Faolla"],
      bookingItemOptions: ["咨询预约"],
      ...(labels?.storeLabel ? { bookingStoreLabel: labels.storeLabel } : {}),
      ...(labels?.itemLabel ? { bookingItemLabel: labels.itemLabel } : {}),
      bookingAvailableTimeRanges: ranges,
      bookingTimeSlotRules: ranges.map((timeRange) => ({ timeRange, maxBookings: null })),
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
      storeOptions: ["Faolla"],
      itemOptions: ["\u54a8\u8be2\u9884\u7ea6"],
      titleOptions: ["\u5148\u751f", "\u5973\u58eb"],
      availableTimeRanges: ["09:00-12:00"],
      timeSlotRules: [{ timeRange: "09:00-12:00", maxBookings: null }],
      blockedDates: [],
      holidayDates: [],
      maxBookingsPerSlot: null,
    },
    {
      viewport: "mobile",
      blockId: "booking-mobile",
      storeOptions: ["Faolla"],
      itemOptions: ["\u54a8\u8be2\u9884\u7ea6"],
      titleOptions: ["\u5148\u751f", "\u5973\u58eb"],
      availableTimeRanges: ["14:00-18:00"],
      timeSlotRules: [{ timeRange: "14:00-18:00", maxBookings: null }],
      blockedDates: [],
      holidayDates: [],
      maxBookingsPerSlot: null,
    },
  ]);
});

test("buildMerchantBookingRulesSnapshot keeps custom booking field labels", () => {
  const block = createBookingBlock("booking-custom-labels", ["09:00-12:00"], {
    storeLabel: "场地",
    itemLabel: "时长",
  });

  const snapshot = buildMerchantBookingRulesSnapshot(
    "10000000",
    buildCombinedPersistedBlocks(createPlanConfig([block]), null),
    "2026-04-11T09:00:00.000Z",
  );

  assert.equal(snapshot.entries[0]?.storeLabel, "场地");
  assert.equal(snapshot.entries[0]?.itemLabel, "时长");
});

test("snapshot preserves missing legacy choices so server defaults match the booking block", () => {
  const block = createBookingBlock("booking-legacy-defaults", ["09:00-12:00"]);
  if (block.type !== "booking") throw new Error("expected booking block");
  delete block.props.bookingStoreOptions;
  delete block.props.bookingItemOptions;
  delete block.props.bookingTitleOptions;

  const snapshot = buildMerchantBookingRulesSnapshot(
    "10000000",
    buildCombinedPersistedBlocks(createPlanConfig([block]), null),
    "2026-04-11T09:00:00.000Z",
  );
  const rule = snapshot.entries[0];
  assert.ok(rule);
  assert.equal(rule.storeOptions, undefined);
  assert.equal(rule.itemOptions, undefined);
  assert.equal(rule.titleOptions, undefined);
  assert.deepEqual(
    resolveMerchantBookingRuleSelection(
      {
        store: "Faolla",
        item: "\u54a8\u8be2\u9884\u7ea6",
        title: "\u5148\u751f",
      },
      rule,
      "Faolla",
    ),
    {
      store: "Faolla",
      item: "\u54a8\u8be2\u9884\u7ea6",
      title: "\u5148\u751f",
    },
  );
});

test("buildMerchantBookingRulesSnapshotFromPlanConfigs matches block-based snapshot output", () => {
  const desktopConfig = createPlanConfig([createBookingBlock("booking-desktop", ["09:00-12:00"])]);
  const mobileConfig = createPlanConfig([createBookingBlock("booking-mobile", ["14:00-18:00"])]);
  const combinedBlocks = buildCombinedPersistedBlocks(desktopConfig, mobileConfig);
  const publishedAt = "2026-04-11T09:00:00.000Z";

  assert.deepEqual(
    buildMerchantBookingRulesSnapshotFromPlanConfigs("10000000", desktopConfig, mobileConfig, publishedAt),
    buildMerchantBookingRulesSnapshot("10000000", combinedBlocks, publishedAt),
  );
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
        timeSlotRules: [{ timeRange: "09:00-12:00", maxBookings: null }],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
      {
        viewport: "mobile" as const,
        blockId: "booking-shared",
        availableTimeRanges: ["14:00-18:00"],
        timeSlotRules: [{ timeRange: "14:00-18:00", maxBookings: null }],
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
        timeSlotRules: [{ timeRange: "09:00-12:00", maxBookings: null }],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
      {
        viewport: "mobile" as const,
        blockId: "booking-b",
        availableTimeRanges: ["09:00-12:00"],
        timeSlotRules: [{ timeRange: "09:00-12:00", maxBookings: null }],
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
        timeSlotRules: [{ timeRange: "09:00-12:00", maxBookings: null }],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
      {
        viewport: "mobile" as const,
        blockId: "booking-b",
        availableTimeRanges: ["14:00-18:00"],
        timeSlotRules: [{ timeRange: "14:00-18:00", maxBookings: null }],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
    ],
  };

  assert.equal(resolveMerchantBookingRuleEntry(snapshot, null), null);
});

test("legacy rule resolution treats published choice lists as part of equivalence", () => {
  const snapshot = {
    version: 1 as const,
    siteId: "10000000",
    publishedAt: "2026-04-11T09:00:00.000Z",
    entries: [
      {
        viewport: "desktop" as const,
        blockId: "booking-a",
        storeOptions: ["Main"],
        itemOptions: ["Consultation"],
        titleOptions: ["Mr"],
        availableTimeRanges: ["09:00-12:00"],
        timeSlotRules: [{ timeRange: "09:00-12:00", maxBookings: null }],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
      {
        viewport: "mobile" as const,
        blockId: "booking-b",
        storeOptions: ["Branch"],
        itemOptions: ["Consultation"],
        titleOptions: ["Mr"],
        availableTimeRanges: ["09:00-12:00"],
        timeSlotRules: [{ timeRange: "09:00-12:00", maxBookings: null }],
        blockedDates: [],
        holidayDates: [],
        maxBookingsPerSlot: null,
      },
    ],
  };

  assert.equal(resolveMerchantBookingRuleEntry(snapshot, null), null);
});

test("legacy fallback choices are not equivalent to an explicitly empty published list", () => {
  const baseRule = {
    availableTimeRanges: ["09:00-12:00"],
    timeSlotRules: [{ timeRange: "09:00-12:00", maxBookings: null }],
    blockedDates: [],
    holidayDates: [],
    maxBookingsPerSlot: null,
  };
  const snapshot = {
    version: 1 as const,
    siteId: "10000000",
    publishedAt: "2026-04-11T09:00:00.000Z",
    entries: [
      {
        ...baseRule,
        viewport: "desktop" as const,
        blockId: "legacy",
      },
      {
        ...baseRule,
        viewport: "mobile" as const,
        blockId: "published-empty",
        storeOptions: [],
        itemOptions: [],
        titleOptions: [],
      },
    ],
  };

  assert.equal(resolveMerchantBookingRuleEntry(snapshot, null), null);
});

test("booking choices resolve only exact published values and canonicalize localized defaults", () => {
  const rule = {
    storeOptions: ["Faolla"],
    itemOptions: ["\u54a8\u8be2\u9884\u7ea6"],
    titleOptions: ["\u5148\u751f"],
  };
  const resolved = resolveMerchantBookingRuleSelection(
    {
      store: " Faolla ",
      item: localizeSystemDefaultText("\u54a8\u8be2\u9884\u7ea6", "es"),
      title: localizeSystemDefaultText("\u5148\u751f", "es"),
    },
    rule,
    "Faolla",
  );

  assert.deepEqual(resolved, {
    store: "Faolla",
    item: "\u54a8\u8be2\u9884\u7ea6",
    title: "\u5148\u751f",
  });
  assert.equal(
    resolveMerchantBookingRuleSelection(
      {
        store: "private@example.com",
        item: "+34 600 000 000",
        title: "\u5148\u751f",
      },
      rule,
      "Faolla",
    ),
    null,
  );
});

test("legacy unchanged choices remain editable but never become a trusted projection", () => {
  const rule = {
    storeOptions: ["Main"],
    itemOptions: ["Consultation"],
    titleOptions: ["Mr"],
  };
  assert.deepEqual(
    resolveMerchantBookingRuleSelection(
      { store: "Legacy branch", item: "Consultation", title: "Mr" },
      rule,
      "Faolla",
      { store: "Legacy branch" },
    ),
    { store: "Legacy branch", item: "Consultation", title: "Mr" },
  );
  assert.equal(
    resolveMerchantBookingRuleSelection(
      { store: "Different branch", item: "Consultation", title: "Mr" },
      rule,
      "Faolla",
      { store: "Legacy branch" },
    ),
    null,
  );
  assert.deepEqual(
    projectMerchantBookingRuleSelection(
      {
        store: "private@example.com",
        item: "Consultation",
        title: "+34 600 000 000",
      },
      rule,
      "Faolla",
    ),
    { store: "", item: "Consultation", title: "" },
  );
});

test("booking choice normalization fails closed for controls, byte overflow and explicit empty lists", () => {
  assert.equal(normalizeMerchantBookingRuleOption("Main\u0000Branch"), "");
  assert.equal(
    normalizeMerchantBookingRuleOption(
      "a".repeat(MERCHANT_BOOKING_RULE_OPTION_MAX_BYTES + 1),
    ),
    "",
  );
  assert.equal(
    resolveMerchantBookingRuleSelection(
      { store: "Faolla", item: "\u54a8\u8be2\u9884\u7ea6", title: "\u5148\u751f" },
      { storeOptions: [], itemOptions: [], titleOptions: [] },
      "Faolla",
    ),
    null,
  );
  assert.deepEqual(
    resolveMerchantBookingRuleSelection(
      { store: "Faolla", item: "\u54a8\u8be2\u9884\u7ea6", title: "\u5148\u751f" },
      {},
      "Faolla",
    ),
    { store: "Faolla", item: "\u54a8\u8be2\u9884\u7ea6", title: "\u5148\u751f" },
  );
});
