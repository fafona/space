import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantOrder, updateMerchantOrderItems } from "@/lib/merchantOrders";
import {
  chunkMerchantOrderRecords,
  getChangedMerchantOrderChunkIndexes,
  getMerchantOrderChunkIndexesForWindow,
  listStoredMerchantOrdersByCustomer,
  loadStoredMerchantOrder,
  loadStoredMerchantOrders,
  mergeStoredMerchantOrdersRows,
  type MerchantOrdersStoreClient,
} from "@/lib/merchantOrdersStore";

function createReadClient(result: { data: unknown; error: unknown }): MerchantOrdersStoreClient {
  const query = {
    select: () => query,
    eq: () => query,
    like: () => query,
    contains: () => query,
    in: () => query,
    order: () => query,
    range: () => query,
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return { from: () => query };
}

function createSequencedReadClient(
  results: Array<{ data: unknown; error: unknown }>,
) {
  const calls: Array<{
    selectFields: string;
    filters: Array<[string, string, unknown]>;
    orders: Array<[string, boolean]>;
    ranges: Array<[number, number]>;
  }> = [];
  let resultIndex = 0;
  const client: MerchantOrdersStoreClient = {
    from: () => {
      const call = {
        selectFields: "",
        filters: [] as Array<[string, string, unknown]>,
        orders: [] as Array<[string, boolean]>,
        ranges: [] as Array<[number, number]>,
      };
      calls.push(call);
      const result = results[resultIndex] ?? { data: [], error: null };
      resultIndex += 1;
      const query = {
        select: (fields: string) => {
          call.selectFields = fields;
          return query;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push(["eq", column, value]);
          return query;
        },
        like: (column: string, value: unknown) => {
          call.filters.push(["like", column, value]);
          return query;
        },
        contains: (column: string, value: unknown) => {
          call.filters.push(["contains", column, value]);
          return query;
        },
        order: (column: string, options?: { ascending?: boolean }) => {
          call.orders.push([column, options?.ascending !== false]);
          return query;
        },
        range: (from: number, to: number) => {
          call.ranges.push([from, to]);
          return query;
        },
        then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      };
      return query;
    },
  };
  return { client, calls };
}

function createStoredOrderRow(index: number, includeOrder = false) {
  return {
    id: `page-${String(index).padStart(5, "0")}`,
    slug: `__merchant_orders__:10000000:chunk:${String(index).padStart(5, "0")}`,
    blocks: includeOrder
      ? [
          createMerchantOrder(
            {
              siteId: "10000000",
              siteName: "fafona",
              blockId: "product-block",
              customer: { name: "Felix" },
              items: [{ productId: `product-${index}`, name: `Product ${index}`, quantity: 1, unitPriceText: "1" }],
            },
            { id: `order-${String(index).padStart(5, "0")}` },
          ),
        ]
      : [],
    updated_at: "2026-08-17T10:00:00.000Z",
  };
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

test("personal order reads require all stored canonical ids and ignore matching email", async () => {
  const matching = createMerchantOrder(
    {
      siteId: "10000000",
      customerAccountId: "50010105",
      customerUserId: "user-canonical",
      customerLoginEmail: "shared@example.com",
      customer: { name: "Canonical", email: "shared@example.com" },
      items: [{ productId: "a", name: "A", quantity: 1, unitPriceText: "1" }],
    },
    { id: "order-canonical" },
  );
  const mismatchedUser = createMerchantOrder(
    {
      siteId: "10000000",
      customerAccountId: "50010105",
      customerUserId: "user-other",
      customerLoginEmail: "shared@example.com",
      customer: { name: "Mismatch", email: "shared@example.com" },
      items: [{ productId: "b", name: "B", quantity: 1, unitPriceText: "1" }],
    },
    { id: "order-mismatched-user" },
  );
  const emailOnly = createMerchantOrder(
    {
      siteId: "10000000",
      customerLoginEmail: "shared@example.com",
      customer: { name: "Legacy", email: "shared@example.com" },
      items: [{ productId: "c", name: "C", quantity: 1, unitPriceText: "1" }],
    },
    { id: "order-email-only" },
  );
  const client = createReadClient({
    data: [
      {
        id: "orders-page",
        slug: "__merchant_orders__:10000000:chunk:0",
        blocks: [matching, mismatchedUser, emailOnly],
        updated_at: "2026-08-20T10:00:00.000Z",
      },
    ],
    error: null,
  });

  const orders = await listStoredMerchantOrdersByCustomer(client, {
    accountId: "50010105",
    userId: "user-canonical",
  });
  assert.deepEqual(orders.map((order) => order.id), ["order-canonical"]);
  assert.deepEqual(
    await listStoredMerchantOrdersByCustomer(client, {
      accountId: "50010105",
    }),
    [],
  );
});

test("order store still treats a known legacy schema without slug as empty", async () => {
  const client = createReadClient({ data: null, error: { message: "column pages.slug does not exist" } });
  assert.equal(await loadStoredMerchantOrders(client, "10000000"), null);
});

test("full legacy order reads paginate deterministically past a 500-row server response cap", async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => createStoredOrderRow(index, true));
  const { client, calls } = createSequencedReadClient([
    { data: rows.slice(0, 500), error: null },
    { data: rows.slice(500, 1000), error: null },
    { data: rows.slice(1000), error: null },
    { data: [], error: null },
  ]);

  const stored = await loadStoredMerchantOrders(client, "10000000");

  assert.ok(stored);
  assert.equal(stored.orders.length, 1001);
  assert.equal(new Set(stored.orders.map((order) => order.id)).size, 1001);
  assert.equal(stored.updatedAt, "2026-08-17T10:00:00.000Z");
  assert.deepEqual(calls.map((call) => call.orders), [
    [["slug", true], ["id", true]],
    [["slug", true], ["id", true]],
    [["slug", true], ["id", true]],
    [["slug", true], ["id", true]],
  ]);
  assert.deepEqual(calls.flatMap((call) => call.ranges), [
    [0, 999],
    [500, 1499],
    [1000, 1999],
    [1001, 2000],
  ]);
  assert.ok(calls.every((call) =>
    call.filters.some((filter) =>
      filter[0] === "eq" && filter[1] === "merchant_id" && filter[2] === "10000000"
    )
  ));
});

