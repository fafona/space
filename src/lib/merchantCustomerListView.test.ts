import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  normalizeMerchantCustomerProfile,
  type MerchantCustomerDirectoryItem,
  type MerchantCustomerProfile,
} from "@/lib/merchantCustomers";
import { toMerchantCustomerListItem } from "@/lib/merchantCustomerListView";

const siteId = "99990001";
const timestamp = "2032-06-01T12:00:00.000Z";

function customer(index = 0): MerchantCustomerDirectoryItem {
  const profile = normalizeMerchantCustomerProfile({
    id: `synthetic-${index}`, siteId, referenceCode: `REF-${index}`, memberNo: `MEM-${index}`,
    accountId: `account-${index}`, authUserId: `user-${index}`, guestHash: `guest-${index}`,
    displayName: `Synthetic ${index}`, phone: "+34 600 123 456", email: `synthetic-${index}@example.test`,
    birthday: "2000-01-02", gender: "other", address: { country: "ES", province: "Madrid", city: "Madrid",
      postalCode: "28001", line1: "Synthetic address", line2: "Second line" },
    tax: { name: "Synthetic taxpayer", number: `TAX-${index}`, country: "ES", province: "Madrid",
      city: "Madrid", address: "Synthetic tax address" },
    allergens: ["synthetic-allergen"], tags: ["synthetic-tag"], notes: "保留搜索和编辑备注 café",
    customFields: { privateField: "synthetic value" }, identityAliases: [`email:former-${index}@example.test`],
    sources: ["manual", "membership", "order", "booking"], status: "archived",
    createdAt: timestamp, updatedAt: timestamp,
  }, { siteId, now: timestamp });
  assert.ok(profile);
  return {
    ...profile, incomplete: true,
    activity: { orderCount: 3, bookingCount: 2, orderTotals: [{ label: "EUR", amount: 12.34 }, { label: "USD", amount: 0 }],
      firstActivityAt: "2030-01-01T00:00:00.000Z", lastActivityAt: timestamp,
      lastOrderAt: "2032-05-01T00:00:00.000Z", lastBookingAt: timestamp,
      lastOrderNote: "Synthetic order note", lastBookingNote: "Synthetic booking note" },
  };
}

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(freezeDeep);
  Object.freeze(value);
}

test("manager projection retains every profile field and only the four consumed activity fields", () => {
  const full = { ...customer(), futureProfileField: { value: "preserve unknown top-level fields" } };
  const list = toMerchantCustomerListItem(full);
  const profile: MerchantCustomerProfile = list;
  assert.equal(profile.accountId, full.accountId);
  assert.deepEqual(Object.keys(list), Object.keys(full));
  for (const [key, value] of Object.entries(full)) {
    if (key !== "activity") assert.deepEqual(Reflect.get(list, key), value, key);
  }
  assert.deepEqual(list.activity, {
    orderCount: 3, bookingCount: 2, orderTotals: full.activity.orderTotals, lastActivityAt: timestamp,
  });
  assert.deepEqual(Object.keys(list.activity).sort(), ["bookingCount", "lastActivityAt", "orderCount", "orderTotals"]);
  for (const key of ["firstActivityAt", "lastOrderAt", "lastBookingAt", "lastOrderNote", "lastBookingNote"]) {
    assert.equal(Object.hasOwn(list.activity, key), false, key);
  }
});

test("projection does not mutate deeply frozen input and creates only the documented shallow wrappers", () => {
  const full = customer();
  const before = JSON.stringify(full);
  freezeDeep(full);
  const first = toMerchantCustomerListItem(full);
  const second = toMerchantCustomerListItem(full);
  assert.notEqual(first, full);
  assert.notEqual(first.activity, full.activity);
  assert.notEqual(second, first);
  assert.notEqual(second.activity, first.activity);
  assert.equal(first.address, full.address);
  assert.equal(first.tax, full.tax);
  assert.equal(first.identityAliases, full.identityAliases);
  assert.equal(first.activity.orderTotals, full.activity.orderTotals);
  assert.equal(JSON.stringify(full), before);
  assert.deepEqual(first, second);
});

test("projection preserves empty activity, null last activity, archived status and false incomplete without defaults", () => {
  const full = customer();
  full.incomplete = false;
  full.activity = { orderCount: 0, bookingCount: 0, orderTotals: [], lastActivityAt: null,
    firstActivityAt: null, lastOrderAt: null, lastBookingAt: null, lastOrderNote: "", lastBookingNote: "" };
  const result = toMerchantCustomerListItem(full);
  assert.deepEqual(result.activity, { orderCount: 0, bookingCount: 0, orderTotals: [], lastActivityAt: null });
  assert.equal(result.incomplete, false);
  assert.equal(result.status, "archived");
});

test("note-heavy synthetic response loses bytes including gzip bytes without removing profile notes or rows", () => {
  // Deterministic synthetic activity notes near the actual 1,000-character cap.
  // This measures serialized responses, not DB IO, real HTTP compression or latency.
  const note = (seed: string) => Array.from({ length: 16 }, (_, index) =>
    createHash("sha256").update(`${seed}:${index}`).digest("hex")).join("").slice(0, 1000);
  const full = Array.from({ length: 64 }, (_, index) => {
    const row = customer(index);
    row.notes = `Profile note retained ${index}: ` + note(`profile-${index}`);
    row.activity.lastOrderNote = note(`order-${index}`);
    row.activity.lastBookingNote = note(`booking-${index}`);
    return row;
  });
  const before = JSON.stringify(full);
  const projected = full.map(toMerchantCustomerListItem);
  const envelope = (customers: unknown[]) => JSON.stringify({ ok: true, customers, total: full.length, version: timestamp, warnings: [] });
  const fullBody = envelope(full);
  const listBody = envelope(projected);
  assert.equal(projected.length, full.length);
  projected.forEach((row, index) => assert.equal(row.notes, full[index]!.notes));
  assert.ok(Buffer.byteLength(fullBody) - Buffer.byteLength(listBody) > 64 * 2000);
  assert.ok(gzipSync(listBody).byteLength < gzipSync(fullBody).byteLength);
  assert.equal(JSON.stringify(full), before);
});
