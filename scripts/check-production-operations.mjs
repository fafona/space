import { readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BOOKING_PERSISTENCE_MERCHANT_ID,
  summarizeBookingPersistenceMetadataRows,
} from "./booking-persistence-contract.mjs";
import { runProductionSmoke } from "./check-production-smoke.mjs";

const DEFAULT_ORIGIN = "https://faolla.com";
const DEFAULT_SMOKE_PATHS = ["/", "/login", "/10909094", "/admin"];
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_OLDEST_DUE_AGE_SECONDS = 300;
const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("./supabase-migrations/", import.meta.url),
);

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInteger(value, fallback, maximum = 120_000) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(maximum, numeric);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function responseErrorCode(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  return trimText(body.code) || trimText(body.error_code) || "";
}

function parseResponseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

class OperationsRequestError extends Error {
  constructor(label, status, code) {
    super(`${label}:${status || "network"}:${code || "request_failed"}`);
    this.name = "OperationsRequestError";
    this.status = status;
    this.code = code;
  }
}

function safeFailure(error) {
  if (error instanceof OperationsRequestError) {
    return {
      error: error.code || "request_failed",
      httpStatus: error.status || null,
    };
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timeout|abort/i.test(message)) return { error: "request_timeout", httpStatus: null };
  if (/fetch|network|socket|connect/i.test(message)) return { error: "network_error", httpStatus: null };
  return { error: "unexpected_check_failure", httpStatus: null };
}

function shouldRetryStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

export async function requestOperationsJson({
  fetchImpl = fetch,
  label,
  url,
  init,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = 750,
}) {
  let lastError = null;
  const boundedAttempts = normalizePositiveInteger(attempts, DEFAULT_ATTEMPTS, 5);
  const boundedTimeoutMs = normalizePositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(boundedTimeoutMs),
      });
      const text = await response.text();
      const body = parseResponseBody(text);
      if (response.ok) {
        return {
          body,
          headers: response.headers,
          status: response.status,
        };
      }
      const error = new OperationsRequestError(
        label,
        response.status,
        responseErrorCode(body),
      );
      lastError = error;
      if (!shouldRetryStatus(response.status) || attempt >= boundedAttempts) throw error;
    } catch (error) {
      lastError = error;
      if (
        error instanceof OperationsRequestError &&
        !shouldRetryStatus(error.status)
      ) {
        throw error;
      }
      if (attempt >= boundedAttempts) throw error;
    }
    await delay(retryDelayMs * attempt);
  }

  throw lastError ?? new OperationsRequestError(label, null, "request_failed");
}

export function discoverRequiredMigrationVersions(
  migrationsDirectory = MIGRATIONS_DIRECTORY,
) {
  return readdirSync(migrationsDirectory)
    .map((fileName) => fileName.match(/^(\d{12})_.+\.sql$/)?.[1] ?? "")
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
}

function normalizeSupabaseUrl(value) {
  const normalized = trimText(value).replace(/\/+$/, "");
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    return parsed.origin;
  } catch {
    return "";
  }
}

function buildSupabaseHeaders(key, additional = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...additional,
  };
}

function parseContentRangeCount(value) {
  const matched = trimText(value).match(/\/(\d+)$/);
  return matched ? Number(matched[1]) : null;
}

function toCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function evaluateOutboxHealth(body, maximumOldestDueAgeSeconds) {
  const record =
    body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const snapshot = {
    pendingCount: toCount(record.pending_count),
    retryScheduledCount: toCount(record.retry_scheduled_count),
    processingCount: toCount(record.processing_count),
    deadLetterCount: toCount(record.dead_letter_count),
    expiredLeaseCount: toCount(record.expired_lease_count),
    attemptLimitRiskCount: toCount(record.attempt_limit_risk_count),
    unknownEventTypeCount: toCount(record.unknown_event_type_count),
    oldestDueAgeSeconds: toCount(record.oldest_due_age_seconds),
    retryAttemptsInWindow: toCount(record.retry_attempts_in_window),
    leaseExpiredAttemptsInWindow: toCount(record.lease_expired_attempts_in_window),
  };
  const blockers = [];
  const warnings = [];
  if (snapshot.expiredLeaseCount > 0) blockers.push("expired_leases");
  if (snapshot.deadLetterCount > 0) blockers.push("dead_letters");
  if (snapshot.unknownEventTypeCount > 0) blockers.push("unknown_event_types");
  if (snapshot.oldestDueAgeSeconds > maximumOldestDueAgeSeconds) {
    blockers.push("oldest_due_age_exceeded");
  }
  if (snapshot.attemptLimitRiskCount > 0) warnings.push("attempt_limit_risk");
  if (snapshot.retryAttemptsInWindow > 0) warnings.push("recent_retries");
  if (snapshot.leaseExpiredAttemptsInWindow > 0) warnings.push("recent_lease_expiry");
  return { snapshot, blockers, warnings };
}

