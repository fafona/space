import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  sha256File,
  validateDatabaseBackupSourceIdentity,
} from "./database-backup-contract.mjs";
import {
  canonicalJsonBytes,
  PRODUCTION_BACKUP_ATTESTATION_KIND,
  PRODUCTION_BACKUP_WORKFLOW_PATH,
  validateProductionReleaseAttestation,
} from "./production-release-attestation.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DECIMAL_ID_PATTERN = /^[1-9][0-9]*$/;
const GITHUB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export class DatabaseBackupAttestationError extends Error {
  constructor(code) {
    super(code);
    this.name = "DatabaseBackupAttestationError";
    this.code = code;
  }
}

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readArgument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((entry) => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function requireDecimalId(value, code) {
  const normalized = trimText(value);
  if (!DECIMAL_ID_PATTERN.test(normalized)) {
    throw new DatabaseBackupAttestationError(code);
  }
  return normalized;
}

function requireSha256(value, code) {
  const normalized = trimText(value).replace(/^sha256:/, "");
  if (!SHA256_PATTERN.test(normalized)) {
    throw new DatabaseBackupAttestationError(code);
  }
  return normalized;
}

function normalizeTimestamp(value, code) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new DatabaseBackupAttestationError(code);
  }
  return new Date(timestamp).toISOString();
}

async function readLastJsonLine(filePath, code) {
  let text;
  try {
    text = await readFile(path.resolve(filePath), "utf8");
  } catch {
    throw new DatabaseBackupAttestationError(code);
  }
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  try {
    const value = JSON.parse(line ?? "");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value;
  } catch {
    throw new DatabaseBackupAttestationError(code);
  }
}

async function requireEvidenceFile(filePath, code) {
  const resolved = path.resolve(filePath);
  let details;
  try {
    details = await stat(resolved);
  } catch {
    throw new DatabaseBackupAttestationError(code);
  }
  if (!details.isFile() || details.size <= 0) {
    throw new DatabaseBackupAttestationError(code);
  }
  return {
    bytes: details.size,
    sha256: await sha256File(resolved),
  };
}

function requireStableSource(value, repository, targetSha, code) {
  const validation = validateDatabaseBackupSourceIdentity(value);
  if (
    !validation.valid ||
    validation.source.repository !== repository ||
    validation.source.sha !== targetSha
  ) {
    throw new DatabaseBackupAttestationError(code);
  }
  return validation.source;
}

function assertSameSource(actual, expected, code) {
  try {
    assert.deepEqual(actual, expected);
  } catch {
    throw new DatabaseBackupAttestationError(code);
  }
}

