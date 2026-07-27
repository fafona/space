import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  statfsSync,
  statSync,
} from "node:fs";
import { pathToFileURL } from "node:url";

const GIB = 1024 ** 3;
const DEFAULT_CONFIG_FILE = "/etc/faolla/pitr.env";
const DEFAULT_WALG_CONFIG_PATH =
  "/etc/postgresql-custom/wal-g.json";
const DEFAULT_WALG_BINARY = "wal-g";
const DEFAULT_RESTORE_EVIDENCE_FILE =
  "/var/lib/faolla-pitr/restore-rehearsal-evidence.json";
const DEFAULT_DATABASE_DISK_PATH =
  "/opt/supabase/docker/volumes/db/data";
const DEFAULT_MAX_ARCHIVE_AGE_SECONDS = 900;
const DEFAULT_MAX_BASE_BACKUP_AGE_HOURS = 24 * 8;
const DEFAULT_MAX_RESTORE_REHEARSAL_AGE_HOURS = 24 * 35;
const DEFAULT_MINIMUM_AVAILABLE_BYTES = 8 * GIB;
const DEFAULT_MINIMUM_AVAILABLE_PERCENT = 20;
const DEFAULT_MAXIMUM_READY_WAL_FILES = 4;
const RECOMMENDED_DISK_BYTES = 80 * GIB;
const COMMAND_TIMEOUT_MS = 30_000;
const COMMAND_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const DATABASE_CONTAINER_PATTERN =
  /(?:^|[/:_.-])(postgres|supabase[-_.]?db|db)(?:$|[/:_.-])/i;

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(trimText(value).toLowerCase());
}

function unique(values) {
  return [...new Set(values)];
}

function boundedNumber(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < minimum) return fallback;
  return Math.min(maximum, numeric);
}

function safeIdentifier(value) {
  return trimText(value).slice(0, 160);
}

function safeAbsolutePath(value, fallback) {
  const normalized = trimText(value) || fallback;
  return /^\/[A-Za-z0-9_./-]+$/.test(normalized)
    ? normalized
    : fallback;
}

function safeCommandPath(value, fallback) {
  const normalized = trimText(value) || fallback;
  return /^(?:[A-Za-z0-9_.-]+|\/[A-Za-z0-9_./-]+)$/.test(normalized)
    ? normalized
    : fallback;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_OUTPUT_LIMIT_BYTES,
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

function parseKeyValueLines(stdout) {
  const values = {};
  for (const line of trimText(stdout).split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    if (!/^[a-z][a-z0-9_.]*$/i.test(key)) continue;
    values[key] = line.slice(separator + 1);
  }
  return values;
}

function integerValue(value) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function epochIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function timestampAgeSeconds(value, now) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((now.getTime() - timestamp) / 1000));
}

