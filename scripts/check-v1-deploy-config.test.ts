import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantOrderV1DeploymentApprovalReport } from "../src/lib/merchantOrderV1DeploymentApproval.server";
import type { MerchantOrderV1DeploymentGuardReport } from "../src/lib/merchantOrderV1DeploymentGuard";
import {
  combineV1DeployConfigReport,
  parseV1DeployConfigOptions,
  renderV1DeployConfigReport,
  v1DeployConfigExitCode,
} from "./check-v1-deploy-config";

function makeReport(
  status: MerchantOrderV1DeploymentGuardReport["status"],
): MerchantOrderV1DeploymentGuardReport {
  return {
    schemaVersion: 1,
    status,
    evaluatedAt: "2026-07-26T15:30:00.000Z",
    readMode: "primary",
    readSiteIds: ["10000000"],
    dualWriteMode: "shadow",
    circuitBreakerEnabled: true,
    blockers: [],
    warnings: [],
  };
}

function makeApproval(
  status: MerchantOrderV1DeploymentApprovalReport["status"],
): MerchantOrderV1DeploymentApprovalReport {
  return {
    status,
    authorization:
      status === "not_required" ? null : "continuation",
    siteId: status === "not_required" ? null : "10000000",
    activatedAt:
      status === "not_required" ? null : "2026-07-26T14:00:00.000Z",
    evaluatedAt:
      status === "not_required" ? null : "2026-07-26T15:29:00.000Z",
    expiresAt:
      status === "not_required" ? null : "2026-07-26T16:30:00.000Z",
    blockers:
      status === "blocked"
        ? ["primary_approval_signature_invalid"]
        : [],
  };
}

test("deployment config options default to text and accept JSON", () => {
  assert.deepEqual(parseV1DeployConfigOptions([]), { format: "text" });
  assert.deepEqual(parseV1DeployConfigOptions(["--format=json"]), {
    format: "json",
  });
});

test("deployment config options reject unknown, duplicate, and invalid values", () => {
  assert.throws(
    () => parseV1DeployConfigOptions(["--file=config"]),
    /unknown_argument:file/,
  );
  assert.throws(
    () =>
      parseV1DeployConfigOptions(["--format=text", "--format=json"]),
    /duplicate_argument:format/,
  );
  assert.throws(
    () => parseV1DeployConfigOptions(["--format=xml"]),
    /format_must_be_text_or_json/,
  );
});

test("deployment config output is bounded and machine readable", () => {
  const report = combineV1DeployConfigReport({
    config: makeReport("ready"),
    approval: makeApproval("ready"),
  });
  assert.equal(
    renderV1DeployConfigReport(report, "text"),
    "[v1-deploy-config] status=ready read-mode=primary sites=10000000 dual-write=shadow circuit-breaker=true approval=ready approval-type=continuation approval-expires=2026-07-26T16:30:00.000Z blockers=- approval-blockers=- warnings=-",
  );
  assert.deepEqual(JSON.parse(renderV1DeployConfigReport(report, "json")), report);
});

test("deployment config status maps to stable exit codes", () => {
  assert.equal(v1DeployConfigExitCode("ready"), 0);
  assert.equal(v1DeployConfigExitCode("blocked"), 2);
});

test("deployment config combines runtime and approval failures", () => {
  assert.equal(
    combineV1DeployConfigReport({
      config: makeReport("ready"),
      approval: makeApproval("not_required"),
    }).status,
    "ready",
  );
  assert.equal(
    combineV1DeployConfigReport({
      config: makeReport("ready"),
      approval: makeApproval("blocked"),
    }).status,
    "blocked",
  );
  assert.equal(
    combineV1DeployConfigReport({
      config: makeReport("blocked"),
      approval: makeApproval("ready"),
    }).status,
    "blocked",
  );
});
