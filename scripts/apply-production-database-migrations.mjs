import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

import { inspectSelfHostedSupabaseTopology } from "./check-database-backup-readiness.mjs";
import {
  MIGRATION_FILENAME_PATTERN,
  validateMigrationSource,
} from "./check-supabase-migrations.mjs";

const VERSION_PATTERN = /^\d{12}$/;
const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/;
const MAX_MIGRATION_BYTES = 16 * 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_LOCK_PATH = path.join(
  os.tmpdir(),
  "faolla-production-database-migrations.lock",
);

const PSQL_CONTAINER_SCRIPT = [
  "set -eu",
  ': "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"',
  ': "${POSTGRES_DB:?POSTGRES_DB is required}"',
  'export PGPASSWORD="$POSTGRES_PASSWORD"',
  "export PGOPTIONS='-c lock_timeout=5s -c statement_timeout=900s'",
  "exec psql --host=localhost --username=supabase_admin " +
    '--dbname="$POSTGRES_DB" --no-password --no-psqlrc ' +
    "--set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose " +
    "--quiet --tuples-only --no-align",
].join("\n");

const REGISTRY_QUERY_SQL = [
  "SELECT CASE",
  "  WHEN to_regclass('public.faolla_schema_migrations') IS NULL THEN 'false'",
  "  ELSE 'true'",
  "END AS faolla_registry_exists",
  "\\gset",
  "\\echo __FAOLLA_REGISTRY__ :faolla_registry_exists",
  "\\if :faolla_registry_exists",
  "SELECT json_build_object(",
  "  'version', version::text,",
  "  'name', name",
  ")::text",
  "FROM public.faolla_schema_migrations",
  "ORDER BY version;",
  "\\endif",
  "",
].join("\n");

const MIGRATION_ADVISORY_LOCK_SQL =
  "SELECT pg_advisory_lock(20260731, 1);";
const MIGRATION_ADVISORY_UNLOCK_SQL =
  "SELECT pg_advisory_unlock(20260731, 1);";

export class ProductionDatabaseMigrationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "ProductionDatabaseMigrationError";
    this.code = code;
    this.details = details;
  }
}

function migrationError(code, details) {
  return new ProductionDatabaseMigrationError(code, details);
}

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function compareAscii(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateVersion(value, code = "migration_through_invalid") {
  const normalized = trimText(value);
  if (!VERSION_PATTERN.test(normalized)) {
    throw migrationError(code);
  }
  return normalized;
}

function readOptionValue(argv, index, name) {
  const entry = argv[index];
  const inlinePrefix = `--${name}=`;
  if (entry.startsWith(inlinePrefix)) {
    return {
      value: entry.slice(inlinePrefix.length),
      consumed: 1,
    };
  }
  if (entry !== `--${name}`) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw migrationError(`migration_argument_${name}_missing`);
  }
  return { value, consumed: 2 };
}

export function parseProductionMigrationArguments(argv = []) {
  let apply = false;
  let explicitDryRun = false;
  let json = false;
  let through = null;
  const seen = new Set();

  for (let index = 0; index < argv.length; ) {
    const entry = argv[index];
    const throughOption = readOptionValue(argv, index, "through");
    if (throughOption) {
      if (seen.has("through")) {
        throw migrationError("migration_argument_through_duplicate");
      }
      through = validateVersion(throughOption.value);
      seen.add("through");
      index += throughOption.consumed;
      continue;
    }
    if (entry === "--apply") {
      if (seen.has("apply")) {
        throw migrationError("migration_argument_apply_duplicate");
      }
      apply = true;
      seen.add("apply");
      index += 1;
      continue;
    }
    if (entry === "--dry-run") {
      if (seen.has("dry-run")) {
        throw migrationError("migration_argument_dry_run_duplicate");
      }
      explicitDryRun = true;
      seen.add("dry-run");
      index += 1;
      continue;
    }
    if (entry === "--json") {
      if (seen.has("json")) {
        throw migrationError("migration_argument_json_duplicate");
      }
      json = true;
      seen.add("json");
      index += 1;
      continue;
    }
    throw migrationError("migration_argument_unknown", {
      argument: String(entry).slice(0, 80),
    });
  }

  if (apply && explicitDryRun) {
    throw migrationError("migration_apply_and_dry_run_conflict");
  }

  return {
    apply,
    dryRun: !apply,
    explicitDryRun,
    json,
    through,
  };
}