function parseDockerContainers(stdout) {
  const containers = [];
  for (const line of trimText(stdout).split(/\r?\n/)) {
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
  return containers;
}

function findDatabaseContainer(containers) {
  return (
    containers.find((container) => container.name === "supabase-db") ??
    containers.find((container) =>
      DATABASE_CONTAINER_PATTERN.test(`${container.name}/${container.image}`),
    ) ??
    null
  );
}

const POSTGRES_PROBE_SCRIPT = [
  "set -eu",
  'db="${POSTGRES_DB:-postgres}"',
  'user="${POSTGRES_USER:-postgres}"',
  'pgdata="${PGDATA:-/var/lib/postgresql/data}"',
  'walg_config="${FAOLLA_PITR_WALG_CONFIG_PATH:-/etc/postgresql-custom/wal-g.json}"',
  'walg_binary="${FAOLLA_PITR_WALG_BINARY:-wal-g}"',
  "",
  "psql -X -v ON_ERROR_STOP=1 -U \"$user\" -d \"$db\" -At <<'SQL'",
  "SELECT 'setting.wal_level=' || setting",
  "FROM pg_settings WHERE name = 'wal_level';",
  "SELECT 'setting.archive_mode=' || setting",
  "FROM pg_settings WHERE name = 'archive_mode';",
  "SELECT 'setting.archive_timeout_seconds=' || setting",
  "FROM pg_settings WHERE name = 'archive_timeout';",
  "SELECT 'setting.archive_command_configured=' ||",
  "  CASE WHEN setting <> '' AND setting <> '(disabled)' THEN '1' ELSE '0' END",
  "FROM pg_settings WHERE name = 'archive_command';",
  "SELECT 'setting.archive_library_configured=' ||",
  "  CASE WHEN setting <> '' THEN '1' ELSE '0' END",
  "FROM pg_settings WHERE name = 'archive_library';",
  "SELECT 'archiver.archived_count=' || archived_count::text",
  "FROM pg_stat_archiver;",
  "SELECT 'archiver.failed_count=' || failed_count::text",
  "FROM pg_stat_archiver;",
  "SELECT 'archiver.last_archived_epoch=' ||",
  "  COALESCE(floor(extract(epoch FROM last_archived_time))::bigint::text, '')",
  "FROM pg_stat_archiver;",
  "SELECT 'archiver.last_failed_epoch=' ||",
  "  COALESCE(floor(extract(epoch FROM last_failed_time))::bigint::text, '')",
  "FROM pg_stat_archiver;",
  "SQL",
  "",
  "wal_kib=\"$(du -sk \"$pgdata/pg_wal\" 2>/dev/null | awk '{print $1}')\"",
  "printf 'wal.bytes=%s\\n' \"$(( ${wal_kib:-0} * 1024 ))\"",
  "printf 'wal.ready_count=%s\\n' \\",
  "  \"$(find \"$pgdata/pg_wal/archive_status\" -maxdepth 1 -type f -name '*.ready' 2>/dev/null | wc -l | tr -d ' ')\"",
  "printf 'wal.done_count=%s\\n' \\",
  "  \"$(find \"$pgdata/pg_wal/archive_status\" -maxdepth 1 -type f -name '*.done' 2>/dev/null | wc -l | tr -d ' ')\"",
  "",
  "if { [ \"${walg_binary#/}\" != \"$walg_binary\" ] && [ -x \"$walg_binary\" ]; } ||",
  "  command -v \"$walg_binary\" >/dev/null 2>&1; then",
  "  printf 'tool.wal_g=1\\n'",
  "else",
  "  printf 'tool.wal_g=0\\n'",
  "fi",
  "",
  "if [ -r \"$walg_config\" ]; then",
  "  printf 'tool.wal_g_config=1\\n'",
  "  printf 'tool.wal_g_config_mode=%s\\n' \"$(stat -c '%a' \"$walg_config\" 2>/dev/null || true)\"",
  "else",
  "  printf 'tool.wal_g_config=0\\n'",
  "  printf 'tool.wal_g_config_mode=\\n'",
  "fi",
].join("\n");

function parseRepositoryBackups(stdout) {
  try {
    const parsed = JSON.parse(trimText(stdout));
    if (!Array.isArray(parsed)) return null;
    const backups = parsed
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null;
        }
        const timestampCandidates = [
          item.finish_time,
          item.start_time,
          item.modified,
          item.time,
          item.last_modified,
        ];
        const timestamp = timestampCandidates
          .map((value) => Date.parse(trimText(value)))
          .find(Number.isFinite);
        return Number.isFinite(timestamp) ? timestamp : null;
      })
      .filter(Number.isFinite)
      .sort((left, right) => right - left);
    return {
      count: parsed.length,
      latestBackupAt:
        backups.length > 0 ? new Date(backups[0]).toISOString() : null,
    };
  } catch {
    return null;
  }
}

function defaultDiskProbe(targetPath) {
  try {
    const stats = statfsSync(targetPath);
    const blockSize = Number(stats.bsize);
    const totalBytes = blockSize * Number(stats.blocks);
    const availableBytes = blockSize * Number(stats.bavail);
    if (
      !Number.isFinite(totalBytes) ||
      !Number.isFinite(availableBytes) ||
      totalBytes <= 0
    ) {
      return null;
    }
    return {
      totalBytes,
      availableBytes,
      availablePercent: Number(
        ((availableBytes / totalBytes) * 100).toFixed(1),
      ),
    };
  } catch {
    return null;
  }
}

