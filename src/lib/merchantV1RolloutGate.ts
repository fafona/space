import {
  DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY,
  type MerchantV1ReadRolloutDomainReport,
  type MerchantV1ReadRolloutReport,
} from "@/lib/merchantV1ReadRolloutAudit";
import {
  evaluateMerchantOutboxHealth,
  type MerchantOutboxHealthSnapshot,
} from "@/lib/merchantOutboxHealth";

export const MERCHANT_V1_ROLLOUT_GATE_SCHEMA_VERSION = 1;

export const ORDER_V1_PRIMARY_REQUIRED_MIGRATIONS = [
  "202607250001",
  "202607250002",
  "202607250007",
  "202607250008",
] as const;

export type MerchantV1RolloutGatePolicy = {
  maximumEvidenceAgeHours: number;
  maximumOutboxAgeMinutes: number;
  minimumDualWriteHealthyHours: number;
  maximumOutboxOldestDueAgeSeconds: number;
};

export const DEFAULT_MERCHANT_V1_ROLLOUT_GATE_POLICY: MerchantV1RolloutGatePolicy =
  {
    maximumEvidenceAgeHours: 24,
    maximumOutboxAgeMinutes: 15,
    minimumDualWriteHealthyHours: 168,
    maximumOutboxOldestDueAgeSeconds: 300,
  };

export type MerchantV1RolloutGateManifest = {
  schemaVersion: 1;
  siteId: string;
  domain: "orders";
  currentReadMode: "verify";
  targetReadMode: "primary";
  changeOwner: string;
  rollbackOwner: string;
  reviewedAllowlist: string[];
  appliedMigrations: string[];
  dualWrite: {
    mode: "shadow";
    siteIds: string[];
    healthySince: string;
    observedAt: string;
    errorCount: number;
  };
  backfill: {
    status: "complete";
    observedAt: string;
    sourceCount: number;
    writtenCount: number;
    failureCount: number;
  };
  reconciliation: {
    status: "match";
    observedAt: string;
    legacyCount: number;
    v1Count: number;
    matchedCount: number;
    missingCount: number;
    unexpectedCount: number;
    mismatchCount: number;
  };
  readEvidence: MerchantV1ReadRolloutReport;
  outbox: MerchantOutboxHealthSnapshot;
};

export type MerchantV1RolloutGateBlocker =
  | "invalid_manifest"
  | "invalid_schema_version"
  | "invalid_site_id"
  | "unsupported_domain"
  | "invalid_read_transition"
  | "change_owner_missing"
  | "rollback_owner_missing"
  | "reviewed_allowlist_invalid"
  | "reviewed_allowlist_not_single_site"
  | "required_migration_missing"
  | "dual_write_invalid"
  | "dual_write_site_missing"
  | "dual_write_error_observed"
  | "dual_write_evidence_stale"
  | "dual_write_health_window_too_short"
  | "backfill_invalid"
  | "backfill_incomplete"
  | "reconciliation_invalid"
  | "reconciliation_not_match"
  | "reconciliation_evidence_stale"
  | "read_evidence_invalid"
  | "read_evidence_scope_mismatch"
  | "read_evidence_policy_too_weak"
  | "read_evidence_not_ready"
  | "read_evidence_stale"
  | "outbox_snapshot_invalid"
  | "outbox_scope_mismatch"
  | "outbox_snapshot_stale"
  | "outbox_unhealthy"
  | "future_evidence";

export type MerchantV1RolloutGateReport = {
  status: "ready" | "blocked";
  evaluatedAt: string;
  siteId: string | null;
  domain: string | null;
  currentReadMode: string | null;
  targetReadMode: string | null;
  requiredMigrations: string[];
  blockers: MerchantV1RolloutGateBlocker[];
  warnings: string[];
};

type GateContext = {
  nowMs: number;
  policy: MerchantV1RolloutGatePolicy;
  blockers: Set<MerchantV1RolloutGateBlocker>;
  warnings: Set<string>;
};

const SITE_ID_PATTERN = /^\d{8}$/;
const OWNER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/;
const MIGRATION_VERSION_PATTERN = /^\d{12}$/;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

