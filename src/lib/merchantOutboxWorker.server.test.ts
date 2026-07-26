import assert from "node:assert/strict";
import test from "node:test";

import {
  MerchantOutboxTaskError,
  processMerchantOutboxBatch,
} from "@/lib/merchantOutboxWorker.server";

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    merchant_id: "10000000",
    event_key: "backup.create:abc",
    event_type: "backup.create",
    aggregate_type: "merchant",
    aggregate_id: "10000000",
    payload: { snapshotId: "snapshot-1" },
    status: "processing",
    attempts: 1,
    total_attempts: 1,
    max_attempts: 8,
    correlation_id: "request-1",
    lease_expires_at: "2026-07-25T10:01:00.000Z",
    created_at: "2026-07-25T10:00:00.000Z",
    ...overrides,
  };
}

test("worker stays idle when no handlers are registered", async () => {
  let calls = 0;
  const summary = await processMerchantOutboxBatch(
    {
      rpc: async () => {
        calls += 1;
        return { data: [], error: null };
      },
    },
    {
      workerId: "worker-1",
      merchantIds: ["10000000"],
      handlers: {},
    },
  );
  assert.equal(summary.status, "idle");
  assert.equal(calls, 0);
});

test("worker claims only registered event types and completes successful tasks", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const summary = await processMerchantOutboxBatch(
    {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "faolla_claim_merchant_outbox_scoped_v1") {
          return { data: [claimedRow()], error: null };
        }
        if (name === "faolla_complete_merchant_outbox_v1") {
          return { data: true, error: null };
        }
        return { data: true, error: null };
      },
    },
    {
      workerId: "worker-1",
      merchantIds: ["10000000"],
      handlers: {
        "backup.create": async (event) => ({
          snapshotId: event.payload.snapshotId,
        }),
      },
    },
  );
  assert.equal(summary.completed, 1);
  assert.equal(summary.claimed, 1);
  assert.deepEqual(calls[0]?.args.p_merchant_ids, ["10000000"]);
  assert.deepEqual(calls[0]?.args.p_event_types, ["backup.create"]);
  assert.equal(calls[1]?.name, "faolla_complete_merchant_outbox_v1");
});

test("retryable task errors are rescheduled with safe codes", async () => {
  const failureArgs: Record<string, unknown>[] = [];
  const summary = await processMerchantOutboxBatch(
    {
      rpc: async (name, args) => {
        if (name === "faolla_claim_merchant_outbox_scoped_v1") {
          return { data: [claimedRow()], error: null };
        }
        if (name === "faolla_fail_merchant_outbox_v1") {
          failureArgs.push(args);
          return {
            data: { status: "retry_scheduled" },
            error: null,
          };
        }
        return { data: true, error: null };
      },
    },
    {
      workerId: "worker-1",
      merchantIds: ["10000000"],
      handlers: {
        "backup.create": async () => {
          throw new MerchantOutboxTaskError("storage_temporarily_unavailable", {
            retryable: true,
            retryAfterSeconds: 90,
          });
        },
      },
    },
  );
  assert.equal(summary.retried, 1);
  assert.equal(failureArgs[0]?.p_error_code, "storage_temporarily_unavailable");
  assert.equal(failureArgs[0]?.p_error_message, "storage_temporarily_unavailable");
  assert.equal(failureArgs[0]?.p_retry_after_seconds, 90);
});

test("nonretryable task errors enter the dead letter state", async () => {
  const summary = await processMerchantOutboxBatch(
    {
      rpc: async (name) => {
        if (name === "faolla_claim_merchant_outbox_scoped_v1") {
          return { data: [claimedRow()], error: null };
        }
        if (name === "faolla_fail_merchant_outbox_v1") {
          return { data: { status: "dead_lettered" }, error: null };
        }
        return { data: true, error: null };
      },
    },
    {
      workerId: "worker-1",
      merchantIds: ["10000000"],
      handlers: {
        "backup.create": async () => {
          throw new MerchantOutboxTaskError("invalid_snapshot_reference", {
            retryable: false,
          });
        },
      },
    },
  );
  assert.equal(summary.deadLettered, 1);
});

test("worker reports schema failures without exposing backend errors", async () => {
  const summary = await processMerchantOutboxBatch(
    {
      rpc: async () => ({
        data: null,
        error: { message: "relation does not exist private-data@example.com" },
      }),
    },
    {
      workerId: "worker-1",
      merchantIds: ["10000000"],
      handlers: {
        "backup.create": async () => ({}),
      },
    },
  );
  assert.deepEqual(summary, {
    status: "failed",
    claimed: 0,
    completed: 0,
    retried: 0,
    deadLettered: 0,
    leaseLost: 0,
    malformed: 0,
    errorCode: "outbox_schema_unavailable",
  });
  assert.equal(JSON.stringify(summary).includes("private-data@example.com"), false);
});

test("worker dead-letters malformed claimed rows instead of waiting for lease expiry", async () => {
  const calls: string[] = [];
  const summary = await processMerchantOutboxBatch(
    {
      rpc: async (name) => {
        calls.push(name);
        if (name === "faolla_claim_merchant_outbox_scoped_v1") {
          return {
            data: [claimedRow({ status: "pending" })],
            error: null,
          };
        }
        return { data: { status: "dead_lettered" }, error: null };
      },
    },
    {
      workerId: "worker-1",
      merchantIds: ["10000000"],
      handlers: {
        "backup.create": async () => ({}),
      },
    },
  );
  assert.equal(summary.malformed, 1);
  assert.equal(summary.deadLettered, 1);
  assert.deepEqual(calls, [
    "faolla_claim_merchant_outbox_scoped_v1",
    "faolla_fail_merchant_outbox_v1",
  ]);
});

test("worker rejects empty, wildcard, duplicate, and malformed merchant scopes", async () => {
  const client = {
    rpc: async () => ({ data: [], error: null }),
  };
  for (const merchantIds of [
    [],
    ["*"],
    ["10000000", "10000000"],
    ["10000000", "bad"],
  ]) {
    await assert.rejects(
      () =>
        processMerchantOutboxBatch(client, {
          workerId: "worker-1",
          merchantIds,
          handlers: {
            "backup.create": async () => ({}),
          },
        }),
      /invalid_outbox_worker_merchant_scope/,
    );
  }
});