async function checkPublicSite(options) {
  const startedAt = Date.now();
  const smoke = await options.runSmoke({
    origin: options.origin,
    paths: options.smokePaths,
    attempts: options.smokeAttempts,
    delayMs: 1_000,
    timeoutMs: options.timeoutMs,
    dynamicChunkLimit: 60,
    logger: {
      log() {},
      warn() {},
    },
  });
  return {
    name: "public_site",
    status: "healthy",
    durationMs: Date.now() - startedAt,
    buildId: smoke.buildId,
    pagesChecked: smoke.pagesChecked,
    assetsChecked: smoke.assetsChecked,
  };
}

async function checkSupabaseAuth(options) {
  await requestOperationsJson({
    fetchImpl: options.fetchImpl,
    label: "supabase_auth",
    url: `${options.supabaseUrl}/auth/v1/settings`,
    init: {
      headers: {
        apikey: options.anonKey,
      },
    },
    attempts: options.requestAttempts,
    timeoutMs: options.timeoutMs,
  });
  return {
    name: "supabase_auth",
    status: "healthy",
  };
}

async function checkLegacyPages(options) {
  const result = await requestOperationsJson({
    fetchImpl: options.fetchImpl,
    label: "legacy_pages",
    url: `${options.supabaseUrl}/rest/v1/pages?select=id&limit=1`,
    init: {
      headers: buildSupabaseHeaders(options.serviceRoleKey, {
        Prefer: "count=exact",
        Range: "0-0",
      }),
    },
    attempts: options.requestAttempts,
    timeoutMs: options.timeoutMs,
  });
  if (!Array.isArray(result.body)) {
    throw new OperationsRequestError("legacy_pages", 200, "invalid_response");
  }
  return {
    name: "legacy_pages",
    status: "healthy",
    rowCount: parseContentRangeCount(result.headers.get("content-range")),
  };
}

async function checkBookingPersistence(options) {
  const params = new URLSearchParams({
    select: "slug,updated_at",
    merchant_id: `eq.${BOOKING_PERSISTENCE_MERCHANT_ID}`,
  });
  const result = await requestOperationsJson({
    fetchImpl: options.fetchImpl,
    label: "booking_persistence",
    url: `${options.supabaseUrl}/rest/v1/pages?${params}`,
    init: {
      headers: buildSupabaseHeaders(options.serviceRoleKey),
    },
    attempts: options.requestAttempts,
    timeoutMs: options.timeoutMs,
  });
  const summary = summarizeBookingPersistenceMetadataRows(result.body);
  if (!summary.complete) {
    return {
      name: "booking_persistence",
      status: "critical",
      error: "required_store_missing",
      stores: summary.stores,
    };
  }
  return {
    name: "booking_persistence",
    status: "healthy",
    stores: summary.stores,
  };
}

