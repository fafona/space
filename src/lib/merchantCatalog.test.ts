import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import {
  applyMerchantCatalogMutation,
  bootstrapMerchantCatalogFromPublishedBlocks,
  createMerchantCatalogRuntimeContextKey,
  getMerchantCatalogValidationError,
  isMerchantCatalogRuntimeContextCurrent,
  MERCHANT_CATALOG_MAX_CATEGORIES,
  MERCHANT_CATALOG_MAX_PRODUCT_IMAGE_IMPORT_ITEMS,
  MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH,
  MERCHANT_CATALOG_MAX_SERIALIZED_BYTES,
  normalizeMerchantCatalog,
  parseMerchantCatalogChangedEventDetail,
  parseMerchantCatalog,
  parseStrictMerchantCatalog,
  planMerchantCatalogProductImageImport,
  planMerchantCatalogProductImageMatches,
  planMerchantCatalogProductImport,
  prepareMerchantCatalogProductImageImport,
  resolveMerchantCatalogCollection,
  serializeMerchantCatalog,
  type MerchantCatalogProduct,
} from "@/lib/merchantCatalog";
import { normalizeProductItems } from "@/lib/productBlock";

type ProductBlock = Extract<Block, { type: "product" }>;

test("catalog runtime context keys normalize and isolate site, block, and viewport", () => {
  const desktopKey = createMerchantCatalogRuntimeContextKey(
    "12345678",
    "product-block",
    "desktop",
  );
  const mobileKey = createMerchantCatalogRuntimeContextKey(
    "12345678",
    "product-block",
    "mobile",
  );
  assert.equal(
    createMerchantCatalogRuntimeContextKey(" 12345678 ", " product-block ", "desktop"),
    '["12345678","product-block","desktop"]',
  );
  assert.notEqual(
    desktopKey,
    mobileKey,
  );
  assert.notEqual(
    createMerchantCatalogRuntimeContextKey("12345678", "product-block", "desktop"),
    createMerchantCatalogRuntimeContextKey("87654321", "product-block", "desktop"),
  );
  assert.equal(
    createMerchantCatalogRuntimeContextKey("", "product-block", "desktop"),
    '["","product-block","desktop"]',
  );
  assert.equal(createMerchantCatalogRuntimeContextKey("12345678", "", "desktop"), "");
  assert.equal(createMerchantCatalogRuntimeContextKey("12345678", "product-block", "shared"), "");
  assert.equal(isMerchantCatalogRuntimeContextCurrent(desktopKey, desktopKey), true);
  assert.equal(isMerchantCatalogRuntimeContextCurrent(desktopKey, mobileKey), false);
  assert.equal(isMerchantCatalogRuntimeContextCurrent(desktopKey, ""), false);
});

test("catalog change event detail contains only a valid merchant and revision", () => {
  assert.deepEqual(
    parseMerchantCatalogChangedEventDetail({
      siteId: " 12345678 ",
      revision: 7,
      products: [{ name: "must not cross the event boundary" }],
    }),
    { siteId: "12345678", revision: 7 },
  );
  assert.equal(parseMerchantCatalogChangedEventDetail({ siteId: "other", revision: 7 }), null);
  assert.equal(parseMerchantCatalogChangedEventDetail({ siteId: "12345678", revision: -1 }), null);
  assert.equal(parseMerchantCatalogChangedEventDetail({ siteId: "12345678", revision: 1.5 }), null);
});

