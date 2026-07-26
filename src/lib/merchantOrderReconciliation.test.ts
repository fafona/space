import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileMerchantOrderStorage,
  type MerchantOrderItemV1Row,
  type MerchantOrderV1Row,
} from "@/lib/merchantOrderReconciliation";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

function createLegacyOrder(overrides: Partial<MerchantOrderRecord> = {}): MerchantOrderRecord {
  return {
    id: "O10000000202607250001",
    siteId: "10000000",
    siteName: "Faolla",
    blockId: "products",
    clientRequestId: "request-1",
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:05:00.000Z",
    status: "confirmed",
    customer: { name: "", phone: "", email: "", note: "" },
    items: [
      {
        productId: "product-1",
        code: "SKU-001",
        name: "Product",
        description: "",
        imageUrl: "",
        tag: "",
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

function createV1Order(overrides: MerchantOrderV1Row = {}): MerchantOrderV1Row {
  return {
    merchant_id: "10000000",
    id: "O10000000202607250001",
    status: "confirmed",
    total_quantity: 2,
    total_amount_minor: 7980,
    print_count: 0,
    created_at: "2026-07-25 10:00:00+00",
    updated_at: "2026-07-25 10:05:00+00",
    ...overrides,
  };
}

function createV1Item(overrides: MerchantOrderItemV1Row = {}): MerchantOrderItemV1Row {
  return {
    merchant_id: "10000000",
    order_id: "O10000000202607250001",
    line_number: 1,
    product_id: "product-1",
    code: "SKU-001",
    name: "Product",
    quantity: 2,
    unit_amount_minor: 3990,
    subtotal_amount_minor: 7980,
    ...overrides,
  };
}

test("reconciliation accepts equivalent legacy and relational orders", () => {
  const report = reconcileMerchantOrderStorage({
    merchantId: "10000000",
    legacyOrders: [createLegacyOrder()],
    v1Orders: [createV1Order()],
    v1Items: [createV1Item()],
  });
  assert.equal(report.isMatch, true);
  assert.equal(report.matchedCount, 1);
  assert.deepEqual(report.mismatches, []);
});

test("reconciliation reports missing and unexpected order ids", () => {
  const report = reconcileMerchantOrderStorage({
    merchantId: "10000000",
    legacyOrders: [createLegacyOrder()],
    v1Orders: [createV1Order({ id: "unexpected" })],
    v1Items: [],
  });
  assert.deepEqual(report.missingInV1, ["O10000000202607250001"]);
  assert.deepEqual(report.unexpectedInV1, ["unexpected"]);
  assert.equal(report.isMatch, false);
});

test("reconciliation identifies order and line-item field mismatches", () => {
  const report = reconcileMerchantOrderStorage({
    merchantId: "10000000",
    legacyOrders: [createLegacyOrder()],
    v1Orders: [
      createV1Order({
        status: "pending",
        total_quantity: 3,
        total_amount_minor: 9999,
        print_count: 2,
      }),
    ],
    v1Items: [createV1Item({ quantity: 3, subtotal_amount_minor: 9999 })],
  });
  assert.equal(report.isMatch, false);
  assert.deepEqual(report.mismatches[0], {
    orderId: "O10000000202607250001",
    fields: [
      "status",
      "totalQuantity",
      "totalAmount",
      "printCount",
      "items.1.quantity",
      "items.1.subtotalAmount",
    ],
  });
});

test("reconciliation ignores rows from other merchants", () => {
  const report = reconcileMerchantOrderStorage({
    merchantId: "10000000",
    legacyOrders: [createLegacyOrder()],
    v1Orders: [
      createV1Order(),
      createV1Order({ merchant_id: "20000000", id: "other-order" }),
    ],
    v1Items: [
      createV1Item(),
      createV1Item({ merchant_id: "20000000", order_id: "other-order" }),
    ],
  });
  assert.equal(report.isMatch, true);
  assert.equal(report.v1Count, 1);
});

test("reconciliation uses the legacy timestamp in source snapshot after an idempotent upsert", () => {
  const legacy = createLegacyOrder();
  const report = reconcileMerchantOrderStorage({
    merchantId: "10000000",
    legacyOrders: [legacy],
    v1Orders: [
      {
        ...createV1Order(),
        updated_at: "2026-07-26T12:00:00.000Z",
        source_snapshot: {
          updatedAt: legacy.updatedAt,
        },
      },
    ],
    v1Items: [createV1Item()],
  });

  assert.equal(report.isMatch, true);
  assert.equal(report.mismatches.length, 0);
});
