import test from "node:test";
import assert from "node:assert/strict";
import {
  createMerchantOrder,
  formatMerchantOrderAmount,
  normalizeMerchantOrderLineItems,
  parseMerchantOrderPriceValue,
} from "@/lib/merchantOrders";

test("parseMerchantOrderPriceValue parses formatted values", () => {
  assert.equal(parseMerchantOrderPriceValue("39.90"), 39.9);
  assert.equal(parseMerchantOrderPriceValue("€214"), 214);
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
