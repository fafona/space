import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMerchantCatalog, resolveMerchantCatalogCollection } from "@/lib/merchantCatalog";
import { createMerchantCatalogCollectionResolver } from "@/lib/merchantCatalogReadIndex";

const viewports: unknown[] = [undefined, "desktop", "mobile", "shared", " desktop ", "DESKTOP", "", null, 0, false, {}, ["mobile"]];
const browsingRules = {
  searchEnabled: false,
  searchPlaceholder: "  Find a product  ",
  hideUnselectedCategory: true,
  groupByCategory: false,
};

function catalog(collections: unknown[]) {
  return {
    revision: 7,
    updatedAt: "2026-09-25T00:00:00.000Z",
    pricePrefix: "EUR",
    products: [{ id: "product-1", name: "First" }, { id: "product-2", name: "Second" }],
    categories: [{ id: "category", name: "Category", productIds: ["product-1"] }],
    collections,
  };
}

function collection(id: string, viewport: unknown = "shared", blockId = "target") {
  return { id, blockId, viewport, productIds: ["product-2", "product-1"], browsingRules: { ...browsingRules } };
}

function assertParity(value: unknown, blockIds: unknown[]) {
  const resolve = createMerchantCatalogCollectionResolver(value);
  for (const blockId of blockIds) {
    for (const viewport of viewports) {
      assert.deepEqual(resolve(blockId, viewport), resolveMerchantCatalogCollection(value, blockId, viewport));
    }
  }
}

function countedCatalog(size = 24) {
  const reads = { products: 0, categories: 0, collections: 0 };
  const value = {
    products: Array.from({ length: size }, (_, index) => ({
      get id() { reads.products += 1; return `product-${index}`; },
      name: `Product ${index}`,
    })),
    categories: Array.from({ length: size }, (_, index) => ({
      id: `category-${index}`,
      get name() { reads.categories += 1; return `Category ${index}`; },
      productIds: [`product-${index}`],
    })),
    collections: Array.from({ length: size }, (_, index) => ({
      id: `collection-${index}`,
      get blockId() { reads.collections += 1; return `block-${index}`; },
      viewport: "shared",
      productIds: [`product-${index}`],
    })),
  };
  return { value, reads };
}

test("legacy collection lookups re-normalize every catalog record on each valid block lookup", () => {
  const { value, reads } = countedCatalog();
  for (let index = 0; index < 12; index += 1) {
    assert.equal(resolveMerchantCatalogCollection(value, `block-${index}`, "desktop")?.id, `collection-${index}`);
  }
  assert.deepEqual(reads, { products: 24 * 12, categories: 24 * 12, collections: 24 * 12 });
  assert.equal(resolveMerchantCatalogCollection(value, "missing", "mobile"), null);
  assert.deepEqual(reads, { products: 24 * 13, categories: 24 * 13, collections: 24 * 13 });
});

test("one prepared resolver normalizes all catalog records once and never revisits raw input", () => {
  const { value, reads } = countedCatalog();
  const resolve = createMerchantCatalogCollectionResolver(value);
  assert.deepEqual(reads, { products: 24, categories: 24, collections: 24 });
  for (let index = 0; index < 120; index += 1) {
    const block = index % 24;
    assert.equal(resolve(` block-${block} `, index % 2 ? "desktop" : "mobile")?.id, `collection-${block}`);
    assert.equal(resolve("missing", "desktop"), null);
    assert.equal(resolve(null, "mobile"), null);
  }
  assert.deepEqual(reads, { products: 24, categories: 24, collections: 24 });
  createMerchantCatalogCollectionResolver(value);
  assert.deepEqual(reads, { products: 48, categories: 48, collections: 48 });
});

test("all zero-to-three desktop/mobile/shared multiplicities match the legacy resolver", () => {
  for (let desktop = 0; desktop <= 3; desktop += 1) {
    for (let mobile = 0; mobile <= 3; mobile += 1) {
      for (let shared = 0; shared <= 3; shared += 1) {
        const collections = [
          ...Array.from({ length: desktop }, (_, index) => collection(`desktop-${index}`, "desktop")),
          ...Array.from({ length: mobile }, (_, index) => collection(`mobile-${index}`, "mobile")),
          ...Array.from({ length: shared }, (_, index) => collection(`shared-${index}`, "shared")),
          collection("unrelated", "shared", "other"),
        ];
        const value = catalog(collections);
        assertParity(value, ["target", " target ", "other", "missing"]);
        assertParity(normalizeMerchantCatalog(value), ["target"]);
      }
    }
  }
});

test("scope ambiguity fails closed only where the original resolver rejects it", () => {
  const resolve = createMerchantCatalogCollectionResolver(catalog([
    collection("desktop", "desktop"), collection("mobile-1", "mobile"), collection("mobile-2", "mobile"), collection("shared"),
  ]));
  assert.equal(resolve("target", "desktop")?.id, "desktop");
  assert.equal(resolve("target", "mobile"), null);
  assert.equal(resolve("target")?.id, "shared");
  const duplicateShared = createMerchantCatalogCollectionResolver(catalog([
    collection("desktop", "desktop"), collection("shared-1"), collection("shared-2"),
  ]));
  assert.equal(duplicateShared("target", "desktop"), null);
  assert.equal(duplicateShared("target"), null);
  const uniqueDesktop = createMerchantCatalogCollectionResolver(catalog([collection("desktop", "desktop")]));
  assert.equal(uniqueDesktop("target")?.id, "desktop");
  assert.equal(uniqueDesktop("target", "mobile"), null);
});