export function inspectProductionPitrState(input = {}) {
  const env = input.env ?? process.env;
  const execute = input.runCommand ?? runCommand;
  const diskProbe = input.diskProbe ?? defaultDiskProbe;
  const walgConfigPath = safeAbsolutePath(
    env.FAOLLA_PITR_WALG_CONFIG_PATH,
    DEFAULT_WALG_CONFIG_PATH,
  );
  const walgBinary = safeCommandPath(
    env.FAOLLA_PITR_WALG_BINARY,
    DEFAULT_WALG_BINARY,
  );
  const diskPath = safeAbsolutePath(
    env.FAOLLA_PITR_DATABASE_DISK_PATH,
    DEFAULT_DATABASE_DISK_PATH,
  );
  const listResult = execute("docker", [
    "ps",
    "--format",
    "{{json .}}",
  ]);
  if (!listResult.ok) {
    return {
      dockerAvailable: false,
      databaseContainer: null,
      databaseProbeSucceeded: false,
      settings: {},
      archiver: {},
      wal: {},
      walG: {},
      repository: {},
      disk: diskProbe(diskPath),
    };
  }

  const databaseContainer = findDatabaseContainer(
    parseDockerContainers(listResult.stdout),
  );
  if (!databaseContainer) {
    return {
      dockerAvailable: true,
      databaseContainer: null,
      databaseProbeSucceeded: false,
      settings: {},
      archiver: {},
      wal: {},
      walG: {},
      repository: {},
      disk: diskProbe(diskPath),
    };
  }

  const probeResult = execute("docker", [
    "exec",
    "-e",
    `FAOLLA_PITR_WALG_CONFIG_PATH=${walgConfigPath}`,
    "-e",
    `FAOLLA_PITR_WALG_BINARY=${walgBinary}`,
    databaseContainer.name,
    "sh",
    "-lc",
    POSTGRES_PROBE_SCRIPT,
  ]);
  const values = probeResult.ok
    ? parseKeyValueLines(probeResult.stdout)
    : {};
  const walGAvailable = values["tool.wal_g"] === "1";
  const walGConfigPresent = values["tool.wal_g_config"] === "1";
  let repository = {
    probeSucceeded: false,
    backupCount: 0,
    latestBackupAt: null,
  };
  if (walGAvailable && walGConfigPresent) {
    const repositoryResult = execute("docker", [
      "exec",
      databaseContainer.name,
      walgBinary,
      "--config",
      walgConfigPath,
      "backup-list",
      "--json",
    ]);
    const parsed = repositoryResult.ok
      ? parseRepositoryBackups(repositoryResult.stdout)
      : null;
    if (parsed) {
      repository = {
        probeSucceeded: true,
        backupCount: parsed.count,
        latestBackupAt: parsed.latestBackupAt,
      };
    }
  }

  return {
    dockerAvailable: true,
    databaseContainer,
    databaseProbeSucceeded: probeResult.ok,
    settings: {
      walLevel: trimText(values["setting.wal_level"]) || null,
      archiveMode: trimText(values["setting.archive_mode"]) || null,
      archiveTimeoutSeconds: integerValue(
        values["setting.archive_timeout_seconds"],
      ),
      archiveCommandConfigured:
        values["setting.archive_command_configured"] === "1",
      archiveLibraryConfigured:
        values["setting.archive_library_configured"] === "1",
    },
    archiver: {
      archivedCount: integerValue(values["archiver.archived_count"]),
      failedCount: integerValue(values["archiver.failed_count"]),
      lastArchivedAt: epochIso(values["archiver.last_archived_epoch"]),
      lastFailedAt: epochIso(values["archiver.last_failed_epoch"]),
    },
    wal: {
      bytes: integerValue(values["wal.bytes"]),
      readyCount: integerValue(values["wal.ready_count"]),
      doneCount: integerValue(values["wal.done_count"]),
    },
    walG: {
      available: walGAvailable,
      configPresent: walGConfigPresent,
      configMode: trimText(values["tool.wal_g_config_mode"]) || null,
    },
    repository,
    disk: diskProbe(diskPath),
  };
}

function permissionModeSafe(mode) {
  if (!mode || !/^[0-7]{3,4}$/.test(mode)) return false;
  const numeric = Number.parseInt(mode.slice(-3), 8);
  return (numeric & 0o077) === 0;
}

export function inspectPitrConfigFile(filePath) {
  try {
    if (!existsSync(filePath)) {
      return { exists: false, securePermissions: false, mode: null };
    }
    const mode = (statSync(filePath).mode & 0o777)
      .toString(8)
      .padStart(3, "0");
    return {
      exists: true,
      securePermissions: permissionModeSafe(mode),
      mode,
    };
  } catch {
    return { exists: false, securePermissions: false, mode: null };
  }
}

