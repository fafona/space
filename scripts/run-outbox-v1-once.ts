import { loadEnvConfig } from "@next/env";

import { createGoogleReviewsSyncOutboxHandler } from "../src/lib/googleReviewsOutbox.server";
import type { MerchantOutboxRpcClient } from "../src/lib/merchantOutboxEnqueue.server";
import { processMerchantOutboxBatch } from "../src/lib/merchantOutboxWorker.server";
import type { GoogleBusinessProfileStoreClient } from "../src/lib/googleBusinessProfileStore";
import { createServerSupabaseServiceClient } from "../src/lib/superAdminServer";
import {
  assertOutboxV1Ready,
  createOutboxRestRuntime,
} from "./outbox-v1-runtime";

export type OutboxWorkerOnceOptions = {
  siteId: string;
  confirmSiteId: string;
  limit: number;
  leaseSeconds: number;
  taskTimeoutMs: number;
};

function parseBoundedInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isFinite(parsed) ||
    String(parsed) !== value ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(`${name}_must_be_between_${minimum}_and_${maximum}`);
  }
  return parsed;
}

export function parseOutboxWorkerOnceOptions(
  args: string[],
): OutboxWorkerOnceOptions {
  const values = new Map<string, string>();
  for (const arg of args) {
    const separator = arg.indexOf("=");
    if (!arg.startsWith("--") || separator < 3) {
      throw new Error(`unknown_argument:${arg}`);
    }
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1).trim();
    if (values.has(name)) throw new Error(`duplicate_argument:${name}`);
    values.set(name, value);
  }
  const allowed = new Set([
    "site",
    "confirm",
    "limit",
    "lease-seconds",
    "task-timeout-ms",
  ]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new Error(`unknown_argument:${name}`);
  }
  const siteId = values.get("site") ?? "";
  const confirmSiteId = values.get("confirm") ?? "";
  if (!/^\d{8}$/.test(siteId)) {
    throw new Error("site_must_be_exact_8_digit_id");
  }
  if (confirmSiteId !== siteId) {
    throw new Error("confirm_must_exactly_match_site");
  }
  return {
    siteId,
    confirmSiteId,
    limit: parseBoundedInteger(values.get("limit") ?? "5", "limit", 1, 20),
    leaseSeconds: parseBoundedInteger(
      values.get("lease-seconds") ?? "90",
      "lease_seconds",
      30,
      300,
    ),
    taskTimeoutMs: parseBoundedInteger(
      values.get("task-timeout-ms") ?? "60000",
      "task_timeout_ms",
      5000,
      240000,
    ),
  };
}

export function isOutboxWorkerExecutionEnabled(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    String(environment.MERCHANT_OUTBOX_V1_WORKER_EXECUTION_ENABLED ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

async function main() {
  const options = parseOutboxWorkerOnceOptions(process.argv.slice(2));
  loadEnvConfig(process.cwd());
  if (!isOutboxWorkerExecutionEnabled()) {
    throw new Error("outbox_worker_execution_disabled");
  }
  const runtime = createOutboxRestRuntime();
  await assertOutboxV1Ready(runtime);
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("supabase_service_env_missing");

  const summary = await processMerchantOutboxBatch(
    client as unknown as MerchantOutboxRpcClient,
    {
      workerId: `google-reviews-once:${process.pid}`,
      merchantIds: [options.siteId],
      limit: options.limit,
      leaseSeconds: options.leaseSeconds,
      taskTimeoutMs: options.taskTimeoutMs,
      handlers: {
        "google.reviews.sync": createGoogleReviewsSyncOutboxHandler(
          client as unknown as GoogleBusinessProfileStoreClient,
        ),
      },
    },
  );
  console.log(
    `[outbox-v1-worker] site=${options.siteId} status=${summary.status} claimed=${summary.claimed} completed=${summary.completed} retried=${summary.retried} dead-letter=${summary.deadLettered} lease-lost=${summary.leaseLost} malformed=${summary.malformed}${summary.errorCode ? ` error=${summary.errorCode}` : ""}`,
  );
  if (summary.status === "failed") process.exitCode = 1;
  else if (summary.deadLettered > 0 || summary.leaseLost > 0 || summary.malformed > 0) {
    process.exitCode = 2;
  }
}

const invokedFile = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (invokedFile.endsWith("/run-outbox-v1-once.ts")) {
  main().catch((error) => {
    console.error(
      `[outbox-v1-worker] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
