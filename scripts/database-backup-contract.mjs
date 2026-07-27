import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

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

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArchiveEntry(value) {
  return trimText(value).replaceAll("\\", "/").replace(/^\.\/+/, "");
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
  const normalized = raw
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized) {
    return { valid: true, entry: "", root: true };
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    )
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
  return {
    schemaVersion: 1,
    createdAt: input.createdAt ?? new Date().toISOString(),
    format: "self-hosted-supabase-dr-v1",
    dumpTool: {
      name: "pg_dumpall",
      version: trimText(input.toolVersion) || "unknown",
    },
    source: {
      strategy: "docker_exec_postgres",
      databaseImage: trimText(input.databaseImage),
      storageImage: trimText(input.storageImage),
      storageBackend: trimText(input.storageBackend) || "unknown",
    },
    files,
  };
}

export function validateDatabaseBackupManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, error: "manifest_not_object" };
  }
  if (
    value.schemaVersion !== 1 ||
    value.format !== "self-hosted-supabase-dr-v1"
  ) {
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
    !["file", "s3", "unspecified", "other", "unknown"].includes(
      storageBackend,
    )
  ) {
    return { valid: false, error: "manifest_source_invalid" };
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
      schemaVersion: 1,
      createdAt: trimText(value.createdAt),
      format: "self-hosted-supabase-dr-v1",
      dumpTool: {
        name: "pg_dumpall",
        version: trimText(value.dumpTool?.version) || "unknown",
      },
      source: {
        strategy: "docker_exec_postgres",
        databaseImage,
        storageImage,
        storageBackend,
      },
      files: DATABASE_BACKUP_DATA_FILES.map((name) => entries.get(name)),
    },
  };
}

export function validateDatabaseBackupArchiveEntries(entries) {
  if (!Array.isArray(entries)) {
    return { valid: false, error: "archive_entries_invalid" };
  }
  const normalized = entries
    .map(normalizeArchiveEntry)
    .filter(Boolean);
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
