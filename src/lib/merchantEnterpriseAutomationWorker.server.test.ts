import assert from "node:assert/strict";
import test from "node:test";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import type { MerchantOutboxRpcClient } from "@/lib/merchantOutboxEnqueue.server";
import type { MerchantOutboxClaimedEvent } from "@/lib/merchantOutbox.server";
import { MerchantOutboxTaskError } from "@/lib/merchantOutboxWorker.server";
import { createMerchantEnterpriseAutomationOutboxHandler } from "@/lib/merchantEnterpriseAutomationWorker.server";

const eventId = "11111111-1111-4111-8111-111111111111";

function claimed(
  overrides: Partial<MerchantOutboxClaimedEvent> = {},
): MerchantOutboxClaimedEvent {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    merchantId: "10000000",
    eventKey: `enterprise-automation:order:${eventId}`,
    eventType: "enterprise.workflow_automation.process",
    aggregateType: "merchant_order_event",
    aggregateId: eventId,
    payload: { sourceType: "order", eventId },
    attempts: 1,
    totalAttempts: 1,
    maxAttempts: 12,
    correlationId: eventId,
    leaseExpiresAt: "2026-08-04T10:01:00.000Z",
    createdAt: "2026-08-04T10:00:00.000Z",
    ...overrides,
  };
}

function context(renewLease = true) {
  return {
    signal: new AbortController().signal,
    async renewLease() {
      return renewLease;
    },
  };
}

test("automation worker rejects forged outbox identity before side effects", async () => {
  let entitlementCalls = 0;
  const client: MerchantOutboxRpcClient = {
    async rpc() {
      throw new Error("must not call RPC");
    },
  };
  const handler = createMerchantEnterpriseAutomationOutboxHandler(client, {
    async requireEntitlement() {
      entitlementCalls += 1;
      return {};
    },
  });
  await assert.rejects(
    handler(claimed({ eventKey: `forged:${eventId}` }), context()),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "invalid_automation_outbox_event" &&
      error.retryable === false,
  );
  assert.equal(entitlementCalls, 0);
});

test("automation worker renews its lease and processes every successful rule", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: MerchantOutboxRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: {
          merchantId: "10000000",
          runs: [
            { runId: "33333333-3333-4333-8333-333333333333", status: "completed" },
            { runId: "44444444-4444-4444-8444-444444444444", status: "skipped" },
          ],
        },
        error: null,
      };
    },
  };
  const handler = createMerchantEnterpriseAutomationOutboxHandler(client, {
    async requireEntitlement() {
      return {};
    },
  });
  assert.deepEqual(await handler(claimed(), context()), {
    status: "processed",
    runCount: 2,
    processing: 0,
    completed: 1,
    failed: 0,
    retryableFailed: 0,
    skipped: 1,
  });
  assert.deepEqual(calls, [
    {
      name: "faolla_process_merchant_enterprise_automation_event_v1",
      args: {
        p_input: {
          merchant_id: "10000000",
          source_type: "order",
          event_id: eventId,
        },
      },
    },
  ]);
});

test("automation worker retries a concurrently processing rule", async () => {
  const client: MerchantOutboxRpcClient = {
    async rpc() {
      return {
        data: {
          merchantId: "10000000",
          runs: [
            { runId: "33333333-3333-4333-8333-333333333333", status: "processing" },
          ],
        },
        error: null,
      };
    },
  };
  const handler = createMerchantEnterpriseAutomationOutboxHandler(client, {
    async requireEntitlement() {
      return {};
    },
  });
  await assert.rejects(
    handler(claimed(), context()),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "automation_rule_processing" &&
      error.retryable,
  );
});

test("automation worker retries the outbox event when any isolated rule fails", async () => {
  const client: MerchantOutboxRpcClient = {
    async rpc() {
      return {
        data: {
          merchantId: "10000000",
          runs: [
            { runId: "33333333-3333-4333-8333-333333333333", status: "completed" },
            {
              runId: "44444444-4444-4444-8444-444444444444",
              status: "failed",
              errorCode: "automation_execution_failed",
              retryable: true,
            },
          ],
        },
        error: null,
      };
    },
  };
  const handler = createMerchantEnterpriseAutomationOutboxHandler(client, {
    async requireEntitlement() {
      return {};
    },
  });
  await assert.rejects(
    handler(claimed(), context()),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "automation_rule_failed" &&
      error.retryable,
  );
});

