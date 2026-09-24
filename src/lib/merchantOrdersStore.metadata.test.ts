import assert from "node:assert/strict";
import test from "node:test";
import { createMerchantOrder } from "@/lib/merchantOrders";
import {
  loadStoredMerchantOrder,
  loadStoredMerchantOrdersWindow,
  type MerchantOrdersStoreClient,
} from "@/lib/merchantOrdersStore";

const SITE_ID = "10000000";
const PREFIX = `__merchant_orders__:${SITE_ID}`;

type Row = {
  id: string;
  merchant_id: string;
  slug: string;
  blocks: unknown[];
  updated_at: string;
};
type QueryCall = {
  fields: string;
  filters: Array<[string, string, unknown]>;
  orders: Array<[string, boolean]>;
  range: [number, number] | null;
};
type QueryResult = { data: unknown; error: unknown };

function createOrder(index: number) {
  return createMerchantOrder({
    siteId: SITE_ID,
    siteName: "Synthetic metadata test",
    blockId: "product-block",
    customer: { name: "Synthetic customer" },
    items: [{ productId: `product-${index}`, name: "Product", quantity: 1, unitPriceText: "1" }],
  }, {
    id: `order-${index}`,
    createdAt: new Date(Date.UTC(2026, 8, 25) - index * 1000),
  });
}

function createRow(index: number, orderCount = 0): Row {
  return {
    id: `page-${String(index).padStart(5, "0")}`,
    merchant_id: SITE_ID,
    slug: `${PREFIX}:chunk:${index}`,
    blocks: Array.from({ length: orderCount }, (_, offset) => createOrder(index * 100 + offset)),
    updated_at: "2026-09-25T00:00:00.000Z",
  };
}

function isMetadata(call: QueryCall) {
  return !call.fields.split(",").includes("blocks");
}

function createClient(rows: Row[], options: {
  serverCap?: number;
  override?: (call: QueryCall, index: number) => QueryResult | undefined;
  missingPagination?: "order" | "range";
} = {}) {
  const calls: QueryCall[] = [];
  const client: MerchantOrdersStoreClient = {
    from: (table) => {
      assert.equal(table, "pages");
      const call: QueryCall = { fields: "", filters: [], orders: [], range: null };
      const callIndex = calls.push(call) - 1;
      const resolveQuery = (): QueryResult => {
        const overridden = options.override?.(call, callIndex);
        if (overridden) return overridden;
        let selectedRows = rows.filter((row) => call.filters.every(([kind, column, value]) => {
          const actual = row[column as keyof Row];
          if (kind === "eq") return actual === value;
          if (kind === "like") return String(actual).startsWith(String(value).replace(/%$/, ""));
          if (kind === "in") return (value as string[]).includes(String(actual));
          if (kind === "contains") {
            const expected = JSON.parse(String(value)) as Array<{ id: string }>;
            return row.blocks.some((block) => expected.some(({ id }) => (block as { id?: string }).id === id));
          }
          assert.fail(`Unexpected filter: ${kind}`);
        }));
        selectedRows = [...selectedRows].sort((left, right) => {
          for (const [column, ascending] of call.orders) {
            const a = String(left[column as keyof Row]);
            const b = String(right[column as keyof Row]);
            const compared = a < b ? -1 : a > b ? 1 : 0;
            if (compared) return ascending ? compared : -compared;
          }
          return 0;
        });
        const offset = call.range?.[0] ?? 0;
        const requested = call.range ? call.range[1] - offset + 1 : selectedRows.length;
        const cap = Math.min(requested, options.serverCap ?? 1000);
        const data = selectedRows.slice(offset, offset + cap).map((row) =>
          Object.fromEntries(call.fields.split(",").map((field) => [field, row[field as keyof Row]])));
        return { data, error: null };
      };
      const query = {
        select: (fields: string) => { call.fields = fields; return query; },
        eq: (column: string, value: unknown) => { call.filters.push(["eq", column, value]); return query; },
        like: (column: string, value: unknown) => { call.filters.push(["like", column, value]); return query; },
        in: (column: string, value: unknown) => { call.filters.push(["in", column, value]); return query; },
        contains: (column: string, value: unknown) => { call.filters.push(["contains", column, value]); return query; },
        order: (column: string, input: { ascending: boolean }) => {
          call.orders.push([column, input.ascending]);
          return query;
        },
        range: (from: number, to: number) => { call.range = [from, to]; return query; },
        then: (resolve: (result: QueryResult) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve().then(resolveQuery).then(resolve, reject),
      };
      if (options.missingPagination && isMetadata(call)) {
        // select() has not run yet, and this fixture only targets metadata-first windows.
        Object.assign(query, { [options.missingPagination]: undefined });
      }
      return query;
    },
    rpc: () => assert.fail("metadata/window reads must not write or call transaction RPCs"),
  };
  return { client, calls };
}

test("server-capped partial metadata batches do not prematurely clear window hasMore", async () => {
  const rows = [createRow(0, 100), createRow(1, 100), createRow(2, 3)];
  const { client, calls } = createClient(rows, { serverCap: 2 });

  const stored = await loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 100, limit: 100 });
  assert.equal(stored?.orders.length, 100);
  assert.equal(stored?.orders[0]?.id, "order-100");
  assert.equal(stored?.orders.at(-1)?.id, "order-199");
  assert.equal(stored?.hasMore, true);
  assert.deepEqual(calls.filter(isMetadata).map((call) => call.range), [[0, 999], [2, 1001], [3, 1002]]);
  assert.deepEqual(calls.filter((call) => !isMetadata(call)).map((call) => call.range), [[0, 999], [1, 1000]]);
  assert.deepEqual(calls.at(-1)?.filters, [
    ["in", "slug", [`${PREFIX}:chunk:1`]],
    ["eq", "merchant_id", SITE_ID],
  ]);
  for (const call of calls.filter(isMetadata)) {
    assert.equal(call.fields, "id,slug,updated_at");
    assert.deepEqual(call.orders, [["slug", true], ["id", true]]);
    assert.deepEqual(call.filters, [["like", "slug", `${PREFIX}%`], ["eq", "merchant_id", SITE_ID]]);
  }
});

