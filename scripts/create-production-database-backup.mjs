import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pathToFileURL } from "node:url";

import {
  buildDatabaseBackupManifest,
  buildDatabaseBackupAuthoritativeBaselineJsonSql,
  DATABASE_BACKUP_ARCHIVE_FILES,
  sha256File,
  validateDatabaseBackupSourceIdentity,
} from "./database-backup-contract.mjs";
import { inspectSelfHostedSupabaseTopology } from "./check-database-backup-readiness.mjs";

const DEFAULT_COMMAND_TIMEOUT_MS = 45 * 60 * 1000;
const MINIMUM_PASSPHRASE_LENGTH = 24;
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;
const POSTGRES_CONFIG_DIRECTORY = "/etc/postgresql-custom";
const CONFIG_ARCHIVE_EXCLUDES = [
  "./.git",
  "./backups",
  "./volumes/db/data",
  "./volumes/storage",
];
const EXACT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const GITHUB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

class DatabaseBackupError extends Error {
  constructor(code) {
    super(code);
    this.name = "DatabaseBackupError";
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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.on("error", () => {});
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const append = (current, chunk) =>
      `${current}${chunk.toString("utf8")}`.slice(-16_384);
    const outputPromise = options.outputPath
      ? pipeline(
          child.stdout,
          ...(options.gzipOutput ? [createGzip({ level: 6 })] : []),
          createWriteStream(options.outputPath, {
            flags: "wx",
            mode: 0o600,
          }),
        )
      : null;
    if (!options.outputPath) {
      child.stdout.on("data", (chunk) => {
        stdout = append(stdout, chunk);
      });
    }
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    child.on("error", () => {
      finish(() =>
        reject(new DatabaseBackupError(options.errorCode || "command_failed")),
      );
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
    child.on("close", async (code) => {
      clearTimeout(timer);
      try {
        if (outputPromise) await outputPromise;
      } catch {
        finish(() =>
          reject(
            new DatabaseBackupError(
              options.errorCode || "command_output_failed",
            ),
          ),
        );
        return;
      }
      if (timedOut) {
        finish(() =>
          reject(
            new DatabaseBackupError(
              `${options.errorCode || "command"}_timeout`,
            ),
          ),
        );
        return;
      }
      if (code !== 0) {
        finish(() =>
          reject(
            new DatabaseBackupError(options.errorCode || "command_failed"),
          ),
        );
        return;
      }
      finish(() => resolve({ stdout, stderr }));
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function readPassphraseFromStdin() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk.toString("utf8");
    if (value.length > 16_384) {
      throw new DatabaseBackupError("backup_passphrase_too_long");
    }
  }
  return value.replace(/[\r\n]+$/, "");
}

async function acquireLock(lockPath) {
  const resolved = path.resolve(lockPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  try {
    const handle = await open(resolved, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`, "utf8");
    await handle.close();
    return resolved;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw new DatabaseBackupError("backup_lock_failed");
    }
    try {
      const details = await stat(resolved);
      if (Date.now() - details.mtimeMs > LOCK_STALE_MS) {
        await unlink(resolved);
        return acquireLock(resolved);
      }
    } catch {
      return acquireLock(resolved);
    }
    throw new DatabaseBackupError("backup_already_running");
  }
}

function selectContainer(candidates, configuredName, predicate) {
  if (configuredName) {
    return (
      candidates.find(
        (candidate) =>
          candidate.name === configuredName && predicate(candidate),
      ) ?? null
    );
  }
  return candidates.find(predicate) ?? null;
}

function selectBackupSources(topology, env) {
  const database = selectContainer(
    topology.databaseCandidates,
    trimText(env.FAOLLA_DATABASE_CONTAINER),
    (candidate) =>
      candidate.probeSucceeded &&
      candidate.tools.pg_dumpall &&
      candidate.tools.psql &&
      candidate.tools.tar,
  );
  if (!database) {
    throw new DatabaseBackupError("database_container_unavailable");
  }

  const storage = selectContainer(
    topology.storageCandidates,
    trimText(env.FAOLLA_STORAGE_CONTAINER),
    (candidate) =>
      candidate.probeSucceeded &&
      candidate.tarAvailable &&
      ["file", "unspecified"].includes(candidate.backend),
  );
  if (!storage) {
    throw new DatabaseBackupError("file_storage_container_unavailable");
  }
  const writableStorageMounts = storage.mounts.filter(
    (mount) =>
      ["bind", "volume"].includes(mount.type) &&
      !mount.readOnly &&
      mount.destination.startsWith("/"),
  );
  const storageMount =
    writableStorageMounts.find(
      (mount) => mount.destination === "/var/lib/storage",
    ) ?? writableStorageMounts[0];
  if (!storageMount) {
    throw new DatabaseBackupError("storage_persistent_mount_unavailable");
  }

  return { database, storage, storageMount };
}

function encryptArchiveStream(input) {
  return new Promise((resolve, reject) => {
    const tar = spawn(
      "tar",
      ["-cf", "-", "-C", input.directory, ...DATABASE_BACKUP_ARCHIVE_FILES],
      {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const openssl = spawn(
      "openssl",
      [
        "enc",
        "-aes-256-cbc",
        "-salt",
        "-pbkdf2",
        "-iter",
        "200000",
        "-md",
        "sha256",
        "-out",
        input.outputPath,
        "-pass",
        "fd:3",
      ],
      {
        shell: false,
        stdio: ["pipe", "ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let tarClosed = false;
    let opensslClosed = false;
    let tarCode = null;
    let opensslCode = null;
    let timedOut = false;
    let settled = false;
    let timer;
    const finish = () => {
      if (settled || !tarClosed || !opensslClosed) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(new DatabaseBackupError("backup_encryption_timeout"));
      } else if (tarCode !== 0) {
        reject(new DatabaseBackupError("backup_archive_failed"));
      } else if (opensslCode !== 0) {
        reject(new DatabaseBackupError("backup_encryption_failed"));
      } else {
        resolve();
      }
    };
    tar.stderr.resume();
    openssl.stderr.resume();
    openssl.stdin.on("error", () => {});
    openssl.stdio[3].on("error", () => {});
    tar.on("error", () => {
      tarClosed = true;
      tarCode = -1;
      openssl.kill("SIGTERM");
      finish();
    });
    openssl.on("error", () => {
      opensslClosed = true;
      opensslCode = -1;
      tar.kill("SIGTERM");
      finish();
    });
    tar.on("close", (code) => {
      tarClosed = true;
      tarCode = code;
      finish();
    });
    openssl.on("close", (code) => {
      opensslClosed = true;
      opensslCode = code;
      finish();
    });
    tar.stdout.pipe(openssl.stdin);
    openssl.stdio[3].end(`${input.passphrase}\n`);
    timer = setTimeout(
      () => {
        timedOut = true;
        tar.kill("SIGTERM");
        openssl.kill("SIGTERM");
        setTimeout(() => {
          tar.kill("SIGKILL");
          openssl.kill("SIGKILL");
        }, 5_000).unref();
      },
      15 * 60 * 1000,
    );
  });
}

function validComposeDirectory(value) {
  const directory = trimText(value);
  return (
    path.posix.isAbsolute(directory) &&
    directory !== "/" &&
    !directory.includes("\0") &&
    !directory.includes("\n")
  );
}

async function readComposeDirectory(commandRunner, databaseName) {
  const result = await commandRunner(
    "docker",
    [
      "inspect",
      "--format",
      '{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
      databaseName,
    ],
    {
      errorCode: "compose_directory_lookup_failed",
      timeoutMs: 60_000,
    },
  );
  const directory = trimText(result.stdout);
  if (!validComposeDirectory(directory)) {
    throw new DatabaseBackupError("compose_directory_invalid");
  }
  return directory;
}

function normalizeGitHubRepository(remoteUrl) {
  const value = trimText(remoteUrl).replace(/\.git$/i, "");
  for (const pattern of [
    /^https:\/\/github\.com\/([^/]+\/[^/]+)$/i,
    /^git@github\.com:([^/]+\/[^/]+)$/i,
    /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+)$/i,
  ]) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return "";
}

async function captureBackupSourceIdentity(input) {
  const expectedSha = trimText(input.expectedSha);
  const expectedRepository = trimText(input.expectedRepository);
  if (!EXACT_COMMIT_PATTERN.test(expectedSha)) {
    throw new DatabaseBackupError("backup_source_sha_invalid");
  }
  if (!GITHUB_REPOSITORY_PATTERN.test(expectedRepository)) {
    throw new DatabaseBackupError("backup_source_repository_invalid");
  }

  const revision = await input.commandRunner(
    "git",
    ["-C", input.directory, "rev-parse", "--verify", "HEAD^{commit}"],
    { errorCode: "backup_source_revision_unavailable", timeoutMs: 60_000 },
  );
  const actualSha = trimText(revision.stdout);
  if (actualSha !== expectedSha) {
    throw new DatabaseBackupError("backup_source_sha_mismatch");
  }
  const originMain = await input.commandRunner(
    "git",
    ["-C", input.directory, "rev-parse", "refs/remotes/origin/main"],
    { errorCode: "backup_source_origin_main_unavailable", timeoutMs: 60_000 },
  );
  const originMainSha = trimText(originMain.stdout);
  if (originMainSha !== expectedSha) {
    throw new DatabaseBackupError("backup_source_origin_main_mismatch");
  }
  const branch = await input.commandRunner(
    "git",
    ["-C", input.directory, "rev-parse", "--abbrev-ref", "HEAD"],
    { errorCode: "backup_source_head_state_unavailable", timeoutMs: 60_000 },
  );
  if (trimText(branch.stdout) !== "HEAD") {
    throw new DatabaseBackupError("backup_source_not_detached");
  }

  const remote = await input.commandRunner(
    "git",
    ["-C", input.directory, "config", "--get", "remote.origin.url"],
    { errorCode: "backup_source_remote_unavailable", timeoutMs: 60_000 },
  );
  const actualRepository = normalizeGitHubRepository(remote.stdout);
  if (
    !actualRepository ||
    actualRepository.toLowerCase() !== expectedRepository.toLowerCase()
  ) {
    throw new DatabaseBackupError("backup_source_repository_mismatch");
  }

  const status = await input.commandRunner(
    "git",
    [
      "-C",
      input.directory,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ],
    { errorCode: "backup_source_status_unavailable", timeoutMs: 60_000 },
  );
  if (trimText(status.stdout)) {
    throw new DatabaseBackupError("backup_source_worktree_dirty");
  }
  return {
    repository: expectedRepository,
    sha: expectedSha,
    originMainSha,
    detached: true,
  };
}

export async function captureDatabaseIdentity(commandRunner, databaseName) {
  const inspectResult = await commandRunner(
    "docker",
    [
      "inspect",
      "--format",
      '{"containerId":{{json .Id}},"imageId":{{json .Image}},"containerStartedAt":{{json .State.StartedAt}}}',
      databaseName,
    ],
    {
      errorCode: "database_identity_container_probe_failed",
      timeoutMs: 60_000,
    },
  );
  const probeSql = [
    "WITH readiness AS MATERIALIZED (",
    "  SELECT public.faolla_get_ordinary_account_authoritative_cutover_readiness_v1() AS value",
    ") SELECT pg_catalog.json_build_object(",
    "  'databaseName', pg_catalog.current_database(),",
    "  'databaseOid', (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database()),",
    "  'systemIdentifier', (SELECT system_identifier::text FROM pg_catalog.pg_control_system()),",
    "  'serverVersionNum', pg_catalog.current_setting('server_version_num'),",
    "  'postmasterStartedAt', pg_catalog.to_char(pg_catalog.pg_postmaster_start_time() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),",
    "  'primary', NOT pg_catalog.pg_is_in_recovery(),",
    "  'baseline',",
    buildDatabaseBackupAuthoritativeBaselineJsonSql(),
    ")::text FROM readiness;",
  ].join("\n");
  const probeScript = [
    'export PGPASSWORD="${POSTGRES_PASSWORD:-}"',
    'exec psql -h localhost -U supabase_admin -d "${POSTGRES_DB:?POSTGRES_DB is required}" --no-password --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --command "$1"',
  ].join("\n");
  const databaseResult = await commandRunner(
    "docker",
    [
      "exec",
      databaseName,
      "sh",
      "-lc",
      probeScript,
      "backup-identity",
      probeSql,
    ],
    { errorCode: "database_identity_postgres_probe_failed", timeoutMs: 60_000 },
  );

  let identity;
  try {
    identity = {
      containerName: databaseName,
      ...JSON.parse(trimText(inspectResult.stdout)),
      ...JSON.parse(trimText(databaseResult.stdout)),
    };
  } catch {
    throw new DatabaseBackupError("database_identity_probe_invalid");
  }
  const validation = validateDatabaseBackupSourceIdentity({
    repository: "validation/source",
    sha: "0".repeat(40),
    originMainSha: "0".repeat(40),
    detached: true,
    treeState: "clean",
    stability: {
      source: "matched_before_after",
      database: "matched_before_after",
    },
    database: identity,
  });
  if (!validation.valid) {
    throw new DatabaseBackupError("database_identity_probe_invalid");
  }
  return validation.source.database;
}

async function writeManifest(directory, metadata) {
  const manifest = await buildDatabaseBackupManifest({
    directory,
    ...metadata,
  });
  await writeFile(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return manifest;
}

async function assertExpectedArchiveFiles(directory) {
  for (const name of DATABASE_BACKUP_ARCHIVE_FILES) {
    const details = await stat(path.join(directory, name));
    if (!details.isFile() || details.size <= 0) {
      throw new DatabaseBackupError("backup_archive_incomplete");
    }
  }
}

export async function createProductionDatabaseBackup(input = {}) {
  const env = input.env ?? process.env;
  const topology =
    input.selfHostedTopology ?? inspectSelfHostedSupabaseTopology();
  if (!topology.available) {
    throw new DatabaseBackupError("self_hosted_topology_unavailable");
  }
  const sources = selectBackupSources(topology, env);

  const outputPath = path.resolve(trimText(input.outputPath));
  if (!outputPath || !outputPath.endsWith(".enc")) {
    throw new DatabaseBackupError("backup_output_invalid");
  }
  if (await fileExists(outputPath)) {
    throw new DatabaseBackupError("backup_output_exists");
  }
  await mkdir(path.dirname(outputPath), { recursive: true });

  const passphrase = String(input.passphrase ?? "");
  if (passphrase.length < MINIMUM_PASSPHRASE_LENGTH) {
    throw new DatabaseBackupError("backup_passphrase_too_short");
  }

  const lockPath = await acquireLock(
    input.lockPath ??
      path.join(os.tmpdir(), "faolla-production-database-backup.lock"),
  );
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-database-backup-"),
  );
  const commandRunner = input.runCommand ?? runCommand;
  const encryptArchive = input.encryptArchive ?? encryptArchiveStream;
  const appDirectory = path.resolve(input.appDirectory ?? process.cwd());
  const sourceDirectory = path.resolve(input.sourceDirectory ?? process.cwd());

  try {
    const initialSourceIdentity = await captureBackupSourceIdentity({
      commandRunner,
      directory: sourceDirectory,
      expectedRepository: input.sourceRepository,
      expectedSha: input.sourceSha,
    });
    const initialDatabaseIdentity = await captureDatabaseIdentity(
      commandRunner,
      sources.database.name,
    );
    const versionResult = await commandRunner(
      "docker",
      ["exec", sources.database.name, "pg_dumpall", "--version"],
      {
        errorCode: "pg_dumpall_unavailable",
        timeoutMs: 60_000,
      },
    );
    const toolVersion =
      trimText(versionResult.stdout).match(/\d+(?:\.\d+)+/)?.[0] ?? "unknown";
    const composeDirectory = await readComposeDirectory(
      commandRunner,
      sources.database.name,
    );

    const databaseDumpScript = [
      'export PGPASSWORD="${POSTGRES_PASSWORD:-}"',
      "exec pg_dumpall -h localhost -U supabase_admin --no-password",
    ].join("\n");
    await commandRunner(
      "docker",
      ["exec", sources.database.name, "sh", "-lc", databaseDumpScript],
      {
        errorCode: "database_dump_failed",
        outputPath: path.join(temporaryDirectory, "database.sql.gz"),
        gzipOutput: true,
      },
    );

    const containerArchiveScript = [
      'test -d "$1"',
      'exec tar -czf - -C "$1" .',
    ].join("\n");
    await commandRunner(
      "docker",
      [
        "exec",
        sources.database.name,
        "sh",
        "-lc",
        containerArchiveScript,
        "backup",
        POSTGRES_CONFIG_DIRECTORY,
      ],
      {
        errorCode: "postgres_config_backup_failed",
        outputPath: path.join(temporaryDirectory, "postgres-config.tar.gz"),
      },
    );
    await commandRunner(
      "docker",
      [
        "exec",
        sources.storage.name,
        "sh",
        "-lc",
        containerArchiveScript,
        "backup",
        sources.storageMount.destination,
      ],
      {
        errorCode: "storage_backup_failed",
        outputPath: path.join(temporaryDirectory, "storage.tar.gz"),
      },
    );

    await commandRunner(
      "tar",
      [
        "-czf",
        path.join(temporaryDirectory, "supabase-config.tar.gz"),
        ...CONFIG_ARCHIVE_EXCLUDES.flatMap((entry) => [`--exclude=${entry}`]),
        "--exclude=*.log",
        "-C",
        composeDirectory,
        ".",
      ],
      {
        errorCode: "supabase_config_backup_failed",
        timeoutMs: 10 * 60 * 1000,
      },
    );
    await commandRunner(
      "tar",
      [
        "-czf",
        path.join(temporaryDirectory, "app-config.tar.gz"),
        "-C",
        appDirectory,
        ".env.local",
      ],
      {
        errorCode: "app_config_backup_failed",
        timeoutMs: 60_000,
      },
    );

    const finalDatabaseIdentity = await captureDatabaseIdentity(
      commandRunner,
      sources.database.name,
    );
    if (
      JSON.stringify(finalDatabaseIdentity) !==
      JSON.stringify(initialDatabaseIdentity)
    ) {
      throw new DatabaseBackupError("database_identity_changed_during_backup");
    }
    const finalSourceIdentity = await captureBackupSourceIdentity({
      commandRunner,
      directory: sourceDirectory,
      expectedRepository: input.sourceRepository,
      expectedSha: input.sourceSha,
    });
    if (
      JSON.stringify(finalSourceIdentity) !==
      JSON.stringify(initialSourceIdentity)
    ) {
      throw new DatabaseBackupError("backup_source_changed_during_backup");
    }

    const manifest = await writeManifest(temporaryDirectory, {
      toolVersion,
      databaseImage: sources.database.image,
      storageImage: sources.storage.image,
      storageBackend: sources.storage.backend,
      sourceRepository: initialSourceIdentity.repository,
      sourceSha: initialSourceIdentity.sha,
      databaseIdentity: initialDatabaseIdentity,
    });
    await assertExpectedArchiveFiles(temporaryDirectory);
    await encryptArchive({
      directory: temporaryDirectory,
      outputPath,
      passphrase,
    });
    await chmod(outputPath, 0o600);

    const outputDetails = await stat(outputPath);
    if (!outputDetails.isFile() || outputDetails.size <= 0) {
      throw new DatabaseBackupError("encrypted_backup_invalid");
    }
    return {
      schemaVersion: 2,
      createdAt: manifest.createdAt,
      status: "created",
      sourceConfiguration: "self_hosted_docker",
      format: manifest.format,
      outputFile: path.basename(outputPath),
      outputBytes: outputDetails.size,
      outputSha256: await sha256File(outputPath),
      source: manifest.source,
      dumpFiles: manifest.files.map((item) => ({
        name: item.name,
        bytes: item.bytes,
        sha256: item.sha256,
      })),
    };
  } catch (error) {
    await rm(outputPath, { force: true });
    if (error instanceof DatabaseBackupError) throw error;
    throw new DatabaseBackupError("database_backup_failed");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    await rm(lockPath, { force: true });
  }
}

async function main() {
  const outputPath = readArgument("output");
  const passphrase = hasFlag("passphrase-stdin")
    ? await readPassphraseFromStdin()
    : String(process.env.FAOLLA_BACKUP_ENCRYPTION_PASSPHRASE ?? "");
  const report = await createProductionDatabaseBackup({
    outputPath,
    passphrase,
    appDirectory: readArgument("app-directory") || process.cwd(),
    sourceDirectory: process.cwd(),
    sourceRepository: readArgument("source-repository"),
    sourceSha: readArgument("source-sha"),
  });
  console.log(
    `[database-backup] CREATED file=${report.outputFile} bytes=${report.outputBytes}`,
  );
  if (hasFlag("json")) console.log(JSON.stringify(report));
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    const code =
      error instanceof DatabaseBackupError
        ? error.code
        : "database_backup_failed";
    console.error(`[database-backup] FAILED ${code}`);
    process.exitCode = 1;
  });
}
