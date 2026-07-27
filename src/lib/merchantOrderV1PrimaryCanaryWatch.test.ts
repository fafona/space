import assert from "node:assert/strict";
import test from "node:test";

import type { MerchantOrderV1PrimaryCanaryReport } from "@/lib/merchantOrderV1PrimaryCanaryAudit";
import {
  completeMerchantOrderV1PrimaryCanaryWatchNotification,
  parseMerchantOrderV1PrimaryCanaryWatchState,
  planMerchantOrderV1PrimaryCanaryWatch,
} from "@/lib/merchantOrderV1PrimaryCanaryWatch";

const ACTIVATED_AT = "2026-07-25T00:00:00.000Z";
const NOW_MS = Date.parse("2026-07-26T12:00:00.000Z");

function createReport(
  patch: Partial<MerchantOrderV1PrimaryCanaryReport> = {},
): MerchantOrderV1PrimaryCanaryReport {
  return {
    siteId: "10000000",
    status: "healthy",
    activatedAt: ACTIVATED_AT,
    evaluatedAt: new Date(NOW_MS).toISOString(),
    policy: {
      minimumSamples: 100,
      minimumObservationWindowMinutes: 1440,
      maximumP95DurationMs: 2500,
      maximumLastObservationAgeMinutes: 15,
    },
    sampleCount: 120,
    matchCount: 120,
    fallbackCount: 0,
    circuitOpenCount: 0,
    rejectedLineCount: 0,
    ignoredLineCount: 0,
    firstObservedAt: "2026-07-25T11:00:00.000Z",
    lastObservedAt: "2026-07-26T11:59:00.000Z",
    observationWindowMinutes: 1499,
    latestObservationAgeMinutes: 1,
    p50DurationMs: 40,
    p95DurationMs: 90,
    p99DurationMs: 120,
    reasonCounts: { exact_match: 120 },
    rollbackReasons: [],
    observationBlockers: [],
    ...patch,
  };
}

test("an initial healthy canary records state without creating noise", () => {
  const result = planMerchantOrderV1PrimaryCanaryWatch({
    report: createReport(),
    previousState: null,
    rollbackReminderMinutes: 60,
    nowMs: NOW_MS,
  });

  assert.equal(result.notification, null);
  assert.equal(result.state.current.status, "healthy");
  assert.equal(result.state.pendingNotification, null);
  assert.equal(result.state.lastNotification, null);
});

test("rollback alerts are durable, retryable, deduplicated, and reminded", () => {
  const rollbackReport = createReport({
    status: "rollback_required",
    fallbackCount: 1,
    matchCount: 119,
    rollbackReasons: ["fallback_observed"],
  });
  const initial = planMerchantOrderV1PrimaryCanaryWatch({
    report: rollbackReport,
    previousState: null,
    rollbackReminderMinutes: 60,
    nowMs: NOW_MS,
  });

  assert.equal(initial.notification?.kind, "initial_issue");
  assert.equal(initial.notification?.severity, "critical");
  assert.match(initial.notification?.action ?? "", /READ_MODE=off/);

  const retry = planMerchantOrderV1PrimaryCanaryWatch({
    report: {
      ...rollbackReport,
      evaluatedAt: new Date(NOW_MS + 5 * 60 * 1000).toISOString(),
    },
    previousState: initial.state,
    rollbackReminderMinutes: 60,
    nowMs: NOW_MS + 5 * 60 * 1000,
  });
  assert.equal(retry.notification?.id, initial.notification?.id);

  const delivered = completeMerchantOrderV1PrimaryCanaryWatchNotification(
    retry.state,
    retry.notification?.id ?? "",
    new Date(NOW_MS + 5 * 60 * 1000).toISOString(),
  );
  const quiet = planMerchantOrderV1PrimaryCanaryWatch({
    report: {
      ...rollbackReport,
      evaluatedAt: new Date(NOW_MS + 30 * 60 * 1000).toISOString(),
    },
    previousState: delivered,
    rollbackReminderMinutes: 60,
    nowMs: NOW_MS + 30 * 60 * 1000,
  });
  assert.equal(quiet.notification, null);

  const reminder = planMerchantOrderV1PrimaryCanaryWatch({
    report: {
      ...rollbackReport,
      evaluatedAt: new Date(NOW_MS + 70 * 60 * 1000).toISOString(),
    },
    previousState: quiet.state,
    rollbackReminderMinutes: 60,
    nowMs: NOW_MS + 70 * 60 * 1000,
  });
  assert.equal(reminder.notification?.kind, "rollback_reminder");
  assert.notEqual(reminder.notification?.id, initial.notification?.id);
});

