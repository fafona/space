export type MerchantOrderV1PrimaryCanaryObservation = {
  siteId: string;
  observedAt: string;
  observedAtMs: number;
  durationMs: number;
  outcome: "match" | "fallback";
  reason: string;
};

export type MerchantOrderV1PrimaryCanaryRejection = {
  lineNumber: number;
  reason:
    | "invalid_json"
    | "invalid_record"
    | "invalid_site_id"
    | "invalid_observed_at"
    | "mode_not_primary"
    | "invalid_outcome"
    | "invalid_reason"
    | "invalid_outcome_reason"
    | "invalid_duration_ms";
};

export type MerchantOrderV1PrimaryCanaryParseResult = {
  observations: MerchantOrderV1PrimaryCanaryObservation[];
  rejections: MerchantOrderV1PrimaryCanaryRejection[];
  ignoredLineCount: number;
};

export type MerchantOrderV1PrimaryCanaryPolicy = {
  minimumSamples: number;
  minimumObservationWindowMinutes: number;
  maximumP95DurationMs: number;
  maximumLastObservationAgeMinutes: number;
};

export type MerchantOrderV1PrimaryCanaryRollbackReason =
  | "fallback_observed"
  | "circuit_open_observed"
  | "p95_duration_exceeded";

export type MerchantOrderV1PrimaryCanaryObservationBlocker =
  | "no_observations"
  | "insufficient_samples"
  | "insufficient_observation_window"
  | "latest_observation_stale"
  | "future_observation"
  | "rejected_observation_lines"
  | "mode_drift_observed";

export type MerchantOrderV1PrimaryCanaryReport = {
  siteId: string;
  status: "healthy" | "observing" | "rollback_required";
  activatedAt: string;
  evaluatedAt: string;
  policy: MerchantOrderV1PrimaryCanaryPolicy;
  sampleCount: number;
  matchCount: number;
  fallbackCount: number;
  circuitOpenCount: number;
  rejectedLineCount: number;
  ignoredLineCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  observationWindowMinutes: number;
  latestObservationAgeMinutes: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p99DurationMs: number | null;
  reasonCounts: Record<string, number>;
  rollbackReasons: MerchantOrderV1PrimaryCanaryRollbackReason[];
  observationBlockers: MerchantOrderV1PrimaryCanaryObservationBlocker[];
};

export const DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY: MerchantOrderV1PrimaryCanaryPolicy =
  {
    minimumSamples: 100,
    minimumObservationWindowMinutes: 1440,
    maximumP95DurationMs: 2500,
    maximumLastObservationAgeMinutes: 15,
  };

const EVENT_NAME = "merchant_order_v1_read";
const SITE_ID_PATTERN = /^\d{8}$/;
const REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_DURATION_MS = 600_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeIsoTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? {
        iso: new Date(parsed).toISOString(),
        milliseconds: parsed,
      }
    : null;
}

function assertSiteId(siteId: string) {
  if (!SITE_ID_PATTERN.test(siteId)) {
    throw new Error("site_id_must_be_exact_8_digits");
  }
}

function assertActivatedAt(activatedAt: string) {
  const normalized = normalizeIsoTimestamp(activatedAt);
  if (!normalized) throw new Error("activated_at_must_be_valid_timestamp");
  return normalized;
}

function rejection(
  lineNumber: number,
  reason: MerchantOrderV1PrimaryCanaryRejection["reason"],
): MerchantOrderV1PrimaryCanaryRejection {
  return { lineNumber, reason };
}

