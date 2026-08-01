import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import { buildMerchantOrderShadowMutation } from "@/lib/merchantOrderDualWrite.server";
import {
  MerchantOrderV1ReadCircuitBreaker,
  type MerchantOrderV1ReadCircuitBreakerConfig,
} from "@/lib/merchantOrderV1ReadCircuitBreaker";
import type {
  MerchantOrdersStoreClient,
  StoredMerchantOrders,
  StoredMerchantOrdersWindow,
} from "@/lib/merchantOrdersStore";
import {
  isMerchantOrderV1ReadEnabled,
  loadMerchantOrderV1,
  readMerchantOrdersWithV1Fallback,
  resolveMerchantOrderV1ReadConfig,
  type MerchantOrderV1ReadEvent,
} from "@/lib/merchantOrdersV1Read.server";

function createOrder(overrides: Partial<MerchantOrderRecord> = {}): MerchantOrderRecord {
  return {
    id: "O10000000202607250001",
    siteId: "10000000",
    siteName: "Faolla",
    blockId: "products",
    clientRequestId: "request-1",
    customerAccountId: "10000000000001",
    customerUserId: "user-1",
    customerLoginEmail: "member@example.com",
    customerGuestHash: "",
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:05:00.000Z",
    merchantTouchedAt: "",
    status: "pending",
    customer: {
      name: "Nana",
      phone: "600000000",
      email: "member@example.com",
      note: "",
    },
    items: [
      {
        productId: "product-1",
        code: "SKU-001",
        name: "Product",
        description: "",
        imageUrl: "",
        tag: "",
        quantity: 1,
        unitPrice: 10,
        unitPriceText: "EUR 10.00",
        subtotal: 10,
      },
    ],
    totalQuantity: 1,
    totalAmount: 10,
    pricePrefix: "EUR",
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
    ...overrides,
  };
}

function createStoredOrder(
  order = createOrder(),
  overrides: Partial<StoredMerchantOrders> = {},
): StoredMerchantOrders {
  return {
    siteId: order.siteId,
    orders: [order],
    updatedAt: "2026-07-25T10:06:00.000Z",
    ...overrides,
  };
}

