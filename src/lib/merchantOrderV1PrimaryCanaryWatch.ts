import type {
  MerchantOrderV1PrimaryCanaryObservationBlocker,
  MerchantOrderV1PrimaryCanaryReport,
  MerchantOrderV1PrimaryCanaryRollbackReason,
} from "@/lib/merchantOrderV1PrimaryCanaryAudit";

export const MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_STATE_VERSION = 1;

export type MerchantOrderV1PrimaryCanaryWatchStatus =
  MerchantOrderV1PrimaryCanaryReport["status"];

export type MerchantOrderV1PrimaryCanaryWatchNotificationKind =
  | "initial_issue"
  | "status_changed"
  | "evidence_changed"
  | "rollback_reminder"
  | "recovery";

export type MerchantOrderV1PrimaryCanaryWatchSnapshot = {
  status: MerchantOrderV1PrimaryCanaryWatchStatus;
  fingerprint: string;
  evaluatedAt: string;
  sampleCount: number;
  fallbackCount: number;
  circuitOpenCount: number;
  p95DurationMs: number | null;
  latestObservationAgeMinutes: number | null;
  rollbackReasons: MerchantOrderV1PrimaryCanaryRollbackReason[];
  observationBlockers: MerchantOrderV1PrimaryCanaryObservationBlocker[];
};

export type MerchantOrderV1PrimaryCanaryWatchNotification = {
  schemaVersion: 1;
  id: string;
  event: "merchant_order_v1_primary_canary_watch";
  kind: MerchantOrderV1PrimaryCanaryWatchNotificationKind;
  severity: "info" | "warning" | "critical";
  createdAt: string;
  siteId: string;
  activatedAt: string;
  previousStatus: MerchantOrderV1PrimaryCanaryWatchStatus | null;
  current: MerchantOrderV1PrimaryCanaryWatchSnapshot;
  message: string;
  action: string | null;
};

export type MerchantOrderV1PrimaryCanaryWatchState = {
  schemaVersion: 1;
  siteId: string;
  activatedAt: string;
  updatedAt: string;
  current: MerchantOrderV1PrimaryCanaryWatchSnapshot;
  lastNotification: {
    id: string;
    status: MerchantOrderV1PrimaryCanaryWatchStatus;
    fingerprint: string;
    notifiedAt: string;
  } | null;
  pendingNotification: MerchantOrderV1PrimaryCanaryWatchNotification | null;
};

const SITE_ID_PATTERN = /^\d{8}$/;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ROLLBACK_REASONS = new Set<MerchantOrderV1PrimaryCanaryRollbackReason>([
  "fallback_observed",
  "circuit_open_observed",
  "p95_duration_exceeded",
]);
const OBSERVATION_BLOCKERS =
  new Set<MerchantOrderV1PrimaryCanaryObservationBlocker>([
    "no_observations",
    "insufficient_samples",
    "insufficient_observation_window",
    "latest_observation_stale",
    "future_observation",
    "rejected_observation_lines",
    "mode_drift_observed",
  ]);