test("normalization parity includes malformed input, duplicate IDs, invalid scopes and unknown references", () => {
  const mixed = {
    products: [null, [], false, { id: 7 }, { id: " " }, { id: " product-1 " }, { id: "product-1", name: "Duplicate" }, { id: "product-2" }],
    categories: [null, {}, { id: "category", name: "Category", productIds: ["missing", "product-1"] }],
    collections: [
      null, [], false, { id: "missing-block" }, { id: 7, blockId: "target" },
      { id: " trimmed ", blockId: " target ", viewport: " desktop ", productIds: ["product-2", " product-1 ", "product-2", "unknown", 7, null], browsingRules },
      collection("trimmed", "desktop", "ignored-duplicate"),
      { ...collection("partial-rules", "mobile", "partial"), browsingRules: { searchEnabled: true } },
      { ...collection("array-rules", undefined, "array-rules"), browsingRules: [] },
      { ...collection("invalid-products", false, "invalid-products"), productIds: "product-1" },
      collection("valid-after-invalid", "desktop", ""), collection("valid-after-invalid", "mobile", "valid"),
    ],
  };
  const values: unknown[] = [undefined, null, false, 3, "catalog", Symbol("catalog"), [], [mixed], {}, Object.create(null),
    { products: {}, categories: "invalid", collections: {} }, mixed, normalizeMerchantCatalog(mixed)];
  for (const value of values) {
    assertParity(value, ["target", " target ", "ignored-duplicate", "partial", "array-rules", "invalid-products", "valid", "missing", "", " ", null, 7, {}, ["target"], Symbol("target")]);
  }
  const resolve = createMerchantCatalogCollectionResolver(mixed);
  assert.deepEqual(resolve("target", "desktop")?.productIds, ["product-2", "product-1"]);
  assert.equal(resolve("target", "desktop")?.viewport, "shared");
  assert.equal(resolve("ignored-duplicate"), null);
  assert.equal(Object.hasOwn(resolve("partial")!, "browsingRules"), false);
});

test("prototype-like block/product/collection IDs are ordinary map keys", () => {
  const ids = ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype", "城市/咖啡", "a\u0000b"];
  const value = {
    products: ids.map((id) => ({ id })),
    collections: ids.map((id) => ({ id, blockId: id, viewport: "shared", productIds: [...ids, "__proto__"] })),
  };
  assertParity(value, ids);
  const resolve = createMerchantCatalogCollectionResolver(value);
  for (const id of ids) assert.deepEqual(resolve(id)?.productIds, ids);
});

test("every returned collection and nested value is independent of previous results", () => {
  const value = catalog([collection("shared")]);
  const expected = resolveMerchantCatalogCollection(value, "target", "desktop");
  const resolve = createMerchantCatalogCollectionResolver(value);
  const first = resolve("target", "desktop")!;
  const second = resolve("target", "mobile")!;
  assert.notEqual(first, second);
  assert.notEqual(first.productIds, second.productIds);
  assert.notEqual(first.browsingRules, second.browsingRules);
  first.id = "changed";
  first.blockId = "changed";
  first.viewport = "mobile";
  first.productIds.splice(0, first.productIds.length, "unknown");
  first.browsingRules!.searchEnabled = true;
  first.browsingRules!.searchPlaceholder = "changed";
  delete first.browsingRules;
  assert.deepEqual(second, expected);
  assert.deepEqual(resolve("target", "desktop"), expected);
  assert.deepEqual(resolveMerchantCatalogCollection(value, "target", "desktop"), expected);
  const withoutRules = createMerchantCatalogCollectionResolver(catalog([{ id: "legacy", blockId: "target", productIds: ["product-1"] }]));
  const legacy = withoutRules("target")!;
  legacy.browsingRules = { ...browsingRules };
  legacy.productIds.push("unknown");
  assert.deepEqual(withoutRules("target"), { id: "legacy", blockId: "target", viewport: "shared", productIds: ["product-1"] });
});

test("input changes do not mutate a prepared snapshot and are visible to the next factory", () => {
  const rawCollection = collection("shared");
  const value = catalog([rawCollection]);
  const expected = resolveMerchantCatalogCollection(value, "target");
  const oldResolve = createMerchantCatalogCollectionResolver(value);
  rawCollection.productIds.splice(0, 2, "product-2", "new-product");
  rawCollection.browsingRules.searchPlaceholder = "New search";
  rawCollection.blockId = "moved";
  value.products[0]!.id = "new-product";
  value.collections.push(collection("added", "mobile", "added"));
  assert.deepEqual(oldResolve("target"), expected);
  assert.equal(oldResolve("moved"), null);
  assert.equal(oldResolve("added"), null);
  const newResolve = createMerchantCatalogCollectionResolver(value);
  for (const blockId of ["target", "moved", "added"]) {
    for (const viewport of viewports) {
      assert.deepEqual(newResolve(blockId, viewport), resolveMerchantCatalogCollection(value, blockId, viewport));
    }
  }
  assert.deepEqual(newResolve("moved")?.productIds, ["product-2", "new-product"]);
  assert.equal(newResolve("moved")?.browsingRules?.searchPlaceholder, "New search");
});