function normalizeGatePolicy(
  policy?: Partial<MerchantV1RolloutGatePolicy>,
): MerchantV1RolloutGatePolicy {
  const resolved = {
    ...DEFAULT_MERCHANT_V1_ROLLOUT_GATE_POLICY,
    ...policy,
  };
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`invalid_rollout_gate_policy:${key}`);
    }
  }
  return resolved;
}

function parseTimestamp(
  value: unknown,
  context: GateContext,
  invalidBlocker: MerchantV1RolloutGateBlocker,
) {
  if (typeof value !== "string") {
    context.blockers.add(invalidBlocker);
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    context.blockers.add(invalidBlocker);
    return null;
  }
  if (timestamp > context.nowMs + MAX_FUTURE_SKEW_MS) {
    context.blockers.add("future_evidence");
  }
  return timestamp;
}

function isStale(
  timestamp: number | null,
  nowMs: number,
  maximumAgeMs: number,
) {
  return timestamp === null || nowMs - timestamp > maximumAgeMs;
}

function addOwnerBlockers(
  manifest: Record<string, unknown>,
  context: GateContext,
) {
  if (
    typeof manifest.changeOwner !== "string" ||
    !OWNER_PATTERN.test(manifest.changeOwner)
  ) {
    context.blockers.add("change_owner_missing");
  }
  if (
    typeof manifest.rollbackOwner !== "string" ||
    !OWNER_PATTERN.test(manifest.rollbackOwner)
  ) {
    context.blockers.add("rollback_owner_missing");
  }
}

function addAllowlistBlockers(
  manifest: Record<string, unknown>,
  siteId: string | null,
  context: GateContext,
) {
  const allowlist = manifest.reviewedAllowlist;
  if (
    !isStringArray(allowlist) ||
    allowlist.length === 0 ||
    new Set(allowlist).size !== allowlist.length ||
    allowlist.some((item) => !SITE_ID_PATTERN.test(item))
  ) {
    context.blockers.add("reviewed_allowlist_invalid");
    return;
  }
  if (siteId === null || allowlist.length !== 1 || allowlist[0] !== siteId) {
    context.blockers.add("reviewed_allowlist_not_single_site");
  }
}

function addMigrationBlockers(
  manifest: Record<string, unknown>,
  context: GateContext,
) {
  const applied = manifest.appliedMigrations;
  if (
    !isStringArray(applied) ||
    new Set(applied).size !== applied.length ||
    applied.some((item) => !MIGRATION_VERSION_PATTERN.test(item))
  ) {
    context.blockers.add("required_migration_missing");
    return;
  }
  const appliedSet = new Set(applied);
  if (
    ORDER_V1_PRIMARY_REQUIRED_MIGRATIONS.some(
      (version) => !appliedSet.has(version),
    )
  ) {
    context.blockers.add("required_migration_missing");
  }
}

function addDualWriteBlockers(
  value: unknown,
  siteId: string | null,
  firstReadObservedAtMs: number | null,
  context: GateContext,
) {
  if (!isRecord(value)) {
    context.blockers.add("dual_write_invalid");
    return;
  }
  const siteIds = value.siteIds;
  if (
    value.mode !== "shadow" ||
    !isStringArray(siteIds) ||
    siteIds.length === 0 ||
    new Set(siteIds).size !== siteIds.length ||
    siteIds.some((item) => !SITE_ID_PATTERN.test(item)) ||
    !isNonNegativeInteger(value.errorCount)
  ) {
    context.blockers.add("dual_write_invalid");
  }
  if (siteId === null || !isStringArray(siteIds) || !siteIds.includes(siteId)) {
    context.blockers.add("dual_write_site_missing");
  }
  if (isNonNegativeInteger(value.errorCount) && value.errorCount > 0) {
    context.blockers.add("dual_write_error_observed");
  }
  const observedAtMs = parseTimestamp(
    value.observedAt,
    context,
    "dual_write_invalid",
  );
  const healthySinceMs = parseTimestamp(
    value.healthySince,
    context,
    "dual_write_invalid",
  );
  if (
    isStale(
      observedAtMs,
      context.nowMs,
      context.policy.maximumEvidenceAgeHours * 3_600_000,
    )
  ) {
    context.blockers.add("dual_write_evidence_stale");
  }
  if (
    healthySinceMs === null ||
    context.nowMs - healthySinceMs <
      context.policy.minimumDualWriteHealthyHours * 3_600_000 ||
    (firstReadObservedAtMs !== null && healthySinceMs > firstReadObservedAtMs)
  ) {
    context.blockers.add("dual_write_health_window_too_short");
  }
}