function createExactV1ReadClient(input: {
  orderRows: unknown[];
  itemRows?: unknown[];
}) {
  const calls: Array<{
    table: string;
    filters: Array<[string, unknown]>;
    orderColumns: string[];
    limit: number | null;
  }> = [];
  const client: MerchantOrdersStoreClient = {
    from: (table: string) => {
      const call = {
        table,
        filters: [] as Array<[string, unknown]>,
        orderColumns: [] as string[],
        limit: null as number | null,
      };
      calls.push(call);
      const result = {
        data:
          table === "merchant_orders"
            ? input.orderRows
            : table === "merchant_order_items"
              ? (input.itemRows ?? [])
              : [],
        error: null,
      };
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return query;
        },
        order: (column: string) => {
          call.orderColumns.push(column);
          return query;
        },
        limit: (value: number) => {
          call.limit = value;
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

test("read config is default-off and only accepts exact merchant ids", () => {
  const config = resolveMerchantOrderV1ReadConfig({
    MERCHANT_ORDER_V1_READ_MODE: "primary",
    MERCHANT_ORDER_V1_READ_SITE_IDS: "10000000, *, abc, 20000000,10000000",
    MERCHANT_ORDER_V1_READ_TIMEOUT_MS: "15",
  });

  assert.deepEqual(config, {
    mode: "primary",
    siteIds: ["10000000", "20000000"],
    timeoutMs: 250,
  });
  assert.equal(isMerchantOrderV1ReadEnabled("10000000", config), true);
  assert.equal(isMerchantOrderV1ReadEnabled("30000000", config), false);
  assert.equal(
    resolveMerchantOrderV1ReadConfig({
      MERCHANT_ORDER_V1_READ_MODE: "unexpected",
      MERCHANT_ORDER_V1_READ_SITE_IDS: "10000000",
    }).mode,
    "off",
  );
});

test("single V1 order reads scope both order and item queries to merchant and order ids", async () => {
  const order = createOrder();
  const shadow = buildMerchantOrderShadowMutation({ next: order });
  const itemRows = shadow.items.map((item, index) => ({
    merchant_id: order.siteId,
    order_id: order.id,
    line_number: index + 1,
    ...item,
  }));
  const { client, calls } = createExactV1ReadClient({
    orderRows: [shadow.order],
    itemRows,
  });

  const stored = await loadMerchantOrderV1(client, order.siteId, order.id);

  assert.deepEqual(stored.orders, [order]);
  assert.equal(stored.updatedAt, order.updatedAt);
  assert.deepEqual(
    calls.map((call) => ({
      table: call.table,
      filters: call.filters,
      orderColumns: call.orderColumns,
      limit: call.limit,
    })),
    [
      {
        table: "merchant_orders",
        filters: [
          ["merchant_id", order.siteId],
          ["id", order.id],
        ],
        orderColumns: [],
        limit: 1,
      },
      {
        table: "merchant_order_items",
        filters: [
          ["merchant_id", order.siteId],
          ["order_id", order.id],
        ],
        orderColumns: ["line_number"],
        limit: null,
      },
    ],
  );
});

test("single V1 order reads return an empty envelope without querying items when missing", async () => {
  const { client, calls } = createExactV1ReadClient({ orderRows: [] });

  assert.deepEqual(
    await loadMerchantOrderV1(client, "10000000", "missing-order"),
    {
      siteId: "10000000",
      orders: [],
      updatedAt: null,
    },
  );
  assert.deepEqual(calls.map((call) => call.table), ["merchant_orders"]);
});

test("disabled reads never invoke the V1 loader", async () => {
  const legacy = createStoredOrder();
  let v1Calls = 0;
  const result = await readMerchantOrdersWithV1Fallback({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => {
      v1Calls += 1;
      return createStoredOrder();
    },
    config: {
      mode: "off",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
  });

  assert.equal(result, legacy);
  assert.equal(v1Calls, 0);
});

test("verify mode observes parity but always returns the legacy envelope", async () => {
  const legacy = createStoredOrder();
  const events: MerchantOrderV1ReadEvent[] = [];
  const result = await readMerchantOrdersWithV1Fallback({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => createStoredOrder(structuredClone(legacy.orders[0])),
    config: {
      mode: "verify",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
    logger: (event) => events.push(event),
  });

  assert.equal(result, legacy);
  assert.equal(events[0]?.outcome, "match");
  assert.equal(events[0]?.reason, "parity");
  assert.match(events[0]?.observedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Number.isInteger(events[0]?.durationMs), true);
});

test("primary mode uses V1 order objects only after exact parity", async () => {
  const legacyOrder = createOrder();
  const v1Order = structuredClone(legacyOrder);
  const legacy: StoredMerchantOrdersWindow = {
    ...createStoredOrder(legacyOrder),
    offset: 0,
    limit: 100,
    hasMore: false,
  };
  const v1: StoredMerchantOrdersWindow = {
    ...createStoredOrder(v1Order),
    updatedAt: "2026-07-25T12:00:00.000Z",
    offset: 0,
    limit: 100,
    hasMore: false,
  };

  const result = await readMerchantOrdersWithV1Fallback({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => v1,
    config: {
      mode: "primary",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
    logger: () => undefined,
  });

  assert.notEqual(result, legacy);
  assert.notEqual(result?.orders[0], legacyOrder);
  assert.deepEqual(result?.orders[0], v1Order);
  assert.equal(result?.updatedAt, legacy.updatedAt);
  assert.equal((result as StoredMerchantOrdersWindow).hasMore, false);
});

test("primary mode falls back on content and window metadata mismatches", async () => {
  const legacy: StoredMerchantOrdersWindow = {
    ...createStoredOrder(),
    offset: 0,
    limit: 100,
    hasMore: false,
  };
  const events: MerchantOrderV1ReadEvent[] = [];
  const contentMismatch = await readMerchantOrdersWithV1Fallback({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => ({
      ...legacy,
      orders: [
        createOrder({
          customer: {
            ...legacy.orders[0].customer,
            name: "Different customer",
          },
        }),
      ],
    }),
    config: {
      mode: "primary",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
    logger: (event) => events.push(event),
  });
  const windowMismatch = await readMerchantOrdersWithV1Fallback({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => ({
      ...legacy,
      hasMore: true,
    }),
    config: {
      mode: "primary",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
    logger: (event) => events.push(event),
  });

  assert.equal(contentMismatch, legacy);
  assert.equal(windowMismatch, legacy);
  assert.deepEqual(
    events.map((event) => event.reason),
    ["order_content_mismatch", "window_metadata_mismatch"],
  );
});

test("V1 timeout and query failures both return legacy data", async () => {
  const legacy = createStoredOrder();
  const events: MerchantOrderV1ReadEvent[] = [];
  const timeoutResult = await readMerchantOrdersWithV1Fallback({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: () => new Promise<StoredMerchantOrders | null>(() => undefined),
    config: {
      mode: "primary",
      siteIds: ["10000000"],
      timeoutMs: 1,
    },
    logger: (event) => events.push(event),
  });
  const failedResult = await readMerchantOrdersWithV1Fallback({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => {
      throw new Error("database unavailable");
    },
    config: {
      mode: "primary",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
    logger: (event) => events.push(event),
  });

  assert.equal(timeoutResult, legacy);
  assert.equal(failedResult, legacy);
  assert.deepEqual(
    events.map((event) => event.reason),
    ["v1_timeout", "v1_query_failed"],
  );
});

test("primary circuit opens after clustered failures and skips subsequent V1 reads", async () => {
  const breaker = new MerchantOrderV1ReadCircuitBreaker();
  const circuitBreakerConfig: MerchantOrderV1ReadCircuitBreakerConfig = {
    enabled: true,
    failureThreshold: 2,
    failureWindowMs: 10_000,
    cooldownMs: 30_000,
  };
  const legacy = createStoredOrder();
  const events: MerchantOrderV1ReadEvent[] = [];
  let v1Calls = 0;

  const read = () =>
    readMerchantOrdersWithV1Fallback({
      siteId: "10000000",
      loadLegacy: async () => legacy,
      loadV1: async () => {
        v1Calls += 1;
        return createStoredOrder(
          createOrder({
            customer: {
              ...legacy.orders[0].customer,
              name: `Mismatch ${v1Calls}`,
            },
          }),
        );
      },
      config: {
        mode: "primary" as const,
        siteIds: ["10000000"],
        timeoutMs: 2500,
      },
      circuitBreaker: breaker,
      circuitBreakerConfig,
      logger: (event) => events.push(event),
    });

  assert.equal(await read(), legacy);
  assert.equal(await read(), legacy);
  assert.equal(await read(), legacy);
  assert.equal(v1Calls, 2);
  assert.deepEqual(
    events.map((event) => event.reason),
    ["order_content_mismatch", "order_content_mismatch", "circuit_open"],
  );
});

test("verify mode never consults a primary circuit breaker", async () => {
  const breaker = new MerchantOrderV1ReadCircuitBreaker();
  const circuitBreakerConfig: MerchantOrderV1ReadCircuitBreakerConfig = {
    enabled: true,
    failureThreshold: 2,
    failureWindowMs: 10_000,
    cooldownMs: 30_000,
  };
  const first = breaker.acquire("10000000", circuitBreakerConfig, 1_000);
  breaker.recordFailure("10000000", circuitBreakerConfig, first, 1_000);
  const second = breaker.acquire("10000000", circuitBreakerConfig, 1_001);
  breaker.recordFailure("10000000", circuitBreakerConfig, second, 1_001);

  const legacy = createStoredOrder();
  let v1Calls = 0;
  const result = await readMerchantOrdersWithV1Fallback({
    siteId: "10000000",
    loadLegacy: async () => legacy,
    loadV1: async () => {
      v1Calls += 1;
      return createStoredOrder(structuredClone(legacy.orders[0]));
    },
    config: {
      mode: "verify",
      siteIds: ["10000000"],
      timeoutMs: 2500,
    },
    circuitBreaker: breaker,
    circuitBreakerConfig,
    logger: () => undefined,
  });

  assert.equal(result, legacy);
  assert.equal(v1Calls, 1);
});
