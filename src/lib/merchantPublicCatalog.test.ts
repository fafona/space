import assert from "node:assert/strict";
import test from "node:test";
import {
  decodePublicCatalogBatch,
  type PublicCatalogBatchResponse,
} from "./merchantPublicCatalog";

const expected = { siteId: "12345678", viewport: "desktop" as const, blockIds: ["a", "b", "old"] };
function payload(): PublicCatalogBatchResponse {
  return {
    ok: true, siteId: expected.siteId, viewport: "desktop",
    catalog: {
      revision: 7, updatedAt: "2026-09-25T05:00:00.000Z", pricePrefix: "€",
      products: ["first", "second"].map((id) => ({
        id, code: id, name: id, description: "", price: "10", imageUrl: "", thumbnailUrl: "", tag: "",
        availability: id === "first" ? "available" : "sold_out",
      })),
      categories: [
        { id: "group", name: "Original ordering", productIds: ["first", "second", "first"] },
        { id: "empty", name: "Empty", productIds: [] },
      ],
    },
    results: [
      { blockId: "a", status: "ready", collection: { id: "a-shared", blockId: "a", viewport: "shared" }, productIds: ["second"] },
      { blockId: "b", status: "ready", collection: { id: "b-desktop", blockId: "b", viewport: "desktop" }, productIds: ["second", "first", "first"], browsingRules: { searchEnabled: true, searchPlaceholder: "Find", hideUnselectedCategory: false, groupByCategory: true } },
      { blockId: "old", status: "legacy" },
    ],
  };
}

test("batch decoder preserves product/category order and multiplicity, sold-out items, empty categories and optional rules", () => {
  const input = payload();
  const states = decodePublicCatalogBatch(input, expected);
  assert.equal(states.size, 3);
  assert.deepEqual(states.get("a")?.catalog?.products.map((product) => product.id), ["second"]);
  assert.deepEqual(states.get("b")?.catalog?.products.map((product) => product.id), ["second", "first", "first"]);
  assert.equal(states.get("a")?.catalog?.products[0].availability, "sold_out");
  assert.deepEqual(states.get("b")?.catalog?.categories, input.catalog?.categories);
  assert.deepEqual(states.get("a")?.catalog?.categories, [
    { id: "group", name: "Original ordering", productIds: ["second"] },
    { id: "empty", name: "Empty", productIds: [] },
  ]);
  assert.equal(Object.hasOwn(states.get("a")!.catalog!, "browsingRules"), false);
  assert.deepEqual(states.get("b")?.catalog?.browsingRules, {
    searchEnabled: true, searchPlaceholder: "Find", hideUnselectedCategory: false, groupByCategory: true,
  });
  assert.deepEqual(states.get("old"), { status: "ready", catalog: null });
});

const envelopeMutations: Array<[string, (input: Record<string, unknown>) => void]> = [
  ["wrong site", (input) => { input.siteId = "87654321"; }],
  ["wrong viewport", (input) => { input.viewport = "mobile"; }],
  ["missing ok", (input) => { delete input.ok; }],
  ["missing results", (input) => { delete input.results; }],
  ["missing catalog", (input) => { delete input.catalog; }],
  ["string revision", (input) => { (input.catalog as Record<string, unknown>).revision = "7"; }],
  ["negative revision", (input) => { (input.catalog as Record<string, unknown>).revision = -1; }],
  ["missing timestamp", (input) => { delete (input.catalog as Record<string, unknown>).updatedAt; }],
  ["missing product field", (input) => { delete ((input.catalog as { products: Record<string, unknown>[] }).products[0]).price; }],
  ["hidden product", (input) => { (input.catalog as { products: Record<string, unknown>[] }).products[0].availability = "hidden"; }],
  ["duplicate shared product", (input) => { const products = (input.catalog as { products: unknown[] }).products; products.push(products[0]); }],
  ["unknown category reference", (input) => { (input.catalog as { categories: { productIds: string[] }[] }).categories[0].productIds.push("missing"); }],
];
for (const [label, mutate] of envelopeMutations) {
  test(`batch decoder fails the whole chunk for ${label}`, () => {
    const input = payload() as unknown as Record<string, unknown>;
    mutate(input);
    for (const state of decodePublicCatalogBatch(input, expected).values()) {
      assert.deepEqual(state, { status: "error", catalog: null });
    }
  });
}

