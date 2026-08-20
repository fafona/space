import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCTION_RELEASE_ATTESTATION_SCHEMA_VERSION = 1;
export const PRODUCTION_BACKUP_ATTESTATION_KIND =
  "faolla.production-backup.v1";
export const PRODUCTION_READINESS_ATTESTATION_KIND =
  "faolla.production-readiness.v1";
export const PRODUCTION_BACKUP_WORKFLOW_PATH =
  ".github/workflows/database-backup.yml";
export const PRODUCTION_READINESS_WORKFLOW_PATH =
  ".github/workflows/ordinary-account-cutover-readiness.yml";
export const PRODUCTION_RELEASE_MAX_CLOCK_SKEW_MS = 0;
export const PRODUCTION_RELEASE_MINIMUM_TTL_MS = 60 * 1000;
export const PRODUCTION_BACKUP_MAXIMUM_TTL_MS = 24 * 60 * 60 * 1000;
export const PRODUCTION_READINESS_MAXIMUM_TTL_MS = 2 * 60 * 60 * 1000;
export const PRODUCTION_RELEASE_MAX_ATTESTATION_FILE_BYTES = 1024 * 1024;

export const PRODUCTION_RELEASE_AGGREGATE_KEYS = Object.freeze([
  "merchantRecordCount",
  "merchantAuthoritativeBindingCount",
  "merchantInvalidBindingCount",
  "personalCanonicalBindingCount",
  "personalCanonicalOrphanCount",
  "personalInvalidCanonicalCount",
  "personalDuplicateAuthUserCount",
  "personalDuplicateAccountIdCount",
  "crossAccountTypeOverlapCount",
  "accountIdentifierCollisionCount",
  "staffRegistryOverlapCount",
  "systemSitePrincipalOverlapCount",
]);

const BACKUP_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "repository",
  "targetSha",
  "run",
  "remoteSource",
  "database",
  "baseline",
  "backupArtifact",
  "issuedAt",
  "validUntil",
]);
const READINESS_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "repository",
  "targetSha",
  "run",
  "remoteSource",
  "database",
  "baseline",
  "readinessArtifact",
  "backup",
  "issuedAt",
  "validUntil",
]);
const RUN_KEYS = Object.freeze([
  "id",
  "attempt",
  "workflowPath",
  "event",
  "headSha",
  "headBranch",
]);
const REMOTE_SOURCE_KEYS = Object.freeze([
  "headSha",
  "originMainSha",
  "detached",
  "cleanBefore",
  "cleanAfter",
]);
const DATABASE_IDENTITY_KEYS = Object.freeze([
  "containerName",
  "containerId",
  "dbName",
  "dbOid",
  "systemId",
  "primary",
]);
const ARTIFACT_KEYS = Object.freeze([
  "id",
  "name",
  "digest",
  "sizeBytes",
  "createdAt",
  "expiresAt",
  "expired",
  "workflowRunId",
  "workflowRunAttempt",
  "headSha",
  "file",
]);
const ARTIFACT_FILE_KEYS = Object.freeze([
  "name",
  "sizeBytes",
  "sha256",
]);
const BACKUP_REFERENCE_KEYS = Object.freeze([
  "attestation",
  "attestationArtifact",
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/;
const NON_NEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const CONTAINER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const MAX_UINT32 = 4_294_967_295n;
const MAX_INT64 = 9_223_372_036_854_775_807n;
const MAX_UINT64 = 18_446_744_073_709_551_615n;

export class ProductionReleaseAttestationError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProductionReleaseAttestationError";
    this.code = code;
  }
}

