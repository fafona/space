import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import {
  findMerchantCatalogCollection,
  hasPublishedProductBlockForViewport,
  hasMerchantCatalogCollectionForBlock,
  quoteMerchantCatalogOrder,
  quotePublishedProductOrder,
} from "@/lib/merchantOrderCatalog";
import type { MerchantCatalog } from "@/lib/merchantCatalog";

function productBlock(): Block {
  return {
    id: "product-block",
    type: "product",
    props: {
      productPricePrefix: "€",
      products: [
        {
          id: "product-a",
          code: "SKU-001",
          name: "Server product",
          description: "Published description",
          price: "1.234,56",
          imageUrl: "https://example.com/a.jpg",
          tag: "推荐",
        },
      ],
    },
  };
}

function operatingCatalog(): MerchantCatalog {
  return {
    revision: 3,
    updatedAt: "2026-08-17T12:00:00.000Z",
    pricePrefix: "€",
    categories: [],
    products: [
      {
        id: "product-a",
        code: "OPS-001",
        name: "Workbench product",
        description: "Operating catalog description",
        price: "12.50",
        imageUrl: "https://example.com/ops.jpg",
        thumbnailUrl: "",
        tag: "运营分类",
        availability: "available",
      },
      {
        id: "product-b",
        code: "OPS-002",
        name: "Sold out product",
        description: "",
        price: "9.00",
        imageUrl: "",
        thumbnailUrl: "",
        tag: "",
        availability: "sold_out",
      },
    ],
    collections: [
      { id: "desktop", blockId: "product-block", viewport: "desktop", productIds: ["product-a", "product-b"] },
      { id: "shared", blockId: "shared-block", viewport: "shared", productIds: ["product-a"] },
    ],
  };
}

test("operating catalog resolves exact viewport then shared collections", () => {
  const catalog = operatingCatalog();
  assert.equal(findMerchantCatalogCollection({ catalog, blockId: "product-block", viewport: "desktop" })?.id, "desktop");
  assert.equal(findMerchantCatalogCollection({ catalog, blockId: "product-block", viewport: "mobile" }), null);
  assert.equal(findMerchantCatalogCollection({ catalog, blockId: "shared-block", viewport: "mobile" })?.id, "shared");
  assert.equal(hasMerchantCatalogCollectionForBlock(catalog, "product-block"), true);
  assert.equal(hasMerchantCatalogCollectionForBlock(catalog, "legacy-block"), false);
});

test("quoteMerchantCatalogOrder uses operating data and rejects unavailable products", () => {
  const catalog = operatingCatalog();
  const quote = quoteMerchantCatalogOrder({
    catalog,
    blockId: "product-block",
    viewport: "desktop",
    items: [{ productId: "product-a", quantity: 2, name: "Tampered", unitPrice: 0.01 }],
  });
  assert.equal(quote.items[0]?.name, "Workbench product");
  assert.equal(quote.items[0]?.unitPrice, 12.5);
  assert.equal(quote.items[0]?.unitPriceText, "€12.50");
  assert.throws(
    () => quoteMerchantCatalogOrder({
      catalog,
      blockId: "product-block",
      viewport: "desktop",
      items: [{ productId: "product-b", quantity: 1 }],
    }),
    /order_product_unavailable/,
  );
  assert.throws(
    () =>
      quoteMerchantCatalogOrder({
        catalog: {
          ...catalog,
          products: catalog.products.map((product) =>
            product.id === "product-a" ? { ...product, price: "待定" } : product,
          ),
        },
        blockId: "product-block",
        viewport: "desktop",
        items: [{ productId: "product-a", quantity: 1 }],
      }),
    /order_product_price_invalid/,
  );
});

test("quotePublishedProductOrder uses published product data instead of browser supplied prices", () => {
  const quote = quotePublishedProductOrder({
    blocks: [productBlock()],
    blockId: "product-block",
    items: [
      {
        productId: "product-a",
        name: "Tampered name",
        quantity: 2,
        unitPrice: 0.01,
        unitPriceText: "0.01",
      },
    ],
  });

  assert.equal(quote.pricePrefix, "€");
  assert.equal(quote.items[0]?.name, "Server product");
  assert.equal(quote.items[0]?.unitPrice, 1234.56);
  assert.equal(quote.items[0]?.unitPriceText, "€1234.56");
});