async function assertPlainDirectory(directoryPath, code) {
  let details;
  try {
    details = await lstat(directoryPath);
  } catch {
    throw migrationError(code);
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw migrationError(code);
  }
}

function decodeUtf8(buffer, fileName) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw migrationError("migration_source_utf8_invalid", { fileName });
  }
}

export async function discoverProductionDatabaseMigrations(input = {}) {
  const through =
    input.through === null || input.through === undefined
      ? null
      : validateVersion(input.through);
  const requestedRoot = path.resolve(input.rootDir ?? process.cwd());

  let canonicalRoot;
  try {
    canonicalRoot = await realpath(requestedRoot);
  } catch {
    throw migrationError("migration_root_unavailable");
  }

  const scriptsDirectory = path.join(requestedRoot, "scripts");
  const migrationDirectory = path.join(
    scriptsDirectory,
    "supabase-migrations",
  );
  await assertPlainDirectory(scriptsDirectory, "migration_scripts_path_invalid");
  await assertPlainDirectory(
    migrationDirectory,
    "migration_directory_invalid",
  );

  const canonicalDirectory = await realpath(migrationDirectory);
  const expectedRelative = path.join("scripts", "supabase-migrations");
  if (path.relative(canonicalRoot, canonicalDirectory) !== expectedRelative) {
    throw migrationError("migration_directory_outside_root");
  }

  const directoryEntries = await readdir(migrationDirectory, {
    withFileTypes: true,
  });
  const sqlEntries = directoryEntries.filter((entry) =>
    /\.sql$/i.test(entry.name),
  );
  if (sqlEntries.length === 0) {
    throw migrationError("migration_files_missing");
  }

  const migrations = [];
  const versions = new Set();
  for (const entry of sqlEntries) {
    const match = entry.name.match(MIGRATION_FILENAME_PATTERN);
    if (!match) {
      throw migrationError("migration_filename_invalid", {
        fileName: entry.name.slice(0, 180),
      });
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw migrationError("migration_file_type_invalid", {
        fileName: entry.name,
      });
    }

    const version = match[1];
    if (versions.has(version)) {
      throw migrationError("migration_version_duplicate", { version });
    }
    versions.add(version);

    const candidatePath = path.resolve(migrationDirectory, entry.name);
    if (path.dirname(candidatePath) !== path.resolve(migrationDirectory)) {
      throw migrationError("migration_path_invalid", {
        fileName: entry.name,
      });
    }

    const canonicalFile = await realpath(candidatePath);
    if (path.dirname(canonicalFile) !== canonicalDirectory) {
      throw migrationError("migration_file_outside_directory", {
        fileName: entry.name,
      });
    }
    const fileDetails = await lstat(canonicalFile);
    if (
      !fileDetails.isFile() ||
      fileDetails.isSymbolicLink() ||
      fileDetails.size <= 0 ||
      fileDetails.size > MAX_MIGRATION_BYTES
    ) {
      throw migrationError("migration_file_size_invalid", {
        fileName: entry.name,
      });
    }

    const source = decodeUtf8(await readFile(canonicalFile), entry.name);
    const validationErrors = validateMigrationSource(entry.name, source);
    if (validationErrors.length > 0) {
      throw migrationError("migration_source_invalid", {
        fileName: entry.name,
        validationErrors,
      });
    }
    if (/(?:^|\r?\n)\s*\\/.test(source)) {
      throw migrationError("migration_psql_meta_command_forbidden", {
        fileName: entry.name,
      });
    }

    migrations.push({
      version,
      name: match[2],
      fileName: entry.name,
      source,
    });
  }

  migrations.sort((left, right) => compareAscii(left.fileName, right.fileName));
  if (through && !versions.has(through)) {
    throw migrationError("migration_through_not_found", { through });
  }

  const selected = through
    ? migrations.filter((migration) => migration.version <= through)
    : migrations;

  return {
    directory: canonicalDirectory,
    migrations,
    selected,
    through,
  };
}

