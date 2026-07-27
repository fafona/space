import assert from "node:assert/strict";
import test from "node:test";

import { parseV1PrimaryCanaryAuditOptions } from "./audit-v1-primary-canary";

test("primary canary audit options require scope and retain conservative defaults", () => {
  const options = parseV1PrimaryCanaryAuditOptions([
    "--file=logs/order-primary.jsonl",
    "--site=10000000",
    "--activated-at=2026-07-25T00:00:00.000Z",
  ]);

  assert.deepEqual(options, {
    file: "logs/order-primary.jsonl",
    siteId: "10000000",
    activatedAt: "2026-07-25T00:00:00.000Z",
    minimumSamples: 100,
    minimumObservationWindowMinutes: 1440,
    maximumP95DurationMs: 2500,
    maximumLastObservationAgeMinutes: 15,
  });
});

test("primary canary audit accepts bounded explicit policy values", () => {
  const options = parseV1PrimaryCanaryAuditOptions([
    "--file=-",
    "--site=10000000",
    "--activated-at=2026-07-25T02:00:00+02:00",
    "--min-samples=250",
    "--min-window-minutes=2880",
    "--max-p95-ms=1500",
    "--max-last-age-minutes=10",
  ]);

  assert.equal(options.activatedAt, "2026-07-25T00:00:00.000Z");
  assert.equal(options.minimumSamples, 250);
  assert.equal(options.minimumObservationWindowMinutes, 2880);
  assert.equal(options.maximumP95DurationMs, 1500);
  assert.equal(options.maximumLastObservationAgeMinutes, 10);
});

test("primary canary audit rejects missing, duplicate, malformed and unknown input", () => {
  assert.throws(
    () =>
      parseV1PrimaryCanaryAuditOptions([
        "--file=a.jsonl",
        "--site=10000000",
      ]),
    /activated_at_is_required/,
  );
  assert.throws(
    () =>
      parseV1PrimaryCanaryAuditOptions([
        "--file=a.jsonl",
        "--site=10000000",
        "--site=10000001",
        "--activated-at=2026-07-25T00:00:00.000Z",
      ]),
    /duplicate_argument:site/,
  );
  assert.throws(
    () =>
      parseV1PrimaryCanaryAuditOptions([
        "--file=a.jsonl",
        "--site=all",
        "--activated-at=2026-07-25T00:00:00.000Z",
      ]),
    /site_must_be_exact_8_digit_id/,
  );
  assert.throws(
    () =>
      parseV1PrimaryCanaryAuditOptions([
        "--file=a.jsonl",
        "--site=10000000",
        "--activated-at=invalid",
      ]),
    /activated_at_must_be_valid_timestamp/,
  );
  assert.throws(
    () =>
      parseV1PrimaryCanaryAuditOptions([
        "--file=a.jsonl",
        "--site=10000000",
        "--activated-at=2026-07-25T00:00:00.000Z",
        "--write=true",
      ]),
    /unknown_argument:write/,
  );
});