test("quotePublishedProductOrder finds product blocks inside mobile plan data", () => {
  const nested = {
    id: "wrapper",
    type: "common",
    props: {
      mobilePlanConfig: {
        plans: [{ pages: [{ blocks: [productBlock()] }] }],
      },
    },
  } as unknown as Block;
  const quote = quotePublishedProductOrder({
    blocks: [nested],
    blockId: "product-block",
    items: [{ productId: "product-a", quantity: 1 }],
  });
  assert.equal(quote.items[0]?.productId, "product-a");
});

test("quotePublishedProductOrder selects metadata from the requested published viewport", () => {
  const nested = {
    id: "wrapper",
    type: "common",
    props: {
      pagePlanConfig: { plans: [{ pages: [{ blocks: [productBlock()] }] }] },
      pagePlanConfigMobile: {
        plans: [{
          pages: [{
            blocks: [{
              id: "product-block",
              type: "product",
              props: {
                productPricePrefix: "€",
                products: [{
                  id: "product-a",
                  code: "SKU-001",
                  name: "Mobile product",
                  description: "Mobile description",
                  price: "1.234,56",
                  imageUrl: "https://example.com/mobile.jpg",
                  tag: "Featured",
                }],
              },
            }],
          }],
        }],
      },
    },
  } as unknown as Block;

  const quote = quotePublishedProductOrder({
    blocks: [nested],
    blockId: "product-block",
    viewport: "mobile",
    items: [{ productId: "product-a", quantity: 1 }],
  });

  assert.equal(quote.items[0]?.name, "Mobile product");
  assert.equal(quote.items[0]?.imageUrl, "https://example.com/mobile.jpg");
});

test("published scope lookup rejects a client-selected viewport that was not published", () => {
  const desktopOnly = {
    id: "wrapper",
    type: "common",
    props: {
      pagePlanConfig: { plans: [{ pages: [{ blocks: [productBlock()] }] }] },
    },
  } as unknown as Block;

  assert.equal(hasPublishedProductBlockForViewport([desktopOnly], "product-block", "desktop"), true);
  assert.equal(hasPublishedProductBlockForViewport([desktopOnly], "product-block", "mobile"), false);
  assert.throws(
    () =>
      quotePublishedProductOrder({
        blocks: [desktopOnly],
        blockId: "product-block",
        viewport: "mobile",
        items: [{ productId: "product-a", quantity: 1 }],
      }),
    /order_product_block_not_found/,
  );
});

test("quotePublishedProductOrder rejects conflicting prices across published viewports", () => {
  const nested = {
    id: "wrapper",
    type: "common",
    props: {
      pagePlanConfig: { plans: [{ pages: [{ blocks: [productBlock()] }] }] },
      pagePlanConfigMobile: {
        plans: [{
          pages: [{
            blocks: [{
              id: "product-block",
              type: "product",
              props: {
                productPricePrefix: "€",
                products: [{ id: "product-a", name: "Mobile product", price: "1.00" }],
              },
            }],
          }],
        }],
      },
    },
  } as unknown as Block;

  assert.throws(
    () =>
      quotePublishedProductOrder({
        blocks: [nested],
        blockId: "product-block",
        viewport: "mobile",
        items: [{ productId: "product-a", quantity: 1 }],
      }),
    /order_product_catalog_conflict/,
  );
});

test("quotePublishedProductOrder rejects unknown products, duplicates and excessive quantities", () => {
  assert.throws(
    () =>
      quotePublishedProductOrder({
        blocks: [productBlock()],
        blockId: "product-block",
        items: [{ productId: "missing", quantity: 1 }],
      }),
    /order_product_not_found/,
  );
  assert.throws(
    () =>
      quotePublishedProductOrder({
        blocks: [productBlock()],
        blockId: "product-block",
        items: [
          { productId: "product-a", quantity: 1 },
          { productId: "product-a", quantity: 1 },
        ],
      }),
    /order_item_invalid/,
  );
  assert.throws(
    () =>
      quotePublishedProductOrder({
        blocks: [productBlock()],
        blockId: "product-block",
        items: [{ productId: "product-a", quantity: 1000 }],
      }),
    /order_quantity_invalid/,
  );
});