export function readRestoreRehearsalEvidence(filePath) {
  try {
    if (!existsSync(filePath)) {
      return {
        present: false,
        valid: false,
        completedAt: null,
        isolationVerified: false,
      };
    }
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const completedTimestamp = Date.parse(trimText(parsed?.completedAt));
    const isolationVerified =
      parsed?.isolation === "ephemeral_docker_no_network";
    const valid =
      parsed?.schemaVersion === 1 &&
      parsed?.status === "verified" &&
      Number.isFinite(completedTimestamp) &&
      isolationVerified;
    return {
      present: true,
      valid,
      completedAt: valid
        ? new Date(completedTimestamp).toISOString()
        : null,
      isolationVerified,
    };
  } catch {
    return {
      present: true,
      valid: false,
      completedAt: null,
      isolationVerified: false,
    };
  }
}

function modeFromState(state) {
  return trimText(state?.walG?.configMode);
}

function normalizedState(state = {}) {
  return {
    dockerAvailable: state.dockerAvailable === true,
    databaseContainer: state.databaseContainer
      ? {
          name: safeIdentifier(state.databaseContainer.name),
          image: safeIdentifier(state.databaseContainer.image),
        }
      : null,
    databaseProbeSucceeded: state.databaseProbeSucceeded === true,
    settings: {
      walLevel: trimText(state.settings?.walLevel) || null,
      archiveMode: trimText(state.settings?.archiveMode) || null,
      archiveTimeoutSeconds: integerValue(
        state.settings?.archiveTimeoutSeconds,
      ),
      archiveCommandConfigured:
        state.settings?.archiveCommandConfigured === true,
      archiveLibraryConfigured:
        state.settings?.archiveLibraryConfigured === true,
    },
    archiver: {
      archivedCount: integerValue(state.archiver?.archivedCount),
      failedCount: integerValue(state.archiver?.failedCount),
      lastArchivedAt: trimText(state.archiver?.lastArchivedAt) || null,
      lastFailedAt: trimText(state.archiver?.lastFailedAt) || null,
    },
    wal: {
      bytes: integerValue(state.wal?.bytes),
      readyCount: integerValue(state.wal?.readyCount),
      doneCount: integerValue(state.wal?.doneCount),
    },
    walG: {
      available: state.walG?.available === true,
      configPresent: state.walG?.configPresent === true,
      configPermissionsSecure: permissionModeSafe(modeFromState(state)),
    },
    repository: {
      probeSucceeded: state.repository?.probeSucceeded === true,
      backupCount: integerValue(state.repository?.backupCount) ?? 0,
      latestBackupAt:
        trimText(state.repository?.latestBackupAt) || null,
    },
    disk:
      state.disk &&
      Number.isFinite(state.disk.totalBytes) &&
      Number.isFinite(state.disk.availableBytes) &&
      Number.isFinite(state.disk.availablePercent)
        ? {
            totalBytes: Math.max(0, Math.round(state.disk.totalBytes)),
            availableBytes: Math.max(
              0,
              Math.round(state.disk.availableBytes),
            ),
            availablePercent: Math.max(
              0,
              Number(state.disk.availablePercent.toFixed(1)),
            ),
          }
        : null,
  };
}

