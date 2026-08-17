import test from "node:test";
import assert from "node:assert/strict";
import {
  MERCHANT_ORDER_WORKBENCH_DAILY_TREND_DAYS,
  MERCHANT_ORDER_WORKBENCH_DEFAULT_CONFIRMATION_OVERDUE_MINUTES,
  MERCHANT_ORDER_WORKBENCH_DEFAULT_PROCESSING_OVERDUE_MINUTES,
  MERCHANT_ORDER_WORKBENCH_TOP_PRODUCT_LIMIT,
  buildMerchantOrderWorkbenchDashboard,
  normalizeMerchantOrderWorkbenchTimezoneOffsetMinutes,
} from "@/lib/merchantOrderWorkbench";
import type { MerchantOrderLineItem, MerchantOrderRecord } from "@/lib/merchantOrders";

function createOrder(
  overrides: Omit<Partial<MerchantOrderRecord>, "customer"> & {
    customer?: Partial<MerchantOrderRecord["customer"]>;
  } = {},
): MerchantOrderRecord {
  const { customer, ...recordOverrides } = overrides;
  return {
    id: "order-1",
    siteId: "10000000",
    siteName: "Faolla",
    blockId: "products",
    createdAt: "2026-08-17T11:50:00.000Z",
    updatedAt: "2026-08-17T11:50:00.000Z",
    status: "pending",
    items: [],
    totalQuantity: 1,
    totalAmount: 10,
    pricePrefix: "€",
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
    ...recordOverrides,
    customer: {
      name: "Ada",
      phone: "",
      email: "",
      note: "",
      ...customer,
    },
  };
}

function createItem(
  productId: string,
  quantity: number,
  name = productId,
): MerchantOrderLineItem {
  return {
    productId,
    code: "",
    name,
    description: "",
    imageUrl: "",
    tag: "",
    quantity,
    unitPrice: 1,
    unitPriceText: "1.00",
    subtotal: quantity,
  };
}

test("workbench uses the default 15-minute confirmation and 120-minute processing SLAs", () => {
  const dashboard = buildMerchantOrderWorkbenchDashboard([], {
    now: "2026-08-17T12:00:00.000Z",
  });

  assert.deepEqual(dashboard.thresholds, {
    confirmationOverdueMinutes: MERCHANT_ORDER_WORKBENCH_DEFAULT_CONFIRMATION_OVERDUE_MINUTES,
    processingOverdueMinutes: MERCHANT_ORDER_WORKBENCH_DEFAULT_PROCESSING_OVERDUE_MINUTES,
  });
  assert.equal(dashboard.generatedAt, "2026-08-17T12:00:00.000Z");
  assert.equal(dashboard.timezoneOffsetMinutes, 0);
});

test("workbench builds operational counts, all required todo kinds, and separated monetary groups", () => {
  const orders = [
    createOrder({
      id: "pending-overdue",
      createdAt: "2026-08-17T11:40:00.000Z",
      customer: { name: "Pending", note: "  Please call first.  " },
      totalAmount: 10.125,
      pricePrefix: " € ",
    }),
    createOrder({
      id: "processing-overdue",
      status: "confirmed",
      createdAt: "2026-08-17T08:00:00.000Z",
      confirmedAt: "2026-08-17T09:00:00.000Z",
      totalAmount: 20,
      pricePrefix: "€",
    }),
    createOrder({
      id: "completed-today-eur",
      status: "completed",
      createdAt: "2026-08-16T08:00:00.000Z",
      confirmedAt: "2026-08-16T08:10:00.000Z",
      completedAt: "2026-08-17T10:00:00.000Z",
      totalAmount: 30,
      pricePrefix: "€",
    }),
    createOrder({
      id: "completed-today-usd",
      status: "completed",
      createdAt: "2026-08-16T08:00:00.000Z",
      confirmedAt: "2026-08-16T08:10:00.000Z",
      completedAt: "2026-08-17T11:00:00.000Z",
      totalAmount: 40,
      pricePrefix: "$",
    }),
    createOrder({
      id: "cancelled-today",
      status: "cancelled",
      cancelledAt: "2026-08-17T11:30:00.000Z",
      customer: { note: "Historical note must not become a todo" },
      totalAmount: 999,
      pricePrefix: "€",
    }),
  ];

  const dashboard = buildMerchantOrderWorkbenchDashboard(orders, {
    now: "2026-08-17T12:00:00.000Z",
  });

  assert.deepEqual(dashboard.summary, {
    total: 5,
    pending: 1,
    confirmationOverdue: 1,
    processing: 1,
    processingOverdue: 1,
    completedToday: 2,
    cancelledToday: 1,
    customerNote: 1,
  });
  assert.deepEqual(dashboard.amounts, [
    {
      pricePrefix: "$",
      totalAmount: 40,
      orderCount: 1,
      completedTodayAmount: 40,
      completedTodayCount: 1,
    },
    {
      pricePrefix: "€",
      totalAmount: 60.13,
      orderCount: 3,
      completedTodayAmount: 30,
      completedTodayCount: 1,
    },
  ]);
  assert.deepEqual(
    dashboard.todos
      .filter((todo) => todo.kind === "confirmation_overdue" || todo.kind === "processing_overdue" || todo.kind === "customer_note")
      .map((todo) => [todo.kind, todo.orderId, todo.ageMinutes]),
    [
      ["processing_overdue", "processing-overdue", 180],
      ["confirmation_overdue", "pending-overdue", 20],
      ["customer_note", "pending-overdue", 20],
    ],
  );
  assert.equal(dashboard.todos[2]?.note, "Please call first.");
  assert.deepEqual(
    dashboard.todos
      .filter((todo) => todo.kind === "pending_confirmation" || todo.kind === "processing")
      .map((todo) => [todo.kind, todo.orderId]),
    [
      ["processing", "processing-overdue"],
      ["pending_confirmation", "pending-overdue"],
    ],
  );
});

