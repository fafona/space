import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildDatabaseBackupAuthoritativeBaselineJsonSql,
  validateDatabaseBackupSourceIdentity,
} from "./database-backup-contract.mjs";
import {
  DatabaseBackupVerificationError,
  withVerifiedProductionDatabaseBackup,
} from "./verify-production-database-backup.mjs";
import {
  PRODUCTION_RELEASE_AGGREGATE_KEYS,
  PRODUCTION_RELEASE_BASELINE_KEYS,
} from "./production-release-attestation.mjs";
import {
  isOrdinaryAccountIdentityContentSha256,
  ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY,
} from "./ordinary-account-identity-content-contract.mjs";

const RESTORE_DATABASE_IMAGE_PATTERN =
  /^supabase\/postgres:[a-z0-9][a-z0-9._-]{0,127}$/i;
const RESTORE_BOOTSTRAP_USER = "restore_bootstrap";
const RESTORE_CONTROL_DATABASE = "restore_control";
const RESTORE_TIMEOUT_MS = 45 * 60 * 1000;
const DEFERRED_GRAPHQL_ACL_ROLES = new Set([
  "postgres",
  "anon",
  "authenticated",
  "service_role",
]);

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

export function isDeferredGraphqlAclStatement(line) {
  const match = String(line).match(
    /^GRANT ALL ON FUNCTION graphql_public\.graphql\([^;\r\n]+\) TO ([a-z_]+);$/,
  );
  return Boolean(match && DEFERRED_GRAPHQL_ACL_ROLES.has(match[1]));
}

function createRestoreSqlCompatibilityFilter() {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let skippedGraphqlPublicAclCount = 0;
  const pushLine = (stream, line, newline = "") => {
    if (isDeferredGraphqlAclStatement(line)) {
      skippedGraphqlPublicAclCount += 1;
      return;
    }
    stream.push(`${line}${newline}`);
  };
  const filter = new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        pushLine(this, pending.slice(0, newlineIndex), "\n");
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
      callback();
    },
    flush(callback) {
      pending += decoder.end();
      if (pending) pushLine(this, pending);
      callback();
    },
  });
  Object.defineProperty(filter, "skippedGraphqlPublicAclCount", {
    get: () => skippedGraphqlPublicAclCount,
  });
  return filter;
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
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      },
      options.timeoutMs ?? 10 * 60 * 1000,
    );
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
    const compatibilityFilter = createRestoreSqlCompatibilityFilter();
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
    let filterFailed = false;
    let timer;
    const stopGzip = () => {
      gzip.stdout.unpipe(compatibilityFilter);
      gzip.stdout.destroy();
      compatibilityFilter.destroy();
      gzip.kill("SIGTERM");
    };
    const stopRestore = () => {
      restore.stdin.destroy();
      restore.kill("SIGTERM");
    };
    const finish = () => {
      if (settled || !gzipClosed || !restoreClosed) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new DatabaseRestoreRehearsalError("database_restore_timeout"));
      } else if (filterFailed) {
        reject(
          new DatabaseRestoreRehearsalError("database_restore_filter_failed"),
        );
      } else if (restoreCode !== 0) {
        reject(new DatabaseRestoreRehearsalError("database_restore_failed"));
      } else if (gzipCode !== 0) {
        reject(
          new DatabaseRestoreRehearsalError(
            "database_restore_decompression_failed",
          ),
        );
      } else {
        resolve({
          skippedGraphqlPublicAclCount:
            compatibilityFilter.skippedGraphqlPublicAclCount,
        });
      }
    };
    gzip.stderr.resume();
    restore.stderr.resume();
    gzip.stdout.on("error", () => {});
    restore.stdin.on("error", () => {});
    compatibilityFilter.on("error", () => {
      filterFailed = true;
      if (!gzipClosed) stopGzip();
      if (!restoreClosed) stopRestore();
    });
    gzip.on("error", () => {
      gzipClosed = true;
      gzipCode = -1;
      stopRestore();
      finish();
    });
    restore.on("error", () => {
      restoreClosed = true;
      restoreCode = -1;
      stopGzip();
      finish();
    });
    gzip.on("close", (code) => {
      gzipClosed = true;
      gzipCode = code;
      if (code !== 0 && !restoreClosed) stopRestore();
      finish();
    });
    restore.on("close", (code) => {
      restoreClosed = true;
      restoreCode = code;
      if (code !== 0 && !gzipClosed) stopGzip();
      finish();
    });
    gzip.stdout.pipe(compatibilityFilter).pipe(restore.stdin);
    timer = setTimeout(() => {
      timedOut = true;
      stopGzip();
      stopRestore();
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

async function queryScalar(
  commandRunner,
  containerName,
  databaseName,
  sql,
  errorCode,
) {
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
      databaseName,
      "-c",
      sql,
    ],
    { errorCode, timeoutMs: 60_000 },
  );
  return trimText(result.stdout);
}