test("automation worker completes the outbox after a terminal rule is paused", async () => {
  const client: MerchantOutboxRpcClient = {
    async rpc() {
      return {
        data: {
          merchantId: "10000000",
          runs: [
            {
              runId: "55555555-5555-4555-8555-555555555555",
              status: "completed",
            },
            {
              runId: "33333333-3333-4333-8333-333333333333",
              status: "failed",
              errorCode: "automation_assignee_unavailable",
              retryable: false,
            },
          ],
        },
        error: null,
      };
    },
  };
  const handler = createMerchantEnterpriseAutomationOutboxHandler(client, {
    async requireEntitlement() {
      return {};
    },
  });
  assert.deepEqual(await handler(claimed(), context()), {
    status: "processed",
    runCount: 2,
    processing: 0,
    completed: 1,
    failed: 1,
    retryableFailed: 0,
    skipped: 0,
  });
});

test("automation worker rejects forged retryability in both directions", async () => {
  for (const failedRun of [
    {
      errorCode: "automation_execution_failed",
      retryable: false,
    },
    {
      errorCode: "automation_target_unavailable",
      retryable: true,
    },
  ]) {
    const client: MerchantOutboxRpcClient = {
      async rpc() {
        return {
          data: {
            merchantId: "10000000",
            runs: [
              {
                runId: "33333333-3333-4333-8333-333333333333",
                status: "failed",
                ...failedRun,
              },
            ],
          },
          error: null,
        };
      },
    };
    const handler = createMerchantEnterpriseAutomationOutboxHandler(client, {
      async requireEntitlement() {
        return {};
      },
    });
    await assert.rejects(
      handler(claimed(), context()),
      (error: unknown) =>
        error instanceof MerchantOutboxTaskError &&
        error.code === "invalid_automation_processor_result" &&
        error.retryable,
    );
  }
});

test("automation worker retries only the transient member of a mixed failed summary", async () => {
  const client: MerchantOutboxRpcClient = {
    async rpc() {
      return {
        data: {
          merchantId: "10000000",
          runs: [
            {
              runId: "33333333-3333-4333-8333-333333333333",
              status: "failed",
              errorCode: "automation_assignee_unavailable",
              retryable: false,
            },
            {
              runId: "44444444-4444-4444-8444-444444444444",
              status: "failed",
              errorCode: "automation_execution_failed",
              retryable: true,
            },
          ],
        },
        error: null,
      };
    },
  };
  const handler = createMerchantEnterpriseAutomationOutboxHandler(client, {
    async requireEntitlement() {
      return {};
    },
  });
  await assert.rejects(
    handler(claimed(), context()),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "automation_rule_failed" &&
      error.retryable,
  );
});

test("automation worker pauses active rules when entitlement was revoked", async () => {
  const calls: string[] = [];
  const client: MerchantOutboxRpcClient = {
    async rpc(name, args) {
      calls.push(name);
      assert.deepEqual(args, {
        p_input: {
          merchant_id: "10000000",
          reason_code: "entitlement_revoked",
        },
      });
      return {
        data: { merchantId: "10000000", pausedCount: 3 },
        error: null,
      };
    },
  };
  const handler = createMerchantEnterpriseAutomationOutboxHandler(client, {
    async requireEntitlement() {
      throw new MerchantEnterpriseAccessError(
        "enterprise_management_disabled",
        403,
      );
    },
  });
  assert.deepEqual(await handler(claimed(), context()), {
    status: "skipped",
    reasonCode: "enterprise_management_disabled",
  });
  assert.deepEqual(calls, [
    "faolla_pause_merchant_enterprise_automations_for_entitlement_v1",
  ]);
});

test("automation worker retries malformed entitlement pause responses", async () => {
  const client: MerchantOutboxRpcClient = {
    async rpc() {
      return { data: { merchantId: "20000000", pausedCount: -1 }, error: null };
    },
  };
  const handler = createMerchantEnterpriseAutomationOutboxHandler(client, {
    async requireEntitlement() {
      throw new MerchantEnterpriseAccessError(
        "enterprise_management_disabled",
        403,
      );
    },
  });
  await assert.rejects(
    handler(claimed(), context()),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "automation_entitlement_pause_failed" &&
      error.retryable,
  );
});
