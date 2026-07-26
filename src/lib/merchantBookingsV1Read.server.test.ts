import assert from "node:assert/strict";
import test from "node:test";

import type {
  MerchantBookingRecord,
  MerchantBookingStoredRecord,
} from "@/lib/merchantBookings";
import { sanitizeMerchantBookingV1SourceSnapshot } from "@/lib/merchantBookingsV1";
import {
  convertMerchantBookingV1Rows,
  isMerchantBookingV1ReadEnabled,
  readMerchantBookingsWithV1Verification,
  resolveMerchantBookingV1ReadConfig,
  type MerchantBookingV1ReadEnvelope,
  type MerchantBookingV1ReadEvent,
} from "@/lib/merchantBookingsV1Read.server";

function createStoredBooking(
  overrides: Partial<MerchantBookingStoredRecord> = {},
): MerchantBookingStoredRecord {
  return {
    id: "B10000000202607260001",
    siteId: "10000000",
    siteName: "Faolla",
    bookingBlockId: "booking-main",
    bookingViewport: "mobile",
    store: "Main",
    item: "Haircut",
    appointmentAt: "2026-07-27T10:00",
    title: "Haircut",
    customerName: "Nana",
    email: "member@example.com",
    phone: "600000000",
    note: "",
    customerAccountId: "10000000000001",
    customerUserId: "user-1",
    customerLoginEmail: "member@example.com",
    customerGuestHash: "",
    status: "confirmed",
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:05:00.000Z",
    merchantTouchedAt: "2026-07-26T10:04:00.000Z",
    editToken: "secret-edit-token",
    customerReminderProcessedMinutes: [60],
    merchantReminderProcessedMinutes: [30],
    noShowMarkedAt: undefined,
    customerEmailLogs: [
      {
        id: "email-1",
        kind: "status",
        sentAt: "2026-07-26T10:05:00.000Z",
        locale: "zh-CN",
        subject: "Confirmed",
        senderName: "Faolla",
        status: "confirmed",
      },
    ],
    timeline: [
      {
        id: "timeline-1",
        actor: "merchant",
        kind: "status_changed",
        at: "2026-07-26T10:05:00.000Z",
        fromStatus: "active",
        toStatus: "confirmed",
      },
    ],
    ...overrides,
  };
}

function createPublicBooking(
  overrides: Partial<MerchantBookingStoredRecord> = {},
): MerchantBookingRecord {
  const { editToken, ...record } = createStoredBooking(overrides);
  void editToken;
  return record;
}

function createEnvelope(
  records: MerchantBookingRecord[] = [createPublicBooking()],
  overrides: Partial<MerchantBookingV1ReadEnvelope> = {},
): MerchantBookingV1ReadEnvelope {
  return {
    records,
    ...overrides,
  };
}

test("booking read verification is default-off and exact-merchant only", () => {
  const config = resolveMerchantBookingV1ReadConfig({
    MERCHANT_BOOKING_V1_READ_MODE: "verify",
    MERCHANT_BOOKING_V1_READ_SITE_IDS:
      "10000000,*,bad,20000000,10000000",
    MERCHANT_BOOKING_V1_READ_TIMEOUT_MS: "20",
  });
  assert.deepEqual(config, {
    mode: "verify",
    siteIds: ["10000000", "20000000"],
    timeoutMs: 250,
  });
  assert.equal(isMerchantBookingV1ReadEnabled("10000000", config), true);
  assert.equal(isMerchantBookingV1ReadEnabled("30000000", config), false);
  assert.equal(
    resolveMerchantBookingV1ReadConfig({
      MERCHANT_BOOKING_V1_READ_MODE: "primary",
      MERCHANT_BOOKING_V1_READ_SITE_IDS: "10000000",
    }).mode,
    "off",
  );
});