function addBackfillBlockers(
  value: unknown,
  context: GateContext,
) {
  if (
    !isRecord(value) ||
    value.status !== "complete" ||
    !isNonNegativeInteger(value.sourceCount) ||
    !isNonNegativeInteger(value.writtenCount) ||
    !isNonNegativeInteger(value.failureCount)
  ) {
    context.blockers.add("backfill_invalid");
    return;
  }
  parseTimestamp(value.observedAt, context, "backfill_invalid");
  if (
    value.failureCount !== 0 ||
    value.writtenCount !== value.sourceCount
  ) {
    context.blockers.add("backfill_incomplete");
  }
}

function addReconciliationBlockers(
  value: unknown,
  context: GateContext,
) {
  if (
    !isRecord(value) ||
    value.status !== "match" ||
    !isNonNegativeInteger(value.legacyCount) ||
    !isNonNegativeInteger(value.v1Count) ||
    !isNonNegativeInteger(value.matchedCount) ||
    !isNonNegativeInteger(value.missingCount) ||
    !isNonNegativeInteger(value.unexpectedCount) ||
    !isNonNegativeInteger(value.mismatchCount)
  ) {
    context.blockers.add("reconciliation_invalid");
    return;
  }
  const observedAtMs = parseTimestamp(
    value.observedAt,
    context,
    "reconciliation_invalid",
  );
  if (
    isStale(
      observedAtMs,
      context.nowMs,
      context.policy.maximumEvidenceAgeHours * 3_600_000,
    )
  ) {
    context.blockers.add("reconciliation_evidence_stale");
  }
  if (
    value.missingCount !== 0 ||
    value.unexpectedCount !== 0 ||
    value.mismatchCount !== 0 ||
    value.legacyCount !== value.v1Count ||
    value.legacyCount !== value.matchedCount
  ) {
    context.blockers.add("reconciliation_not_match");
  }
}

function getOrdersReadDomain(
  value: Record<string, unknown>,
): MerchantV1ReadRolloutDomainReport | null {
  if (!Array.isArray(value.domains) || value.domains.length !== 1) return null;
  const domain = value.domains[0];
  return isRecord(domain) && domain.domain === "orders"
    ? (domain as MerchantV1ReadRolloutDomainReport)
    : null;
}

function readPolicyIsConservative(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.domains) &&
    value.domains.length === 1 &&
    value.domains[0] === "orders" &&
    isFiniteNonNegative(value.minimumSamplesPerDomain) &&
    value.minimumSamplesPerDomain >=
      DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.minimumSamplesPerDomain &&
    isFiniteNonNegative(value.minimumObservationWindowHours) &&
    value.minimumObservationWindowHours >=
      DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.minimumObservationWindowHours &&
    isFiniteNonNegative(value.maximumFallbackRate) &&
    value.maximumFallbackRate <=
      DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.maximumFallbackRate &&
    isFiniteNonNegative(value.maximumP95DurationMs) &&
    value.maximumP95DurationMs <=
      DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.maximumP95DurationMs &&
    isFiniteNonNegative(value.maximumLastObservationAgeHours) &&
    value.maximumLastObservationAgeHours <=
      DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.maximumLastObservationAgeHours
  );
}

