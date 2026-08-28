import assert from "node:assert/strict";
import test from "node:test";
import {
  getMerchantBookingMutationRequiredPermissions,
  redactMerchantBookingForBusinessActor,
} from "@/lib/merchantBusinessBookingPermissions";
import {
  attachMerchantBookingTrustedBusinessProjection,
  type MerchantBookingRecord,
} from "@/lib/merchantBookings";

test("booking mutation permissions are derived from all requested actions", () => {
  assert.deepEqual(
    getMerchantBookingMutationRequiredPermissions({ status: "confirmed" }),
    ["bookings.status.manage"],
  );
  assert.deepEqual(
    getMerchantBookingMutationRequiredPermissions({
      updates: {},
      sendCustomerEmail: true,
    }),
    ["bookings.email.send", "bookings.update"],
  );
  assert.deepEqual(
    getMerchantBookingMutationRequiredPermissions({ markTouched: true }),
    ["bookings.view"],
  );
  assert.deepEqual(
    getMerchantBookingMutationRequiredPermissions({
      bookingIds: ["B1"],
      status: "cancelled",
    }),
    ["bookings.status.manage"],
  );
  assert.equal(getMerchantBookingMutationRequiredPermissions({}), null);
});

test("booking projection strips identifiers, contact data and free text", () => {
  const booking = {
    id: "B1",
    siteId: "10000000",
    siteName: "site-marker@example.com",
    store: "store-marker@example.com",
    item: "+34 611 111 111",
    appointmentAt: "2026-08-29T10:00:00.000Z",
    title: "title-marker@example.com",
    customerName: "Private Name",
    email: "private@example.com",
    phone: "+34 600000000",
    note: "private note",
    customerAccountId: "50010105",
    customerUserId: "auth-user",
    customerLoginEmail: "login@example.com",
    customerGuestHash: "secret",
    status: "active",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    customerEmailLogs: [
      {
        id: "mail-1",
        kind: "manual",
        sentAt: "2026-08-28T00:00:00.000Z",
        locale: "zh-CN",
        subject: "Private subject",
        senderName: "Private sender",
      },
    ],
    timeline: [
      {
        id: "event-1",
        actor: "merchant",
        kind: "updated",
        at: "2026-08-28T00:00:00.000Z",
        note: "Private timeline note",
      },
    ],
  } satisfies MerchantBookingRecord;
  const redacted = redactMerchantBookingForBusinessActor(booking, {
    type: "employee",
    businessPermissions: ["bookings.view"],
  });
  assert.equal(redacted.customerName, "客户");
  assert.equal(redacted.siteName, "");
  assert.equal(redacted.store, "");
  assert.equal(redacted.item, "");
  assert.equal(redacted.title, "");
  assert.equal(redacted.email, "");
  assert.equal(redacted.phone, "");
  assert.equal(redacted.note, "");
  assert.equal(redacted.customerAccountId, "");
  assert.deepEqual(redacted.customerEmailLogs, []);
  assert.equal(redacted.timeline?.[0]?.note, undefined);
  assert.equal(redacted.id, booking.id);
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes("marker@example.com"), false);
  assert.equal(serialized.includes("+34 611 111 111"), false);
  assert.equal(serialized.includes("Private"), false);
  assert.equal(
    redactMerchantBookingForBusinessActor(booking, {
      type: "employee",
      businessPermissions: [
        "bookings.view",
        "bookings.customer_data.view",
      ],
    }),
    booking,
  );
});

test("booking projection preserves only server-attached published business fields", () => {
  const booking = attachMerchantBookingTrustedBusinessProjection(
    {
      id: "B2",
      siteId: "10000000",
      siteName: "site-marker@example.com",
      store: "store-marker@example.com",
      item: "+34 611 111 111",
      appointmentAt: "2026-08-29T10:00:00.000Z",
      title: "title-marker@example.com",
      customerName: "Private Name",
      email: "private@example.com",
      phone: "+34 600000000",
      note: "private note",
      status: "active",
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    } satisfies MerchantBookingRecord,
    {
      siteName: "Faolla",
      store: "Main",
      item: "Consultation",
      title: "Mr",
    },
  );

  const redacted = redactMerchantBookingForBusinessActor(booking, {
    type: "employee",
    businessPermissions: ["bookings.view"],
  });
  assert.deepEqual(
    {
      siteName: redacted.siteName,
      store: redacted.store,
      item: redacted.item,
      title: redacted.title,
    },
    {
      siteName: "Faolla",
      store: "Main",
      item: "Consultation",
      title: "Mr",
    },
  );
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes("marker@example.com"), false);
  assert.equal(serialized.includes("+34 611 111 111"), false);
  assert.equal(serialized.includes("private@example.com"), false);
});
