import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recoveryContentFixture } from "./test-fixtures/database-recovery-content.mjs";

import {
  captureDatabaseIdentity,
  createProductionDatabaseBackup,
} from "./create-production-database-backup.mjs";

const SOURCE_REPOSITORY = "fafona/space";
const SOURCE_SHA = "a".repeat(40);
const DATABASE_IDENTITY = {
  containerName: "supabase-db",
  containerId: "b".repeat(64),
  imageId: `sha256:${"c".repeat(64)}`,
  containerStartedAt: "2026-08-20T10:00:00.000Z",
  databaseName: "faolla",
  databaseOid: "16384",
  systemIdentifier: "7612345678901234567",
  serverVersionNum: "150008",
  postmasterStartedAt: "2026-08-20T10:00:01.000Z",
  primary: true,
  recoveryContent: recoveryContentFixture({ receipts: true }),
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
    ordinaryIdentityContentSha256: "1".repeat(64),
  },
};

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function selfHostedTopology() {
  return {
    available: true,
    containerCount: 2,
    databaseCandidates: [
      {
        name: "supabase-db",
        image: "supabase/postgres:15.8.1.085",
        probeSucceeded: true,
        tools: {
          pg_dump: true,
          pg_dumpall: true,
          pg_restore: true,
          psql: true,
          pg_isready: true,
          tar: true,
          databaseConfigured: true,
          userConfigured: true,
        },
        mounts: [
          {
            type: "volume",
            destination: "/etc/postgresql-custom",
            readOnly: false,
          },
        ],
      },
    ],
    storageCandidates: [
      {
        name: "supabase-storage",
        image: "supabase/storage-api:v1.37.8",
        backend: "file",
        bucketConfigured: true,
        tarAvailable: true,
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
  };
}

function successfulCommandRunner(input = {}) {
  let identityProbeCount = 0;
  return async (command, args, options = {}) => {
    if (
      command === "git" &&
      args.includes("rev-parse") &&
      args.includes("--abbrev-ref")
    ) {
      return { stdout: "HEAD\n", stderr: "" };
    }
    if (command === "git" && args.includes("rev-parse")) {
      return { stdout: `${SOURCE_SHA}\n`, stderr: "" };
    }
    if (command === "git" && args.includes("remote.origin.url")) {
      return { stdout: "https://github.com/fafona/space.git\n", stderr: "" };
    }
    if (command === "git" && args.includes("status")) {
      return { stdout: "", stderr: "" };
    }
    if (
      command === "docker" &&
      args[0] === "exec" &&
      args.includes("--version")
    ) {
      return {
        stdout: "pg_dumpall (PostgreSQL) 15.8\n",
        stderr: "",
      };
    }
    if (
      command === "docker" &&
      args[0] === "inspect" &&
      args.some((entry) =>
        entry.includes("com.docker.compose.project.working_dir"),
      )
    ) {
      return { stdout: "/srv/supabase\n", stderr: "" };
    }
    if (
      command === "docker" &&
      args[0] === "inspect" &&
      args.some((entry) => entry.includes('"containerId"'))
    ) {
      identityProbeCount += 1;
      const identity =
        identityProbeCount > 1 && input.changedDatabaseIdentity
          ? {
              ...DATABASE_IDENTITY,
              containerId: "d".repeat(64),
            }
          : DATABASE_IDENTITY;
      return {
        stdout: `${JSON.stringify({
          containerId: identity.containerId,
          imageId: identity.imageId,
          containerStartedAt: identity.containerStartedAt,
        })}\n`,
        stderr: "",
      };
    }
    if (
      command === "docker" &&
      args[0] === "exec" &&
      args.some(
        (entry) =>
          typeof entry === "string" && entry.includes("pg_control_system"),
      )
    ) {
      const baseline =
        identityProbeCount > 1 && input.changedIdentityContent
          ? {
              ...DATABASE_IDENTITY.baseline,
              ordinaryIdentityContentSha256: "2".repeat(64),
            }
          : DATABASE_IDENTITY.baseline;
      return {
        stdout: `${JSON.stringify({
          databaseName: DATABASE_IDENTITY.databaseName,
          databaseOid: DATABASE_IDENTITY.databaseOid,
          systemIdentifier: DATABASE_IDENTITY.systemIdentifier,
          serverVersionNum: DATABASE_IDENTITY.serverVersionNum,
          postmasterStartedAt: DATABASE_IDENTITY.postmasterStartedAt,
          primary: DATABASE_IDENTITY.primary,
          recoveryContent: identityProbeCount > 1 && input.changedRecoveryContent
            ? {
                ...DATABASE_IDENTITY.recoveryContent,
                relations: DATABASE_IDENTITY.recoveryContent.relations.map((relation) =>
                  relation.name === (input.changedRecoveryRelation ?? "public.pages")
                    ? { ...relation, contentSha256: "4".repeat(64) }
                    : relation),
              }
            : DATABASE_IDENTITY.recoveryContent,
          baseline,
        })}\n`,
        stderr: "",
      };
    }
    if (options.outputPath) {
      await writeFile(
        options.outputPath,
        Buffer.from(`simulated ${options.errorCode}\n`),
      );
      return { stdout: "", stderr: "" };
    }
    if (command === "tar") {
      await writeFile(args[1], "simulated archive", "utf8");
      return { stdout: "", stderr: "" };
    }
    if (command === "openssl") {
      const inputIndex = args.indexOf("-in");
      const outputIndex = args.indexOf("-out");
      const archive = await readFile(args[inputIndex + 1]);
      await writeFile(args[outputIndex + 1], archive);
      return { stdout: "", stderr: "" };
    }
    throw new Error("unexpected test command");
  };
}

test("production database backup creates one encrypted disaster recovery archive", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-db-create-test-"),
  );
  const outputPath = path.join(directory, "backup.tar.enc");
  const lockPath = path.join(directory, "backup.lock");
  const secret = "database-password-must-not-appear";
  try {
    const report = await createProductionDatabaseBackup({
      env: {
        POSTGRES_PASSWORD: secret,
      },
      outputPath,
      lockPath,
      passphrase: "long-enough-encryption-passphrase",
      selfHostedTopology: selfHostedTopology(),
      runCommand: successfulCommandRunner(),
      encryptArchive: async ({ outputPath: encryptedOutput }) => {
        await writeFile(encryptedOutput, "encrypted archive");
      },
      appDirectory: directory,
      sourceDirectory: directory,
      sourceRepository: SOURCE_REPOSITORY,
      sourceSha: SOURCE_SHA,
    });

    assert.equal(report.status, "created");
    assert.equal(report.sourceConfiguration, "self_hosted_docker");
    assert.equal(await exists(outputPath), true);
    assert.equal(await exists(lockPath), false);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.source.repository, SOURCE_REPOSITORY);
    assert.equal(report.source.sha, SOURCE_SHA);
    assert.deepEqual(report.source.database, DATABASE_IDENTITY);
    assert.deepEqual(
      report.dumpFiles.map((item) => item.name),
      [
        "database.sql.gz",
        "postgres-config.tar.gz",
        "storage.tar.gz",
        "supabase-config.tar.gz",
        "app-config.tar.gz",
      ],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("database identity probe selects the container POSTGRES_DB, not postgres", async () => {
  let probeScript = "";
  const identity = await captureDatabaseIdentity(async (command, args) => {
    assert.equal(command, "docker");
    if (args[0] === "inspect") {
      return {
        stdout: `${JSON.stringify({
          containerId: DATABASE_IDENTITY.containerId,
          imageId: DATABASE_IDENTITY.imageId,
          containerStartedAt: DATABASE_IDENTITY.containerStartedAt,
        })}\n`,
        stderr: "",
      };
    }
    probeScript = args[4];
    const selectedDatabase = probeScript.includes(
      '-d "${POSTGRES_DB:?POSTGRES_DB is required}"',
    )
      ? DATABASE_IDENTITY.databaseName
      : "postgres";
    return {
      stdout: `${JSON.stringify({
        databaseName: selectedDatabase,
        databaseOid: DATABASE_IDENTITY.databaseOid,
        systemIdentifier: DATABASE_IDENTITY.systemIdentifier,
        serverVersionNum: DATABASE_IDENTITY.serverVersionNum,
        postmasterStartedAt: DATABASE_IDENTITY.postmasterStartedAt,
        primary: DATABASE_IDENTITY.primary,
        recoveryContent: DATABASE_IDENTITY.recoveryContent,
        baseline: DATABASE_IDENTITY.baseline,
      })}\n`,
      stderr: "",
    };
  }, "supabase-db");

  assert.equal(identity.databaseName, "faolla");
  assert.match(probeScript, /-d "\$\{POSTGRES_DB:\?POSTGRES_DB is required\}"/);
  assert.doesNotMatch(probeScript, /-d postgres(?:\s|$)/);
});

test("production database backup removes partial output and releases its lock", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-db-failure-test-"),
  );
  const outputPath = path.join(directory, "backup.tar.enc");
  const lockPath = path.join(directory, "backup.lock");
  const runner = successfulCommandRunner();
  try {
    await assert.rejects(
      createProductionDatabaseBackup({
        env: {},
        outputPath,
        lockPath,
        passphrase: "long-enough-encryption-passphrase",
        selfHostedTopology: selfHostedTopology(),
        runCommand: async (command, args, options) => {
          if (options?.errorCode === "storage_backup_failed") {
            throw new Error("simulated failure");
          }
          return runner(command, args, options);
        },
        encryptArchive: async ({ outputPath: encryptedOutput }) => {
          await writeFile(encryptedOutput, "encrypted archive");
        },
        appDirectory: directory,
        sourceDirectory: directory,
        sourceRepository: SOURCE_REPOSITORY,
        sourceSha: SOURCE_SHA,
      }),
      /database_backup_failed/,
    );

    assert.equal(await exists(outputPath), false);
    assert.equal(await exists(lockPath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production database backup rejects a database identity change", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-db-identity-test-"),
  );
  const outputPath = path.join(directory, "backup.tar.enc");
  const lockPath = path.join(directory, "backup.lock");
  try {
    await assert.rejects(
      createProductionDatabaseBackup({
        env: {},
        outputPath,
        lockPath,
        passphrase: "long-enough-encryption-passphrase",
        selfHostedTopology: selfHostedTopology(),
        runCommand: successfulCommandRunner({
          changedDatabaseIdentity: true,
        }),
        encryptArchive: async ({ outputPath: encryptedOutput }) => {
          await writeFile(encryptedOutput, "encrypted archive");
        },
        appDirectory: directory,
        sourceDirectory: directory,
        sourceRepository: SOURCE_REPOSITORY,
        sourceSha: SOURCE_SHA,
      }),
      /database_identity_changed_during_backup/,
    );
    assert.equal(await exists(outputPath), false);
    assert.equal(await exists(lockPath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production database backup rejects a same-count identity content replacement", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-db-content-identity-test-"),
  );
  const outputPath = path.join(directory, "backup.tar.enc");
  const lockPath = path.join(directory, "backup.lock");
  try {
    await assert.rejects(
      createProductionDatabaseBackup({
        env: {},
        outputPath,
        lockPath,
        passphrase: "long-enough-encryption-passphrase",
        selfHostedTopology: selfHostedTopology(),
        runCommand: successfulCommandRunner({
          changedIdentityContent: true,
        }),
        encryptArchive: async ({ outputPath: encryptedOutput }) => {
          await writeFile(encryptedOutput, "encrypted archive");
        },
        appDirectory: directory,
        sourceDirectory: directory,
        sourceRepository: SOURCE_REPOSITORY,
        sourceSha: SOURCE_SHA,
      }),
      /database_identity_changed_during_backup/,
    );
    assert.equal(await exists(outputPath), false);
    assert.equal(await exists(lockPath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backup rejects same-count financial content changes and never encrypts a success artifact", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "faolla-db-recovery-change-test-"));
  const outputPath = path.join(directory, "backup.tar.enc");
  const lockPath = path.join(directory, "backup.lock");
  let encrypted = false;
  try {
    await assert.rejects(createProductionDatabaseBackup({
      env: {}, outputPath, lockPath,
      passphrase: "long-enough-encryption-passphrase",
      selfHostedTopology: selfHostedTopology(),
      runCommand: successfulCommandRunner({ changedRecoveryContent: true }),
      encryptArchive: async () => { encrypted = true; },
      appDirectory: directory, sourceDirectory: directory,
      sourceRepository: SOURCE_REPOSITORY, sourceSha: SOURCE_SHA,
    }), /database_identity_changed_during_backup/);
    assert.equal(encrypted, false);
    assert.equal(await exists(outputPath), false);
    assert.equal(await exists(lockPath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backup capture probes identity and recovery content in one repeatable-read transaction", async () => {
  const runner = successfulCommandRunner();
  let probeArgs = [];
  let probeScript = "";
  await captureDatabaseIdentity(async (command, args, options) => {
    if (options?.errorCode === "database_identity_postgres_probe_failed") {
      probeArgs = args.slice(6);
      probeScript = args[4];
    }
    return runner(command, args, options);
  }, "supabase-db");
  assert.equal(probeArgs.length, 12);
  assert.deepEqual(probeArgs.filter((_arg, index) => index % 2 === 0), Array(6).fill("--command"));
  const commands = probeArgs.filter((_arg, index) => index % 2 === 1);
  assert.equal(commands[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");
  assert.match(commands[1], /^SET LOCAL timezone\s*=\s*'UTC';$/);
  assert.match(commands[2], /^SET LOCAL datestyle\s*=\s*'ISO,YMD';$/);
  assert.match(commands[3], /^SET LOCAL extra_float_digits\s*=\s*3;$/);
  assert.match(commands[4], /^WITH readiness AS MATERIALIZED/);
  assert.match(commands[4], /'recoveryContent'/);
  assert.match(commands[4], /'schemaVersion', 2/);
  assert.match(commands[4], /public\.faolla_platform_snapshot_restore_receipts/);
  assert.doesNotMatch(commands[4], /BEGIN ISOLATION|SET LOCAL|COMMIT;/);
  assert.equal(commands[5], "COMMIT;");
  assert.match(probeScript, /--quiet/);
  assert.match(probeScript, /--no-align "\$@"$/);
  assert.doesNotMatch(probeScript, /--command "\$1"/);
});

test("new live capture rejects legacy profiles and missing or renamed receipt relation", async () => {
  const missing = recoveryContentFixture(); missing.relations.pop();
  const replaced = recoveryContentFixture(); replaced.relations.at(-1).name = "public.wrong_receipts";
  for (const proof of [recoveryContentFixture({ schemaVersion: 1 }), missing, replaced]) {
    const runner = successfulCommandRunner();
    await assert.rejects(captureDatabaseIdentity(async (command, args, options) => {
      const result = await runner(command, args, options);
      if (options?.errorCode === "database_identity_postgres_probe_failed") {
        const value = JSON.parse(result.stdout); value.recoveryContent = proof;
        return { ...result, stdout: JSON.stringify(value) };
      }
      return result;
    }, "supabase-db"), /database_identity_probe_invalid/);
  }
});

test("backup rejects same-count durable restore-receipt changes before encryption", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "faolla-db-receipt-change-test-"));
  const outputPath = path.join(directory, "backup.tar.enc"); const lockPath = path.join(directory, "backup.lock");
  let encrypted = false;
  try {
    await assert.rejects(createProductionDatabaseBackup({ env: {}, outputPath, lockPath,
      passphrase: "long-enough-encryption-passphrase", selfHostedTopology: selfHostedTopology(),
      runCommand: successfulCommandRunner({ changedRecoveryContent: true,
        changedRecoveryRelation: "public.faolla_platform_snapshot_restore_receipts" }),
      encryptArchive: async () => { encrypted = true; }, appDirectory: directory, sourceDirectory: directory,
      sourceRepository: SOURCE_REPOSITORY, sourceSha: SOURCE_SHA,
    }), /database_identity_changed_during_backup/);
    assert.equal(encrypted, false); assert.equal(await exists(outputPath), false); assert.equal(await exists(lockPath), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
