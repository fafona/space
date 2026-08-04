import { hostname } from "node:os";

import { loadEnvConfig } from "@next/env";

import type { MerchantOutboxRpcClient } from "../src/lib/merchantOutboxEnqueue.server";
import {
  isMerchantEnterpriseAutomationWorkerEnabled,
  MERCHANT_ENTERPRISE_AUTOMATION_OUTBOX_EVENT_TYPE,
} from "../src/lib/merchantEnterpriseAutomation.server";
import {
  MerchantOutboxTaskError,
  processMerchantOutboxBatch,
  type MerchantOutboxTaskHandler,
} from "../src/lib/merchantOutboxWorker.server";
import { createMerchantEnterpriseAutomationOutboxHandler } from "../src/lib/merchantEnterpriseAutomationWorker.server";
import { createServerSupabaseServiceClient } from "../src/lib/superAdminServer";
import {
  assertOutboxV1Ready,
  requestOutboxJson,
  type OutboxRestRuntime,
} from "./outbox-v1-runtime";

export {
  isMerchantEnterpriseAutomationWorkerEnabled,
  MERCHANT_ENTERPRISE_AUTOMATION_OUTBOX_EVENT_TYPE,
};

const AUTOMATION_MIGRATION_VERSION = 202608040026;
const AUTOMATION_DISCOVERY_RPC =
  "/rest/v1/rpc/faolla_discover_merchant_enterprise_automation_merchants_v1";
const AUTOMATION_CLAIM_RPC =
  "faolla_claim_merchant_enterprise_automation_outbox_v1";

export type MerchantEnterpriseAutomationWorkerConfig = {
  enabled: boolean;
  pollIntervalMs: number;
  failureBackoffInitialMs: number;
  failureBackoffMaxMs: number;
  discoveryLimit: number;
  merchantScopeLimit: number;
  batchLimit: number;
  leaseSeconds: number;
  taskTimeoutMs: number;
  requestTimeoutMs: number;
};

type AutomationWorkerLogger = Pick<Console, "info" | "warn" | "error">;

type AutomationWorkerDependencies = {
  discoverMerchantIds?: typeof discoverMerchantEnterpriseAutomationMerchantIds;
  processBatch?: typeof processMerchantOutboxBatch;
  sleep?: typeof sleepWithSignal;
  random?: () => number;
  logger?: AutomationWorkerLogger;
  maxCycles?: number;
};

type AutomationWorkerReadinessDependencies = {
  assertReady?: typeof assertMerchantEnterpriseAutomationWorkerReady;
  sleep?: typeof sleepWithSignal;
  random?: () => number;
  logger?: AutomationWorkerLogger;
  maxChecks?: number;
};

type RunAutomationWorkerInput = {
  client: MerchantOutboxRpcClient;
  runtime: OutboxRestRuntime;
  handler: MerchantOutboxTaskHandler;
  config: MerchantEnterpriseAutomationWorkerConfig;
  signal: AbortSignal;
  workerId?: string;
  dependencies?: AutomationWorkerDependencies;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readBoundedInteger(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = trimText(environment[name]);
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name.toLowerCase()}_invalid`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name.toLowerCase()}_invalid`);
  }
  return parsed;
}

