import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantOrder, updateMerchantOrderItems } from "@/lib/merchantOrders";
import {
  chunkMerchantOrderRecords,
  getChangedMerchantOrderChunkIndexes,
  getMerchantOrderChunkIndexesForWindow,
  listStoredMerchantOrdersByCustomer,
  loadStoredMerchantOrders,
  mergeStoredMerchantOrdersRows,
  type MerchantOrdersStoreClient,
} from "@/lib/merchantOrdersStore";

function createReadClient(result: { data: unknown; error: unknown }): MerchantOrdersStoreClient {
  const query = {
    select: () => query,
    eq: () => query,
    like: () => query,
    in: () => query,
    range: () => query,
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return { from: () => query };
}

test("chunkMerchantOrderRecords splits orders into stable chunks", () => {
  const orders = Array.from({ length: 205 }, (_, index) =>
    createMerchantOrder(
      {
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
      },
      {
        createdAt: new Date(Date.UTC(2026, 6, 24, 10, 0, 0) - index * 1000),
      },
    ),
  );

  const chunks = chunkMerchantOrderRecords(orders);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0]?.length, 100);
  assert.equal(chunks[1]?.length, 100);
  assert.equal(chunks[2]?.length, 5);
});

test("getMerchantOrderChunkIndexesForWindow returns only chunks needed by the requested window", () => {
  assert.deepEqual(getMerchantOrderChunkIndexesForWindow(5, 0, 50), [0]);
  assert.deepEqual(getMerchantOrderChunkIndexesForWindow(5, 90, 40), [0, 1]);
  assert.deepEqual(getMerchantOrderChunkIndexesForWindow(5, 250, 120), [2, 3]);
  assert.deepEqual(getMerchantOrderChunkIndexesForWindow(2, 250, 50), []);
});

test("getChangedMerchantOrderChunkIndexes isolates an in-place order edit to one chunk", () => {
  const orders = Array.from({ length: 205 }, (_, index) =>
    createMerchantOrder(
      {
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
      },
      {
        createdAt: new Date(Date.UTC(2026, 6, 24, 10, 0, 0) - index * 1000),
      },
    ),
  );
  const nextOrders = [...orders];
  const target = orders[150];
  assert.ok(target);
  nextOrders[150] = updateMerchantOrderItems(
    target,
    target.items.map((item) => ({ ...item, quantity: 2 })),
    "2026-07-24T10:00:00.000Z",
  );

  assert.deepEqual(getChangedMerchantOrderChunkIndexes(orders, nextOrders), [1]);
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

test("order store propagates unexpected read failures instead of reporting empty data", async () => {
  const client = createReadClient({ data: null, error: { message: "upstream timeout" } });
  await assert.rejects(() => loadStoredMerchantOrders(client, "10000000"), /merchant_orders_read_failed:upstream timeout/);
  await assert.rejects(
    () => listStoredMerchantOrdersByCustomer(client, { accountId: "account-1" }),
    /merchant_orders_read_failed:upstream timeout/,
  );
});

test("order store still treats a known legacy schema without slug as empty", async () => {
  const client = createReadClient({ data: null, error: { message: "column pages.slug does not exist" } });
  assert.equal(await loadStoredMerchantOrders(client, "10000000"), null);
});