test("complete metadata keeps within-chunk, cross-chunk and terminal hasMore exact", async () => {
  const rows = [createRow(0, 100), createRow(1, 100), createRow(2, 3)];
  for (const [offset, limit, expectedIds, hasMore] of [
    [90, 40, Array.from({ length: 40 }, (_, index) => `order-${90 + index}`), true],
    [200, 2, ["order-200", "order-201"], true],
    [202, 2, ["order-202"], false],
    [300, 20, [], false],
  ] as const) {
    const { client } = createClient(rows, { serverCap: 2 });
    const stored = await loadStoredMerchantOrdersWindow(client, SITE_ID, { offset, limit });
    assert.deepEqual(stored?.orders.map((order) => order.id), expectedIds);
    assert.equal(stored?.hasMore, hasMore);
  }
});

test("more than one default PostgREST page is exhausted even with a smaller server cap", async () => {
  const rows = Array.from({ length: 1003 }, (_, index) => createRow(index, index === 1002 ? 3 : 0));
  const { client, calls } = createClient(rows.reverse(), { serverCap: 137 });
  const stored = await loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 100_200, limit: 100 });
  assert.deepEqual(stored?.orders.map((order) => order.id), ["order-100200", "order-100201", "order-100202"]);
  assert.equal(stored?.hasMore, false);
  assert.deepEqual(calls.filter(isMetadata).map((call) => call.range?.[0]), [0, 137, 274, 411, 548, 685, 822, 959, 1003]);
  for (const call of calls.filter((call) => !isMetadata(call))) {
    assert.deepEqual(call.filters[0], ["in", "slug", [`${PREFIX}:chunk:1002`]]);
  }
  assert.deepEqual(calls.filter((call) => !isMetadata(call)).map((call) => call.range?.[0]), [0, 1]);
});