export function resolveMerchantEnterpriseAutomationWorkerConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantEnterpriseAutomationWorkerConfig {
  const leaseSeconds = readBoundedInteger(
    environment,
    "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_LEASE_SECONDS",
    90,
    15,
    900,
  );
  const taskTimeoutMs = readBoundedInteger(
    environment,
    "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_TASK_TIMEOUT_MS",
    60_000,
    1_000,
    leaseSeconds * 900,
  );
  const failureBackoffInitialMs = readBoundedInteger(
    environment,
    "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_FAILURE_BACKOFF_INITIAL_MS",
    1_000,
    100,
    60_000,
  );
  const failureBackoffMaxMs = readBoundedInteger(
    environment,
    "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_FAILURE_BACKOFF_MAX_MS",
    30_000,
    failureBackoffInitialMs,
    300_000,
  );
  return {
    enabled: isMerchantEnterpriseAutomationWorkerEnabled(environment),
    pollIntervalMs: readBoundedInteger(
      environment,
      "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_POLL_INTERVAL_MS",
      1_000,
      100,
      60_000,
    ),
    failureBackoffInitialMs,
    failureBackoffMaxMs,
    discoveryLimit: readBoundedInteger(
      environment,
      "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_DISCOVERY_LIMIT",
      250,
      1,
      1_000,
    ),
    merchantScopeLimit: readBoundedInteger(
      environment,
      "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_MERCHANT_SCOPE_LIMIT",
      50,
      1,
      50,
    ),
    batchLimit: readBoundedInteger(
      environment,
      "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_BATCH_LIMIT",
      5,
      1,
      50,
    ),
    leaseSeconds,
    taskTimeoutMs,
    requestTimeoutMs: readBoundedInteger(
      environment,
      "MERCHANT_ENTERPRISE_AUTOMATION_WORKER_REQUEST_TIMEOUT_MS",
      10_000,
      1_000,
      60_000,
    ),
  };
}

export function createMerchantEnterpriseAutomationWorkerRestRuntime(
  environment: Record<string, string | undefined> = process.env,
): OutboxRestRuntime {
  const baseUrl = (
    trimText(environment.SUPABASE_INTERNAL_URL) ||
    trimText(environment.NEXT_PUBLIC_SUPABASE_URL)
  ).replace(/\/+$/, "");
  const serviceRoleKey =
    trimText(environment.SUPABASE_SERVICE_ROLE_KEY) ||
    trimText(environment.NEXT_SUPABASE_SERVICE_ROLE_KEY);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("supabase_service_env_missing");
  }
  if (
    !serviceRoleKey ||
    !["http:", "https:"].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new Error("supabase_service_env_missing");
  }
  return {
    baseUrl,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  };
}

function readMerchantIds(rows: unknown, maximum: number) {
  if (!Array.isArray(rows)) throw new Error("automation_outbox_discovery_invalid");
  const merchantIds = rows.map((row) => {
    const merchantId =
      row && typeof row === "object"
        ? trimText((row as { merchant_id?: unknown }).merchant_id)
        : "";
    if (!/^\d{8}$/.test(merchantId)) {
      throw new Error("automation_outbox_discovery_invalid");
    }
    return merchantId;
  });
  if (
    merchantIds.length > maximum ||
    new Set(merchantIds).size !== merchantIds.length
  ) {
    throw new Error("automation_outbox_discovery_invalid");
  }
  return merchantIds;
}

export async function discoverMerchantEnterpriseAutomationMerchantIds(
  runtime: OutboxRestRuntime,
  config: Pick<
    MerchantEnterpriseAutomationWorkerConfig,
    | "discoveryLimit"
    | "merchantScopeLimit"
    | "batchLimit"
    | "requestTimeoutMs"
  >,
  options: {
    afterMerchantId?: string | null;
    requestJson?: typeof requestOutboxJson;
  } = {},
) {
  const afterMerchantId = options.afterMerchantId ?? null;
  if (afterMerchantId !== null && !/^\d{8}$/.test(afterMerchantId)) {
    throw new Error("automation_outbox_discovery_invalid");
  }
  const requestJson = options.requestJson ?? requestOutboxJson;
  // Keep the discovered scope no larger than the claim batch. The dedicated
  // claim RPC takes one event per merchant before a second round, so every
  // merchant returned by this cursor page receives a bounded claim chance.
  const limit = Math.min(
    config.discoveryLimit,
    config.merchantScopeLimit,
    config.batchLimit,
  );
  const rows = await requestJson(
    runtime,
    AUTOMATION_DISCOVERY_RPC,
    {
      method: "POST",
      body: JSON.stringify({
        p_after_merchant_id: afterMerchantId,
        p_limit: limit,
      }),
    },
    config.requestTimeoutMs,
  );
  return readMerchantIds(rows, limit);
}

