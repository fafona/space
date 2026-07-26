import assert from "node:assert/strict";
import test from "node:test";

import { parseV1ReadRolloutAuditOptions } from "./audit-v1-read-rollout";

test("V1 read rollout audit options are strict and retain conservative defaults", () => {
  const options = parseV1ReadRolloutAuditOptions([
    "--file=logs/v1-read.jsonl",
    "--site=10000000",
  ]);

  assert.equal(options.file, "logs/v1-read.jsonl");
  assert.equal(options.siteId, "10000000");
  assert.deepEqual(options.domains, [
    "orders",
    "bookings",
    "coupons",
    "conversations",
    "memberships",
  ]);
  assert.equal(options.minimumSamplesPerDomain, 100);
  assert.equal(options.minimumObservationWindowHours, 168);
  assert.equal(options.maximumFallbackRate, 0);
  assert.equal(options.maximumP95DurationMs, 2500);
  assert.equal(options.maximumLastObservationAgeHours, 24);
});

test("V1 read rollout audit options accept explicit bounded policy values", () => {
  const options = parseV1ReadRolloutAuditOptions([
    "--file=-",
    "--site=10000000",
    "--domains=orders,memberships",
    "--min-samples=250",
    "--min-window-hours=336",
    "--max-fallback-rate=0.001",
    "--max-p95-ms=1500",
    "--max-last-age-hours=12",
  ]);

  assert.deepEqual(options.domains, ["orders", "memberships"]);
  assert.equal(options.minimumSamplesPerDomain, 250);
  assert.equal(options.minimumObservationWindowHours, 336);
  assert.equal(options.maximumFallbackRate, 0.001);
  assert.equal(options.maximumP95DurationMs, 1500);
  assert.equal(options.maximumLastObservationAgeHours, 12);
});

test("V1 read rollout audit options reject missing, duplicate, and unknown values", () => {
  assert.throws(
    () => parseV1ReadRolloutAuditOptions(["--site=10000000"]),
    /file_is_required/,
  );
  assert.throws(
    () =>
      parseV1ReadRolloutAuditOptions([
        "--file=a.jsonl",
        "--site=10000000",
        "--site=10000001",
      ]),
    /duplicate_argument:site/,
  );
  assert.throws(
    () =>
      parseV1ReadRolloutAuditOptions([
        "--file=a.jsonl",
        "--site=10000000",
        "--domains=orders,unknown",
      ]),
    /domains_must_be_unique_known_values/,
  );
  assert.throws(
    () =>
      parseV1ReadRolloutAuditOptions([
        "--file=a.jsonl",
        "--site=10000000",
        "--max-fallback-rate=1.1",
      ]),
    /max_fallback_rate_must_be_between_0_and_1/,
  );
});