test("a one-row server cap exhausts selected chunks and preserves hasMore through the last chunk", async () => {
  const rows = [createRow(0, 100), createRow(1, 100)];
  for (const [limit, count, hasMore] of [[20, 20, true], [110, 110, false], [200, 110, false]] as const) {
    const { client, calls } = createClient(rows, { serverCap: 1 });
    const stored = await loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 90, limit });
    assert.equal(stored?.orders.length, count);
    assert.deepEqual(stored?.orders.map((order) => order.id), Array.from({ length: count }, (_, i) => `order-${90 + i}`));
    assert.equal(stored?.hasMore, hasMore);
    const bodyCalls = calls.filter((call) => !isMetadata(call));
    assert.deepEqual(bodyCalls.map((call) => call.range?.[0]), [0, 1, 2]);
    for (const call of bodyCalls) {
      assert.equal(call.fields, "id,slug,blocks,updated_at");
      assert.deepEqual(call.orders, [["slug", true], ["id", true]]);
      assert.deepEqual(call.filters, [
        ["in", "slug", [`${PREFIX}:chunk:0`, `${PREFIX}:chunk:1`]],
        ["eq", "merchant_id", SITE_ID],
      ]);
    }
  }
});

test("a selected chunk disappearing after metadata fails instead of returning a short final page", async () => {
  const { client, calls } = createClient([createRow(0, 100), createRow(1, 100)], {
    serverCap: 1,
    override: (call) => !isMetadata(call) && call.range?.[0] === 1 ? { data: [], error: null } : undefined,
  });
  await assert.rejects(
    loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 90, limit: 20 }),
    /merchant_orders_read_failed:chunk_missing/,
  );
  assert.deepEqual(calls.filter((call) => !isMetadata(call)).map((call) => call.range?.[0]), [0, 1]);
});

test("selected chunk schema fallbacks also discard partial bodies and restart at offset zero", async () => {
  for (const firstMissing of ["merchant_id", "updated_at"] as const) {
    const secondMissing = firstMissing === "merchant_id" ? "updated_at" : "merchant_id";
    const { client, calls } = createClient([createRow(0, 100), createRow(1, 100)], {
      serverCap: 1,
      override: (call) => {
        if (isMetadata(call) || call.range?.[0] !== 1) return undefined;
        const uses = (column: string) => column === "merchant_id"
          ? call.filters.some(([, field]) => field === column)
          : call.fields.split(",").includes(column);
        const missing = uses(firstMissing) ? firstMissing : uses(secondMissing) ? secondMissing : null;
        return missing ? { data: null, error: { message: `column pages.${missing} does not exist` } } : undefined;
      },
    });
    const stored = await loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 90, limit: 20 });
    assert.deepEqual(stored?.orders.map((order) => order.id), Array.from({ length: 20 }, (_, i) => `order-${90 + i}`));
    assert.equal(stored?.hasMore, true);
    const bodyCalls = calls.filter((call) => !isMetadata(call));
    assert.deepEqual(bodyCalls.map((call) => call.range?.[0]), [0, 1, 0, 1, 0, 1, 2]);
    assert.equal(bodyCalls.at(-1)?.fields, "id,slug,blocks");
    assert.deepEqual(bodyCalls.at(-1)?.filters, [["in", "slug", [`${PREFIX}:chunk:0`, `${PREFIX}:chunk:1`]]]);
  }
});

test("later selected-chunk failures and repeated pages never become a partial window", async () => {
  const rows = [createRow(0, 100), createRow(1, 100)];
  for (const kind of ["query_error", "duplicate"] as const) {
    const { client } = createClient(rows, {
      serverCap: 1,
      override: (call) => {
        if (isMetadata(call) || call.range?.[0] !== 1) return undefined;
        return kind === "query_error"
          ? { data: null, error: { message: "synthetic chunk transport failure" } }
          : { data: [rows[0]], error: null };
      },
    });
    await assert.rejects(
      loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 90, limit: 20 }),
      kind === "query_error"
        ? /merchant_orders_read_failed:synthetic chunk transport failure/
        : /merchant_orders_read_failed:pagination_unstable/,
    );
  }
});

test("a chunk hidden after a capped legacy row prevents stale exact-order resurrection", async () => {
  const legacyOrder = createOrder(99);
  const rows = [
    { ...createRow(0), slug: PREFIX, blocks: [legacyOrder] },
    createRow(1, 1),
  ];
  const { client, calls } = createClient(rows, { serverCap: 1 });
  const stored = await loadStoredMerchantOrder(client, SITE_ID, legacyOrder.id);
  assert.deepEqual(stored, { siteId: SITE_ID, orders: [], updatedAt: null });
  assert.deepEqual(calls.filter(isMetadata).map((call) => call.range?.[0]), [0, 1, 2]);
});

