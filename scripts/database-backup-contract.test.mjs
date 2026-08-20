import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDatabaseBackupManifest,
  DATABASE_BACKUP_DATA_FILES,
  validateDatabaseBackupArchiveEntries,
  validateDatabaseBackupManifest,
  validateDatabaseBackupNestedArchiveEntry,
  verifyDatabaseBackupManifestFiles,
} from "./database-backup-contract.mjs";

const STABLE_SOURCE = {
  sourceRepository: "fafona/space",
  sourceSha: "a".repeat(40),
  databaseIdentity: {
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

async function withBackupDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "faolla-db-test-"));
  try {
    for (const [index, name] of DATABASE_BACKUP_DATA_FILES.entries()) {
      await writeFile(
        path.join(directory, name),
        Buffer.from(`simulated ${name} ${index + 1}\n`),
      );
    }
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("database backup manifest validates all expected dump files", async () => {
  await withBackupDirectory(async (directory) => {
    const manifest = await buildDatabaseBackupManifest({
      directory,
      createdAt: "2026-07-27T12:00:00.000Z",
      toolVersion: "15.8",
      databaseImage: "supabase/postgres:15.8.1.085",
      storageImage: "supabase/storage-api:v1.37.8",
      storageBackend: "file",
      ...STABLE_SOURCE,
    });
    const validation = validateDatabaseBackupManifest(manifest);
    const verification = await verifyDatabaseBackupManifestFiles(
      directory,
      manifest,
    );

    assert.equal(validation.valid, true);
    assert.equal(verification.valid, true);
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.source.sha, STABLE_SOURCE.sourceSha);
    assert.equal(manifest.source.stability.database, "matched_before_after");
    assert.deepEqual(
      manifest.files.map((item) => item.name),
      DATABASE_BACKUP_DATA_FILES,
    );
  });
});

test("database backup verification detects changed contents", async () => {
  await withBackupDirectory(async (directory) => {
    const manifest = await buildDatabaseBackupManifest({
      directory,
      databaseImage: "supabase/postgres:15.8.1.085",
      storageImage: "supabase/storage-api:v1.37.8",
      storageBackend: "file",
      ...STABLE_SOURCE,
    });
    await writeFile(path.join(directory, "database.sql.gz"), "changed", "utf8");
    const verification = await verifyDatabaseBackupManifestFiles(
      directory,
      manifest,
    );

    assert.equal(verification.valid, false);
    assert.match(verification.error, /^backup_file_(size|checksum)_mismatch/);
  });
});

test("database backup archive rejects traversal and unexpected files", () => {
  assert.equal(
    validateDatabaseBackupArchiveEntries([
      "database.sql.gz",
      "postgres-config.tar.gz",
      "storage.tar.gz",
      "supabase-config.tar.gz",
      "app-config.tar.gz",
      "manifest.json",
    ]).valid,
    true,
  );
  assert.equal(
    validateDatabaseBackupArchiveEntries([
      "database.sql.gz",
      "postgres-config.tar.gz",
      "storage.tar.gz",
      "supabase-config.tar.gz",
      "app-config.tar.gz",
      "../manifest.json",
    ]).valid,
    false,
  );
  assert.equal(
    validateDatabaseBackupArchiveEntries([
      "database.sql.gz",
      "postgres-config.tar.gz",
      "storage.tar.gz",
      "supabase-config.tar.gz",
      "app-config.tar.gz",
      "manifest.json",
      "extra.sql",
    ]).valid,
    false,
  );
});

test("nested backup archives reject traversal and absolute paths", () => {
  assert.deepEqual(
    validateDatabaseBackupNestedArchiveEntry("./storage/object.webp"),
    {
      valid: true,
      entry: "storage/object.webp",
      root: false,
    },
  );
  assert.equal(
    validateDatabaseBackupNestedArchiveEntry("../secret").valid,
    false,
  );
  assert.equal(
    validateDatabaseBackupNestedArchiveEntry("/etc/passwd").valid,
    false,
  );
  assert.equal(
    validateDatabaseBackupNestedArchiveEntry("C:\\secret").valid,
    false,
  );
});

