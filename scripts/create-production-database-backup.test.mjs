import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProductionDatabaseBackup } from "./create-production-database-backup.mjs";

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

function successfulCommandRunner() {
  return async (command, args, options = {}) => {
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
    });

    assert.equal(report.status, "created");
    assert.equal(report.sourceConfiguration, "self_hosted_docker");
    assert.equal(await exists(outputPath), true);
    assert.equal(await exists(lockPath), false);
    assert.equal(JSON.stringify(report).includes(secret), false);
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
      }),
      /database_backup_failed/,
    );

    assert.equal(await exists(outputPath), false);
    assert.equal(await exists(lockPath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