test("SLA boundaries are inclusive and invalid or future timestamps do not create false overdue todos", () => {
  const dashboard = buildMerchantOrderWorkbenchDashboard(
    [
      createOrder({ id: "pending-at-boundary", createdAt: "2026-08-17T11:45:00.000Z" }),
      createOrder({ id: "pending-under-boundary", createdAt: "2026-08-17T11:45:01.000Z" }),
      createOrder({ id: "pending-future", createdAt: "2026-08-17T12:30:00.000Z" }),
      createOrder({ id: "pending-invalid", createdAt: "not-a-date" }),
      createOrder({
        id: "processing-at-boundary",
        status: "confirmed",
        confirmedAt: "2026-08-17T10:00:00.000Z",
      }),
      createOrder({
        id: "processing-under-boundary",
        status: "confirmed",
        confirmedAt: "2026-08-17T10:00:01.000Z",
      }),
      createOrder({ id: "processing-missing-start", status: "confirmed", confirmedAt: null }),
    ],
    { now: "2026-08-17T12:00:00.000Z" },
  );

  assert.equal(dashboard.summary.pending, 4);
  assert.equal(dashboard.summary.processing, 3);
  assert.equal(dashboard.summary.confirmationOverdue, 1);
  assert.equal(dashboard.summary.processingOverdue, 1);
  assert.deepEqual(
    dashboard.todos
      .filter((todo) => todo.kind === "confirmation_overdue" || todo.kind === "processing_overdue")
      .map((todo) => todo.orderId)
      .sort(),
    ["pending-at-boundary", "processing-at-boundary"],
  );
});

test("today uses the explicit fixed UTC offset rather than the process local timezone", () => {
  const orders = [
    createOrder({
      id: "completed-after-local-midnight",
      status: "completed",
      completedAt: "2026-08-16T22:30:00.000Z",
    }),
    createOrder({
      id: "cancelled-after-next-local-midnight",
      status: "cancelled",
      cancelledAt: "2026-08-17T22:30:00.000Z",
    }),
  ];

  const utcDashboard = buildMerchantOrderWorkbenchDashboard(orders, {
    now: "2026-08-17T00:30:00.000Z",
    timezoneOffsetMinutes: 0,
  });
  const utcPlusTwoDashboard = buildMerchantOrderWorkbenchDashboard(orders, {
    now: "2026-08-17T00:30:00.000Z",
    timezoneOffsetMinutes: 120,
  });

  assert.equal(utcDashboard.summary.completedToday, 0);
  assert.equal(utcDashboard.summary.cancelledToday, 1);
  assert.equal(utcPlusTwoDashboard.summary.completedToday, 1);
  assert.equal(utcPlusTwoDashboard.summary.cancelledToday, 0);
  assert.equal(utcPlusTwoDashboard.amounts[0]?.completedTodayAmount, 10);
});