export async function assertMerchantEnterpriseAutomationWorkerReady(
  runtime: OutboxRestRuntime,
) {
  await assertOutboxV1Ready(runtime);
  const rows = await requestOutboxJson(
    runtime,
    `/rest/v1/faolla_schema_migrations?select=version&version=eq.${AUTOMATION_MIGRATION_VERSION}&limit=1`,
  );
  if (
    !Array.isArray(rows) ||
    Number((rows[0] as { version?: unknown } | undefined)?.version) !==
      AUTOMATION_MIGRATION_VERSION
  ) {
    throw new Error("automation_migration_not_ready");
  }
}

function safeErrorCode(error: unknown) {
  const raw = error instanceof Error ? error.message : "worker_cycle_failed";
  const normalized = raw.trim().toLowerCase();
  return /^[a-z][a-z0-9_:-]{0,119}$/.test(normalized)
    ? normalized
    : "worker_cycle_failed";
}

function buildWorkerId() {
  const host = hostname()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 60);
  return `enterprise-automation:${host || "host"}:${process.pid}`;
}

export function resolveAutomationWorkerFailureBackoffMs(
  consecutiveFailures: number,
  config: Pick<
    MerchantEnterpriseAutomationWorkerConfig,
    "failureBackoffInitialMs" | "failureBackoffMaxMs"
  >,
  random: () => number = Math.random,
) {
  const exponent = Math.min(10, Math.max(0, consecutiveFailures - 1));
  const base = Math.min(
    config.failureBackoffMaxMs,
    config.failureBackoffInitialMs * 2 ** exponent,
  );
  const jitter = Math.floor(base * 0.2 * Math.max(0, Math.min(1, random())));
  return Math.min(config.failureBackoffMaxMs, base + jitter);
}

