import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMerchantOrderV1DeploymentGuard } from "@/lib/merchantOrderV1DeploymentGuard";

const NOW = Date.parse("2026-07-26T15:30:00.000Z");

function evaluate(environment: Record<string, string | undefined>) {
  return evaluateMerchantOrderV1DeploymentGuard({
    environment,
    nowMs: NOW,
  });
}

test("default off configuration is deployable", () => {
  const report = evaluate({});
  assert.equal(report.status, "ready");
  assert.equal(report.readMode, "off");
  assert.equal(report.dualWriteMode, "off");
  assert.equal(report.circuitBreakerEnabled, false);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.warnings, []);
});

test("verify requires an exact allowlist and shadow dual write", () => {
  const blocked = evaluate({
    MERCHANT_ORDER_V1_READ_MODE: "verify",
  });
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.blockers.includes("verify_allowlist_missing"));
  assert.ok(
    blocked.blockers.includes("read_mode_requires_shadow_dual_write"),
  );

  const ready = evaluate({
    MERCHANT_ORDER_V1_READ_MODE: "verify",
    MERCHANT_ORDER_V1_READ_SITE_IDS: "10000000,10000001",
    MERCHANT_ORDER_V1_DUAL_WRITE_MODE: "shadow",
  });
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.readSiteIds, ["10000000", "10000001"]);
});

test("primary requires one merchant, shadow writes, and circuit protection", () => {
  const ready = evaluate({
    MERCHANT_ORDER_V1_READ_MODE: "primary",
    MERCHANT_ORDER_V1_READ_SITE_IDS: "10000000",
    MERCHANT_ORDER_V1_DUAL_WRITE_MODE: "shadow",
    MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_ENABLED: "true",
  });
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.blockers, []);

  const blocked = evaluate({
    MERCHANT_ORDER_V1_READ_MODE: "primary",
    MERCHANT_ORDER_V1_READ_SITE_IDS: "10000000,10000001",
    MERCHANT_ORDER_V1_DUAL_WRITE_MODE: "off",
    MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_ENABLED: "false",
  });
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.blockers.includes("primary_allowlist_not_single_site"));
  assert.ok(
    blocked.blockers.includes("read_mode_requires_shadow_dual_write"),
  );
  assert.ok(blocked.blockers.includes("primary_circuit_breaker_disabled"));
});

test("malformed values fail instead of being silently normalized", () => {
  const report = evaluate({
    MERCHANT_ORDER_V1_READ_MODE: "primray",
    MERCHANT_ORDER_V1_READ_SITE_IDS: "10000000,*,10000000",
    MERCHANT_ORDER_V1_READ_TIMEOUT_MS: "10001",
    MERCHANT_ORDER_V1_DUAL_WRITE_MODE: "shdow",
    MERCHANT_ORDER_V1_DUAL_WRITE_TIMEOUT_MS: "2.5",
    MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_ENABLED: "yes",
    MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_FAILURE_THRESHOLD: "1",
    MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_WINDOW_MS: "9999",
    MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_COOLDOWN_MS: "3600001",
  });
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.blockers, [
    "read_mode_invalid",
    "read_allowlist_invalid",
    "dual_write_mode_invalid",
    "circuit_breaker_flag_invalid",
    "read_timeout_invalid",
    "dual_write_timeout_invalid",
    "circuit_breaker_threshold_invalid",
    "circuit_breaker_window_invalid",
    "circuit_breaker_cooldown_invalid",
  ]);
  assert.deepEqual(report.readSiteIds, ["10000000"]);
});

test("operator-only execution flags are forbidden in the web process", () => {
  const report = evaluate({
    MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_ENABLED: "true",
    ORDER_V1_BACKFILL_WRITE_ENABLED: "true",
  });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("web_process_canary_watch_enabled"));
  assert.ok(report.blockers.includes("web_process_order_backfill_enabled"));
});

test("emergency off mode remains deployable with visible stale-config warnings", () => {
  const report = evaluate({
    MERCHANT_ORDER_V1_READ_MODE: "off",
    MERCHANT_ORDER_V1_READ_SITE_IDS: "10000000",
    MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_ENABLED: "true",
  });
  assert.equal(report.status, "ready");
  assert.deepEqual(report.warnings, [
    "inactive_read_allowlist_present",
    "circuit_breaker_enabled_outside_primary",
  ]);
});

test("invalid operator booleans and non-finite evaluation time are rejected", () => {
  const report = evaluate({
    MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_ENABLED: "1",
    ORDER_V1_BACKFILL_WRITE_ENABLED: "TRUE ",
  });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("canary_watch_flag_invalid"));
  assert.ok(report.blockers.includes("web_process_order_backfill_enabled"));

  assert.throws(
    () =>
      evaluateMerchantOrderV1DeploymentGuard({
        environment: {},
        nowMs: Number.NaN,
      }),
    /deployment_guard_now_must_be_finite/,
  );
});