export function buildProductionPitrReadinessReport(input = {}) {
  const env = input.env ?? process.env;
  const now = input.now instanceof Date ? input.now : new Date();
  const state = normalizedState(input.state);
  const configFile = input.configFile ?? {
    exists: false,
    securePermissions: false,
    mode: null,
  };
  const restoreEvidence = input.restoreEvidence ?? {
    present: false,
    valid: false,
    completedAt: null,
    isolationVerified: false,
  };
  const maximumArchiveAgeSeconds = boundedNumber(
    env.FAOLLA_PITR_MAX_ARCHIVE_AGE_SECONDS,
    DEFAULT_MAX_ARCHIVE_AGE_SECONDS,
    60,
    86_400,
  );
  const maximumBaseBackupAgeHours = boundedNumber(
    env.FAOLLA_PITR_MAX_BASE_BACKUP_AGE_HOURS,
    DEFAULT_MAX_BASE_BACKUP_AGE_HOURS,
    1,
    24 * 90,
  );
  const maximumRestoreRehearsalAgeHours = boundedNumber(
    env.FAOLLA_PITR_MAX_RESTORE_REHEARSAL_AGE_HOURS,
    DEFAULT_MAX_RESTORE_REHEARSAL_AGE_HOURS,
    1,
    24 * 365,
  );
  const minimumAvailableBytes = boundedNumber(
    env.FAOLLA_PITR_MINIMUM_AVAILABLE_BYTES,
    DEFAULT_MINIMUM_AVAILABLE_BYTES,
    GIB,
    1024 * GIB,
  );
  const minimumAvailablePercent = boundedNumber(
    env.FAOLLA_PITR_MINIMUM_AVAILABLE_PERCENT,
    DEFAULT_MINIMUM_AVAILABLE_PERCENT,
    5,
    80,
  );
  const maximumReadyWalFiles = boundedNumber(
    env.FAOLLA_PITR_MAXIMUM_READY_WAL_FILES,
    DEFAULT_MAXIMUM_READY_WAL_FILES,
    0,
    1024,
  );
  const blockers = [];
  const warnings = [];

  if (!isEnabled(env.FAOLLA_PITR_ENABLED)) {
    blockers.push("pitr_not_enabled");
  }
  if (!configFile.exists) {
    blockers.push("pitr_config_missing");
  } else if (!configFile.securePermissions) {
    blockers.push("pitr_config_permissions_unsafe");
  }
  if (!state.dockerAvailable) blockers.push("docker_unavailable");
  if (!state.databaseContainer) blockers.push("database_container_missing");
  if (state.databaseContainer && !state.databaseProbeSucceeded) {
    blockers.push("database_probe_failed");
  }
  if (
    state.databaseProbeSucceeded &&
    !["replica", "logical"].includes(state.settings.walLevel)
  ) {
    blockers.push("wal_level_insufficient");
  }
  if (
    state.databaseProbeSucceeded &&
    !["on", "always"].includes(state.settings.archiveMode)
  ) {
    blockers.push("archive_mode_disabled");
  }
  if (
    state.databaseProbeSucceeded &&
    !state.settings.archiveCommandConfigured &&
    !state.settings.archiveLibraryConfigured
  ) {
    blockers.push("archive_destination_missing");
  }
  if (
    state.databaseProbeSucceeded &&
    (!state.settings.archiveTimeoutSeconds ||
      state.settings.archiveTimeoutSeconds > maximumArchiveAgeSeconds)
  ) {
    blockers.push("archive_timeout_not_bounded");
  }
  if (!state.walG.available) blockers.push("wal_g_missing");
  if (!state.walG.configPresent) {
    blockers.push("wal_g_config_missing");
  } else if (!state.walG.configPermissionsSecure) {
    blockers.push("wal_g_config_permissions_unsafe");
  }
  if (!state.repository.probeSucceeded) {
    blockers.push("offsite_repository_unreachable");
  } else if (state.repository.backupCount < 1) {
    blockers.push("physical_base_backup_missing");
  }

  const latestBackupAgeSeconds = timestampAgeSeconds(
    state.repository.latestBackupAt,
    now,
  );
  if (
    state.repository.backupCount > 0 &&
    (latestBackupAgeSeconds === null ||
      latestBackupAgeSeconds > maximumBaseBackupAgeHours * 3600)
  ) {
    blockers.push("physical_base_backup_stale");
  }

  const lastArchivedAgeSeconds = timestampAgeSeconds(
    state.archiver.lastArchivedAt,
    now,
  );
  const lastFailedAgeSeconds = timestampAgeSeconds(
    state.archiver.lastFailedAt,
    now,
  );
  if (
    state.databaseProbeSucceeded &&
    (!state.archiver.archivedCount ||
      !state.archiver.lastArchivedAt)
  ) {
    blockers.push("wal_archive_not_verified");
  }
  if (
    state.archiver.lastFailedAt &&
    (!state.archiver.lastArchivedAt ||
      Date.parse(state.archiver.lastFailedAt) >
        Date.parse(state.archiver.lastArchivedAt))
  ) {
    blockers.push("wal_archive_latest_attempt_failed");
  } else if ((state.archiver.failedCount ?? 0) > 0) {
    warnings.push("wal_archive_historical_failures");
  }
  if (
    lastArchivedAgeSeconds !== null &&
    lastArchivedAgeSeconds > maximumArchiveAgeSeconds
  ) {
    warnings.push("wal_archive_stale");
  }
  if (
    (state.wal.readyCount ?? 0) > maximumReadyWalFiles
  ) {
    blockers.push("wal_archive_backlog");
  }

  if (!state.disk) {
    blockers.push("database_disk_probe_failed");
  } else {
    if (
      state.disk.availableBytes < minimumAvailableBytes ||
      state.disk.availablePercent < minimumAvailablePercent
    ) {
      blockers.push("database_disk_headroom_insufficient");
    }
    if (state.disk.totalBytes < RECOMMENDED_DISK_BYTES) {
      warnings.push("database_disk_capacity_below_recommended");
    }
  }

  const restoreAgeSeconds = timestampAgeSeconds(
    restoreEvidence.completedAt,
    now,
  );
  if (!restoreEvidence.present || !restoreEvidence.valid) {
    blockers.push("pitr_restore_rehearsal_missing");
  } else if (
    restoreAgeSeconds === null ||
    restoreAgeSeconds > maximumRestoreRehearsalAgeHours * 3600
  ) {
    blockers.push("pitr_restore_rehearsal_stale");
  }

  const status =
    blockers.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "degraded"
        : "ready";
  return {
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    status,
    pitrReady: status !== "blocked",
    target: {
      maximumArchiveAgeSeconds,
      maximumBaseBackupAgeHours,
      maximumRestoreRehearsalAgeHours,
    },
    configuration: {
      enabled: isEnabled(env.FAOLLA_PITR_ENABLED),
      provider: safeIdentifier(env.FAOLLA_PITR_OFFSITE_PROVIDER) || null,
      configFilePresent: configFile.exists === true,
      configFilePermissionsSecure:
        configFile.securePermissions === true,
    },
    state,
    observations: {
      latestBaseBackupAgeHours:
        latestBackupAgeSeconds === null
          ? null
          : Number((latestBackupAgeSeconds / 3600).toFixed(2)),
      lastArchiveAgeSeconds: lastArchivedAgeSeconds,
      lastFailedArchiveAgeSeconds: lastFailedAgeSeconds,
      restoreRehearsalAgeHours:
        restoreAgeSeconds === null
          ? null
          : Number((restoreAgeSeconds / 3600).toFixed(2)),
    },
    restoreRehearsal: {
      present: restoreEvidence.present === true,
      valid: restoreEvidence.valid === true,
      isolationVerified: restoreEvidence.isolationVerified === true,
      completedAt: trimText(restoreEvidence.completedAt) || null,
    },
    blockers: unique(blockers),
    warnings: unique(warnings),
  };
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function argumentValue(name) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : "";
}

