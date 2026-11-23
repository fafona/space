import assert from "node:assert/strict";
import test from "node:test";
import { buildCheckoutEntryHref, parseCheckoutEntryAccess, parseCheckoutEntryDiscovery, parseCheckoutEntryQuery, type CheckoutEntryOffer } from "./merchantCheckoutEntry";
const query = { siteId: "10909095", kind: "booking" as const, blockId: "booking-test", viewport: "desktop" as const };
const offer: CheckoutEntryOffer = { offerId: "11111111-1111-4111-8111-111111111111", offerRevision: "22222222-2222-4222-8222-222222222222", title: "Synthetic play", maxQuantity: 1, source: { kind: "booking", store: "Synthetic", item: "Play" } };
test("source query cannot carry prices, coupons, authority, arrays or another kind of selection", () => {
  assert.deepEqual(parseCheckoutEntryQuery(query), query);
  for (const patch of [{ points: 1 }, { accountId: "50010105" }, { offerId: offer.offerId }, { kind: ["booking"] }, { viewport: ["desktop"] }, { blockId: "bad/id" }, { siteId: "bad" }]) assert.throws(() => parseCheckoutEntryQuery({ ...query, ...patch }));
});
test("entry decoder strips private extras and refuses ambiguous sources, wrong viewport and mixed merchants", () => {
  const envelope = { ok: true, entry: { query, siteId: query.siteId, accountId: "50010105", offers: [{ ...offer, private: "PRIVATE" }], private: "PRIVATE" } };
  assert.deepEqual(parseCheckoutEntryAccess(envelope, query), { siteId: query.siteId, accountId: "50010105", offers: [offer] });
  assert.equal(parseCheckoutEntryAccess({ ok: true, entry: null }, query), null);
  for (const patch of [{ query: { ...query, viewport: "mobile" } }, { siteId: "10909096" }, { accountId: "bad" }, { offers: [offer, { ...offer, offerId: "33333333-3333-4333-8333-333333333333" }] }, { offers: [{ ...offer, source: { kind: "order", productId: "p1" } }] }, { offers: [{ ...offer, maxQuantity: 0 }] }]) assert.throws(() => parseCheckoutEntryAccess({ ...envelope, entry: { ...envelope.entry, ...patch } }, query));
});
test("navigation contains only stable keys and current selection, never contacts or coupon claims", () => {
  const url = new URL(buildCheckoutEntryHref(query.siteId, offer, 1, "2030-01-01T12:00", "es-ES"), "https://synthetic.invalid");
  assert.equal(url.pathname, `/member-checkout/${query.siteId}/start`); assert.equal(url.searchParams.get("appointmentAt"), "2030-01-01T12:00");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["appointmentAt", "offerId", "offerRevision", "quantity", "uiLocale"]);
  assert.throws(() => buildCheckoutEntryHref(query.siteId, offer, 2, "2030-01-01T12:00", "es-ES"));
  assert.throws(() => buildCheckoutEntryHref(query.siteId, offer, 1, "invalid", "es-ES"));
  const product: CheckoutEntryOffer = { ...offer, maxQuantity: 3, source: { kind: "order", productId: "p1" } };
  assert.ok(buildCheckoutEntryHref(query.siteId, product, 3, undefined, "zh-CN"));
  assert.throws(() => buildCheckoutEntryHref(query.siteId, product, 4, undefined, "zh-CN"));
  assert.throws(() => buildCheckoutEntryHref(query.siteId, product, 1, "2030-01-01T12:00", "zh-CN"));
});

test("a server-enabled recovery entry survives an empty current offer selection without inventing an offer", () => {
  const value = parseCheckoutEntryAccess({ ok: true, entry: { query, siteId: query.siteId, accountId: "50010105", offers: [], recoveryEnabled: true } }, query);
  assert.deepEqual(value, { siteId: query.siteId, accountId: "50010105", offers: [], recoveryEnabled: true });
  for (const recoveryEnabled of [false, "true", 1, {}, null]) assert.throws(() => parseCheckoutEntryAccess({ ok: true, entry: { query, siteId: query.siteId, accountId: "50010105", offers: [], recoveryEnabled } }, query));
});
test("public original navigation does not turn a visitor into a member or accept another site's recovery hint", () => {
  assert.deepEqual(parseCheckoutEntryDiscovery({ ok: true, entry: null, recovery: { siteId: query.siteId } }, query), { access: null, recoveryEnabled: true });
  assert.deepEqual(parseCheckoutEntryDiscovery({ ok: true, entry: null }, query), { access: null, recoveryEnabled: false });
  for (const recovery of [null, true, "url", { siteId: "10909993" }, { siteId: query.siteId, accountId: "50010105" }]) assert.throws(() => parseCheckoutEntryDiscovery({ ok: true, entry: null, recovery }, query));
});