function productBlock(
  overrides: Partial<MerchantCatalogProduct> = {},
  pricePrefix = "€",
  propsOverrides: Partial<ProductBlock["props"]> = {},
): ProductBlock {
  return {
    id: "product-block",
    type: "product",
    props: {
      productPricePrefix: pricePrefix,
      ...propsOverrides,
      products: propsOverrides.products ?? [
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
  assert.deepEqual(result.catalog?.collections[0]?.browsingRules, {
    searchEnabled: true,
    searchPlaceholder: "",
    hideUnselectedCategory: true,
    groupByCategory: false,
  });
  assert.deepEqual(result.catalog?.categories[0], {
    id: "category-44-72-69-6e-6b-73",
    name: "Drinks",
    productIds: ["stable-product-id"],
  });
});

test("bootstrap keeps browsing rules isolated by desktop, mobile, and shared collection scope", () => {
  const desktop = productBlock({}, "€", {
    productSearchEnabled: false,
    productSearchPlaceholder: "  Search desktop  ",
    productTagHideUnselected: false,
    productGroupByTag: true,
  });
  const mobile = productBlock({}, "€", {
    productSearchEnabled: true,
    productSearchPlaceholder: "Search mobile",
    productTagHideUnselected: true,
    productGroupByTag: false,
  });
  const scoped = bootstrapMerchantCatalogFromPublishedBlocks({
    blocks: publishedDesktopAndMobile(desktop, mobile),
  });

  assert.equal(scoped.ok, true);
  assert.deepEqual(
    scoped.catalog?.collections.map((collection) => [collection.viewport, collection.browsingRules]),
    [
      [
        "desktop",
        {
          searchEnabled: false,
          searchPlaceholder: "Search desktop",
          hideUnselectedCategory: false,
          groupByCategory: true,
        },
      ],
      [
        "mobile",
        {
          searchEnabled: true,
          searchPlaceholder: "Search mobile",
          hideUnselectedCategory: true,
          groupByCategory: false,
        },
      ],
    ],
  );

  const shared = bootstrapMerchantCatalogFromPublishedBlocks({
    blocks: [productBlock({}, "€", {
      productSearchEnabled: false,
      productSearchPlaceholder: "Shared search",
      productTagHideUnselected: true,
      productGroupByTag: true,
    })],
  });
  assert.equal(shared.ok, true);
  assert.equal(shared.catalog?.collections[0]?.viewport, "shared");
  assert.deepEqual(
    shared.catalog ? resolveMerchantCatalogCollection(shared.catalog, "product-block", "mobile")?.browsingRules : null,
    {
      searchEnabled: false,
      searchPlaceholder: "Shared search",
      hideUnselectedCategory: true,
      groupByCategory: true,
    },
  );
});

test("bootstrap rejects ambiguous shared browsing rules and oversized search placeholders", () => {
  const ambiguous = bootstrapMerchantCatalogFromPublishedBlocks({
    blocks: [
      productBlock({}, "€", { productSearchEnabled: true }),
      productBlock({}, "€", { productSearchEnabled: false }),
    ],
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.catalog, null);
  assert.ok(ambiguous.conflicts.some((conflict) => conflict.field === "browsing_rules"));

  const oversized = bootstrapMerchantCatalogFromPublishedBlocks({
    blocks: [productBlock({}, "€", {
      productSearchPlaceholder: "x".repeat(MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH + 1),
    })],
  });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.catalog, null);
  assert.ok(oversized.conflicts.some((conflict) => conflict.field === "search_placeholder_too_long"));
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

test("browsing rules normalize as a complete optional object and legacy collections stay undefined", () => {
  const legacy = linkedCatalog();
  assert.equal(legacy.collections[0]?.browsingRules, undefined);

  const withRules = normalizeMerchantCatalog({
    ...legacy,
    collections: legacy.collections.map((collection, index) =>
      index === 0
        ? {
            ...collection,
            browsingRules: {
              searchEnabled: false,
              searchPlaceholder: "  Find a product  ",
              hideUnselectedCategory: true,
              groupByCategory: false,
            },
          }
        : collection,
    ),
  });
  assert.deepEqual(withRules.collections[0]?.browsingRules, {
    searchEnabled: false,
    searchPlaceholder: "Find a product",
    hideUnselectedCategory: true,
    groupByCategory: false,
  });
  assert.deepEqual(parseMerchantCatalog(serializeMerchantCatalog(withRules)), withRules);

  const incomplete = normalizeMerchantCatalog({
    ...legacy,
    collections: legacy.collections.map((collection, index) =>
      index === 0 ? { ...collection, browsingRules: { searchEnabled: false } } : collection,
    ),
  });
  assert.equal(incomplete.collections[0]?.browsingRules, undefined);
});

test("strict catalogs accept missing or complete browsing rules and reject malformed or oversized rules", () => {
  const legacy = linkedCatalog();
  assert.ok(parseStrictMerchantCatalog(legacy));

  const complete = {
    ...legacy,
    collections: legacy.collections.map((collection, index) =>
      index === 0
        ? {
            ...collection,
            browsingRules: {
              searchEnabled: true,
              searchPlaceholder: "  Search  ",
              hideUnselectedCategory: false,
              groupByCategory: true,
            },
          }
        : collection,
    ),
  };
  assert.deepEqual(parseStrictMerchantCatalog(complete)?.collections[0]?.browsingRules, {
    searchEnabled: true,
    searchPlaceholder: "Search",
    hideUnselectedCategory: false,
    groupByCategory: true,
  });

  assert.equal(
    parseStrictMerchantCatalog({
      ...complete,
      collections: complete.collections.map((collection, index) =>
        index === 0
          ? { ...collection, browsingRules: { searchEnabled: true, searchPlaceholder: "Search" } }
          : collection,
      ),
    }),
    null,
  );
  assert.equal(
    parseStrictMerchantCatalog({
      ...complete,
      collections: complete.collections.map((collection, index) =>
        index === 0
          ? {
              ...collection,
              browsingRules: {
                ...collection.browsingRules,
                searchPlaceholder: "x".repeat(MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH + 1),
              },
            }
          : collection,
      ),
    }),
    null,
  );
});

test("upsert_collection trims complete browsing rules and rejects partial rules", () => {
  const catalog = linkedCatalog();
  const updated = applyMerchantCatalogMutation(catalog, {
    action: "upsert_collection",
    collection: {
      ...catalog.collections[0],
      browsingRules: {
        searchEnabled: false,
        searchPlaceholder: "  Browse  ",
        hideUnselectedCategory: false,
        groupByCategory: true,
      },
    },
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.deepEqual(updated.catalog.collections[0]?.browsingRules, {
    searchEnabled: false,
    searchPlaceholder: "Browse",
    hideUnselectedCategory: false,
    groupByCategory: true,
  });

  const staleClientUpdate = applyMerchantCatalogMutation(updated.catalog, {
    action: "upsert_collection",
    collection: {
      id: updated.catalog.collections[0]!.id,
      blockId: updated.catalog.collections[0]!.blockId,
      viewport: updated.catalog.collections[0]!.viewport,
      productIds: updated.catalog.collections[0]!.productIds,
    },
  });
  assert.equal(staleClientUpdate.ok, true);
  if (!staleClientUpdate.ok) return;
  assert.deepEqual(
    staleClientUpdate.catalog.collections[0]?.browsingRules,
    updated.catalog.collections[0]?.browsingRules,
  );

  assert.deepEqual(
    applyMerchantCatalogMutation(catalog, {
      action: "upsert_collection",
      collection: {
        ...catalog.collections[0],
        browsingRules: { searchEnabled: false },
      },
    }),
    { ok: false, error: "invalid_merchant_catalog_browsing_rules" },
  );
  assert.deepEqual(
    applyMerchantCatalogMutation(catalog, {
      action: "upsert_collection",
      collection: {
        ...catalog.collections[0],
        browsingRules: {
          searchEnabled: true,
          searchPlaceholder: "x".repeat(MERCHANT_CATALOG_MAX_SEARCH_PLACEHOLDER_LENGTH + 1),
          hideUnselectedCategory: true,
          groupByCategory: false,
        },
      },
    }),
    { ok: false, error: "invalid_merchant_catalog_browsing_rules" },
  );
});

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

test("bulk product import creates hidden unplaced products and derives their category", () => {
  const source = linkedCatalog();
  const plan = planMerchantCatalogProductImport(source, [
    {
      code: "NEW-001",
      name: "New product",
      description: "Imported description",
      price: "19.90",
      tag: "Imported",
      imageUrl: "https://example.com/must-not-be-used.jpg",
      availability: "available",
    },
  ]);

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const product = plan.catalog.products.find((item) => item.code === "NEW-001");
  assert.ok(product);
  assert.equal(product.availability, "hidden");
  assert.equal(product.imageUrl, "");
  assert.equal(product.thumbnailUrl, "");
  assert.ok(plan.catalog.collections.every((collection) => !collection.productIds.includes(product.id)));
  assert.deepEqual(
    plan.catalog.categories.find((category) => category.name === "Imported"),
    { id: "category-49-6d-70-6f-72-74-65-64", name: "Imported", productIds: [product.id] },
  );
  assert.deepEqual(plan.rows, [
    {
      rowIndex: 0,
      code: "NEW-001",
      normalizedCode: "NEW001",
      action: "create",
      productId: product.id,
    },
  ]);
  assert.deepEqual(plan.summary, { total: 1, created: 1, updated: 0, unchanged: 0 });
  assert.deepEqual(source, linkedCatalog());
});

test("bulk product import suffixes a derived category id collision without overwriting either category", () => {
  const source = linkedCatalog();
  source.categories.push({
    id: "category-4e-65-77",
    name: "Reserved category id",
    productIds: [],
  });

  const plan = planMerchantCatalogProductImport(source, [
    { code: "NEW-001", name: "New product", price: "1.00", tag: "New" },
  ]);

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(
    plan.catalog.categories.filter((category) => category.id.startsWith("category-4e-65-77")),
    [
      { id: "category-4e-65-77", name: "Reserved category id", productIds: [] },
      {
        id: "category-4e-65-77-2",
        name: "New",
        productIds: [plan.rows[0]?.productId],
      },
    ],
  );
});

test("bulk product import updates only non-empty editable fields and preserves operating state", () => {
  const source = linkedCatalog();
  source.products[0] = {
    ...source.products[0]!,
    imageUrl: "https://example.com/original.jpg",
    thumbnailUrl: "https://example.com/original-thumb.jpg",
    availability: "sold_out",
  };
  const plan = planMerchantCatalogProductImport(source, [
    {
      code: "a",
      name: "Updated name",
      description: "",
      price: "",
      tag: "",
      imageUrl: "https://example.com/replacement.jpg",
      availability: "available",
    },
  ]);

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.catalog.products[0], {
    ...source.products[0],
    code: "a",
    name: "Updated name",
  });
  assert.equal(plan.rows[0]?.action, "update");
  assert.deepEqual(plan.catalog.collections, source.collections);
  assert.deepEqual(plan.catalog.categories, source.categories);
});

test("bulk product import rejects duplicate normalized codes in the file or operating catalog", () => {
  const source = linkedCatalog();
  assert.deepEqual(
    planMerchantCatalogProductImport(source, [
      { code: "NEW-001", name: "One", price: "1" },
      { code: "new 001", name: "Two", price: "2" },
    ]),
    { ok: false, error: "merchant_catalog_import_duplicate_code", rowIndex: 1 },
  );

  source.products.push({
    ...source.products[0]!,
    id: "product-duplicate-code",
    code: "a",
    availability: "hidden",
  });
  assert.deepEqual(
    planMerchantCatalogProductImport(source, [{ code: "NEW-001", name: "One", price: "1" }]),
    { ok: false, error: "merchant_catalog_existing_duplicate_code" },
  );
});

test("bulk product import requires a usable code on every row", () => {
  assert.deepEqual(
    planMerchantCatalogProductImport(linkedCatalog(), []),
    { ok: false, error: "invalid_merchant_catalog_import_items" },
  );
  assert.deepEqual(
    planMerchantCatalogProductImport(linkedCatalog(), [{ code: "", name: "Missing", price: "1" }]),
    { ok: false, error: "invalid_merchant_catalog_import_code", rowIndex: 0 },
  );
  assert.deepEqual(
    planMerchantCatalogProductImport(linkedCatalog(), [{ code: "---", name: "Missing", price: "1" }]),
    { ok: false, error: "invalid_merchant_catalog_import_code", rowIndex: 0 },
  );
});

test("bulk product import rejects oversized row sets and known-field payloads before planning", () => {
  const tooMany = Array.from({ length: 1_001 }, (_, index) => ({
    code: `IMPORT-${index}`,
    name: `Product ${index}`,
    price: "1.00",
  }));
  assert.deepEqual(
    planMerchantCatalogProductImport(linkedCatalog(), tooMany),
    { ok: false, error: "merchant_catalog_limit_exceeded" },
  );
  assert.deepEqual(
    planMerchantCatalogProductImport(linkedCatalog(), [
      {
        code: "IMPORT-LARGE",
        name: "Product",
        description: "x".repeat(512_001),
        price: "1.00",
      },
    ]),
    { ok: false, error: "merchant_catalog_limit_exceeded", rowIndex: 0 },
  );
});

test("bulk product import requires a name and strict price for new products", () => {
  assert.deepEqual(
    planMerchantCatalogProductImport(linkedCatalog(), [{ code: "NEW-001", name: "", price: "1" }]),
    { ok: false, error: "invalid_merchant_catalog_import_product_name", rowIndex: 0 },
  );
  for (const price of ["", "-1", "1.234", "01.00", "1000000000"]) {
    assert.deepEqual(
      planMerchantCatalogProductImport(linkedCatalog(), [{ code: "NEW-001", name: "New", price }]),
      { ok: false, error: "invalid_merchant_catalog_import_product_price", rowIndex: 0 },
    );
  }
  assert.equal(
    planMerchantCatalogProductImport(linkedCatalog(), [
      { code: "NEW-001", name: "Free", price: "0" },
    ]).ok,
    true,
  );
});

test("bulk product import enforces serialized capacity atomically", () => {
  const source = normalizeMerchantCatalog({
    revision: 7,
    updatedAt: "2026-08-17T10:00:00.000Z",
    pricePrefix: "€",
    products: [],
    categories: [],
    collections: [],
  });
  let index = 0;
  while (index < 999) {
    const candidate = {
      ...source,
      products: [
        ...source.products,
        {
          id: `capacity-${index}`,
          code: `CAP-${index}`,
          name: `Capacity ${index}`,
          description: "x".repeat(3_000),
          price: "1.00",
          imageUrl: "",
          thumbnailUrl: "",
          tag: "",
          availability: "hidden" as const,
        },
      ],
    };
    if (getMerchantCatalogValidationError(candidate)) break;
    source.products = candidate.products;
    index += 1;
  }
  assert.equal(getMerchantCatalogValidationError(source), null);
  assert.ok(source.products.length > 0 && source.products.length < 999);
  const snapshot = structuredClone(source);

  const result = applyMerchantCatalogMutation(source, {
    action: "bulk_import_products",
    items: [
      {
        code: "CAPACITY-OVERFLOW",
        name: "Overflow",
        description: "y".repeat(4_000),
        price: "1.00",
      },
    ],
  });

  assert.deepEqual(result, { ok: false, error: "merchant_catalog_limit_exceeded" });
  assert.deepEqual(source, snapshot);
});

test("bulk product import rejects a new category past the category limit atomically", () => {
  const source = linkedCatalog();
  source.categories.push(
    ...Array.from(
      { length: MERCHANT_CATALOG_MAX_CATEGORIES - source.categories.length },
      (_, index) => ({ id: `filled-${index}`, name: `Filled ${index}`, productIds: [] }),
    ),
  );
  assert.equal(getMerchantCatalogValidationError(source), null);
  const snapshot = structuredClone(source);

  const result = applyMerchantCatalogMutation(source, {
    action: "bulk_import_products",
    items: [{ code: "CATEGORY-OVERFLOW", name: "Overflow", price: "1.00", tag: "Overflow" }],
  });

  assert.deepEqual(result, { ok: false, error: "merchant_catalog_limit_exceeded" });
  assert.deepEqual(source, snapshot);
});

test("bulk product import plans are stable and mutation uses the same catalog", () => {
  const source = linkedCatalog();
  const items = [
    { code: "A", name: "Product A", description: "", price: "", tag: "" },
    { code: "NEW-001", name: "New", description: "Description", price: "2.50", tag: "New" },
  ];
  const first = planMerchantCatalogProductImport(source, items);
  const second = planMerchantCatalogProductImport(source, structuredClone(items));

  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.rows.map((row) => row.action), ["unchanged", "create"]);
  assert.deepEqual(first.summary, { total: 2, created: 1, updated: 0, unchanged: 1 });
  assert.deepEqual(
    applyMerchantCatalogMutation(source, { action: "bulk_import_products", items }),
    { ok: true, catalog: first.catalog },
  );
  assert.equal(new Set(first.catalog.products.map((product) => product.id)).size, first.catalog.products.length);
});

const IMAGE_MERCHANT_ID = "12345678";

function productImageAssetUrl(
  fileName = "1723867200000-abc123.jpg",
  merchantId = IMAGE_MERCHANT_ID,
  bucket = "page-assets",
) {
  return `/storage/v1/object/public/${bucket}/merchant-assets/${merchantId}/2026/08/${fileName}`;
}

test("product image filename preview returns stable matched and unmatched rows without uploading", () => {
  const plan = planMerchantCatalogProductImageMatches(linkedCatalog(), ["A.jpg", "missing.png"]);

  assert.deepEqual(plan, {
    ok: true,
    rows: [
      {
        rowIndex: 0,
        fileName: "A.jpg",
        code: "A",
        normalizedCode: "A",
        status: "matched",
        productId: "product-a",
      },
      {
        rowIndex: 1,
        fileName: "missing.png",
        code: "missing",
        normalizedCode: "MISSING",
        status: "unmatched",
      },
    ],
    summary: { total: 2, matched: 1, unmatched: 1, duplicates: 0 },
  });
});

test("product image filename preview rejects duplicates with structured rows", () => {
  const plan = planMerchantCatalogProductImageMatches(linkedCatalog(), ["A.jpg", "a.png"]);

  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.error, "merchant_catalog_image_import_duplicate_code");
  assert.equal(plan.rowIndex, 1);
  assert.deepEqual(plan.rows?.map((row) => row.status), ["duplicate", "duplicate"]);
  assert.deepEqual(plan.summary, { total: 2, matched: 0, unmatched: 0, duplicates: 2 });

  const ambiguous = linkedCatalog();
  ambiguous.products.push({
    ...ambiguous.products[0]!,
    id: "product-a-duplicate",
    code: "a",
    availability: "hidden",
  });
  const existingDuplicate = planMerchantCatalogProductImageMatches(ambiguous, ["A.jpg"]);
  assert.equal(existingDuplicate.ok, false);
  if (!existingDuplicate.ok) {
    assert.equal(existingDuplicate.error, "merchant_catalog_existing_duplicate_code");
    assert.deepEqual(existingDuplicate.rows?.map((row) => row.status), ["duplicate"]);
  }
});

test("product image import only accepts tenant-owned canonical upload assets", () => {
  const validImage = productImageAssetUrl();
  const validThumbnail = productImageAssetUrl("1723867200000-abc123-thumb.webp");
  const prepared = prepareMerchantCatalogProductImageImport(
    [{ fileName: "A.jpg", imageUrl: `https://faolla.com${validImage}`, thumbnailUrl: validThumbnail }],
    IMAGE_MERCHANT_ID,
  );
  assert.equal(prepared.ok, true);
  if (prepared.ok) {
    assert.equal(prepared.items[0]?.imageUrl, validImage);
    assert.equal(prepared.items[0]?.thumbnailUrl, validThumbnail);
    assert.equal(prepared.items[0]?.rowIndex, 0);
  }

  for (const imageUrl of [
    "https://evil.example/storage/v1/object/public/page-assets/merchant-assets/12345678/2026/08/1723867200000-abc123.jpg",
    productImageAssetUrl("1723867200000-abc123.jpg", "87654321"),
    "data:image/png;base64,AA==",
    "blob:https://faolla.com/id",
    `${validImage}?download=1`,
    productImageAssetUrl("1723867200000-abc123.svg"),
    productImageAssetUrl("1723867200000-abc123.gif"),
    productImageAssetUrl("1723867200000-abc123.bmp"),
  ]) {
    assert.deepEqual(
      prepareMerchantCatalogProductImageImport(
        [{ fileName: "A.jpg", imageUrl }],
        IMAGE_MERCHANT_ID,
      ),
      { ok: false, error: "invalid_merchant_catalog_product_image_asset", rowIndex: 0 },
    );
  }
});

test("product image import requires its thumbnail to share the uploaded image base", () => {
  assert.deepEqual(
    prepareMerchantCatalogProductImageImport(
      [
        {
          fileName: "A.jpg",
          imageUrl: productImageAssetUrl(),
          thumbnailUrl: productImageAssetUrl("1723867200001-def456-thumb.webp"),
        },
      ],
      IMAGE_MERCHANT_ID,
    ),
    { ok: false, error: "invalid_merchant_catalog_product_thumbnail_asset", rowIndex: 0 },
  );
  assert.deepEqual(
    prepareMerchantCatalogProductImageImport(
      [
        {
          fileName: "A.jpg",
          imageUrl: productImageAssetUrl(),
          thumbnailUrl: productImageAssetUrl("1723867200000-abc123-thumb.webp", IMAGE_MERCHANT_ID, "assets"),
        },
      ],
      IMAGE_MERCHANT_ID,
    ),
    { ok: false, error: "invalid_merchant_catalog_product_thumbnail_asset", rowIndex: 0 },
  );
});

test("product image import updates matched products atomically and preserves operating links", () => {
  const source = linkedCatalog();
  source.products[0]!.availability = "sold_out";
  const snapshot = structuredClone(source);
  const imageUrl = productImageAssetUrl();
  const thumbnailUrl = productImageAssetUrl("1723867200000-abc123-thumb.webp");
  const plan = planMerchantCatalogProductImageImport(
    source,
    [
      { fileName: "A.jpg", imageUrl, thumbnailUrl },
      { fileName: "not-found.jpg", imageUrl: productImageAssetUrl("1723867200002-ghi789.jpg") },
    ],
    IMAGE_MERCHANT_ID,
  );

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.summary, {
    total: 2,
    matched: 1,
    unmatched: 1,
    duplicates: 0,
    updated: 1,
    unchanged: 0,
  });
  assert.deepEqual(plan.rows.map((row) => row.action), ["update", "unmatched"]);
  assert.equal(plan.catalog.products[0]?.imageUrl, imageUrl);
  assert.equal(plan.catalog.products[0]?.thumbnailUrl, thumbnailUrl);
  assert.equal(plan.catalog.products[0]?.availability, "sold_out");
  assert.deepEqual(plan.catalog.categories, source.categories);
  assert.deepEqual(plan.catalog.collections, source.collections);
  assert.deepEqual(source, snapshot);
});

test("product image mutation rejects unchanged and unmatched-only batches without creating a revision", () => {
  const source = linkedCatalog();
  source.products[0]!.imageUrl = productImageAssetUrl();
  source.products[0]!.thumbnailUrl = productImageAssetUrl("1723867200000-abc123-thumb.webp");
  assert.deepEqual(
    applyMerchantCatalogMutation(source, {
      action: "bulk_set_product_images",
      merchantId: IMAGE_MERCHANT_ID,
      items: [
        {
          fileName: "A.jpg",
          imageUrl: source.products[0]!.imageUrl,
          thumbnailUrl: source.products[0]!.thumbnailUrl,
        },
      ],
    }),
    { ok: false, error: "merchant_catalog_image_import_no_changes" },
  );
  assert.deepEqual(
    applyMerchantCatalogMutation(linkedCatalog(), {
      action: "bulk_set_product_images",
      merchantId: IMAGE_MERCHANT_ID,
      items: [{ fileName: "missing.jpg", imageUrl: productImageAssetUrl() }],
    }),
    { ok: false, error: "merchant_catalog_image_import_no_changes" },
  );
});

test("product image import enforces the 100-file batch limit", () => {
  const fileNames = Array.from(
    { length: MERCHANT_CATALOG_MAX_PRODUCT_IMAGE_IMPORT_ITEMS + 1 },
    (_, index) => `SKU-${index}.jpg`,
  );
  assert.deepEqual(
    planMerchantCatalogProductImageMatches(linkedCatalog(), fileNames),
    { ok: false, error: "merchant_catalog_image_import_limit_exceeded" },
  );
});

test("product image import enforces final catalog capacity atomically", () => {
  const source = linkedCatalog();
  for (let index = 0; index < 999; index += 1) {
    const candidate = {
      ...source,
      products: [
        ...source.products,
        {
          id: `image-capacity-${index}`,
          code: `IMAGE-CAP-${index}`,
          name: `Image capacity ${index}`,
          description: "x".repeat(4_000),
          price: "1.00",
          imageUrl: "",
          thumbnailUrl: "",
          tag: "",
          availability: "hidden" as const,
        },
      ],
    };
    if (getMerchantCatalogValidationError(candidate)) break;
    source.products = candidate.products;
  }
  const filler = source.products.at(-1)!;
  const byteLength = () => new TextEncoder().encode(JSON.stringify(source)).byteLength;
  let remaining = MERCHANT_CATALOG_MAX_SERIALIZED_BYTES - byteLength() - 8;
  const fill = (field: "imageUrl" | "thumbnailUrl" | "tag", limit: number) => {
    const count = Math.max(0, Math.min(limit, remaining));
    filler[field] = "z".repeat(count);
    remaining -= count;
  };
  fill("imageUrl", 2_048);
  fill("thumbnailUrl", 2_048);
  fill("tag", 120);
  if (remaining > 0) {
    const suffix = "z".repeat(Math.min(240 - filler.name.length, remaining));
    filler.name += suffix;
  }
  assert.equal(getMerchantCatalogValidationError(source), null);
  assert.ok(MERCHANT_CATALOG_MAX_SERIALIZED_BYTES - byteLength() < productImageAssetUrl().length);
  const snapshot = structuredClone(source);

  const result = planMerchantCatalogProductImageImport(
    source,
    [{ fileName: "A.jpg", imageUrl: productImageAssetUrl() }],
    IMAGE_MERCHANT_ID,
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "merchant_catalog_limit_exceeded");
  assert.deepEqual(source, snapshot);
});
