import assert from "node:assert/strict";
import test from "node:test";

import { buildDatabaseBackupReadinessReport } from "./check-database-backup-readiness.mjs";

function toolProbe(available) {
  const names = new Set(available);
  return (name) => names.has(name);
}

test("database backup readiness reports a complete isolated recovery path", () => {
  const report = buildDatabaseBackupReadinessReport({
    env: {
      FAOLLA_DATABASE_URL:
        "postgresql://postgres.source:secret@source.pooler.example:5432/postgres",
      FAOLLA_RESTORE_DATABASE_URL:
        "postgresql://postgres.restore:secret@restore.pooler.example:5432/postgres",
      FAOLLA_BACKUP_PASSPHRASE_AVAILABLE: "true",
      FAOLLA_BACKUP_ARTIFACT_TRANSPORT: "true",
      FAOLLA_STORAGE_BACKUP_ENABLED: "true",
      SUPABASE_ACCESS_TOKEN: "management-secret",
      SUPABASE_PROJECT_REF: "source",
    },
    probeCommand: toolProbe([
      "supabase",
      "docker",
      "pg_dump",
      "pg_restore",
      "psql",
      "openssl",
    ]),
  });

  assert.equal(report.status, "ready");
  assert.equal(report.backupReady, true);
  assert.equal(report.recoveryRehearsalReady, true);
  assert.equal(report.configuration.dumpStrategy, "supabase_cli");
  assert.equal(report.configuration.encryptionStrategy, "openssl");
  assert.equal(report.configuration.offsiteStrategy, "github_artifact");
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.recoveryBlockers, []);
  assert.deepEqual(report.warnings, []);
});

test("database backup readiness fails closed without credentials and tools", () => {
  const report = buildDatabaseBackupReadinessReport({
    env: {},
    probeCommand: () => false,
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.backupReady, false);
  assert.equal(
    report.blockers.includes("database_connection_missing"),
    true,
  );
  assert.equal(report.blockers.includes("supabase_cli_missing"), true);
  assert.equal(report.blockers.includes("docker_missing"), true);
  assert.equal(report.blockers.includes("backup_encryption_missing"), true);
  assert.equal(report.blockers.includes("offsite_transport_missing"), true);
});

test("database backup readiness rejects production as the restore target", () => {
  const sharedUrl =
    "postgresql://postgres.same:secret@pooler.example:5432/postgres";
  const report = buildDatabaseBackupReadinessReport({
    env: {
      FAOLLA_DATABASE_URL: sharedUrl,
      FAOLLA_RESTORE_DATABASE_URL: sharedUrl,
      FAOLLA_BACKUP_AGE_RECIPIENT: "age1example",
      FAOLLA_BACKUP_ARTIFACT_TRANSPORT: "true",
    },
    probeCommand: toolProbe(["supabase", "docker", "psql", "age"]),
  });

  assert.equal(report.backupReady, true);
  assert.equal(report.recoveryRehearsalReady, false);
  assert.equal(
    report.recoveryBlockers.includes("restore_target_not_isolated"),
    true,
  );
});

test("database backup readiness never exposes credential values", () => {
  const secret = "do-not-print-this-database-password";
  const report = buildDatabaseBackupReadinessReport({
    env: {
      SUPABASE_DB_URL: `postgresql://postgres:${secret}@db.example/postgres`,
      FAOLLA_BACKUP_ENCRYPTION_PASSPHRASE: `${secret}-encryption`,
      FAOLLA_BACKUP_ARTIFACT_TRANSPORT: "true",
    },
    probeCommand: toolProbe(["supabase", "docker", "openssl"]),
  });
  const serialized = JSON.stringify(report);

  assert.equal(serialized.includes(secret), false);
  assert.equal(report.configuration.databaseConnection, "SUPABASE_DB_URL");
});

test("raw postgres clients do not replace the Supabase-aware dump path", () => {
  const report = buildDatabaseBackupReadinessReport({
    env: {
      DATABASE_URL: "postgresql://postgres:secret@db.example/postgres",
      FAOLLA_BACKUP_AGE_RECIPIENT: "age1example",
      FAOLLA_BACKUP_ARTIFACT_TRANSPORT: "true",
    },
    probeCommand: toolProbe(["pg_dump", "pg_restore", "psql", "age"]),
  });

  assert.equal(report.backupReady, false);
  assert.equal(report.blockers.includes("supabase_cli_missing"), true);
  assert.equal(
    report.warnings.includes(
      "raw_postgres_tools_available_but_supabase_cli_required",
    ),
    true,
  );
});