test("todo urgency sorts overdue work by lateness, then customer notes from oldest order first", () => {
  const dashboard = buildMerchantOrderWorkbenchDashboard(
    [
      createOrder({
        id: "new-note",
        createdAt: "2026-08-17T11:50:00.000Z",
        customer: { note: "new" },
      }),
      createOrder({
        id: "old-note",
        createdAt: "2026-08-17T11:30:00.000Z",
        status: "confirmed",
        confirmedAt: "2026-08-17T11:50:00.000Z",
        customer: { note: "old" },
      }),
      createOrder({ id: "slightly-overdue", createdAt: "2026-08-17T11:44:00.000Z" }),
      createOrder({
        id: "very-overdue",
        status: "confirmed",
        confirmedAt: "2026-08-17T08:00:00.000Z",
      }),
    ],
    { now: "2026-08-17T12:00:00.000Z" },
  );

  assert.deepEqual(
    dashboard.todos
      .filter((todo) => todo.kind === "confirmation_overdue" || todo.kind === "processing_overdue" || todo.kind === "customer_note")
      .map((todo) => `${todo.kind}:${todo.orderId}`),
    [
      "processing_overdue:very-overdue",
      "confirmation_overdue:slightly-overdue",
      "customer_note:old-note",
      "customer_note:new-note",
    ],
  );
});

test("every active order is actionable even before it reaches an SLA", () => {
  const dashboard = buildMerchantOrderWorkbenchDashboard(
    [
      createOrder({ id: "fresh-pending", createdAt: "2026-08-17T11:55:00.000Z" }),
      createOrder({
        id: "fresh-processing",
        status: "confirmed",
        createdAt: "2026-08-17T11:40:00.000Z",
        confirmedAt: "2026-08-17T11:50:00.000Z",
      }),
    ],
    { now: "2026-08-17T12:00:00.000Z" },
  );

  assert.deepEqual(
    dashboard.todos.map((todo) => [todo.kind, todo.orderId, todo.ageMinutes]),
    [
      ["processing", "fresh-processing", 10],
      ["pending_confirmation", "fresh-pending", 5],
    ],
  );
});

test("offset and custom SLA inputs are normalized to bounded integer values", () => {
  assert.equal(normalizeMerchantOrderWorkbenchTimezoneOffsetMinutes("120.4"), 120);
  assert.equal(normalizeMerchantOrderWorkbenchTimezoneOffsetMinutes(9999), 840);
  assert.equal(normalizeMerchantOrderWorkbenchTimezoneOffsetMinutes(-9999), -840);
  assert.equal(normalizeMerchantOrderWorkbenchTimezoneOffsetMinutes("invalid"), 0);

  const dashboard = buildMerchantOrderWorkbenchDashboard([], {
    now: "2026-08-17T12:00:00.000Z",
    confirmationOverdueMinutes: 0,
    processingOverdueMinutes: 99_999,
  });
  assert.deepEqual(dashboard.thresholds, {
    confirmationOverdueMinutes: 1,
    processingOverdueMinutes: 43_200,
  });
});

test("analytics returns fixed zero-filled trend slots and a complete empty status distribution", () => {
  const dashboard = buildMerchantOrderWorkbenchDashboard([], {
    now: "2026-08-17T00:30:00.000Z",
    timezoneOffsetMinutes: 120,
  });

  assert.equal(dashboard.analytics.dailyTrend.length, MERCHANT_ORDER_WORKBENCH_DAILY_TREND_DAYS);
  assert.equal(dashboard.analytics.dailyTrend[0]?.date, "2026-08-04");
  assert.equal(dashboard.analytics.dailyTrend.at(-1)?.date, "2026-08-17");
  assert.ok(
    dashboard.analytics.dailyTrend.every(
      (entry) => entry.createdCount === 0 && entry.completedCount === 0 && entry.cancelledCount === 0,
    ),
  );
  assert.deepEqual(dashboard.analytics.statusDistribution, {
    pending: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
  });
  assert.deepEqual(dashboard.analytics.recent30Days, {
    createdCount: 0,
    completedCount: 0,
    cancelledCount: 0,
  });
  assert.deepEqual(dashboard.analytics.topProducts, []);
  assert.deepEqual(dashboard.analytics.averageOrderAmounts, []);
});

