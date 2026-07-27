import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { requestOperationsJson } from "./check-production-operations.mjs";

const DEFAULT_MAXIMUM_AGE_HOURS = 96;
const DEFAULT_TIMEOUT_MS = 30_000;
const PRIMARY_BACKUP_SLUG = "__platform_admin_data_backup__";
const SECONDARY_BACKUP_SLUG = "__platform_admin_data_backup_backup__";
const BACKUP_SLUGS = [PRIMARY_BACKUP_SLUG, SECONDARY_BACKUP_SLUG];
const LATEST_BACKUP_PROJECTION =
  "latest_backup:blocks->0->props->payload->backups->0";

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isArray(value) {
  return Array.isArray(value);
}

function normalizePositiveNumber(value, fallback, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(maximum, numeric);
}

function hashJson(value) {
  const serialized = JSON.stringify(value);
  const parsed = JSON.parse(serialized);
  const roundTrip = JSON.stringify(parsed);
  if (serialized !== roundTrip) throw new Error("json_round_trip_mismatch");
  return createHash("sha256").update(serialized).digest("hex");
}

function findBackupPayload(blocks) {
  if (!Array.isArray(blocks)) return null;
  const block = blocks.find(
    (item) =>
      isRecord(item) &&
      isRecord(item.props) &&
      item.props.isPlatformAdminDataBackup === true,
  );
  return isRecord(block?.props?.payload) ? block.props.payload : null;
}

function backupEntriesFromRow(row) {
  if (!isRecord(row)) {
    return { payloadValid: false, entries: [] };
  }
  if (Object.hasOwn(row, "latest_backup")) {
    const entry = normalizeBackupEntry(row.latest_backup);
    return {
      payloadValid: isRecord(row.latest_backup),
      entries: entry ? [entry] : [],
    };
  }
  const payload = findBackupPayload(row.blocks);
  return {
    payloadValid: Boolean(payload),
    entries: isArray(payload?.backups)
      ? payload.backups.map(normalizeBackupEntry).filter(Boolean)
      : [],
  };
}

function validatePlatformState(value) {
  if (!isRecord(value)) return false;
  return [
    "tenants",
    "sites",
    "planTemplates",
    "industryCategories",
    "roles",
    "users",
    "pageAssets",
    "publishRecords",
    "approvals",
    "alerts",
    "audits",
  ].every((key) => isArray(value[key]));
}

function validateMerchantSnapshot(value) {
  return value === null || (isRecord(value) && isArray(value.snapshot));
}

function validateMerchantConfigArchive(value) {
  return isRecord(value) && isArray(value.audits) && isArray(value.backups);
}

function validateSupportInbox(value) {
  return isRecord(value) && isArray(value.threads);
}

function validateBackupSnapshot(snapshot) {
  if (!isRecord(snapshot)) return false;
  return (
    validatePlatformState(snapshot.platformState) &&
    validateMerchantSnapshot(snapshot.merchantSnapshot ?? null) &&
    validateMerchantConfigArchive(snapshot.merchantConfigArchive) &&
    validateSupportInbox(snapshot.supportInbox) &&
    isArray(snapshot.merchantAccounts)
  );
}

function normalizeBackupEntry(value) {
  if (!isRecord(value)) return null;
  const id = trimText(value.id);
  const at = trimText(value.at);
  const timestamp = Date.parse(at);
  if (!id || !Number.isFinite(timestamp) || !validateBackupSnapshot(value.snapshot)) {
    return null;
  }
  return {
    id,
    at: new Date(timestamp).toISOString(),
    timestamp,
    source: value.source === "auto" ? "auto" : "manual",
    snapshot: value.snapshot,
  };
}

function snapshotCounts(snapshot) {
  return {
    sites: snapshot.platformState.sites.length,
    users: snapshot.platformState.users.length,
    roles: snapshot.platformState.roles.length,
    merchantAccounts: snapshot.merchantAccounts.length,
    publishedMerchantSnapshots: snapshot.merchantSnapshot?.snapshot.length ?? 0,
    merchantConfigArchives: snapshot.merchantConfigArchive.backups.length,
    supportThreads: snapshot.supportInbox.threads.length,
  };
}

function simulateRestoreScopes(snapshot) {
  const userManage = {
    platformState: snapshot.platformState,
    merchantSnapshot: snapshot.merchantSnapshot,
    merchantConfigArchive: snapshot.merchantConfigArchive,
    merchantAccounts: snapshot.merchantAccounts,
  };
  const supportMessages = {
    supportInbox: snapshot.supportInbox,
  };
  hashJson(userManage);
  hashJson(supportMessages);
  return ["user_manage", "support_messages"];
}

