import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDatabaseBackupReadinessReport,
  inspectSelfHostedSupabaseTopology,
} from "./check-database-backup-readiness.mjs";

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
      "tar",
    ]),
    localSupabaseAvailable: false,
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
    localSupabaseAvailable: false,
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.backupReady, false);
  assert.equal(
    report.blockers.includes("database_connection_missing"),
    true,
  );
  assert.equal(report.blockers.includes("supabase_cli_missing"), false);
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
    probeCommand: toolProbe([
      "supabase",
      "docker",
      "psql",
      "age",
      "tar",
    ]),
    localSupabaseAvailable: false,
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
    probeCommand: toolProbe([
      "supabase",
      "docker",
      "openssl",
      "tar",
    ]),
    localSupabaseAvailable: false,
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
    probeCommand: toolProbe([
      "pg_dump",
      "pg_restore",
      "psql",
      "age",
      "tar",
    ]),
    localSupabaseAvailable: false,
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

test("self-hosted postgres container provides a database dump path without a URL", () => {
  const report = buildDatabaseBackupReadinessReport({
    env: {
      FAOLLA_BACKUP_PASSPHRASE_AVAILABLE: "true",
      FAOLLA_BACKUP_ARTIFACT_TRANSPORT: "true",
      FAOLLA_STORAGE_BACKUP_ENABLED: "true",
    },
    probeCommand: toolProbe(["docker", "openssl", "tar"]),
    localSupabaseAvailable: false,
    selfHostedTopology: {
      available: true,
      containerCount: 12,
      databaseCandidates: [
        {
          name: "supabase-db",
          image: "supabase/postgres:15",
          probeSucceeded: true,
          tools: {
            pg_dump: true,
            pg_dumpall: true,
            pg_restore: true,
            psql: true,
            pg_isready: true,
            databaseConfigured: true,
            userConfigured: true,
          },
          mounts: [
            {
              type: "volume",
              destination: "/var/lib/postgresql/data",
              readOnly: false,
            },
          ],
        },
      ],
      storageCandidates: [
        {
          name: "supabase-storage",
          image: "supabase/storage-api:v1",
          backend: "file",
          bucketConfigured: false,
          probeSucceeded: true,
          mounts: [
            {
              type: "bind",
              destination: "/var/lib/storage",
              readOnly: false,
            },
          ],
        },
      ],
      error: null,
    },
  });

  assert.equal(report.backupReady, true);
  assert.equal(report.configuration.databaseConnection, null);
  assert.equal(
    report.configuration.dumpStrategy,
    "docker_exec_postgres",
  );
  assert.equal(
    report.configuration.persistentStorageMountDetected,
    true,
  );
  assert.equal(report.blockers.includes("supabase_cli_missing"), false);
  assert.equal(
    report.warnings.includes("self_hosted_pitr_not_verified"),
    true,
  );
});

test("self-hosted topology inspection reports capabilities without secret values", () => {
  const secret = "never-emit-this-container-secret";
  const responses = new Map([
    [
      'ps --format {{json .}}',
      {
        ok: true,
        stdout: [
          JSON.stringify({
            Names: "supabase-db",
            Image: "supabase/postgres:15",
          }),
          JSON.stringify({
            Names: "supabase-storage",
            Image: "supabase/storage-api:v1",
          }),
        ].join("\n"),
      },
    ],
    [
      "inspect --format {{json .Mounts}} supabase-db",
      {
        ok: true,
        stdout: JSON.stringify([
          {
            Type: "volume",
            Source: `/secret/${secret}`,
            Destination: "/var/lib/postgresql/data",
            RW: true,
          },
        ]),
      },
    ],
    [
      "inspect --format {{json .Mounts}} supabase-storage",
      {
        ok: true,
        stdout: JSON.stringify([
          {
            Type: "bind",
            Source: `/secret/${secret}`,
            Destination: "/var/lib/storage",
            RW: true,
          },
        ]),
      },
    ],
  ]);
  const runDocker = (args) => {
    if (args[0] === "exec" && args[1] === "supabase-db") {
      return {
        ok: true,
        stdout:
          "pg_dump=1\npg_dumpall=1\npg_restore=1\npsql=1\npg_isready=1\ndatabaseConfigured=1\nuserConfigured=1\n",
      };
    }
    if (args[0] === "exec" && args[1] === "supabase-storage") {
      return {
        ok: true,
        stdout: "backend=file\nbucketConfigured=0\n",
      };
    }
    return responses.get(args.join(" ")) ?? { ok: false, stdout: "" };
  };

  const topology = inspectSelfHostedSupabaseTopology({ runDocker });
  const serialized = JSON.stringify(topology);

  assert.equal(topology.available, true);
  assert.equal(topology.databaseCandidates.length, 1);
  assert.equal(topology.databaseCandidates[0].tools.pg_dump, true);
  assert.equal(topology.storageCandidates[0].backend, "file");
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("/secret/"), false);
});
