import assert from "node:assert/strict";
import test from "node:test";
import { buildConfiguredCheckoutOffer, checkoutEditFromOffer, parseCheckoutConfigurationEdit, type CheckoutConfigurationEdit, type CheckoutConfigurationOptions } from "./merchantCheckoutConfiguration";
import { parseCheckoutConfigurationSnapshot, saveCheckoutConfiguration, loadCheckoutConfiguration, type CheckoutConfigurationRpc } from "./merchantCheckoutConfigurationStore.server";

const id = "12345678-1234-4234-8234-123456789abc", revision = "87654321-4321-4321-8321-cba987654321", version = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
export function configurationFixture() {
  const options: CheckoutConfigurationOptions = { sources: [{ key: "a".repeat(64), sourceVersion: "b".repeat(64), title: "Synthetic session", kind: "booking", viewport: "mobile", blockId: "booking-test", store: "Synthetic store", item: "Synthetic play", cashMinor: null }],
    stockItems: [{ id: "stock-test", title: "Synthetic stock", points: 500 }], vouchers: [{ id: "voucher-test", title: "Synthetic voucher", kind: "exchange_voucher" }] };
  const edit: CheckoutConfigurationEdit = { offerId: null, sourceKey: options.sources[0].key, sourceVersion: options.sources[0].sourceVersion, title: "Synthetic session", enabled: false,
    cashMinor: 10000, unitPoints: 500, maxQuantity: 5, allowOnSite: true, timeZone: "Europe/Madrid", stockItemId: "stock-test", voucherCouponIds: ["voucher-test"], durationMinutes: 60,
    pointsReturnOnCancel: true, couponReturnOnCancel: false, cancellationAdvanceMinutes: 60 };
  const build = (patch: Partial<CheckoutConfigurationEdit> = {}) => buildConfiguredCheckoutOffer({ siteId: "10909095", edit: { ...edit, ...patch }, current: { version: null, offers: [] }, options, newId: id, newRevision: revision });
  return { edit, options, build };
}
test("explicit published source binds stable offer IDs and cancellation policy without modifying source/settings", () => {
  const f = configurationFixture(), before = structuredClone(f.options), offer = f.build();
  assert.equal(offer.id, id); assert.equal(offer.source.kind, "booking"); assert.equal(offer.enabled, false);
  assert.equal(offer.checkoutBinding.item, "Synthetic play"); assert.equal(offer.couponReturnOnCancel, false);
  assert.deepEqual(parseCheckoutConfigurationEdit(checkoutEditFromOffer(offer)), { ...f.edit, offerId: id });
  assert.deepEqual(f.options, before);
});
test("owner input is bounded and explicit: no prices, quantity, cancellation policy or identity coercion", () => {
  const f = configurationFixture();
  for (const patch of [{ siteId: "10909096" }, { paid: true }, { unitPoints: "500" }, { cashMinor: 0 }, { maxQuantity: 0 },
    { couponReturnOnCancel: undefined }, { pointsReturnOnCancel: "true" }, { stockItemId: "other-stock" }, { voucherCouponIds: ["foreign-voucher"] },
    { sourceVersion: "c".repeat(64) }, { cancellationAdvanceMinutes: -1 }, { timeZone: "not-a-zone" }, { unitPoints: 501 }]) {
    assert.throws(() => f.build(patch as Partial<CheckoutConfigurationEdit>));
  }
});
test("an existing stable offer cannot silently become a different source, and unknown saves cannot create a duplicate", () => {
  const f = configurationFixture(), offer = f.build(), current = { version, offers: [offer] };
  assert.throws(() => buildConfiguredCheckoutOffer({ siteId: "10909095", edit: f.edit, current, options: f.options, newId: id, newRevision: revision }), /checkout_source_already_configured/);
  const next = buildConfiguredCheckoutOffer({ siteId: "10909095", edit: { ...f.edit, offerId: id, enabled: true }, current, options: f.options, newId: version, newRevision: version });
  assert.equal(next.id, id); assert.equal(next.revision, version); assert.equal(next.enabled, true);
  assert.throws(() => buildConfiguredCheckoutOffer({ siteId: "10909095", edit: { ...f.edit, offerId: version }, current, options: f.options, newId: id, newRevision: revision }), /checkout_offer_not_found/);
});
test("product prices come from the current operating catalog; voucher kind cannot cross product/service scope", () => {
  const f = configurationFixture(); Object.assign(f.options.sources[0], { kind: "order", collectionId: "collection-test", productId: "product-test", cashMinor: 2000 });
  assert.throws(() => f.build(), /checkout_voucher_binding_unavailable/);
  assert.throws(() => f.build({ voucherCouponIds: [], cashMinor: 1000 }), /checkout_source_price_changed/);
  const offer = f.build({ voucherCouponIds: [], cashMinor: 2000 }); assert.equal(offer.source.kind, "order");
  assert.equal(offer.cash?.unitAmountMinor, 2000);
});
test("RPC response validation rejects cross-site, malformed and identity-ambiguous config", () => {
  const f = configurationFixture(), offer = f.build();
  assert.deepEqual(parseCheckoutConfigurationSnapshot({ version, offers: [offer] }, "10909095").offers, [offer]);
  for (const raw of [{ version: null, offers: [offer] }, { version, offers: [offer, offer] }, { version, offers: [{ ...offer, siteId: "10909096" }] },
    { version, offers: [{ ...offer, checkoutBinding: { ...offer.checkoutBinding, viewport: "other" } }] }]) {
    assert.throws(() => parseCheckoutConfigurationSnapshot(raw, "10909095"), /checkout_configuration_unavailable/);
  }
});
test("store uses one CAS RPC, never direct table writes, and never retries an ambiguous write", async () => {
  const f = configurationFixture(), offer = f.build(), calls: string[] = [];
  const client: CheckoutConfigurationRpc = { rpc: async (name, args) => { calls.push(name); assert.equal(args.p_site_id, "10909095");
    return { error: null, data: name.endsWith("snapshot_v1") ? { version: null, offers: [] } : { version, offers: [offer] } }; } };
  assert.equal((await loadCheckoutConfiguration("10909095", client)).version, null);
  const input = { siteId: "10909095", expectedVersion: null, nextVersion: version, actorKey: "owner:synthetic-owner", offer };
  assert.equal((await saveCheckoutConfiguration(input, client)).version, version); assert.equal(calls.length, 2);
  let writes = 0;
  await assert.rejects(saveCheckoutConfiguration(input, { rpc: async () => { writes++; return { data: null, error: { message: "connection lost SQL private_credentials" } }; } }), /checkout_configuration_unconfirmed/);
  assert.equal(writes, 1);
});