function appendOutput(current, chunk, limitBytes) {
  const next = Buffer.concat([current, Buffer.from(chunk)]);
  return next.length <= limitBytes
    ? next
    : next.subarray(next.length - limitBytes);
}

export function runMigrationCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        status: null,
        stdout: "",
        stderr: "",
        error,
        timedOut: false,
      });
      return;
    }

    const outputLimit =
      options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let settled = false;
    let timeout;
    let forceKillTimeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimeout);
      resolve({
        ...result,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
      });
    };
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk, outputLimit);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk, outputLimit);
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      finish({ status: null, error });
    });
    child.on("close", (status, signal) => {
      finish({ status, signal, error: null });
    });

    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });
}

function selectDatabaseContainer(topology, configuredName) {
  if (!topology?.available || !Array.isArray(topology.databaseCandidates)) {
    throw migrationError("migration_self_hosted_topology_unavailable");
  }

  const candidates = topology.databaseCandidates.filter(
    (candidate) =>
      candidate?.probeSucceeded === true &&
      candidate?.tools?.psql === true &&
      candidate?.tools?.databaseConfigured === true,
  );
  const requestedName = trimText(configuredName);
  let selected;
  if (requestedName) {
    if (!CONTAINER_NAME_PATTERN.test(requestedName)) {
      throw migrationError("migration_database_container_name_invalid");
    }
    selected = candidates.find(
      (candidate) => candidate.name === requestedName,
    );
    if (!selected) {
      throw migrationError("migration_database_container_unavailable");
    }
  } else {
    if (candidates.length === 0) {
      throw migrationError("migration_database_container_unavailable");
    }
    if (candidates.length !== 1) {
      throw migrationError("migration_database_container_ambiguous", {
        candidateCount: candidates.length,
      });
    }
    [selected] = candidates;
  }

  if (!CONTAINER_NAME_PATTERN.test(trimText(selected.name))) {
    throw migrationError("migration_database_container_name_invalid");
  }
  return selected;
}

export async function acquireProductionMigrationLock(
  lockPath = DEFAULT_LOCK_PATH,
) {
  const resolved = path.resolve(lockPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await open(resolved, "wx", 0o600);
    await handle.writeFile(
      `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token,
      })}\n`,
      "utf8",
    );
    await handle.sync();
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error?.code === "EEXIST") {
      throw migrationError("migration_already_running");
    }
    throw migrationError("migration_lock_failed");
  }
  await handle.close();

  let released = false;
  return {
    path: resolved,
    async release() {
      if (released) return;
      released = true;
      try {
        const payload = JSON.parse(await readFile(resolved, "utf8"));
        if (payload?.token !== token) return;
        await unlink(resolved);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw migrationError("migration_lock_release_failed");
        }
      }
    },
  };
}

function dockerPsqlArguments(containerName) {
  return [
    "exec",
    "-i",
    containerName,
    "sh",
    "-lc",
    PSQL_CONTAINER_SCRIPT,
  ];
}

