import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantBookingStoredRecord } from "@/lib/merchantBookings";
import { buildMerchantBookingV1Mutation } from "@/lib/merchantBookingsV1";
import { reconcileMerchantBookingStorage } from "@/lib/merchantBookingReconciliation";

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
    customerAccountId: "10000000000001",
    status: "active",
    createdAt: "2026-07-25T08:00:00.000Z",
    updatedAt: "2026-07-25T08:00:00.000Z",
    editToken: "secret",
    timeline: [
      {
        id: "evt-created",
        actor: "customer",
        kind: "created",
        at: "2026-07-25T08:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function buildV1Rows(record: MerchantBookingStoredRecord) {
  const mutation = buildMerchantBookingV1Mutation(record);
  return {
    booking: {
      ...mutation.booking,
      customer_id: mutation.customer ? "00000000-0000-0000-0000-000000000001" : null,
    },
    events: mutation.events.map((event) => ({
      merchant_id: record.siteId,
      booking_id: record.id,
      idempotency_key: event.idempotency_key,
    })),
  };
}

test("booking reconciliation accepts an exact current snapshot and required events", () => {
  const legacy = buildRecord();
  const v1 = buildV1Rows(legacy);
  const report = reconcileMerchantBookingStorage({
    merchantId: "10000000",
    legacyBookings: [legacy],
    v1Bookings: [v1.booking],
    v1Events: v1.events,
  });

  assert.equal(report.isMatch, true);
  assert.equal(report.matchedCount, 1);
  assert.deepEqual(report.missingEventKeys, []);
});

test("booking reconciliation reports missing, unexpected and duplicate rows", () => {
  const legacy = buildRecord();
  const v1 = buildV1Rows(
    buildRecord({
      id: "unexpected",
      customerAccountId: "",
      email: "",
      phone: "",
    }),
  );
  const report = reconcileMerchantBookingStorage({
    merchantId: "10000000",
    legacyBookings: [legacy],
    v1Bookings: [v1.booking, v1.booking],
    v1Events: v1.events,
  });

  assert.deepEqual(report.missingInV1, [legacy.id]);
  assert.deepEqual(report.unexpectedInV1, ["unexpected"]);
  assert.deepEqual(report.duplicateV1Ids, ["unexpected"]);
  assert.equal(report.isMatch, false);
});

test("booking reconciliation detects business field, customer link and event drift", () => {
  const legacy = buildRecord();
  const v1 = buildV1Rows(legacy);
  const report = reconcileMerchantBookingStorage({
    merchantId: "10000000",
    legacyBookings: [legacy],
    v1Bookings: [
      {
        ...v1.booking,
        status: "cancelled",
        appointment_at_local: "2026-07-26T11:30",
        customer_id: null,
      },
    ],
    v1Events: v1.events.slice(0, 1),
  });

  assert.deepEqual(report.mismatches, [
    {
      bookingId: legacy.id,
      fields: ["status", "appointmentAt", "customerLink"],
    },
  ]);
  assert.equal(report.missingEventKeys.length, 1);
  assert.equal(report.isMatch, false);
});

test("booking reconciliation ignores historical snapshot events beyond the current snapshot", () => {
  const legacy = buildRecord();
  const v1 = buildV1Rows(legacy);
  const report = reconcileMerchantBookingStorage({
    merchantId: "10000000",
    legacyBookings: [legacy],
    v1Bookings: [v1.booking],
    v1Events: [
      ...v1.events,
      {
        merchant_id: "10000000",
        booking_id: legacy.id,
        idempotency_key: `legacy-booking-snapshot:10000000:${legacy.id}:older`,
      },
    ],
  });

  assert.equal(report.isMatch, true);
});
