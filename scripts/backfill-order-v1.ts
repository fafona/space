import { loadEnvConfig } from "@next/env";

import {
  buildMerchantOrderBackfillPlan,
  MERCHANT_ORDER_BACKFILL_MAX_BATCH_SIZE,
} from "../src/lib/merchantOrderBackfill.server";
import {
  reconcileMerchantOrderStorage,
  type MerchantOrderItemV1Row,
  type MerchantOrderV1Row,
} from "../src/lib/merchantOrderReconciliation";
import { mergeStoredMerchantOrdersRows } from "../src/lib/merchantOrdersStore";

type RestRuntime = {
  baseUrl: string;
  headers: Record<string, string>;
};

type CliOptions = {
  siteId: string;
  batchSize: number;
  write: boolean;
  confirmation: string;
};

const REQUIRED_MIGRATIONS = [202607250001, 202607250002];
const MAX_REST_ROWS = 100000;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptions(): CliOptions {
  const args = process.argv.slice(2);
  const knownArguments = args.filter(
    (value) =>
      value === "--write" ||
      value.startsWith("--site=") ||
      value.startsWith("--batch-size=") ||
      value.startsWith("--confirm="),
  );
  if (knownArguments.length !== args.length) {
    const unknown = args.filter((value) => !knownArguments.includes(value));
    throw new Error(`unknown_arguments:${unknown.join(",")}`);
  }

  const siteId = trimText(args.find((value) => value.startsWith("--site="))?.slice("--site=".length));
  if (!/^\d{8}$/.test(siteId)) {
    throw new Error("a single numeric merchant id is required, for example --site=10000000");
  }

  const batchText = trimText(
    args.find((value) => value.startsWith("--batch-size="))?.slice("--batch-size=".length),
  );
  const batchSize = batchText ? Number.parseInt(batchText, 10) : 10;
  if (
    (batchText && !/^\d+$/.test(batchText)) ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MERCHANT_ORDER_BACKFILL_MAX_BATCH_SIZE
  ) {
    throw new Error(`batch_size_must_be_between_1_and_${MERCHANT_ORDER_BACKFILL_MAX_BATCH_SIZE}`);
  }

  return {
    siteId,
    batchSize,
    write: args.includes("--write"),
    confirmation: trimText(
      args.find((value) => value.startsWith("--confirm="))?.slice("--confirm=".length),
    ),
  };
}

function getRuntime(): RestRuntime {
  loadEnvConfig(process.cwd());
  const baseUrl = trimText(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  const serviceRoleKey = trimText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !serviceRoleKey) throw new Error("supabase_service_env_missing");
  return {
    baseUrl,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  };
}

async function requestJson(
  runtime: RestRuntime,
  path: string,
  init?: RequestInit,
  timeoutMs = 15000,
) {
  const response = await fetch(`${runtime.baseUrl}${path}`, {
    ...init,
    headers: {
      ...runtime.headers,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const code =
      body && typeof body === "object" ? trimText((body as { code?: unknown }).code) : "";
    throw new Error(`${path}:${response.status}:${code || "request_failed"}`);
  }
  return body;
}

async function fetchRows<T>(
  runtime: RestRuntime,
  path: string,
  params: URLSearchParams,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_REST_ROWS; offset += pageSize) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("limit", String(pageSize));
    pageParams.set("offset", String(offset));
    const page = await requestJson(runtime, `${path}?${pageParams.toString()}`);
    if (!Array.isArray(page)) throw new Error(`${path}:invalid_response`);
    rows.push(...(page as T[]));
    if (page.length < pageSize) return rows;
    if (offset + pageSize >= MAX_REST_ROWS) {
      throw new Error(`${path}:row_limit_exceeded:${MAX_REST_ROWS}`);
    }
  }
  return rows;
}

async function loadLegacyOrders(runtime: RestRuntime, siteId: string) {
  const params = new URLSearchParams({
    select: "id,slug,blocks,updated_at",
    merchant_id: `eq.${siteId}`,
    slug: `like.__merchant_orders__:${siteId}%`,
  });
  const rows = await fetchRows<{
    id?: string | number | null;
    slug?: unknown;
    blocks?: unknown;
    updated_at?: unknown;
  }>(runtime, "/rest/v1/pages", params);
  return mergeStoredMerchantOrdersRows(siteId, rows)?.orders ?? [];
}

async function loadV1Orders(runtime: RestRuntime, siteId: string) {
  const orderParams = new URLSearchParams({
    select:
      "merchant_id,id,status,total_quantity,total_amount_minor,print_count,created_at,updated_at,source_snapshot",
    merchant_id: `eq.${siteId}`,
    order: "created_at.desc",
  });
  const itemParams = new URLSearchParams({
    select:
      "merchant_id,order_id,line_number,product_id,code,name,quantity,unit_amount_minor,subtotal_amount_minor",
    merchant_id: `eq.${siteId}`,
    order: "order_id.asc,line_number.asc",
  });
  return Promise.all([
    fetchRows<MerchantOrderV1Row>(runtime, "/rest/v1/merchant_orders", orderParams),
    fetchRows<MerchantOrderItemV1Row>(runtime, "/rest/v1/merchant_order_items", itemParams),
  ]);
}

