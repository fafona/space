import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { PRODUCTION_RELEASE_AGGREGATE_KEYS } from "./production-release-attestation.mjs";

export const DATABASE_BACKUP_DATA_FILES = [
  "database.sql.gz",
  "postgres-config.tar.gz",
  "storage.tar.gz",
  "supabase-config.tar.gz",
  "app-config.tar.gz",
];

export const DATABASE_BACKUP_ARCHIVE_FILES = [
  ...DATABASE_BACKUP_DATA_FILES,
  "manifest.json",
];

const BACKUP_SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const BACKUP_SOURCE_REPOSITORY_PATTERN =
  /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const DOCKER_CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
const DOCKER_IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

const AUTHORITATIVE_BASELINE_PATHS = [
  ["merchantRecordCount", "{merchant,recordCount}"],
  ["merchantAuthoritativeBindingCount", "{merchant,authoritativeBindingCount}"],
  ["merchantInvalidBindingCount", "{merchant,invalidBindingCount}"],
  ["personalCanonicalBindingCount", "{personal,canonicalBindingCount}"],
  ["personalCanonicalOrphanCount", "{personal,canonicalOrphanCount}"],
  ["personalInvalidCanonicalCount", "{personal,invalidCanonicalCount}"],
  ["personalDuplicateAuthUserCount", "{personal,duplicateAuthUserCount}"],
  [
    "personalDuplicateAccountIdCount",
    "{personal,duplicatePersonalAccountIdCount}",
  ],
  ["crossAccountTypeOverlapCount", "{security,crossAccountTypeOverlapCount}"],
  [
    "accountIdentifierCollisionCount",
    "{security,accountIdentifierCollisionCount}",
  ],
  ["staffRegistryOverlapCount", "{security,staffRegistryOverlapCount}"],
  [
    "systemSitePrincipalOverlapCount",
    "{security,systemSitePrincipalOverlapCount}",
  ],
];

export function buildDatabaseBackupAuthoritativeBaselineJsonSql() {
  return [
    "pg_catalog.json_build_object(",
    ...AUTHORITATIVE_BASELINE_PATHS.map(
      ([key, readinessPath], index) =>
        `  '${key}', readiness.value #>> '${readinessPath}'${
          index === AUTHORITATIVE_BASELINE_PATHS.length - 1 ? "" : ","
        }`,
    ),
    ")",
  ].join("\n");
}

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArchiveEntry(value) {
  return trimText(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
}

export function validateDatabaseBackupNestedArchiveEntry(value) {
  if (typeof value !== "string") {
    return { valid: false, error: "nested_archive_entry_invalid" };
  }
  const raw = value.replace(/\r$/, "");
  if (
    !raw ||
    raw.length > 4_096 ||
    raw.includes("\0") ||
    raw.includes("\\") ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw) ||
    raw.startsWith("/") ||
    /^[a-z]:/i.test(raw)
  ) {
    return { valid: false, error: "nested_archive_entry_unsafe" };
  }
  const normalized = raw.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!normalized) {
    return { valid: true, entry: "", root: true };
  }
  const segments = normalized.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return { valid: false, error: "nested_archive_entry_unsafe" };
  }
  return { valid: true, entry: normalized, root: false };
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export function validateDatabaseBackupSourceIdentity(value) {
  const repository = trimText(value?.repository);
  const sha = trimText(value?.sha);
  const originMainSha = trimText(value?.originMainSha);
  const database = value?.database;
  const containerName = trimText(database?.containerName);
  const containerId = trimText(database?.containerId);
  const imageId = trimText(database?.imageId);
  const containerStartedAt = trimText(database?.containerStartedAt);
  const databaseName = trimText(database?.databaseName);
  const databaseOid = trimText(database?.databaseOid);
  const systemIdentifier = trimText(database?.systemIdentifier);
  const serverVersionNum = trimText(database?.serverVersionNum);
  const postmasterStartedAt = trimText(database?.postmasterStartedAt);
  const baseline = database?.baseline;
  const baselineKeys =
    baseline && typeof baseline === "object" && !Array.isArray(baseline)
      ? Object.keys(baseline).sort()
      : [];
  const expectedBaselineKeys = [...PRODUCTION_RELEASE_AGGREGATE_KEYS].sort();
  const baselineValid =
    baselineKeys.length === expectedBaselineKeys.length &&
    baselineKeys.every((key, index) => key === expectedBaselineKeys[index]) &&
    PRODUCTION_RELEASE_AGGREGATE_KEYS.every((key) =>
      /^(?:0|[1-9][0-9]*)$/.test(baseline[key]),
    );

  if (
    !BACKUP_SOURCE_REPOSITORY_PATTERN.test(repository) ||
    !BACKUP_SOURCE_SHA_PATTERN.test(sha) ||
    originMainSha !== sha ||
    value?.detached !== true ||
    value?.treeState !== "clean" ||
    value?.stability?.source !== "matched_before_after" ||
    value?.stability?.database !== "matched_before_after" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(containerName) ||
    !DOCKER_CONTAINER_ID_PATTERN.test(containerId) ||
    !DOCKER_IMAGE_ID_PATTERN.test(imageId) ||
    !Number.isFinite(Date.parse(containerStartedAt)) ||
    !/^[A-Za-z0-9_.-]{1,63}$/.test(databaseName) ||
    !/^[1-9][0-9]{0,9}$/.test(databaseOid) ||
    !/^[0-9]{10,24}$/.test(systemIdentifier) ||
    !/^[0-9]{5,6}$/.test(serverVersionNum) ||
    !Number.isFinite(Date.parse(postmasterStartedAt)) ||
    database?.primary !== true ||
    !baselineValid
  ) {
    return { valid: false, error: "manifest_source_identity_invalid" };
  }

  return {
    valid: true,
    source: {
      repository,
      sha,
      originMainSha,
      detached: true,
      treeState: "clean",
      stability: {
        source: "matched_before_after",
        database: "matched_before_after",
      },
      database: {
        containerName,
        containerId,
        imageId,
        containerStartedAt,
        databaseName,
        databaseOid,
        systemIdentifier,
        serverVersionNum,
        postmasterStartedAt,
        primary: true,
        baseline: Object.fromEntries(
          PRODUCTION_RELEASE_AGGREGATE_KEYS.map((key) => [key, baseline[key]]),
        ),
      },
    },
  };
}

