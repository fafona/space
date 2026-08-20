import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDatabaseBackupAttestationPredicate,
  createDatabaseBackupSubjectEvidence,
} from "./create-database-backup-attestation.mjs";
import { sha256File } from "./database-backup-contract.mjs";
import {
  canonicalJsonBytes,
  validateProductionReleaseAttestation,
} from "./production-release-attestation.mjs";

const REPOSITORY = "fafona/space";
const TARGET_SHA = "a".repeat(40);
const SOURCE = {
  strategy: "docker_exec_postgres",
  databaseImage: "supabase/postgres:15.8.1.085",
  storageImage: "supabase/storage-api:v1.37.8",
  storageBackend: "file",
  repository: REPOSITORY,
  sha: TARGET_SHA,
  originMainSha: TARGET_SHA,
  detached: true,
  treeState: "clean",
  stability: {
    source: "matched_before_after",
    database: "matched_before_after",
  },
  database: {
    containerName: "supabase-db",
    containerId: "b".repeat(64),
    imageId: `sha256:${"c".repeat(64)}`,
    containerStartedAt: "2026-08-20T10:00:00.000Z",
    databaseName: "postgres",
    databaseOid: "16384",
    systemIdentifier: "7612345678901234567",
    serverVersionNum: "150008",
    postmasterStartedAt: "2026-08-20T10:00:01.000Z",
    primary: true,
    baseline: {
      merchantRecordCount: "10",
      merchantAuthoritativeBindingCount: "10",
      merchantInvalidBindingCount: "0",
      personalCanonicalBindingCount: "5",
      personalCanonicalOrphanCount: "0",
      personalInvalidCanonicalCount: "0",
      personalDuplicateAuthUserCount: "0",
      personalDuplicateAccountIdCount: "0",
      crossAccountTypeOverlapCount: "0",
      accountIdentifierCollisionCount: "0",
      staffRegistryOverlapCount: "0",
      systemSitePrincipalOverlapCount: "0",
    },
  },
};

async function writeReport(directory, name, value) {
  const filePath = path.join(directory, name);
  await writeFile(filePath, `diagnostic line\n${JSON.stringify(value)}\n`);
  return filePath;
}

async function createEvidenceFixture(directory) {
  const backupPath = path.join(directory, "faolla-database-backup.tar.enc");
  await writeFile(backupPath, "encrypted backup fixture");
  const backupBytes = Buffer.byteLength("encrypted backup fixture");
  const backupSha256 = await sha256File(backupPath);
  const readinessReportPath = await writeReport(directory, "readiness.log", {
    schemaVersion: 1,
    status: "ready",
    backupReady: true,
    recoveryRehearsalReady: true,
    blockers: [],
    recoveryBlockers: [],
  });
  const createReportPath = await writeReport(directory, "create.log", {
    schemaVersion: 2,
    createdAt: "2026-08-20T11:00:00.000Z",
    status: "created",
    format: "self-hosted-supabase-dr-v2",
    outputBytes: backupBytes,
    outputSha256: backupSha256,
    source: SOURCE,
  });
  const verifyReportPath = await writeReport(directory, "verify.log", {
    schemaVersion: 2,
    status: "verified",
    manifestSchemaVersion: 2,
    format: "self-hosted-supabase-dr-v2",
    inputBytes: backupBytes,
    source: SOURCE,
  });
  const restoreReportPath = await writeReport(directory, "restore.log", {
    schemaVersion: 2,
    status: "restored",
    backupStatus: "verified",
    inputBytes: backupBytes,
    isolation: "ephemeral_docker_no_network",
    source: SOURCE,
    restoredBaseline: SOURCE.database.baseline,
  });
  const transferReportPath = path.join(directory, "transfer.log");
  await writeFile(
    transferReportPath,
    "[database-backup-transfer] TRANSFERRED reason=verified\n",
  );
  return {
    backupPath,
    backupBytes,
    backupSha256,
    readinessReportPath,
    createReportPath,
    transferReportPath,
    verifyReportPath,
    restoreReportPath,
  };
}