function fail(code) {
  throw new ProductionReleaseAttestationError(code);
}

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value, keys, code) {
  if (!isPlainRecord(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(code);
  }
  return value;
}

function validateExactString(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

function validateDecimalString(value, options) {
  const {
    code,
    allowZero = false,
    maximum = MAX_UINT64,
  } = options;
  const pattern = allowZero
    ? NON_NEGATIVE_DECIMAL_PATTERN
    : POSITIVE_DECIMAL_PATTERN;
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    fail(code);
  }
  if (parsed > maximum) fail(code);
  return value;
}

function validateCanonicalTimestamp(value, code) {
  if (
    typeof value !== "string" ||
    !CANONICAL_TIMESTAMP_PATTERN.test(value)
  ) {
    fail(code);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail(code);
  }
  return { value, timestamp };
}

function normalizeTimeContext(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const minimumRemainingTtlMs = options.minimumRemainingTtlMs ?? 0;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    fail("attestation_validation_time_invalid");
  }
  if (
    !Number.isSafeInteger(minimumRemainingTtlMs) ||
    minimumRemainingTtlMs < 0
  ) {
    fail("attestation_minimum_remaining_ttl_invalid");
  }
  return { nowMs, minimumRemainingTtlMs };
}

function validateLifetime(value, kind, timeContext) {
  const issuedAt = validateCanonicalTimestamp(
    value.issuedAt,
    "attestation_issued_at_invalid",
  );
  const validUntil = validateCanonicalTimestamp(
    value.validUntil,
    "attestation_valid_until_invalid",
  );
  const ttlMs = validUntil.timestamp - issuedAt.timestamp;
  const maximumTtlMs =
    kind === PRODUCTION_BACKUP_ATTESTATION_KIND
      ? PRODUCTION_BACKUP_MAXIMUM_TTL_MS
      : PRODUCTION_READINESS_MAXIMUM_TTL_MS;
  if (
    ttlMs < PRODUCTION_RELEASE_MINIMUM_TTL_MS ||
    ttlMs > maximumTtlMs
  ) {
    fail("attestation_ttl_invalid");
  }
  if (
    issuedAt.timestamp >
    timeContext.nowMs + PRODUCTION_RELEASE_MAX_CLOCK_SKEW_MS
  ) {
    fail("attestation_issued_in_future");
  }
  if (validUntil.timestamp <= timeContext.nowMs) {
    fail("attestation_expired");
  }
  if (
    validUntil.timestamp - timeContext.nowMs <
    timeContext.minimumRemainingTtlMs
  ) {
    fail("attestation_remaining_ttl_insufficient");
  }
  return { issuedAt, validUntil };
}

function validateRepository(value) {
  return validateExactString(
    value,
    REPOSITORY_PATTERN,
    "attestation_repository_invalid",
  );
}

function validateTargetSha(value, code = "attestation_target_sha_invalid") {
  return validateExactString(value, SHA_PATTERN, code);
}

function validateRun(value, kind, targetSha) {
  const source = exactRecord(value, RUN_KEYS, "attestation_run_invalid");
  const id = validateDecimalString(source.id, {
    code: "attestation_run_id_invalid",
    maximum: MAX_UINT64,
  });
  const attempt = validateDecimalString(source.attempt, {
    code: "attestation_run_attempt_invalid",
    maximum: MAX_UINT32,
  });
  const expectedWorkflowPath =
    kind === PRODUCTION_BACKUP_ATTESTATION_KIND
      ? PRODUCTION_BACKUP_WORKFLOW_PATH
      : PRODUCTION_READINESS_WORKFLOW_PATH;
  const allowedEvents =
    kind === PRODUCTION_BACKUP_ATTESTATION_KIND
      ? new Set(["workflow_dispatch", "schedule"])
      : new Set(["workflow_dispatch"]);
  if (source.workflowPath !== expectedWorkflowPath) {
    fail("attestation_run_workflow_path_mismatch");
  }
  if (!allowedEvents.has(source.event)) {
    fail("attestation_run_event_invalid");
  }
  const headSha = validateTargetSha(
    source.headSha,
    "attestation_run_head_sha_invalid",
  );
  if (headSha !== targetSha) fail("attestation_run_head_sha_mismatch");
  if (source.headBranch !== "main") {
    fail("attestation_run_head_branch_invalid");
  }
  return {
    id,
    attempt,
    workflowPath: expectedWorkflowPath,
    event: source.event,
    headSha,
    headBranch: "main",
  };
}