test("database backup manifest rejects duplicate or incomplete file sets", () => {
  const base = {
    schemaVersion: 1,
    createdAt: "2026-07-27T12:00:00.000Z",
    format: "self-hosted-supabase-dr-v1",
    dumpTool: { name: "pg_dumpall", version: "15.8" },
    source: {
      strategy: "docker_exec_postgres",
      databaseImage: "supabase/postgres:15.8.1.085",
      storageImage: "supabase/storage-api:v1.37.8",
      storageBackend: "file",
    },
  };
  const entry = {
    name: "database.sql.gz",
    bytes: 10,
    sha256: "a".repeat(64),
  };

  assert.equal(
    validateDatabaseBackupManifest({
      ...base,
      files: [entry, entry],
    }).valid,
    false,
  );
  assert.equal(
    validateDatabaseBackupManifest({
      ...base,
      files: [entry],
    }).valid,
    false,
  );
});

test("encrypted backup workflow requires an exact tested main commit", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/database-backup.yml", import.meta.url),
    "utf8",
  );
  const readinessWorkflow = await readFile(
    new URL(
      "../.github/workflows/database-backup-readiness.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const attestationBuilder = await readFile(
    new URL("./create-database-backup-attestation.mjs", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /schedule:\s*\n\s+- cron: "17 2 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:\s*\n\s+inputs:/);
  assert.match(workflow, /target_sha:/);
  assert.match(workflow, /confirmation:/);
  assert.match(
    workflow,
    /workflow_dispatch\) test "\$CONFIRMATION" = "BACKUP"/,
  );
  assert.match(workflow, /schedule\) test -z "\$CONFIRMATION"/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /ref: \$\{\{ env\.TARGET_SHA \}\}/);
  assert.match(
    workflow,
    /TARGET_SHA: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.target_sha \|\| github\.sha \}\}/,
  );
  assert.match(workflow, /git ls-remote --exit-code origin refs\/heads\/main/);
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/);
  assert.match(workflow, /\.head_sha == \$target_sha/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /group: production-deploy/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /attestations: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /retention-days: 7/);
  assert.match(workflow, /FAOLLA_BACKUP_ISOLATED_DOCKER_RESTORE=true/);
  assert.match(workflow, /FAOLLA_STORAGE_BACKUP_ENABLED=true/);
  assert.match(readinessWorkflow, /FAOLLA_BACKUP_ISOLATED_DOCKER_RESTORE=true/);
  assert.match(readinessWorkflow, /FAOLLA_STORAGE_BACKUP_ENABLED=true/);
  assert.match(
    workflow,
    /SSH_KNOWN_HOSTS: \$\{\{ secrets\.SSH_KNOWN_HOSTS \}\}/,
  );
  assert.doesNotMatch(workflow, /ssh-keyscan|accept-new/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /worktree add --detach/);
  assert.match(workflow, /status --porcelain=v1 --untracked-files=all/);
  assert.match(workflow, /actions\/attest@v4/);
  assert.match(
    workflow,
    /BACKUP_ATTESTATION_PATH: production-backup-attestation\.json/,
  );
  assert.doesNotMatch(workflow, /database-backup-attestation\.json/);
  assert.match(
    workflow,
    /predicate-path: \$\{\{ env\.BACKUP_ATTESTATION_PATH \}\}/,
  );
  assert.match(
    workflow,
    /BACKUP_ARTIFACT_NAME: faolla-encrypted-disaster-recovery-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(workflow, /Upload Canonical Backup Attestation Input/);
  assert.match(workflow, /Attest Canonical Backup Attestation Input/);
  assert.match(
    workflow,
    /subject-path: \$\{\{ env\.BACKUP_ATTESTATION_PATH \}\}/,
  );
  assert.match(
    workflow,
    /faolla-production-backup-attestation-bundle-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  for (const [stepName, artifactName, bundleStepId] of [
    [
      "Upload Encrypted Backup Attestation Bundle",
      "faolla-encrypted-backup-attestation-bundle",
      "encrypted-backup-attestation",
    ],
    [
      "Upload Canonical Backup Attestation Bundle",
      "faolla-production-backup-attestation-bundle",
      "canonical-backup-attestation",
    ],
  ]) {
    const escapedStepName = stepName.replaceAll(" ", "\\s+");
    const uploadStep = workflow.match(
      new RegExp(`- name: ${escapedStepName}([\\s\\S]*?)(?=\\n\\s+- name:)`),
    );
    assert.ok(uploadStep, `${stepName} must exist`);
    assert.match(
      uploadStep[1],
      new RegExp(
        `name: ${artifactName}-\\$\\{\\{ github\\.run_id \\}\\}-\\$\\{\\{ github\\.run_attempt \\}\\}`,
      ),
    );
    assert.match(
      uploadStep[1],
      new RegExp(
        `path: \\$\\{\\{ steps\\.${bundleStepId}\\.outputs\\.bundle-path \\}\\}`,
      ),
    );
    assert.doesNotMatch(uploadStep[1], /path:\s*\|/);
  }
  const backupUploadIndex = workflow.indexOf(
    "- name: Upload Verified Encrypted Backup",
  );
  const predicateIndex = workflow.indexOf(
    "- name: Generate Backup Attestation Predicate",
  );
  const predicateUploadIndex = workflow.indexOf(
    "- name: Upload Canonical Backup Attestation Input",
  );
  const encryptedAttestIndex = workflow.indexOf(
    "- name: Attest Verified Encrypted Backup",
  );
  const canonicalAttestIndex = workflow.indexOf(
    "- name: Attest Canonical Backup Attestation Input",
  );
  assert.ok(
    backupUploadIndex < predicateIndex &&
      predicateIndex < predicateUploadIndex &&
      predicateUploadIndex < encryptedAttestIndex &&
      encryptedAttestIndex < canonicalAttestIndex,
    "artifact metadata must precede canonical generation, upload, and both attestations",
  );
  const nativeAttestationStep = workflow.match(
    /- name: Attest Canonical Backup Attestation Input([\s\S]*?)(?=\n\s+- name:)/,
  );
  assert.ok(
    nativeAttestationStep,
    "canonical JSON native attestation must exist",
  );
  assert.match(
    nativeAttestationStep[1],
    /subject-path: \$\{\{ env\.BACKUP_ATTESTATION_PATH \}\}/,
  );
  assert.doesNotMatch(nativeAttestationStep[1], /predicate-(?:type|path):/);
  assert.match(attestationBuilder, /validateProductionReleaseAttestation/);
  assert.match(attestationBuilder, /canonicalJsonBytes/);
  assert.match(
    attestationBuilder,
    /faolla-encrypted-disaster-recovery-\$\{subjectEvidence\.backupWorkflow\.runId\}-\$\{subjectEvidence\.backupWorkflow\.runAttempt\}/,
  );
});

