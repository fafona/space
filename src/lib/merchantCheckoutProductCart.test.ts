import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { isMemberCheckoutCartUiPilotEnabled } from "./merchantCheckoutCartPilot.server";
import { persistProductCheckoutDraft, productCartAfterAcknowledgement, productCartCheckoutSelection } from "./merchantCheckoutProductCart";
import { parseCartClientSelection } from "./merchantCheckoutCartReview";
async function fixture() {
  const x = await cartReviewFixture(), items = x.result.lines.map(l => ({ productId: l.productId, checked: true, quantity: l.quantity, kept: { title: l.title } }));
  items.push({ productId: "unselected", checked: false, quantity: 2, kept: { title: "Keep" } });
  const access = { siteId: x.f.siteId, accountId: x.f.principal.accountId, offers: x.result.lines.map(l => ({ offerId: l.offerId, offerRevision: l.offerRevision, title: l.title, maxQuantity: 99, source: { kind: "order" as const, productId: l.productId } })) };
  return { ...x, items, access };
}
test("cart UI is separately default closed, exact bounded site whitelist only", () => {
  const base = { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: "99990001", MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES: "99990001" };
  assert.equal(isMemberCheckoutCartUiPilotEnabled("99990001", base), false);
  for (const value of ["*", "99990001,", "bad", Array(51).fill("99990001").join(",")]) assert.equal(isMemberCheckoutCartUiPilotEnabled("99990001", { ...base, MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES: value }), false);
  assert.equal(isMemberCheckoutCartUiPilotEnabled("99990001", { ...base, MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES: "99990001" }), true);
});
test("all checked product IDs bind exactly once; hints never include contacts, member IDs or prices", async () => {
  const x = await fixture(), s = productCartCheckoutSelection(x.f.siteId, x.access, x.items);
  assert.deepEqual(s, parseCartClientSelection(x.f.request)); assert.ok(!/kept|unitPrice|memberId|email/.test(JSON.stringify(s)));
  assert.equal(productCartCheckoutSelection(x.f.siteId, { ...x.access, offers: x.access.offers.map(o => ({ ...o, onSiteOnly: true })) }, x.items).method, "on_site");
  for (const access of [{ ...x.access, siteId: "99990002" }, { ...x.access, offers: [] }, { ...x.access, offers: [x.access.offers[0], x.access.offers[0]] }]) assert.throws(() => productCartCheckoutSelection(x.f.siteId, access, x.items));
  for (const items of [[], [...x.items, x.items[0]], x.items.map(l => ({ ...l, checked: false })), x.items.map(l => ({ ...l, quantity: 1000 }))]) assert.throws(() => productCartCheckoutSelection(x.f.siteId, x.access, items));
});
test("only fresh acknowledged open original consumes exact selected items; contacts/unselected objects are not mutated", async () => {
  const x = await fixture(), frozen = structuredClone(x.items), selection = productCartCheckoutSelection(x.f.siteId, x.access, x.items), original = { kind: "cart" as const, result: x.result };
  const left = productCartAfterAcknowledgement(x.items, frozen, selection, original, true);
  assert.deepEqual(left, [x.items[2]]); assert.equal(left[0], x.items[2]); assert.deepEqual(x.items, frozen);
  assert.equal(productCartAfterAcknowledgement(x.items, frozen, selection, original, false), x.items);
  assert.equal(productCartAfterAcknowledgement(x.items, frozen, selection, { ...original, result: { ...x.result, closed: true } }, true), x.items);
  for (const result of [{ ...x.result, reviewRequired: true }, { ...x.result, siteId: "99990002" }, { ...x.result, lines: x.result.lines.slice(1) }, { ...x.result, lines: x.result.lines.map(l => ({ ...l, quantity: 9 })) }]) assert.throws(() => productCartAfterAcknowledgement(x.items, frozen, selection, { kind: "cart", result }, true));
  assert.throws(() => productCartAfterAcknowledgement([...x.items, { ...x.items[0], productId: "new" }], frozen, selection, original, true));
});
test("strict draft persistence detects foreign writes, denial and silent discard; legacy writer is not reused", () => {
  const key = "merchant-space:product-cart:v1:99990001:products", store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, value: string) => { store.set(k, value); } };
  persistProductCheckoutDraft(storage, key, null, '{"items":[]}'); assert.equal(storage.getItem(key), '{"items":[]}');
  assert.throws(() => persistProductCheckoutDraft(storage, key, null, "new"), /checkout_cart_changed/); assert.equal(storage.getItem(key), '{"items":[]}');
  assert.throws(() => persistProductCheckoutDraft({ ...storage, setItem() { throw new Error("denied"); } }, key, '{"items":[]}', "next"), /checkout_storage_unavailable/);
  assert.throws(() => persistProductCheckoutDraft({ ...storage, setItem() {} }, key, '{"items":[]}', "next"), /checkout_storage_unavailable/);
});