function validateRemoteSource(value, targetSha) {
  const source = exactRecord(
    value,
    REMOTE_SOURCE_KEYS,
    "attestation_remote_source_invalid",
  );
  const headSha = validateTargetSha(
    source.headSha,
    "attestation_remote_head_sha_invalid",
  );
  const originMainSha = validateTargetSha(
    source.originMainSha,
    "attestation_remote_origin_sha_invalid",
  );
  if (headSha !== targetSha || originMainSha !== targetSha) {
    fail("attestation_remote_source_sha_mismatch");
  }
  if (
    source.detached !== true ||
    source.cleanBefore !== true ||
    source.cleanAfter !== true
  ) {
    fail("attestation_remote_source_not_clean_detached");
  }
  return {
    headSha,
    originMainSha,
    detached: true,
    cleanBefore: true,
    cleanAfter: true,
  };
}

function validateDatabaseIdentity(value) {
  const source = exactRecord(
    value,
    DATABASE_IDENTITY_KEYS,
    "attestation_database_identity_invalid",
  );
  const containerName = validateExactString(
    source.containerName,
    CONTAINER_NAME_PATTERN,
    "attestation_database_container_name_invalid",
  );
  const containerId = validateExactString(
    source.containerId,
    CONTAINER_ID_PATTERN,
    "attestation_database_container_id_invalid",
  );
  const dbName = validateExactString(
    source.dbName,
    DATABASE_NAME_PATTERN,
    "attestation_database_name_invalid",
  );
  const dbOid = validateDecimalString(source.dbOid, {
    code: "attestation_database_oid_invalid",
    maximum: MAX_UINT32,
  });
  const systemId = validateDecimalString(source.systemId, {
    code: "attestation_database_system_identifier_invalid",
    maximum: MAX_UINT64,
  });
  if (source.primary !== true) fail("attestation_database_not_primary");
  return {
    containerName,
    containerId,
    dbName,
    dbOid,
    systemId,
    primary: true,
  };
}

function validateAggregateBaseline(value) {
  const source = exactRecord(
    value,
    PRODUCTION_RELEASE_AGGREGATE_KEYS,
    "attestation_baseline_invalid",
  );
  const baseline = Object.fromEntries(
    PRODUCTION_RELEASE_AGGREGATE_KEYS.map((key) => [
      key,
      validateDecimalString(source[key], {
        code: `attestation_baseline_${key}_invalid`,
        allowZero: true,
        maximum: MAX_INT64,
      }),
    ]),
  );
  if (
    BigInt(baseline.merchantAuthoritativeBindingCount) >
    BigInt(baseline.merchantRecordCount)
  ) {
    fail("attestation_baseline_merchant_binding_count_invalid");
  }
  return baseline;
}

function validateArtifactFile(value) {
  const source = exactRecord(
    value,
    ARTIFACT_FILE_KEYS,
    "attestation_artifact_file_invalid",
  );
  return {
    name: validateExactString(
      source.name,
      SAFE_NAME_PATTERN,
      "attestation_artifact_file_name_invalid",
    ),
    sizeBytes: validateDecimalString(source.sizeBytes, {
      code: "attestation_artifact_file_size_invalid",
      maximum: MAX_UINT64,
    }),
    sha256: validateExactString(
      source.sha256,
      SHA256_PATTERN,
      "attestation_artifact_file_sha256_invalid",
    ),
  };
}

