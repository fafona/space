import assert from "node:assert/strict";
import test from "node:test";
import { assertMerchantCheckoutOffer, parseMerchantCheckoutSelection, quoteMerchantOfferAmounts, type MerchantCheckoutOffer } from "./merchantCheckoutCatalog";

const id = "12345678-1234-4234-8234-123456789abc", revision = "87654321-4321-4321-8321-cba987654321";
const offer = (): MerchantCheckoutOffer => ({ version: 1, id, revision, siteId: "10909095", enabled: true, title: "Synthetic play session",
  source: { kind: "booking", blockId: "booking-test", serviceId: "service-test", timeZone: "Europe/Madrid" }, maxQuantity: 5,
  cash: { currency: "eur", unitAmountMinor: 10_000, initialPolicy: { mode: "deposit_percent", basisPoints: 3000 } }, unitPoints: 500, allowOnSite: true });
const selection = () => ({ offerId: id, offerRevision: revision, quantity: 2, slotKey: "slot-test" });

test("a configured stable offer maps to a booking service, never a label", () => {
  const s = offer(); assertMerchantCheckoutOffer(s);
  assert.deepEqual(quoteMerchantOfferAmounts(s, selection()), { cashTotalMinor: 20_000, totalPoints: 1000 });
  s.title = "Renamed service";
  assert.deepEqual(quoteMerchantOfferAmounts(s, selection()), { cashTotalMinor: 20_000, totalPoints: 1000 });
});
test("browser selection contains only IDs, revision, quantity and issued slot key", () => {
  for (const patch of [{ price: 1 }, { membershipId: "other" }, { operatorId: "owner" }, { points: 0 }, { currency: "usd" }, { paid: true }]) {
    assert.throws(() => parseMerchantCheckoutSelection({ ...selection(), ...patch }), /checkout_invalid_selection/);
  }
});
test("invalid quantities and unversioned selections cannot be coerced", () => {
  for (const quantity of [0, -1, "2", 1.5, NaN, Infinity, 1000, null]) {
    assert.throws(() => parseMerchantCheckoutSelection({ ...selection(), quantity }), /checkout_invalid_selection/);
  }
  assert.throws(() => parseMerchantCheckoutSelection({ ...selection(), offerRevision: "" }), /checkout_invalid_selection/);
  assert.throws(() => parseMerchantCheckoutSelection(Object.create(selection())), /checkout_invalid_selection/);
});
test("expired quote, disabled offer, capacity and booking slot requirements fail closed", () => {
  assert.throws(() => quoteMerchantOfferAmounts({ ...offer(), revision: id }, selection()), /checkout_quote_changed/);
  assert.throws(() => quoteMerchantOfferAmounts({ ...offer(), enabled: false }, selection()), /checkout_offer_not_found/);
  assert.throws(() => quoteMerchantOfferAmounts(offer(), { ...selection(), quantity: 6 }), /checkout_quantity_unavailable/);
  assert.throws(() => quoteMerchantOfferAmounts(offer(), { ...selection(), slotKey: undefined }), /checkout_invalid_selection/);
});
test("product checkout requires a real product binding, full cash payment and no booking slot", () => {
  const s: MerchantCheckoutOffer = { ...offer(), source: { kind: "order", blockId: "products-test", collectionId: "collection-test", productId: "product-test" },
    cash: { currency: "eur", unitAmountMinor: 1000, initialPolicy: { mode: "full" } } };
  assert.deepEqual(quoteMerchantOfferAmounts(s, { ...selection(), slotKey: undefined }), { cashTotalMinor: 2000, totalPoints: 1000 });
  assert.throws(() => quoteMerchantOfferAmounts(s, selection()), /checkout_invalid_selection/);
  assert.throws(() => assertMerchantCheckoutOffer({ ...s, cash: offer().cash }), /checkout_invalid_offer/);
});
test("missing prices, non-integral points, invalid time zone and oversized totals are rejected", () => {
  for (const patch of [{ cash: undefined }, { cash: { ...offer().cash!, unitAmountMinor: 0 } }, { unitPoints: 0 }, { unitPoints: 1.5 },
    { unitPoints: NaN }, { maxQuantity: "5" }, { cash: null, unitPoints: null }, { cash: null, allowOnSite: true },
    { source: { ...offer().source, timeZone: "not-a-zone" } }]) assert.throws(() => assertMerchantCheckoutOffer({ ...offer(), ...patch }), /checkout_invalid_offer/);
  assert.throws(() => quoteMerchantOfferAmounts({ ...offer(), unitPoints: 99_999_999 }, selection()), /checkout_total_too_large/);
});