const STATUSES = new Set<MerchantOrderV1PrimaryCanaryWatchStatus>([
  "healthy",
  "observing",
  "rollback_required",
]);
const NOTIFICATION_KINDS =
  new Set<MerchantOrderV1PrimaryCanaryWatchNotificationKind>([
    "initial_issue",
    "status_changed",
    "evidence_changed",
    "rollback_reminder",
    "recovery",
  ]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isBoundedString(value: unknown, maximumLength = 500) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

function isNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNullableNonNegativeNumber(value: unknown) {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function isStatus(
  value: unknown,
): value is MerchantOrderV1PrimaryCanaryWatchStatus {
  return (
    typeof value === "string" &&
    STATUSES.has(value as MerchantOrderV1PrimaryCanaryWatchStatus)
  );
}

function isStringArrayFromSet<T extends string>(
  value: unknown,
  allowed: Set<T>,
): value is T[] {
  return (
    Array.isArray(value) &&
    value.length <= allowed.size &&
    value.every(
      (item, index) =>
        typeof item === "string" &&
        allowed.has(item as T) &&
        value.indexOf(item) === index,
    )
  );
}

function isSnapshot(
  value: unknown,
): value is MerchantOrderV1PrimaryCanaryWatchSnapshot {
  if (!isRecord(value)) return false;
  return (
    isStatus(value.status) &&
    isBoundedString(value.fingerprint, 300) &&
    normalizeTimestamp(value.evaluatedAt) === value.evaluatedAt &&
    isNonNegativeInteger(value.sampleCount) &&
    isNonNegativeInteger(value.fallbackCount) &&
    isNonNegativeInteger(value.circuitOpenCount) &&
    isNullableNonNegativeNumber(value.p95DurationMs) &&
    isNullableNonNegativeNumber(value.latestObservationAgeMinutes) &&
    isStringArrayFromSet(value.rollbackReasons, ROLLBACK_REASONS) &&
    isStringArrayFromSet(value.observationBlockers, OBSERVATION_BLOCKERS)
  );
}

function isNotification(
  value: unknown,
): value is MerchantOrderV1PrimaryCanaryWatchNotification {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    isBoundedString(value.id, 300) &&
    value.event === "merchant_order_v1_primary_canary_watch" &&
    typeof value.kind === "string" &&
    NOTIFICATION_KINDS.has(
      value.kind as MerchantOrderV1PrimaryCanaryWatchNotificationKind,
    ) &&
    (value.severity === "info" ||
      value.severity === "warning" ||
      value.severity === "critical") &&
    normalizeTimestamp(value.createdAt) === value.createdAt &&
    typeof value.siteId === "string" &&
    SITE_ID_PATTERN.test(value.siteId) &&
    normalizeTimestamp(value.activatedAt) === value.activatedAt &&
    (value.previousStatus === null || isStatus(value.previousStatus)) &&
    isSnapshot(value.current) &&
    isBoundedString(value.message, 1000) &&
    (value.action === null || isBoundedString(value.action, 1000))
  );
}

function buildFingerprint(report: MerchantOrderV1PrimaryCanaryReport) {
  return [
    report.status,
    [...report.rollbackReasons].sort().join(",") || "-",
    [...report.observationBlockers].sort().join(",") || "-",
  ].join("|");
}

function snapshotReport(
  report: MerchantOrderV1PrimaryCanaryReport,
): MerchantOrderV1PrimaryCanaryWatchSnapshot {
  return {
    status: report.status,
    fingerprint: buildFingerprint(report),
    evaluatedAt: report.evaluatedAt,
    sampleCount: report.sampleCount,
    fallbackCount: report.fallbackCount,
    circuitOpenCount: report.circuitOpenCount,
    p95DurationMs: report.p95DurationMs,
    latestObservationAgeMinutes: report.latestObservationAgeMinutes,
    rollbackReasons: [...report.rollbackReasons],
    observationBlockers: [...report.observationBlockers],
  };
}

function buildNotification(input: {
  kind: MerchantOrderV1PrimaryCanaryWatchNotificationKind;
  siteId: string;
  activatedAt: string;
  previousStatus: MerchantOrderV1PrimaryCanaryWatchStatus | null;
  current: MerchantOrderV1PrimaryCanaryWatchSnapshot;
  nowMs: number;
}): MerchantOrderV1PrimaryCanaryWatchNotification {
  const createdAt = new Date(input.nowMs).toISOString();
  const severity =
    input.current.status === "rollback_required"
      ? "critical"
      : input.current.status === "observing"
        ? "warning"
        : "info";
  const message =
    input.current.status === "rollback_required"
      ? "Order V1 primary canary requires operator rollback."
      : input.current.status === "observing"
        ? "Order V1 primary canary is not yet healthy and needs observation."
        : "Order V1 primary canary has recovered to healthy.";
  return {
    schemaVersion: 1,
    id: [
      "order-v1-primary-canary",
      input.siteId,
      input.nowMs,
      input.kind,
    ].join(":"),
    event: "merchant_order_v1_primary_canary_watch",
    kind: input.kind,
    severity,
    createdAt,
    siteId: input.siteId,
    activatedAt: input.activatedAt,
    previousStatus: input.previousStatus,
    current: input.current,
    message,
    action:
      input.current.status === "rollback_required"
        ? "Set MERCHANT_ORDER_V1_READ_MODE=off for this canary, redeploy, and retain evidence."
        : null,
  };
}

export function parseMerchantOrderV1PrimaryCanaryWatchState(
  value: unknown,
  expected: { siteId: string; activatedAt: string },
): MerchantOrderV1PrimaryCanaryWatchState {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("invalid_canary_watch_state");
  }
  const activatedAt = normalizeTimestamp(value.activatedAt);
  if (
    value.siteId !== expected.siteId ||
    activatedAt !== expected.activatedAt ||
    value.activatedAt !== activatedAt ||
    normalizeTimestamp(value.updatedAt) !== value.updatedAt ||
    !isSnapshot(value.current)
  ) {
    throw new Error("canary_watch_state_scope_or_shape_mismatch");
  }

  const lastNotification = value.lastNotification;
  if (
    lastNotification !== null &&
    (!isRecord(lastNotification) ||
      !isBoundedString(lastNotification.id, 300) ||
      !isStatus(lastNotification.status) ||
      !isBoundedString(lastNotification.fingerprint, 300) ||
      normalizeTimestamp(lastNotification.notifiedAt) !==
        lastNotification.notifiedAt)
  ) {
    throw new Error("invalid_canary_watch_last_notification");
  }
  if (
    value.pendingNotification !== null &&
    !isNotification(value.pendingNotification)
  ) {
    throw new Error("invalid_canary_watch_pending_notification");
  }
  if (
    value.pendingNotification &&
    (value.pendingNotification.siteId !== expected.siteId ||
      value.pendingNotification.activatedAt !== expected.activatedAt)
  ) {
    throw new Error("canary_watch_pending_notification_scope_mismatch");
  }

  return value as MerchantOrderV1PrimaryCanaryWatchState;
}

