import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantBookingStoredRecord } from "@/lib/merchantBookings";
import {
  buildMerchantBookingV1Mutation,
  sanitizeMerchantBookingV1SourceSnapshot,
} from "@/lib/merchantBookingsV1";

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
    email: " CUSTOMER@example.com ",
    phone: "600000001",
    note: "Window seat",
    customerAccountId: "10000000000001",
    customerUserId: "user-1",
    customerLoginEmail: " LOGIN@example.com ",
    customerGuestHash: "guest-hash",
    bookingBlockId: "block-1",
    bookingViewport: "mobile",
    status: "confirmed",
    createdAt: "2026-07-25T08:00:00.000Z",
    updatedAt: "2026-07-25T09:00:00.000Z",
    merchantTouchedAt: "2026-07-25T08:30:00.000Z",
    editToken: "secret-edit-token",
    noShowMarkedAt: undefined,
    timeline: [
      {
        id: "evt-created",
        actor: "customer",
        kind: "created",
        at: "2026-07-25T08:00:00.000Z",
        toStatus: "active",
      },
      {
        id: "evt-confirmed",
        actor: "merchant",
        kind: "status_changed",
        at: "2026-07-25T09:00:00.000Z",
        fromStatus: "active",
        toStatus: "confirmed",
      },
    ],
    ...overrides,
  };
}

test("booking V1 mutation excludes edit tokens and preserves booking semantics", () => {
  const mutation = buildMerchantBookingV1Mutation(buildRecord());

  assert.equal(mutation.booking.merchant_id, "10000000");
  assert.equal(mutation.booking.appointment_at_local, "2026-07-26T10:30");
  assert.equal(mutation.booking.booking_viewport, "mobile");
  assert.equal(mutation.booking.status, "confirmed");
  assert.equal(mutation.booking.customer_snapshot.loginEmail, "login@example.com");
  assert.equal("editToken" in mutation.booking.source_snapshot, false);
  assert.equal(JSON.stringify(mutation).includes("secret-edit-token"), false);
});

test("booking V1 mutation links an identifiable canonical customer", () => {
  const mutation = buildMerchantBookingV1Mutation(buildRecord());

  assert.deepEqual(mutation.customer, {
    merchant_id: "10000000",
    account_id: "10000000000001",
    auth_user_id: "user-1",
    guest_hash: "guest-hash",
    email: "login@example.com",
    phone: "600000001",
    display_name: "Customer",
    profile: {
      bookingContact: {
        name: "Customer",
        email: "customer@example.com",
        phone: "600000001",
      },
      lastLegacyBookingId: "B10000000202607250001",
    },
    created_at: "2026-07-25T08:00:00.000Z",
    updated_at: "2026-07-25T09:00:00.000Z",
  });
});

test("booking V1 mutation omits a customer when no stable identity exists", () => {
  const mutation = buildMerchantBookingV1Mutation(
    buildRecord({
      customerAccountId: "",
      customerUserId: "",
      customerLoginEmail: "",
      customerGuestHash: "",
      email: "",
      phone: "",
    }),
  );

  assert.equal(mutation.customer, null);
});

test("booking timeline and snapshot events are deterministic and idempotent", () => {
  const record = buildRecord();
  const first = buildMerchantBookingV1Mutation(record);
  const second = buildMerchantBookingV1Mutation(record);

  assert.deepEqual(first.events, second.events);
  assert.equal(first.events.length, 3);
  assert.equal(
    first.events[0]?.idempotency_key,
    "legacy-booking-timeline:10000000:B10000000202607250001:evt-created",
  );
  assert.match(
    first.events[2]?.idempotency_key ?? "",
    /^legacy-booking-snapshot:10000000:B10000000202607250001:[a-f0-9]{24}$/,
  );
});

test("booking source snapshot retains operational state except the edit token", () => {
  const snapshot = sanitizeMerchantBookingV1SourceSnapshot(
    buildRecord({
      confirmationEmailStatus: "sent",
      confirmationEmailSentAt: "2026-07-25T08:01:00.000Z",
      customerReminderProcessedMinutes: [60],
    }),
  );

  assert.equal(snapshot.confirmationEmailStatus, "sent");
  assert.deepEqual(snapshot.customerReminderProcessedMinutes, [60]);
  assert.equal("editToken" in snapshot, false);
});
