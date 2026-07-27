import type { MerchantOrderV1PrimaryCanaryWatchState } from "@/lib/merchantOrderV1PrimaryCanaryWatch";

export const DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_HEALTH_POLICY = {
  maximumStateAgeMinutes: 15,
  maximumPendingDeliveryAgeMinutes: 5,
} as const;

export type MerchantOrderV1PrimaryCanaryWatchHealthStatus =
  | "healthy"
  | "degraded"
  | "critical";

export type MerchantOrderV1PrimaryCanaryWatchHealthBlocker =
  | "state_missing"
  | "state_unreadable"
  | "scope_mismatch"
  | "activation_from_future"
  | "state_updated_from_future"
  | "evaluation_from_future"
  | "last_notification_from_future"
  | "pending_notification_from_future"
  | "state_precedes_evaluation"
  | "pending_notification_mismatch"
  | "state_stale"
  | "evaluation_stale"
  | "pending_notification_stale"
  | "rollback_required";

export type MerchantOrderV1PrimaryCanaryWatchHealthWarning =
  | "canary_observing"
  | "pending_notification_delivery";

export type MerchantOrderV1PrimaryCanaryWatchHealthReport = {
  schemaVersion: 1;
  status: MerchantOrderV1PrimaryCanaryWatchHealthStatus;
  checkedAt: string;
  siteId: string;
  activatedAt: string;
  canaryStatus:
    | MerchantOrderV1PrimaryCanaryWatchState["current"]["status"]
    | null;
  stateUpdatedAt: string | null;
  stateAgeMinutes: number | null;
  evaluatedAt: string | null;
  evaluationAgeMinutes: number | null;
  pendingNotificationId: string | null;
  pendingNotificationAgeMinutes: number | null;
  blockers: MerchantOrderV1PrimaryCanaryWatchHealthBlocker[];
  warnings: MerchantOrderV1PrimaryCanaryWatchHealthWarning[];
};

const SITE_ID_PATTERN = /^\d{8}$/;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MINUTES_TO_MS = 60 * 1000;

