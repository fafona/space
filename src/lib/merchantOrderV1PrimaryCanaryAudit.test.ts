import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMerchantOrderV1PrimaryCanary,
  parseMerchantOrderV1PrimaryCanaryLines,
  resolveMerchantOrderV1PrimaryCanaryPolicy,
} from "@/lib/merchantOrderV1PrimaryCanaryAudit";

const siteId = "10000000";
const activatedAt = "2026-07-25T00:00:00.000Z";

function eventLine(input: {
  siteId?: string;
  mode?: string;
  observedAt?: string;
  durationMs?: number;
  outcome?: "match" | "fallback";
  reason?: string;
}) {
  const outcome = input.outcome ?? "match";
  return `[merchant-order-v1-read] ${JSON.stringify({
    event: "merchant_order_v1_read",
    siteId: input.siteId ?? siteId,
    mode: input.mode ?? "primary",
    observedAt: input.observedAt ?? activatedAt,
    durationMs: input.durationMs ?? 100,
    outcome,
    reason: input.reason ?? (outcome === "match" ? "parity" : "v1_timeout"),
    legacyCount: 1,
    v1Count: 1,
    orderIds: [],
  })}`;
}

function createHealthyLines() {
  const startedAtMs = Date.parse(activatedAt);
  const windowMs = 24 * 60 * 60 * 1000;
  return Array.from({ length: 100 }, (_, index) =>
    eventLine({
      observedAt: new Date(
        startedAtMs + Math.round((windowMs * index) / 99),
      ).toISOString(),
      durationMs: 100 + index,
    }),
  );
}

test("primary canary parser scopes by merchant and activation time", () => {
  const parsed = parseMerchantOrderV1PrimaryCanaryLines(
    [
      "unrelated log",
      eventLine({ observedAt: "2026-07-24T23:59:59.000Z" }),
      eventLine({ siteId: "20000000" }),
      eventLine({ observedAt: "2026-07-25T00:01:00.000Z" }),
      eventLine({
        mode: "verify",
        observedAt: "2026-07-25T00:02:00.000Z",
      }),
    ],
    { siteId, activatedAt },
  );

  assert.equal(parsed.observations.length, 1);
  assert.equal(parsed.observations[0]?.outcome, "match");
  assert.equal(parsed.ignoredLineCount, 3);
  assert.deepEqual(
    parsed.rejections.map((item) => item.reason),
    ["mode_not_primary"],
  );
});

test("primary canary parser rejects malformed target evidence", () => {
  const parsed = parseMerchantOrderV1PrimaryCanaryLines(
    [
      "[merchant-order-v1-read] merchant_order_v1_read {",
      eventLine({
        observedAt: "invalid",
      }),
      eventLine({
        outcome: "match",
        reason: "v1_timeout",
      }),
      eventLine({
        durationMs: 700_000,
      }),
    ],
    { siteId, activatedAt },
  );

  assert.deepEqual(
    parsed.rejections.map((item) => item.reason),
    [
      "invalid_json",
      "invalid_observed_at",
      "invalid_outcome_reason",
      "invalid_duration_ms",
    ],
  );
});

test("a current clean 24-hour primary canary becomes healthy", () => {
  const parsed = parseMerchantOrderV1PrimaryCanaryLines(createHealthyLines(), {
    siteId,
    activatedAt,
  });
  parsed.observations.push(
    {
      ...parsed.observations[0],
      siteId: "20000000",
      outcome: "fallback",
      reason: "v1_timeout",
    },
    {
      ...parsed.observations[0],
      observedAt: "2026-07-24T23:59:59.000Z",
      observedAtMs: Date.parse("2026-07-24T23:59:59.000Z"),
      outcome: "fallback",
      reason: "v1_timeout",
    },
  );
  const report = evaluateMerchantOrderV1PrimaryCanary({
    siteId,
    activatedAt,
    parsed,
    evaluatedAt: new Date("2026-07-26T00:05:00.000Z"),
  });

  assert.equal(report.status, "healthy");
  assert.equal(report.sampleCount, 100);
  assert.equal(report.matchCount, 100);
  assert.equal(report.fallbackCount, 0);
  assert.equal(report.observationWindowMinutes, 1440);
  assert.equal(report.latestObservationAgeMinutes, 5);
  assert.equal(report.ignoredLineCount, 2);
  assert.deepEqual(report.rollbackReasons, []);
  assert.deepEqual(report.observationBlockers, []);
});

