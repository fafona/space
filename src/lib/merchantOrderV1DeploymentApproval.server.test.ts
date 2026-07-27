import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createMerchantOrderV1ContinuationDeploymentApprovalReceipt,
  createMerchantOrderV1DeploymentApprovalReceipt,
  evaluateMerchantOrderV1DeploymentApproval,
  invalidateMerchantOrderV1DeploymentApprovalReceipt,
  persistMerchantOrderV1DeploymentApproval,
  readMerchantOrderV1DeploymentApprovalReceipt,
  writeMerchantOrderV1DeploymentApprovalReceipt,
} from "@/lib/merchantOrderV1DeploymentApproval.server";
import type { MerchantOrderV1PrimaryCanaryWatchHealthReport } from "@/lib/merchantOrderV1PrimaryCanaryWatchHealth";
import type { MerchantV1RolloutGateReport } from "@/lib/merchantV1RolloutGate";

const NOW = Date.parse("2026-07-26T15:30:00.000Z");
const SIGNING_KEY = "stage-18-test-key-".repeat(4);
const OTHER_SIGNING_KEY = "other-stage-18-key-".repeat(4);
const NONCE = "00000000-0000-4000-8000-000000000001";
const CONTINUATION_NONCE = "00000000-0000-4000-8000-000000000002";
const MANIFEST_SOURCE = '{"schemaVersion":1,"siteId":"10000000"}';
const STATE_SOURCE = '{"schemaVersion":1,"siteId":"10000000"}';

function makeGateReport(
  overrides: Partial<MerchantV1RolloutGateReport> = {},
): MerchantV1RolloutGateReport {
  return {
    status: "ready",
    evaluatedAt: new Date(NOW).toISOString(),
    siteId: "10000000",
    domain: "orders",
    currentReadMode: "verify",
    targetReadMode: "primary",
    requiredMigrations: [
      "202607250001",
      "202607250002",
      "202607250007",
      "202607250008",
    ],
    blockers: [],
    warnings: [],
    ...overrides,
  };
}

function createReceipt(input?: {
  gateReport?: MerchantV1RolloutGateReport;
  nowMs?: number;
  ttlMs?: number;
}) {
  return createMerchantOrderV1DeploymentApprovalReceipt({
    gateReport: input?.gateReport ?? makeGateReport(),
    manifestSource: MANIFEST_SOURCE,
    signingKey: SIGNING_KEY,
    nowMs: input?.nowMs ?? NOW,
    ttlMs: input?.ttlMs,
    nonce: NONCE,
  });
}

function makeHealthReport(
  overrides: Partial<MerchantOrderV1PrimaryCanaryWatchHealthReport> = {},
): MerchantOrderV1PrimaryCanaryWatchHealthReport {
  return {
    schemaVersion: 1,
    status: "healthy",
    checkedAt: new Date(NOW).toISOString(),
    siteId: "10000000",
    activatedAt: "2026-07-26T14:00:00.000Z",
    canaryStatus: "healthy",
    stateUpdatedAt: "2026-07-26T15:29:00.000Z",
    stateAgeMinutes: 1,
    evaluatedAt: "2026-07-26T15:29:00.000Z",
    evaluationAgeMinutes: 1,
    pendingNotificationId: null,
    pendingNotificationAgeMinutes: null,
    blockers: [],
    warnings: [],
    ...overrides,
  };
}

function createContinuationReceipt(input?: {
  healthReport?: MerchantOrderV1PrimaryCanaryWatchHealthReport;
  nowMs?: number;
}) {
  return createMerchantOrderV1ContinuationDeploymentApprovalReceipt({
    healthReport: input?.healthReport ?? makeHealthReport(),
    stateSource: STATE_SOURCE,
    signingKey: SIGNING_KEY,
    nowMs: input?.nowMs ?? NOW,
    nonce: CONTINUATION_NONCE,
  });
}

test("ready rollout evidence produces a signed, scoped approval", () => {
  const receipt = createReceipt();
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.authorization, "order_v1_primary_activation");
  assert.equal(receipt.siteId, "10000000");
  assert.equal(receipt.activatedAt, null);
  assert.equal(receipt.issuedAt, "2026-07-26T15:30:00.000Z");
  assert.equal(receipt.expiresAt, "2026-07-26T16:30:00.000Z");
  assert.match(receipt.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.signature, /^[A-Za-z0-9_-]{43}$/);

  const report = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000000"],
    receipt,
    signingKey: SIGNING_KEY,
    nowMs: NOW + 30 * 60_000,
  });
  assert.equal(report.status, "ready");
  assert.equal(report.authorization, "activation");
  assert.equal(report.evaluatedAt, receipt.evaluatedAt);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.expiresAt, receipt.expiresAt);
});

