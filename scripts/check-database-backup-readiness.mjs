import { spawnSync } from "node:child_process";
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
];

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
  const tools = Object.fromEntries(
    TOOL_NAMES.map((name) => [name, Boolean(probeCommand(name))]),
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
  if (!databaseUrlName) backupBlockers.push("database_connection_missing");
  if (!tools.supabase) backupBlockers.push("supabase_cli_missing");
  if (!tools.docker) backupBlockers.push("docker_missing");
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
  if (postgresClientReady && !supabaseCliReady) {
    warnings.push("raw_postgres_tools_available_but_supabase_cli_required");
  }
  if (!isEnabled(env.FAOLLA_STORAGE_BACKUP_ENABLED)) {
    warnings.push("storage_object_backup_not_configured");
  }
  if (
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
      dumpStrategy: supabaseCliReady ? "supabase_cli" : "unavailable",
      encryptionStrategy,
      offsiteStrategy,
      storageObjectBackup: isEnabled(env.FAOLLA_STORAGE_BACKUP_ENABLED),
      providerBackupVerification: Boolean(
        trimText(env.SUPABASE_ACCESS_TOKEN) &&
          trimText(env.SUPABASE_PROJECT_REF),
      ),
    },
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
  const report = buildDatabaseBackupReadinessReport();
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