function validateArtifact(value, context) {
  const source = exactRecord(
    value,
    ARTIFACT_KEYS,
    "attestation_artifact_invalid",
  );
  const id = validateDecimalString(source.id, {
    code: "attestation_artifact_id_invalid",
    maximum: MAX_UINT64,
  });
  const name = validateExactString(
    source.name,
    SAFE_NAME_PATTERN,
    "attestation_artifact_name_invalid",
  );
  const digest = validateExactString(
    source.digest,
    ARTIFACT_DIGEST_PATTERN,
    "attestation_artifact_digest_invalid",
  );
  const sizeBytes = validateDecimalString(source.sizeBytes, {
    code: "attestation_artifact_size_invalid",
    maximum: MAX_UINT64,
  });
  const createdAt = validateCanonicalTimestamp(
    source.createdAt,
    "attestation_artifact_created_at_invalid",
  );
  const expiresAt = validateCanonicalTimestamp(
    source.expiresAt,
    "attestation_artifact_expires_at_invalid",
  );
  if (source.expired !== false) fail("attestation_artifact_expired");
  if (expiresAt.timestamp <= createdAt.timestamp) {
    fail("attestation_artifact_lifetime_invalid");
  }
  if (expiresAt.timestamp <= context.timeContext.nowMs) {
    fail("attestation_artifact_expired");
  }
  if (expiresAt.timestamp < context.requiredValidUntilMs) {
    fail("attestation_artifact_ttl_mismatch");
  }
  if (
    createdAt.timestamp >
      context.timeContext.nowMs + PRODUCTION_RELEASE_MAX_CLOCK_SKEW_MS ||
    createdAt.timestamp >
      context.maximumCreatedAtMs + PRODUCTION_RELEASE_MAX_CLOCK_SKEW_MS
  ) {
    fail("attestation_artifact_created_in_future");
  }
  const workflowRunId = validateDecimalString(source.workflowRunId, {
    code: "attestation_artifact_workflow_run_id_invalid",
    maximum: MAX_UINT64,
  });
  const workflowRunAttempt = validateDecimalString(
    source.workflowRunAttempt,
    {
      code: "attestation_artifact_workflow_run_attempt_invalid",
      maximum: MAX_UINT32,
    },
  );
  const headSha = validateTargetSha(
    source.headSha,
    "attestation_artifact_head_sha_invalid",
  );
  if (
    workflowRunId !== context.run.id ||
    workflowRunAttempt !== context.run.attempt ||
    headSha !== context.targetSha
  ) {
    fail("attestation_artifact_run_mismatch");
  }
  return {
    id,
    name,
    digest,
    sizeBytes,
    createdAt: createdAt.value,
    expiresAt: expiresAt.value,
    expired: false,
    workflowRunId,
    workflowRunAttempt,
    headSha,
    file: validateArtifactFile(source.file),
  };
}

function validateSchemaAndKind(value, kind) {
  if (
    value.schemaVersion !== PRODUCTION_RELEASE_ATTESTATION_SCHEMA_VERSION
  ) {
    fail("attestation_schema_version_invalid");
  }
  if (value.kind !== kind) fail("attestation_kind_invalid");
}

function canonicalValuesEqual(left, right) {
  return canonicalJsonBytes(left).equals(canonicalJsonBytes(right));
}

function parseBackupAttestation(value, timeContext) {
  const source = exactRecord(
    value,
    BACKUP_KEYS,
    "backup_attestation_keys_invalid",
  );
  validateSchemaAndKind(source, PRODUCTION_BACKUP_ATTESTATION_KIND);
  const repository = validateRepository(source.repository);
  const targetSha = validateTargetSha(source.targetSha);
  const lifetime = validateLifetime(
    source,
    PRODUCTION_BACKUP_ATTESTATION_KIND,
    timeContext,
  );
  const run = validateRun(
    source.run,
    PRODUCTION_BACKUP_ATTESTATION_KIND,
    targetSha,
  );
  const remoteSource = validateRemoteSource(source.remoteSource, targetSha);
  const database = validateDatabaseIdentity(source.database);
  const baseline = validateAggregateBaseline(source.baseline);
  const backupArtifact = validateArtifact(source.backupArtifact, {
    run,
    targetSha,
    timeContext,
    maximumCreatedAtMs: lifetime.issuedAt.timestamp,
    requiredValidUntilMs: lifetime.validUntil.timestamp,
  });
  return {
    schemaVersion: PRODUCTION_RELEASE_ATTESTATION_SCHEMA_VERSION,
    kind: PRODUCTION_BACKUP_ATTESTATION_KIND,
    repository,
    targetSha,
    run,
    remoteSource,
    database,
    baseline,
    backupArtifact,
    issuedAt: lifetime.issuedAt.value,
    validUntil: lifetime.validUntil.value,
  };
}

