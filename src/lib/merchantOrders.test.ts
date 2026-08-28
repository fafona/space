import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMerchantOrderUpdate,
  applyMerchantOrderAction,
  assertMerchantOrderExpectedUpdatedAt,
  buildMerchantOrderId,
  createMerchantOrder,
  formatMerchantOrderAmount,
  isMerchantOrderNewForMerchant,
  isMerchantOrderPendingMerchantTouch,
  merchantOrderTransitionChangesCompletedState,
  normalizeMerchantOrderLineItems,
  normalizeMerchantOrderRecord,
  parseMerchantOrderPriceValue,
  updateMerchantOrderItems,
} from "@/lib/merchantOrders";

test("completed-state transition detection covers entry and exit", () => {
  assert.equal(
    merchantOrderTransitionChangesCompletedState("pending", "confirmed"),
    false,
  );
  assert.equal(
    merchantOrderTransitionChangesCompletedState("confirmed", "completed"),
    true,
  );
  assert.equal(
    merchantOrderTransitionChangesCompletedState("completed", "confirmed"),
    true,
  );
  assert.equal(
    merchantOrderTransitionChangesCompletedState("completed", "completed"),
    false,
  );
});

test("assertMerchantOrderExpectedUpdatedAt accepts the current version and rejects stale versions", () => {
  const record = { updatedAt: "2026-08-17T12:00:00.000Z" };

  assert.doesNotThrow(() =>
    assertMerchantOrderExpectedUpdatedAt(record, "2026-08-17T12:00:00.000Z"),
  );
  assert.throws(
    () => assertMerchantOrderExpectedUpdatedAt(record, "2026-08-17T11:59:59.000Z"),
    (error: unknown) => error instanceof Error && error.message === "order_update_conflict",
  );
});

test("parseMerchantOrderPriceValue parses formatted values", () => {
  assert.equal(parseMerchantOrderPriceValue("39.90"), 39.9);
  assert.equal(parseMerchantOrderPriceValue("€14"), 14);
  assert.equal(parseMerchantOrderPriceValue("1,25"), 1.25);
  assert.equal(parseMerchantOrderPriceValue("1.234,56"), 1234.56);
  assert.equal(parseMerchantOrderPriceValue("1,234.56"), 1234.56);
});

test("normalizeMerchantOrderLineItems computes subtotal", () => {
  const items = normalizeMerchantOrderLineItems(
    [
      {
        productId: "a",
        name: "Demo",
        quantity: 2,
        unitPriceText: "39.90",
      },
    ],
    "€",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.subtotal, 79.8);
  assert.equal(items[0]?.unitPriceText, "39.90");
});

test("createMerchantOrder summarizes totals", () => {
  const order = createMerchantOrder({
    siteId: "10000000",
    siteName: "fafona",
    blockId: "b-product",
    pricePrefix: "€",
    customer: {
      name: "Felix",
    },
    items: [
      {
        productId: "a",
        name: "Demo",
        quantity: 3,
        unitPriceText: "7",
      },
    ],
  });
  assert.equal(order.totalQuantity, 3);
  assert.equal(order.totalAmount, 21);
  assert.equal(formatMerchantOrderAmount(order.totalAmount, order.pricePrefix), "€21.00");
});

test("createMerchantOrder keeps personal customer identity", () => {
  const order = createMerchantOrder({
    siteId: "10000000",
    customerAccountId: "50010105",
    customerUserId: "user-1",
    customerLoginEmail: "USER@EXAMPLE.COM",
    customer: {
      name: "Nana",
      email: "contact@example.com",
    },
    items: [{ productId: "a", name: "Demo", quantity: 1, unitPriceText: "1" }],
  });
  assert.equal(order.customerAccountId, "50010105");
  assert.equal(order.customerUserId, "user-1");
  assert.equal(order.customerLoginEmail, "user@example.com");

  const normalized = normalizeMerchantOrderRecord(order);
  assert.equal(normalized?.customerAccountId, "50010105");
  assert.equal(normalized?.customerUserId, "user-1");
  assert.equal(normalized?.customerLoginEmail, "user@example.com");
});

test("buildMerchantOrderId uses O + merchant id + date + 4-digit sequence", () => {
  const createdAt = new Date("2026-04-18T10:20:00.000Z");
  assert.equal(
    buildMerchantOrderId("10000000", createdAt, [
      "O10000000202604180001",
      "O10000000202604180009",
      "O99999999202604180099",
      "O10000000202604170004",
    ]),
    "O10000000202604180010",
  );
});

