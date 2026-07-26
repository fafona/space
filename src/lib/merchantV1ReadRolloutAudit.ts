export const MERCHANT_V1_READ_DOMAINS = [
  "orders",
  "bookings",
  "coupons",
  "conversations",
  "memberships",
] as const;

export type MerchantV1ReadDomain = (typeof MERCHANT_V1_READ_DOMAINS)[number];

const EVENT_DOMAINS = {
  merchant_order_v1_read: "orders",
  merchant_booking_v1_read: "bookings",
  merchant_coupon_v1_read: "coupons",
  merchant_conversation_v1_read: "conversations",
  merchant_membership_v1_read: "memberships",
} as const satisfies Record<string, MerchantV1ReadDomain>;

type MerchantV1ReadEventName = keyof typeof EVENT_DOMAINS;

export type MerchantV1ReadObservation = {
  domain: MerchantV1ReadDomain;
  event: MerchantV1ReadEventName;
  siteId: string;
  mode: "verify";
  outcome: "match" | "fallback";
  reason: string;
  observedAt: string;
  observedAtMs: number;
  durationMs: number;
};

export type MerchantV1ReadObservationRejection = {
  lineNumber: number;
  reason:
    | "invalid_json"
    | "invalid_record"
    | "invalid_site_id"
    | "mode_not_verify"
    | "invalid_outcome"
    | "invalid_reason"
    | "invalid_outcome_reason"
    | "invalid_observed_at"
    | "invalid_duration_ms";
  domain?: MerchantV1ReadDomain;
  siteId?: string;
};

export type MerchantV1ReadObservationParseResult = {
  observations: MerchantV1ReadObservation[];
  rejections: MerchantV1ReadObservationRejection[];
  ignoredLineCount: number;
};

export type MerchantV1ReadRolloutPolicy = {
  domains: MerchantV1ReadDomain[];
  minimumSamplesPerDomain: number;
  minimumObservationWindowHours: number;
  maximumFallbackRate: number;
  maximumP95DurationMs: number;
  maximumLastObservationAgeHours: number;
};

export type MerchantV1ReadRolloutDomainBlocker =
  | "insufficient_samples"
  | "insufficient_observation_window"
  | "fallback_rate_exceeded"
  | "p95_duration_exceeded"
  | "latest_observation_stale"
  | "future_observation";

export type MerchantV1ReadRolloutDomainReport = {
  domain: MerchantV1ReadDomain;
  status: "ready" | "blocked";
  sampleCount: number;
  matchCount: number;
  fallbackCount: number;
  fallbackRate: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  observationWindowHours: number;
  latestObservationAgeHours: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  p99DurationMs: number | null;
  reasonCounts: Record<string, number>;
  blockers: MerchantV1ReadRolloutDomainBlocker[];
};

export type MerchantV1ReadRolloutReport = {
  siteId: string;
  status: "ready" | "blocked";
  evaluatedAt: string;
  policy: MerchantV1ReadRolloutPolicy;
  rejectedLineCount: number;
  ignoredLineCount: number;
  blockers: Array<"rejected_observation_lines">;
  domains: MerchantV1ReadRolloutDomainReport[];
};

export const DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY: MerchantV1ReadRolloutPolicy = {
  domains: [...MERCHANT_V1_READ_DOMAINS],
  minimumSamplesPerDomain: 100,
  minimumObservationWindowHours: 168,
  maximumFallbackRate: 0,
  maximumP95DurationMs: 2500,
  maximumLastObservationAgeHours: 24,
};

const MAX_OBSERVATION_DURATION_MS = 600_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const EVENT_NAMES = new Set<string>(Object.keys(EVENT_DOMAINS));
const REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const SITE_ID_PATTERN = /^\d{8}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferDomain(line: string): MerchantV1ReadDomain | undefined {
  for (const [event, domain] of Object.entries(EVENT_DOMAINS)) {
    if (line.includes(event)) return domain;
  }
  return undefined;
}

function rejection(
  lineNumber: number,
  reason: MerchantV1ReadObservationRejection["reason"],
  domain?: MerchantV1ReadDomain,
  siteId?: string,
): MerchantV1ReadObservationRejection {
  return {
    lineNumber,
    reason,
    ...(domain ? { domain } : {}),
    ...(siteId ? { siteId } : {}),
  };
}

