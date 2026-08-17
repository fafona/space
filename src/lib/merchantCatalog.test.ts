import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import {
  applyMerchantCatalogMutation,
  bootstrapMerchantCatalogFromPublishedBlocks,
  getMerchantCatalogValidationError,
  normalizeMerchantCatalog,
  parseMerchantCatalog,
  parseStrictMerchantCatalog,
  serializeMerchantCatalog,
  type MerchantCatalogProduct,
} from "@/lib/merchantCatalog";
import { normalizeProductItems } from "@/lib/productBlock";

type ProductBlock = Extract<Block, { type: "product" }>;

function productBlock(overrides: Partial<MerchantCatalogProduct> = {}, pricePrefix = "€"): ProductBlock {
  return {
    id: "product-block",
    type: "product",
    props: {
      productPricePrefix: pricePrefix,
      products: [
        {
          id: "stable-product-id",
          code: "SKU-001",
          name: "Coffee",
          description: "House roast",
          price: "12.50",
          imageUrl: "https://example.com/coffee.jpg",
          thumbnailUrl: "https://example.com/coffee-thumb.jpg",
          tag: "Drinks",
          ...overrides,
        },
      ],
    },
  };
}

function publishedDesktopAndMobile(desktop: Block, mobile: Block) {
  return [
    {
      id: "plan-carrier",
      type: "common",
      props: {
        pagePlanConfig: { plans: [{ pages: [{ blocks: [desktop] }] }] },
        pagePlanConfigMobile: { plans: [{ pages: [{ blocks: [mobile] }] }] },
      },
    } as unknown as Block,
  ];
}