function addReadEvidenceBlockers(
  value: unknown,
  siteId: string | null,
  context: GateContext,
) {
  if (!isRecord(value)) {
    context.blockers.add("read_evidence_invalid");
    return null;
  }
  const domain = getOrdersReadDomain(value);
  const policy = isRecord(value.policy) ? value.policy : null;
  const minimumSamples =
    policy && isFiniteNonNegative(policy.minimumSamplesPerDomain)
      ? policy.minimumSamplesPerDomain
      : Number.POSITIVE_INFINITY;
  const minimumWindowHours =
    policy && isFiniteNonNegative(policy.minimumObservationWindowHours)
      ? policy.minimumObservationWindowHours
      : Number.POSITIVE_INFINITY;
  const maximumFallbackRate =
    policy && isFiniteNonNegative(policy.maximumFallbackRate)
      ? policy.maximumFallbackRate
      : -1;
  const maximumP95DurationMs =
    policy && isFiniteNonNegative(policy.maximumP95DurationMs)
      ? policy.maximumP95DurationMs
      : -1;
  if (
    value.status !== "ready" ||
    !isNonNegativeInteger(value.rejectedLineCount) ||
    value.rejectedLineCount !== 0 ||
    !Array.isArray(value.blockers) ||
    value.blockers.length !== 0 ||
    domain === null ||
    domain.status !== "ready" ||
    !Array.isArray(domain.blockers) ||
    domain.blockers.length !== 0 ||
    !isNonNegativeInteger(domain.sampleCount) ||
    !isNonNegativeInteger(domain.matchCount) ||
    !isNonNegativeInteger(domain.fallbackCount) ||
    !isFiniteNonNegative(domain.fallbackRate) ||
    !isFiniteNonNegative(domain.observationWindowHours) ||
    !isFiniteNonNegative(domain.p95DurationMs) ||
    domain.sampleCount < minimumSamples ||
    domain.matchCount !== domain.sampleCount ||
    domain.fallbackCount !== 0 ||
    domain.fallbackRate > maximumFallbackRate ||
    domain.observationWindowHours < minimumWindowHours ||
    domain.p95DurationMs > maximumP95DurationMs
  ) {
    context.blockers.add("read_evidence_not_ready");
  }
  if (siteId === null || value.siteId !== siteId) {
    context.blockers.add("read_evidence_scope_mismatch");
  }
  if (!readPolicyIsConservative(value.policy)) {
    context.blockers.add("read_evidence_policy_too_weak");
  }
  const evaluatedAtMs = parseTimestamp(
    value.evaluatedAt,
    context,
    "read_evidence_invalid",
  );
  const firstObservedAtMs = parseTimestamp(
    domain?.firstObservedAt,
    context,
    "read_evidence_invalid",
  );
  const lastObservedAtMs = parseTimestamp(
    domain?.lastObservedAt,
    context,
    "read_evidence_invalid",
  );
  if (
    firstObservedAtMs === null ||
    lastObservedAtMs === null ||
    lastObservedAtMs < firstObservedAtMs ||
    lastObservedAtMs - firstObservedAtMs <
      minimumWindowHours * 3_600_000
  ) {
    context.blockers.add("read_evidence_not_ready");
  }
  const maxReadAgeHours =
    policy && isFiniteNonNegative(policy.maximumLastObservationAgeHours)
      ? policy.maximumLastObservationAgeHours
      : DEFAULT_MERCHANT_V1_READ_ROLLOUT_POLICY.maximumLastObservationAgeHours;
  if (
    isStale(
      evaluatedAtMs,
      context.nowMs,
      context.policy.maximumEvidenceAgeHours * 3_600_000,
    ) ||
    isStale(
      lastObservedAtMs,
      context.nowMs,
      maxReadAgeHours * 3_600_000,
    )
  ) {
    context.blockers.add("read_evidence_stale");
  }
  return firstObservedAtMs;
}

function parseOutboxSnapshot(
  value: Record<string, unknown>,
): MerchantOutboxHealthSnapshot | null {
  const stringFields = ["generatedAt", "merchantScope"] as const;
  const numberFields = [
    "windowHours",
    "pendingCount",
    "retryScheduledCount",
    "processingCount",
    "completedCount",
    "deadLetterCount",
    "dueCount",
    "scheduledCount",
    "expiredLeaseCount",
    "attemptLimitRiskCount",
    "unknownEventTypeCount",
    "oldestDueAgeSeconds",
    "attemptsInWindow",
    "completedAttemptsInWindow",
    "retryAttemptsInWindow",
    "deadLetterAttemptsInWindow",
    "leaseExpiredAttemptsInWindow",
  ] as const;
  if (
    stringFields.some((field) => typeof value[field] !== "string") ||
    numberFields.some((field) => !isNonNegativeInteger(value[field]))
  ) {
    return null;
  }
  return value as MerchantOutboxHealthSnapshot;
}