test("encrypted backup workflow validates complete transfers and discards partial files", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/database-backup.yml", import.meta.url),
    "utf8",
  );
  const jobTimeoutMatch = workflow.match(/timeout-minutes:\s*(\d+)/);
  const transferTimeoutMatch = workflow.match(
    /timeout --signal=TERM --kill-after=30s (\d+)m sftp/,
  );
  const transferAttemptsMatch = workflow.match(
    /MAX_BACKUP_TRANSFER_ATTEMPTS:\s*(\d+)/,
  );

  assert.ok(jobTimeoutMatch, "backup job must have a timeout");
  assert.ok(transferTimeoutMatch, "backup transfer must have a timeout");
  assert.ok(transferAttemptsMatch, "backup transfer retries must be bounded");

  const jobTimeoutMinutes = Number(jobTimeoutMatch[1]);
  const transferTimeoutMinutes = Number(transferTimeoutMatch[1]);
  const transferAttempts = Number(transferAttemptsMatch[1]);
  assert.ok(
    transferTimeoutMinutes > 75,
    "transfer timeout must cover the observed network variance",
  );
  assert.ok(
    transferTimeoutMinutes * transferAttempts <= jobTimeoutMinutes - 60,
    "all transfer attempts must leave an hour for creation, restore, and cleanup",
  );
  assert.equal(transferAttempts, 2);

  assert.match(workflow, /LOCAL_BACKUP_PART_PATH: .*\.part/);
  assert.match(workflow, /\.outputBytes \| select/);
  assert.match(workflow, /\.outputSha256 \| select/);
  assert.match(
    workflow,
    /"stat -c '%s' -- '\$REMOTE_BACKUP_PATH'"/,
    "the workflow must read the complete remote artifact size",
  );
  assert.match(
    workflow,
    /if \[ "\$remote_backup_bytes" -ne "\$expected_backup_bytes" \]; then/,
    "the remote artifact must match the creation report",
  );
  assert.match(
    workflow,
    /if \[ "\$local_backup_bytes" -ne "\$expected_backup_bytes" \]; then/,
    "the workflow must reject truncated transfers",
  );
  assert.match(
    workflow,
    /if \[ "\$local_backup_sha256" != "\$expected_backup_sha256" \]; then/,
    "the workflow must reject corrupted transfers",
  );
  assert.match(
    workflow,
    /printf 'reget %s %s\\n' "\$REMOTE_BACKUP_PATH" "\$LOCAL_BACKUP_PART_PATH"/,
    "retries must resume into the temporary local path",
  );
  assert.match(
    workflow,
    /fail_transfer\(\) \{[\s\S]*?rm -f -- "\$LOCAL_BACKUP_PATH" "\$LOCAL_BACKUP_PART_PATH"[\s\S]*?exit "\$exit_code"/,
    "a failed transfer must remove its partial local artifact",
  );
  const retryLoop = workflow.match(
    /while \[ "\$transfer_attempt"[\s\S]*?(?=\n\s+if \[ "\$transfer_status" -ne 0 \])/,
  );
  assert.ok(retryLoop, "bounded transfer retry loop must exist");
  assert.match(retryLoop[0], /record_transfer RETRYING/);
  assert.doesNotMatch(
    retryLoop[0],
    /rm -f -- "\$LOCAL_BACKUP_PART_PATH"/,
    "a retry must preserve the partial file for reget",
  );
  assert.match(
    workflow,
    /mv -- "\$LOCAL_BACKUP_PART_PATH" "\$LOCAL_BACKUP_PATH"/,
    "only a validated transfer may be promoted to the official local path",
  );
  assert.match(
    workflow,
    /expectedBytes=%s remoteBytes=%s transferredBytes=%s percentBasisPoints=%s averageBytesPerSecond=%s durationSeconds=%s exitCode=%s/,
    "transfer diagnostics must include completeness, speed, and status",
  );

  const verifiedArtifactStep = workflow.match(
    /- name: Upload Verified Encrypted Backup([\s\S]*?)(?=\n\s+- name:)/,
  );
  const failureArtifactStep = workflow.match(
    /- name: Upload Backup Failure Diagnostics([\s\S]*?)(?=\n\s+- name:)/,
  );
  assert.ok(verifiedArtifactStep, "verified artifact upload step must exist");
  assert.ok(failureArtifactStep, "failure diagnostics upload step must exist");
  assert.match(verifiedArtifactStep[1], /if: success\(\)/);
  assert.match(verifiedArtifactStep[1], /\$\{\{ env\.LOCAL_BACKUP_PATH \}\}/);
  assert.doesNotMatch(
    verifiedArtifactStep[1],
    /database-backup-.*-report\.log/,
  );
  assert.match(failureArtifactStep[1], /if: failure\(\)/);
  assert.doesNotMatch(
    failureArtifactStep[1],
    /LOCAL_BACKUP_(?:PATH|PART_PATH)/,
  );
  assert.match(
    workflow,
    /- name: Confirm Backup Is Ready For Upload[\s\S]*?test -s "\$LOCAL_BACKUP_PATH"[\s\S]*?sha256sum "\$LOCAL_BACKUP_PATH"/,
    "the verified archive must be rechecked immediately before upload",
  );
  assert.match(workflow, /steps\.backup-artifact\.outputs\.artifact-id/);
  assert.match(workflow, /steps\.backup-artifact\.outputs\.artifact-digest/);
  assert.match(workflow, /\.size_in_bytes > 0/);
  assert.match(workflow, /create-database-backup-attestation\.mjs subject/);
  assert.match(workflow, /create-database-backup-attestation\.mjs predicate/);
});
