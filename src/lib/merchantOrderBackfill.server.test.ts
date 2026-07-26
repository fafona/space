import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantOrderBackfillPlan,
  normalizeMerchantOrderBackfillBatchSize,
} from "@/lib/merchantOrderBackfill.server";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

function createOrder(
  id: string,
  createdAt: string,
  overrides: Partial<MerchantOrderRecord> = {},
): MerchantOrderRecord {
  return {
    id,
    siteId: "10000000",
    siteName: "Faolla",
    blockId: "products",
    clientRequestId: `request-${id}`,
    createdAt,
    updatedAt: createdAt,
    status: "pending",
    customer: {
      name: "",
      phone: "",
      email: "",
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
        unitPriceText: "€10.00",
        subtotal: 10,
      },
    ],
    totalQuantity: 1,
    totalAmount: 10,
    pricePrefix: "€",
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
    ...overrides,
  };
}

test("backfill plan is deterministic, bounded and oldest first", () => {
  const plan = buildMerchantOrderBackfillPlan({
    merchantId: "10000000",
    batchSize: 2,
    orders: [
      createOrder("order-3", "2026-07-25T12:00:00.000Z"),
      createOrder("order-1", "2026-07-25T10:00:00.000Z"),
      createOrder("order-2", "2026-07-25T11:00:00.000Z"),
    ],
  });

  assert.equal(plan.orderCount, 3);
  assert.equal(plan.batches.length, 2);
  assert.equal(plan.batches[0]?.length, 2);
  assert.deepEqual(
    plan.batches.flat().map((mutation) => mutation.order.id),
    ["order-1", "order-2", "order-3"],
  );
  assert.equal(plan.blockers.length, 0);
});

test("backfill events use a deterministic namespace distinct from live shadow writes", () => {
  const order = createOrder("order-1", "2026-07-25T10:00:00.000Z");
  const first = buildMerchantOrderBackfillPlan({ merchantId: "10000000", orders: [order] });
  const second = buildMerchantOrderBackfillPlan({ merchantId: "10000000", orders: [order] });
  const firstEvent = first.batches[0]?.[0]?.event;
  const secondEvent = second.batches[0]?.[0]?.event;

  assert.equal(firstEvent?.event_type, "legacy_backfill");
  assert.equal(firstEvent?.actor_id, "legacy-order-backfill");
  assert.match(firstEvent?.idempotency_key ?? "", /^legacy-order-backfill:10000000:order-1:/);
  assert.equal(firstEvent?.idempotency_key, secondEvent?.idempotency_key);
});

test("backfill refuses cross-merchant, duplicate request and invalid timestamp data", () => {
  const plan = buildMerchantOrderBackfillPlan({
    merchantId: "10000000",
    orders: [
      createOrder("order-1", "not-a-date", { clientRequestId: "duplicate" }),
      createOrder("order-2", "2026-07-25T10:00:00.000Z", {
        siteId: "20000000",
        clientRequestId: "duplicate",
      }),
    ],
  });

  assert.deepEqual(
    plan.blockers.map((blocker) => blocker.code).sort(),
    ["duplicate_client_request_id", "invalid_created_at", "invalid_updated_at", "merchant_mismatch"],
  );
});

test("backfill batch sizes are clamped to a conservative range", () => {
  assert.equal(normalizeMerchantOrderBackfillBatchSize(undefined), 10);
  assert.equal(normalizeMerchantOrderBackfillBatchSize(0), 1);
  assert.equal(normalizeMerchantOrderBackfillBatchSize(500), 50);
  assert.equal(normalizeMerchantOrderBackfillBatchSize(12), 12);
});
