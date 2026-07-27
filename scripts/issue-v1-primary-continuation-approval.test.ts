import assert from "node:assert/strict";
import test from "node:test";

import {
  parseV1PrimaryContinuationApprovalOptions,
  renderV1PrimaryContinuationApprovalReport,
  type V1PrimaryContinuationApprovalReport,
  v1PrimaryContinuationApprovalExitCode,
} from "./issue-v1-primary-continuation-approval";

const BASE_ARGS = [
  "--state-file=.runtime/order-v1-canary-10000000.json",
  "--site=10000000",
  "--activated-at=2026-07-25T00:00:00Z",
  "--receipt-file=.runtime/order-v1-primary-approval.json",
];

test("continuation approval options use bounded operational defaults", () => {
  assert.deepEqual(
    parseV1PrimaryContinuationApprovalOptions(BASE_ARGS),
    {
      stateFile: ".runtime/order-v1-canary-10000000.json",
      siteId: "10000000",
      activatedAt: "2026-07-25T00:00:00.000Z",
      receiptFile: ".runtime/order-v1-primary-approval.json",
      auditFile:
        ".runtime/order-v1-primary-approval.json.audit.jsonl",
      ttlMinutes: 60,
      maximumStateAgeMinutes: 15,
      maximumPendingDeliveryAgeMinutes: 5,
      format: "text",
    },
  );
});

test("continuation approval options accept explicit audit and policy values", () => {
  const options = parseV1PrimaryContinuationApprovalOptions([
    ...BASE_ARGS,
    "--audit-file=.runtime/order-v1-approval-audit.jsonl",
    "--ttl-minutes=30",
    "--max-state-age-minutes=10",
    "--max-pending-age-minutes=3",
    "--format=json",
  ]);
  assert.equal(
    options.auditFile,
    ".runtime/order-v1-approval-audit.jsonl",
  );
  assert.equal(options.ttlMinutes, 30);
  assert.equal(options.maximumStateAgeMinutes, 10);
  assert.equal(options.maximumPendingDeliveryAgeMinutes, 3);
  assert.equal(options.format, "json");
});

test("continuation approval options reject missing, duplicate, and unsafe values", () => {
  assert.throws(
    () =>
      parseV1PrimaryContinuationApprovalOptions(
        BASE_ARGS.filter((argument) => !argument.startsWith("--state-file=")),
      ),
    /state_file_is_required/,
  );
  assert.throws(
    () =>
      parseV1PrimaryContinuationApprovalOptions([
        ...BASE_ARGS,
        "--site=10000001",
      ]),
    /duplicate_argument:site/,
  );
  assert.throws(
    () =>
      parseV1PrimaryContinuationApprovalOptions([
        ...BASE_ARGS,
        "--ttl-minutes=1441",
      ]),
    /ttl_minutes_must_be_between_5_and_1440/,
  );
  assert.throws(
    () =>
      parseV1PrimaryContinuationApprovalOptions([
        ...BASE_ARGS,
        "--format=xml",
      ]),
    /format_must_be_text_or_json/,
  );
});

function makeReport(
  overrides: Partial<V1PrimaryContinuationApprovalReport> = {},
): V1PrimaryContinuationApprovalReport {
  return {
    schemaVersion: 1,
    status: "issued",
    authorization: "continuation",
    siteId: "10000000",
    healthStatus: "healthy",
    expiresAt: "2026-07-26T16:30:00.000Z",
    blockers: [],
    warnings: [],
    audit: "appended",
    ...overrides,
  };
}

test("continuation approval output is bounded and machine readable", () => {
  const report = makeReport();
  assert.equal(
    renderV1PrimaryContinuationApprovalReport(report, "text"),
    "[v1-primary-continuation-approval] status=issued site=10000000 health=healthy authorization=continuation expires-at=2026-07-26T16:30:00.000Z audit=appended blockers=- warnings=-",
  );
  assert.deepEqual(
    JSON.parse(renderV1PrimaryContinuationApprovalReport(report, "json")),
    report,
  );
});

test("continuation approval maps blocked evidence to a deployment stop", () => {
  assert.equal(v1PrimaryContinuationApprovalExitCode("issued"), 0);
  assert.equal(v1PrimaryContinuationApprovalExitCode("blocked"), 2);
  const report = makeReport({
    status: "blocked",
    authorization: null,
    healthStatus: "critical",
    expiresAt: null,
    blockers: ["state_stale"],
    audit: null,
  });
  assert.match(
    renderV1PrimaryContinuationApprovalReport(report, "text"),
    /status=blocked.*blockers=state_stale/,
  );
});
