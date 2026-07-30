import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantBookingRecord } from "@/lib/merchantBookings";
import type { MerchantMembershipRecord } from "@/lib/merchantMemberships";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import {
  buildMerchantCustomerDirectory,
  createEmptyMerchantCustomerProfile,
  upsertMerchantCustomerProfiles,
} from "@/lib/merchantCustomers";

const SITE_ID = "10000000";

function createOrder(
  overrides: Partial<MerchantOrderRecord> = {},
): MerchantOrderRecord {
  return {
    id: "order-1",
    siteId: SITE_ID,
    siteName: "Test",
    blockId: "products",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    status: "completed",
    customer: {
      name: "Nana",
      phone: "+34 600 000 001",
      email: "NANA@example.com",
      note: "Order note",
    },
    items: [],
    totalQuantity: 1,
    totalAmount: 35.5,
    pricePrefix: "EUR",
    confirmedAt: null,
    completedAt: "2026-07-01T10:10:00.000Z",
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
    ...overrides,
  };
}

function createBooking(
  overrides: Partial<MerchantBookingRecord> = {},
): MerchantBookingRecord {
  return {
    id: "booking-1",
    siteId: SITE_ID,
    siteName: "Test",
    store: "Main store",
    item: "Haircut",
    appointmentAt: "2026-07-05T12:00:00.000Z",
    title: "Appointment",
    customerName: "Nana",
    email: "nana@example.com",
    phone: "0034 600 000 001",
    note: "Booking note",
    status: "confirmed",
    createdAt: "2026-07-02T09:00:00.000Z",
    updatedAt: "2026-07-02T09:00:00.000Z",
    ...overrides,
  };
}

function createMembership(
  overrides: Partial<MerchantMembershipRecord> = {},
): MerchantMembershipRecord {
  return {
    id: "membership-1",
    siteId: SITE_ID,
    siteName: "Test",
    memberNo: "M0001",
    serial: 1,
    accountId: "account-1",
    userId: "user-1",
    email: "nana@example.com",
    nickname: "Nana",
    name: "Nana Member",
    phone: "+34600000001",
    avatarUrl: "",
    birthday: "1990-01-01",
    birthdayMonthDayOnly: false,
    gender: "",
    country: "Spain",
    province: "Sevilla",
    city: "Sevilla",
    address: "Calle Test 1",
    taxName: "Nana Member",
    taxNumber: "X0000001X",
    taxCountry: "Spain",
    taxProvince: "Sevilla",
    taxCity: "Sevilla",
    taxAddress: "Calle Test 1",
    allergens: [],
    pointBalance: 100,
    balanceAmount: 20,
    growthValue: 10,
    levelId: "",
    transactions: [],
    status: "active",
    joinedAt: "2026-06-01T00:00:00.000Z",
    leftAt: null,
    updatedAt: "2026-07-03T00:00:00.000Z",
    ...overrides,
  };
}

test("customer directory merges the same customer across orders bookings and memberships", () => {
  const customers = buildMerchantCustomerDirectory({
    siteId: SITE_ID,
    orders: [createOrder()],
    bookings: [createBooking()],
    memberships: [createMembership()],
  });

  assert.equal(customers.length, 1);
  assert.equal(customers[0]?.displayName, "Nana Member");
  assert.equal(customers[0]?.address.line1, "Calle Test 1");
  assert.equal(customers[0]?.tax.number, "X0000001X");
  assert.equal(customers[0]?.activity.orderCount, 1);
  assert.equal(customers[0]?.activity.bookingCount, 1);
  assert.deepEqual(customers[0]?.activity.orderTotals, [{ label: "EUR", amount: 35.5 }]);
  assert.ok(customers[0]?.sources.includes("order"));
  assert.ok(customers[0]?.sources.includes("booking"));
  assert.ok(customers[0]?.sources.includes("membership"));
});