test("full legacy order reads restart pagination for merchant_id and updated_at schema fallbacks", async () => {
  const row = createStoredOrderRow(0);
  const { client, calls } = createSequencedReadClient([
    { data: null, error: { message: "column pages.merchant_id does not exist" } },
    { data: null, error: { message: "column pages.updated_at does not exist" } },
    { data: [{ id: row.id, slug: row.slug, blocks: row.blocks }], error: null },
    { data: [], error: null },
  ]);

  const stored = await loadStoredMerchantOrders(client, "10000000");

  assert.ok(stored);
  assert.equal(stored.updatedAt, null);
  assert.equal(calls[0]?.selectFields, "id,slug,blocks,updated_at");
  assert.equal(calls[1]?.selectFields, "id,slug,blocks,updated_at");
  assert.equal(calls[2]?.selectFields, "id,slug,blocks");
  assert.deepEqual(calls.map((call) => call.filters.some((filter) => filter[1] === "merchant_id")), [
    true,
    false,
    false,
    false,
  ]);
});

test("full legacy order reads fail closed on a later page query error", async () => {
  const firstPage = Array.from({ length: 1000 }, (_, index) => createStoredOrderRow(index));
  const { client } = createSequencedReadClient([
    { data: firstPage, error: null },
    { data: null, error: { message: "page two timeout" } },
  ]);

  await assert.rejects(
    () => loadStoredMerchantOrders(client, "10000000"),
    /merchant_orders_read_failed:page two timeout/,
  );
});

