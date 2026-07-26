import { loadEnvConfig } from "@next/env";

import {
  normalizeMerchantOutboxHealthSnapshot,
  type MerchantOutboxHealthSnapshot,
} from "../src/lib/merchantOutboxHealth";

export type OutboxRestRuntime = {
  baseUrl: string;
  headers: Record<string, string>;
};

const REQUIRED_MIGRATIONS = [
  202607250001,
  202607250002,
  202607250003,
  202607250004,
  202607250005,
  202607250006,
  202607250007,
  202607250008,
];

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function createOutboxRestRuntime(): OutboxRestRuntime {
  loadEnvConfig(process.cwd());
  const baseUrl = trimText(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  const serviceRoleKey = trimText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !serviceRoleKey) {
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

export async function requestOutboxJson(
  runtime: OutboxRestRuntime,
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
        ? trimText((body as { code?: unknown }).code)
        : "";
    throw new Error(`${path}:${response.status}:${code || "request_failed"}`);
  }
  return body;
}

export async function assertOutboxV1Ready(runtime: OutboxRestRuntime) {
  const rows = await requestOutboxJson(
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
}

export async function loadOutboxV1Health(
  runtime: OutboxRestRuntime,
  options?: {
    merchantId?: string;
    windowHours?: number;
  },
): Promise<MerchantOutboxHealthSnapshot> {
  const body = await requestOutboxJson(
    runtime,
    "/rest/v1/rpc/faolla_get_merchant_outbox_health_v1",
    {
      method: "POST",
      body: JSON.stringify({
        p_merchant_id: options?.merchantId || null,
        p_window_hours: options?.windowHours ?? 24,
      }),
    },
  );
  return normalizeMerchantOutboxHealthSnapshot(body);
}