async function assertWriteReady(runtime: RestRuntime) {
  const rows = await requestJson(
    runtime,
    "/rest/v1/faolla_schema_migrations?select=version&order=version.asc&limit=100",
  );
  if (!Array.isArray(rows)) throw new Error("migration_registry_invalid");
  const versions = new Set(
    rows.map((row) => Number((row as { version?: unknown }).version)).filter(Number.isFinite),
  );
  const missing = REQUIRED_MIGRATIONS.filter((version) => !versions.has(version));
  if (missing.length > 0) throw new Error(`required_migrations_missing:${missing.join(",")}`);

  const result = await requestJson(runtime, "/rest/v1/rpc/faolla_upsert_merchant_orders_v1", {
    method: "POST",
    body: JSON.stringify({ p_mutations: [] }),
  });
  if (Number(result) !== 0) throw new Error("order_v1_rpc_readiness_failed");
}

function assertWriteAuthorized(options: CliOptions) {
  if (!options.write) return;
  if (trimText(process.env.ORDER_V1_BACKFILL_WRITE_ENABLED).toLowerCase() !== "true") {
    throw new Error("write_disabled:set_ORDER_V1_BACKFILL_WRITE_ENABLED=true_for_this_command");
  }
  if (options.confirmation !== options.siteId) {
    throw new Error(`merchant_confirmation_required:--confirm=${options.siteId}`);
  }
}

async function writeBatch(
  runtime: RestRuntime,
  mutations: ReturnType<typeof buildMerchantOrderBackfillPlan>["batches"][number],
) {
  const result = await requestJson(
    runtime,
    "/rest/v1/rpc/faolla_upsert_merchant_orders_v1",
    {
      method: "POST",
      body: JSON.stringify({ p_mutations: mutations }),
    },
    30000,
  );
  if (Number(result) !== mutations.length) {
    throw new Error(`backfill_rpc_count_mismatch:expected=${mutations.length}:actual=${String(result)}`);
  }
}

function printReconciliation(
  siteId: string,
  legacyOrders: Awaited<ReturnType<typeof loadLegacyOrders>>,
  v1Orders: MerchantOrderV1Row[],
  v1Items: MerchantOrderItemV1Row[],
) {
  const report = reconcileMerchantOrderStorage({
    merchantId: siteId,
    legacyOrders,
    v1Orders,
    v1Items,
  });
  console.log(
    `[order-v1-backfill] reconciliation legacy=${report.legacyCount} v1=${report.v1Count} matched=${report.matchedCount} missing=${report.missingInV1.length} unexpected=${report.unexpectedInV1.length} mismatched=${report.mismatches.length}`,
  );
  for (const mismatch of report.mismatches.slice(0, 20)) {
    console.log(`[order-v1-backfill] mismatch order=${mismatch.orderId} fields=${mismatch.fields.join(",")}`);
  }
  if (report.missingInV1.length > 0) {
    console.log(`[order-v1-backfill] missing-order-ids=${report.missingInV1.slice(0, 20).join(",")}`);
  }
  if (report.unexpectedInV1.length > 0) {
    console.log(`[order-v1-backfill] unexpected-order-ids=${report.unexpectedInV1.slice(0, 20).join(",")}`);
  }
  return report.isMatch;
}

async function main() {
  const options = readOptions();
  const runtime = getRuntime();
  assertWriteAuthorized(options);

  const legacyOrders = await loadLegacyOrders(runtime, options.siteId);
  const plan = buildMerchantOrderBackfillPlan({
    merchantId: options.siteId,
    orders: legacyOrders,
    batchSize: options.batchSize,
  });
  console.log(
    `[order-v1-backfill] merchant=${options.siteId} mode=${options.write ? "write" : "dry-run"} orders=${plan.orderCount} batches=${plan.batches.length} batch-size=${plan.batchSize} blockers=${plan.blockers.length}`,
  );

  if (plan.blockers.length > 0) {
    for (const blocker of plan.blockers.slice(0, 20)) {
      console.error(`[order-v1-backfill] blocker order=${blocker.orderId} code=${blocker.code}`);
    }
    process.exitCode = 2;
    return;
  }

  if (!options.write) {
    console.log("[order-v1-backfill] dry-run complete; no database writes were attempted");
    return;
  }

  await assertWriteReady(runtime);
  let completed = 0;
  for (let index = 0; index < plan.batches.length; index += 1) {
    const batch = plan.batches[index] ?? [];
    await writeBatch(runtime, batch);
    completed += batch.length;
    console.log(
      `[order-v1-backfill] progress batch=${index + 1}/${plan.batches.length} orders=${completed}/${plan.orderCount}`,
    );
  }

  const [latestLegacyOrders, [v1Orders, v1Items]] = await Promise.all([
    loadLegacyOrders(runtime, options.siteId),
    loadV1Orders(runtime, options.siteId),
  ]);
  if (!printReconciliation(options.siteId, latestLegacyOrders, v1Orders, v1Items)) {
    process.exitCode = 2;
    return;
  }
  console.log("[order-v1-backfill] complete; legacy remains the source of truth");
}

main().catch((error) => {
  console.error(`[order-v1-backfill] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