export function sleepWithSignal(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted || milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

function withShutdownSignal(
  handler: MerchantOutboxTaskHandler,
  workerSignal: AbortSignal,
): MerchantOutboxTaskHandler {
  return async (event, context) => {
    if (workerSignal.aborted) {
      throw new MerchantOutboxTaskError("worker_stopping", {
        retryable: true,
        retryAfterSeconds: 5,
      });
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.signal.addEventListener("abort", abort, { once: true });
    workerSignal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted || workerSignal.aborted) controller.abort();
    try {
      return await handler(event, { ...context, signal: controller.signal });
    } finally {
      context.signal.removeEventListener("abort", abort);
      workerSignal.removeEventListener("abort", abort);
    }
  };
}

export async function waitForMerchantEnterpriseAutomationWorkerReady(
  runtime: OutboxRestRuntime,
  config: Pick<
    MerchantEnterpriseAutomationWorkerConfig,
    "failureBackoffInitialMs" | "failureBackoffMaxMs"
  >,
  signal: AbortSignal,
  dependencies: AutomationWorkerReadinessDependencies = {},
) {
  const assertReady =
    dependencies.assertReady ?? assertMerchantEnterpriseAutomationWorkerReady;
  const sleep = dependencies.sleep ?? sleepWithSignal;
  const random = dependencies.random ?? Math.random;
  const logger = dependencies.logger ?? console;
  let failures = 0;
  let checks = 0;
  while (!signal.aborted) {
    if (dependencies.maxChecks !== undefined && checks >= dependencies.maxChecks) {
      return false;
    }
    checks += 1;
    try {
      await assertReady(runtime);
      logger.info("[enterprise-automation-worker] schema-ready");
      return true;
    } catch (error) {
      if (signal.aborted) break;
      failures += 1;
      const delay = resolveAutomationWorkerFailureBackoffMs(
        failures,
        config,
        random,
      );
      logger.warn(
        `[enterprise-automation-worker] schema-wait code=${safeErrorCode(error)} retry-ms=${delay}`,
      );
      await sleep(delay, signal);
    }
  }
  return false;
}

export async function runMerchantEnterpriseAutomationWorker(
  input: RunAutomationWorkerInput,
) {
  if (!input.config.enabled) throw new Error("automation_worker_disabled");
  const dependencies = input.dependencies ?? {};
  const discoverMerchantIds =
    dependencies.discoverMerchantIds ??
    discoverMerchantEnterpriseAutomationMerchantIds;
  const processBatch = dependencies.processBatch ?? processMerchantOutboxBatch;
  const sleep = dependencies.sleep ?? sleepWithSignal;
  const random = dependencies.random ?? Math.random;
  const logger = dependencies.logger ?? console;
  const workerId = input.workerId ?? buildWorkerId();
  const handler = withShutdownSignal(input.handler, input.signal);
  let consecutiveFailures = 0;
  let cycles = 0;
  let discoveryCursor: string | null = null;

  while (!input.signal.aborted) {
    if (dependencies.maxCycles !== undefined && cycles >= dependencies.maxCycles) {
      break;
    }
    cycles += 1;
    try {
      const merchantIds = await discoverMerchantIds(input.runtime, input.config, {
        afterMerchantId: discoveryCursor,
      });
      if (input.signal.aborted) break;
      if (merchantIds.length === 0) {
        consecutiveFailures = 0;
        await sleep(input.config.pollIntervalMs, input.signal);
        continue;
      }
      discoveryCursor = merchantIds[merchantIds.length - 1] ?? discoveryCursor;
      const summary = await processBatch(input.client, {
        workerId,
        merchantIds,
        limit: input.config.batchLimit,
        leaseSeconds: input.config.leaseSeconds,
        taskTimeoutMs: input.config.taskTimeoutMs,
        claimFunctionName: AUTOMATION_CLAIM_RPC,
        handlers: {
          [MERCHANT_ENTERPRISE_AUTOMATION_OUTBOX_EVENT_TYPE]: handler,
        },
      });
      if (summary.status === "failed") {
        throw new Error(summary.errorCode || "outbox_batch_failed");
      }
      consecutiveFailures = 0;
      logger.info(
        `[enterprise-automation-worker] status=${summary.status} scope=${merchantIds.length} claimed=${summary.claimed} completed=${summary.completed} retried=${summary.retried} dead-letter=${summary.deadLettered} lease-lost=${summary.leaseLost} malformed=${summary.malformed}`,
      );
      await sleep(input.config.pollIntervalMs, input.signal);
    } catch (error) {
      if (input.signal.aborted) break;
      consecutiveFailures += 1;
      const delay = resolveAutomationWorkerFailureBackoffMs(
        consecutiveFailures,
        input.config,
        random,
      );
      logger.error(
        `[enterprise-automation-worker] cycle-failed code=${safeErrorCode(error)} retry-ms=${delay}`,
      );
      await sleep(delay, input.signal);
    }
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  const config = resolveMerchantEnterpriseAutomationWorkerConfig();
  if (!config.enabled) throw new Error("automation_worker_disabled");
  const runtime = createMerchantEnterpriseAutomationWorkerRestRuntime();
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("supabase_service_env_missing");
  const controller = new AbortController();
  const requestShutdown = (signal: string) => {
    console.info(`[enterprise-automation-worker] draining signal=${signal}`);
    controller.abort();
  };
  const onSigterm = () => requestShutdown("SIGTERM");
  const onSigint = () => requestShutdown("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  if (typeof process.send === "function") process.send("ready");
  console.info("[enterprise-automation-worker] online");
  try {
    const ready = await waitForMerchantEnterpriseAutomationWorkerReady(
      runtime,
      config,
      controller.signal,
    );
    if (!ready) return;
    await runMerchantEnterpriseAutomationWorker({
      client: client as unknown as MerchantOutboxRpcClient,
      runtime,
      handler: createMerchantEnterpriseAutomationOutboxHandler(
        client as unknown as MerchantOutboxRpcClient,
      ),
      config,
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGINT", onSigint);
  }
}

const invokedFile = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (invokedFile.endsWith("/run-merchant-enterprise-automation-worker.ts")) {
  main().catch((error) => {
    console.error(
      `[enterprise-automation-worker] failed code=${safeErrorCode(error)}`,
    );
    process.exitCode = 1;
  });
}
