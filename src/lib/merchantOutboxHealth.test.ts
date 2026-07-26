import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMerchantOutboxHealth,
  normalizeMerchantOutboxHealthSnapshot,
} from "@/lib/merchantOutboxHealth";

function healthSnapshot(overrides: Record<string, unknown> = {}) {
  return normalizeMerchantOutboxHealthSnapshot({
    generated_at: "2026-07-25T10:00:00.000Z",
    merchant_scope: "all",
    window_hours: 24,
    pending_count: 2,
    retry_scheduled_count: 0,
    processing_count: 1,
    completed_count: 20,
    dead_letter_count: 0,
    due_count: 0,
    scheduled_count: 2,
    expired_lease_count: 0,
    attempt_limit_risk_count: 0,
    unknown_event_type_count: 0,
    oldest_due_age_seconds: 0,
    attempts_in_window: 10,
    completed_attempts_in_window: 10,
    retry_attempts_in_window: 0,
    dead_letter_attempts_in_window: 0,
    lease_expired_attempts_in_window: 0,
    ...overrides,
  });
}

test("outbox health normalizes aggregate values without business data", () => {
  const snapshot = healthSnapshot({ pending_count: "3" });
  assert.equal(snapshot.pendingCount, 3);
  assert.equal(snapshot.completedAttemptsInWindow, 10);
  assert.equal(snapshot.merchantScope, "all");
});

test("healthy outbox has no blockers or warnings", () => {
  assert.deepEqual(evaluateMerchantOutboxHealth(healthSnapshot()), {
    status: "healthy",
    blockers: [],
    warnings: [],
  });
});

test("expired leases, dead letters, unknown types and old backlog degrade health", () => {
  const evaluation = evaluateMerchantOutboxHealth(
    healthSnapshot({
      expired_lease_count: 1,
      dead_letter_count: 2,
      unknown_event_type_count: 1,
      oldest_due_age_seconds: 301,
    }),
  );
  assert.equal(evaluation.status, "degraded");
  assert.deepEqual(evaluation.blockers, [
    "expired_leases",
    "dead_letters",
    "unknown_event_types",
    "oldest_due_age_exceeded",
  ]);
});

test("near-limit attempts and retries are warnings but not blockers", () => {
  const evaluation = evaluateMerchantOutboxHealth(
    healthSnapshot({
      attempt_limit_risk_count: 2,
      retry_attempts_in_window: 3,
      lease_expired_attempts_in_window: 1,
    }),
  );
  assert.equal(evaluation.status, "healthy");
  assert.deepEqual(evaluation.warnings, [
    "attempt_limit_risk",
    "recent_retries",
    "recent_lease_expiry",
  ]);
});

test("outbox health rejects invalid scope and timestamps", () => {
  assert.throws(
    () => healthSnapshot({ generated_at: "not-a-date" }),
    /invalid_outbox_health_generated_at/,
  );
  assert.throws(
    () => healthSnapshot({ merchant_scope: "*" }),
    /invalid_outbox_health_scope/,
  );
});