function addOutboxBlockers(
  value: unknown,
  siteId: string | null,
  context: GateContext,
) {
  if (!isRecord(value)) {
    context.blockers.add("outbox_snapshot_invalid");
    return;
  }
  const snapshot = parseOutboxSnapshot(value);
  if (snapshot === null) {
    context.blockers.add("outbox_snapshot_invalid");
    return;
  }
  if (siteId === null || snapshot.merchantScope !== siteId) {
    context.blockers.add("outbox_scope_mismatch");
  }
  const generatedAtMs = parseTimestamp(
    snapshot.generatedAt,
    context,
    "outbox_snapshot_invalid",
  );
  if (
    isStale(
      generatedAtMs,
      context.nowMs,
      context.policy.maximumOutboxAgeMinutes * 60_000,
    )
  ) {
    context.blockers.add("outbox_snapshot_stale");
  }
  const health = evaluateMerchantOutboxHealth(snapshot, {
    maximumOldestDueAgeSeconds:
      context.policy.maximumOutboxOldestDueAgeSeconds,
  });
  if (health.status !== "healthy") {
    context.blockers.add("outbox_unhealthy");
  }
  health.warnings.forEach((warning) => context.warnings.add(warning));
}

export function evaluateMerchantV1RolloutGate(input: {
  manifest: unknown;
  nowMs?: number;
  policy?: Partial<MerchantV1RolloutGatePolicy>;
}): MerchantV1RolloutGateReport {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("invalid_rollout_gate_now");
  const context: GateContext = {
    nowMs,
    policy: normalizeGatePolicy(input.policy),
    blockers: new Set<MerchantV1RolloutGateBlocker>(),
    warnings: new Set<string>(),
  };
  if (!isRecord(input.manifest)) {
    context.blockers.add("invalid_manifest");
    return {
      status: "blocked",
      evaluatedAt: new Date(nowMs).toISOString(),
      siteId: null,
      domain: null,
      currentReadMode: null,
      targetReadMode: null,
      requiredMigrations: [...ORDER_V1_PRIMARY_REQUIRED_MIGRATIONS],
      blockers: [...context.blockers],
      warnings: [],
    };
  }

  const manifest = input.manifest;
  const siteId =
    typeof manifest.siteId === "string" &&
    SITE_ID_PATTERN.test(manifest.siteId)
      ? manifest.siteId
      : null;
  const domain =
    typeof manifest.domain === "string" ? manifest.domain : null;
  const currentReadMode =
    typeof manifest.currentReadMode === "string"
      ? manifest.currentReadMode
      : null;
  const targetReadMode =
    typeof manifest.targetReadMode === "string"
      ? manifest.targetReadMode
      : null;

  if (manifest.schemaVersion !== MERCHANT_V1_ROLLOUT_GATE_SCHEMA_VERSION) {
    context.blockers.add("invalid_schema_version");
  }
  if (siteId === null) context.blockers.add("invalid_site_id");
  if (domain !== "orders") context.blockers.add("unsupported_domain");
  if (currentReadMode !== "verify" || targetReadMode !== "primary") {
    context.blockers.add("invalid_read_transition");
  }

  addOwnerBlockers(manifest, context);
  addAllowlistBlockers(manifest, siteId, context);
  addMigrationBlockers(manifest, context);
  addBackfillBlockers(manifest.backfill, context);
  addReconciliationBlockers(manifest.reconciliation, context);
  const firstReadObservedAtMs = addReadEvidenceBlockers(
    manifest.readEvidence,
    siteId,
    context,
  );
  addDualWriteBlockers(
    manifest.dualWrite,
    siteId,
    firstReadObservedAtMs,
    context,
  );
  addOutboxBlockers(manifest.outbox, siteId, context);

  return {
    status: context.blockers.size === 0 ? "ready" : "blocked",
    evaluatedAt: new Date(nowMs).toISOString(),
    siteId,
    domain,
    currentReadMode,
    targetReadMode,
    requiredMigrations: [...ORDER_V1_PRIMARY_REQUIRED_MIGRATIONS],
    blockers: [...context.blockers],
    warnings: [...context.warnings],
  };
}
