import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantBookingStoredRecord } from "@/lib/merchantBookings";
import {
  mirrorMerchantBookingRecords,
  normalizeMerchantBookingDualWriteSiteIds,
  resolveMerchantBookingDualWriteConfig,
} from "@/lib/merchantBookingDualWrite.server";

function buildRecord(
  overrides: Partial<MerchantBookingStoredRecord> = {},
): MerchantBookingStoredRecord {
  return {
    id: "B10000000202607250001",
    siteId: "10000000",
    siteName: "Test merchant",
    store: "Main store",
    item: "Consultation",
    appointmentAt: "2026-07-26T10:30",
    title: "First visit",
    customerName: "Customer",
    email: "customer@example.com",
    phone: "600000001",
    note: "",
    status: "active",
    createdAt: "2026-07-25T08:00:00.000Z",
    updatedAt: "2026-07-25T08:00:00.000Z",
    editToken: "secret",
    ...overrides,
  };
}

test("booking shadow configuration is off and deny-by-default", () => {
  assert.deepEqual(resolveMerchantBookingDualWriteConfig({}), {
    mode: "off",
    siteIds: [],
    timeoutMs: 2500,
  });
  assert.deepEqual(
    resolveMerchantBookingDualWriteConfig({
      MERCHANT_BOOKING_V1_DUAL_WRITE_MODE: "shadow",
      MERCHANT_BOOKING_V1_DUAL_WRITE_SITE_IDS:
        "10000000, *,bad,10000000,10000001",
      MERCHANT_BOOKING_V1_DUAL_WRITE_TIMEOUT_MS: "50",
    }),
    {
      mode: "shadow",
      siteIds: ["10000000", "10000001"],
      timeoutMs: 250,
    },
  );
});

test("booking shadow site allowlist rejects wildcard and malformed ids", () => {
  assert.deepEqual(
    normalizeMerchantBookingDualWriteSiteIds(
      "10000000,*,1000000,100000000,abcdefgh,10000001",
    ),
    ["10000000", "10000001"],
  );
});

test("booking shadow writer does not call RPC while disabled", async () => {
  let called = false;
  const result = await mirrorMerchantBookingRecords(
    {
      rpc: async () => {
        called = true;
        return {};
      },
    },
    [buildRecord()],
    { config: { mode: "off", siteIds: ["10000000"], timeoutMs: 1000 } },
  );

  assert.equal(called, false);
  assert.deepEqual(result, { status: "disabled", count: 0 });
});

test("booking shadow writer sends only allowlisted records and deduplicates snapshots", async () => {
  const receivedCalls: Array<Record<string, unknown>> = [];
  const result = await mirrorMerchantBookingRecords(
    {
      rpc: async (_name, args) => {
        receivedCalls.push(args);
        return { data: 1 };
      },
    },
    [
      buildRecord(),
      buildRecord({ updatedAt: "2026-07-25T09:00:00.000Z", status: "confirmed" }),
      buildRecord({ siteId: "10000001", id: "other" }),
    ],
    {
      config: { mode: "shadow", siteIds: ["10000000"], timeoutMs: 1000 },
    },
  );

  assert.deepEqual(result, { status: "written", count: 1 });
  const mutations = receivedCalls[0]?.p_mutations;
  assert.equal(Array.isArray(mutations), true);
  assert.equal((mutations as Array<{ booking: { status: string } }>)[0]?.booking.status, "confirmed");
});

test("booking shadow writer reports failures without throwing", async () => {
  const logged: unknown[] = [];
  const result = await mirrorMerchantBookingRecords(
    {
      rpc: async () => ({ error: { message: "rpc unavailable" } }),
    },
    [buildRecord()],
    {
      config: { mode: "shadow", siteIds: ["10000000"], timeoutMs: 1000 },
      logger: (event) => logged.push(event),
    },
  );

  assert.equal(result.status, "failed");
  assert.equal(result.error, "rpc unavailable");
  assert.equal(logged.length, 1);
});

test("booking shadow writer contains mapper failures after the legacy save", async () => {
  let rpcCalled = false;
  const result = await mirrorMerchantBookingRecords(
    {
      rpc: async () => {
        rpcCalled = true;
        return {};
      },
    },
    [buildRecord()],
    {
      config: { mode: "shadow", siteIds: ["10000000"], timeoutMs: 1000 },
      logger: () => {},
      buildMutation: () => {
        throw new Error("invalid legacy snapshot");
      },
    },
  );

  assert.equal(rpcCalled, false);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "invalid legacy snapshot");
});

test("booking shadow writer bounds a stalled RPC", async () => {
  const logged: unknown[] = [];
  const result = await mirrorMerchantBookingRecords(
    {
      rpc: () => new Promise(() => {}),
    },
    [buildRecord()],
    {
      config: { mode: "shadow", siteIds: ["10000000"], timeoutMs: 5 },
      logger: (event) => logged.push(event),
    },
  );

  assert.equal(result.status, "timeout");
  assert.equal(logged.length, 1);
});