function normalizeTimestamp(value: string, name: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name}_must_be_valid_timestamp`);
  return new Date(parsed).toISOString();
}

function assertPolicyValue(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1 || value > 1440) {
    throw new Error(`${name}_must_be_between_1_and_1440`);
  }
}

function ageMinutes(nowMs: number, timestamp: string) {
  return Math.max(0, (nowMs - Date.parse(timestamp)) / MINUTES_TO_MS);
}

function isFromFuture(nowMs: number, timestamp: string) {
  return Date.parse(timestamp) > nowMs + MAX_FUTURE_SKEW_MS;
}

function pushUnique<T>(items: T[], item: T) {
  if (!items.includes(item)) items.push(item);
}

export function evaluateMerchantOrderV1PrimaryCanaryWatchHealth(input: {
  state: MerchantOrderV1PrimaryCanaryWatchState | null;
  stateUnreadable?: boolean;
  siteId: string;
  activatedAt: string;
  policy?: {
    maximumStateAgeMinutes: number;
    maximumPendingDeliveryAgeMinutes: number;
  };
  nowMs?: number;
}): MerchantOrderV1PrimaryCanaryWatchHealthReport {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    throw new Error("canary_watch_health_now_must_be_finite");
  }
  if (!SITE_ID_PATTERN.test(input.siteId)) {
    throw new Error("site_id_must_be_exact_8_digits");
  }
  const activatedAt = normalizeTimestamp(input.activatedAt, "activated_at");
  const policy =
    input.policy ??
    DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_WATCH_HEALTH_POLICY;
  assertPolicyValue(
    policy.maximumStateAgeMinutes,
    "maximum_state_age_minutes",
  );
  assertPolicyValue(
    policy.maximumPendingDeliveryAgeMinutes,
    "maximum_pending_delivery_age_minutes",
  );
  if (input.state && input.stateUnreadable) {
    throw new Error("state_and_state_unreadable_are_mutually_exclusive");
  }

  const blockers: MerchantOrderV1PrimaryCanaryWatchHealthBlocker[] = [];
  const warnings: MerchantOrderV1PrimaryCanaryWatchHealthWarning[] = [];
  const state = input.state;

  if (input.stateUnreadable) pushUnique(blockers, "state_unreadable");
  else if (!state) pushUnique(blockers, "state_missing");

  if (isFromFuture(nowMs, activatedAt)) {
    pushUnique(blockers, "activation_from_future");
  }

  if (!state) {
    return {
      schemaVersion: 1,
      status: "critical",
      checkedAt: new Date(nowMs).toISOString(),
      siteId: input.siteId,
      activatedAt,
      canaryStatus: null,
      stateUpdatedAt: null,
      stateAgeMinutes: null,
      evaluatedAt: null,
      evaluationAgeMinutes: null,
      pendingNotificationId: null,
      pendingNotificationAgeMinutes: null,
      blockers,
      warnings,
    };
  }

  if (state.siteId !== input.siteId || state.activatedAt !== activatedAt) {
    pushUnique(blockers, "scope_mismatch");
  }

  const stateAgeMinutes = ageMinutes(nowMs, state.updatedAt);
  const evaluationAgeMinutes = ageMinutes(nowMs, state.current.evaluatedAt);
  if (isFromFuture(nowMs, state.updatedAt)) {
    pushUnique(blockers, "state_updated_from_future");
  }
  if (isFromFuture(nowMs, state.current.evaluatedAt)) {
    pushUnique(blockers, "evaluation_from_future");
  }
  if (Date.parse(state.updatedAt) < Date.parse(state.current.evaluatedAt)) {
    pushUnique(blockers, "state_precedes_evaluation");
  }
  if (stateAgeMinutes > policy.maximumStateAgeMinutes) {
    pushUnique(blockers, "state_stale");
  }
  if (evaluationAgeMinutes > policy.maximumStateAgeMinutes) {
    pushUnique(blockers, "evaluation_stale");
  }

  if (
    state.lastNotification &&
    isFromFuture(nowMs, state.lastNotification.notifiedAt)
  ) {
    pushUnique(blockers, "last_notification_from_future");
  }

  const pending = state.pendingNotification;
  let pendingNotificationAgeMinutes: number | null = null;
  if (pending) {
    pendingNotificationAgeMinutes = ageMinutes(nowMs, pending.createdAt);
    if (
      pending.siteId !== input.siteId ||
      pending.activatedAt !== activatedAt ||
      pending.current.status !== state.current.status ||
      pending.current.fingerprint !== state.current.fingerprint
    ) {
      pushUnique(blockers, "pending_notification_mismatch");
    }
    if (isFromFuture(nowMs, pending.createdAt)) {
      pushUnique(blockers, "pending_notification_from_future");
    } else if (
      pendingNotificationAgeMinutes >
      policy.maximumPendingDeliveryAgeMinutes
    ) {
      pushUnique(blockers, "pending_notification_stale");
    } else {
      pushUnique(warnings, "pending_notification_delivery");
    }
  }

  if (state.current.status === "rollback_required") {
    pushUnique(blockers, "rollback_required");
  } else if (state.current.status === "observing") {
    pushUnique(warnings, "canary_observing");
  }

  const status: MerchantOrderV1PrimaryCanaryWatchHealthStatus =
    blockers.length > 0
      ? "critical"
      : warnings.length > 0
        ? "degraded"
        : "healthy";

  return {
    schemaVersion: 1,
    status,
    checkedAt: new Date(nowMs).toISOString(),
    siteId: input.siteId,
    activatedAt,
    canaryStatus: state.current.status,
    stateUpdatedAt: state.updatedAt,
    stateAgeMinutes,
    evaluatedAt: state.current.evaluatedAt,
    evaluationAgeMinutes,
    pendingNotificationId: pending?.id ?? null,
    pendingNotificationAgeMinutes,
    blockers,
    warnings,
  };
}
