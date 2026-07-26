import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMerchantV1ReadRollout,
  parseMerchantV1ReadObservationLines,
  resolveMerchantV1ReadRolloutPolicy,
  type MerchantV1ReadDomain,
} from "@/lib/merchantV1ReadRolloutAudit";

const SITE_ID = "10000000";
const OTHER_SITE_ID = "10000001";
const EVENT_BY_DOMAIN: Record<MerchantV1ReadDomain, string> = {
  orders: "merchant_order_v1_read",
  bookings: "merchant_booking_v1_read",
  coupons: "merchant_coupon_v1_read",
  conversations: "merchant_conversation_v1_read",
  memberships: "merchant_membership_v1_read",
};

function observationLine(input: {
  domain: MerchantV1ReadDomain;
  observedAt: string;
  durationMs?: number;
  siteId?: string;
  mode?: string;
  outcome?: "match" | "fallback";
  reason?: string;
  prefixed?: boolean;
}) {
  const outcome = input.outcome ?? "match";
  const payload = JSON.stringify({
    event: EVENT_BY_DOMAIN[input.domain],
    siteId: input.siteId ?? SITE_ID,
    mode: input.mode ?? "verify",
    observedAt: input.observedAt,
    durationMs: input.durationMs ?? 25,
    outcome,
    reason: input.reason ?? (outcome === "match" ? "parity" : "v1_timeout"),
    ignoredSensitiveField: "must-not-be-preserved",
  });
  return input.prefixed === false
    ? payload
    : `[merchant-${input.domain}-v1-read] ${payload}`;
}

test("V1 read observation parser accepts structured events and rejects unsafe evidence", () => {
  const observedAt = "2026-07-26T10:00:00.000Z";
  const parsed = parseMerchantV1ReadObservationLines([
    "ordinary application log",
    observationLine({ domain: "orders", observedAt }),
    observationLine({ domain: "bookings", observedAt, prefixed: false }),
    `[merchant-coupon-v1-read] {"event":"merchant_coupon_v1_read"`,
    observationLine({
      domain: "conversations",
      observedAt,
      mode: "primary",
    }),
    observationLine({
      domain: "memberships",
      observedAt,
      siteId: OTHER_SITE_ID,
      durationMs: -1,
    }),
  ]);

  assert.equal(parsed.ignoredLineCount, 1);
  assert.equal(parsed.observations.length, 2);
  assert.deepEqual(
    parsed.observations.map((item) => item.domain),
    ["orders", "bookings"],
  );
  assert.equal(
    "ignoredSensitiveField" in (parsed.observations[0] as unknown as object),
    false,
  );
  assert.deepEqual(
    parsed.rejections.map((item) => item.reason),
    ["invalid_json", "mode_not_verify", "invalid_duration_ms"],
  );
  assert.equal(parsed.rejections[2]?.siteId, OTHER_SITE_ID);
});

test("rollout audit marks every requested domain ready only with current clean evidence", () => {
  const nowMs = Date.parse("2026-07-26T12:00:00.000Z");
  const firstObservedAt = new Date(nowMs - 168 * 3_600_000).toISOString();
  const lastObservedAt = new Date(nowMs).toISOString();
  const domains = [
    "orders",
    "bookings",
    "coupons",
    "conversations",
    "memberships",
  ] satisfies MerchantV1ReadDomain[];
  const lines = domains.flatMap((domain) => [
    observationLine({ domain, observedAt: firstObservedAt, durationMs: 10 }),
    observationLine({ domain, observedAt: lastObservedAt, durationMs: 20 }),
  ]);

  const report = evaluateMerchantV1ReadRollout({
    siteId: SITE_ID,
    parsed: parseMerchantV1ReadObservationLines(lines),
    nowMs,
    policy: {
      domains,
      minimumSamplesPerDomain: 2,
      minimumObservationWindowHours: 168,
      maximumFallbackRate: 0,
      maximumP95DurationMs: 50,
      maximumLastObservationAgeHours: 1,
    },
  });

  assert.equal(report.status, "ready");
  assert.equal(report.rejectedLineCount, 0);
  assert.equal(report.domains.length, 5);
  report.domains.forEach((domain) => {
    assert.equal(domain.status, "ready");
    assert.equal(domain.sampleCount, 2);
    assert.equal(domain.fallbackCount, 0);
    assert.equal(domain.observationWindowHours, 168);
    assert.equal(domain.p50DurationMs, 10);
    assert.equal(domain.p95DurationMs, 20);
    assert.deepEqual(domain.reasonCounts, { parity: 2 });
  });
});

test("rollout audit blocks rejected, stale, slow, fallback, future, and thin evidence", () => {
  const nowMs = Date.parse("2026-07-26T12:00:00.000Z");
  const lines = [
    observationLine({
      domain: "orders",
      observedAt: new Date(nowMs - 200 * 3_600_000).toISOString(),
      durationMs: 10,
    }),
    observationLine({
      domain: "orders",
      observedAt: new Date(nowMs - 48 * 3_600_000).toISOString(),
      durationMs: 100,
      outcome: "fallback",
      reason: "v1_timeout",
    }),
    observationLine({
      domain: "bookings",
      observedAt: new Date(nowMs + 10 * 60_000).toISOString(),
      durationMs: 10,
    }),
    observationLine({
      domain: "orders",
      observedAt: "not-a-date",
    }),
    observationLine({
      domain: "memberships",
      siteId: OTHER_SITE_ID,
      observedAt: "not-a-date",
    }),
  ];

  const report = evaluateMerchantV1ReadRollout({
    siteId: SITE_ID,
    parsed: parseMerchantV1ReadObservationLines(lines),
    nowMs,
    policy: {
      domains: ["orders", "bookings"],
      minimumSamplesPerDomain: 2,
      minimumObservationWindowHours: 168,
      maximumFallbackRate: 0,
      maximumP95DurationMs: 50,
      maximumLastObservationAgeHours: 24,
    },
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.rejectedLineCount, 1);
  assert.deepEqual(report.blockers, ["rejected_observation_lines"]);
  assert.deepEqual(report.domains[0]?.blockers, [
    "insufficient_observation_window",
    "fallback_rate_exceeded",
    "p95_duration_exceeded",
    "latest_observation_stale",
  ]);
  assert.deepEqual(report.domains[1]?.blockers, [
    "insufficient_samples",
    "insufficient_observation_window",
    "future_observation",
  ]);
});

test("rollout policy rejects duplicate domains and invalid bounds", () => {
  assert.throws(
    () => resolveMerchantV1ReadRolloutPolicy({ domains: ["orders", "orders"] }),
    /domains_must_be_unique_known_values/,
  );
  assert.throws(
    () =>
      resolveMerchantV1ReadRolloutPolicy({
        maximumFallbackRate: 1.1,
      }),
    /maximum_fallback_rate/,
  );
  assert.throws(
    () =>
      resolveMerchantV1ReadRolloutPolicy({
        minimumSamplesPerDomain: 1.5,
      }),
    /minimum_samples_per_domain_must_be_an_integer/,
  );
});