test("customer directory does not merge unrelated name-only customers", () => {
  const customers = buildMerchantCustomerDirectory({
    siteId: SITE_ID,
    orders: [
      createOrder({
        id: "order-a",
        customer: { name: "Guest", phone: "", email: "", note: "" },
      }),
      createOrder({
        id: "order-b",
        customer: { name: "Guest", phone: "", email: "", note: "" },
      }),
    ],
  });

  assert.equal(customers.length, 2);
});

test("customer directory keeps anonymous guest orders linked by guest identity", () => {
  const customers = buildMerchantCustomerDirectory({
    siteId: SITE_ID,
    orders: [
      createOrder({
        id: "guest-order-a",
        customerGuestHash: "guest-device-1",
        customer: { name: "", phone: "", email: "", note: "First order" },
      }),
      createOrder({
        id: "guest-order-b",
        customerGuestHash: "guest-device-1",
        customer: { name: "", phone: "", email: "", note: "Second order" },
      }),
    ],
  });

  assert.equal(customers.length, 1);
  assert.equal(customers[0]?.activity.orderCount, 2);
  assert.ok(customers[0]?.sources.includes("order"));
});

test("customer directory treats equivalent international phone formats as one identity", () => {
  const customers = buildMerchantCustomerDirectory({
    siteId: SITE_ID,
    orders: [
      createOrder({
        id: "phone-order-a",
        customer: { name: "Nana", phone: "+34 600 000 001", email: "", note: "" },
      }),
      createOrder({
        id: "phone-order-b",
        customer: { name: "Nana", phone: "34600000001", email: "", note: "" },
      }),
    ],
  });

  assert.equal(customers.length, 1);
  assert.equal(customers[0]?.activity.orderCount, 2);
});

test("stored identity aliases keep a customer linked after contact details change", () => {
  const stored = createEmptyMerchantCustomerProfile(SITE_ID);
  stored.displayName = "Nana Updated";
  stored.email = "new@example.com";
  stored.identityAliases = ["email:nana@example.com"];
  const customers = buildMerchantCustomerDirectory({
    siteId: SITE_ID,
    storedCustomers: [stored],
    orders: [createOrder()],
  });

  assert.equal(customers.length, 1);
  assert.equal(customers[0]?.displayName, "Nana Updated");
  assert.equal(customers[0]?.email, "new@example.com");
  assert.equal(customers[0]?.activity.orderCount, 1);
});

test("import upsert fills missing values without erasing existing customer fields", () => {
  const existing = createEmptyMerchantCustomerProfile(SITE_ID);
  existing.phone = "+34600000001";
  existing.displayName = "Existing";
  existing.address.line1 = "Calle Existing 1";
  const result = upsertMerchantCustomerProfiles(
    [existing],
    { phone: "+34 600 000 001", displayName: "Imported", address: { line1: "" } },
    { siteId: SITE_ID, source: "import" },
  );

  assert.equal(result.customers.length, 1);
  assert.equal(result.customers[0]?.displayName, "Imported");
  assert.equal(result.customers[0]?.address.line1, "Calle Existing 1");
  assert.ok(result.customers[0]?.sources.includes("import"));
});

test("manual replacement can clear editable fields and lists", () => {
  const existing = createEmptyMerchantCustomerProfile(SITE_ID);
  existing.phone = "+34600000001";
  existing.displayName = "Existing";
  existing.address.line1 = "Calle Existing 1";
  existing.tags = ["VIP"];
  existing.allergens = ["Peanut"];
  const result = upsertMerchantCustomerProfiles(
    [existing],
    {
      ...existing,
      address: { ...existing.address, line1: "" },
      tags: [],
      allergens: [],
    },
    { siteId: SITE_ID, source: "manual", replaceEmpty: true },
  );

  assert.equal(result.customers[0]?.address.line1, "");
  assert.deepEqual(result.customers[0]?.tags, []);
  assert.deepEqual(result.customers[0]?.allergens, []);
});