function parseReadinessAttestation(value, timeContext) {
  const source = exactRecord(
    value,
    READINESS_KEYS,
    "readiness_attestation_keys_invalid",
  );
  validateSchemaAndKind(source, PRODUCTION_READINESS_ATTESTATION_KIND);
  const repository = validateRepository(source.repository);
  const targetSha = validateTargetSha(source.targetSha);
  const lifetime = validateLifetime(
    source,
    PRODUCTION_READINESS_ATTESTATION_KIND,
    timeContext,
  );
  const run = validateRun(
    source.run,
    PRODUCTION_READINESS_ATTESTATION_KIND,
    targetSha,
  );
  const remoteSource = validateRemoteSource(source.remoteSource, targetSha);
  const database = validateDatabaseIdentity(source.database);
  const baseline = validateAggregateBaseline(source.baseline);
  const readinessArtifact = validateArtifact(source.readinessArtifact, {
    run,
    targetSha,
    timeContext,
    maximumCreatedAtMs: lifetime.issuedAt.timestamp,
    requiredValidUntilMs: lifetime.validUntil.timestamp,
  });
  const backupSource = exactRecord(
    source.backup,
    BACKUP_REFERENCE_KEYS,
    "readiness_backup_reference_invalid",
  );
  const backupAttestation = parseBackupAttestation(
    backupSource.attestation,
    timeContext,
  );
  const backupLifetime = {
    issuedAt: validateCanonicalTimestamp(
      backupAttestation.issuedAt,
      "attestation_issued_at_invalid",
    ),
    validUntil: validateCanonicalTimestamp(
      backupAttestation.validUntil,
      "attestation_valid_until_invalid",
    ),
  };
  if (
    backupAttestation.repository !== repository ||
    backupAttestation.targetSha !== targetSha
  ) {
    fail("readiness_backup_scope_mismatch");
  }
  if (!canonicalValuesEqual(backupAttestation.database, database)) {
    fail("readiness_backup_database_mismatch");
  }
  if (!canonicalValuesEqual(backupAttestation.baseline, baseline)) {
    fail("readiness_backup_baseline_mismatch");
  }
  if (
    lifetime.issuedAt.timestamp + PRODUCTION_RELEASE_MAX_CLOCK_SKEW_MS <
      backupLifetime.issuedAt.timestamp ||
    lifetime.validUntil.timestamp > backupLifetime.validUntil.timestamp
  ) {
    fail("readiness_backup_lifetime_mismatch");
  }
  if (run.id === backupAttestation.run.id) {
    fail("readiness_backup_run_id_reused");
  }
  const backupAttestationArtifact = validateArtifact(
    backupSource.attestationArtifact,
    {
      run: backupAttestation.run,
      targetSha,
      timeContext,
      maximumCreatedAtMs: lifetime.issuedAt.timestamp,
      requiredValidUntilMs: lifetime.validUntil.timestamp,
    },
  );
  const backupCanonicalBytes = canonicalJsonBytes(backupAttestation);
  if (
    backupAttestationArtifact.file.sha256 !==
      sha256Hex(backupCanonicalBytes) ||
    backupAttestationArtifact.file.sizeBytes !==
      String(backupCanonicalBytes.length)
  ) {
    fail("readiness_backup_attestation_artifact_mismatch");
  }
  const backupArtifactCreatedAt = validateCanonicalTimestamp(
    backupAttestationArtifact.createdAt,
    "attestation_artifact_created_at_invalid",
  );
  if (
    backupArtifactCreatedAt.timestamp + PRODUCTION_RELEASE_MAX_CLOCK_SKEW_MS <
    backupLifetime.issuedAt.timestamp
  ) {
    fail("readiness_backup_attestation_artifact_time_mismatch");
  }
  const artifactIds = new Set([
    readinessArtifact.id,
    backupAttestation.backupArtifact.id,
    backupAttestationArtifact.id,
  ]);
  if (artifactIds.size !== 3) fail("readiness_artifact_id_reused");
  return {
    schemaVersion: PRODUCTION_RELEASE_ATTESTATION_SCHEMA_VERSION,
    kind: PRODUCTION_READINESS_ATTESTATION_KIND,
    repository,
    targetSha,
    run,
    remoteSource,
    database,
    baseline,
    readinessArtifact,
    backup: {
      attestation: backupAttestation,
      attestationArtifact: backupAttestationArtifact,
    },
    issuedAt: lifetime.issuedAt.value,
    validUntil: lifetime.validUntil.value,
  };
}

