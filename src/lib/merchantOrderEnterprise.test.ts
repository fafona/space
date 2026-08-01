import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantLinkedOrderSummary,
  buildMerchantOrderTaskDraft,
  getMerchantLinkedOrderSummaryErrorMessage,
  getMerchantOrderSourceErrorMessage,
  getMerchantOrderTaskSource,
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

test("linked order summaries expose only the explicit operational whitelist", () => {
  const order = buildOrder({
    clientRequestId: "private-client-request",
    customerAccountId: "private-account-id",
    customerUserId: "private-user-id",
    customerLoginEmail: "login-private@example.com",
    customerGuestHash: "private-guest-hash",
    items: [
      {
        productId: "private-product-id",
        code: "SKU-1",
        name: "Coffee",
        description: "Large / hot",
        imageUrl: "https://private.example/product.jpg",
        tag: "private-category",
        quantity: 3,
        unitPrice: 4.5,
        unitPriceText: "€4.50 private display",
        subtotal: 13.5,
      },
    ],
    totalQuantity: 3,
    totalAmount: 13.5,
  });

  const summary = buildMerchantLinkedOrderSummary(order);

  assert.deepEqual(Object.keys(summary), [
    "id",
    "status",
    "createdAt",
    "items",
    "totalQuantity",
    "totalAmount",
    "pricePrefix",
  ]);
  assert.deepEqual(Object.keys(summary.items[0] ?? {}), [
    "name",
    "code",
    "specification",
    "quantity",
    "unitPrice",
    "subtotal",
  ]);
  assert.deepEqual(summary.items[0], {
    name: "Coffee",
    code: "SKU-1",
    specification: "Large / hot",
    quantity: 3,
    unitPrice: 4.5,
    subtotal: 13.5,
  });

  const serialized = JSON.stringify(summary);
  for (const privateValue of [
    ...Object.values(order.customer),
    order.clientRequestId,
    order.customerAccountId,
    order.customerUserId,
    order.customerLoginEmail,
    order.customerGuestHash,
    order.items[0]?.productId,
    order.items[0]?.imageUrl,
    order.items[0]?.tag,
    order.items[0]?.unitPriceText,
  ]) {
    assert.ok(
      !privateValue || !serialized.includes(privateValue),
      `summary must omit private value: ${privateValue}`,
    );
  }
});

test("order task draft source and title stay within persisted task limits", () => {
  const draft = buildMerchantOrderTaskDraft(buildOrder({ id: `O${"1".repeat(400)}` }));

  assert.equal(draft.sourceId.length, 200);
  assert.ok(draft.title.length <= 240);
  assert.ok(draft.description.length <= 10_000);
});

test("order task sources remain visible independently from editable task text", () => {
  assert.deepEqual(
    getMerchantOrderTaskSource({
      sourceType: MERCHANT_ORDER_TASK_SOURCE_TYPE,
      sourceId: "  O10000000202608010001  ",
    }),
    {
      sourceType: MERCHANT_ORDER_TASK_SOURCE_TYPE,
      sourceId: "O10000000202608010001",
    },
  );
  assert.equal(getMerchantOrderTaskSource({ sourceType: "", sourceId: "" }), null);
  assert.equal(getMerchantOrderTaskSource({ sourceType: "booking", sourceId: "B1" }), null);
});

test("source order failures have actionable owner-facing messages", () => {
  assert.equal(
    getMerchantOrderSourceErrorMessage("order_not_found"),
    "来源订单当前不可用，可能已被删除。",
  );
  assert.equal(
    getMerchantOrderSourceErrorMessage("permission_denied"),
    "当前账号无权查看来源订单。",
  );
  assert.equal(
    getMerchantOrderSourceErrorMessage("unexpected"),
    "来源订单读取失败，请稍后重试。",
  );
});

test("linked order summary failures avoid revealing task or order existence", () => {
  assert.equal(
    getMerchantLinkedOrderSummaryErrorMessage("task_not_found"),
    "当前任务没有可查看的关联订单摘要。",
  );
  assert.equal(
    getMerchantLinkedOrderSummaryErrorMessage("permission_denied"),
    "当前账号无权查看关联订单摘要。",
  );
  assert.equal(
    getMerchantLinkedOrderSummaryErrorMessage("unexpected"),
    "关联订单摘要读取失败，请稍后重试。",
  );
});
