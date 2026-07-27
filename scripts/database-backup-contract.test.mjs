import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