export function parseMerchantOrderV1PrimaryCanaryLines(
  lines: Iterable<string>,
  input: {
    siteId: string;
    activatedAt: string;
  },
): MerchantOrderV1PrimaryCanaryParseResult {
  assertSiteId(input.siteId);
  const activatedAt = assertActivatedAt(input.activatedAt);
  const observations: MerchantOrderV1PrimaryCanaryObservation[] = [];
  const rejections: MerchantOrderV1PrimaryCanaryRejection[] = [];
  let ignoredLineCount = 0;
  let lineNumber = 0;

  for (const rawLine of lines) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (!line || !line.includes(EVENT_NAME)) {
      ignoredLineCount += 1;
      continue;
    }

    const jsonStart = line.indexOf("{");
    if (jsonStart < 0) {
      rejections.push(rejection(lineNumber, "invalid_json"));
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(line.slice(jsonStart));
    } catch {
      rejections.push(rejection(lineNumber, "invalid_json"));
      continue;
    }
    if (!isRecord(value) || value.event !== EVENT_NAME) {
      rejections.push(rejection(lineNumber, "invalid_record"));
      continue;
    }
    if (typeof value.siteId !== "string" || !SITE_ID_PATTERN.test(value.siteId)) {
      rejections.push(rejection(lineNumber, "invalid_site_id"));
      continue;
    }
    if (value.siteId !== input.siteId) {
      ignoredLineCount += 1;
      continue;
    }

    const observedAt = normalizeIsoTimestamp(value.observedAt);
    if (!observedAt) {
      rejections.push(rejection(lineNumber, "invalid_observed_at"));
      continue;
    }
    if (observedAt.milliseconds < activatedAt.milliseconds) {
      ignoredLineCount += 1;
      continue;
    }
    if (value.mode !== "primary") {
      rejections.push(rejection(lineNumber, "mode_not_primary"));
      continue;
    }
    if (value.outcome !== "match" && value.outcome !== "fallback") {
      rejections.push(rejection(lineNumber, "invalid_outcome"));
      continue;
    }
    if (typeof value.reason !== "string" || !REASON_PATTERN.test(value.reason)) {
      rejections.push(rejection(lineNumber, "invalid_reason"));
      continue;
    }
    if (
      (value.outcome === "match" && value.reason !== "parity") ||
      (value.outcome === "fallback" && value.reason === "parity")
    ) {
      rejections.push(rejection(lineNumber, "invalid_outcome_reason"));
      continue;
    }
    if (
      !Number.isInteger(value.durationMs) ||
      (value.durationMs as number) < 0 ||
      (value.durationMs as number) > MAX_DURATION_MS
    ) {
      rejections.push(rejection(lineNumber, "invalid_duration_ms"));
      continue;
    }

    observations.push({
      siteId: value.siteId,
      observedAt: observedAt.iso,
      observedAtMs: observedAt.milliseconds,
      durationMs: value.durationMs as number,
      outcome: value.outcome,
      reason: value.reason,
    });
  }

  return {
    observations,
    rejections,
    ignoredLineCount,
  };
}

