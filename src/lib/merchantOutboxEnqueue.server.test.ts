import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueueMerchantOutboxEvent,
  resolveMerchantOutboxEnqueueConfig,
  type MerchantOutboxEnqueueConfig,
} from "@/lib/merchantOutboxEnqueue.server";

const input = {
  merchantId: "10000000",
  eventType: "merchant.notification.deliver" as const,
  aggregateType: "order",
  aggregateId: "order-1",
  operationId: "created:1",
  payload: { orderId: "order-1" },
};

const enabledConfig: MerchantOutboxEnqueueConfig = {
  mode: "shadow",
  siteIds: ["10000000"],
  eventTypes: ["merchant.notification.deliver"],
  timeoutMs: 2000,
};

test("outbox enqueue is disabled and empty by default", () => {
  assert.deepEqual(resolveMerchantOutboxEnqueueConfig({}), {
    mode: "off",
    siteIds: [],
    eventTypes: [],
    timeoutMs: 2000,
  });
});

test("outbox enqueue rejects wildcard and unknown allowlist entries", () => {
  assert.deepEqual(
    resolveMerchantOutboxEnqueueConfig({
      MERCHANT_OUTBOX_V1_ENQUEUE_MODE: "shadow",
      MERCHANT_OUTBOX_V1_ENQUEUE_SITE_IDS: "*,10000000,bad",
      MERCHANT_OUTBOX_V1_ENQUEUE_EVENT_TYPES:
        "*,merchant.notification.deliver,arbitrary.execute",
      MERCHANT_OUTBOX_V1_ENQUEUE_TIMEOUT_MS: "700",
    }),
    {
      mode: "shadow",
      siteIds: ["10000000"],
      eventTypes: ["merchant.notification.deliver"],
      timeoutMs: 700,
    },
  );
});

test("disabled or non-allowlisted enqueue never calls the database", async () => {
  let calls = 0;
  const client = {
    rpc: async () => {
      calls += 1;
      return { data: null, error: null };
    },
  };
  assert.deepEqual(await enqueueMerchantOutboxEvent(client, input), {
    status: "disabled",
  });
  assert.deepEqual(
    await enqueueMerchantOutboxEvent(client, input, {
      config: { ...enabledConfig, siteIds: ["10000001"] },
    }),
    { status: "not_allowed" },
  );
  assert.equal(calls, 0);
});

test("allowlisted enqueue calls the atomic RPC once", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await enqueueMerchantOutboxEvent(
    {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return {
          data: {
            id: "123e4567-e89b-42d3-a456-426614174000",
            deduplicated: false,
          },
          error: null,
        };
      },
    },
    input,
    { config: enabledConfig },
  );
  assert.equal(result.status, "queued");
  assert.equal(result.deduplicated, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "faolla_enqueue_merchant_outbox_v1");
  assert.equal(
    (calls[0]?.args.p_event as { merchant_id?: unknown }).merchant_id,
    "10000000",
  );
});

test("outbox conflicts return a safe code and do not expose backend details", async () => {
  const logs: unknown[] = [];
  const result = await enqueueMerchantOutboxEvent(
    {
      rpc: async () => ({
        data: null,
        error: {
          message:
            "outbox_event_conflict payload included private customer@example.com",
        },
      }),
    },
    input,
    {
      config: enabledConfig,
      logger: (event) => logs.push(event),
    },
  );
  assert.deepEqual(result, {
    status: "failed",
    errorCode: "outbox_event_conflict",
  });
  assert.equal(JSON.stringify(logs).includes("customer@example.com"), false);
});

test("outbox enqueue timeout is bounded and nonthrowing", async () => {
  const result = await enqueueMerchantOutboxEvent(
    {
      rpc: () => new Promise(() => undefined),
    },
    input,
    {
      config: { ...enabledConfig, timeoutMs: 1 },
      logger: () => undefined,
    },
  );
  assert.equal(result.status, "timeout");
});