test("isMerchantOrderPendingMerchantTouch only clears after a merchant action catches up", () => {
  assert.equal(
    isMerchantOrderPendingMerchantTouch({
      updatedAt: "2026-04-18T10:00:00.000Z",
      merchantTouchedAt: "",
    }),
    true,
  );
  assert.equal(
    isMerchantOrderPendingMerchantTouch({
      updatedAt: "2026-04-18T10:00:00.000Z",
      merchantTouchedAt: "2026-04-18T10:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    isMerchantOrderPendingMerchantTouch({
      updatedAt: "2026-04-18T10:05:00.000Z",
      merchantTouchedAt: "2026-04-18T10:00:00.000Z",
    }),
    true,
  );
});

test("isMerchantOrderNewForMerchant only counts untouched pending orders", () => {
  assert.equal(
    isMerchantOrderNewForMerchant({
      status: "pending",
      updatedAt: "2026-04-18T10:00:00.000Z",
      merchantTouchedAt: "",
    }),
    true,
  );
  assert.equal(
    isMerchantOrderNewForMerchant({
      status: "confirmed",
      updatedAt: "2026-04-18T10:00:00.000Z",
      merchantTouchedAt: "",
    }),
    false,
  );
  assert.equal(
    isMerchantOrderNewForMerchant({
      status: "pending",
      updatedAt: "2026-04-18T10:00:00.000Z",
      merchantTouchedAt: "2026-04-18T10:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    isMerchantOrderNewForMerchant({
      status: "pending",
      updatedAt: "2026-04-18T10:05:00.000Z",
      merchantTouchedAt: "2026-04-18T10:00:00.000Z",
    }),
    false,
  );
});

test("applyMerchantOrderAction supports complete and restore flows", () => {
  const base = createMerchantOrder({
    siteId: "10000000",
    siteName: "fafona",
    blockId: "b-product",
    pricePrefix: "€",
    customer: {
      name: "Felix",
    },
    items: [
      {
        productId: "a",
        name: "Demo",
        quantity: 1,
        unitPriceText: "14",
      },
    ],
  });

  const confirmed = applyMerchantOrderAction(base, "confirm", "2026-04-20T08:00:00.000Z");
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.confirmedAt, "2026-04-20T08:00:00.000Z");
  assert.equal(confirmed.cancelledAt, null);

  const restoredFromConfirmed = applyMerchantOrderAction(confirmed, "restore", "2026-04-20T08:05:00.000Z");
  assert.equal(restoredFromConfirmed.status, "pending");
  assert.equal(restoredFromConfirmed.confirmedAt, null);
  assert.equal(restoredFromConfirmed.completedAt, null);
  assert.equal(restoredFromConfirmed.cancelledAt, null);
  assert.equal(restoredFromConfirmed.updatedAt, "2026-04-20T08:05:00.000Z");

  const completed = applyMerchantOrderAction(confirmed, "complete", "2026-04-20T08:06:00.000Z");
  assert.equal(completed.status, "completed");
  assert.equal(completed.confirmedAt, "2026-04-20T08:00:00.000Z");
  assert.equal(completed.completedAt, "2026-04-20T08:06:00.000Z");
  assert.equal(completed.cancelledAt, null);

  const uncompleted = applyMerchantOrderAction(completed, "uncomplete", "2026-04-20T08:07:00.000Z");
  assert.equal(uncompleted.status, "confirmed");
  assert.equal(uncompleted.confirmedAt, "2026-04-20T08:00:00.000Z");
  assert.equal(uncompleted.completedAt, null);
  assert.equal(uncompleted.cancelledAt, null);

  const cancelled = applyMerchantOrderAction(base, "cancel", "2026-04-20T09:00:00.000Z");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.completedAt, null);
  assert.equal(cancelled.cancelledAt, "2026-04-20T09:00:00.000Z");

  const restoredFromCancelled = applyMerchantOrderAction(cancelled, "restore", "2026-04-20T09:05:00.000Z");
  assert.equal(restoredFromCancelled.status, "pending");
  assert.equal(restoredFromCancelled.confirmedAt, null);
  assert.equal(restoredFromCancelled.completedAt, null);
  assert.equal(restoredFromCancelled.cancelledAt, null);
  assert.equal(restoredFromCancelled.updatedAt, "2026-04-20T09:05:00.000Z");
});

