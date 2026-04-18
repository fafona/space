import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantOrder } from "@/lib/merchantOrders";
import { chunkMerchantOrderRecords, mergeStoredMerchantOrdersRows } from "@/lib/merchantOrdersStore";

test("chunkMerchantOrderRecords splits orders into stable chunks", () => {
  const orders = Array.from({ length: 205 }, (_, index) =>
    createMerchantOrder({
      siteId: "10000000",
      siteName: "fafona",
      blockId: "product-block",
      customer: { name: "Felix" },
      items: [
        {
          productId: `product-${index + 1}`,
          name: `Product ${index + 1}`,
          quantity: 1,
          unitPriceText: "1",
        },
      ],
    }),
  );

  const chunks = chunkMerchantOrderRecords(orders);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0]?.length, 100);
  assert.equal(chunks[1]?.length, 100);
  assert.equal(chunks[2]?.length, 5);
});

test("mergeStoredMerchantOrdersRows prefers chunked rows over legacy row", () => {
  const first = createMerchantOrder({
    siteId: "10000000",
    siteName: "fafona",
    blockId: "product-block",
    customer: { name: "Felix" },
    items: [{ productId: "a", name: "A", quantity: 1, unitPriceText: "1" }],
  });
  const second = createMerchantOrder({
    siteId: "10000000",
    siteName: "fafona",
    blockId: "product-block",
    customer: { name: "Felix" },
    items: [{ productId: "b", name: "B", quantity: 1, unitPriceText: "2" }],
  });

  const merged = mergeStoredMerchantOrdersRows("10000000", [
    {
      slug: "__merchant_orders__:10000000",
      blocks: [first],
      updated_at: "2026-04-18T09:00:00.000Z",
    },
    {
      slug: "__merchant_orders__:10000000:chunk:0",
      blocks: [second],
      updated_at: "2026-04-18T10:00:00.000Z",
    },
  ]);

  assert.ok(merged);
  assert.equal(merged?.orders.length, 1);
  assert.equal(merged?.orders[0]?.id, second.id);
  assert.equal(merged?.updatedAt, "2026-04-18T10:00:00.000Z");
});