function printSummary(report) {
  console.log(
    `[production-pitr-readiness] ${report.status.toUpperCase()} ${report.checkedAt}`,
  );
  console.log(
    `[production-pitr-readiness] enabled=${report.configuration.enabled} ` +
      `archiveMode=${report.state.settings.archiveMode ?? "unknown"} ` +
      `walLevel=${report.state.settings.walLevel ?? "unknown"}`,
  );
  console.log(
    `[production-pitr-readiness] walG=${report.state.walG.available} ` +
      `repository=${report.state.repository.probeSucceeded} ` +
      `baseBackups=${report.state.repository.backupCount}`,
  );
  if (report.state.disk) {
    console.log(
      `[production-pitr-readiness] diskAvailableBytes=${report.state.disk.availableBytes} ` +
        `diskAvailablePercent=${report.state.disk.availablePercent}`,
    );
  }
  if (report.blockers.length > 0) {
    console.log(
      `[production-pitr-readiness] blockers=${report.blockers.join(",")}`,
    );
  }
  if (report.warnings.length > 0) {
    console.log(
      `[production-pitr-readiness] warnings=${report.warnings.join(",")}`,
    );
  }
}

function main() {
  const configPath = safeAbsolutePath(
    argumentValue("config-env-file") ||
      process.env.FAOLLA_PITR_CONFIG_FILE,
    DEFAULT_CONFIG_FILE,
  );
  const configFile = inspectPitrConfigFile(configPath);
  if (configFile.exists) {
    try {
      process.loadEnvFile(configPath);
    } catch {
      configFile.securePermissions = false;
    }
  }
  const restoreEvidencePath = safeAbsolutePath(
    process.env.FAOLLA_PITR_RESTORE_EVIDENCE_FILE,
    DEFAULT_RESTORE_EVIDENCE_FILE,
  );
  const report = buildProductionPitrReadinessReport({
    env: process.env,
    configFile,
    state: inspectProductionPitrState({ env: process.env }),
    restoreEvidence: readRestoreRehearsalEvidence(
      restoreEvidencePath,
    ),
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