const entryMutations: Array<[string, (input: Record<string, unknown>) => void]> = [
  ["unknown status", (entry) => { entry.status = "success"; }],
  ["missing collection", (entry) => { delete entry.collection; }],
  ["mismatched collection", (entry) => { (entry.collection as Record<string, unknown>).blockId = "b"; }],
  ["mismatched viewport", (entry) => { (entry.collection as Record<string, unknown>).viewport = "mobile"; }],
  ["empty collection identity", (entry) => { (entry.collection as Record<string, unknown>).id = ""; }],
  ["missing product reference", (entry) => { entry.productIds = ["not-in-snapshot"]; }],
  ["non-array product references", (entry) => { entry.productIds = null; }],
  ["incomplete browsing rules", (entry) => { entry.browsingRules = { searchEnabled: true }; }],
];
for (const [label, mutate] of entryMutations) {
  test(`batch decoder isolates ${label} to its block`, () => {
    const input = payload();
    mutate(input.results[0] as unknown as Record<string, unknown>);
    const states = decodePublicCatalogBatch(input, expected);
    assert.deepEqual(states.get("a"), { status: "error", catalog: null });
    assert.equal(states.get("b")?.status, "ready");
    assert.deepEqual(states.get("old"), { status: "ready", catalog: null });
  });
}

test("missing and duplicate entries fail locally; unrequested entries never create state", () => {
  const missing = payload();
  missing.results.shift();
  assert.deepEqual(decodePublicCatalogBatch(missing, expected).get("a"), { status: "error", catalog: null });
  const duplicate = payload();
  duplicate.results.push(duplicate.results[0], { blockId: "unexpected", status: "legacy" });
  const states = decodePublicCatalogBatch(duplicate, expected);
  assert.deepEqual(states.get("a"), { status: "error", catalog: null });
  assert.equal(states.get("b")?.status, "ready");
  assert.equal(states.has("unexpected"), false);
});

test("only explicit legacy permits null fallback; empty ready and error remain distinguishable", () => {
  const input = payload();
  const ready = input.results[0];
  assert.equal(ready.status, "ready");
  if (ready.status === "ready") ready.productIds = [];
  input.results[1] = { blockId: "b", status: "error", error: "merchant_catalog_binding_unpublished", statusCode: 409 };
  const states = decodePublicCatalogBatch(input, expected);
  assert.equal(states.get("a")?.status, "ready");
  assert.notEqual(states.get("a")?.catalog, null);
  assert.deepEqual(states.get("a")?.catalog?.products, []);
  assert.deepEqual(states.get("b"), { status: "error", catalog: null });
  input.catalog = null;
  assert.deepEqual(decodePublicCatalogBatch(input, expected).get("a"), { status: "error", catalog: null });
  assert.deepEqual(decodePublicCatalogBatch(input, expected).get("old"), { status: "ready", catalog: null });
});

test("decoded collections and later snapshots cannot mutate another block's metadata or products", () => {
  const input = payload();
  const states = decodePublicCatalogBatch(input, expected);
  const a = states.get("a")!.catalog!;
  const b = states.get("b")!.catalog!;
  a.products[0].price = "20";
  a.categories[0].productIds.length = 0;
  assert.equal(b.products[0].price, "10");
  assert.equal(input.catalog!.products[1].price, "10");
  const next = payload();
  next.catalog!.revision = 8;
  next.catalog!.products[1].price = "30";
  const refreshed = decodePublicCatalogBatch(next, { ...expected, blockIds: ["a"] });
  assert.equal(refreshed.get("a")?.catalog?.revision, 8);
  assert.equal(b.revision, 7);
  assert.equal(b.products[0].price, "10");
});