export function planMerchantOrderV1PrimaryCanaryWatch(input: {
  report: MerchantOrderV1PrimaryCanaryReport;
  previousState: MerchantOrderV1PrimaryCanaryWatchState | null;
  rollbackReminderMinutes: number;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("invalid_canary_watch_now");
  if (
    !Number.isInteger(input.rollbackReminderMinutes) ||
    input.rollbackReminderMinutes < 5 ||
    input.rollbackReminderMinutes > 1440
  ) {
    throw new Error("rollback_reminder_minutes_must_be_between_5_and_1440");
  }
  if (!SITE_ID_PATTERN.test(input.report.siteId)) {
    throw new Error("site_id_must_be_exact_8_digits");
  }
  const activatedAt = normalizeTimestamp(input.report.activatedAt);
  const evaluatedAt = normalizeTimestamp(input.report.evaluatedAt);
  if (!activatedAt || !evaluatedAt) {
    throw new Error("invalid_canary_watch_report_timestamp");
  }
  if (Date.parse(evaluatedAt) > nowMs + MAX_FUTURE_SKEW_MS) {
    throw new Error("canary_watch_report_is_from_future");
  }

  const previous = input.previousState;
  if (
    previous &&
    (previous.siteId !== input.report.siteId ||
      previous.activatedAt !== activatedAt)
  ) {
    throw new Error("canary_watch_state_scope_mismatch");
  }
  if (
    previous &&
    Date.parse(previous.updatedAt) > nowMs + MAX_FUTURE_SKEW_MS
  ) {
    throw new Error("canary_watch_state_is_from_future");
  }

  const current = snapshotReport(input.report);
  let pendingNotification: MerchantOrderV1PrimaryCanaryWatchNotification | null =
    null;

  if (
    previous?.pendingNotification &&
    previous.pendingNotification.current.fingerprint === current.fingerprint
  ) {
    pendingNotification = previous.pendingNotification;
  } else {
    let kind: MerchantOrderV1PrimaryCanaryWatchNotificationKind | null = null;
    if (!previous) {
      if (current.status !== "healthy") kind = "initial_issue";
    } else if (previous.current.fingerprint !== current.fingerprint) {
      if (current.status === "healthy") kind = "recovery";
      else if (previous.current.status !== current.status) kind = "status_changed";
      else kind = "evidence_changed";
    } else if (
      current.status === "rollback_required" &&
      previous.lastNotification
    ) {
      const lastNotifiedMs = Date.parse(previous.lastNotification.notifiedAt);
      const reminderMs = input.rollbackReminderMinutes * 60 * 1000;
      if (nowMs - lastNotifiedMs >= reminderMs) kind = "rollback_reminder";
    }

    if (kind) {
      pendingNotification = buildNotification({
        kind,
        siteId: input.report.siteId,
        activatedAt,
        previousStatus: previous?.current.status ?? null,
        current,
        nowMs,
      });
    }
  }

  const state: MerchantOrderV1PrimaryCanaryWatchState = {
    schemaVersion: MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_STATE_VERSION,
    siteId: input.report.siteId,
    activatedAt,
    updatedAt: new Date(nowMs).toISOString(),
    current,
    lastNotification: previous?.lastNotification ?? null,
    pendingNotification,
  };
  return { state, notification: pendingNotification };
}

export function completeMerchantOrderV1PrimaryCanaryWatchNotification(
  state: MerchantOrderV1PrimaryCanaryWatchState,
  notificationId: string,
  notifiedAt = new Date().toISOString(),
): MerchantOrderV1PrimaryCanaryWatchState {
  const normalizedNotifiedAt = normalizeTimestamp(notifiedAt);
  if (!normalizedNotifiedAt) throw new Error("invalid_notification_timestamp");
  const pending = state.pendingNotification;
  if (!pending || pending.id !== notificationId) {
    throw new Error("canary_watch_pending_notification_mismatch");
  }
  return {
    ...state,
    updatedAt: normalizedNotifiedAt,
    lastNotification: {
      id: pending.id,
      status: pending.current.status,
      fingerprint: pending.current.fingerprint,
      notifiedAt: normalizedNotifiedAt,
    },
    pendingNotification: null,
  };
}