test("full legacy order reads fail closed when stable pagination is unsupported", async () => {
  const result = { data: [], error: null };
  const query = {
    select: () => query,
    eq: () => query,
    like: () => query,
    then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  const client: MerchantOrdersStoreClient = { from: () => query };

  await assert.rejects(
    () => loadStoredMerchantOrders(client, "10000000"),
    /merchant_orders_read_failed:pagination_unsupported/,
  );
});

test("full legacy order reads prove the hard row limit with one sentinel range", async () => {
  const fullPages = Array.from({ length: 10 }, (_, pageIndex) => ({
    data: Array.from({ length: 1000 }, (_, rowIndex) =>
      createStoredOrderRow(pageIndex * 1000 + rowIndex)),
    error: null,
  }));
  const { client, calls } = createSequencedReadClient([
    ...fullPages,
    { data: [createStoredOrderRow(10_000)], error: null },
  ]);

  await assert.rejects(
    () => loadStoredMerchantOrders(client, "10000000"),
    /merchant_orders_read_failed:row_limit_exceeded/,
  );
  assert.deepEqual(calls.at(-1)?.ranges, [[10_000, 10_000]]);
});

test("exact legacy order reads use serialized tenant-scoped JSON containment and return one order", async () => {
  const orderId = "O10000000202608010001";
  const target = createMerchantOrder(
    {
      siteId: "10000000",
      siteName: "fafona",
      blockId: "product-block",
      customer: { name: "Felix" },
      items: [{ productId: "a", name: "A", quantity: 1, unitPriceText: "1" }],
    },
    { id: orderId },
  );
  const crossTenant = createMerchantOrder(
    {
      siteId: "20000000",
      siteName: "other",
      blockId: "product-block",
      customer: { name: "Other" },
      items: [{ productId: "b", name: "B", quantity: 1, unitPriceText: "2" }],
    },
    { id: orderId },
  );
  const result = {
    data: [
      {
        slug: "__merchant_orders__:10000000:chunk:1",
        blocks: [crossTenant, target],
        updated_at: "2026-08-01T10:00:00.000Z",
      },
    ],
    error: null,
  };
  const { client, calls } = createSequencedReadClient([result, result]);

  const stored = await loadStoredMerchantOrder(client, "10000000", orderId);

  assert.deepEqual(stored.orders, [target]);
  assert.equal(stored.updatedAt, "2026-08-01T10:00:00.000Z");
  assert.deepEqual(calls.map((call) => call.filters), [
    [
      ["like", "slug", "__merchant_orders__:10000000%"],
      ["eq", "merchant_id", "10000000"],
    ],
    [
      ["eq", "merchant_id", "10000000"],
      ["like", "slug", "__merchant_orders__:10000000%"],
      ["contains", "blocks", JSON.stringify([{ id: orderId }])],
    ],
  ]);
});

test("exact legacy order reads do not revive stale legacy rows when chunk storage exists", async () => {
  const orderId = "O10000000202608010002";
  const staleLegacyOrder = createMerchantOrder(
    {
      siteId: "10000000",
      siteName: "fafona",
      blockId: "product-block",
      customer: { name: "Stale" },
      items: [{ productId: "a", name: "A", quantity: 1, unitPriceText: "1" }],
    },
    { id: orderId },
  );
  const currentChunkOrder = createMerchantOrder(
    {
      siteId: "10000000",
      siteName: "fafona",
      blockId: "product-block",
      customer: { name: "Current" },
      items: [{ productId: "b", name: "B", quantity: 1, unitPriceText: "2" }],
    },
    { id: "O10000000202608010003" },
  );
  const fullRows = [
    {
      slug: "__merchant_orders__:10000000",
      blocks: [staleLegacyOrder],
      updated_at: "2026-08-01T10:00:00.000Z",
    },
    {
      slug: "__merchant_orders__:10000000:chunk:0",
      blocks: [currentChunkOrder],
      updated_at: "2026-08-01T11:00:00.000Z",
    },
  ];
  assert.deepEqual(
    mergeStoredMerchantOrdersRows("10000000", fullRows)?.orders,
    [currentChunkOrder],
  );
  const { client } = createSequencedReadClient([
    {
      data: fullRows.map(({ slug }) => ({ slug })),
      error: null,
    },
    {
      data: [fullRows[0]],
      error: null,
    },
  ]);

  assert.deepEqual(await loadStoredMerchantOrder(client, "10000000", orderId), {
    siteId: "10000000",
    orders: [],
    updatedAt: null,
  });
});

test("exact legacy order reads return an empty envelope when the order is missing", async () => {
  const client = createReadClient({ data: [], error: null });
  assert.deepEqual(
    await loadStoredMerchantOrder(client, "10000000", "missing-order"),
    {
      siteId: "10000000",
      orders: [],
      updatedAt: null,
    },
  );
});
