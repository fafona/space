import { loadEnvConfig } from "@next/env";

import {
  normalizeMerchantCouponRecords,
  type MerchantCouponRecord,
} from "../src/lib/merchantCoupons";
import type {
  MerchantCouponClaimV1Row,
  MerchantCouponEventV1Row,
  MerchantCouponRedemptionV1Row,
  MerchantCouponV1Row,
} from "../src/lib/merchantCouponReconciliation";

export type CouponRestRuntime = {
  baseUrl: string;
  headers: Record<string, string>;
};

const REQUIRED_MIGRATIONS = [
  202607250001,
  202607250002,
  202607250003,
  202607250004,
  202607250005,
];
const MAX_REST_ROWS = 100000;
const COUPON_SLUG_PREFIX = "__merchant_coupons__:";

export function trimCouponCliText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function createCouponRestRuntime(): CouponRestRuntime {
  loadEnvConfig(process.cwd());
  const baseUrl = trimCouponCliText(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).replace(/\/+$/, "");
  const serviceRoleKey = trimCouponCliText(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
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

export async function requestCouponJson(
  runtime: CouponRestRuntime,
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
      body && typeof body === "object"
        ? trimCouponCliText((body as { code?: unknown }).code)
        : "";
    throw new Error(`${path}:${response.status}:${code || "request_failed"}`);
  }
  return body;
}

async function fetchCouponRows<T>(
  runtime: CouponRestRuntime,
  path: string,
  params: URLSearchParams,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_REST_ROWS; offset += pageSize) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("limit", String(pageSize));
    pageParams.set("offset", String(offset));
    const page = await requestCouponJson(
      runtime,
      `${path}?${pageParams.toString()}`,
    );
    if (!Array.isArray(page)) throw new Error(`${path}:invalid_response`);
    rows.push(...(page as T[]));
    if (page.length < pageSize) return rows;
    if (offset + pageSize >= MAX_REST_ROWS) {
      throw new Error(`${path}:row_limit_exceeded:${MAX_REST_ROWS}`);
    }
  }
  return rows;
}

export async function loadLegacyCoupons(
  runtime: CouponRestRuntime,
  siteId: string,
) {
  const slug = `${COUPON_SLUG_PREFIX}${siteId}`;
  const params = new URLSearchParams({
    select: "id,slug,blocks,updated_at",
    slug: `eq.${slug}`,
  });
  const rows = await fetchCouponRows<{ blocks?: unknown }>(
    runtime,
    "/rest/v1/pages",
    params,
  );
  const map = new Map<string, MerchantCouponRecord>();
  rows.forEach((row) => {
    normalizeMerchantCouponRecords(row.blocks).forEach((coupon) => {
      if (trimCouponCliText(coupon.siteId) !== siteId) return;
      const current = map.get(coupon.id);
      if (
        !current ||
        Date.parse(coupon.updatedAt) >= Date.parse(current.updatedAt)
      ) {
        map.set(coupon.id, coupon);
      }
    });
  });
  return normalizeMerchantCouponRecords([...map.values()]);
}

export async function loadCouponV1(
  runtime: CouponRestRuntime,
  siteId: string,
) {
  const couponParams = new URLSearchParams({
    select:
      "merchant_id,id,code,title,status,discount_type,discount_value,minimum_amount,total_quantity,claimed_count,used_count,starts_at,expires_at,configuration,source_snapshot,created_at,updated_at",
    merchant_id: `eq.${siteId}`,
    order: "created_at.asc",
  });
  const claimParams = new URLSearchParams({
    select:
      "merchant_id,id,coupon_id,customer_id,settlement_type,settlement_code_hash,claim_code_hash,status,customer_snapshot,source_snapshot,claimed_at,valid_until,source_updated_at",
    merchant_id: `eq.${siteId}`,
    order: "claimed_at.asc",
  });
  const redemptionParams = new URLSearchParams({
    select:
      "merchant_id,id,coupon_id,claim_id,customer_id,state,settlement_code_hash,operator_id,note,source_snapshot,redeemed_at,source_updated_at",
    merchant_id: `eq.${siteId}`,
    order: "redeemed_at.asc",
  });
  const eventParams = new URLSearchParams({
    select: "merchant_id,coupon_id,idempotency_key",
    merchant_id: `eq.${siteId}`,
    order: "created_at.asc",
  });
  return Promise.all([
    fetchCouponRows<MerchantCouponV1Row>(
      runtime,
      "/rest/v1/merchant_coupons",
      couponParams,
    ),
    fetchCouponRows<MerchantCouponClaimV1Row>(
      runtime,
      "/rest/v1/merchant_coupon_claims",
      claimParams,
    ),
    fetchCouponRows<MerchantCouponRedemptionV1Row>(
      runtime,
      "/rest/v1/merchant_coupon_redemptions",
      redemptionParams,
    ),
    fetchCouponRows<MerchantCouponEventV1Row>(
      runtime,
      "/rest/v1/merchant_coupon_events",
      eventParams,
    ),
  ]);
}

export async function assertCouponWriteReady(runtime: CouponRestRuntime) {
  const rows = await requestCouponJson(
    runtime,
    "/rest/v1/faolla_schema_migrations?select=version&order=version.asc&limit=100",
  );
  if (!Array.isArray(rows)) throw new Error("migration_registry_invalid");
  const versions = new Set(
    rows
      .map((row) => Number((row as { version?: unknown }).version))
      .filter(Number.isFinite),
  );
  const missing = REQUIRED_MIGRATIONS.filter((version) => !versions.has(version));
  if (missing.length > 0) {
    throw new Error(`required_migrations_missing:${missing.join(",")}`);
  }

  const result = await requestCouponJson(
    runtime,
    "/rest/v1/rpc/faolla_upsert_merchant_coupons_v1",
    {
      method: "POST",
      body: JSON.stringify({ p_mutations: [] }),
    },
  );
  if (Number(result) !== 0) {
    throw new Error("coupon_v1_rpc_readiness_failed");
  }
}