function normalizeKind(value) {
  if (
    value === "backup" ||
    value === PRODUCTION_BACKUP_ATTESTATION_KIND
  ) {
    return PRODUCTION_BACKUP_ATTESTATION_KIND;
  }
  if (
    value === "readiness" ||
    value === PRODUCTION_READINESS_ATTESTATION_KIND
  ) {
    return PRODUCTION_READINESS_ATTESTATION_KIND;
  }
  fail("attestation_expected_kind_invalid");
}

function primaryArtifact(attestation) {
  return attestation.kind === PRODUCTION_BACKUP_ATTESTATION_KIND
    ? attestation.backupArtifact
    : attestation.readinessArtifact;
}

function backupRunId(attestation) {
  return attestation.kind === PRODUCTION_BACKUP_ATTESTATION_KIND
    ? attestation.run.id
    : attestation.backup.attestation.run.id;
}

function backupArtifact(attestation) {
  return attestation.kind === PRODUCTION_BACKUP_ATTESTATION_KIND
    ? attestation.backupArtifact
    : attestation.backup.attestation.backupArtifact;
}

function backupAttestationArtifact(attestation) {
  return attestation.kind === PRODUCTION_READINESS_ATTESTATION_KIND
    ? attestation.backup.attestationArtifact
    : null;
}

function readinessArtifact(attestation) {
  return attestation.kind === PRODUCTION_READINESS_ATTESTATION_KIND
    ? attestation.readinessArtifact
    : null;
}

function validateExpectedValues(attestation, options) {
  if (
    options.expectedKind !== undefined &&
    attestation.kind !== normalizeKind(options.expectedKind)
  ) {
    fail("attestation_expected_kind_mismatch");
  }
  const stringExpectations = [
    ["expectedRepository", attestation.repository, "attestation_repository_mismatch"],
    ["expectedTargetSha", attestation.targetSha, "attestation_target_sha_mismatch"],
    ["expectedRunId", attestation.run.id, "attestation_run_id_mismatch"],
    [
      "expectedRunAttempt",
      attestation.run.attempt,
      "attestation_run_attempt_mismatch",
    ],
    [
      "expectedBackupRunId",
      backupRunId(attestation),
      "attestation_backup_run_id_mismatch",
    ],
    [
      "expectedReadinessRunId",
      attestation.kind === PRODUCTION_READINESS_ATTESTATION_KIND
        ? attestation.run.id
        : null,
      "attestation_readiness_run_id_mismatch",
    ],
    [
      "expectedArtifactId",
      primaryArtifact(attestation).id,
      "attestation_artifact_id_mismatch",
    ],
    [
      "expectedArtifactDigest",
      primaryArtifact(attestation).digest,
      "attestation_artifact_digest_mismatch",
    ],
    [
      "expectedBackupArtifactId",
      backupArtifact(attestation).id,
      "attestation_backup_artifact_id_mismatch",
    ],
    [
      "expectedBackupArtifactDigest",
      backupArtifact(attestation).digest,
      "attestation_backup_artifact_digest_mismatch",
    ],
    [
      "expectedBackupAttestationArtifactId",
      backupAttestationArtifact(attestation)?.id ?? null,
      "attestation_backup_attestation_artifact_id_mismatch",
    ],
    [
      "expectedBackupAttestationArtifactDigest",
      backupAttestationArtifact(attestation)?.digest ?? null,
      "attestation_backup_attestation_artifact_digest_mismatch",
    ],
    [
      "expectedReadinessArtifactId",
      readinessArtifact(attestation)?.id ?? null,
      "attestation_readiness_artifact_id_mismatch",
    ],
    [
      "expectedReadinessArtifactDigest",
      readinessArtifact(attestation)?.digest ?? null,
      "attestation_readiness_artifact_digest_mismatch",
    ],
  ];
  for (const [optionKey, actual, code] of stringExpectations) {
    if (options[optionKey] !== undefined && options[optionKey] !== actual) {
      fail(code);
    }
  }
  if (
    options.expectedDatabase !== undefined &&
    !canonicalValuesEqual(
      validateDatabaseIdentity(options.expectedDatabase),
      attestation.database,
    )
  ) {
    fail("attestation_database_identity_mismatch");
  }
  if (
    options.expectedBaseline !== undefined &&
    !canonicalValuesEqual(
      validateAggregateBaseline(options.expectedBaseline),
      attestation.baseline,
    )
  ) {
    fail("attestation_baseline_mismatch");
  }
}

