import { loadEnvConfig } from "@next/env";

import type {
  MerchantAccountLedgerV1Row,
  MerchantCustomerV1Row,
} from "../src/lib/merchantMembershipLedgerReconciliation";
import { mergeStoredMerchantMembershipRows } from "../src/lib/merchantMembershipsStore";

export type MembershipLedgerRestRuntime = {
  baseUrl: string;
  headers: Record<string, string>;
};

const REQUIRED_MIGRATIONS = [202607250001, 202607250002, 202607250003];
const MAX_REST_ROWS = 100000;

export function trimCliText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function createMembershipLedgerRestRuntime(): MembershipLedgerRestRuntime {
  loadEnvConfig(process.cwd());
  const baseUrl = trimCliText(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  const serviceRoleKey = trimCliText(process.env.SUPABASE_SERVICE_ROLE_KEY);
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

export async function requestMembershipLedgerJson(
  runtime: MembershipLedgerRestRuntime,
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
        ? trimCliText((body as { code?: unknown }).code)
        : "";
    throw new Error(`${path}:${response.status}:${code || "request_failed"}`);
  }
  return body;
}

async function fetchRows<T>(
  runtime: MembershipLedgerRestRuntime,
  path: string,
  params: URLSearchParams,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_REST_ROWS; offset += pageSize) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("limit", String(pageSize));
    pageParams.set("offset", String(offset));
    const page = await requestMembershipLedgerJson(
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

export async function loadLegacyMemberships(
  runtime: MembershipLedgerRestRuntime,
  siteId: string,
) {
  const params = new URLSearchParams({
    select: "id,slug,blocks,updated_at",
    merchant_id: `eq.${siteId}`,
    slug: `eq.__merchant_memberships__:${siteId}`,
  });
  const rows = await fetchRows<{
    id?: string | number | null;
    slug?: unknown;
    blocks?: unknown;
    updated_at?: unknown;
  }>(runtime, "/rest/v1/pages", params);
  return mergeStoredMerchantMembershipRows(siteId, rows)?.memberships ?? [];
}

export async function loadMembershipLedgerV1(
  runtime: MembershipLedgerRestRuntime,
  siteId: string,
) {
  const customerParams = new URLSearchParams({
    select: "id,merchant_id,legacy_membership_id,member_no,status",
    merchant_id: `eq.${siteId}`,
    order: "created_at.asc",
  });
  const ledgerParams = new URLSearchParams({
    select:
      "id,merchant_id,customer_id,account_type,delta,balance_after,currency,entry_type,reference_type,reference_id,idempotency_key,reverses_entry_id,created_at",
    merchant_id: `eq.${siteId}`,
    order: "created_at.asc",
  });
  return Promise.all([
    fetchRows<MerchantCustomerV1Row>(
      runtime,
      "/rest/v1/merchant_customers",
      customerParams,
    ),
    fetchRows<MerchantAccountLedgerV1Row>(
      runtime,
      "/rest/v1/merchant_account_ledger",
      ledgerParams,
    ),
  ]);
}

export async function assertMembershipLedgerWriteReady(
  runtime: MembershipLedgerRestRuntime,
) {
  const rows = await requestMembershipLedgerJson(
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

  const result = await requestMembershipLedgerJson(
    runtime,
    "/rest/v1/rpc/faolla_upsert_merchant_membership_ledger_v1",
    {
      method: "POST",
      body: JSON.stringify({ p_mutations: [] }),
    },
  );
  if (Number(result) !== 0) {
    throw new Error("membership_ledger_v1_rpc_readiness_failed");
  }
}