export async function buildDatabaseBackupManifest(input) {
  const directory = path.resolve(input.directory);
  const files = [];
  for (const name of DATABASE_BACKUP_DATA_FILES) {
    const filePath = path.join(directory, name);
    const details = await stat(filePath);
    if (!details.isFile() || details.size <= 0) {
      throw new Error(`invalid_backup_file:${name}`);
    }
    files.push({
      name,
      bytes: details.size,
      sha256: await sha256File(filePath),
    });
  }
  const sourceIdentity = validateDatabaseBackupSourceIdentity({
    repository: input.sourceRepository,
    sha: input.sourceSha,
    originMainSha: input.sourceSha,
    detached: true,
    treeState: "clean",
    stability: {
      source: "matched_before_after",
      database: "matched_before_after",
    },
    database: input.databaseIdentity,
  });
  if (!sourceIdentity.valid) {
    throw new Error(sourceIdentity.error);
  }

  return {
    schemaVersion: 2,
    createdAt: input.createdAt ?? new Date().toISOString(),
    format: "self-hosted-supabase-dr-v2",
    dumpTool: {
      name: "pg_dumpall",
      version: trimText(input.toolVersion) || "unknown",
    },
    source: {
      strategy: "docker_exec_postgres",
      databaseImage: trimText(input.databaseImage),
      storageImage: trimText(input.storageImage),
      storageBackend: trimText(input.storageBackend) || "unknown",
      ...sourceIdentity.source,
    },
    files,
  };
}

