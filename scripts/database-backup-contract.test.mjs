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
    });
    const validation = validateDatabaseBackupManifest(manifest);
    const verification = await verifyDatabaseBackupManifestFiles(
      directory,
      manifest,
    );

    assert.equal(validation.valid, true);
    assert.equal(verification.valid, true);
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
    });
    await writeFile(
      path.join(directory, "database.sql.gz"),
      "changed",
      "utf8",
    );
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

test("encrypted backup workflow keeps the scheduled recovery policy", async () => {
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

  assert.match(workflow, /schedule:\s*\n\s+- cron: "17 2 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /retention-days: 7/);
  assert.match(workflow, /FAOLLA_BACKUP_ISOLATED_DOCKER_RESTORE=true/);
  assert.match(workflow, /FAOLLA_STORAGE_BACKUP_ENABLED=true/);
  assert.match(
    readinessWorkflow,
    /FAOLLA_BACKUP_ISOLATED_DOCKER_RESTORE=true/,
  );
  assert.match(readinessWorkflow, /FAOLLA_STORAGE_BACKUP_ENABLED=true/);
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
    /fail_transfer\(\) \{[\s\S]*?rm -f -- "\$LOCAL_BACKUP_PATH" "\$LOCAL_BACKUP_PART_PATH"[\s\S]*?exit "\$failure_exit_code"/,
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
  assert.doesNotMatch(verifiedArtifactStep[1], /database-backup-.*-report\.log/);
  assert.match(failureArtifactStep[1], /if: failure\(\)/);
  assert.doesNotMatch(failureArtifactStep[1], /LOCAL_BACKUP_(?:PATH|PART_PATH)/);
  assert.match(
    workflow,
    /- name: Confirm Backup Is Ready For Upload[\s\S]*?test -s "\$LOCAL_BACKUP_PATH"[\s\S]*?sha256sum "\$LOCAL_BACKUP_PATH"/,
    "the verified archive must be rechecked immediately before upload",
  );
});
