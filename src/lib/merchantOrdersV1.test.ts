import assert from "node:assert/strict";
import test from "node:test";

import { buildMerchantOrderShadowMutation } from "@/lib/merchantOrderDualWrite.server";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import { convertMerchantOrderV1Rows } from "@/lib/merchantOrdersV1";

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
    customerGuestHash: "guest-hash",
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:05:00.000Z",
    merchantTouchedAt: "2026-07-25T10:05:00.000Z",
    status: "confirmed",
    customer: {
      name: "Nana",
      phone: "600000000",
      email: "member@example.com",
      note: "Front desk",
    },
    items: [
      {
        productId: "product-1",
        code: "SKU-001",
        name: "Product",
        description: "Description",
        imageUrl: "https://faolla.com/product.webp",
        tag: "Featured",
        quantity: 2,
        unitPrice: 39.9,
        unitPriceText: "€39.90",
        subtotal: 79.8,
      },
    ],
    totalQuantity: 2,
    totalAmount: 79.8,
    pricePrefix: "€",
    confirmedAt: "2026-07-25T10:05:00.000Z",
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
    ...overrides,
  };
}

function buildStoredRows(order = createOrder()) {
  const mutation = buildMerchantOrderShadowMutation({ next: order });
  return {
    orderRows: [mutation.order],
    itemRows: mutation.items.map((item, index) => ({
      merchant_id: order.siteId,
      order_id: order.id,
      line_number: index + 1,
      ...item,
    })),
  };
}

test("V1 rows convert back into the existing order contract without data loss", () => {
  const order = createOrder();
  const rows = buildStoredRows(order);
  const result = convertMerchantOrderV1Rows({
    merchantId: order.siteId,
    ...rows,
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.orders, [order]);
});

test("V1 conversion keeps the legacy update timestamp after a repeated database upsert", () => {
  const order = createOrder();
  const rows = buildStoredRows(order);
  rows.orderRows[0].updated_at = "2026-07-26T12:00:00.000Z";
  const result = convertMerchantOrderV1Rows({
    merchantId: order.siteId,
    ...rows,
  });

  assert.equal(result.valid, true);
  assert.equal(result.orders[0]?.updatedAt, order.updatedAt);
});

test("V1 conversion rejects totals that disagree with relational line items", () => {
  const rows = buildStoredRows();
  rows.orderRows[0].total_amount_minor = 9999;
  const result = convertMerchantOrderV1Rows({
    merchantId: "10000000",
    ...rows,
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    {
      orderId: "O10000000202607250001",
      code: "invalid_order_totals",
    },
  ]);
});

test("V1 conversion rejects cross-merchant and orphan item rows", () => {
  const rows = buildStoredRows();
  const result = convertMerchantOrderV1Rows({
    merchantId: "10000000",
    orderRows: rows.orderRows,
    itemRows: [
      ...rows.itemRows,
      {
        ...rows.itemRows[0],
        merchant_id: "20000000",
        order_id: "other-order",
      },
      {
        ...rows.itemRows[0],
        order_id: "missing-order",
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.errors.map((error) => error.code).sort(),
    ["orphan_item", "tenant_mismatch"],
  );
});