async function queryCount(
  commandRunner,
  containerName,
  databaseName,
  sql,
  errorCode,
) {
  const output = await queryScalar(
    commandRunner,
    containerName,
    databaseName,
    sql,
    errorCode,
  );
  const value = Number.parseInt(output, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DatabaseRestoreRehearsalError(`${errorCode}_result_invalid`);
  }
  return value;
}

async function queryAuthoritativeBaseline(
  commandRunner,
  containerName,
  databaseName,
) {
  const sql = [
    "WITH readiness AS MATERIALIZED (",
    "  SELECT public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() AS value",
    ")",
    `SELECT ${buildDatabaseBackupAuthoritativeBaselineJsonSql()}::text FROM readiness;`,
  ].join("\n");
  const output = await queryScalar(
    commandRunner,
    containerName,
    databaseName,
    sql,
    "restore_authoritative_baseline_probe_failed",
  );
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new DatabaseRestoreRehearsalError(
      "restore_authoritative_baseline_invalid",
    );
  }
  const keys =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.keys(parsed).sort()
      : [];
  const expectedKeys = [...PRODUCTION_RELEASE_BASELINE_KEYS].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    PRODUCTION_RELEASE_AGGREGATE_KEYS.some(
      (key) => !/^(?:0|[1-9][0-9]*)$/.test(parsed[key]),
    ) ||
    !isOrdinaryAccountIdentityContentSha256(
      parsed[ORDINARY_ACCOUNT_IDENTITY_CONTENT_SHA256_KEY],
    )
  ) {
    throw new DatabaseRestoreRehearsalError(
      "restore_authoritative_baseline_invalid",
    );
  }
  return Object.fromEntries(
    PRODUCTION_RELEASE_BASELINE_KEYS.map((key) => [key, parsed[key]]),
  );
}

async function repairDeferredGraphqlAcl(
  commandRunner,
  containerName,
  databaseName,
) {
  const sql = [
    "SET ROLE supabase_admin;",
    "CREATE OR REPLACE FUNCTION graphql_public.graphql(",
    '  "operationName" text DEFAULT NULL,',
    "  query text DEFAULT NULL,",
    "  variables jsonb DEFAULT NULL,",
    "  extensions jsonb DEFAULT NULL",
    ") RETURNS jsonb",
    "LANGUAGE sql",
    "AS $faolla_graphql$",
    "  SELECT graphql.resolve(",
    "    query := query,",
    "    variables := coalesce(variables, '{}'::jsonb),",
    '    "operationName" := "operationName",',
    "    extensions := extensions",
    "  );",
    "$faolla_graphql$;",
    'GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO postgres, anon, authenticated, service_role;',
    "GRANT USAGE ON SCHEMA graphql TO postgres, anon, authenticated, service_role;",
    "GRANT SELECT ON ALL TABLES IN SCHEMA graphql TO postgres, anon, authenticated, service_role;",
    "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphql TO postgres, anon, authenticated, service_role;",
    "GRANT ALL ON ALL SEQUENCES IN SCHEMA graphql TO postgres, anon, authenticated, service_role;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA graphql GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA graphql GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;",
    "GRANT USAGE ON SCHEMA graphql_public TO postgres WITH GRANT OPTION;",
    "GRANT USAGE ON SCHEMA graphql TO postgres WITH GRANT OPTION;",
  ].join("\n");
  await commandRunner(
    "docker",
    [
      "exec",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-1",
      "-U",
      RESTORE_BOOTSTRAP_USER,
      "-d",
      databaseName,
      "-c",
      sql,
    ],
    {
      errorCode: "restore_graphql_public_function_repair_failed",
      timeoutMs: 60_000,
    },
  );
}

