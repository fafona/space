import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantOrderShadowMutation,
  mirrorMerchantOrderTransitions,
  resolveMerchantOrderDualWriteConfig,
} from "@/lib/merchantOrderDualWrite.server";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

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
    customerGuestHash: "",
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:00:00.000Z",
    merchantTouchedAt: "",
    status: "pending",
    customer: {
      name: "Nana",
      phone: "600000000",
      email: "member@example.com",
      note: "",
    },
    items: [
      {
        productId: "product-1",
        code: "SKU-001",
        name: "Product",
        description: "",
        imageUrl: "",
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
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    printedAt: null,
    printCount: 0,
    ...overrides,
  };
}

test("dual-write configuration is disabled unless shadow mode is explicit", () => {
  assert.deepEqual(resolveMerchantOrderDualWriteConfig({}), {
    mode: "off",
    timeoutMs: 2500,
  });
  assert.deepEqual(
    resolveMerchantOrderDualWriteConfig({
      MERCHANT_ORDER_V1_DUAL_WRITE_MODE: "shadow",
      MERCHANT_ORDER_V1_DUAL_WRITE_TIMEOUT_MS: "800",
    }),
    {
      mode: "shadow",
      timeoutMs: 800,
    },
  );
});

test("shadow mutation converts money to minor units and keeps a full source snapshot", () => {
  const order = createOrder();
  const mutation = buildMerchantOrderShadowMutation({ next: order });
  assert.equal(mutation.order.total_amount_minor, 7980);
  assert.equal(mutation.order.currency, "EUR");
  assert.equal(mutation.items[0]?.unit_amount_minor, 3990);
  assert.equal(mutation.items[0]?.subtotal_amount_minor, 7980);
  assert.deepEqual(mutation.order.source_snapshot, order);
  assert.equal(mutation.event.event_type, "created");
  assert.match(mutation.event.idempotency_key, /^legacy-order:10000000:O10000000202607250001:/);
});

test("shadow mutation derives status events and deterministic idempotency keys", () => {
  const previous = createOrder();
  const next = createOrder({
    status: "confirmed",
    confirmedAt: "2026-07-25T10:05:00.000Z",
    updatedAt: "2026-07-25T10:05:00.000Z",
  });
  const first = buildMerchantOrderShadowMutation({ previous, next });
  const second = buildMerchantOrderShadowMutation({ previous, next });
  assert.equal(first.event.event_type, "status_changed");
  assert.equal(first.event.from_status, "pending");
  assert.equal(first.event.to_status, "confirmed");
  assert.equal(first.event.idempotency_key, second.event.idempotency_key);
});

test("disabled dual-write performs no database call", async () => {
  let calls = 0;
  const result = await mirrorMerchantOrderTransitions(
    {
      rpc: async () => {
        calls += 1;
        return { data: 1, error: null };
      },
    },
    [{ next: createOrder() }],
    { config: { mode: "off", timeoutMs: 2500 } },
  );
  assert.deepEqual(result, { status: "disabled", count: 0 });
  assert.equal(calls, 0);
});

test("shadow dual-write sends one atomic batch RPC", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const result = await mirrorMerchantOrderTransitions(
    {
      rpc: async (functionName, args) => {
        calls.push({ functionName, args });
        return { data: 1, error: null };
      },
    },
    [{ next: createOrder() }],
    { config: { mode: "shadow", timeoutMs: 2500 } },
  );
  assert.deepEqual(result, { status: "written", count: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.functionName, "faolla_upsert_merchant_orders_v1");
  assert.equal(Array.isArray(calls[0]?.args.p_mutations), true);
});

test("shadow failure is reported without throwing into the primary order flow", async () => {
  const logs: unknown[] = [];
  const result = await mirrorMerchantOrderTransitions(
    {
      rpc: async () => ({ data: null, error: { message: "relation does not exist" } }),
    },
    [{ next: createOrder() }],
    {
      config: { mode: "shadow", timeoutMs: 2500 },
      logger: (event) => logs.push(event),
    },
  );
  assert.equal(result.status, "failed");
  assert.equal(result.error, "relation does not exist");
  assert.equal(logs.length, 1);
});

test("shadow timeout is bounded and reported without throwing", async () => {
  const logs: unknown[] = [];
  const result = await mirrorMerchantOrderTransitions(
    {
      rpc: () => new Promise(() => undefined),
    },
    [{ next: createOrder() }],
    {
      config: { mode: "shadow", timeoutMs: 1 },
      logger: (event) => logs.push(event),
    },
  );
  assert.equal(result.status, "timeout");
  assert.equal(logs.length, 1);
});