export async function createDatabaseBackupSubjectEvidence(input) {
  const repository = trimText(input.repository);
  const targetSha = trimText(input.targetSha);
  if (!GITHUB_REPOSITORY_PATTERN.test(repository)) {
    throw new DatabaseBackupAttestationError("attestation_repository_invalid");
  }
  if (!/^[0-9a-f]{40}$/.test(targetSha)) {
    throw new DatabaseBackupAttestationError("attestation_target_sha_invalid");
  }
  const ciRunId = requireDecimalId(
    input.ciRunId,
    "attestation_ci_run_id_invalid",
  );
  const workflowRunId = requireDecimalId(
    input.workflowRunId,
    "attestation_workflow_run_id_invalid",
  );
  const workflowRunAttempt = requireDecimalId(
    input.workflowRunAttempt,
    "attestation_workflow_run_attempt_invalid",
  );
  const workflowEvent = trimText(input.workflowEvent);
  if (!new Set(["workflow_dispatch", "schedule"]).has(workflowEvent)) {
    throw new DatabaseBackupAttestationError(
      "attestation_workflow_event_invalid",
    );
  }

  const backupPath = path.resolve(input.backupPath);
  const backupDetails = await requireEvidenceFile(
    backupPath,
    "attestation_backup_missing",
  );
  const readiness = await readLastJsonLine(
    input.readinessReportPath,
    "attestation_readiness_report_invalid",
  );
  const create = await readLastJsonLine(
    input.createReportPath,
    "attestation_create_report_invalid",
  );
  const verify = await readLastJsonLine(
    input.verifyReportPath,
    "attestation_verify_report_invalid",
  );
  const restore = await readLastJsonLine(
    input.restoreReportPath,
    "attestation_restore_report_invalid",
  );

  if (
    readiness.backupReady !== true ||
    readiness.recoveryRehearsalReady !== true ||
    !Array.isArray(readiness.blockers) ||
    readiness.blockers.length !== 0 ||
    !Array.isArray(readiness.recoveryBlockers) ||
    readiness.recoveryBlockers.length !== 0
  ) {
    throw new DatabaseBackupAttestationError("attestation_readiness_not_ready");
  }
  if (
    create.schemaVersion !== 2 ||
    create.status !== "created" ||
    create.outputBytes !== backupDetails.bytes ||
    requireSha256(create.outputSha256, "attestation_create_sha256_invalid") !==
      backupDetails.sha256
  ) {
    throw new DatabaseBackupAttestationError("attestation_create_mismatch");
  }
  const source = requireStableSource(
    create.source,
    repository,
    targetSha,
    "attestation_create_source_invalid",
  );
  if (
    verify.schemaVersion !== 2 ||
    verify.status !== "verified" ||
    verify.manifestSchemaVersion !== 2 ||
    verify.inputBytes !== backupDetails.bytes ||
    verify.format !== create.format
  ) {
    throw new DatabaseBackupAttestationError("attestation_verify_mismatch");
  }
  assertSameSource(
    requireStableSource(
      verify.source,
      repository,
      targetSha,
      "attestation_verify_source_invalid",
    ),
    source,
    "attestation_verify_source_mismatch",
  );
  if (
    restore.schemaVersion !== 2 ||
    restore.status !== "restored" ||
    restore.backupStatus !== "verified" ||
    restore.inputBytes !== backupDetails.bytes ||
    restore.isolation !== "ephemeral_docker_no_network"
  ) {
    throw new DatabaseBackupAttestationError("attestation_restore_mismatch");
  }
  assertSameSource(
    requireStableSource(
      restore.source,
      repository,
      targetSha,
      "attestation_restore_source_invalid",
    ),
    source,
    "attestation_restore_source_mismatch",
  );
  try {
    assert.deepEqual(restore.restoredBaseline, source.database.baseline);
  } catch {
    throw new DatabaseBackupAttestationError(
      "attestation_restore_baseline_mismatch",
    );
  }

  const reportPaths = {
    readiness: input.readinessReportPath,
    create: input.createReportPath,
    transfer: input.transferReportPath,
    verify: input.verifyReportPath,
    restore: input.restoreReportPath,
  };
  const reports = {};
  for (const [name, reportPath] of Object.entries(reportPaths)) {
    reports[name] = await requireEvidenceFile(
      reportPath,
      `attestation_${name}_report_missing`,
    );
  }

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    subject: {
      name: path.basename(backupPath),
      bytes: backupDetails.bytes,
      digest: `sha256:${backupDetails.sha256}`,
    },
    source,
    ci: {
      workflow: "CI",
      event: "push",
      branch: "main",
      runId: ciRunId,
    },
    backupWorkflow: {
      repository,
      runId: workflowRunId,
      runAttempt: workflowRunAttempt,
      event: workflowEvent,
    },
    backup: {
      createdAt: trimText(create.createdAt),
      format: create.format,
      restoreIsolation: restore.isolation,
      readinessStatus: readiness.status,
    },
    reports,
  };
}