test("evidence changes and recovery create distinct transition notifications", () => {
  const observing = planMerchantOrderV1PrimaryCanaryWatch({
    report: createReport({
      status: "observing",
      sampleCount: 20,
      matchCount: 20,
      observationBlockers: ["insufficient_samples"],
    }),
    previousState: null,
    rollbackReminderMinutes: 60,
    nowMs: NOW_MS,
  });
  const observingDelivered =
    completeMerchantOrderV1PrimaryCanaryWatchNotification(
      observing.state,
      observing.notification?.id ?? "",
      new Date(NOW_MS).toISOString(),
    );
  const changed = planMerchantOrderV1PrimaryCanaryWatch({
    report: createReport({
      status: "observing",
      evaluatedAt: new Date(NOW_MS + 60_000).toISOString(),
      sampleCount: 20,
      matchCount: 20,
      observationBlockers: [
        "insufficient_samples",
        "latest_observation_stale",
      ],
    }),
    previousState: observingDelivered,
    rollbackReminderMinutes: 60,
    nowMs: NOW_MS + 60_000,
  });
  assert.equal(changed.notification?.kind, "evidence_changed");

  const changedDelivered =
    completeMerchantOrderV1PrimaryCanaryWatchNotification(
      changed.state,
      changed.notification?.id ?? "",
      new Date(NOW_MS + 60_000).toISOString(),
    );
  const recovered = planMerchantOrderV1PrimaryCanaryWatch({
    report: createReport({
      evaluatedAt: new Date(NOW_MS + 120_000).toISOString(),
    }),
    previousState: changedDelivered,
    rollbackReminderMinutes: 60,
    nowMs: NOW_MS + 120_000,
  });
  assert.equal(recovered.notification?.kind, "recovery");
  assert.equal(recovered.notification?.severity, "info");
  assert.equal(recovered.notification?.previousStatus, "observing");
});

test("watch state rejects scope drift, malformed pending events, and future data", () => {
  const planned = planMerchantOrderV1PrimaryCanaryWatch({
    report: createReport({
      status: "observing",
      observationBlockers: ["insufficient_samples"],
    }),
    previousState: null,
    rollbackReminderMinutes: 60,
    nowMs: NOW_MS,
  });
  const serialized = JSON.parse(JSON.stringify(planned.state)) as Record<
    string,
    unknown
  >;

  assert.deepEqual(
    parseMerchantOrderV1PrimaryCanaryWatchState(serialized, {
      siteId: "10000000",
      activatedAt: ACTIVATED_AT,
    }),
    planned.state,
  );
  assert.throws(
    () =>
      parseMerchantOrderV1PrimaryCanaryWatchState(serialized, {
        siteId: "10000001",
        activatedAt: ACTIVATED_AT,
      }),
    /scope_or_shape_mismatch/,
  );
  assert.throws(
    () =>
      parseMerchantOrderV1PrimaryCanaryWatchState(
        {
          ...serialized,
          pendingNotification: {
            ...(serialized.pendingNotification as Record<string, unknown>),
            action: 123,
          },
        },
        { siteId: "10000000", activatedAt: ACTIVATED_AT },
      ),
    /invalid_canary_watch_pending_notification/,
  );
  assert.throws(
    () =>
      planMerchantOrderV1PrimaryCanaryWatch({
        report: createReport({
          evaluatedAt: new Date(NOW_MS + 10 * 60 * 1000).toISOString(),
        }),
        previousState: null,
        rollbackReminderMinutes: 60,
        nowMs: NOW_MS,
      }),
    /report_is_from_future/,
  );
});
