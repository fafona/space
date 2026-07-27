import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantOrderV1PrimaryCanaryWatchHealthReport } from "../src/lib/merchantOrderV1PrimaryCanaryWatchHealth";
import {
  parseV1PrimaryCanaryWatchHealthOptions,
  renderV1PrimaryCanaryWatchHealthReport,
  v1PrimaryCanaryWatchHealthExitCode,
} from "./check-v1-primary-canary-watch-health";

test("parses health options with safe defaults", () => {
  assert.deepEqual(
    parseV1PrimaryCanaryWatchHealthOptions([
      "--state-file=.runtime/order-v1-canary-10000000.json",
      "--site=10000000",
      "--activated-at=2026-07-25T00:00:00Z",
    ]),
    {
      stateFile: ".runtime/order-v1-canary-10000000.json",
      siteId: "10000000",
      activatedAt: "2026-07-25T00:00:00.000Z",
      maximumStateAgeMinutes: 15,
      maximumPendingDeliveryAgeMinutes: 5,
      format: "text",
    },
  );
});

test("parses explicit thresholds and JSON output", () => {
  const options = parseV1PrimaryCanaryWatchHealthOptions([
    "--state-file=.runtime/order-v1-canary-10000000.json",
    "--site=10000000",
    "--activated-at=2026-07-25T00:00:00.000Z",
    "--max-state-age-minutes=30",
    "--max-pending-age-minutes=10",
    "--format=json",
  ]);
  assert.equal(options.maximumStateAgeMinutes, 30);
  assert.equal(options.maximumPendingDeliveryAgeMinutes, 10);
  assert.equal(options.format, "json");
});

test("rejects missing, duplicate, and invalid health options", () => {
  assert.throws(
    () =>
      parseV1PrimaryCanaryWatchHealthOptions([
        "--site=10000000",
        "--activated-at=2026-07-25T00:00:00.000Z",
      ]),
    /state_file_is_required/,
  );
  assert.throws(
    () =>
      parseV1PrimaryCanaryWatchHealthOptions([
        "--state-file=a.json",
        "--state-file=b.json",
        "--site=10000000",
        "--activated-at=2026-07-25T00:00:00.000Z",
      ]),
    /duplicate_argument:state-file/,
  );
  assert.throws(
    () =>
      parseV1PrimaryCanaryWatchHealthOptions([
        "--state-file=a.json",
        "--site=10000000",
        "--activated-at=2026-07-25T00:00:00.000Z",
        "--format=xml",
      ]),
    /format_must_be_text_or_json/,
  );
});

function makeReport(
  status: MerchantOrderV1PrimaryCanaryWatchHealthReport["status"],
): MerchantOrderV1PrimaryCanaryWatchHealthReport {
  return {
    schemaVersion: 1,
    status,
    checkedAt: "2026-07-26T12:00:00.000Z",
    siteId: "10000000",
    activatedAt: "2026-07-25T00:00:00.000Z",
    canaryStatus: "healthy",
    stateUpdatedAt: "2026-07-26T11:58:00.000Z",
    stateAgeMinutes: 2,
    evaluatedAt: "2026-07-26T11:58:00.000Z",
    evaluationAgeMinutes: 2,
    pendingNotificationId: null,
    pendingNotificationAgeMinutes: null,
    blockers: [],
    warnings: [],
  };
}

test("renders bounded text and machine-readable JSON", () => {
  const report = makeReport("healthy");
  assert.equal(
    renderV1PrimaryCanaryWatchHealthReport(report, "text"),
    "[v1-primary-canary-watch-health] site=10000000 health=healthy canary=healthy state-age-minutes=2.0 evaluation-age-minutes=2.0 pending-age-minutes=- blockers=- warnings=-",
  );
  assert.deepEqual(
    JSON.parse(renderV1PrimaryCanaryWatchHealthReport(report, "json")),
    report,
  );
});

test("maps health status to monitoring-friendly exit codes", () => {
  assert.equal(v1PrimaryCanaryWatchHealthExitCode("healthy"), 0);
  assert.equal(v1PrimaryCanaryWatchHealthExitCode("critical"), 2);
  assert.equal(v1PrimaryCanaryWatchHealthExitCode("degraded"), 3);
});