test("bootstrap merges identical desktop/mobile products and keeps viewport collections", () => {
  const result = bootstrapMerchantCatalogFromPublishedBlocks({
    blocks: publishedDesktopAndMobile(productBlock(), productBlock()),
    revision: 3,
    updatedAt: "2026-08-17T10:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.sourceBlockCount, 2);
  assert.equal(result.catalog?.revision, 3);
  assert.equal(result.catalog?.pricePrefix, "€");
  assert.equal(result.catalog?.products.length, 1);
  assert.equal(result.catalog?.products[0]?.availability, "available");
  assert.deepEqual(
    result.catalog?.collections.map((collection) => collection.viewport),
    ["desktop", "mobile"],
  );
  assert.deepEqual(result.catalog?.collections[0]?.productIds, ["stable-product-id"]);
  assert.deepEqual(result.catalog?.categories[0], {
    id: "category-44-72-69-6e-6b-73",
    name: "Drinks",
    productIds: ["stable-product-id"],
  });
});

test("bootstrap preserves an existing product id exactly", () => {
  const result = bootstrapMerchantCatalogFromPublishedBlocks({
    desktopBlocks: [productBlock({ id: "product-canonical-2024" })],
  });

  assert.equal(result.ok, true);
  assert.equal(result.catalog?.products[0]?.id, "product-canonical-2024");
  assert.deepEqual(result.catalog?.collections[0]?.productIds, ["product-canonical-2024"]);
});

test("bootstrap uses the same deterministic legacy ids and duplicate suffixes as the published product block", () => {
  const legacyItems = [
    { code: "LEGACY", name: "Legacy", price: "8.00" },
    { code: "LEGACY", name: "Legacy", price: "8.00" },
  ];
  const expectedIds = normalizeProductItems(legacyItems).map((item) => item.id);
  const block = productBlock();
  block.props.products = legacyItems;

  const result = bootstrapMerchantCatalogFromPublishedBlocks({ desktopBlocks: [block] });

  assert.equal(result.ok, true);
  assert.deepEqual(result.catalog?.products.map((product) => product.id), expectedIds);
  assert.deepEqual(result.catalog?.collections[0]?.productIds, expectedIds);
});

test("bootstrap keeps configured empty categories instead of deriving categories only from products", () => {
  const block = productBlock();
  block.props.productTagOptions = ["Drinks", "Seasonal"];

  const result = bootstrapMerchantCatalogFromPublishedBlocks({ desktopBlocks: [block] });

  assert.equal(result.ok, true);
  assert.deepEqual(result.catalog?.categories.map((category) => [category.name, category.productIds]), [
    ["Drinks", ["stable-product-id"]],
    ["Seasonal", []],
  ]);
});

test("bootstrap blocks cross-viewport product price and name conflicts without choosing a side", () => {
  const result = bootstrapMerchantCatalogFromPublishedBlocks({
    blocks: publishedDesktopAndMobile(
      productBlock(),
      productBlock({ name: "Mobile coffee", price: "13.00" }),
    ),
  });

  assert.equal(result.ok, false);
  assert.equal(result.catalog, null);
  const productConflicts = result.conflicts.filter((conflict) => conflict.code === "product_field_conflict");
  assert.deepEqual(
    productConflicts.map((conflict) => conflict.field),
    ["name", "price"],
  );
  assert.ok(productConflicts.every((conflict) => conflict.productId === "stable-product-id"));
  assert.deepEqual(
    productConflicts.find((conflict) => conflict.field === "price")?.values.map((entry) => entry.value),
    ["12.50", "13.00"],
  );
});

test("bootstrap reports price_prefix conflicts as a catalog-level ambiguity", () => {
  const result = bootstrapMerchantCatalogFromPublishedBlocks({
    blocks: publishedDesktopAndMobile(productBlock({}, "€"), productBlock({}, "$")),
  });

  assert.equal(result.ok, false);
  assert.equal(result.catalog, null);
  assert.equal(result.conflicts[0]?.code, "catalog_field_conflict");
  assert.equal(result.conflicts[0]?.field, "price_prefix");
});

test("normalize and JSON round-trip are pure and reject invalid records/references", () => {
  const source = {
    revision: -1,
    updatedAt: " 2026-08-17T10:00:00.000Z ",
    pricePrefix: " € ",
    products: [
      {
        id: " product-a ",
        code: " A ",
        name: " Product A ",
        description: null,
        price: " 10.00 ",
        imageUrl: 42,
        thumbnailUrl: " thumb.jpg ",
        tag: " Category ",
        availability: "not-valid",
      },
      { id: "product-a", name: "duplicate" },
      null,
    ],
    categories: [{ id: " category-a ", name: " Category ", productIds: ["product-a", "missing"] }],
    collections: [
      {
        id: " collection-a ",
        blockId: " block-a ",
        viewport: "tablet",
        productIds: ["product-a", "missing", "product-a"],
      },
    ],
  };
  const snapshot = structuredClone(source);
  const normalized = normalizeMerchantCatalog(source);

  assert.deepEqual(source, snapshot);
  assert.equal(normalized.revision, 1);
  assert.equal(normalized.pricePrefix, "€");
  assert.equal(normalized.products[0]?.id, "product-a");
  assert.equal(normalized.products[0]?.availability, "available");
  assert.equal(normalized.products[0]?.imageUrl, "");
  assert.deepEqual(normalized.categories[0]?.productIds, ["product-a"]);
  assert.deepEqual(normalized.collections[0]?.productIds, ["product-a"]);
  assert.equal(normalized.collections[0]?.viewport, "shared");
  assert.deepEqual(parseMerchantCatalog(serializeMerchantCatalog(normalized)), normalized);
  assert.deepEqual(parseMerchantCatalog("{bad json"), normalizeMerchantCatalog(null));
});

test("bootstrap returns a structured invalid_input conflict for a malformed block source", () => {
  const result = bootstrapMerchantCatalogFromPublishedBlocks({ blocks: "not-an-array" });

  assert.equal(result.ok, false);
  assert.equal(result.catalog, null);
  assert.equal(result.conflicts[0]?.code, "invalid_input");
  assert.equal(result.conflicts[0]?.field, "blocks");
});

function linkedCatalog() {
  return normalizeMerchantCatalog({
    revision: 1,
    updatedAt: "2026-08-17T10:00:00.000Z",
    pricePrefix: "€",
    products: [
      {
        id: "product-a",
        code: "A",
        name: "Product A",
        description: "",
        price: "10.00",
        imageUrl: "",
        thumbnailUrl: "",
        tag: "Old",
        availability: "available",
      },
    ],
    categories: [
      { id: "old", name: "Old", productIds: ["product-a"] },
      { id: "unused", name: "Unused", productIds: [] },
    ],
    collections: [
      { id: "desktop", blockId: "products", viewport: "desktop", productIds: ["product-a"] },
      { id: "mobile", blockId: "products", viewport: "mobile", productIds: ["product-a"] },
    ],
  });
}

test("upsert_product uses explicit collection placement and creates its single category", () => {
  const result = applyMerchantCatalogMutation(linkedCatalog(), {
    action: "upsert_product",
    product: {
      id: "product-b",
      code: "B",
      name: "Product B",
      description: "",
      price: "20.00",
      imageUrl: "",
      thumbnailUrl: "",
      tag: "New",
      availability: "available",
    },
    collectionIds: ["desktop"],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.catalog.collections.find((collection) => collection.id === "desktop")?.productIds.includes("product-b"), true);
  assert.equal(result.catalog.collections.find((collection) => collection.id === "mobile")?.productIds.includes("product-b"), false);
  assert.deepEqual(
    result.catalog.categories.filter((category) => category.productIds.includes("product-b")),
    [{ id: "category-4e-65-77", name: "New", productIds: ["product-b"] }],
  );
});

test("new products cannot be silently published to multiple collections", () => {
  const result = applyMerchantCatalogMutation(linkedCatalog(), {
    action: "upsert_product",
    product: {
      id: "product-b",
      name: "Product B",
      price: "1.00",
      availability: "available",
    },
  });

  assert.deepEqual(result, { ok: false, error: "invalid_merchant_catalog_product_collections" });
});

test("upsert_product moves or clears the product's category relationship when tag changes", () => {
  const moved = applyMerchantCatalogMutation(linkedCatalog(), {
    action: "upsert_product",
    product: { ...linkedCatalog().products[0], tag: "New" },
  });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  assert.deepEqual(moved.catalog.categories.find((category) => category.id === "old")?.productIds, []);
  assert.deepEqual(
    moved.catalog.categories.filter((category) => category.productIds.includes("product-a")).map((category) => category.name),
    ["New"],
  );

  const cleared = applyMerchantCatalogMutation(moved.catalog, {
    action: "upsert_product",
    product: { ...moved.catalog.products[0], tag: "" },
  });
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.ok(cleared.catalog.categories.every((category) => !category.productIds.includes("product-a")));
  assert.equal(cleared.catalog.products[0]?.tag, "");
});

test("upsert_category synchronizes product tags, renames, and enforces one category", () => {
  const added = applyMerchantCatalogMutation(linkedCatalog(), {
    action: "upsert_category",
    category: { id: "new", name: "New", productIds: ["product-a"] },
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.catalog.products[0]?.tag, "New");
  assert.deepEqual(added.catalog.categories.find((category) => category.id === "old")?.productIds, []);
  assert.deepEqual(
    added.catalog.categories.filter((category) => category.productIds.includes("product-a")).map((category) => category.id),
    ["new"],
  );

  const renamed = applyMerchantCatalogMutation(added.catalog, {
    action: "upsert_category",
    category: { id: "new", name: "Renamed", productIds: ["product-a"] },
  });
  assert.equal(renamed.ok, true);
  if (!renamed.ok) return;
  assert.equal(renamed.catalog.products[0]?.tag, "Renamed");

  const removedFromCategory = applyMerchantCatalogMutation(renamed.catalog, {
    action: "upsert_category",
    category: { id: "new", name: "Renamed", productIds: [] },
  });
  assert.equal(removedFromCategory.ok, true);
  if (!removedFromCategory.ok) return;
  assert.equal(removedFromCategory.catalog.products[0]?.tag, "");
});

test("delete_category clears the tag of related products", () => {
  const result = applyMerchantCatalogMutation(linkedCatalog(), {
    action: "delete_category",
    categoryId: "old",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.catalog.products[0]?.tag, "");
  assert.equal(result.catalog.categories.some((category) => category.id === "old"), false);
});

test("category names stay unique because product tags reference the name", () => {
  const result = applyMerchantCatalogMutation(linkedCatalog(), {
    action: "upsert_category",
    category: { id: "another-old", name: "Old", productIds: [] },
  });

  assert.deepEqual(result, { ok: false, error: "merchant_catalog_category_name_conflict" });
});

test("catalog limits reject oversized operating data before storage", () => {
  const catalog = linkedCatalog();
  const oversized = {
    ...catalog,
    products: catalog.products.map((product, index) =>
      index === 0 ? { ...product, description: "x".repeat(4_001) } : product,
    ),
  };

  assert.equal(getMerchantCatalogValidationError(catalog), null);
  assert.equal(getMerchantCatalogValidationError(oversized), "merchant_catalog_limit_exceeded");
});

test("operating catalog prices must be explicit non-negative amounts", () => {
  const catalog = linkedCatalog();
  const invalid = {
    ...catalog,
    products: catalog.products.map((product, index) =>
      index === 0 ? { ...product, price: "待定" } : product,
    ),
  };
  const free = {
    ...catalog,
    products: catalog.products.map((product, index) =>
      index === 0 ? { ...product, price: "0" } : product,
    ),
  };

  assert.equal(getMerchantCatalogValidationError(invalid), "invalid_merchant_catalog_product_price");
  assert.equal(getMerchantCatalogValidationError(free), null);
});

test("bootstrap reports legacy invalid prices as source conflicts before saving", () => {
  const result = bootstrapMerchantCatalogFromPublishedBlocks({
    desktopBlocks: [productBlock({ price: "待定" })],
  });

  assert.equal(result.ok, false);
  assert.equal(result.catalog, null);
  assert.ok(result.conflicts.some((conflict) => conflict.field === "price_invalid"));
});

test("strict persisted catalogs fail closed on unknown availability and viewport", () => {
  const catalog = linkedCatalog();
  assert.ok(parseStrictMerchantCatalog(catalog));
  assert.equal(
    parseStrictMerchantCatalog({
      ...catalog,
      products: catalog.products.map((product, index) =>
        index === 0 ? { ...product, availability: "mystery" } : product,
      ),
    }),
    null,
  );
  assert.equal(
    parseStrictMerchantCatalog({
      ...catalog,
      collections: catalog.collections.map((collection, index) =>
        index === 0 ? { ...collection, viewport: "mystery" } : collection,
      ),
    }),
    null,
  );
});

test("collection mutations cannot orphan sellable products while another binding remains", () => {
  const catalog = linkedCatalog();
  catalog.collections[1] = { ...catalog.collections[1]!, productIds: [] };

  assert.deepEqual(
    applyMerchantCatalogMutation(catalog, {
      action: "upsert_collection",
      collection: { ...catalog.collections[0]!, productIds: [] },
    }),
    { ok: false, error: "merchant_catalog_product_not_placed" },
  );
  assert.deepEqual(
    applyMerchantCatalogMutation(catalog, {
      action: "delete_collection",
      collectionId: catalog.collections[0]!.id,
    }),
    { ok: false, error: "merchant_catalog_product_not_placed" },
  );

  const hiddenCatalog = {
    ...catalog,
    products: catalog.products.map((product) => ({ ...product, availability: "hidden" as const })),
  };
  assert.equal(
    applyMerchantCatalogMutation(hiddenCatalog, {
      action: "delete_collection",
      collectionId: hiddenCatalog.collections[0]!.id,
    }).ok,
    true,
  );

  const lastBindingCatalog = { ...catalog, collections: [catalog.collections[0]!] };
  assert.equal(
    applyMerchantCatalogMutation(lastBindingCatalog, {
      action: "delete_collection",
      collectionId: lastBindingCatalog.collections[0]!.id,
    }).ok,
    true,
  );
});
