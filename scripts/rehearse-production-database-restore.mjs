import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DatabaseBackupVerificationError,
  withVerifiedProductionDatabaseBackup,
} from "./verify-production-database-backup.mjs";

const RESTORE_DATABASE_IMAGE_PATTERN =
  /^supabase\/postgres:[a-z0-9][a-z0-9._-]{0,127}$/i;
const RESTORE_BOOTSTRAP_USER = "restore_bootstrap";
const RESTORE_CONTROL_DATABASE = "restore_control";
const RESTORE_TIMEOUT_MS = 45 * 60 * 1000;

export class DatabaseRestoreRehearsalError extends Error {
  constructor(code) {
    super(code);
    this.name = "DatabaseRestoreRehearsalError";
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const append = (current, chunk) =>
      `${current}${chunk.toString("utf8")}`.slice(-65_536);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", () => {
      finish(() =>
        reject(
          new DatabaseRestoreRehearsalError(
            options.errorCode || "restore_command_failed",
          ),
        ),
      );
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, options.timeoutMs ?? 10 * 60 * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        finish(() =>
          reject(
            new DatabaseRestoreRehearsalError(
              `${options.errorCode || "restore_command"}_timeout`,
            ),
          ),
        );
        return;
      }
      if (code !== 0) {
        finish(() =>
          reject(
            new DatabaseRestoreRehearsalError(
              options.errorCode || "restore_command_failed",
            ),
          ),
        );
        return;
      }
      finish(() => resolve({ stdout, stderr }));
    });
  });
}

function restoreSqlStream(databaseDumpPath, containerName) {
  return new Promise((resolve, reject) => {
    const gzip = spawn("gzip", ["-dc", databaseDumpPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const restore = spawn(
      "docker",
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        RESTORE_BOOTSTRAP_USER,
        "-d",
        RESTORE_CONTROL_DATABASE,
      ],
      {
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    let settled = false;
    let gzipClosed = false;
    let restoreClosed = false;
    let gzipCode = null;
    let restoreCode = null;
    let timedOut = false;
    let timer;
    const finish = () => {
      if (settled || !gzipClosed || !restoreClosed) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new DatabaseRestoreRehearsalError("database_restore_timeout"));
      } else if (gzipCode !== 0) {
        reject(
          new DatabaseRestoreRehearsalError(
            "database_restore_decompression_failed",
          ),
        );
      } else if (restoreCode !== 0) {
        reject(
          new DatabaseRestoreRehearsalError("database_restore_failed"),
        );
      } else {
        resolve();
      }
    };
    gzip.stderr.resume();
    restore.stderr.resume();
    restore.stdin.on("error", () => {});
    gzip.on("error", () => {
      gzipClosed = true;
      gzipCode = -1;
      restore.kill("SIGTERM");
      finish();
    });
    restore.on("error", () => {
      restoreClosed = true;
      restoreCode = -1;
      gzip.kill("SIGTERM");
      finish();
    });
    gzip.on("close", (code) => {
      gzipClosed = true;
      gzipCode = code;
      finish();
    });
    restore.on("close", (code) => {
      restoreClosed = true;
      restoreCode = code;
      finish();
    });
    gzip.stdout.pipe(restore.stdin);
    timer = setTimeout(() => {
      timedOut = true;
      gzip.kill("SIGTERM");
      restore.kill("SIGTERM");
      setTimeout(() => {
        gzip.kill("SIGKILL");
        restore.kill("SIGKILL");
      }, 5_000).unref();
    }, RESTORE_TIMEOUT_MS);
  });
}

async function findPgsodiumRootKey(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findPgsodiumRootKey(entryPath);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === "pgsodium_root.key") {
      return entryPath;
    }
  }
  return "";
}

async function countStorageFiles(directory) {
  const totals = { files: 0, bytes: 0 };
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new DatabaseRestoreRehearsalError(
          "storage_restore_symlink_rejected",
        );
      }
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        const details = await stat(entryPath);
        totals.files += 1;
        totals.bytes += details.size;
      }
    }
  }
  await visit(directory);
  return totals;
}

async function waitForPostgres(commandRunner, containerName, sleep) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await commandRunner(
        "docker",
        [
          "exec",
          containerName,
          "pg_isready",
          "-U",
          RESTORE_BOOTSTRAP_USER,
          "-d",
          RESTORE_CONTROL_DATABASE,
        ],
        {
          errorCode: "restore_database_not_ready",
          timeoutMs: 10_000,
        },
      );
      return;
    } catch {
      if (attempt === 59) {
        throw new DatabaseRestoreRehearsalError(
          "restore_database_start_timeout",
        );
      }
      await sleep(2_000);
    }
  }
}

