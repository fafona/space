import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMerchantOrderAction,
  buildMerchantOrderId,
  createMerchantOrder,
  formatMerchantOrderAmount,
  isMerchantOrderPendingMerchantTouch,
  normalizeMerchantOrderLineItems,
  parseMerchantOrderPriceValue,
} from "@/lib/merchantOrders";

test("parseMerchantOrderPriceValue parses formatted values", () => {
  assert.equal(parseMerchantOrderPriceValue("39.90"), 39.9);
  assert.equal(parseMerchantOrderPriceValue("€14"), 14);
  assert.equal(parseMerchantOrderPriceValue("1,25"), 1.25);
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

test("applyMerchantOrderAction restores confirmed and cancelled orders back to pending", () => {
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
  assert.equal(restoredFromConfirmed.cancelledAt, null);
  assert.equal(restoredFromConfirmed.updatedAt, "2026-04-20T08:05:00.000Z");

  const cancelled = applyMerchantOrderAction(base, "cancel", "2026-04-20T09:00:00.000Z");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelledAt, "2026-04-20T09:00:00.000Z");

  const restoredFromCancelled = applyMerchantOrderAction(cancelled, "restore", "2026-04-20T09:05:00.000Z");
  assert.equal(restoredFromCancelled.status, "pending");
  assert.equal(restoredFromCancelled.confirmedAt, null);
  assert.equal(restoredFromCancelled.cancelledAt, null);
  assert.equal(restoredFromCancelled.updatedAt, "2026-04-20T09:05:00.000Z");
});
