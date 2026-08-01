import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantOrderTaskDraft,
  MERCHANT_ORDER_TASK_SOURCE_TYPE,
} from "@/lib/merchantOrderEnterprise";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

function buildOrder(overrides: Partial<MerchantOrderRecord> = {}): MerchantOrderRecord {
  return {
    id: "O10000000202608010001",
    siteId: "10000000",
    siteName: "fafona",
    blockId: "products",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    status: "confirmed",
    customer: {
      name: "Private Customer",
      phone: "+34 600 123 456",
      email: "private@example.com",
      note: "Private delivery note",
    },
    items: [],
    totalQuantity: 3,
    totalAmount: 48.5,
    pricePrefix: "€",
    confirmedAt: "2026-08-01T10:05:00.000Z",
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
    ...overrides,
  };
}

test("order task drafts contain operational order facts without customer PII", () => {
  const order = buildOrder();
  const draft = buildMerchantOrderTaskDraft(order);

  assert.deepEqual(draft, {
    sourceType: MERCHANT_ORDER_TASK_SOURCE_TYPE,
    sourceId: order.id,
    title: `订单跟进 · ${order.id}`,
    description: [
      `订单号：${order.id}`,
      "订单状态：已确认",
      "商品数量：3 件",
      "订单金额：€48.50",
    ].join("\n"),
    priority: "normal",
  });

  const serialized = JSON.stringify(draft);
  for (const privateValue of Object.values(order.customer)) {
    assert.ok(!serialized.includes(privateValue), `draft must omit customer value: ${privateValue}`);
  }
});

test("order task draft source and title stay within persisted task limits", () => {
  const draft = buildMerchantOrderTaskDraft(buildOrder({ id: `O${"1".repeat(400)}` }));

  assert.equal(draft.sourceId.length, 200);
  assert.ok(draft.title.length <= 240);
  assert.ok(draft.description.length <= 10_000);
});
