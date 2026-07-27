export const MERCHANT_ORDER_V1_DEPLOYMENT_GUARD_SCHEMA_VERSION = 1;

export type MerchantOrderV1DeploymentReadMode =
  | "off"
  | "verify"
  | "primary";
export type MerchantOrderV1DeploymentDualWriteMode = "off" | "shadow";

export type MerchantOrderV1DeploymentGuardBlocker =
  | "read_mode_invalid"
  | "read_allowlist_invalid"
  | "verify_allowlist_missing"
  | "primary_allowlist_not_single_site"
  | "read_timeout_invalid"
  | "dual_write_mode_invalid"
  | "read_mode_requires_shadow_dual_write"
  | "dual_write_timeout_invalid"
  | "circuit_breaker_flag_invalid"
  | "primary_circuit_breaker_disabled"
  | "circuit_breaker_threshold_invalid"
  | "circuit_breaker_window_invalid"
  | "circuit_breaker_cooldown_invalid"
  | "canary_watch_flag_invalid"
  | "web_process_canary_watch_enabled"
  | "order_backfill_flag_invalid"
  | "web_process_order_backfill_enabled";

export type MerchantOrderV1DeploymentGuardWarning =
  | "inactive_read_allowlist_present"
  | "circuit_breaker_enabled_outside_primary";

export type MerchantOrderV1DeploymentGuardReport = {
  schemaVersion: 1;
  status: "ready" | "blocked";
  evaluatedAt: string;
  readMode: MerchantOrderV1DeploymentReadMode | null;
  readSiteIds: string[];
  dualWriteMode: MerchantOrderV1DeploymentDualWriteMode | null;
  circuitBreakerEnabled: boolean | null;
  blockers: MerchantOrderV1DeploymentGuardBlocker[];
  warnings: MerchantOrderV1DeploymentGuardWarning[];
};

const SITE_ID_PATTERN = /^\d{8}$/;
const MAX_READ_SITE_IDS = 50;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseMode<T extends string>(
  rawValue: unknown,
  allowed: readonly T[],
  fallback: T,
) {
  const value = trimText(rawValue).toLowerCase();
  if (!value) return { value: fallback, valid: true };
  if (allowed.includes(value as T)) {
    return { value: value as T, valid: true };
  }
  return { value: null, valid: false };
}

function parseBoolean(rawValue: unknown, fallback = false) {
  const value = trimText(rawValue).toLowerCase();
  if (!value) return { value: fallback, valid: true };
  if (value === "true") return { value: true, valid: true };
  if (value === "false") return { value: false, valid: true };
  return { value: null, valid: false };
}

function integerIsWithinRange(
  rawValue: unknown,
  minimum: number,
  maximum: number,
) {
  const value = trimText(rawValue);
  if (!value) return true;
  if (!/^(0|[1-9]\d*)$/.test(value)) return false;
  const parsed = Number(value);
  return (
    Number.isSafeInteger(parsed) &&
    parsed >= minimum &&
    parsed <= maximum &&
    value.length <= 10
  );
}

function parseReadSiteIds(rawValue: unknown) {
  const value = trimText(rawValue);
  if (!value) return { siteIds: [] as string[], valid: true };
  const entries = value.split(",").map((entry) => entry.trim());
  const valid =
    entries.length <= MAX_READ_SITE_IDS &&
    entries.every((entry) => SITE_ID_PATTERN.test(entry)) &&
    new Set(entries).size === entries.length;
  return {
    siteIds: valid
      ? entries
      : [...new Set(entries.filter((entry) => SITE_ID_PATTERN.test(entry)))],
    valid,
  };
}

function pushUnique<T>(items: T[], item: T) {
  if (!items.includes(item)) items.push(item);
}

