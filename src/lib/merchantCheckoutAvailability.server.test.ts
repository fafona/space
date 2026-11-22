import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import type { ConfiguredCheckoutOffer } from "./merchantCheckoutConfiguration";
import { buildCheckoutSourceChoices } from "./merchantCheckoutSources.server";
import { checkoutAvailableQuantity, checkoutSourceIsCurrent, type CheckoutAvailabilityMaterial } from "./merchantCheckoutAvailability.server";
import { buildMerchantBookingRulesSnapshot } from "./merchantBookingRules";
import { createDefaultMerchantBookingWorkbenchSettings } from "./merchantBookingWorkbench";
import type { MerchantBookingRecord } from "./merchantBookings";
import { normalizeMerchantMembershipSettings } from "./merchantMembershipSettings";

const siteId = "10909095", at = "2026-11-24T12:00", now = new Date("2026-11-22T09:00:00Z");
function fixture(props: Record<string, unknown> = {}) {
  const blocks = [{ id: "booking-test", type: "booking", props: { bookingStoreOptions: ["Store"], bookingItemOptions: ["Play"],
    bookingTitleOptions: ["Mx"], bookingTimeSlotRules: [{ timeRange: "10:00-18:00", maxBookings: 2 }], ...props } }] as Block[];
  const source = buildCheckoutSourceChoices({ siteId, siteName: "Synthetic", blocks, catalog: null, allowBooking: true, allowOrder: false })[0];
  const offer: ConfiguredCheckoutOffer = { version: 1, id: "12345678-1234-4234-8234-123456789abc", revision: "87654321-4321-4321-8321-cba987654321",
    siteId, enabled: true, title: "Synthetic", maxQuantity: 5, source: { kind: "booking", blockId: source.blockId, serviceId: "service-test", timeZone: "Europe/Madrid" },
    cash: { currency: "eur", unitAmountMinor: 1000, initialPolicy: { mode: "full" } }, unitPoints: 100, allowOnSite: true, couponReturnOnCancel: true,
    checkoutBinding: { sourceKey: source.key, sourceVersion: source.sourceVersion, viewport: source.viewport, store: source.store, item: source.item,
      stockItemId: null, voucherCouponIds: [], durationMinutes: 60, pointsReturnOnCancel: true, cancellationAdvanceMinutes: 60 } };
  const material: CheckoutAvailabilityMaterial = { siteId, siteName: "Synthetic", blocks, catalog: null, bookings: true, orders: false, settings: null,
    booking: { rules: buildMerchantBookingRulesSnapshot(siteId, blocks, "2000-01-01T00:00:00.000Z"),
      workbench: { ...createDefaultMerchantBookingWorkbenchSettings(), timeZone: "Europe/Madrid" }, records: [] } };
  return { offer, material, quantity: 1, appointmentAt: at, now };
}
const booking = (id: string, updates: Partial<MerchantBookingRecord> = {}): MerchantBookingRecord => ({ id, siteId, siteName: "Synthetic", store: "Store", item: "Play",
  appointmentAt: at, appointmentTimeZone: "Europe/Madrid", bookingBlockId: "booking-test", bookingViewport: "desktop", title: "Mx", customerName: "Private",
  email: "private@example.invalid", phone: "000", note: "", createdAt: "2026-11-22T00:00:00Z", updatedAt: "2026-11-22T00:00:00Z", status: "active", ...updates });