test("backup attestation binds stable source, reports, and uploaded artifact", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-backup-attestation-test-"),
  );
  try {
    const fixture = await createEvidenceFixture(directory);
    const subjectEvidence = await createDatabaseBackupSubjectEvidence({
      ...fixture,
      repository: REPOSITORY,
      targetSha: TARGET_SHA,
      ciRunId: "101",
      workflowRunId: "202",
      workflowRunAttempt: "1",
      workflowEvent: "workflow_dispatch",
      generatedAt: "2026-08-20T12:00:00.000Z",
    });
    assert.deepEqual(subjectEvidence.subject, {
      name: "faolla-database-backup.tar.enc",
      bytes: fixture.backupBytes,
      digest: `sha256:${fixture.backupSha256}`,
    });
    assert.equal(subjectEvidence.source.sha, TARGET_SHA);
    assert.equal(subjectEvidence.reports.restore.bytes > 0, true);

    const predicate = await buildDatabaseBackupAttestationPredicate({
      subjectEvidence,
      backupPath: fixture.backupPath,
      artifactId: "303",
      artifactName: "faolla-encrypted-disaster-recovery-202-1",
      artifactBytes: "4096",
      artifactDigest: "d".repeat(64),
      artifactCreatedAt: "2026-08-20T11:50:00.000Z",
      artifactExpiresAt: "2026-08-27T11:50:00.000Z",
      issuedAt: "2026-08-20T12:01:00.000Z",
    });
    assert.deepEqual(predicate.backupArtifact, {
      id: "303",
      name: "faolla-encrypted-disaster-recovery-202-1",
      sizeBytes: "4096",
      digest: `sha256:${"d".repeat(64)}`,
      createdAt: "2026-08-20T11:50:00.000Z",
      expiresAt: "2026-08-27T11:50:00.000Z",
      expired: false,
      workflowRunId: "202",
      workflowRunAttempt: "1",
      headSha: TARGET_SHA,
      file: {
        name: "faolla-database-backup.tar.enc",
        sizeBytes: String(fixture.backupBytes),
        sha256: fixture.backupSha256,
      },
    });
    const validation = validateProductionReleaseAttestation(predicate, {
      nowMs: Date.parse("2026-08-20T12:01:00.000Z"),
      expectedKind: "backup",
      expectedRepository: REPOSITORY,
      expectedTargetSha: TARGET_SHA,
    });
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.canonicalBytes, canonicalJsonBytes(predicate));
    const scheduledEvidence = structuredClone(subjectEvidence);
    scheduledEvidence.backupWorkflow.event = "schedule";
    const scheduledPredicate = await buildDatabaseBackupAttestationPredicate({
      subjectEvidence: scheduledEvidence,
      backupPath: fixture.backupPath,
      artifactId: "304",
      artifactName: "faolla-encrypted-disaster-recovery-202-1",
      artifactBytes: "4096",
      artifactDigest: "e".repeat(64),
      artifactCreatedAt: "2026-08-20T11:50:00.000Z",
      artifactExpiresAt: "2026-08-27T11:50:00.000Z",
      issuedAt: "2026-08-20T12:01:00.000Z",
    });
    assert.equal(scheduledPredicate.run.event, "schedule");
    await assert.rejects(
      buildDatabaseBackupAttestationPredicate({
        subjectEvidence,
        backupPath: fixture.backupPath,
        artifactId: "303",
        artifactName: "faolla-encrypted-disaster-recovery-202",
        artifactBytes: "4096",
        artifactDigest: "d".repeat(64),
        artifactCreatedAt: "2026-08-20T11:50:00.000Z",
        artifactExpiresAt: "2026-08-27T11:50:00.000Z",
        issuedAt: "2026-08-20T12:01:00.000Z",
      }),
      /attestation_backup_artifact_name_mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backup attestation rejects subject changes after upload", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-backup-attestation-change-test-"),
  );
  try {
    const fixture = await createEvidenceFixture(directory);
    const subjectEvidence = await createDatabaseBackupSubjectEvidence({
      ...fixture,
      repository: REPOSITORY,
      targetSha: TARGET_SHA,
      ciRunId: "101",
      workflowRunId: "202",
      workflowRunAttempt: "1",
      workflowEvent: "workflow_dispatch",
    });
    await writeFile(fixture.backupPath, "changed encrypted backup fixture");
    await assert.rejects(
      buildDatabaseBackupAttestationPredicate({
        subjectEvidence,
        backupPath: fixture.backupPath,
        artifactId: "303",
        artifactName: "faolla-encrypted-disaster-recovery-202-1",
        artifactBytes: "4096",
        artifactDigest: "d".repeat(64),
        artifactCreatedAt: "2026-08-20T11:50:00.000Z",
        artifactExpiresAt: "2026-08-27T11:50:00.000Z",
        issuedAt: "2026-08-20T12:01:00.000Z",
      }),
      /attestation_subject_changed_after_upload/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backup attestation rejects a restored baseline mismatch", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-backup-attestation-baseline-test-"),
  );
  try {
    const fixture = await createEvidenceFixture(directory);
    await writeReport(directory, "restore.log", {
      schemaVersion: 2,
      status: "restored",
      backupStatus: "verified",
      inputBytes: fixture.backupBytes,
      isolation: "ephemeral_docker_no_network",
      source: SOURCE,
      restoredBaseline: {
        ...SOURCE.database.baseline,
        merchantRecordCount: "11",
      },
    });
    await assert.rejects(
      createDatabaseBackupSubjectEvidence({
        ...fixture,
        repository: REPOSITORY,
        targetSha: TARGET_SHA,
        ciRunId: "101",
        workflowRunId: "202",
        workflowRunAttempt: "1",
        workflowEvent: "workflow_dispatch",
      }),
      /attestation_restore_baseline_mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
