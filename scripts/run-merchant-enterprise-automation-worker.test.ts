import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantOutboxRpcClient } from "../src/lib/merchantOutboxEnqueue.server";
import type { MerchantOutboxTaskHandler } from "../src/lib/merchantOutboxWorker.server";
import type { OutboxRestRuntime } from "./outbox-v1-runtime";
import {
  discoverMerchantEnterpriseAutomationMerchantIds,
  discoverMerchantEnterpriseInvitationMerchantIds,
  isMerchantEnterpriseAutomationWorkerEnabled,
  isMerchantEnterpriseInvitationWorkerEnabled,
  prepareMerchantEnterpriseInvitationWorkerBeforeReady,
  resolveAutomationWorkerFailureBackoffMs,
  resolveMerchantEnterpriseAutomationWorkerConfig,
  resolveMerchantEnterpriseInvitationWorkerConfig,
  runMerchantEnterpriseAutomationWorker,
  runMerchantEnterpriseInvitationWorker,
  waitForMerchantEnterpriseAutomationWorkerReady,
  waitForMerchantEnterpriseInvitationWorkerReady,
  type MerchantEnterpriseAutomationWorkerConfig,
} from "./run-merchant-enterprise-automation-worker";

const runtime: OutboxRestRuntime = {
  baseUrl: "https://example.supabase.co",
  headers: {},
};

function config(
  overrides: Partial<MerchantEnterpriseAutomationWorkerConfig> = {},
): MerchantEnterpriseAutomationWorkerConfig {
  return {
    enabled: true,
    pollIntervalMs: 1_000,
    failureBackoffInitialMs: 1_000,
    failureBackoffMaxMs: 30_000,
    discoveryLimit: 250,
    merchantScopeLimit: 50,
    batchLimit: 5,
    leaseSeconds: 90,
    taskTimeoutMs: 60_000,
    requestTimeoutMs: 10_000,
    ...overrides,
  };
}

test("enterprise automation worker is disabled unless explicitly enabled", () => {
  assert.equal(isMerchantEnterpriseAutomationWorkerEnabled({}), false);
  assert.equal(
    isMerchantEnterpriseAutomationWorkerEnabled({
      MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: "false",
    }),
    false,
  );
  assert.equal(
    isMerchantEnterpriseAutomationWorkerEnabled({
      MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: " true ",
    }),
    true,
  );
});

test("invitation worker is independently gated and configured", () => {
  assert.equal(isMerchantEnterpriseInvitationWorkerEnabled({}), false);
  assert.equal(
    isMerchantEnterpriseInvitationWorkerEnabled({
      MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: " true ",
    }),
    true,
  );
  const resolved = resolveMerchantEnterpriseInvitationWorkerConfig({
    MERCHANT_ENTERPRISE_INVITATION_WORKER_ENABLED: "true",
    MERCHANT_ENTERPRISE_INVITATION_WORKER_BATCH_LIMIT: "7",
    MERCHANT_ENTERPRISE_INVITATION_WORKER_LEASE_SECONDS: "120",
  });
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.batchLimit, 7);
  assert.equal(resolved.leaseSeconds, 120);
});

test("enabled invitation worker validates secrets, email config, and schema before ready", async () => {
  const order: string[] = [];
  const prepared = await prepareMerchantEnterpriseInvitationWorkerBeforeReady(
    runtime,
    true,
    {
      resolveKeyring: () => {
        order.push("keyring");
        return { activeKeyId: "k1", keys: new Map([["k1", Buffer.alloc(32)]]) };
      },
      resolveEmailConfig: () => {
        order.push("email");
        return {
          apiKey: "re_test",
          from: "invite@faolla.example",
          publicOrigin: "https://faolla.example",
        };
      },
      assertReady: async () => {
        order.push("schema");
      },
    },
  );
  assert.deepEqual(order, ["keyring", "email", "schema"]);
  assert.equal(prepared?.keyring.activeKeyId, "k1");
});

test("disabled invitation worker preserves early-ready behavior without invitation checks", async () => {
  let calls = 0;
  const prepared = await prepareMerchantEnterpriseInvitationWorkerBeforeReady(
    runtime,
    false,
    {
      resolveKeyring: () => {
        calls += 1;
        throw new Error("must_not_run");
      },
      resolveEmailConfig: () => {
        calls += 1;
        throw new Error("must_not_run");
      },
      assertReady: async () => {
        calls += 1;
      },
    },
  );
  assert.equal(prepared, null);
  assert.equal(calls, 0);
});