async function queryCount(commandRunner, containerName, sql, errorCode) {
  const result = await commandRunner(
    "docker",
    [
      "exec",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-U",
      RESTORE_BOOTSTRAP_USER,
      "-d",
      "postgres",
      "-c",
      sql,
    ],
    { errorCode, timeoutMs: 60_000 },
  );
  const value = Number.parseInt(trimText(result.stdout), 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DatabaseRestoreRehearsalError(
      `${errorCode}_result_invalid`,
    );
  }
  return value;
}

export async function rehearseVerifiedDatabaseBackup(input) {
  const databaseImage = trimText(input.manifest?.source?.databaseImage);
  if (!RESTORE_DATABASE_IMAGE_PATTERN.test(databaseImage)) {
    throw new DatabaseRestoreRehearsalError(
      "restore_database_image_rejected",
    );
  }
  const commandRunner = input.runCommand ?? runCommand;
  const restoreSql = input.restoreSql ?? restoreSqlStream;
  const sleep = input.sleep ?? delay;
  const suffix =
    trimText(input.resourceSuffix) ||
    `${process.pid}-${randomBytes(4).toString("hex")}`;
  const containerName = `faolla-restore-${suffix}`;
  const volumeName = `faolla-restore-data-${suffix}`;
  const configVolumeName = `faolla-restore-config-${suffix}`;
  const runtimeDirectory = path.join(input.directory, "restore-runtime");
  const postgresConfigDirectory = path.join(
    runtimeDirectory,
    "postgres-config",
  );
  const storageDirectory = path.join(runtimeDirectory, "storage");
  const environmentPath = path.join(runtimeDirectory, "postgres.env");
  const identityMapPath = path.join(runtimeDirectory, "pg_ident.conf");
  let containerCreated = false;
  let volumeCreated = false;
  let configVolumeCreated = false;

  await mkdir(postgresConfigDirectory, { recursive: true });
  await mkdir(storageDirectory, { recursive: true });
  try {
    await commandRunner(
      "tar",
      [
        "--no-same-owner",
        "--no-same-permissions",
        "-xzf",
        path.join(input.directory, "postgres-config.tar.gz"),
        "-C",
        postgresConfigDirectory,
      ],
      { errorCode: "postgres_config_restore_extract_failed" },
    );
    await commandRunner(
      "tar",
      [
        "--no-same-owner",
        "--no-same-permissions",
        "-xzf",
        path.join(input.directory, "storage.tar.gz"),
        "-C",
        storageDirectory,
      ],
      { errorCode: "storage_restore_extract_failed" },
    );
    const rootKeyPath = await findPgsodiumRootKey(
      postgresConfigDirectory,
    );
    if (!rootKeyPath) {
      throw new DatabaseRestoreRehearsalError(
        "pgsodium_root_key_restore_missing",
      );
    }
    const storage = await countStorageFiles(storageDirectory);

    const restorePassword = randomBytes(32).toString("base64url");
    await writeFile(
      environmentPath,
      [
        `POSTGRES_PASSWORD=${restorePassword}`,
        `POSTGRES_USER=${RESTORE_BOOTSTRAP_USER}`,
        `POSTGRES_DB=${RESTORE_CONTROL_DATABASE}`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(environmentPath, 0o600);
    await writeFile(
      identityMapPath,
      [
        `supabase_map postgres ${RESTORE_BOOTSTRAP_USER}`,
        `supabase_map root ${RESTORE_BOOTSTRAP_USER}`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o644 },
    );
    await chmod(identityMapPath, 0o644);

    await commandRunner("docker", ["pull", databaseImage], {
      errorCode: "restore_database_image_pull_failed",
      timeoutMs: 15 * 60 * 1000,
    });
    await commandRunner("docker", ["volume", "create", volumeName], {
      errorCode: "restore_database_volume_create_failed",
    });
    volumeCreated = true;
    await commandRunner(
      "docker",
      ["volume", "create", configVolumeName],
      {
        errorCode: "restore_database_config_volume_create_failed",
      },
    );
    configVolumeCreated = true;
    await commandRunner(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--entrypoint",
        "sh",
        "--mount",
        `type=volume,src=${configVolumeName},dst=/target`,
        "--mount",
        `type=bind,src=${rootKeyPath},dst=/source/pgsodium_root.key,readonly`,
        databaseImage,
        "-c",
        "install -d -m 700 -o postgres -g postgres /target && install -m 600 -o postgres -g postgres /source/pgsodium_root.key /target/pgsodium_root.key",
      ],
      {
        errorCode: "restore_key_stage_failed",
        timeoutMs: 60_000,
      },
    );
    await commandRunner(
      "docker",
      [
        "run",
        "-d",
        "--name",
        containerName,
        "--network",
        "none",
        "--memory",
        "4g",
        "--cpus",
        "2",
        "--no-healthcheck",
        "--env-file",
        environmentPath,
        "--tmpfs",
        "/docker-entrypoint-initdb.d:rw,noexec,nosuid,size=65536",
        "--mount",
        `type=volume,src=${volumeName},dst=/var/lib/postgresql/data`,
        "--mount",
        `type=volume,src=${configVolumeName},dst=/etc/postgresql-custom`,
        "--mount",
        `type=bind,src=${identityMapPath},dst=/etc/postgresql/pg_ident.conf,readonly`,
        databaseImage,
      ],
      {
        errorCode: "restore_database_container_start_failed",
        timeoutMs: 5 * 60 * 1000,
      },
    );
    containerCreated = true;
    await waitForPostgres(commandRunner, containerName, sleep);

    await commandRunner(
      "docker",
      [
        "exec",
        containerName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        RESTORE_BOOTSTRAP_USER,
        "-d",
        RESTORE_CONTROL_DATABASE,
        "-c",
        "DROP DATABASE IF EXISTS postgres WITH (FORCE);",
      ],
      { errorCode: "restore_target_prepare_failed" },
    );
    await restoreSql(
      path.join(input.directory, "database.sql.gz"),
      containerName,
    );

    const database = {
      schemas: await queryCount(
        commandRunner,
        containerName,
        "SELECT count(*) FROM information_schema.schemata;",
        "restore_schema_count_failed",
      ),
      tables: await queryCount(
        commandRunner,
        containerName,
        "SELECT count(*) FROM information_schema.tables WHERE table_type = 'BASE TABLE';",
        "restore_table_count_failed",
      ),
      pages: await queryCount(
        commandRunner,
        containerName,
        "SELECT count(*) FROM public.pages;",
        "restore_pages_table_check_failed",
      ),
      authUsers: await queryCount(
        commandRunner,
        containerName,
        "SELECT count(*) FROM auth.users;",
        "restore_auth_users_check_failed",
      ),
      storageObjects: await queryCount(
        commandRunner,
        containerName,
        "SELECT count(*) FROM storage.objects;",
        "restore_storage_objects_check_failed",
      ),
    };

    return {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      status: "restored",
      isolation: "ephemeral_docker_no_network",
      databaseImage,
      database,
      storage,
    };
  } finally {
    if (containerCreated) {
      await commandRunner(
        "docker",
        ["rm", "-f", containerName],
        {
          errorCode: "restore_database_container_cleanup_failed",
          timeoutMs: 60_000,
        },
      ).catch(() => {});
    }
    if (volumeCreated) {
      await commandRunner(
        "docker",
        ["volume", "rm", "-f", volumeName],
        {
          errorCode: "restore_database_volume_cleanup_failed",
          timeoutMs: 60_000,
        },
      ).catch(() => {});
    }
    if (configVolumeCreated) {
      await commandRunner(
        "docker",
        ["volume", "rm", "-f", configVolumeName],
        {
          errorCode: "restore_database_config_volume_cleanup_failed",
          timeoutMs: 60_000,
        },
      ).catch(() => {});
    }
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
}

export async function rehearseProductionDatabaseRestore(input) {
  const verified = await withVerifiedProductionDatabaseBackup({
    inputPath: input.inputPath,
    passphrase: input.passphrase,
    runCommand: input.verifyRunCommand,
    onVerified: (context) =>
      rehearseVerifiedDatabaseBackup({
        ...context,
        runCommand: input.runCommand,
        restoreSql: input.restoreSql,
        sleep: input.sleep,
        resourceSuffix: input.resourceSuffix,
      }),
  });
  return {
    schemaVersion: 1,
    backupCreatedAt: verified.report.backupCreatedAt,
    backupStatus: verified.report.status,
    ...verified.callbackResult,
  };
}

async function readPassphraseFromStdin() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk.toString("utf8");
    if (value.length > 16_384) {
      throw new DatabaseRestoreRehearsalError(
        "backup_passphrase_too_long",
      );
    }
  }
  return value.replace(/[\r\n]+$/, "");
}

async function main() {
  const passphrase = hasFlag("passphrase-stdin")
    ? await readPassphraseFromStdin()
    : String(process.env.FAOLLA_BACKUP_ENCRYPTION_PASSPHRASE ?? "");
  const report = await rehearseProductionDatabaseRestore({
    inputPath: readArgument("input"),
    passphrase,
  });
  console.log(
    `[database-restore-rehearsal] RESTORED schemas=${report.database.schemas} tables=${report.database.tables} storageFiles=${report.storage.files}`,
  );
  if (hasFlag("json")) console.log(JSON.stringify(report));
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    const code =
      error instanceof DatabaseRestoreRehearsalError ||
      error instanceof DatabaseBackupVerificationError
        ? error.code
        : "database_restore_rehearsal_failed";
    console.error(`[database-restore-rehearsal] FAILED ${code}`);
    process.exitCode = 1;
  });
}