async function runPsql(input) {
  let result;
  try {
    result = await input.runCommand(
      "docker",
      dockerPsqlArguments(input.containerName),
      {
        input: input.sql,
        timeoutMs: input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
        outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
        phase: input.phase,
        fileName: input.fileName,
      },
    );
  } catch {
    throw migrationError(input.errorCode, {
      fileName: input.fileName,
      reason: "command_runner_threw",
    });
  }

  if (!result || result.status !== 0 || result.timedOut) {
    throw migrationError(input.errorCode, {
      fileName: input.fileName,
      status: Number.isInteger(result?.status) ? result.status : null,
      timedOut: Boolean(result?.timedOut),
    });
  }
  return typeof result.stdout === "string" ? result.stdout : "";
}

function parseMigrationRegistryOutput(stdout) {
  const lines = String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sentinel = lines.shift();
  const match = sentinel?.match(/^__FAOLLA_REGISTRY__ (true|false)$/);
  if (!match) {
    throw migrationError("migration_registry_output_invalid");
  }

  const entries = [];
  const seen = new Set();
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw migrationError("migration_registry_output_invalid");
    }
    if (
      !entry ||
      Array.isArray(entry) ||
      typeof entry !== "object" ||
      !VERSION_PATTERN.test(entry.version) ||
      seen.has(entry.version)
    ) {
      throw migrationError("migration_registry_output_invalid");
    }
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      throw migrationError("migration_registry_name_missing", {
        version: entry.version,
      });
    }
    seen.add(entry.version);
    entries.push({
      version: entry.version,
      name: entry.name,
    });
  }
  entries.sort((left, right) => compareAscii(left.version, right.version));
  if (match[1] === "false" && entries.length > 0) {
    throw migrationError("migration_registry_output_invalid");
  }
  return {
    exists: match[1] === "true",
    entries,
    versions: entries.map((entry) => entry.version),
  };
}

function assertRegistryIsContinuousPrefix(registry, migrations) {
  const localVersions = migrations.map((migration) => migration.version);
  const localVersionSet = new Set(localVersions);
  const unknownVersion = registry.versions.find(
    (version) => !localVersionSet.has(version),
  );
  if (unknownVersion) {
    throw migrationError("migration_registry_version_unknown", {
      version: unknownVersion,
    });
  }

  const expectedPrefix = localVersions.slice(0, registry.versions.length);
  if (
    expectedPrefix.length !== registry.versions.length ||
    expectedPrefix.some(
      (version, index) => registry.versions[index] !== version,
    )
  ) {
    throw migrationError("migration_registry_not_contiguous");
  }

  for (const entry of registry.entries) {
    const localMigration = migrations.find(
      (migration) => migration.version === entry.version,
    );
    if (entry.name !== localMigration.name) {
      throw migrationError("migration_registry_name_mismatch", {
        version: entry.version,
        registeredName: entry.name,
        localName: localMigration.name,
      });
    }
  }
}

function wrapMigrationWithAdvisoryLock(source) {
  return [
    MIGRATION_ADVISORY_LOCK_SQL,
    source.replace(/\s+$/, ""),
    MIGRATION_ADVISORY_UNLOCK_SQL,
    "",
  ].join("\n");
}

async function queryMigrationRegistry(input) {
  const stdout = await runPsql({
    ...input,
    sql: REGISTRY_QUERY_SQL,
    phase: "registry_query",
    errorCode: "migration_registry_query_failed",
  });
  return parseMigrationRegistryOutput(stdout);
}

function reportMigration(migration) {
  return {
    version: migration.version,
    name: migration.name,
    fileName: migration.fileName,
  };
}