export function validateDatabaseBackupManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, error: "manifest_not_object" };
  }
  const legacyFormat =
    value.schemaVersion === 1 && value.format === "self-hosted-supabase-dr-v1";
  const stableIdentityFormat =
    value.schemaVersion === 2 && value.format === "self-hosted-supabase-dr-v2";
  if (!legacyFormat && !stableIdentityFormat) {
    return { valid: false, error: "manifest_version_unsupported" };
  }
  if (!Number.isFinite(Date.parse(trimText(value.createdAt)))) {
    return { valid: false, error: "manifest_timestamp_invalid" };
  }
  if (!Array.isArray(value.files)) {
    return { valid: false, error: "manifest_files_invalid" };
  }
  const databaseImage = trimText(value.source?.databaseImage);
  const storageImage = trimText(value.source?.storageImage);
  const storageBackend = trimText(value.source?.storageBackend);
  if (
    value.source?.strategy !== "docker_exec_postgres" ||
    !/^[a-z0-9][a-z0-9._/:@-]{1,159}$/i.test(databaseImage) ||
    !/^[a-z0-9][a-z0-9._/:@-]{1,159}$/i.test(storageImage) ||
    !["file", "s3", "unspecified", "other", "unknown"].includes(storageBackend)
  ) {
    return { valid: false, error: "manifest_source_invalid" };
  }
  const sourceIdentity = stableIdentityFormat
    ? validateDatabaseBackupSourceIdentity(value.source)
    : null;
  if (sourceIdentity && !sourceIdentity.valid) {
    return sourceIdentity;
  }

  const entries = new Map();
  for (const item of value.files) {
    const name = trimText(item?.name);
    const bytes = Number(item?.bytes);
    const sha256 = trimText(item?.sha256).toLowerCase();
    if (
      !DATABASE_BACKUP_DATA_FILES.includes(name) ||
      entries.has(name) ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(sha256)
    ) {
      return { valid: false, error: "manifest_file_entry_invalid" };
    }
    entries.set(name, { name, bytes, sha256 });
  }

  if (
    DATABASE_BACKUP_DATA_FILES.some((name) => !entries.has(name)) ||
    entries.size !== DATABASE_BACKUP_DATA_FILES.length
  ) {
    return { valid: false, error: "manifest_file_set_incomplete" };
  }

  return {
    valid: true,
    manifest: {
      schemaVersion: value.schemaVersion,
      createdAt: trimText(value.createdAt),
      format: value.format,
      dumpTool: {
        name: "pg_dumpall",
        version: trimText(value.dumpTool?.version) || "unknown",
      },
      source: {
        strategy: "docker_exec_postgres",
        databaseImage,
        storageImage,
        storageBackend,
        ...(sourceIdentity?.source ?? {}),
      },
      files: DATABASE_BACKUP_DATA_FILES.map((name) => entries.get(name)),
    },
  };
}

export function validateDatabaseBackupArchiveEntries(entries) {
  if (!Array.isArray(entries)) {
    return { valid: false, error: "archive_entries_invalid" };
  }
  const normalized = entries.map(normalizeArchiveEntry).filter(Boolean);
  const expected = new Set(DATABASE_BACKUP_ARCHIVE_FILES);
  const seen = new Set();
  for (const entry of normalized) {
    if (
      entry.startsWith("/") ||
      entry.includes("../") ||
      entry.includes("/..") ||
      entry.includes("/") ||
      !expected.has(entry) ||
      seen.has(entry)
    ) {
      return { valid: false, error: "archive_entry_unsafe" };
    }
    seen.add(entry);
  }
  if (
    DATABASE_BACKUP_ARCHIVE_FILES.some((name) => !seen.has(name)) ||
    seen.size !== DATABASE_BACKUP_ARCHIVE_FILES.length
  ) {
    return { valid: false, error: "archive_file_set_incomplete" };
  }
  return { valid: true, entries: [...seen] };
}

export async function verifyDatabaseBackupManifestFiles(directory, manifest) {
  const validation = validateDatabaseBackupManifest(manifest);
  if (!validation.valid) return validation;

  for (const item of validation.manifest.files) {
    const filePath = path.join(path.resolve(directory), item.name);
    let details;
    try {
      details = await stat(filePath);
    } catch {
      return { valid: false, error: `backup_file_missing:${item.name}` };
    }
    if (!details.isFile() || details.size !== item.bytes) {
      return { valid: false, error: `backup_file_size_mismatch:${item.name}` };
    }
    if ((await sha256File(filePath)) !== item.sha256) {
      return {
        valid: false,
        error: `backup_file_checksum_mismatch:${item.name}`,
      };
    }
  }
  return { valid: true, manifest: validation.manifest };
}