function validateSubjectEvidence(value) {
  if (
    value?.schemaVersion !== 1 ||
    !Number.isFinite(Date.parse(trimText(value?.generatedAt))) ||
    !Number.isSafeInteger(value?.subject?.bytes) ||
    value.subject.bytes <= 0 ||
    !/^sha256:[0-9a-f]{64}$/.test(trimText(value?.subject?.digest))
  ) {
    throw new DatabaseBackupAttestationError(
      "attestation_subject_evidence_invalid",
    );
  }
  const repository = trimText(value?.backupWorkflow?.repository);
  const source = requireStableSource(
    value.source,
    repository,
    trimText(value?.source?.sha),
    "attestation_subject_source_invalid",
  );
  if (source.repository !== repository) {
    throw new DatabaseBackupAttestationError(
      "attestation_subject_repository_mismatch",
    );
  }
  requireDecimalId(value?.ci?.runId, "attestation_subject_ci_invalid");
  requireDecimalId(
    value?.backupWorkflow?.runId,
    "attestation_subject_workflow_invalid",
  );
  requireDecimalId(
    value?.backupWorkflow?.runAttempt,
    "attestation_subject_attempt_invalid",
  );
  if (
    !new Set(["workflow_dispatch", "schedule"]).has(
      value?.backupWorkflow?.event,
    )
  ) {
    throw new DatabaseBackupAttestationError(
      "attestation_subject_event_invalid",
    );
  }
  return value;
}

export async function buildDatabaseBackupAttestationPredicate(input) {
  const subjectEvidence = validateSubjectEvidence(input.subjectEvidence);
  const backupDetails = await requireEvidenceFile(
    input.backupPath,
    "attestation_backup_missing",
  );
  if (
    backupDetails.bytes !== subjectEvidence.subject.bytes ||
    `sha256:${backupDetails.sha256}` !== subjectEvidence.subject.digest
  ) {
    throw new DatabaseBackupAttestationError(
      "attestation_subject_changed_after_upload",
    );
  }

  const issuedAt =
    input.issuedAt === undefined
      ? new Date().toISOString()
      : normalizeTimestamp(input.issuedAt, "attestation_issued_at_invalid");
  const issuedAtMs = Date.parse(issuedAt);
  const validUntil = new Date(issuedAtMs + 24 * 60 * 60 * 1000).toISOString();
  const source = subjectEvidence.source;
  const expectedArtifactName = `faolla-encrypted-disaster-recovery-${subjectEvidence.backupWorkflow.runId}-${subjectEvidence.backupWorkflow.runAttempt}`;
  if (trimText(input.artifactName) !== expectedArtifactName) {
    throw new DatabaseBackupAttestationError(
      "attestation_backup_artifact_name_mismatch",
    );
  }
  const artifact = {
    id: trimText(input.artifactId),
    name: trimText(input.artifactName),
    digest: `sha256:${trimText(input.artifactDigest).replace(/^sha256:/, "")}`,
    sizeBytes: trimText(String(input.artifactBytes ?? "")),
    createdAt: normalizeTimestamp(
      input.artifactCreatedAt,
      "attestation_artifact_created_at_invalid",
    ),
    expiresAt: normalizeTimestamp(
      input.artifactExpiresAt,
      "attestation_artifact_expires_at_invalid",
    ),
    expired: false,
    workflowRunId: subjectEvidence.backupWorkflow.runId,
    workflowRunAttempt: subjectEvidence.backupWorkflow.runAttempt,
    headSha: source.sha,
    file: {
      name: subjectEvidence.subject.name,
      sizeBytes: String(backupDetails.bytes),
      sha256: backupDetails.sha256,
    },
  };
  const database = {
    containerName: source.database.containerName,
    containerId: source.database.containerId,
    dbName: source.database.databaseName,
    dbOid: source.database.databaseOid,
    systemId: source.database.systemIdentifier,
    primary: source.database.primary,
  };
  const candidate = {
    schemaVersion: 1,
    kind: PRODUCTION_BACKUP_ATTESTATION_KIND,
    repository: source.repository,
    targetSha: source.sha,
    run: {
      id: subjectEvidence.backupWorkflow.runId,
      attempt: subjectEvidence.backupWorkflow.runAttempt,
      workflowPath: PRODUCTION_BACKUP_WORKFLOW_PATH,
      event: subjectEvidence.backupWorkflow.event,
      headSha: source.sha,
      headBranch: "main",
    },
    remoteSource: {
      headSha: source.sha,
      originMainSha: source.originMainSha,
      detached: source.detached,
      cleanBefore: source.treeState === "clean",
      cleanAfter:
        source.stability.source === "matched_before_after" &&
        source.treeState === "clean",
    },
    database,
    baseline: source.database.baseline,
    backupArtifact: artifact,
    issuedAt,
    validUntil,
  };
  const validation = validateProductionReleaseAttestation(candidate, {
    nowMs: issuedAtMs,
    expectedKind: "backup",
    expectedRepository: source.repository,
    expectedTargetSha: source.sha,
    expectedRunId: subjectEvidence.backupWorkflow.runId,
    expectedRunAttempt: subjectEvidence.backupWorkflow.runAttempt,
    expectedArtifactId: artifact.id,
    expectedArtifactDigest: artifact.digest,
    expectedDatabase: database,
    expectedBaseline: source.database.baseline,
  });
  if (!validation.valid) {
    throw new DatabaseBackupAttestationError(validation.error);
  }
  return validation.attestation;
}

