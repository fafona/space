import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMerchantOrderV1PrimaryCanaryWatchHealth,
  type MerchantOrderV1PrimaryCanaryWatchHealthReport,
} from "@/lib/merchantOrderV1PrimaryCanaryWatchHealth";
import type {
  MerchantOrderV1PrimaryCanaryWatchNotification,
  MerchantOrderV1PrimaryCanaryWatchState,
} from "@/lib/merchantOrderV1PrimaryCanaryWatch";

const NOW = Date.parse("2026-07-26T12:00:00.000Z");
const SITE_ID = "10000000";
const ACTIVATED_AT = "2026-07-25T00:00:00.000Z";

function makeState(
  overrides: Partial<MerchantOrderV1PrimaryCanaryWatchState> = {},
): MerchantOrderV1PrimaryCanaryWatchState {
  return {
    schemaVersion: 1,
    siteId: SITE_ID,
    activatedAt: ACTIVATED_AT,
    updatedAt: "2026-07-26T11:58:00.000Z",
    current: {
      status: "healthy",
      fingerprint: "healthy|-|-",
      evaluatedAt: "2026-07-26T11:58:00.000Z",
      sampleCount: 300,
      fallbackCount: 0,
      circuitOpenCount: 0,
      p95DurationMs: 125,
      latestObservationAgeMinutes: 1,
      rollbackReasons: [],
      observationBlockers: [],
    },
    lastNotification: null,
    pendingNotification: null,
    ...overrides,
  };
}

function evaluate(
  state: MerchantOrderV1PrimaryCanaryWatchState | null,
): MerchantOrderV1PrimaryCanaryWatchHealthReport {
  return evaluateMerchantOrderV1PrimaryCanaryWatchHealth({
    state,
    siteId: SITE_ID,
    activatedAt: ACTIVATED_AT,
    nowMs: NOW,
  });
}

test("reports a fresh healthy watch state as healthy", () => {
  const report = evaluate(makeState());
  assert.equal(report.status, "healthy");
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.stateAgeMinutes, 2);
  assert.equal(report.evaluationAgeMinutes, 2);
});

test("reports missing and unreadable state as critical", () => {
  const missing = evaluate(null);
  assert.equal(missing.status, "critical");
  assert.deepEqual(missing.blockers, ["state_missing"]);

  const unreadable = evaluateMerchantOrderV1PrimaryCanaryWatchHealth({
    state: null,
    stateUnreadable: true,
    siteId: SITE_ID,
    activatedAt: ACTIVATED_AT,
    nowMs: NOW,
  });
  assert.equal(unreadable.status, "critical");
  assert.deepEqual(unreadable.blockers, ["state_unreadable"]);
});

test("reports stale state and stale evaluation independently", () => {
  const stale = evaluate(
    makeState({
      updatedAt: "2026-07-26T11:40:00.000Z",
      current: {
        ...makeState().current,
        evaluatedAt: "2026-07-26T11:39:00.000Z",
      },
    }),
  );
  assert.equal(stale.status, "critical");
  assert.deepEqual(stale.blockers, ["state_stale", "evaluation_stale"]);
});

test("reports observing as degraded and rollback as critical", () => {
  const observing = evaluate(
    makeState({
      current: {
        ...makeState().current,
        status: "observing",
        fingerprint: "observing|-|insufficient_samples",
        observationBlockers: ["insufficient_samples"],
      },
    }),
  );
  assert.equal(observing.status, "degraded");
  assert.deepEqual(observing.warnings, ["canary_observing"]);

  const rollback = evaluate(
    makeState({
      current: {
        ...makeState().current,
        status: "rollback_required",
        fingerprint: "rollback_required|fallback_observed|-",
        fallbackCount: 1,
        rollbackReasons: ["fallback_observed"],
      },
    }),
  );
  assert.equal(rollback.status, "critical");
  assert.ok(rollback.blockers.includes("rollback_required"));
});

test("reports pending delivery as degraded before it becomes stale", () => {
  const state = makeState();
  const notification: MerchantOrderV1PrimaryCanaryWatchNotification = {
    schemaVersion: 1,
    id: "order-v1-primary-canary:10000000:1:recovery",
    event: "merchant_order_v1_primary_canary_watch",
    kind: "recovery",
    severity: "info",
    createdAt: "2026-07-26T11:58:00.000Z",
    siteId: SITE_ID,
    activatedAt: ACTIVATED_AT,
    previousStatus: "observing",
    current: state.current,
    message: "Recovered.",
    action: null,
  };
  const pending = evaluate(
    makeState({
      pendingNotification: notification,
    }),
  );
  assert.equal(pending.status, "degraded");
  assert.deepEqual(pending.warnings, ["pending_notification_delivery"]);
  assert.equal(pending.pendingNotificationAgeMinutes, 2);

  const stale = evaluate(
    makeState({
      pendingNotification: {
        ...notification,
        createdAt: "2026-07-26T11:50:00.000Z",
      },
    }),
  );
  assert.equal(stale.status, "critical");
  assert.ok(stale.blockers.includes("pending_notification_stale"));
});

test("detects future timestamps and inconsistent state", () => {
  const state = makeState({
    updatedAt: "2026-07-26T12:06:00.000Z",
    current: {
      ...makeState().current,
      evaluatedAt: "2026-07-26T12:07:00.000Z",
    },
    lastNotification: {
      id: "notification-1",
      status: "healthy",
      fingerprint: "healthy|-|-",
      notifiedAt: "2026-07-26T12:08:00.000Z",
    },
  });
  const report = evaluate(state);
  assert.equal(report.status, "critical");
  assert.ok(report.blockers.includes("state_updated_from_future"));
  assert.ok(report.blockers.includes("evaluation_from_future"));
  assert.ok(report.blockers.includes("last_notification_from_future"));
  assert.ok(report.blockers.includes("state_precedes_evaluation"));
});

test("rejects invalid policy and ambiguous state availability", () => {
  assert.throws(
    () =>
      evaluateMerchantOrderV1PrimaryCanaryWatchHealth({
        state: makeState(),
        siteId: SITE_ID,
        activatedAt: ACTIVATED_AT,
        policy: {
          maximumStateAgeMinutes: 0,
          maximumPendingDeliveryAgeMinutes: 5,
        },
        nowMs: NOW,
      }),
    /maximum_state_age_minutes_must_be_between_1_and_1440/,
  );
  assert.throws(
    () =>
      evaluateMerchantOrderV1PrimaryCanaryWatchHealth({
        state: makeState(),
        stateUnreadable: true,
        siteId: SITE_ID,
        activatedAt: ACTIVATED_AT,
        nowMs: NOW,
      }),
    /state_and_state_unreadable_are_mutually_exclusive/,
  );
});