export function validatePlatformAdminBackupRows(rows, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const maximumAgeHours = normalizePositiveNumber(
    options.maximumAgeHours,
    DEFAULT_MAXIMUM_AGE_HOURS,
    24 * 30,
  );
  const entriesById = new Map();
  const copies = {};

  for (const slug of BACKUP_SLUGS) {
    const row = Array.isArray(rows)
      ? rows.find((item) => trimText(item?.slug) === slug)
      : null;
    const { entries, payloadValid } = backupEntriesFromRow(row);
    entries.forEach((entry) => {
      const existing = entriesById.get(entry.id);
      if (!existing || entry.timestamp > existing.timestamp) {
        entriesById.set(entry.id, entry);
      }
    });
    copies[slug] = {
      present: Boolean(row),
      payloadValid,
      validBackupCount: entries.length,
      backupIds: new Set(entries.map((entry) => entry.id)),
    };
  }

  const entries = [...entriesById.values()].sort(
    (left, right) => right.timestamp - left.timestamp,
  );
  const latest = entries[0] ?? null;
  if (!latest) {
    return {
      schemaVersion: 1,
      status: "critical",
      checkedAt: now.toISOString(),
      error: "no_valid_platform_admin_backup",
      validBackupCount: 0,
      latestBackupAt: null,
      latestBackupAgeHours: null,
      redundantCopies: 0,
      restoreScopesValidated: [],
      fullBusinessDatabaseCovered: false,
      coverage: "platform_admin_only",
    };
  }

  const ageHours = Math.max(0, (now.getTime() - latest.timestamp) / 3_600_000);
  let roundTripHash = "";
  let restoreScopesValidated = [];
  try {
    roundTripHash = hashJson(latest.snapshot);
    restoreScopesValidated = simulateRestoreScopes(latest.snapshot);
  } catch {
    return {
      schemaVersion: 1,
      status: "critical",
      checkedAt: now.toISOString(),
      error: "backup_round_trip_failed",
      validBackupCount: entries.length,
      latestBackupAt: latest.at,
      latestBackupAgeHours: Number(ageHours.toFixed(2)),
      redundantCopies: 0,
      restoreScopesValidated: [],
      fullBusinessDatabaseCovered: false,
      coverage: "platform_admin_only",
    };
  }

  const redundantCopies = BACKUP_SLUGS.filter((slug) =>
    copies[slug].backupIds.has(latest.id),
  ).length;
  const warnings = [];
  if (redundantCopies < 2) warnings.push("latest_backup_not_redundant");
  if (ageHours > maximumAgeHours) warnings.push("latest_backup_too_old");
  const status = warnings.includes("latest_backup_too_old")
    ? "critical"
    : warnings.length > 0
      ? "degraded"
      : "healthy";

  return {
    schemaVersion: 1,
    status,
    checkedAt: now.toISOString(),
    warnings,
    validBackupCount: entries.length,
    latestBackupAt: latest.at,
    latestBackupAgeHours: Number(ageHours.toFixed(2)),
    latestBackupSource: latest.source,
    redundantCopies,
    roundTripDigest: roundTripHash.slice(0, 16),
    restoreScopesValidated,
    snapshotCounts: snapshotCounts(latest.snapshot),
    fullBusinessDatabaseCovered: false,
    coverage: "platform_admin_only",
  };
}

function normalizeSupabaseUrl(value) {
  const normalized = trimText(value).replace(/\/+$/, "");
  if (!normalized) return "";
  try {
    return new URL(normalized).origin;
  } catch {
    return "";
  }
}

function classifyBackupReadFailure(error) {
  const status = Number(error?.status);
  const code = trimText(error?.code);
  if (Number.isInteger(status) && status > 0) {
    return {
      detail: "http_error",
      httpStatus: status,
      ...(code && /^[A-Z0-9_]{1,40}$/i.test(code) ? { errorCode: code } : {}),
    };
  }
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  if (/timeout|abort/i.test(message)) return { detail: "request_timeout" };
  if (/fetch|network|socket|connect/i.test(message)) {
    return { detail: "network_error" };
  }
  return { detail: "unexpected_request_failure" };
}

export async function runProductionBackupRecoveryCheck(input = {}) {
  const supabaseUrl = normalizeSupabaseUrl(
    input.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const serviceRoleKey = trimText(
    input.serviceRoleKey ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY,
  );
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      schemaVersion: 1,
      status: "critical",
      checkedAt: new Date().toISOString(),
      error: "required_environment_missing",
      fullBusinessDatabaseCovered: false,
      coverage: "platform_admin_only",
    };
  }

  const params = new URLSearchParams({
    select: `slug,${LATEST_BACKUP_PROJECTION}`,
    merchant_id: "is.null",
    slug: `in.(${BACKUP_SLUGS.join(",")})`,
    limit: "2",
  });
  try {
    const result = await requestOperationsJson({
      fetchImpl: input.fetchImpl ?? fetch,
      label: "platform_admin_backup",
      url: `${supabaseUrl}/rest/v1/pages?${params}`,
      init: {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
      attempts: input.requestAttempts ?? 3,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return validatePlatformAdminBackupRows(result.body, {
      now: input.now,
      maximumAgeHours: input.maximumAgeHours,
    });
  } catch (error) {
    return {
      schemaVersion: 1,
      status: "critical",
      checkedAt: new Date().toISOString(),
      error: "platform_admin_backup_read_failed",
      ...classifyBackupReadFailure(error),
      fullBusinessDatabaseCovered: false,
      coverage: "platform_admin_only",
    };
  }
}

function readArgument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((entry) => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function main() {
  const report = await runProductionBackupRecoveryCheck({
    maximumAgeHours:
      readArgument("maximum-age-hours") ||
      process.env.FAOLLA_BACKUP_MAXIMUM_AGE_HOURS,
  });
  console.log(
    `[backup-recovery] ${report.status.toUpperCase()} checkedAt=${report.checkedAt}`,
  );
  console.log(
    `[backup-recovery] backups=${report.validBackupCount ?? 0} redundant=${report.redundantCopies ?? 0} ` +
      `ageHours=${report.latestBackupAgeHours ?? "unknown"} coverage=${report.coverage}`,
  );
  const outputPath = trimText(readArgument("output"));
  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(report));
  if (
    report.status === "critical" ||
    (report.status === "degraded" &&
      process.argv.includes("--fail-on-degraded"))
  ) {
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch(() => {
    console.error("[backup-recovery] FAILED unexpected_check_failure");
    process.exitCode = 1;
  });
}