test("exactly 10000 metadata rows terminate safely after a one-row empty overflow probe", async () => {
  const { client, calls } = createClient(Array.from({ length: 10_000 }, (_, index) => createRow(index)));
  const stored = await loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 1_000_000, limit: 1 });
  assert.deepEqual(stored?.orders, []);
  assert.equal(stored?.hasMore, false);
  assert.equal(calls.length, 11);
  assert.deepEqual(calls.at(-1)?.range, [10_000, 10_000]);
  assert.ok(calls.every(isMetadata));
});

test("metadata above the full reader's 10000-row safety limit fails instead of truncating", async () => {
  const { client, calls } = createClient(Array.from({ length: 10_001 }, (_, index) => createRow(index)));
  await assert.rejects(
    loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 0, limit: 100 }),
    /merchant_orders_read_failed:row_limit_exceeded/,
  );
  assert.equal(calls.length, 11);
  assert.deepEqual(calls.at(-1)?.range, [10_000, 10_000]);
  assert.ok(calls.every(isMetadata));
});

test("duplicate pages fail closed rather than loop or return a partial window", async () => {
  const row = createRow(0);
  const { client, calls } = createClient([row], { override: () => ({ data: [row], error: null }) });
  await assert.rejects(
    loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 0, limit: 100 }),
    /merchant_orders_read_failed:pagination_unstable/,
  );
  assert.deepEqual(calls.map((call) => call.range?.[0]), [0, 1]);
});

test("metadata schema fallbacks discard partial rows and restart from offset zero", async () => {
  const rows = [createRow(0, 1), createRow(1)];
  for (const firstMissing of ["merchant_id", "updated_at"] as const) {
    const secondMissing = firstMissing === "merchant_id" ? "updated_at" : "merchant_id";
    const { client, calls } = createClient(rows, {
      serverCap: 1,
      override: (call) => {
        if (!isMetadata(call) || call.range?.[0] !== 1) return undefined;
        const uses = (column: string) => column === "merchant_id"
          ? call.filters.some(([, field]) => field === column)
          : call.fields.split(",").includes(column);
        const missing = uses(firstMissing) ? firstMissing : uses(secondMissing) ? secondMissing : null;
        return missing ? { data: null, error: { message: `column pages.${missing} does not exist` } } : undefined;
      },
    });
    const stored = await loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 0, limit: 1 });
    assert.equal(stored?.orders[0]?.id, "order-0");
    assert.equal(stored?.hasMore, true);
    const metadataCalls = calls.filter(isMetadata);
    assert.deepEqual(metadataCalls.map((call) => call.range?.[0]), [0, 1, 0, 1, 0, 1, 2]);
    assert.equal(metadataCalls.at(-1)?.fields, "id,slug");
    assert.deepEqual(metadataCalls.at(-1)?.filters, [["like", "slug", `${PREFIX}%`]]);
  }
});

test("late metadata errors do not return a successful partial result", async () => {
  const failure = { message: "synthetic transport failure" };
  const { client, calls } = createClient([createRow(0), createRow(1)], {
    serverCap: 1,
    override: (call) => call.range?.[0] === 1 ? { data: null, error: failure } : undefined,
  });
  await assert.rejects(
    loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 0, limit: 1 }),
    /merchant_orders_read_failed:synthetic transport failure/,
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every(isMetadata));
});

test("invalid metadata response or pagination support fails closed", async () => {
  for (const data of [null, undefined, {}, "invalid"]) {
    const { client } = createClient([], { override: () => ({ data, error: null }) });
    await assert.rejects(
      loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 0, limit: 1 }),
      /merchant_orders_read_failed:invalid_response/,
    );
  }
  for (const missingPagination of ["order", "range"] as const) {
    const { client } = createClient([], { missingPagination });
    await assert.rejects(
      loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 0, limit: 1 }),
      /merchant_orders_read_failed:pagination_unsupported/,
    );
  }
  const { client } = createClient([], {
    override: () => ({ data: Array.from({ length: 1001 }, (_, index) => createRow(index)), error: null }),
  });
  await assert.rejects(
    loadStoredMerchantOrdersWindow(client, SITE_ID, { offset: 0, limit: 1 }),
    /merchant_orders_read_failed:pagination_unsupported/,
  );
});