export function evaluateMerchantOrderV1DeploymentGuard(input?: {
  environment?: Record<string, string | undefined>;
  nowMs?: number;
}): MerchantOrderV1DeploymentGuardReport {
  const environment = input?.environment ?? process.env;
  const nowMs = input?.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error("deployment_guard_now_must_be_finite");
  }

  const blockers: MerchantOrderV1DeploymentGuardBlocker[] = [];
  const warnings: MerchantOrderV1DeploymentGuardWarning[] = [];
  const readMode = parseMode(
    environment.MERCHANT_ORDER_V1_READ_MODE,
    ["off", "verify", "primary"] as const,
    "off",
  );
  const dualWriteMode = parseMode(
    environment.MERCHANT_ORDER_V1_DUAL_WRITE_MODE,
    ["off", "shadow"] as const,
    "off",
  );
  const readAllowlist = parseReadSiteIds(
    environment.MERCHANT_ORDER_V1_READ_SITE_IDS,
  );
  const circuitBreaker = parseBoolean(
    environment.MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_ENABLED,
  );
  const canaryWatch = parseBoolean(
    environment.MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_ENABLED,
  );
  const orderBackfill = parseBoolean(
    environment.ORDER_V1_BACKFILL_WRITE_ENABLED,
  );

  if (!readMode.valid) pushUnique(blockers, "read_mode_invalid");
  if (!readAllowlist.valid) pushUnique(blockers, "read_allowlist_invalid");
  if (!dualWriteMode.valid) pushUnique(blockers, "dual_write_mode_invalid");
  if (!circuitBreaker.valid) {
    pushUnique(blockers, "circuit_breaker_flag_invalid");
  }
  if (!canaryWatch.valid) pushUnique(blockers, "canary_watch_flag_invalid");
  if (!orderBackfill.valid) pushUnique(blockers, "order_backfill_flag_invalid");

  if (
    !integerIsWithinRange(
      environment.MERCHANT_ORDER_V1_READ_TIMEOUT_MS,
      250,
      10_000,
    )
  ) {
    pushUnique(blockers, "read_timeout_invalid");
  }
  if (
    !integerIsWithinRange(
      environment.MERCHANT_ORDER_V1_DUAL_WRITE_TIMEOUT_MS,
      250,
      10_000,
    )
  ) {
    pushUnique(blockers, "dual_write_timeout_invalid");
  }
  if (
    !integerIsWithinRange(
      environment.MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      2,
      20,
    )
  ) {
    pushUnique(blockers, "circuit_breaker_threshold_invalid");
  }
  if (
    !integerIsWithinRange(
      environment.MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_WINDOW_MS,
      10_000,
      3_600_000,
    )
  ) {
    pushUnique(blockers, "circuit_breaker_window_invalid");
  }
  if (
    !integerIsWithinRange(
      environment.MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_COOLDOWN_MS,
      30_000,
      3_600_000,
    )
  ) {
    pushUnique(blockers, "circuit_breaker_cooldown_invalid");
  }

  if (
    (readMode.value === "verify" || readMode.value === "primary") &&
    dualWriteMode.value !== "shadow"
  ) {
    pushUnique(blockers, "read_mode_requires_shadow_dual_write");
  }
  if (
    readMode.value === "verify" &&
    readAllowlist.valid &&
    readAllowlist.siteIds.length === 0
  ) {
    pushUnique(blockers, "verify_allowlist_missing");
  }
  if (
    readMode.value === "primary" &&
    (!readAllowlist.valid || readAllowlist.siteIds.length !== 1)
  ) {
    pushUnique(blockers, "primary_allowlist_not_single_site");
  }
  if (
    readMode.value === "primary" &&
    circuitBreaker.value !== true
  ) {
    pushUnique(blockers, "primary_circuit_breaker_disabled");
  }
  if (canaryWatch.value === true) {
    pushUnique(blockers, "web_process_canary_watch_enabled");
  }
  if (orderBackfill.value === true) {
    pushUnique(blockers, "web_process_order_backfill_enabled");
  }

  if (
    readMode.value === "off" &&
    readAllowlist.valid &&
    readAllowlist.siteIds.length > 0
  ) {
    pushUnique(warnings, "inactive_read_allowlist_present");
  }
  if (
    readMode.value !== "primary" &&
    circuitBreaker.value === true
  ) {
    pushUnique(warnings, "circuit_breaker_enabled_outside_primary");
  }

  return {
    schemaVersion: MERCHANT_ORDER_V1_DEPLOYMENT_GUARD_SCHEMA_VERSION,
    status: blockers.length > 0 ? "blocked" : "ready",
    evaluatedAt: new Date(nowMs).toISOString(),
    readMode: readMode.value,
    readSiteIds: readAllowlist.siteIds,
    dualWriteMode: dualWriteMode.value,
    circuitBreakerEnabled: circuitBreaker.value,
    blockers,
    warnings,
  };
}