test("fresh healthy canary evidence produces a scoped continuation approval", () => {
  const receipt = createContinuationReceipt();
  assert.equal(
    receipt.authorization,
    "order_v1_primary_continuation",
  );
  assert.equal(receipt.siteId, "10000000");
  assert.equal(receipt.activatedAt, "2026-07-26T14:00:00.000Z");
  assert.match(receipt.evidenceSha256, /^[a-f0-9]{64}$/);

  const report = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000000"],
    receipt,
    signingKey: SIGNING_KEY,
    nowMs: NOW + 30 * 60_000,
  });
  assert.equal(report.status, "ready");
  assert.equal(report.authorization, "continuation");
  assert.equal(report.activatedAt, receipt.activatedAt);
  assert.deepEqual(report.blockers, []);
});

test("off and verify modes do not require an approval secret or receipt", () => {
  for (const readMode of ["off", "verify"]) {
    const report = evaluateMerchantOrderV1DeploymentApproval({
      readMode,
      readSiteIds: readMode === "verify" ? ["10000000"] : [],
      nowMs: NOW,
    });
    assert.equal(report.status, "not_required");
    assert.deepEqual(report.blockers, []);
  }
});

test("primary mode fails closed for missing approval inputs", () => {
  const report = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000000"],
    loadBlocker: "primary_approval_receipt_file_not_configured",
    nowMs: NOW,
  });
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.blockers, [
    "primary_approval_key_missing_or_weak",
    "primary_approval_receipt_file_not_configured",
  ]);
});

test("wrong signatures and merchant scopes are rejected", () => {
  const receipt = createReceipt();
  const wrongKey = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000000"],
    receipt,
    signingKey: OTHER_SIGNING_KEY,
    nowMs: NOW,
  });
  assert.ok(
    wrongKey.blockers.includes("primary_approval_signature_invalid"),
  );

  const wrongScope = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000001"],
    receipt,
    signingKey: SIGNING_KEY,
    nowMs: NOW,
  });
  assert.ok(wrongScope.blockers.includes("primary_approval_scope_mismatch"));
});

test("expired, future, malformed, and overlong approvals are rejected", () => {
  const receipt = createReceipt();
  const expired = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000000"],
    receipt,
    signingKey: SIGNING_KEY,
    nowMs: Date.parse(receipt.expiresAt),
  });
  assert.ok(expired.blockers.includes("primary_approval_expired"));

  const futureNow = NOW + 10 * 60_000;
  const futureReceipt = createReceipt({
    gateReport: makeGateReport({
      evaluatedAt: new Date(futureNow).toISOString(),
    }),
    nowMs: futureNow,
  });
  const future = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000000"],
    receipt: futureReceipt,
    signingKey: SIGNING_KEY,
    nowMs: NOW,
  });
  assert.ok(future.blockers.includes("primary_approval_not_yet_valid"));

  const malformed = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000000"],
    receipt: { ...receipt, signature: "not-a-signature" },
    signingKey: SIGNING_KEY,
    nowMs: NOW,
  });
  assert.ok(malformed.blockers.includes("primary_approval_receipt_invalid"));

  const unsignedExtension = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000000"],
    receipt: { ...receipt, operator: "not-signed" },
    signingKey: SIGNING_KEY,
    nowMs: NOW,
  });
  assert.ok(
    unsignedExtension.blockers.includes(
      "primary_approval_receipt_invalid",
    ),
  );

  const overlong = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000000"],
    receipt: {
      ...receipt,
      expiresAt: new Date(NOW + 25 * 60 * 60_000).toISOString(),
    },
    signingKey: SIGNING_KEY,
    nowMs: NOW,
  });
  assert.ok(
    overlong.blockers.includes("primary_approval_lifetime_invalid"),
  );
  assert.ok(
    overlong.blockers.includes("primary_approval_signature_invalid"),
  );
});

test("approval creation rejects blocked, stale, and weakly signed gates", () => {
  assert.throws(
    () =>
      createMerchantOrderV1DeploymentApprovalReceipt({
        gateReport: makeGateReport({
          status: "blocked",
          blockers: ["outbox_unhealthy"],
        }),
        manifestSource: MANIFEST_SOURCE,
        signingKey: SIGNING_KEY,
        nowMs: NOW,
        nonce: NONCE,
      }),
    /primary_approval_gate_not_ready/,
  );
  assert.throws(
    () =>
      createMerchantOrderV1DeploymentApprovalReceipt({
        gateReport: makeGateReport({
          evaluatedAt: new Date(NOW - 6 * 60_000).toISOString(),
        }),
        manifestSource: MANIFEST_SOURCE,
        signingKey: SIGNING_KEY,
        nowMs: NOW,
        nonce: NONCE,
      }),
    /primary_approval_gate_evaluation_not_current/,
  );
  assert.throws(
    () =>
      createMerchantOrderV1DeploymentApprovalReceipt({
        gateReport: makeGateReport(),
        manifestSource: MANIFEST_SOURCE,
        signingKey: "too-short",
        nowMs: NOW,
        nonce: NONCE,
      }),
    /primary_approval_key_missing_or_weak/,
  );
});