test("disabled booking verification never invokes the V1 loader", async () => {
  const legacy = createEnvelope();
  let v1Calls = 0;
  const result = await readMerchantBookingsWithV1Verification({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => {
      v1Calls += 1;
      return createEnvelope();
    },
    config: {
      mode: "off",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
  });
  assert.equal(result, legacy);
  assert.equal(v1Calls, 0);
});

test("booking verification records parity but always returns legacy data", async () => {
  const legacy = createEnvelope();
  const events: MerchantBookingV1ReadEvent[] = [];
  const result = await readMerchantBookingsWithV1Verification({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => structuredClone(legacy),
    config: {
      mode: "verify",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
    logger: (event) => events.push(event),
  });
  assert.equal(result, legacy);
  assert.equal(events[0]?.outcome, "match");
  assert.equal(events[0]?.reason, "parity");
  assert.match(events[0]?.observedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Number.isInteger(events[0]?.durationMs), true);
});

test("booking content, order, and window drift all fall back to legacy", async () => {
  const first = createPublicBooking();
  const second = createPublicBooking({
    id: "B10000000202607260002",
    updatedAt: "2026-07-26T10:03:00.000Z",
  });
  const legacy = createEnvelope([first, second], {
    offset: 0,
    limit: 20,
    total: 2,
    hasMore: false,
  });
  const events: MerchantBookingV1ReadEvent[] = [];
  const config = {
    mode: "verify" as const,
    siteIds: ["10000000"],
    timeoutMs: 2500,
  };

  await readMerchantBookingsWithV1Verification({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () =>
      createEnvelope(
        [
          { ...first, title: "Different" },
          second,
        ],
        {
          offset: 0,
          limit: 20,
          total: 2,
          hasMore: false,
        },
      ),
    config,
    logger: (event) => events.push(event),
  });
  await readMerchantBookingsWithV1Verification({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () =>
      createEnvelope([second, first], {
        offset: 0,
        limit: 20,
        total: 2,
        hasMore: false,
      }),
    config,
    logger: (event) => events.push(event),
  });
  await readMerchantBookingsWithV1Verification({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () =>
      createEnvelope([first, second], {
        offset: 0,
        limit: 20,
        total: 3,
        hasMore: true,
      }),
    config,
    logger: (event) => events.push(event),
  });

  assert.deepEqual(
    events.map((event) => event.reason),
    [
      "booking_content_mismatch",
      "booking_order_mismatch",
      "window_metadata_mismatch",
    ],
  );
});

test("booking V1 timeout, failure, and missing result keep legacy data", async () => {
  const legacy = createEnvelope();
  const events: MerchantBookingV1ReadEvent[] = [];
  const config = {
    mode: "verify" as const,
    siteIds: ["10000000"],
    timeoutMs: 1,
  };
  const timeout = await readMerchantBookingsWithV1Verification({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: () =>
      new Promise<MerchantBookingV1ReadEnvelope | null>(() => undefined),
    config,
    logger: (event) => events.push(event),
  });
  const failed = await readMerchantBookingsWithV1Verification({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => {
      throw new Error("database unavailable");
    },
    config,
    logger: (event) => events.push(event),
  });
  const missing = await readMerchantBookingsWithV1Verification({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => null,
    config,
    logger: (event) => events.push(event),
  });
  assert.equal(timeout, legacy);
  assert.equal(failed, legacy);
  assert.equal(missing, legacy);
  assert.deepEqual(
    events.map((event) => event.reason),
    ["v1_timeout", "v1_query_failed", "v1_missing"],
  );
});

test("booking V1 conversion rejects secrets and cross-merchant rows", () => {
  const stored = createStoredBooking();
  const safeSnapshot = sanitizeMerchantBookingV1SourceSnapshot(stored);
  const converted = convertMerchantBookingV1Rows({
    siteId: "10000000",
    rows: [
      {
        merchant_id: "10000000",
        id: stored.id,
        source_snapshot: safeSnapshot,
      },
    ],
    options: {
      includeAutomationState: true,
      includeCustomerEmailLogs: true,
      includeTimeline: true,
    },
  });
  assert.equal(converted[0]?.id, stored.id);
  assert.equal("editToken" in (converted[0] as object), false);

  assert.throws(
    () =>
      convertMerchantBookingV1Rows({
        siteId: "10000000",
        rows: [
          {
            merchant_id: "10000000",
            id: stored.id,
            source_snapshot: {
              ...safeSnapshot,
              editToken: "must-not-be-present",
            },
          },
        ],
      }),
    /merchant_bookings_v1_conversion_failed/,
  );
  assert.throws(
    () =>
      convertMerchantBookingV1Rows({
        siteId: "10000000",
        rows: [
          {
            merchant_id: "20000000",
            id: stored.id,
            source_snapshot: safeSnapshot,
          },
        ],
      }),
    /merchant_bookings_v1_conversion_failed/,
  );
});
