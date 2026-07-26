export type MerchantOutboxHealthSnapshot = {
  generatedAt: string;
  merchantScope: string;
  windowHours: number;
  pendingCount: number;
  retryScheduledCount: number;
  processingCount: number;
  completedCount: number;
  deadLetterCount: number;
  dueCount: number;
  scheduledCount: number;
  expiredLeaseCount: number;
  attemptLimitRiskCount: number;
  unknownEventTypeCount: number;
  oldestDueAgeSeconds: number;
  attemptsInWindow: number;
  completedAttemptsInWindow: number;
  retryAttemptsInWindow: number;
  deadLetterAttemptsInWindow: number;
  leaseExpiredAttemptsInWindow: number;
};

export type MerchantOutboxHealthEvaluation = {
  status: "healthy" | "degraded";
  blockers: string[];
  warnings: string[];
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toCount(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

export function normalizeMerchantOutboxHealthSnapshot(
  value: unknown,
): MerchantOutboxHealthSnapshot {
  const record = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  const generatedAt = trimText(record.generated_at);
  const generatedTimestamp = Date.parse(generatedAt);
  if (!Number.isFinite(generatedTimestamp)) {
    throw new Error("invalid_outbox_health_generated_at");
  }
  const merchantScope = trimText(record.merchant_scope);
  if (merchantScope !== "all" && !/^\d{8}$/.test(merchantScope)) {
    throw new Error("invalid_outbox_health_scope");
  }
  return {
    generatedAt: new Date(generatedTimestamp).toISOString(),
    merchantScope,
    windowHours: Math.min(168, Math.max(1, toCount(record.window_hours))),
    pendingCount: toCount(record.pending_count),
    retryScheduledCount: toCount(record.retry_scheduled_count),
    processingCount: toCount(record.processing_count),
    completedCount: toCount(record.completed_count),
    deadLetterCount: toCount(record.dead_letter_count),
    dueCount: toCount(record.due_count),
    scheduledCount: toCount(record.scheduled_count),
    expiredLeaseCount: toCount(record.expired_lease_count),
    attemptLimitRiskCount: toCount(record.attempt_limit_risk_count),
    unknownEventTypeCount: toCount(record.unknown_event_type_count),
    oldestDueAgeSeconds: toCount(record.oldest_due_age_seconds),
    attemptsInWindow: toCount(record.attempts_in_window),
    completedAttemptsInWindow: toCount(record.completed_attempts_in_window),
    retryAttemptsInWindow: toCount(record.retry_attempts_in_window),
    deadLetterAttemptsInWindow: toCount(record.dead_letter_attempts_in_window),
    leaseExpiredAttemptsInWindow: toCount(record.lease_expired_attempts_in_window),
  };
}

export function evaluateMerchantOutboxHealth(
  snapshot: MerchantOutboxHealthSnapshot,
  options?: {
    maximumOldestDueAgeSeconds?: number;
  },
): MerchantOutboxHealthEvaluation {
  const maximumOldestDueAgeSeconds = Math.min(
    86400,
    Math.max(30, Math.round(options?.maximumOldestDueAgeSeconds ?? 300)),
  );
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (snapshot.expiredLeaseCount > 0) blockers.push("expired_leases");
  if (snapshot.deadLetterCount > 0) blockers.push("dead_letters");
  if (snapshot.unknownEventTypeCount > 0) blockers.push("unknown_event_types");
  if (snapshot.oldestDueAgeSeconds > maximumOldestDueAgeSeconds) {
    blockers.push("oldest_due_age_exceeded");
  }
  if (snapshot.attemptLimitRiskCount > 0) warnings.push("attempt_limit_risk");
  if (snapshot.retryAttemptsInWindow > 0) warnings.push("recent_retries");
  if (snapshot.leaseExpiredAttemptsInWindow > 0) warnings.push("recent_lease_expiry");
  return {
    status: blockers.length > 0 ? "degraded" : "healthy",
    blockers,
    warnings,
  };
}