test("one fallback immediately requires rollback even before evidence matures", () => {
  const parsed = parseMerchantOrderV1PrimaryCanaryLines(
    [
      eventLine({
        observedAt: "2026-07-25T00:01:00.000Z",
        outcome: "fallback",
        reason: "order_content_mismatch",
      }),
    ],
    { siteId, activatedAt },
  );
  const report = evaluateMerchantOrderV1PrimaryCanary({
    siteId,
    activatedAt,
    parsed,
    evaluatedAt: new Date("2026-07-25T00:02:00.000Z"),
  });

  assert.equal(report.status, "rollback_required");
  assert.deepEqual(report.rollbackReasons, ["fallback_observed"]);
  assert.deepEqual(report.observationBlockers, [
    "insufficient_samples",
    "insufficient_observation_window",
  ]);
});

test("circuit-open and slow primary observations produce explicit rollback reasons", () => {
  const lines = createHealthyLines();
  lines[99] = eventLine({
    observedAt: "2026-07-26T00:00:00.000Z",
    durationMs: 3_000,
    outcome: "fallback",
    reason: "circuit_open",
  });
  for (let index = 94; index < 99; index += 1) {
    lines[index] = eventLine({
      observedAt: new Date(
        Date.parse(activatedAt) + Math.round((24 * 60 * 60 * 1000 * index) / 99),
      ).toISOString(),
      durationMs: 3_000,
    });
  }
  const parsed = parseMerchantOrderV1PrimaryCanaryLines(lines, {
    siteId,
    activatedAt,
  });
  const report = evaluateMerchantOrderV1PrimaryCanary({
    siteId,
    activatedAt,
    parsed,
    evaluatedAt: new Date("2026-07-26T00:05:00.000Z"),
  });

  assert.equal(report.status, "rollback_required");
  assert.equal(report.circuitOpenCount, 1);
  assert.deepEqual(report.rollbackReasons, [
    "fallback_observed",
    "circuit_open_observed",
    "p95_duration_exceeded",
  ]);
});

test("missing, stale, future, rejected, and mode-drift evidence stays observing", () => {
  const parsed = parseMerchantOrderV1PrimaryCanaryLines(
    [
      eventLine({
        observedAt: "2026-07-25T00:01:00.000Z",
      }),
      eventLine({
        observedAt: "2026-07-27T00:00:00.000Z",
      }),
      eventLine({
        mode: "verify",
        observedAt: "2026-07-25T00:02:00.000Z",
      }),
    ],
    { siteId, activatedAt },
  );
  const report = evaluateMerchantOrderV1PrimaryCanary({
    siteId,
    activatedAt,
    parsed,
    evaluatedAt: new Date("2026-07-26T00:00:00.000Z"),
  });

  assert.equal(report.status, "observing");
  assert.deepEqual(report.observationBlockers, [
    "insufficient_samples",
    "insufficient_observation_window",
    "latest_observation_stale",
    "future_observation",
    "rejected_observation_lines",
    "mode_drift_observed",
  ]);
});

test("canary policy rejects weakened shape errors and future activation", () => {
  assert.throws(
    () =>
      resolveMerchantOrderV1PrimaryCanaryPolicy({
        minimumSamples: 1.5,
      }),
    /canary_policy_values_must_be_integers/,
  );
  assert.throws(
    () =>
      resolveMerchantOrderV1PrimaryCanaryPolicy({
        maximumP95DurationMs: 0,
      }),
    /maximum_p95_duration_ms_must_be_between/,
  );
  assert.throws(
    () =>
      evaluateMerchantOrderV1PrimaryCanary({
        siteId,
        activatedAt: "2026-07-26T00:10:01.000Z",
        parsed: {
          observations: [],
          rejections: [],
          ignoredLineCount: 0,
        },
        evaluatedAt: new Date("2026-07-26T00:00:00.000Z"),
      }),
    /activated_at_cannot_be_in_the_future/,
  );
});