test("enterprise automation worker configuration is bounded and rejects malformed overrides", () => {
  const resolved = resolveMerchantEnterpriseAutomationWorkerConfig({
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: "true",
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_BATCH_LIMIT: "12",
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_LEASE_SECONDS: "120",
    MERCHANT_ENTERPRISE_AUTOMATION_WORKER_TASK_TIMEOUT_MS: "90000",
  });
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.batchLimit, 12);
  assert.equal(resolved.leaseSeconds, 120);
  assert.equal(resolved.taskTimeoutMs, 90_000);
  assert.throws(
    () =>
      resolveMerchantEnterpriseAutomationWorkerConfig({
        MERCHANT_ENTERPRISE_AUTOMATION_WORKER_BATCH_LIMIT: "51",
      }),
    /merchant_enterprise_automation_worker_batch_limit_invalid/,
  );
  assert.throws(
    () =>
      resolveMerchantEnterpriseAutomationWorkerConfig({
        MERCHANT_ENTERPRISE_AUTOMATION_WORKER_LEASE_SECONDS: "30",
        MERCHANT_ENTERPRISE_AUTOMATION_WORKER_TASK_TIMEOUT_MS: "28000",
      }),
    /merchant_enterprise_automation_worker_task_timeout_ms_invalid/,
  );
});

test("scope discovery uses the fair cursor RPC and never exceeds the claim batch", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const requestJson = async (
    _runtime: OutboxRestRuntime,
    path: string,
    init?: RequestInit,
  ): Promise<unknown> => {
    requests.push({ path, init });
    return [
      { merchant_id: "10000004" },
      { merchant_id: "10000001" },
      { merchant_id: "10000002" },
    ];
  };
  const merchantIds = await discoverMerchantEnterpriseAutomationMerchantIds(
    runtime,
    {
      discoveryLimit: 250,
      merchantScopeLimit: 50,
      batchLimit: 3,
      requestTimeoutMs: 10_000,
    },
    {
      afterMerchantId: "10000003",
      requestJson: requestJson as never,
    },
  );
  assert.deepEqual(merchantIds, ["10000004", "10000001", "10000002"]);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.path,
    "/rest/v1/rpc/faolla_discover_merchant_enterprise_automation_merchants_v1",
  );
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    p_after_merchant_id: "10000003",
    p_limit: 3,
  });
});

test("scope discovery fails closed on malformed merchant rows", async () => {
  await assert.rejects(
    discoverMerchantEnterpriseAutomationMerchantIds(
      runtime,
      {
        discoveryLimit: 10,
        merchantScopeLimit: 10,
        batchLimit: 5,
        requestTimeoutMs: 1_000,
      },
      {
        requestJson: (async () => [{ merchant_id: "*" }]) as never,
      },
    ),
    /automation_outbox_discovery_invalid/,
  );
});

test("invitation discovery uses its dedicated fair cursor RPC", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const merchantIds = await discoverMerchantEnterpriseInvitationMerchantIds(
    runtime,
    {
      discoveryLimit: 250,
      merchantScopeLimit: 50,
      batchLimit: 2,
      requestTimeoutMs: 10_000,
    },
    {
      afterMerchantId: "10000002",
      requestJson: (async (
        _runtime: OutboxRestRuntime,
        path: string,
        init?: RequestInit,
      ) => {
        requests.push({ path, init });
        return [{ merchant_id: "10000003" }, { merchant_id: "10000004" }];
      }) as never,
    },
  );
  assert.deepEqual(merchantIds, ["10000003", "10000004"]);
  assert.equal(
    requests[0]?.path,
    "/rest/v1/rpc/faolla_discover_merchant_enterprise_invitation_merchants_v1",
  );
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    p_after_merchant_id: "10000002",
    p_limit: 2,
  });
});

test("invitation loop claims only invitation events and uses domain settlement", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const settlement = {
    complete: async () => true,
    fail: async () => "dead_lettered" as const,
  };
  await runMerchantEnterpriseInvitationWorker({
    client: { rpc: async () => ({ data: null, error: null }) },
    runtime,
    handler: async () => undefined,
    settlement,
    config: {
      ...config(),
      enabled: true,
    },
    signal: new AbortController().signal,
    workerId: "enterprise-invitation:test",
    dependencies: {
      maxCycles: 1,
      discoverMerchantIds: async () => ["10000001"],
      processBatch: (async (
        _client: MerchantOutboxRpcClient,
        options: Record<string, unknown>,
      ) => {
        calls.push(options);
        return {
          status: "idle",
          claimed: 0,
          completed: 0,
          retried: 0,
          deadLettered: 0,
          leaseLost: 0,
          malformed: 0,
        };
      }) as never,
      sleep: async () => undefined,
      logger: { info() {}, warn() {}, error() {} },
    },
  });
  assert.equal(calls[0]?.claimFunctionName, undefined);
  assert.deepEqual(Object.keys(calls[0]?.handlers as object), [
    "enterprise.employee_invitation.deliver",
  ]);
  assert.equal(
    (calls[0]?.settlements as Record<string, unknown>)[
      "enterprise.employee_invitation.deliver"
    ],
    settlement,
  );
});