test("live published binding and available appointment are read-only, not a reservation", () => {
  const f = fixture(), before = structuredClone(f);
  assert.equal(checkoutSourceIsCurrent(f.offer, f.material), true);
  assert.equal(checkoutAvailableQuantity(f), 1); assert.deepEqual(f, before);
  for (const change of [{ sourceVersion: "a".repeat(64) }, { store: "Wrong" }, { viewport: "mobile" as const }]) {
    const changed = structuredClone(f); Object.assign(changed.offer.checkoutBinding, change);
    assert.throws(() => checkoutAvailableQuantity(changed), /checkout_source_changed/);
  }
  f.material.bookings = false; assert.equal(checkoutSourceIsCurrent(f.offer, f.material), false);
});
test("finite capacity uses the original block/viewport/day pool, excludes closed bookings, includes confirmed bookings", () => {
  const f = fixture(); f.material.booking!.records = [booking("one"), booking("two", { status: "cancelled" }),
    booking("other", { siteId: "10909096" }), booking("mobile", { bookingViewport: "mobile" }), booking("tomorrow", { appointmentAt: "2026-11-25T12:00" })];
  assert.equal(checkoutAvailableQuantity(f), 1);
  f.material.booking!.records.push(booking("confirmed", { status: "confirmed", appointmentAt: "2026-11-24T15:00" }));
  assert.equal(checkoutAvailableQuantity(f), 0);
  f.material.booking!.records[0].status = "completed"; assert.equal(checkoutAvailableQuantity(f), 1);
});
test("published blocked/holiday dates and outside ranges cannot be sold as points appointments", () => {
  for (const props of [{ bookingBlockedDates: [at.slice(0, 10)] }, { bookingHolidayDates: [at.slice(0, 10)] },
    { bookingTimeSlotRules: [{ timeRange: "14:00-18:00", maxBookings: 2 }] }]) assert.equal(checkoutAvailableQuantity(fixture(props)), 0);
});
test("recurring closures, advance time, daily cutoff and same-service buffer all remain enforced", () => {
  const recurring = fixture(); recurring.material.booking!.workbench.recurringRules = [{ id: "closed", weekday: 2, allDay: true, timeRanges: [] }];
  assert.equal(checkoutAvailableQuantity(recurring), 0);
  const advance = fixture(); advance.material.booking!.workbench.minAdvanceMinutes = 300;
  advance.now = new Date("2026-11-24T10:00:00Z"); assert.equal(checkoutAvailableQuantity(advance), 0);
  const cutoff = fixture(); cutoff.material.booking!.workbench.dailyCutoffTime = "10:00";
  cutoff.now = new Date("2026-11-24T10:00:00Z"); assert.equal(checkoutAvailableQuantity(cutoff), 0);
  const buffer = fixture(); buffer.material.booking!.workbench.bufferMinutes = 45;
  buffer.material.booking!.records = [booking("near", { appointmentAt: "2026-11-24T11:30" })];
  assert.equal(checkoutAvailableQuantity(buffer), 0);
  buffer.material.booking!.records[0].item = "Other"; assert.equal(checkoutAvailableQuantity(buffer), 1);
});
test("invalid, past and DST missing/repeated wall times never become shifted appointments", () => {
  for (const appointmentAt of ["2026-02-30T12:00", "2026-11-20T12:00", "2026-11-24T12:00Z", "2026-11-24 12:00"]) {
    assert.throws(() => checkoutAvailableQuantity({ ...fixture(), appointmentAt }), /checkout_(invalid_selection|slot_unavailable)/);
  }
  for (const appointmentAt of ["2026-03-29T02:30", "2026-10-25T02:30"]) {
    assert.throws(() => checkoutAvailableQuantity({ ...fixture(), appointmentAt, now: new Date("2026-01-01T00:00:00Z") }), /checkout_slot_unavailable/);
  }
});
test("stale persisted rules and changed workbench time zone require a fresh merchant binding", () => {
  const rules = fixture(); rules.material.booking!.rules.entries[0].timeSlotRules[0].maxBookings = 99;
  assert.throws(() => checkoutAvailableQuantity(rules), /checkout_source_changed/);
  const zone = fixture(); zone.material.booking!.workbench.timeZone = "Atlantic/Canary";
  assert.throws(() => checkoutAvailableQuantity(zone), /checkout_source_changed/);
});
test("ambiguous or damaged live capacity is unavailable, not interpreted as an empty room", () => {
  const duplicate = fixture(); duplicate.material.booking!.records = [booking("one"), booking("one")];
  assert.throws(() => checkoutAvailableQuantity(duplicate), /checkout_unavailable/);
  const badDate = fixture(); badDate.material.booking!.records = [booking("one", { appointmentAt: "bad" })];
  assert.throws(() => checkoutAvailableQuantity(badDate), /checkout_unavailable/);
});
test("stock must be explicitly bound and still use the saved authoritative point price", () => {
  const f = fixture(); f.offer.checkoutBinding.stockItemId = "stock-test";
  f.material.settings = normalizeMerchantMembershipSettings(siteId, { redemptionItems: [{ id: "stock-test", name: "Synthetic", enabled: true, pointsCost: 100, stock: 0 }] });
  assert.equal(checkoutAvailableQuantity(f), 0);
  f.material.settings.redemptionItems[0].stock = null; assert.equal(checkoutAvailableQuantity(f), 1);
  f.material.settings.redemptionItems[0].pointsCost = 90; assert.throws(() => checkoutAvailableQuantity(f), /checkout_source_changed/);
});
test("group quantity is not silently turned into one old-style capacity record", () => {
  assert.throws(() => checkoutAvailableQuantity({ ...fixture(), quantity: 2 }), /checkout_booking_quantity_unsupported/);
});
test("product quotes retain operating EUR price, published collection binding, quantity and finite stock", () => {
  const f = fixture(); f.material.blocks = [{ id: "product-test", type: "product", props: { products: [] } } as unknown as Block];
  f.material.orders = true; f.material.catalog = { revision: 1, updatedAt: now.toISOString(), pricePrefix: "€", categories: [],
    products: [{ id: "product-1", code: "P", name: "Synthetic", description: "", price: "10.00", imageUrl: "", thumbnailUrl: "", tag: "", availability: "available" }],
    collections: [{ id: "collection-1", blockId: "product-test", viewport: "shared", productIds: ["product-1"] }] };
  const source = buildCheckoutSourceChoices({ ...f.material, allowBooking: false, allowOrder: true })[0];
  f.offer.source = { kind: "order", blockId: source.blockId, collectionId: source.collectionId!, productId: source.productId! };
  Object.assign(f.offer.checkoutBinding, { sourceKey: source.key, sourceVersion: source.sourceVersion, stockItemId: "stock-test" });
  f.material.settings = normalizeMerchantMembershipSettings(siteId, { redemptionItems: [{ id: "stock-test", name: "Synthetic", enabled: true, pointsCost: 100, stock: 3 }] });
  assert.equal(checkoutAvailableQuantity({ ...f, quantity: 3, appointmentAt: undefined }), 3);
  f.material.catalog.products[0].price = "11.00";
  assert.throws(() => checkoutAvailableQuantity({ ...f, appointmentAt: undefined }), /checkout_source_changed/);
});
