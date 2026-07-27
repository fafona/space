import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DATABASE_URL_NAMES = [
  "FAOLLA_DATABASE_URL",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL",
];

const RESTORE_DATABASE_URL_NAMES = [
  "FAOLLA_RESTORE_DATABASE_URL",
  "SUPABASE_RESTORE_DB_URL",
];

const TOOL_NAMES = [
  "supabase",
  "docker",
  "pg_dump",
  "pg_restore",
  "psql",
  "age",
  "openssl",
  "rclone",
  "aws",
  "tar",
];

const DOCKER_COMMAND_TIMEOUT_MS = 15_000;
const DOCKER_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const DATABASE_CONTAINER_PATTERN =
  /(?:^|[/:_.-])(postgres|supabase[-_.]?db|db)(?:$|[/:_.-])/i;
const STORAGE_CONTAINER_PATTERN =
  /(?:^|[/:_.-])(storage|storage-api|supabase[-_.]?storage)(?:$|[/:_.-])/i;

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(trimText(value).toLowerCase());
}

function configuredName(env, names) {
  return names.find((name) => Boolean(trimText(env[name]))) ?? null;
}

function commandAvailable(name) {
  const result = spawnSync("sh", ["-lc", `command -v ${name}`], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

function runDockerCommand(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: DOCKER_COMMAND_TIMEOUT_MS,
    maxBuffer: DOCKER_OUTPUT_LIMIT_BYTES,
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

function safeIdentifier(value) {
  return trimText(value).slice(0, 160);
}

function parseBooleanProbe(stdout, names) {
  const values = Object.fromEntries(names.map((name) => [name, false]));
  for (const line of trimText(stdout).split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator);
    if (!Object.hasOwn(values, name)) continue;
    values[name] = line.slice(separator + 1) === "1";
  }
  return values;
}

function inspectContainerMounts(name, runDocker) {
  const result = runDocker([
    "inspect",
    "--format",
    "{{json .Mounts}}",
    name,
  ]);
  if (!result.ok) return [];
  try {
    const mounts = JSON.parse(trimText(result.stdout));
    if (!Array.isArray(mounts)) return [];
    return mounts
      .map((mount) => ({
        type: ["bind", "volume", "tmpfs"].includes(mount?.Type)
          ? mount.Type
          : "other",
        destination: safeIdentifier(mount?.Destination),
        readOnly: mount?.RW === false,
      }))
      .filter((mount) => mount.destination);
  } catch {
    return [];
  }
}

function inspectDatabaseContainer(container, runDocker) {
  const names = [
    "pg_dump",
    "pg_dumpall",
    "pg_restore",
    "psql",
    "pg_isready",
    "databaseConfigured",
    "userConfigured",
  ];
  const probeScript = [
    'for tool in pg_dump pg_dumpall pg_restore psql pg_isready; do',
    '  if command -v "$tool" >/dev/null 2>&1; then',
    '    printf "%s=1\\n" "$tool"',
    "  else",
    '    printf "%s=0\\n" "$tool"',
    "  fi",
    "done",
    '[ -n "${POSTGRES_DB:-}" ] && printf "databaseConfigured=1\\n" || printf "databaseConfigured=0\\n"',
    '[ -n "${POSTGRES_USER:-}" ] && printf "userConfigured=1\\n" || printf "userConfigured=0\\n"',
  ].join("\n");
  const result = runDocker([
    "exec",
    container.name,
    "sh",
    "-lc",
    probeScript,
  ]);
  return {
    name: container.name,
    image: container.image,
    tools: result.ok
      ? parseBooleanProbe(result.stdout, names)
      : parseBooleanProbe("", names),
    probeSucceeded: result.ok,
    mounts: inspectContainerMounts(container.name, runDocker),
  };
}

function inspectStorageContainer(container, runDocker) {
  const probeScript = [
    'case "${STORAGE_BACKEND:-}" in',
    '  file) printf "backend=file\\n" ;;',
    '  s3) printf "backend=s3\\n" ;;',
    '  "") printf "backend=unspecified\\n" ;;',
    '  *) printf "backend=other\\n" ;;',
    "esac",
    '[ -n "${GLOBAL_S3_BUCKET:-}" ] && printf "bucketConfigured=1\\n" || printf "bucketConfigured=0\\n"',
  ].join("\n");
  const result = runDocker([
    "exec",
    container.name,
    "sh",
    "-lc",
    probeScript,
  ]);
  let backend = "unknown";
  let bucketConfigured = false;
  if (result.ok) {
    for (const line of trimText(result.stdout).split(/\r?\n/)) {
      if (/^backend=(file|s3|unspecified|other)$/.test(line)) {
        backend = line.slice("backend=".length);
      }
      if (line === "bucketConfigured=1") bucketConfigured = true;
    }
  }
  return {
    name: container.name,
    image: container.image,
    backend,
    bucketConfigured,
    probeSucceeded: result.ok,
    mounts: inspectContainerMounts(container.name, runDocker),
  };
}

export function inspectSelfHostedSupabaseTopology(input = {}) {
  const runDocker = input.runDocker ?? runDockerCommand;
  const listResult = runDocker(["ps", "--format", "{{json .}}"]);
  if (!listResult.ok) {
    return {
      available: false,
      containerCount: 0,
      databaseCandidates: [],
      storageCandidates: [],
      error: "docker_ps_failed",
    };
  }

  const containers = [];
  for (const line of trimText(listResult.stdout).split(/\r?\n/)) {
    if (!line) continue;
    try {
      const item = JSON.parse(line);
      const name = safeIdentifier(item.Names);
      const image = safeIdentifier(item.Image);
      if (name && image) containers.push({ name, image });
    } catch {
      continue;
    }
  }

  const databaseCandidates = containers
    .filter((container) =>
      DATABASE_CONTAINER_PATTERN.test(`${container.name}/${container.image}`),
    )
    .map((container) => inspectDatabaseContainer(container, runDocker));
  const storageCandidates = containers
    .filter((container) =>
      STORAGE_CONTAINER_PATTERN.test(`${container.name}/${container.image}`),
    )
    .map((container) => inspectStorageContainer(container, runDocker));

  return {
    available: true,
    containerCount: containers.length,
    databaseCandidates,
    storageCandidates,
    error: null,
  };
}

function localSupabaseAvailable() {
  const localName =
    process.platform === "win32" ? "supabase.exe" : "supabase";
  return existsSync(path.resolve("node_modules", ".bin", localName));
}

function databaseIdentity(value) {
  try {
    const parsed = new URL(trimText(value));
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) return "";
    return [
      parsed.hostname.toLowerCase(),
      parsed.port || "5432",
      parsed.username.toLowerCase(),
      parsed.pathname.replace(/\/+$/, "").toLowerCase(),
    ].join("|");
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values)];
}