export function parseMerchantV1ReadObservationLines(
  lines: Iterable<string>,
): MerchantV1ReadObservationParseResult {
  const observations: MerchantV1ReadObservation[] = [];
  const rejections: MerchantV1ReadObservationRejection[] = [];
  let ignoredLineCount = 0;
  let lineNumber = 0;

  for (const rawLine of lines) {
    lineNumber += 1;
    const line = rawLine.trim();
    const inferredDomain = inferDomain(line);
    if (!line || !inferredDomain) {
      ignoredLineCount += 1;
      continue;
    }

    const jsonStart = line.indexOf("{");
    if (jsonStart < 0) {
      rejections.push(rejection(lineNumber, "invalid_json", inferredDomain));
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(line.slice(jsonStart));
    } catch {
      rejections.push(rejection(lineNumber, "invalid_json", inferredDomain));
      continue;
    }
    if (!isRecord(value)) {
      rejections.push(rejection(lineNumber, "invalid_record", inferredDomain));
      continue;
    }

    const event =
      typeof value.event === "string" && EVENT_NAMES.has(value.event)
        ? (value.event as MerchantV1ReadEventName)
        : null;
    const domain = event ? EVENT_DOMAINS[event] : inferredDomain;
    const siteId =
      typeof value.siteId === "string" && SITE_ID_PATTERN.test(value.siteId)
        ? value.siteId
        : undefined;

    if (!event) {
      rejections.push(rejection(lineNumber, "invalid_record", domain, siteId));
      continue;
    }
    if (!siteId) {
      rejections.push(rejection(lineNumber, "invalid_site_id", domain));
      continue;
    }
    if (value.mode !== "verify") {
      rejections.push(rejection(lineNumber, "mode_not_verify", domain, siteId));
      continue;
    }
    if (value.outcome !== "match" && value.outcome !== "fallback") {
      rejections.push(rejection(lineNumber, "invalid_outcome", domain, siteId));
      continue;
    }
    if (typeof value.reason !== "string" || !REASON_PATTERN.test(value.reason)) {
      rejections.push(rejection(lineNumber, "invalid_reason", domain, siteId));
      continue;
    }
    if (
      (value.outcome === "match" && value.reason !== "parity") ||
      (value.outcome === "fallback" && value.reason === "parity")
    ) {
      rejections.push(rejection(lineNumber, "invalid_outcome_reason", domain, siteId));
      continue;
    }
    if (typeof value.observedAt !== "string") {
      rejections.push(rejection(lineNumber, "invalid_observed_at", domain, siteId));
      continue;
    }
    const observedAtMs = Date.parse(value.observedAt);
    if (!Number.isFinite(observedAtMs)) {
      rejections.push(rejection(lineNumber, "invalid_observed_at", domain, siteId));
      continue;
    }
    if (
      !Number.isInteger(value.durationMs) ||
      (value.durationMs as number) < 0 ||
      (value.durationMs as number) > MAX_OBSERVATION_DURATION_MS
    ) {
      rejections.push(rejection(lineNumber, "invalid_duration_ms", domain, siteId));
      continue;
    }

    observations.push({
      domain,
      event,
      siteId,
      mode: "verify",
      outcome: value.outcome,
      reason: value.reason,
      observedAt: new Date(observedAtMs).toISOString(),
      observedAtMs,
      durationMs: value.durationMs as number,
    });
  }

  return { observations, rejections, ignoredLineCount };
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

export function resolveMerchantV1ReadRolloutPolicy(
  policy: Partial<MerchantV1ReadRolloutPolicy> = {},
): MerchantV1ReadRolloutPolicy {
  const domains = policy.domains ?? DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.domains;
  if (
    domains.length === 0 ||
    new Set(domains).size !== domains.length ||
    domains.some(
      (domain) => !MERCHANT_V1_READ_DOMAINS.includes(domain as MerchantV1ReadDomain),
    )
  ) {
    throw new Error("domains_must_be_unique_known_values");
  }

  const resolved = {
    ...DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY,
    ...policy,
    domains: [...domains],
  };
  assertFiniteNumber(
    resolved.minimumSamplesPerDomain,
    "minimum_samples_per_domain",
    1,
    1_000_000,
  );
  if (!Number.isInteger(resolved.minimumSamplesPerDomain)) {
    throw new Error("minimum_samples_per_domain_must_be_an_integer");
  }
  assertFiniteNumber(
    resolved.minimumObservationWindowHours,
    "minimum_observation_window_hours",
    0,
    2160,
  );
  assertFiniteNumber(resolved.maximumFallbackRate, "maximum_fallback_rate", 0, 1);
  assertFiniteNumber(
    resolved.maximumP95DurationMs,
    "maximum_p95_duration_ms",
    1,
    MAX_OBSERVATION_DURATION_MS,
  );
  assertFiniteNumber(
    resolved.maximumLastObservationAgeHours,
    "maximum_last_observation_age_hours",
    1,
    720,
  );
  return resolved;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index] ?? null;
}

