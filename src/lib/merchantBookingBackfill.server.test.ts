import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantBookingStoredRecord } from "@/lib/merchantBookings";
import {
  buildMerchantBookingBackfillPlan,
  normalizeMerchantBookingBackfillBatchSize,
} from "@/lib/merchantBookingBackfill.server";

function buildRecord(
  id: string,
  overrides: Partial<MerchantBookingStoredRecord> = {},
): MerchantBookingStoredRecord {
  return {
    id,
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
    editToken: `secret-${id}`,
    timeline: [
      {
        id: `evt-${id}`,
        actor: "customer",
        kind: "created",
        at: "2026-07-25T08:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

test("booking backfill batch size is safely bounded", () => {
  assert.equal(normalizeMerchantBookingBackfillBatchSize(undefined), 25);
  assert.equal(normalizeMerchantBookingBackfillBatchSize(0), 1);
  assert.equal(normalizeMerchantBookingBackfillBatchSize(1000), 100);
});

test("booking backfill creates deterministic bounded batches", () => {
  const plan = buildMerchantBookingBackfillPlan({
    merchantId: "10000000",
    bookings: [
      buildRecord("booking-3", {
        createdAt: "2026-07-25T10:00:00.000Z",
        updatedAt: "2026-07-25T10:00:00.000Z",
      }),
      buildRecord("booking-1"),
      buildRecord("booking-2", {
        createdAt: "2026-07-25T09:00:00.000Z",
        updatedAt: "2026-07-25T09:00:00.000Z",
      }),
    ],
    batchSize: 2,
  });

  assert.equal(plan.bookingCount, 3);
  assert.equal(plan.blockers.length, 0);
  assert.deepEqual(
    plan.batches.map((batch) =>
      batch.map((mutation) => mutation.booking.id),
    ),
    [["booking-1", "booking-2"], ["booking-3"]],
  );
  assert.equal(
    JSON.stringify(plan.batches).includes("secret-booking"),
    false,
  );
});

test("booking backfill reports identity, timestamp, appointment and timeline blockers", () => {
  const duplicateTimeline = {
    id: "evt-duplicate",
    actor: "system" as const,
    kind: "updated" as const,
    at: "not-a-date",
  };
  const plan = buildMerchantBookingBackfillPlan({
    merchantId: "10000000",
    bookings: [
      buildRecord("duplicate"),
      buildRecord("duplicate", {
        siteId: "10000001",
        appointmentAt: "2026-02-31T10:00",
        createdAt: "bad",
        updatedAt: "bad",
        merchantTouchedAt: "bad",
        noShowMarkedAt: "bad",
        timeline: [duplicateTimeline, duplicateTimeline],
      }),
    ],
  });

  assert.deepEqual(
    new Set(plan.blockers.map((blocker) => blocker.code)),
    new Set([
      "duplicate_booking_id",
      "merchant_mismatch",
      "invalid_appointment_at",
      "invalid_created_at",
      "invalid_updated_at",
      "invalid_merchant_touched_at",
      "invalid_no_show_marked_at",
      "invalid_timeline_at",
      "duplicate_timeline_event_id",
    ]),
  );
});