export function buildDatabaseBackupReadinessReport(input = {}) {
  const env = input.env ?? process.env;
  const probeCommand = input.probeCommand ?? commandAvailable;
  const selfHostedTopology = input.selfHostedTopology ?? {
    available: false,
    containerCount: 0,
    databaseCandidates: [],
    storageCandidates: [],
    error: null,
  };
  const tools = Object.fromEntries(
    TOOL_NAMES.map((name) => [name, Boolean(probeCommand(name))]),
  );
  tools.supabase =
    tools.supabase ||
    Boolean(
      input.localSupabaseAvailable === undefined
        ? localSupabaseAvailable()
        : input.localSupabaseAvailable,
    );

  const databaseUrlName = configuredName(env, DATABASE_URL_NAMES);
  const restoreDatabaseUrlName = configuredName(
    env,
    RESTORE_DATABASE_URL_NAMES,
  );
  const databaseIdentityValue = databaseUrlName
    ? databaseIdentity(env[databaseUrlName])
    : "";
  const restoreIdentityValue = restoreDatabaseUrlName
    ? databaseIdentity(env[restoreDatabaseUrlName])
    : "";
  const restoreTargetIsolated = Boolean(
    databaseIdentityValue &&
      restoreIdentityValue &&
      databaseIdentityValue !== restoreIdentityValue,
  );

  const supabaseCliReady = tools.supabase && tools.docker;
  const postgresClientReady = tools.pg_dump && tools.pg_restore && tools.psql;
  const databaseContainer =
    selfHostedTopology.databaseCandidates.find(
      (candidate) =>
        candidate.probeSucceeded &&
        candidate.tools.pg_dump &&
        candidate.tools.pg_dumpall &&
        candidate.tools.psql,
    ) ?? null;
  const dockerDatabaseReady = tools.docker && Boolean(databaseContainer);
  const dumpStrategy = dockerDatabaseReady
    ? "docker_exec_postgres"
    : databaseUrlName && supabaseCliReady
      ? "supabase_cli"
      : "unavailable";
  const passphraseAvailable =
    isEnabled(env.FAOLLA_BACKUP_PASSPHRASE_AVAILABLE) ||
    Boolean(trimText(env.FAOLLA_BACKUP_ENCRYPTION_PASSPHRASE));
  const encryptionStrategy =
    tools.age && trimText(env.FAOLLA_BACKUP_AGE_RECIPIENT)
      ? "age"
      : tools.openssl && passphraseAvailable
        ? "openssl"
        : "unavailable";
  const offsiteStrategy = isEnabled(env.FAOLLA_BACKUP_ARTIFACT_TRANSPORT)
    ? "github_artifact"
    : tools.rclone && trimText(env.FAOLLA_BACKUP_RCLONE_REMOTE)
      ? "rclone"
      : tools.aws && trimText(env.FAOLLA_BACKUP_S3_URI)
        ? "s3"
        : "unavailable";

  const backupBlockers = [];
  if (dumpStrategy === "unavailable") {
    if (!databaseUrlName && selfHostedTopology.databaseCandidates.length === 0) {
      backupBlockers.push("database_connection_missing");
    }
    if (
      selfHostedTopology.databaseCandidates.length > 0 &&
      !databaseContainer
    ) {
      backupBlockers.push("database_container_tools_missing");
    }
    if (databaseUrlName && !tools.supabase) {
      backupBlockers.push("supabase_cli_missing");
    }
    if (!tools.docker && !databaseUrlName) {
      backupBlockers.push("docker_missing");
    }
  }
  if (!tools.tar) backupBlockers.push("tar_missing");
  if (encryptionStrategy === "unavailable") {
    backupBlockers.push("backup_encryption_missing");
  }
  if (offsiteStrategy === "unavailable") {
    backupBlockers.push("offsite_transport_missing");
  }

  const recoveryBlockers = [];
  if (!restoreDatabaseUrlName) {
    recoveryBlockers.push("restore_database_connection_missing");
  } else if (!restoreTargetIsolated) {
    recoveryBlockers.push("restore_target_not_isolated");
  }
  if (!tools.psql) recoveryBlockers.push("psql_missing");

  const warnings = [];
  if (
    postgresClientReady &&
    !supabaseCliReady &&
    dumpStrategy === "unavailable"
  ) {
    warnings.push("raw_postgres_tools_available_but_supabase_cli_required");
  }
  const persistentStorageMountDetected =
    selfHostedTopology.storageCandidates.some((candidate) =>
      candidate.mounts.some(
        (mount) =>
          ["bind", "volume"].includes(mount.type) && !mount.readOnly,
      ),
    );
  if (!isEnabled(env.FAOLLA_STORAGE_BACKUP_ENABLED)) {
    warnings.push("storage_object_backup_not_configured");
  }
  if (
    selfHostedTopology.storageCandidates.some(
      (candidate) =>
        ["file", "unspecified"].includes(candidate.backend) &&
        !candidate.mounts.some(
          (mount) =>
            ["bind", "volume"].includes(mount.type) && !mount.readOnly,
        ),
    )
  ) {
    warnings.push("storage_persistence_not_detected");
  }
  if (selfHostedTopology.available) {
    warnings.push("self_hosted_pitr_not_verified");
  } else if (
    !trimText(env.SUPABASE_ACCESS_TOKEN) ||
    !trimText(env.SUPABASE_PROJECT_REF)
  ) {
    warnings.push("provider_backup_status_not_automatically_verified");
  }

  const status =
    backupBlockers.length > 0
      ? "blocked"
      : recoveryBlockers.length > 0 || warnings.length > 0
        ? "degraded"
        : "ready";

  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    status,
    backupReady: backupBlockers.length === 0,
    recoveryRehearsalReady: recoveryBlockers.length === 0,
    configuration: {
      databaseConnection: databaseUrlName,
      restoreDatabaseConnection: restoreDatabaseUrlName,
      restoreTargetIsolated,
      dumpStrategy,
      encryptionStrategy,
      offsiteStrategy,
      storageObjectBackup: isEnabled(env.FAOLLA_STORAGE_BACKUP_ENABLED),
      persistentStorageMountDetected,
      providerBackupVerification: Boolean(
        trimText(env.SUPABASE_ACCESS_TOKEN) &&
          trimText(env.SUPABASE_PROJECT_REF),
      ),
    },
    selfHostedTopology,
    tools,
    blockers: unique(backupBlockers),
    recoveryBlockers: unique(recoveryBlockers),
    warnings: unique(warnings),
  };
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function printSummary(report) {
  console.log(
    `[database-backup-readiness] ${report.status.toUpperCase()} ${report.checkedAt}`,
  );
  if (report.selfHostedTopology.available) {
    console.log(
      `[database-backup-readiness] selfHostedContainers=${report.selfHostedTopology.containerCount} ` +
        `databaseCandidates=${report.selfHostedTopology.databaseCandidates.length} ` +
        `storageCandidates=${report.selfHostedTopology.storageCandidates.length}`,
    );
  }
  console.log(
    `[database-backup-readiness] backupReady=${report.backupReady} ` +
      `recoveryRehearsalReady=${report.recoveryRehearsalReady}`,
  );
  console.log(
    `[database-backup-readiness] dump=${report.configuration.dumpStrategy} ` +
      `encryption=${report.configuration.encryptionStrategy} ` +
      `offsite=${report.configuration.offsiteStrategy}`,
  );
  if (report.blockers.length > 0) {
    console.log(
      `[database-backup-readiness] blockers=${report.blockers.join(",")}`,
    );
  }
  if (report.recoveryBlockers.length > 0) {
    console.log(
      `[database-backup-readiness] recoveryBlockers=${report.recoveryBlockers.join(",")}`,
    );
  }
  if (report.warnings.length > 0) {
    console.log(
      `[database-backup-readiness] warnings=${report.warnings.join(",")}`,
    );
  }
}

function main() {
  const dockerAvailable = commandAvailable("docker");
  const selfHostedTopology = dockerAvailable
    ? inspectSelfHostedSupabaseTopology()
    : undefined;
  const report = buildDatabaseBackupReadinessReport({
    selfHostedTopology,
  });
  printSummary(report);
  if (hasFlag("json")) console.log(JSON.stringify(report));
  if (hasFlag("fail-on-blocked") && report.status === "blocked") {
    process.exitCode = 1;
  }
  if (hasFlag("fail-on-degraded") && report.status !== "ready") {
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) main();