function assertFiniteNumber(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name}_must_be_between_${minimum}_and_${maximum}`);
  }
}

export function resolveMerchantOrderV1PrimaryCanaryPolicy(
  input: Partial<MerchantOrderV1PrimaryCanaryPolicy> = {},
): MerchantOrderV1PrimaryCanaryPolicy {
  const policy = {
    ...DEFAULT_MERCHANT_ORDER_V1_PRIMARY_CANARY_POLICY,
    ...input,
  };
  assertFiniteNumber(policy.minimumSamples, "minimum_samples", 1, 1_000_000);
  assertFiniteNumber(
    policy.minimumObservationWindowMinutes,
    "minimum_observation_window_minutes",
    1,
    43_200,
  );
  assertFiniteNumber(
    policy.maximumP95DurationMs,
    "maximum_p95_duration_ms",
    1,
    MAX_DURATION_MS,
  );
  assertFiniteNumber(
    policy.maximumLastObservationAgeMinutes,
    "maximum_last_observation_age_minutes",
    1,
    10_080,
  );
  if (
    !Number.isInteger(policy.minimumSamples) ||
    !Number.isInteger(policy.minimumObservationWindowMinutes) ||
    !Number.isInteger(policy.maximumP95DurationMs) ||
    !Number.isInteger(policy.maximumLastObservationAgeMinutes)
  ) {
    throw new Error("canary_policy_values_must_be_integers");
  }
  return policy;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? null;
}

function incrementReasonCount(reasonCounts: Record<string, number>, reason: string) {
  reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
}

export function evaluateMerchantOrderV1PrimaryCanary(input: {
  siteId: string;
  activatedAt: string;
  parsed: MerchantOrderV1PrimaryCanaryParseResult;
  policy?: Partial<MerchantOrderV1PrimaryCanaryPolicy>;
  evaluatedAt?: Date;
}): MerchantOrderV1PrimaryCanaryReport {
  assertSiteId(input.siteId);
  const activatedAt = assertActivatedAt(input.activatedAt);
  const policy = resolveMerchantOrderV1PrimaryCanaryPolicy(input.policy);
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const evaluatedAtMs = evaluatedAt.getTime();
  if (!Number.isFinite(evaluatedAtMs)) {
    throw new Error("evaluated_at_must_be_valid");
  }
  if (activatedAt.milliseconds > evaluatedAtMs + MAX_FUTURE_SKEW_MS) {
    throw new Error("activated_at_cannot_be_in_the_future");
  }

  const scopedObservations = input.parsed.observations.filter(
    (observation) =>
      observation.siteId === input.siteId &&
      observation.observedAtMs >= activatedAt.milliseconds,
  );
  const directlyIgnoredObservationCount =
    input.parsed.observations.length - scopedObservations.length;
  const currentObservations = scopedObservations.filter(
    (observation) => observation.observedAtMs <= evaluatedAtMs + MAX_FUTURE_SKEW_MS,
  );
  const futureObservationCount =
    scopedObservations.length - currentObservations.length;
  const sortedObservations = [...currentObservations].sort(
    (left, right) => left.observedAtMs - right.observedAtMs,
  );
  const firstObservation = sortedObservations[0] ?? null;
  const lastObservation = sortedObservations.at(-1) ?? null;
  const durations = sortedObservations.map((observation) => observation.durationMs);
  const matchCount = sortedObservations.filter(
    (observation) => observation.outcome === "match",
  ).length;
  const fallbackCount = sortedObservations.length - matchCount;
  const circuitOpenCount = sortedObservations.filter(
    (observation) => observation.reason === "circuit_open",
  ).length;
  const reasonCounts: Record<string, number> = {};
  sortedObservations.forEach((observation) => {
    incrementReasonCount(reasonCounts, observation.reason);
  });
  const orderedReasonCounts = Object.fromEntries(
    Object.entries(reasonCounts).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );

  const observationWindowMinutes =
    firstObservation && lastObservation
      ? Math.max(
          0,
          (lastObservation.observedAtMs - firstObservation.observedAtMs) / 60_000,
        )
      : 0;
  const latestObservationAgeMinutes = lastObservation
    ? Math.max(0, (evaluatedAtMs - lastObservation.observedAtMs) / 60_000)
    : null;
  const p50DurationMs = percentile(durations, 0.5);
  const p95DurationMs = percentile(durations, 0.95);
  const p99DurationMs = percentile(durations, 0.99);

  const rollbackReasons: MerchantOrderV1PrimaryCanaryRollbackReason[] = [];
  if (fallbackCount > 0) rollbackReasons.push("fallback_observed");
  if (circuitOpenCount > 0) rollbackReasons.push("circuit_open_observed");
  if (p95DurationMs !== null && p95DurationMs > policy.maximumP95DurationMs) {
    rollbackReasons.push("p95_duration_exceeded");
  }

  const observationBlockers: MerchantOrderV1PrimaryCanaryObservationBlocker[] = [];
  if (sortedObservations.length === 0) {
    observationBlockers.push("no_observations");
  } else {
    if (sortedObservations.length < policy.minimumSamples) {
      observationBlockers.push("insufficient_samples");
    }
    if (observationWindowMinutes < policy.minimumObservationWindowMinutes) {
      observationBlockers.push("insufficient_observation_window");
    }
    if (
      latestObservationAgeMinutes !== null &&
      latestObservationAgeMinutes > policy.maximumLastObservationAgeMinutes
    ) {
      observationBlockers.push("latest_observation_stale");
    }
  }
  if (futureObservationCount > 0) {
    observationBlockers.push("future_observation");
  }
  if (input.parsed.rejections.length > 0) {
    observationBlockers.push("rejected_observation_lines");
  }
  if (
    input.parsed.rejections.some((item) => item.reason === "mode_not_primary")
  ) {
    observationBlockers.push("mode_drift_observed");
  }

  return {
    siteId: input.siteId,
    status:
      rollbackReasons.length > 0
        ? "rollback_required"
        : observationBlockers.length > 0
          ? "observing"
          : "healthy",
    activatedAt: activatedAt.iso,
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
    policy,
    sampleCount: sortedObservations.length,
    matchCount,
    fallbackCount,
    circuitOpenCount,
    rejectedLineCount: input.parsed.rejections.length,
    ignoredLineCount:
      input.parsed.ignoredLineCount + directlyIgnoredObservationCount,
    firstObservedAt: firstObservation?.observedAt ?? null,
    lastObservedAt: lastObservation?.observedAt ?? null,
    observationWindowMinutes,
    latestObservationAgeMinutes,
    p50DurationMs,
    p95DurationMs,
    p99DurationMs,
    reasonCounts: orderedReasonCounts,
    rollbackReasons,
    observationBlockers,
  };
}
