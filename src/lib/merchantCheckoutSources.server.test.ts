import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import { buildCheckoutSourceChoices } from "./merchantCheckoutSources.server";
import type { MerchantCatalog } from "./merchantCatalog";

const booking = { id: "booking-test", type: "booking", props: { bookingStoreOptions: ["Synthetic store"], bookingItemOptions: ["Play", "Party"], bookingTitleOptions: ["Mr"], bookingAvailableTimeRanges: ["09:00-18:00"] } } as Block;
const product = { id: "product-test", type: "product", props: { products: [] } } as unknown as Block;
function fixture() {
  const catalog: MerchantCatalog = { revision: 1, updatedAt: "2026-11-22T00:00:00Z", pricePrefix: "€", categories: [],
    products: [{ id: "p1", code: "P", name: "Synthetic product", description: "", price: "12.50", imageUrl: "", thumbnailUrl: "", tag: "", availability: "available" }],
    collections: [{ id: "c1", blockId: "product-test", viewport: "shared", productIds: ["p1"] }] };
  return { siteId: "10909095", siteName: "Synthetic", blocks: [structuredClone(booking), structuredClone(product)], catalog, allowBooking: true, allowOrder: true };
}
test("source choices come only from published blocks and available operating products, with separate viewport keys", () => {
  const f = fixture(), before = structuredClone(f), choices = buildCheckoutSourceChoices(f);
  assert.equal(choices.filter(choice => choice.kind === "booking").length, 2);
  assert.equal(choices.filter(choice => choice.kind === "order").length, 2);
  assert.equal(choices.find(choice => choice.kind === "order")?.cashMinor, 1250);
  assert.equal(new Set(choices.map(choice => choice.key)).size, choices.length); assert.deepEqual(f, before);
});
test("removed, hidden, unpriced and wrong-currency products do not acquire a checkout price", () => {
  for (const mode of ["removed", "hidden", "empty-price", "wrong-currency", "no-catalog"] as const) {
    const f = fixture();
    if (mode === "removed") f.blocks = [booking];
    if (mode === "hidden") f.catalog.products[0].availability = "hidden";
    if (mode === "empty-price") f.catalog.products[0].price = "";
    if (mode === "wrong-currency") f.catalog.pricePrefix = "$";
    assert.equal(buildCheckoutSourceChoices({ ...f, catalog: mode === "no-catalog" ? null : f.catalog }).filter(choice => choice.kind === "order").length, 0);
  }
});
test("published source versions change on rule edits and module gates do not invent missing choices", () => {
  const f = fixture(), before = buildCheckoutSourceChoices(f);
  (f.blocks[0] as Extract<Block, { type: "booking" }>).props.bookingAvailableTimeRanges = ["12:00-13:00"];
  const after = buildCheckoutSourceChoices(f); assert.equal(before[0].key, after[0].key); assert.notEqual(before[0].sourceVersion, after[0].sourceVersion);
  assert.deepEqual(buildCheckoutSourceChoices({ ...f, allowBooking: false, allowOrder: false }), []);
});