async function checkV1Migrations(options) {
  const requiredVersions = discoverRequiredMigrationVersions(
    options.migrationsDirectory,
  );
  let result;
  try {
    result = await requestOperationsJson({
      fetchImpl: options.fetchImpl,
      label: "v1_migrations",
      url:
        `${options.supabaseUrl}/rest/v1/faolla_schema_migrations` +
        "?select=version&order=version.asc&limit=100",
      init: {
        headers: buildSupabaseHeaders(options.serviceRoleKey),
      },
      attempts: options.requestAttempts,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    const missingRegistry =
      error instanceof OperationsRequestError &&
      error.status === 404 &&
      ["PGRST205", "42P01", "request_failed"].includes(error.code);
    if (missingRegistry) {
      return {
        name: "v1_migrations",
        status: options.requireV1Ready ? "critical" : "not_ready",
        registryAvailable: false,
        requiredCount: requiredVersions.length,
        appliedCount: 0,
        missingVersions: requiredVersions,
      };
    }
    throw error;
  }
  if (!Array.isArray(result.body)) {
    throw new OperationsRequestError("v1_migrations", 200, "invalid_response");
  }
  const appliedVersions = new Set(
    result.body
      .map((row) => Number(row?.version))
      .filter(Number.isFinite),
  );
  const missingVersions = requiredVersions.filter(
    (version) => !appliedVersions.has(version),
  );
  return {
    name: "v1_migrations",
    status:
      missingVersions.length === 0
        ? "healthy"
        : options.requireV1Ready
          ? "critical"
          : "not_ready",
    registryAvailable: true,
    requiredCount: requiredVersions.length,
    appliedCount: requiredVersions.length - missingVersions.length,
    missingVersions,
  };
}

async function checkOutbox(options) {
  const result = await requestOperationsJson({
    fetchImpl: options.fetchImpl,
    label: "outbox_v1",
    url: `${options.supabaseUrl}/rest/v1/rpc/faolla_get_merchant_outbox_health_v1`,
    init: {
      method: "POST",
      headers: buildSupabaseHeaders(options.serviceRoleKey, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        p_merchant_id: null,
        p_window_hours: 24,
      }),
    },
    attempts: options.requestAttempts,
    timeoutMs: options.timeoutMs,
  });
  const evaluation = evaluateOutboxHealth(
    result.body,
    options.maximumOldestDueAgeSeconds,
  );
  return {
    name: "outbox_v1",
    status:
      evaluation.blockers.length > 0
        ? "critical"
        : evaluation.warnings.length > 0
          ? "warning"
          : "healthy",
    blockers: evaluation.blockers,
    warnings: evaluation.warnings,
    ...evaluation.snapshot,
  };
}

async function runBoundedCheck(name, critical, callback) {
  const startedAt = Date.now();
  try {
    const result = await callback();
    return {
      ...result,
      durationMs: result.durationMs ?? Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name,
      status: critical ? "critical" : "warning",
      durationMs: Date.now() - startedAt,
      ...safeFailure(error),
    };
  }
}

function overallStatus(checks) {
  if (checks.some((check) => check.status === "critical")) return "critical";
  if (
    checks.some(
      (check) => check.status === "warning" || check.status === "not_ready",
    )
  ) {
    return "degraded";
  }
  return "healthy";
}

export async function runProductionOperationsCheck(input = {}) {
  const origin = trimText(input.origin || DEFAULT_ORIGIN).replace(/\/+$/, "");
  const supabaseUrl = normalizeSupabaseUrl(
    input.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const anonKey = trimText(
    input.anonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const serviceRoleKey = trimText(
    input.serviceRoleKey ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY,
  );
  const requireV1Ready = input.requireV1Ready === true;
  const baseOptions = {
    origin,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    fetchImpl: input.fetchImpl ?? fetch,
    runSmoke: input.runSmoke ?? runProductionSmoke,
    timeoutMs: normalizePositiveInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS),
    requestAttempts: normalizePositiveInteger(
      input.requestAttempts,
      DEFAULT_ATTEMPTS,
      5,
    ),
    smokeAttempts: normalizePositiveInteger(input.smokeAttempts, 2, 4),
    smokePaths: input.smokePaths ?? DEFAULT_SMOKE_PATHS,
    requireV1Ready,
    migrationsDirectory: input.migrationsDirectory ?? MIGRATIONS_DIRECTORY,
    maximumOldestDueAgeSeconds: normalizePositiveInteger(
      input.maximumOldestDueAgeSeconds,
      DEFAULT_OLDEST_DUE_AGE_SECONDS,
      86_400,
    ),
  };

  const checks = [];
  checks.push(
    await runBoundedCheck("public_site", true, () =>
      checkPublicSite(baseOptions),
    ),
  );

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    checks.push({
      name: "supabase_environment",
      status: "critical",
      error: "required_environment_missing",
      durationMs: 0,
    });
  } else {
    const [auth, pages, booking, migrations] = await Promise.all([
      runBoundedCheck("supabase_auth", true, () =>
        checkSupabaseAuth(baseOptions),
      ),
      runBoundedCheck("legacy_pages", true, () =>
        checkLegacyPages(baseOptions),
      ),
      runBoundedCheck("booking_persistence", true, () =>
        checkBookingPersistence(baseOptions),
      ),
      runBoundedCheck("v1_migrations", requireV1Ready, () =>
        checkV1Migrations(baseOptions),
      ),
    ]);
    checks.push(auth, pages, booking, migrations);
    if (migrations.status === "healthy") {
      checks.push(
        await runBoundedCheck("outbox_v1", true, () =>
          checkOutbox(baseOptions),
        ),
      );
    } else {
      checks.push({
        name: "outbox_v1",
        status: "not_ready",
        error: "v1_migrations_not_ready",
        durationMs: 0,
      });
    }
  }

  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    origin,
    status: overallStatus(checks),
    checks,
  };
}

function readArgument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((entry) => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function printSummary(report) {
  console.log(
    `[production-operations] ${report.status.toUpperCase()} ${report.checkedAt}`,
  );
  report.checks.forEach((check) => {
    const detail =
      check.error ||
      (check.status === "not_ready" ? "migration_not_ready" : "ok");
    console.log(
      `[production-operations] ${check.name}=${check.status} detail=${detail} durationMs=${check.durationMs}`,
    );
  });
}

async function main() {
  const report = await runProductionOperationsCheck({
    origin:
      readArgument("origin") ||
      process.env.FAOLLA_PRODUCTION_ORIGIN ||
      DEFAULT_ORIGIN,
    smokePaths:
      readArgument("paths") ||
      process.env.FAOLLA_PRODUCTION_SMOKE_PATHS ||
      DEFAULT_SMOKE_PATHS,
    timeoutMs:
      readArgument("timeout-ms") ||
      process.env.FAOLLA_PRODUCTION_MONITOR_TIMEOUT_MS,
    requestAttempts:
      readArgument("attempts") ||
      process.env.FAOLLA_PRODUCTION_MONITOR_ATTEMPTS,
    requireV1Ready:
      hasFlag("require-v1-ready") ||
      process.env.FAOLLA_REQUIRE_V1_READY === "true",
  });
  printSummary(report);
  const outputPath = trimText(readArgument("output"));
  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (hasFlag("json")) {
    console.log(JSON.stringify(report));
  }
  if (report.status === "critical") process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    const failure = safeFailure(error);
    console.error(`[production-operations] FAILED ${failure.error}`);
    process.exitCode = 1;
  });
}