test("analytics uses fixed-offset calendar boundaries for 14-day trends and 30-day counts", () => {
  const dashboard = buildMerchantOrderWorkbenchDashboard(
    [
      createOrder({ id: "trend-start", createdAt: "2026-08-03T22:00:00.000Z" }),
      createOrder({ id: "before-trend", createdAt: "2026-08-03T21:59:59.999Z" }),
      createOrder({ id: "recent-start", createdAt: "2026-07-18T22:00:00.000Z" }),
      createOrder({ id: "before-recent", createdAt: "2026-07-18T21:59:59.999Z" }),
      createOrder({
        id: "completed-today",
        status: "completed",
        createdAt: "2026-07-01T00:00:00.000Z",
        completedAt: "2026-08-16T22:00:00.000Z",
      }),
      createOrder({
        id: "cancelled-at-trend-start",
        status: "cancelled",
        createdAt: "2026-07-01T00:00:00.000Z",
        cancelledAt: "2026-08-03T22:00:00.000Z",
      }),
      createOrder({
        id: "future-cancellation",
        status: "cancelled",
        createdAt: "2026-07-01T00:00:00.000Z",
        cancelledAt: "2026-08-17T00:31:00.000Z",
      }),
      createOrder({
        id: "invalid-completion",
        status: "completed",
        createdAt: "2026-07-01T00:00:00.000Z",
        completedAt: "invalid",
      }),
    ],
    {
      now: "2026-08-17T00:30:00.000Z",
      timezoneOffsetMinutes: 120,
    },
  );

  assert.deepEqual(dashboard.analytics.recent30Days, {
    createdCount: 3,
    completedCount: 1,
    cancelledCount: 1,
  });
  assert.deepEqual(dashboard.analytics.dailyTrend[0], {
    date: "2026-08-04",
    createdCount: 1,
    completedCount: 0,
    cancelledCount: 1,
  });
  assert.deepEqual(dashboard.analytics.dailyTrend.at(-1), {
    date: "2026-08-17",
    createdCount: 0,
    completedCount: 1,
    cancelledCount: 0,
  });
});

test("analytics excludes cancelled orders from product and average-order aggregates without hiding cancellation activity", () => {
  const dashboard = buildMerchantOrderWorkbenchDashboard(
    [
      createOrder({
        id: "pending-eur",
        status: "pending",
        totalAmount: 10,
        pricePrefix: " EUR ",
        items: [createItem("product-a", 2, "Zulu name")],
      }),
      createOrder({
        id: "completed-eur",
        status: "completed",
        completedAt: "2026-08-17T11:00:00.000Z",
        totalAmount: 20,
        pricePrefix: "EUR",
        items: [createItem("product-a", 3, "Alpha name"), createItem("product-a", 1, "Beta name")],
      }),
      createOrder({
        id: "confirmed-usd",
        status: "confirmed",
        confirmedAt: "2026-08-17T11:30:00.000Z",
        totalAmount: 30,
        pricePrefix: "$",
        items: [createItem("product-b", 4, "Product B")],
      }),
      createOrder({
        id: "cancelled-eur",
        status: "cancelled",
        cancelledAt: "2026-08-17T11:45:00.000Z",
        totalAmount: 999,
        pricePrefix: "EUR",
        items: [createItem("cancelled-product", 100, "Cancelled product")],
      }),
    ],
    { now: "2026-08-17T12:00:00.000Z" },
  );

  assert.deepEqual(dashboard.analytics.statusDistribution, {
    pending: 1,
    confirmed: 1,
    completed: 1,
    cancelled: 1,
  });
  assert.deepEqual(dashboard.analytics.topProducts, [
    { productId: "product-a", name: "Alpha name", orderCount: 2, quantity: 6 },
    { productId: "product-b", name: "Product B", orderCount: 1, quantity: 4 },
  ]);
  assert.deepEqual(dashboard.analytics.averageOrderAmounts, [
    { pricePrefix: "$", orderCount: 1, averageOrderAmount: 30 },
    { pricePrefix: "EUR", orderCount: 2, averageOrderAmount: 15 },
  ]);
  assert.equal(dashboard.analytics.recent30Days.createdCount, 4);
  assert.equal(dashboard.analytics.recent30Days.cancelledCount, 1);
});

test("top-product ranking has a deterministic tie-break and applies the Top 8 limit", () => {
  const productIds = ["product-09", "product-03", "product-10", "product-01", "product-08", "product-06", "product-02", "product-07", "product-05", "product-04"];
  const orders = productIds.map((productId, index) =>
    createOrder({
      id: `rank-${index}`,
      items: [createItem(productId, 5, `Name ${productId}`)],
    }),
  );

  const first = buildMerchantOrderWorkbenchDashboard(orders, {
    now: "2026-08-17T12:00:00.000Z",
  });
  const reversed = buildMerchantOrderWorkbenchDashboard([...orders].reverse(), {
    now: "2026-08-17T12:00:00.000Z",
  });

  assert.equal(first.analytics.topProducts.length, MERCHANT_ORDER_WORKBENCH_TOP_PRODUCT_LIMIT);
  assert.deepEqual(first.analytics.topProducts, reversed.analytics.topProducts);
  assert.deepEqual(
    first.analytics.topProducts.map((product) => product.productId),
    ["product-01", "product-02", "product-03", "product-04", "product-05", "product-06", "product-07", "product-08"],
  );
});