test("continuation approval rejects degraded, stale, and incomplete health", () => {
  assert.throws(
    () =>
      createContinuationReceipt({
        healthReport: makeHealthReport({
          status: "degraded",
          canaryStatus: "observing",
          warnings: ["canary_observing"],
        }),
      }),
    /primary_continuation_health_not_ready/,
  );
  assert.throws(
    () =>
      createContinuationReceipt({
        healthReport: makeHealthReport({
          status: "critical",
          blockers: ["state_stale"],
        }),
      }),
    /primary_continuation_health_not_ready/,
  );
  assert.throws(
    () =>
      createContinuationReceipt({
        healthReport: makeHealthReport({
          checkedAt: new Date(NOW - 6 * 60_000).toISOString(),
        }),
      }),
    /primary_continuation_health_not_current/,
  );
  assert.throws(
    () =>
      createContinuationReceipt({
        healthReport: makeHealthReport({
          stateUpdatedAt: null,
        }),
      }),
    /primary_continuation_health_not_ready/,
  );
});

test("approval receipt files are atomic, bounded, and invalidatable", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "faolla-v1-approval-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const receiptFile = join(directory, "approval.json");
  const receipt = createReceipt();

  await writeMerchantOrderV1DeploymentApprovalReceipt(receiptFile, receipt);
  const loaded = await readMerchantOrderV1DeploymentApprovalReceipt(
    receiptFile,
  );
  assert.equal(loaded.blocker, null);
  assert.deepEqual(loaded.receipt, receipt);

  await invalidateMerchantOrderV1DeploymentApprovalReceipt(receiptFile);
  const missing = await readMerchantOrderV1DeploymentApprovalReceipt(
    receiptFile,
  );
  assert.equal(missing.blocker, "primary_approval_receipt_missing");

  await writeFile(receiptFile, "x".repeat(16 * 1024 + 1), "utf8");
  const oversized = await readMerchantOrderV1DeploymentApprovalReceipt(
    receiptFile,
  );
  assert.equal(
    oversized.blocker,
    "primary_approval_receipt_too_large",
  );
});

test("persisting an approval writes the receipt and one signed audit record", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "faolla-v1-approval-audit-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const receiptFile = join(directory, "approval.json");
  const auditFile = join(directory, "approval.audit.jsonl");
  const receipt = createContinuationReceipt();

  await persistMerchantOrderV1DeploymentApproval({
    receiptFile,
    auditFile,
    receipt,
  });

  const loaded = await readMerchantOrderV1DeploymentApprovalReceipt(
    receiptFile,
  );
  assert.deepEqual(loaded, { receipt, blocker: null });
  const lines = (await readFile(auditFile, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0] ?? ""), {
    schemaVersion: 1,
    event: "merchant_order_v1_deployment_approval_issued",
    recordedAt: receipt.issuedAt,
    receipt,
  });

  const auditedReceipt = JSON.parse(lines[0] ?? "").receipt;
  const report = evaluateMerchantOrderV1DeploymentApproval({
    readMode: "primary",
    readSiteIds: ["10000000"],
    receipt: auditedReceipt,
    signingKey: SIGNING_KEY,
    nowMs: NOW,
  });
  assert.equal(report.status, "ready");
  assert.equal(report.authorization, "continuation");
});

test("audit failures fail closed and remove a newly written receipt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "faolla-v1-approval-fail-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const receiptFile = join(directory, "approval.json");
  const auditDirectory = join(directory, "audit-directory");
  const receipt = createReceipt();
  await writeFile(auditDirectory, "occupied", "utf8");

  await assert.rejects(
    persistMerchantOrderV1DeploymentApproval({
      receiptFile,
      auditFile: join(auditDirectory, "approval.audit.jsonl"),
      receipt,
    }),
  );
  const loaded = await readMerchantOrderV1DeploymentApprovalReceipt(
    receiptFile,
  );
  assert.equal(loaded.blocker, "primary_approval_receipt_missing");

  await assert.rejects(
    persistMerchantOrderV1DeploymentApproval({
      receiptFile,
      auditFile: receiptFile,
      receipt,
    }),
    /primary_approval_receipt_and_audit_paths_must_differ/,
  );
});
