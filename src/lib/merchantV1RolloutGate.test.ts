import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMerchantV1RolloutGate,
  ORDER_V1_PRIMARY_REQUIRED_MIGRATIONS,
  type MerchantV1RolloutGateManifest,
} from "@/lib/merchantV1RolloutGate";

const SITE_ID = "10000000";
const NOW_MS = Date.parse("2026-08-02T12:00:00.000Z");
const DAY_MS = 24 * 3_600_000;

function createReadyManifest(): MerchantV1RolloutGateManifest {
  const firstObservedAt = new Date(NOW_MS - 8 * DAY_MS).toISOString();
  const lastObservedAt = new Date(NOW_MS - 60_000).toISOString();
  return {
    schemaVersion: 1,
    siteId: SITE_ID,
    domain: "orders",
    currentReadMode: "verify",
    targetReadMode: "primary",
    changeOwner: "faolla-ops",
    rollbackOwner: "faolla-oncall",
    reviewedAllowlist: [SITE_ID],
    appliedMigrations: [...ORDER_V1_PRIMARY_REQUIRED_MIGRATIONS],
    dualWrite: {
      mode: "shadow",
      siteIds: [SITE_ID],
      healthySince: new Date(NOW_MS - 9 * DAY_MS).toISOString(),
      observedAt: new Date(NOW_MS - 60_000).toISOString(),
      errorCount: 0,
    },
    backfill: {
      status: "complete",
      observedAt: new Date(NOW_MS - 8 * DAY_MS).toISOString(),
      sourceCount: 120,
      writtenCount: 120,
      failureCount: 0,
    },
    reconciliation: {
      status: "match",
      observedAt: new Date(NOW_MS - 60_000).toISOString(),
      legacyCount: 120,
      v1Count: 120,
      matchedCount: 120,
      missingCount: 0,
      unexpectedCount: 0,
      mismatchCount: 0,
    },
    readEvidence: {
      siteId: SITE_ID,
      status: "ready",
      evaluatedAt: new Date(NOW_MS - 60_000).toISOString(),
      policy: {
        domains: ["orders"],
        minimumSamplesPerDomain: 100,
        minimumObservationWindowHours: 168,
        maximumFallbackRate: 0,
        maximumP95DurationMs: 2500,
        maximumLastObservationAgeHours: 24,
      },
      rejectedLineCount: 0,
      ignoredLineCount: 0,
      blockers: [],
      domains: [
        {
          domain: "orders",
          status: "ready",
          sampleCount: 100,
          matchCount: 100,
          fallbackCount: 0,
          fallbackRate: 0,
          firstObservedAt,
          lastObservedAt,
          observationWindowHours: 191.98,
          latestObservationAgeHours: 0.02,
          p50DurationMs: 50,
          p95DurationMs: 100,
          p99DurationMs: 120,
          reasonCounts: { parity: 100 },
          blockers: [],
        },
      ],
    },
    outbox: {
      generatedAt: new Date(NOW_MS - 60_000).toISOString(),
      merchantScope: SITE_ID,
      windowHours: 24,
      pendingCount: 0,
      retryScheduledCount: 0,
      processingCount: 0,
      completedCount: 20,
      deadLetterCount: 0,
      dueCount: 0,
      scheduledCount: 0,
      expiredLeaseCount: 0,
      attemptLimitRiskCount: 0,
      unknownEventTypeCount: 0,
      oldestDueAgeSeconds: 0,
      attemptsInWindow: 20,
      completedAttemptsInWindow: 20,
      retryAttemptsInWindow: 0,
      deadLetterAttemptsInWindow: 0,
      leaseExpiredAttemptsInWindow: 0,
    },
  };
}

test("V1 rollout gate accepts a current single-merchant order primary decision", () => {
  const report = evaluateMerchantV1RolloutGate({
    manifest: createReadyManifest(),
    nowMs: NOW_MS,
  });

  assert.equal(report.status, "ready");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.siteId, SITE_ID);
  assert.equal(report.currentReadMode, "verify");
  assert.equal(report.targetReadMode, "primary");
});

test("V1 rollout gate blocks scope expansion and incomplete database evidence", () => {
  const manifest = createReadyManifest() as unknown as Record<string, unknown>;
  manifest.reviewedAllowlist = [SITE_ID, "10000001"];
  manifest.appliedMigrations = ["202607250001"];
  const dualWrite = manifest.dualWrite as Record<string, unknown>;
  dualWrite.siteIds = ["10000001"];
  const backfill = manifest.backfill as Record<string, unknown>;
  backfill.failureCount = 1;
  const reconciliation = manifest.reconciliation as Record<string, unknown>;
  reconciliation.mismatchCount = 1;

  const report = evaluateMerchantV1RolloutGate({
    manifest,
    nowMs: NOW_MS,
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("reviewed_allowlist_not_single_site"));
  assert.ok(report.blockers.includes("required_migration_missing"));
  assert.ok(report.blockers.includes("dual_write_site_missing"));
  assert.ok(report.blockers.includes("backfill_incomplete"));
  assert.ok(report.blockers.includes("reconciliation_not_match"));
});

test("V1 rollout gate blocks weak, stale, and unhealthy runtime evidence", () => {
  const manifest = createReadyManifest();
  manifest.readEvidence.policy.maximumP95DurationMs = 5_000;
  manifest.readEvidence.domains[0]!.sampleCount = 1;
  manifest.readEvidence.domains[0]!.matchCount = 1;
  manifest.readEvidence.evaluatedAt = new Date(NOW_MS - 2 * DAY_MS).toISOString();
  manifest.dualWrite.healthySince = new Date(
    NOW_MS - 2 * DAY_MS,
  ).toISOString();
  manifest.reconciliation.observedAt = new Date(
    NOW_MS - 2 * DAY_MS,
  ).toISOString();
  manifest.outbox.generatedAt = new Date(NOW_MS - 60 * 60_000).toISOString();
  manifest.outbox.deadLetterCount = 1;

  const report = evaluateMerchantV1RolloutGate({
    manifest,
    nowMs: NOW_MS,
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("read_evidence_policy_too_weak"));
  assert.ok(report.blockers.includes("read_evidence_not_ready"));
  assert.ok(report.blockers.includes("read_evidence_stale"));
  assert.ok(report.blockers.includes("dual_write_health_window_too_short"));
  assert.ok(report.blockers.includes("reconciliation_evidence_stale"));
  assert.ok(report.blockers.includes("outbox_snapshot_stale"));
  assert.ok(report.blockers.includes("outbox_unhealthy"));
});

test("V1 rollout gate blocks unsupported transitions and future evidence", () => {
  const manifest = createReadyManifest() as unknown as Record<string, unknown>;
  manifest.domain = "bookings";
  manifest.currentReadMode = "off";
  const outbox = manifest.outbox as Record<string, unknown>;
  outbox.generatedAt = new Date(NOW_MS + 10 * 60_000).toISOString();

  const report = evaluateMerchantV1RolloutGate({
    manifest,
    nowMs: NOW_MS,
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("unsupported_domain"));
  assert.ok(report.blockers.includes("invalid_read_transition"));
  assert.ok(report.blockers.includes("future_evidence"));
});

test("V1 rollout gate rejects malformed manifests without throwing", () => {
  const report = evaluateMerchantV1RolloutGate({
    manifest: null,
    nowMs: NOW_MS,
  });

  assert.equal(report.status, "blocked");
  assert.deepEqual(report.blockers, ["invalid_manifest"]);
  assert.equal(report.siteId, null);
});
