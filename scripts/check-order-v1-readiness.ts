import { loadEnvConfig } from "@next/env";

type CheckResult = {
  name: string;
  ready: boolean;
  status: number | null;
  detail: string;
};

const REQUIRED_MIGRATIONS = [202607250001, 202607250002];

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toErrorCode(value: unknown) {
  if (!value || typeof value !== "object") return "";
  return trimText((value as { code?: unknown }).code);
}

function getSupabaseRuntime() {
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

async function request(
  runtime: ReturnType<typeof getSupabaseRuntime>,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${runtime.baseUrl}${path}`, {
    ...init,
    headers: {
      ...runtime.headers,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
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
  return { response, body };
}

async function checkMigrations(runtime: ReturnType<typeof getSupabaseRuntime>): Promise<CheckResult> {
  const { response, body } = await request(
    runtime,
    "/rest/v1/faolla_schema_migrations?select=version,name&order=version.asc&limit=100",
  );
  if (!response.ok) {
    return {
      name: "migration-registry",
      ready: false,
      status: response.status,
      detail: toErrorCode(body) || "unavailable",
    };
  }
  const versions = new Set(
    (Array.isArray(body) ? body : []).map((row) => Number((row as { version?: unknown }).version)),
  );
  const missing = REQUIRED_MIGRATIONS.filter((version) => !versions.has(version));
  return {
    name: "migration-registry",
    ready: missing.length === 0,
    status: response.status,
    detail: missing.length === 0 ? `versions=${REQUIRED_MIGRATIONS.join(",")}` : `missing=${missing.join(",")}`,
  };
}

async function checkTable(
  runtime: ReturnType<typeof getSupabaseRuntime>,
  name: string,
  table: string,
  columns: string,
): Promise<CheckResult> {
  const { response, body } = await request(runtime, `/rest/v1/${table}?select=${columns}&limit=0`);
  return {
    name,
    ready: response.ok,
    status: response.status,
    detail: response.ok ? "available" : toErrorCode(body) || "unavailable",
  };
}

async function checkRpc(runtime: ReturnType<typeof getSupabaseRuntime>): Promise<CheckResult> {
  const { response, body } = await request(runtime, "/rest/v1/rpc/faolla_upsert_merchant_orders_v1", {
    method: "POST",
    body: JSON.stringify({ p_mutations: [] }),
  });
  return {
    name: "order-shadow-rpc",
    ready: response.ok && Number(body) === 0,
    status: response.status,
    detail: response.ok ? `result=${String(body)}` : toErrorCode(body) || "unavailable",
  };
}

async function main() {
  const runtime = getSupabaseRuntime();
  const migration = await checkMigrations(runtime);
  const checks: CheckResult[] = [migration];

  if (migration.ready) {
    checks.push(
      await checkTable(runtime, "orders-table", "merchant_orders", "merchant_id,id"),
      await checkTable(runtime, "order-items-table", "merchant_order_items", "merchant_id,order_id"),
      await checkTable(runtime, "order-events-table", "merchant_order_events", "merchant_id,order_id"),
      await checkRpc(runtime),
    );
  }

  for (const check of checks) {
    console.log(
      `[order-v1-readiness] ${check.ready ? "PASS" : "FAIL"} ${check.name} HTTP ${check.status ?? "-"} ${check.detail}`,
    );
  }
  console.log(
    `[order-v1-readiness] runtime-mode=${trimText(process.env.MERCHANT_ORDER_V1_DUAL_WRITE_MODE) || "off"}`,
  );

  if (!checks.every((check) => check.ready)) {
    console.error(
      "[order-v1-readiness] not ready; apply migrations 202607250001 and 202607250002 before enabling shadow mode",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[order-v1-readiness] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