export async function applyProductionDatabaseMigrations(input = {}) {
  const apply = input.apply === true;
  if (apply && input.dryRun === true) {
    throw migrationError("migration_apply_and_dry_run_conflict");
  }

  const discovery = await discoverProductionDatabaseMigrations({
    rootDir: input.rootDir,
    through: input.through,
  });
  const topology =
    input.selfHostedTopology ??
    (input.inspectTopology ?? inspectSelfHostedSupabaseTopology)();
  const container = selectDatabaseContainer(
    topology,
    input.containerName ??
      (input.env ?? process.env).FAOLLA_DATABASE_CONTAINER,
  );
  const commandRunner = input.runCommand ?? runMigrationCommand;
  const lock = await acquireProductionMigrationLock(
    input.lockPath ?? DEFAULT_LOCK_PATH,
  );

  try {
    let registry = await queryMigrationRegistry({
      containerName: container.name,
      runCommand: commandRunner,
      timeoutMs: input.commandTimeoutMs,
    });
    assertRegistryIsContinuousPrefix(registry, discovery.migrations);
    const registeredVersions = new Set(registry.versions);
    const pending = discovery.selected.filter(
      (migration) => !registeredVersions.has(migration.version),
    );

    const baseReport = {
      schemaVersion: 1,
      mode: apply ? "apply" : "dry_run",
      databaseContainer: container.name,
      through: discovery.through,
      effectiveThrough:
        discovery.selected.at(-1)?.version ?? discovery.through ?? null,
      registryExists: registry.exists,
      discovered: discovery.migrations.map(reportMigration),
      selected: discovery.selected.map(reportMigration),
      registeredVersions: registry.versions,
      registered: registry.entries,
      pending: pending.map(reportMigration),
      executed: [],
    };

    if (!apply) {
      return {
        ...baseReport,
        status: "dry_run",
      };
    }

    const executed = [];
    for (const migration of pending) {
      await runPsql({
        containerName: container.name,
        runCommand: commandRunner,
        timeoutMs: input.commandTimeoutMs,
        sql: wrapMigrationWithAdvisoryLock(migration.source),
        phase: "migration_apply",
        fileName: migration.fileName,
        errorCode: "migration_apply_failed",
      });

      registry = await queryMigrationRegistry({
        containerName: container.name,
        runCommand: commandRunner,
        timeoutMs: input.commandTimeoutMs,
      });
      assertRegistryIsContinuousPrefix(registry, discovery.migrations);
      if (!registry.versions.includes(migration.version)) {
        throw migrationError("migration_registration_missing", {
          fileName: migration.fileName,
          version: migration.version,
        });
      }
      executed.push(reportMigration(migration));
    }

    return {
      ...baseReport,
      status: executed.length > 0 ? "applied" : "up_to_date",
      registryExists: registry.exists,
      registeredVersions: registry.versions,
      registered: registry.entries,
      executed,
    };
  } finally {
    await lock.release();
  }
}

function printTextReport(report, write) {
  write(
    `[database-migrations] ${report.status.toUpperCase()} ` +
      `mode=${report.mode} container=${report.databaseContainer}\n`,
  );
  write(
    `[database-migrations] selected=${report.selected.length} ` +
      `pending=${report.pending.length} executed=${report.executed.length} ` +
      `through=${report.effectiveThrough ?? "none"}\n`,
  );
}

export async function runProductionMigrationCli(input = {}) {
  const argv = input.argv ?? process.argv.slice(2);
  const writeStdout =
    input.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr =
    input.writeStderr ?? ((value) => process.stderr.write(value));
  const wantsJson = argv.includes("--json");

  try {
    const options = parseProductionMigrationArguments(argv);
    const execute = input.execute ?? applyProductionDatabaseMigrations;
    const report = await execute({
      apply: options.apply,
      dryRun: options.dryRun,
      through: options.through,
    });
    if (options.json) {
      writeStdout(`${JSON.stringify({ ok: true, ...report })}\n`);
    } else {
      printTextReport(report, writeStdout);
    }
    return 0;
  } catch (error) {
    const code =
      error instanceof ProductionDatabaseMigrationError
        ? error.code
        : "production_database_migration_failed";
    if (wantsJson) {
      writeStderr(`${JSON.stringify({ ok: false, error: code })}\n`);
    } else {
      writeStderr(`[database-migrations] ERROR ${code}\n`);
    }
    return 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  process.exitCode = await runProductionMigrationCli();
}