export function parseProductionReleaseAttestation(value, options = {}) {
  const timeContext = normalizeTimeContext(options);
  if (!isPlainRecord(value)) fail("attestation_not_object");
  let attestation;
  if (value.kind === PRODUCTION_BACKUP_ATTESTATION_KIND) {
    attestation = parseBackupAttestation(value, timeContext);
  } else if (value.kind === PRODUCTION_READINESS_ATTESTATION_KIND) {
    attestation = parseReadinessAttestation(value, timeContext);
  } else {
    fail("attestation_kind_invalid");
  }
  validateExpectedValues(attestation, options);
  return attestation;
}

export function validateProductionReleaseAttestation(value, options = {}) {
  try {
    const attestation = parseProductionReleaseAttestation(value, options);
    const canonicalBytes = canonicalJsonBytes(attestation);
    return {
      valid: true,
      attestation,
      canonicalBytes,
      sha256: sha256Hex(canonicalBytes),
    };
  } catch (error) {
    if (error instanceof ProductionReleaseAttestationError) {
      return { valid: false, error: error.code };
    }
    throw error;
  }
}

function canonicalJsonValue(value, seen) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail("canonical_json_number_invalid");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) fail("canonical_json_cycle");
    seen.add(value);
    const normalized = value.map((item) => canonicalJsonValue(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (!isPlainRecord(value)) fail("canonical_json_value_invalid");
  if (seen.has(value)) fail("canonical_json_cycle");
  seen.add(value);
  const normalized = Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJsonValue(value[key], seen)]),
  );
  seen.delete(value);
  return normalized;
}

