import { loadEnvConfig } from "@next/env";

import type { MerchantBookingStoredRecord } from "../src/lib/merchantBookings";
import { mergeMerchantBookingPersistenceRecords } from "../src/lib/merchantBookingPersistenceStore";
import type {
  MerchantBookingEventV1Row,
  MerchantBookingV1Row,
} from "../src/lib/merchantBookingReconciliation";

export type BookingRestRuntime = {
  baseUrl: string;
  headers: Record<string, string>;
};

const REQUIRED_MIGRATIONS = [
  202607250001,
  202607250002,
  202607250003,
  202607250004,
];
const MAX_REST_ROWS = 100000;
const BOOKING_PERSISTENCE_MERCHANT_ID = "__faolla_booking_persistence__";
const BOOKING_RECORDS_SLUG = "__merchant_booking_records__:v1";

export function trimBookingCliText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function createBookingRestRuntime(): BookingRestRuntime {
  loadEnvConfig(process.cwd());
  const baseUrl = trimBookingCliText(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).replace(/\/+$/, "");
  const serviceRoleKey = trimBookingCliText(
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

export async function requestBookingJson(
  runtime: BookingRestRuntime,
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
        ? trimBookingCliText((body as { code?: unknown }).code)
        : "";
    throw new Error(`${path}:${response.status}:${code || "request_failed"}`);
  }
  return body;
}

async function fetchBookingRows<T>(
  runtime: BookingRestRuntime,
  path: string,
  params: URLSearchParams,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_REST_ROWS; offset += pageSize) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("limit", String(pageSize));
    pageParams.set("offset", String(offset));
    const page = await requestBookingJson(
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

export async function loadLegacyBookings(
  runtime: BookingRestRuntime,
  siteId: string,
) {
  const params = new URLSearchParams({
    select: "id,slug,blocks,updated_at",
    merchant_id: `eq.${BOOKING_PERSISTENCE_MERCHANT_ID}`,
    slug: `eq.${BOOKING_RECORDS_SLUG}`,
  });
  const rows = await fetchBookingRows<{
    blocks?: unknown;
  }>(runtime, "/rest/v1/pages", params);
  const records = rows.flatMap((row) => {
    if (!row.blocks || typeof row.blocks !== "object" || Array.isArray(row.blocks)) {
      return [];
    }
    const storedRecords = (row.blocks as { records?: unknown }).records;
    return Array.isArray(storedRecords)
      ? (storedRecords as MerchantBookingStoredRecord[])
      : [];
  });
  return mergeMerchantBookingPersistenceRecords([], records).filter(
    (record) => trimBookingCliText(record.siteId) === siteId,
  );
}

export async function loadBookingV1(
  runtime: BookingRestRuntime,
  siteId: string,
) {
  const bookingParams = new URLSearchParams({
    select:
      "merchant_id,id,customer_id,site_name,booking_block_id,booking_viewport,status,store,item,appointment_at_local,title,note,source_snapshot,merchant_touched_at,no_show_marked_at,created_at,updated_at",
    merchant_id: `eq.${siteId}`,
    order: "created_at.asc",
  });
  const eventParams = new URLSearchParams({
    select: "merchant_id,booking_id,idempotency_key",
    merchant_id: `eq.${siteId}`,
    order: "created_at.asc",
  });
  return Promise.all([
    fetchBookingRows<MerchantBookingV1Row>(
      runtime,
      "/rest/v1/merchant_bookings",
      bookingParams,
    ),
    fetchBookingRows<MerchantBookingEventV1Row>(
      runtime,
      "/rest/v1/merchant_booking_events",
      eventParams,
    ),
  ]);
}

export async function assertBookingWriteReady(runtime: BookingRestRuntime) {
  const rows = await requestBookingJson(
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

  const result = await requestBookingJson(
    runtime,
    "/rest/v1/rpc/faolla_upsert_merchant_bookings_v1",
    {
      method: "POST",
      body: JSON.stringify({ p_mutations: [] }),
    },
  );
  if (Number(result) !== 0) {
    throw new Error("booking_v1_rpc_readiness_failed");
  }
}
