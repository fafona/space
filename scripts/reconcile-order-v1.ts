import { loadEnvConfig } from "@next/env";

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

const MAX_REST_ROWS = 100000;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readSiteId() {
  const argument = process.argv.slice(2).find((value) => value.startsWith("--site="));
  const siteId = trimText(argument?.slice("--site=".length));
  if (!/^\d{8}$/.test(siteId)) {
    throw new Error("a single numeric merchant id is required, for example --site=10000000");
  }
  return siteId;
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
    const response = await fetch(`${runtime.baseUrl}${path}?${pageParams.toString()}`, {
      headers: runtime.headers,
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    if (!response.ok) {
      let code = "";
      try {
        code = trimText((JSON.parse(text) as { code?: unknown }).code);
      } catch {
        code = "";
      }
      throw new Error(`${path}:${response.status}:${code || "request_failed"}`);
    }
    const page = (text ? JSON.parse(text) : []) as T[];
    if (!Array.isArray(page)) throw new Error(`${path}:invalid_response`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
    if (offset + pageSize >= MAX_REST_ROWS) {
      throw new Error(`${path}:row_limit_exceeded:${MAX_REST_ROWS}`);
    }
  }
  return rows;
}

async function main() {
  const siteId = readSiteId();
  const runtime = getRuntime();
  const legacyParams = new URLSearchParams({
    select: "id,slug,blocks,updated_at",
    merchant_id: `eq.${siteId}`,
    slug: `like.__merchant_orders__:${siteId}%`,
  });
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

  const [legacyRows, v1Orders, v1Items] = await Promise.all([
    fetchRows<{ id?: string | number | null; slug?: unknown; blocks?: unknown; updated_at?: unknown }>(
      runtime,
      "/rest/v1/pages",
      legacyParams,
    ),
    fetchRows<MerchantOrderV1Row>(runtime, "/rest/v1/merchant_orders", orderParams),
    fetchRows<MerchantOrderItemV1Row>(runtime, "/rest/v1/merchant_order_items", itemParams),
  ]);
  const legacy = mergeStoredMerchantOrdersRows(siteId, legacyRows);
  const report = reconcileMerchantOrderStorage({
    merchantId: siteId,
    legacyOrders: legacy?.orders ?? [],
    v1Orders,
    v1Items,
  });

  console.log(
    `[order-v1-reconcile] merchant=${siteId} legacy=${report.legacyCount} v1=${report.v1Count} matched=${report.matchedCount}`,
  );
  console.log(
    `[order-v1-reconcile] missing=${report.missingInV1.length} unexpected=${report.unexpectedInV1.length} mismatched=${report.mismatches.length}`,
  );
  if (report.missingInV1.length > 0) {
    console.log(`[order-v1-reconcile] missing-order-ids=${report.missingInV1.slice(0, 20).join(",")}`);
  }
  if (report.unexpectedInV1.length > 0) {
    console.log(`[order-v1-reconcile] unexpected-order-ids=${report.unexpectedInV1.slice(0, 20).join(",")}`);
  }
  for (const mismatch of report.mismatches.slice(0, 20)) {
    console.log(`[order-v1-reconcile] mismatch order=${mismatch.orderId} fields=${mismatch.fields.join(",")}`);
  }
  if (!report.isMatch) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[order-v1-reconcile] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
