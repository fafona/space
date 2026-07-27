import assert from "node:assert/strict";
import test from "node:test";

import {
  MerchantOrderV1ReadCircuitBreaker,
  resolveMerchantOrderV1ReadCircuitBreakerConfig,
  type MerchantOrderV1ReadCircuitBreakerConfig,
} from "@/lib/merchantOrderV1ReadCircuitBreaker";

const enabledConfig: MerchantOrderV1ReadCircuitBreakerConfig = {
  enabled: true,
  failureThreshold: 3,
  failureWindowMs: 10_000,
  cooldownMs: 30_000,
};

function failAt(
  breaker: MerchantOrderV1ReadCircuitBreaker,
  siteId: string,
  nowMs: number,
  config = enabledConfig,
) {
  const permit = breaker.acquire(siteId, config, nowMs);
  assert.equal(permit.allowed, true);
  breaker.recordFailure(siteId, config, permit, nowMs);
  return permit;
}

test("circuit breaker config is explicit-off and clamps unsafe values", () => {
  assert.deepEqual(resolveMerchantOrderV1ReadCircuitBreakerConfig({}), {
    enabled: false,
    failureThreshold: 3,
    failureWindowMs: 60_000,
    cooldownMs: 300_000,
  });
  assert.deepEqual(
    resolveMerchantOrderV1ReadCircuitBreakerConfig({
      MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_ENABLED: " TRUE ",
      MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_FAILURE_THRESHOLD: "1",
      MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_WINDOW_MS: "99999999",
      MERCHANT_ORDER_V1_PRIMARY_CIRCUIT_BREAKER_COOLDOWN_MS: "1",
    }),
    {
      enabled: true,
      failureThreshold: 2,
      failureWindowMs: 3_600_000,
      cooldownMs: 30_000,
    },
  );
});

test("disabled or invalid-site circuits never block", () => {
  const breaker = new MerchantOrderV1ReadCircuitBreaker();
  const disabled = breaker.acquire(
    "10000000",
    { ...enabledConfig, enabled: false },
    1_000,
  );
  const invalidSite = breaker.acquire("all", enabledConfig, 1_000);

  assert.deepEqual(disabled, {
    allowed: true,
    phase: "disabled",
    generation: -1,
    retryAtMs: null,
  });
  assert.equal(invalidSite.phase, "disabled");
  assert.equal(invalidSite.allowed, true);
});

test("clustered failures open the circuit and suppress reads during cooldown", () => {
  const breaker = new MerchantOrderV1ReadCircuitBreaker();
  failAt(breaker, "10000000", 1_000);
  failAt(breaker, "10000000", 2_000);
  failAt(breaker, "10000000", 3_000);

  const blocked = breaker.acquire("10000000", enabledConfig, 3_001);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.phase, "open");
  assert.equal(blocked.retryAtMs, 33_000);
});

test("failures outside the configured window do not open the circuit", () => {
  const breaker = new MerchantOrderV1ReadCircuitBreaker();
  failAt(breaker, "10000000", 1_000);
  failAt(breaker, "10000000", 2_000);
  failAt(breaker, "10000000", 13_000);

  const permit = breaker.acquire("10000000", enabledConfig, 13_001);
  assert.equal(permit.allowed, true);
  assert.equal(permit.phase, "closed");
});

test("only one half-open probe runs and a success closes the circuit", () => {
  const breaker = new MerchantOrderV1ReadCircuitBreaker();
  failAt(breaker, "10000000", 1_000);
  failAt(breaker, "10000000", 2_000);
  failAt(breaker, "10000000", 3_000);

  const probe = breaker.acquire("10000000", enabledConfig, 33_000);
  const concurrent = breaker.acquire("10000000", enabledConfig, 33_000);
  assert.equal(probe.allowed, true);
  assert.equal(probe.phase, "half_open");
  assert.equal(concurrent.allowed, false);
  assert.equal(concurrent.phase, "half_open");

  breaker.recordSuccess("10000000", enabledConfig, probe);
  const recovered = breaker.acquire("10000000", enabledConfig, 33_001);
  assert.equal(recovered.allowed, true);
  assert.equal(recovered.phase, "closed");
});

test("failed and inconclusive half-open probes restart the cooldown", () => {
  const breaker = new MerchantOrderV1ReadCircuitBreaker();
  failAt(breaker, "10000000", 1_000);
  failAt(breaker, "10000000", 2_000);
  failAt(breaker, "10000000", 3_000);

  const failedProbe = breaker.acquire("10000000", enabledConfig, 33_000);
  breaker.recordFailure("10000000", enabledConfig, failedProbe, 33_000);
  assert.equal(breaker.acquire("10000000", enabledConfig, 62_999).allowed, false);

  const inconclusiveProbe = breaker.acquire("10000000", enabledConfig, 63_000);
  breaker.recordInconclusive("10000000", enabledConfig, inconclusiveProbe, 63_000);
  const blockedAgain = breaker.acquire("10000000", enabledConfig, 63_001);
  assert.equal(blockedAgain.allowed, false);
  assert.equal(blockedAgain.retryAtMs, 93_000);
});

test("circuit state is isolated by merchant and ignores stale in-flight outcomes", () => {
  const breaker = new MerchantOrderV1ReadCircuitBreaker();
  const thresholdTwo = { ...enabledConfig, failureThreshold: 2 };
  const firstPermit = breaker.acquire("10000000", thresholdTwo, 1_000);
  const concurrentSuccess = breaker.acquire("10000000", thresholdTwo, 1_000);
  breaker.recordFailure("10000000", thresholdTwo, firstPermit, 1_000);
  breaker.recordSuccess("10000000", thresholdTwo, concurrentSuccess);
  breaker.recordFailure("10000000", thresholdTwo, firstPermit, 1_001);

  const freshPermit = breaker.acquire("10000000", thresholdTwo, 1_002);
  assert.equal(freshPermit.allowed, true);
  breaker.recordFailure("10000000", thresholdTwo, freshPermit, 1_002);
  assert.equal(breaker.acquire("10000000", thresholdTwo, 1_003).allowed, true);

  failAt(breaker, "20000000", 2_000, thresholdTwo);
  failAt(breaker, "20000000", 2_001, thresholdTwo);
  assert.equal(breaker.acquire("20000000", thresholdTwo, 2_002).allowed, false);
  assert.equal(breaker.acquire("10000000", thresholdTwo, 2_002).allowed, true);
});