test("worker passes discovered tenant scope to the existing scoped batch processor", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const sleeps: number[] = [];
  const controller = new AbortController();
  const handler: MerchantOutboxTaskHandler = async () => ({ ok: true });
  const client = { rpc: async () => ({ data: null }) } as MerchantOutboxRpcClient;
  await runMerchantEnterpriseAutomationWorker({
    client,
    runtime,
    handler,
    config: config(),
    signal: controller.signal,
    workerId: "enterprise-automation:test",
    dependencies: {
      maxCycles: 1,
      discoverMerchantIds: async () => ["10000001", "10000002"],
      processBatch: (async (
        _client: MerchantOutboxRpcClient,
        options: Record<string, unknown>,
      ) => {
        calls.push(options as unknown as Record<string, unknown>);
        return {
          status: "processed",
          claimed: 1,
          completed: 1,
          retried: 0,
          deadLettered: 0,
          leaseLost: 0,
          malformed: 0,
        };
      }) as never,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      logger: { info() {}, warn() {}, error() {} },
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.merchantIds, ["10000001", "10000002"]);
  assert.equal(calls[0]?.limit, 5);
  assert.equal(calls[0]?.leaseSeconds, 90);
  assert.equal(
    calls[0]?.claimFunctionName,
    "faolla_claim_merchant_enterprise_automation_outbox_v1",
  );
  assert.deepEqual(
    Object.keys(calls[0]?.handlers as Record<string, unknown>),
    ["enterprise.workflow_automation.process"],
  );
  assert.deepEqual(sleeps, [1_000]);
});

test("worker advances the discovery cursor between bounded tenant pages", async () => {
  const cursors: Array<string | null | undefined> = [];
  let discoveryCalls = 0;
  await runMerchantEnterpriseAutomationWorker({
    client: { rpc: async () => ({ data: null, error: null }) },
    runtime,
    handler: async () => undefined,
    config: config({ batchLimit: 2, merchantScopeLimit: 50 }),
    signal: new AbortController().signal,
    dependencies: {
      maxCycles: 2,
      discoverMerchantIds: async (_runtime, _config, options) => {
        cursors.push(options?.afterMerchantId);
        discoveryCalls += 1;
        return discoveryCalls === 1
          ? ["10000001", "10000002"]
          : ["10000003", "10000004"];
      },
      processBatch: (async () => ({
        status: "idle",
        claimed: 0,
        completed: 0,
        retried: 0,
        deadLettered: 0,
        leaseLost: 0,
        malformed: 0,
      })) as never,
      sleep: async () => undefined,
      logger: { info() {}, warn() {}, error() {} },
    },
  });
  assert.deepEqual(cursors, [null, "10000002"]);
});

test("worker cycle failures use bounded exponential backoff", () => {
  const workerConfig = config({
    failureBackoffInitialMs: 1_000,
    failureBackoffMaxMs: 5_000,
  });
  assert.equal(resolveAutomationWorkerFailureBackoffMs(1, workerConfig, () => 0), 1_000);
  assert.equal(resolveAutomationWorkerFailureBackoffMs(2, workerConfig, () => 0), 2_000);
  assert.equal(resolveAutomationWorkerFailureBackoffMs(5, workerConfig, () => 0), 5_000);
  assert.equal(resolveAutomationWorkerFailureBackoffMs(2, workerConfig, () => 1), 2_400);
});

test("worker stays online and backs off without claiming until migration readiness succeeds", async () => {
  let checks = 0;
  let claims = 0;
  const delays: number[] = [];
  const ready = await waitForMerchantEnterpriseAutomationWorkerReady(
    runtime,
    config(),
    new AbortController().signal,
    {
      maxChecks: 3,
      assertReady: async () => {
        checks += 1;
        if (checks < 3) throw new Error("automation_migration_not_ready");
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      random: () => 0,
      logger: { info() {}, warn() {}, error() {} },
    },
  );
  if (ready) claims += 1;
  assert.equal(ready, true);
  assert.equal(checks, 3);
  assert.equal(claims, 1);
  assert.deepEqual(delays, [1_000, 2_000]);
});

test("invitation readiness uses its own migration gate and backoff", async () => {
  const sleeps: number[] = [];
  let checks = 0;
  const ready = await waitForMerchantEnterpriseInvitationWorkerReady(
    runtime,
    config(),
    new AbortController().signal,
    {
      maxChecks: 3,
      assertReady: async () => {
        checks += 1;
        if (checks < 3) throw new Error("invitation_migration_not_ready");
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      random: () => 0,
      logger: { info() {}, warn() {}, error() {} },
    },
  );
  assert.equal(ready, true);
  assert.deepEqual(sleeps, [1_000, 2_000]);
});

test("disabled worker refuses to discover or claim", async () => {
  let discovered = false;
  await assert.rejects(
    runMerchantEnterpriseAutomationWorker({
      client: { rpc: async () => ({ data: null }) },
      runtime,
      handler: async () => undefined,
      config: config({ enabled: false }),
      signal: new AbortController().signal,
      dependencies: {
        maxCycles: 1,
        discoverMerchantIds: async () => {
          discovered = true;
          return [];
        },
      },
    }),
    /automation_worker_disabled/,
  );
  assert.equal(discovered, false);
});
