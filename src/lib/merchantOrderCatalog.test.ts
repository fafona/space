import assert from "node:assert/strict";
import test from "node:test";
import type { Block } from "@/data/homeBlocks";
import { quotePublishedProductOrder } from "@/lib/merchantOrderCatalog";

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