export async function rehearseVerifiedDatabaseBackup(input) {
  const databaseImage = trimText(input.manifest?.source?.databaseImage);
  if (!RESTORE_DATABASE_IMAGE_PATTERN.test(databaseImage)) {
    throw new DatabaseRestoreRehearsalError("restore_database_image_rejected");
  }
  const sourceValidation = validateDatabaseBackupSourceIdentity(
    input.manifest?.source,
  );
  if (!sourceValidation.valid) {
    throw new DatabaseRestoreRehearsalError(
      "restore_source_database_identity_invalid",
    );
  }
  const sourceDatabase = sourceValidation.source.database;
  const restoreDatabaseName = sourceDatabase.databaseName;
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
    const rootKeyPath = await findPgsodiumRootKey(postgresConfigDirectory);
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
    await commandRunner("docker", ["volume", "create", configVolumeName], {
      errorCode: "restore_database_config_volume_create_failed",
    });
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
        "cp -a /etc/postgresql-custom/. /target/ && chown -R postgres:postgres /target && install -m 600 -o postgres -g postgres /source/pgsodium_root.key /target/pgsodium_root.key",
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

    // pg_dumpall connects to the standard postgres database without creating it.
    const restoreCompatibility = await restoreSql(
      path.join(input.directory, "database.sql.gz"),
      containerName,
    );
    const skippedGraphqlPublicAclCount =
      Number(restoreCompatibility?.skippedGraphqlPublicAclCount) || 0;
    if (
      skippedGraphqlPublicAclCount !== 0 &&
      skippedGraphqlPublicAclCount !== DEFERRED_GRAPHQL_ACL_ROLES.size
    ) {
      throw new DatabaseRestoreRehearsalError(
        "restore_graphql_acl_count_unexpected",
      );
    }
    if (skippedGraphqlPublicAclCount > 0) {
      await repairDeferredGraphqlAcl(
        commandRunner,
        containerName,
        restoreDatabaseName,
      );
    }

    const restoredBaseline = await queryAuthoritativeBaseline(
      commandRunner,
      containerName,
      restoreDatabaseName,
    );
    if (
      PRODUCTION_RELEASE_BASELINE_KEYS.some(
        (key) => restoredBaseline[key] !== sourceDatabase.baseline[key],
      )
    ) {
      throw new DatabaseRestoreRehearsalError(
        "restore_authoritative_baseline_mismatch",
      );
    }

    const database = {
      schemas: await queryCount(
        commandRunner,
        containerName,
        restoreDatabaseName,
        "SELECT count(*) FROM information_schema.schemata;",
        "restore_schema_count_failed",
      ),
      tables: await queryCount(
        commandRunner,
        containerName,
        restoreDatabaseName,
        "SELECT count(*) FROM information_schema.tables WHERE table_type = 'BASE TABLE';",
        "restore_table_count_failed",
      ),
      pages: await queryCount(
        commandRunner,
        containerName,
        restoreDatabaseName,
        "SELECT count(*) FROM public.pages;",
        "restore_pages_table_check_failed",
      ),
      authUsers: await queryCount(
        commandRunner,
        containerName,
        restoreDatabaseName,
        "SELECT count(*) FROM auth.users;",
        "restore_auth_users_check_failed",
      ),
      storageObjects: await queryCount(
        commandRunner,
        containerName,
        restoreDatabaseName,
        "SELECT count(*) FROM storage.objects;",
        "restore_storage_objects_check_failed",
      ),
      graphqlPublicFunctions: await queryCount(
        commandRunner,
        containerName,
        restoreDatabaseName,
        "SELECT CASE WHEN to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') IS NULL THEN 0 ELSE 1 END;",
        "restore_graphql_public_function_check_failed",
      ),
    };
    database.graphqlExecuteRoles =
      database.graphqlPublicFunctions === 1
        ? await queryCount(
            commandRunner,
            containerName,
            restoreDatabaseName,
            "SELECT count(*) FROM (VALUES ('postgres'), ('anon'), ('authenticated'), ('service_role')) AS expected(role_name) WHERE has_function_privilege(role_name, 'graphql_public.graphql(text,text,jsonb,jsonb)', 'EXECUTE');",
            "restore_graphql_acl_check_failed",
          )
        : 0;
    if (
      skippedGraphqlPublicAclCount > 0 &&
      database.graphqlPublicFunctions !== 1
    ) {
      throw new DatabaseRestoreRehearsalError(
        "restore_graphql_public_function_validation_failed",
      );
    }
    if (
      skippedGraphqlPublicAclCount > 0 &&
      database.graphqlExecuteRoles !== DEFERRED_GRAPHQL_ACL_ROLES.size
    ) {
      throw new DatabaseRestoreRehearsalError(
        "restore_graphql_acl_validation_failed",
      );
    }

    return {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      status: "restored",
      isolation: "ephemeral_docker_no_network",
      databaseImage,
      database,
      restoredBaseline,
      storage,
    };
  } finally {
    if (containerCreated) {
      await commandRunner("docker", ["rm", "-f", containerName], {
        errorCode: "restore_database_container_cleanup_failed",
        timeoutMs: 60_000,
      }).catch(() => {});
    }
    if (volumeCreated) {
      await commandRunner("docker", ["volume", "rm", "-f", volumeName], {
        errorCode: "restore_database_volume_cleanup_failed",
        timeoutMs: 60_000,
      }).catch(() => {});
    }
    if (configVolumeCreated) {
      await commandRunner("docker", ["volume", "rm", "-f", configVolumeName], {
        errorCode: "restore_database_config_volume_cleanup_failed",
        timeoutMs: 60_000,
      }).catch(() => {});
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
    backupCreatedAt: verified.report.backupCreatedAt,
    backupStatus: verified.report.status,
    inputFile: verified.report.inputFile,
    inputBytes: verified.report.inputBytes,
    source: verified.report.source,
    ...verified.callbackResult,
    schemaVersion: 2,
  };
}

async function readPassphraseFromStdin() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk.toString("utf8");
    if (value.length > 16_384) {
      throw new DatabaseRestoreRehearsalError("backup_passphrase_too_long");
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