async function writeJson(filePath, value, canonical = false) {
  const outputPath = path.resolve(filePath);
  await writeFile(
    outputPath,
    canonical
      ? canonicalJsonBytes(value)
      : Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  return outputPath;
}

async function main() {
  const command = process.argv[2];
  const outputPath = readArgument("output");
  let report;
  if (command === "subject") {
    report = await createDatabaseBackupSubjectEvidence({
      backupPath: readArgument("backup"),
      readinessReportPath: readArgument("readiness-report"),
      createReportPath: readArgument("create-report"),
      transferReportPath: readArgument("transfer-report"),
      verifyReportPath: readArgument("verify-report"),
      restoreReportPath: readArgument("restore-report"),
      repository: readArgument("repository"),
      targetSha: readArgument("target-sha"),
      ciRunId: readArgument("ci-run-id"),
      workflowRunId: readArgument("workflow-run-id"),
      workflowRunAttempt: readArgument("workflow-run-attempt"),
      workflowEvent: readArgument("workflow-event"),
    });
  } else if (command === "predicate") {
    let subjectEvidence;
    try {
      subjectEvidence = JSON.parse(
        await readFile(path.resolve(readArgument("subject")), "utf8"),
      );
    } catch {
      throw new DatabaseBackupAttestationError(
        "attestation_subject_evidence_invalid",
      );
    }
    report = await buildDatabaseBackupAttestationPredicate({
      subjectEvidence,
      backupPath: readArgument("backup"),
      artifactId: readArgument("artifact-id"),
      artifactName: readArgument("artifact-name"),
      artifactBytes: readArgument("artifact-bytes"),
      artifactDigest: readArgument("artifact-digest"),
      artifactCreatedAt: readArgument("artifact-created-at"),
      artifactExpiresAt: readArgument("artifact-expires-at"),
    });
  } else {
    throw new DatabaseBackupAttestationError("attestation_command_invalid");
  }
  const writtenPath = await writeJson(
    outputPath,
    report,
    command === "predicate",
  );
  console.log(
    `[database-backup-attestation] CREATED file=${path.basename(writtenPath)}`,
  );
  if (hasFlag("json")) console.log(JSON.stringify(report));
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    const code =
      error instanceof DatabaseBackupAttestationError
        ? error.code
        : "database_backup_attestation_failed";
    console.error(`[database-backup-attestation] FAILED ${code}`);
    process.exitCode = 1;
  });
}
