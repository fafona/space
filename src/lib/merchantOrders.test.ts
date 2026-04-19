import test from "node:test";
import assert from "node:assert/strict";
import {
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