export function canonicalJsonBytes(value) {
  const normalized = canonicalJsonValue(value, new Set());
  return Buffer.from(`${JSON.stringify(normalized)}\n`, "utf8");
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function productionReleaseAttestationSummary(attestation) {
  const canonicalBytes = canonicalJsonBytes(attestation);
  const backupEvidenceArtifact = backupArtifact(attestation);
  const backupJsonArtifact = backupAttestationArtifact(attestation);
  const readinessEvidenceArtifact = readinessArtifact(attestation);
  return {
    valid: true,
    kind: attestation.kind,
    repository: attestation.repository,
    targetSha: attestation.targetSha,
    runId: attestation.run.id,
    runAttempt: attestation.run.attempt,
    backupRunId: backupRunId(attestation),
    readinessRunId:
      attestation.kind === PRODUCTION_READINESS_ATTESTATION_KIND
        ? attestation.run.id
        : null,
    artifactId: primaryArtifact(attestation).id,
    artifactDigest: primaryArtifact(attestation).digest,
    backupArtifactId: backupEvidenceArtifact.id,
    backupArtifactDigest: backupEvidenceArtifact.digest,
    backupAttestationArtifactId: backupJsonArtifact?.id ?? null,
    backupAttestationArtifactDigest: backupJsonArtifact?.digest ?? null,
    readinessArtifactId: readinessEvidenceArtifact?.id ?? null,
    readinessArtifactDigest: readinessEvidenceArtifact?.digest ?? null,
    databaseIdentitySha256: sha256Hex(
      canonicalJsonBytes(attestation.database),
    ),
    baselineSha256: sha256Hex(canonicalJsonBytes(attestation.baseline)),
    canonicalSha256: sha256Hex(canonicalBytes),
    validUntil: attestation.validUntil,
  };
}

export async function readProductionReleaseAttestationFile(
  filePath,
  options = {},
) {
  let details;
  let raw;
  try {
    details = await stat(filePath);
    if (
      !details.isFile() ||
      details.size <= 0 ||
      details.size > PRODUCTION_RELEASE_MAX_ATTESTATION_FILE_BYTES
    ) {
      fail("attestation_input_file_invalid");
    }
    raw = await readFile(filePath);
  } catch (error) {
    if (error instanceof ProductionReleaseAttestationError) throw error;
    fail("attestation_input_unreadable");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("attestation_json_invalid");
  }
  const attestation = parseProductionReleaseAttestation(parsed, options);
  const canonicalBytes = canonicalJsonBytes(attestation);
  if (!raw.equals(canonicalBytes)) fail("attestation_json_not_canonical");
  return {
    attestation,
    canonicalBytes,
    sha256: sha256Hex(canonicalBytes),
  };
}

function parseCliArguments(argv) {
  if (argv[0] !== "validate") fail("attestation_cli_command_invalid");
  const values = new Map();
  const allowed = new Set([
    "--input",
    "--kind",
    "--now",
    "--expected-repository",
    "--expected-target-sha",
    "--expected-run-id",
    "--expected-run-attempt",
    "--expected-backup-run-id",
    "--expected-readiness-run-id",
    "--expected-artifact-id",
    "--expected-artifact-digest",
    "--expected-backup-artifact-id",
    "--expected-backup-artifact-digest",
    "--expected-backup-attestation-artifact-id",
    "--expected-backup-attestation-artifact-digest",
    "--expected-readiness-artifact-id",
    "--expected-readiness-artifact-digest",
    "--minimum-remaining-seconds",
  ]);
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || value === undefined || values.has(key)) {
      fail("attestation_cli_argument_invalid");
    }
    values.set(key, value);
  }
  if (!values.has("--input") || !values.has("--kind")) {
    fail("attestation_cli_argument_missing");
  }
  const kind = normalizeKind(values.get("--kind"));
  let nowMs;
  if (values.has("--now")) {
    nowMs = validateCanonicalTimestamp(
      values.get("--now"),
      "attestation_cli_now_invalid",
    ).timestamp;
  }
  let minimumRemainingTtlMs;
  if (values.has("--minimum-remaining-seconds")) {
    const seconds = validateDecimalString(
      values.get("--minimum-remaining-seconds"),
      {
        code: "attestation_cli_minimum_remaining_invalid",
        allowZero: true,
        maximum: MAX_UINT32,
      },
    );
    minimumRemainingTtlMs = Number(seconds) * 1000;
  }
  return {
    input: path.resolve(values.get("--input")),
    options: {
      expectedKind: kind,
      nowMs,
      minimumRemainingTtlMs,
      expectedRepository: values.get("--expected-repository"),
      expectedTargetSha: values.get("--expected-target-sha"),
      expectedRunId: values.get("--expected-run-id"),
      expectedRunAttempt: values.get("--expected-run-attempt"),
      expectedBackupRunId: values.get("--expected-backup-run-id"),
      expectedReadinessRunId: values.get("--expected-readiness-run-id"),
      expectedArtifactId: values.get("--expected-artifact-id"),
      expectedArtifactDigest: values.get("--expected-artifact-digest"),
      expectedBackupArtifactId: values.get("--expected-backup-artifact-id"),
      expectedBackupArtifactDigest: values.get(
        "--expected-backup-artifact-digest",
      ),
      expectedBackupAttestationArtifactId: values.get(
        "--expected-backup-attestation-artifact-id",
      ),
      expectedBackupAttestationArtifactDigest: values.get(
        "--expected-backup-attestation-artifact-digest",
      ),
      expectedReadinessArtifactId: values.get(
        "--expected-readiness-artifact-id",
      ),
      expectedReadinessArtifactDigest: values.get(
        "--expected-readiness-artifact-digest",
      ),
    },
  };
}

export async function runProductionReleaseAttestationCli(
  argv,
  io = {},
) {
  const write = io.write ?? ((value) => process.stdout.write(value));
  const { input, options } = parseCliArguments(argv);
  const { attestation } = await readProductionReleaseAttestationFile(
    input,
    options,
  );
  write(canonicalJsonBytes(productionReleaseAttestationSummary(attestation)));
  return 0;
}

async function main() {
  try {
    await runProductionReleaseAttestationCli(process.argv.slice(2));
  } catch (error) {
    const code =
      error instanceof ProductionReleaseAttestationError
        ? error.code
        : "attestation_unexpected_error";
    process.stderr.write(canonicalJsonBytes({ valid: false, error: code }));
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryUrl === import.meta.url) {
  await main();
}