test("updateMerchantOrderItems recalculates quantity and totals", () => {
  const base = createMerchantOrder({
    siteId: "10000000",
    siteName: "fafona",
    blockId: "b-product",
    pricePrefix: "€",
    customer: {
      name: "Felix",
    },
    items: [
      {
        productId: "a",
        code: "SKU-001",
        name: "Demo A",
        quantity: 1,
        unitPriceText: "39.90",
      },
      {
        productId: "b",
        code: "SKU-002",
        name: "Demo B",
        quantity: 2,
        unitPriceText: "7.00",
      },
    ],
  });

  const updated = updateMerchantOrderItems(
    base,
    base.items.map((item, index) => (index === 0 ? { ...item, quantity: 3 } : item)),
    "2026-04-20T10:00:00.000Z",
  );

  assert.equal(updated.items[0]?.quantity, 3);
  assert.equal(updated.items[0]?.subtotal, 119.7);
  assert.equal(updated.totalQuantity, 5);
  assert.equal(updated.totalAmount, 133.7);
  assert.equal(updated.updatedAt, "2026-04-20T10:00:00.000Z");
  assert.equal(updated.merchantTouchedAt, "2026-04-20T10:00:00.000Z");
});

test("applyMerchantOrderUpdate persists item and status changes as one final order", () => {
  const base = createMerchantOrder({
    siteId: "10000000",
    siteName: "fafona",
    blockId: "b-product",
    pricePrefix: "€",
    customer: { name: "Felix" },
    items: [
      {
        productId: "a",
        code: "SKU-001",
        name: "Demo A",
        quantity: 1,
        unitPriceText: "39.90",
      },
    ],
  });
  const actedAt = "2026-07-24T10:00:00.000Z";
  const updated = applyMerchantOrderUpdate(
    base,
    {
      items: base.items.map((item) => ({ ...item, quantity: 3 })),
      status: "confirmed",
    },
    actedAt,
  );

  assert.equal(updated.items[0]?.quantity, 3);
  assert.equal(updated.totalQuantity, 3);
  assert.equal(updated.totalAmount, 119.7);
  assert.equal(updated.status, "confirmed");
  assert.equal(updated.confirmedAt, actedAt);
  assert.equal(updated.updatedAt, actedAt);
  assert.equal(updated.merchantTouchedAt, actedAt);
});

test("updateMerchantOrderItems removes items whose quantity becomes zero", () => {
  const base = createMerchantOrder({
    siteId: "10000000",
    siteName: "fafona",
    blockId: "b-product",
    pricePrefix: "€",
    customer: {
      name: "Felix",
    },
    items: [
      {
        productId: "a",
        code: "SKU-001",
        name: "Demo A",
        quantity: 1,
        unitPriceText: "10.00",
      },
      {
        productId: "b",
        code: "SKU-002",
        name: "Demo B",
        quantity: 2,
        unitPriceText: "7.00",
      },
    ],
  });

  const updated = updateMerchantOrderItems(
    base,
    [
      { ...base.items[0], quantity: 0 },
      { ...base.items[1], quantity: 2 },
    ],
    "2026-04-20T10:10:00.000Z",
  );

  assert.equal(updated.items.length, 1);
  assert.equal(updated.items[0]?.code, "SKU-002");
  assert.equal(updated.totalQuantity, 2);
  assert.equal(updated.totalAmount, 14);
});

test("updateMerchantOrderItems only accepts quantities for existing lines and preserves server prices", () => {
  const base = createMerchantOrder({
    siteId: "10000000",
    items: [{ productId: "a", code: "SKU-001", name: "Original", quantity: 1, unitPrice: 39.9 }],
  });
  const updated = updateMerchantOrderItems(base, [
    {
      productId: "a",
      name: "Tampered",
      quantity: 2,
      unitPrice: 0.01,
      unitPriceText: "0.01",
    },
  ]);

  assert.equal(updated.items[0]?.name, "Original");
  assert.equal(updated.items[0]?.unitPrice, 39.9);
  assert.equal(updated.totalAmount, 79.8);
  assert.throws(
    () => updateMerchantOrderItems(base, [{ productId: "unknown", quantity: 1 }]),
    /order_item_invalid/,
  );
});