function countReasons(observations: MerchantV1ReadObservation[]) {
  const counts = new Map<string, number>();
  observations.forEach((observation) => {
    counts.set(observation.reason, (counts.get(observation.reason) ?? 0) + 1);
  });
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function evaluateMerchantV1ReadRollout(input: {
  siteId: string;
  parsed: MerchantV1ReadObservationParseResult;
  policy?: Partial<MerchantV1ReadRolloutPolicy>;
  nowMs?: number;
}): MerchantV1ReadRolloutReport {
  if (!SITE_ID_PATTERN.test(input.siteId)) {
    throw new Error("site_must_be_exact_8_digit_id");
  }
  const policy = resolveMerchantV1ReadRolloutPolicy(input.policy);
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("now_ms_must_be_finite");

  const selectedDomains = new Set<MerchantV1ReadDomain>(policy.domains);
  const scopedRejections = input.parsed.rejections.filter(
    (item) =>
      (!item.siteId || item.siteId === input.siteId) &&
      (!item.domain || selectedDomains.has(item.domain)),
  );
  const globalBlockers: MerchantV1ReadRolloutReport["blockers"] =
    scopedRejections.length > 0 ? ["rejected_observation_lines"] : [];

  const domainReports = policy.domains.map((domain) => {
    const observations = input.parsed.observations.filter(
      (item) => item.siteId === input.siteId && item.domain === domain,
    );
    const matchCount = observations.filter((item) => item.outcome === "match").length;
    const fallbackCount = observations.length - matchCount;
    const fallbackRate =
      observations.length > 0 ? fallbackCount / observations.length : 0;
    let firstObservedAtMs: number | null = null;
    let lastObservedAtMs: number | null = null;
    for (const observation of observations) {
      firstObservedAtMs =
        firstObservedAtMs === null
          ? observation.observedAtMs
          : Math.min(firstObservedAtMs, observation.observedAtMs);
      lastObservedAtMs =
        lastObservedAtMs === null
          ? observation.observedAtMs
          : Math.max(lastObservedAtMs, observation.observedAtMs);
    }
    const observationWindowHours =
      firstObservedAtMs === null || lastObservedAtMs === null
        ? 0
        : (lastObservedAtMs - firstObservedAtMs) / 3_600_000;
    const latestObservationAgeHours =
      lastObservedAtMs === null ? null : Math.max(0, nowMs - lastObservedAtMs) / 3_600_000;
    const durations = observations.map((item) => item.durationMs);
    const p50DurationMs = percentile(durations, 0.5);
    const p95DurationMs = percentile(durations, 0.95);
    const p99DurationMs = percentile(durations, 0.99);
    const blockers: MerchantV1ReadRolloutDomainBlocker[] = [];

    if (observations.length < policy.minimumSamplesPerDomain) {
      blockers.push("insufficient_samples");
    }
    if (observationWindowHours < policy.minimumObservationWindowHours) {
      blockers.push("insufficient_observation_window");
    }
    if (fallbackRate > policy.maximumFallbackRate) {
      blockers.push("fallback_rate_exceeded");
    }
    if (p95DurationMs !== null && p95DurationMs > policy.maximumP95DurationMs) {
      blockers.push("p95_duration_exceeded");
    }
    if (
      lastObservedAtMs !== null &&
      lastObservedAtMs - nowMs > MAX_FUTURE_SKEW_MS
    ) {
      blockers.push("future_observation");
    } else if (
      latestObservationAgeHours === null ||
      latestObservationAgeHours > policy.maximumLastObservationAgeHours
    ) {
      blockers.push("latest_observation_stale");
    }

    return {
      domain,
      status: blockers.length === 0 ? ("ready" as const) : ("blocked" as const),
      sampleCount: observations.length,
      matchCount,
      fallbackCount,
      fallbackRate,
      firstObservedAt:
        firstObservedAtMs === null ? null : new Date(firstObservedAtMs).toISOString(),
      lastObservedAt:
        lastObservedAtMs === null ? null : new Date(lastObservedAtMs).toISOString(),
      observationWindowHours,
      latestObservationAgeHours,
      p50DurationMs,
      p95DurationMs,
      p99DurationMs,
      reasonCounts: countReasons(observations),
      blockers,
    };
  });

  return {
    siteId: input.siteId,
    status:
      globalBlockers.length === 0 &&
      domainReports.every((report) => report.status === "ready")
        ? "ready"
        : "blocked",
    evaluatedAt: new Date(nowMs).toISOString(),
    policy,
    rejectedLineCount: scopedRejections.length,
    ignoredLineCount: input.parsed.ignoredLineCount,
    blockers: globalBlockers,
    domains: domainReports,
  };
}
