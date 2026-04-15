import type { MerchantConfigHistoryEntry, MerchantConfigSnapshot } from "@/data/platformControlStore";
import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import {
  createDefaultMerchantContactVisibility,
  createDefaultMerchantSortConfig,
  normalizeMerchantPermissionConfig,
} from "@/data/platformControlStore";

export type PlatformMerchantConfigArchiveSource = "update" | "rollback" | "restore";

export type PlatformMerchantConfigAuditEntry = {
  id: string;
  siteId: string;
  merchantName: string;
  at: string;
  operator: string;
  source: PlatformMerchantConfigArchiveSource;
  summary: string;
  changes: string[];
  before: MerchantConfigSnapshot;
  after: MerchantConfigSnapshot;
};

export type PlatformMerchantConfigBackupEntry = {
  id: string;
  siteId: string;
  merchantName: string;
  at: string;
  operator: string;
  source: PlatformMerchantConfigArchiveSource;
  summary: string;
  changes: string[];
  snapshot: MerchantConfigSnapshot;
  sourceHistoryEntryId: string;
};

export type PlatformMerchantConfigArchivePayload = {
  audits: PlatformMerchantConfigAuditEntry[];
  backups: PlatformMerchantConfigBackupEntry[];
};

export const PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG = "__platform_merchant_config_archive__";
export const PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG = "__platform_merchant_config_archive_backup__";

const PLATFORM_MERCHANT_CONFIG_ARCHIVE_BLOCK_ID = "platform-merchant-config-archive";
const MAX_CONFIG_ARCHIVE_AUDITS = 2400;
const MAX_CONFIG_ARCHIVE_BACKUPS = 1200;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoString(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeUnitInterval(value: unknown, fallback = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function normalizeArchiveSource(value: unknown): PlatformMerchantConfigArchiveSource {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "rollback") return "rollback";
  if (normalized === "restore") return "restore";
  return "update";
}

function normalizeMerchantConfigSnapshot(value: unknown): MerchantConfigSnapshot {
  const input = value && typeof value === "object" ? (value as Partial<MerchantConfigSnapshot>) : {};
  return {
    serviceExpiresAt: normalizeIsoString(input.serviceExpiresAt) || null,
    permissionConfig: normalizeMerchantPermissionConfig(input.permissionConfig),
    merchantCardImageUrl: normalizeText(input.merchantCardImageUrl),
    merchantCardImageOpacity: normalizeUnitInterval(input.merchantCardImageOpacity, 1),
    chatAvatarImageUrl: normalizeText(input.chatAvatarImageUrl),
    contactVisibility: input.contactVisibility ?? createDefaultMerchantContactVisibility(),
    sortConfig: input.sortConfig ?? createDefaultMerchantSortConfig(),
  };
}

function normalizeAuditEntry(value: unknown): PlatformMerchantConfigAuditEntry | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<PlatformMerchantConfigAuditEntry>;
  const id = normalizeText(input.id);
  const siteId = normalizeText(input.siteId);
  const at = normalizeIsoString(input.at);
  if (!id || !siteId || !at) return null;
  return {
    id,
    siteId,
    merchantName: normalizeText(input.merchantName) || siteId,
    at,
    operator: normalizeText(input.operator) || "super-admin",
    source: normalizeArchiveSource(input.source),
    summary: normalizeText(input.summary) || "配置更新",
    changes: normalizeStringArray(input.changes),
    before: normalizeMerchantConfigSnapshot(input.before),
    after: normalizeMerchantConfigSnapshot(input.after),
  };
}

function normalizeBackupEntry(value: unknown): PlatformMerchantConfigBackupEntry | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<PlatformMerchantConfigBackupEntry>;
  const id = normalizeText(input.id);
  const siteId = normalizeText(input.siteId);
  const at = normalizeIsoString(input.at);
  if (!id || !siteId || !at) return null;
  return {
    id,
    siteId,
    merchantName: normalizeText(input.merchantName) || siteId,
    at,
    operator: normalizeText(input.operator) || "super-admin",
    source: normalizeArchiveSource(input.source),
    summary: normalizeText(input.summary) || "配置备份",
    changes: normalizeStringArray(input.changes),
    snapshot: normalizeMerchantConfigSnapshot(input.snapshot),
    sourceHistoryEntryId: normalizeText(input.sourceHistoryEntryId),
  };
}

function sortAudits(audits: PlatformMerchantConfigAuditEntry[]) {
  return [...audits].sort((left, right) => {
    const delta = new Date(right.at).getTime() - new Date(left.at).getTime();
    if (delta !== 0) return delta;
    return right.id.localeCompare(left.id, "en");
  });
}

function sortBackups(backups: PlatformMerchantConfigBackupEntry[]) {
  return [...backups].sort((left, right) => {
    const delta = new Date(right.at).getTime() - new Date(left.at).getTime();
    if (delta !== 0) return delta;
    return right.id.localeCompare(left.id, "en");
  });
}

function mergeAudits(
  ...groups: Array<PlatformMerchantConfigAuditEntry[] | undefined>
): PlatformMerchantConfigAuditEntry[] {
  const map = new Map<string, PlatformMerchantConfigAuditEntry>();
  groups.forEach((group) => {
    if (!Array.isArray(group)) return;
    group.forEach((entry) => {
      if (!entry?.id) return;
      const normalized = normalizeAuditEntry(entry);
      if (!normalized) return;
      map.set(normalized.id, normalized);
    });
  });
  return sortAudits([...map.values()]).slice(0, MAX_CONFIG_ARCHIVE_AUDITS);
}

function mergeBackups(
  ...groups: Array<PlatformMerchantConfigBackupEntry[] | undefined>
): PlatformMerchantConfigBackupEntry[] {
  const map = new Map<string, PlatformMerchantConfigBackupEntry>();
  groups.forEach((group) => {
    if (!Array.isArray(group)) return;
    group.forEach((entry) => {
      if (!entry?.id) return;
      const normalized = normalizeBackupEntry(entry);
      if (!normalized) return;
      map.set(normalized.id, normalized);
    });
  });
  return sortBackups([...map.values()]).slice(0, MAX_CONFIG_ARCHIVE_BACKUPS);
}

export function normalizePlatformMerchantConfigArchivePayload(
  value: unknown,
): PlatformMerchantConfigArchivePayload {
  const audits = Array.isArray((value as { audits?: unknown } | null | undefined)?.audits)
    ? (value as { audits: unknown[] }).audits
        .map((item) => normalizeAuditEntry(item))
        .filter((item): item is PlatformMerchantConfigAuditEntry => !!item)
    : [];
  const backups = Array.isArray((value as { backups?: unknown } | null | undefined)?.backups)
    ? (value as { backups: unknown[] }).backups
        .map((item) => normalizeBackupEntry(item))
        .filter((item): item is PlatformMerchantConfigBackupEntry => !!item)
    : [];
  return {
    audits: mergeAudits(audits),
    backups: mergeBackups(backups),
  };
}

export function mergePlatformMerchantConfigArchivePayloads(
  ...payloads: Array<PlatformMerchantConfigArchivePayload | null | undefined>
): PlatformMerchantConfigArchivePayload {
  return {
    audits: mergeAudits(...payloads.map((item) => item?.audits)),
    backups: mergeBackups(...payloads.map((item) => item?.backups)),
  };
}

export function buildPlatformMerchantConfigArchiveBlocks(
  payload: PlatformMerchantConfigArchivePayload,
) {
  return [
    {
      id: PLATFORM_MERCHANT_CONFIG_ARCHIVE_BLOCK_ID,
      type: "common",
      content: "platform merchant config archive",
      props: {
        isPlatformMerchantConfigArchive: true,
        payload: normalizePlatformMerchantConfigArchivePayload(payload),
      },
    },
  ];
}

export function readPlatformMerchantConfigArchiveFromBlocks(
  blocks: unknown,
): PlatformMerchantConfigArchivePayload {
  if (!Array.isArray(blocks)) return { audits: [], backups: [] };
  const matched = (blocks as Array<{ props?: Record<string, unknown> | null }>).find((block) => {
    const props = block?.props;
    return !!props && props.isPlatformMerchantConfigArchive === true;
  });
  return normalizePlatformMerchantConfigArchivePayload(matched?.props?.payload);
}

function resolveArchiveSource(summary: string): PlatformMerchantConfigArchiveSource {
  const normalized = summary.toLowerCase();
  if (normalized.includes("restore") || normalized.includes("恢复")) return "restore";
  if (normalized.includes("rollback") || normalized.includes("回滚")) return "rollback";
  return "update";
}

function buildSnapshotFromPublishedSite(
  site: MerchantListPublishedSite | undefined,
  fallbackAfter: MerchantConfigSnapshot,
): MerchantConfigSnapshot {
  if (!site) return normalizeMerchantConfigSnapshot(fallbackAfter);
  return normalizeMerchantConfigSnapshot({
    serviceExpiresAt: site.serviceExpiresAt ?? null,
    permissionConfig: site.permissionConfig,
    merchantCardImageUrl: site.merchantCardImageUrl,
    merchantCardImageOpacity: site.merchantCardImageOpacity,
    chatAvatarImageUrl: site.chatAvatarImageUrl,
    contactVisibility: site.contactVisibility,
    sortConfig: site.sortConfig,
  });
}

export function derivePlatformMerchantConfigArchiveEntries(input: {
  previousHistoryBySiteId?: Record<string, MerchantConfigHistoryEntry[]>;
  nextHistoryBySiteId?: Record<string, MerchantConfigHistoryEntry[]>;
  nextSnapshot?: MerchantListPublishedSite[];
}): PlatformMerchantConfigArchivePayload {
  const audits: PlatformMerchantConfigAuditEntry[] = [];
  const backups: PlatformMerchantConfigBackupEntry[] = [];
  const previous = input.previousHistoryBySiteId ?? {};
  const next = input.nextHistoryBySiteId ?? {};
  const snapshotBySiteId = new Map((input.nextSnapshot ?? []).map((site) => [site.id, site] as const));
  Object.entries(next).forEach(([siteId, historyEntries]) => {
    const previousIds = new Set((previous[siteId] ?? []).map((entry) => normalizeText(entry.id)).filter(Boolean));
    const site = snapshotBySiteId.get(siteId);
    const merchantName = normalizeText(site?.merchantName) || normalizeText(site?.name) || siteId;
    historyEntries.forEach((entry) => {
      const historyId = normalizeText(entry.id);
      if (!historyId || previousIds.has(historyId)) return;
      const source = resolveArchiveSource(normalizeText(entry.summary));
      const changes = Array.isArray(entry.changes) ? entry.changes.map((item) => normalizeText(item)).filter(Boolean) : [];
      const afterSnapshot = buildSnapshotFromPublishedSite(site, entry.after);
      audits.push({
        id: historyId,
        siteId,
        merchantName,
        at: normalizeIsoString(entry.at) || new Date().toISOString(),
        operator: normalizeText(entry.operator) || "super-admin",
        source,
        summary: normalizeText(entry.summary) || "配置更新",
        changes,
        before: normalizeMerchantConfigSnapshot(entry.before),
        after: normalizeMerchantConfigSnapshot(entry.after),
      });
      backups.push({
        id: `backup-${historyId}`,
        siteId,
        merchantName,
        at: normalizeIsoString(entry.at) || new Date().toISOString(),
        operator: normalizeText(entry.operator) || "super-admin",
        source,
        summary: normalizeText(entry.summary) || "配置备份",
        changes,
        snapshot: afterSnapshot,
        sourceHistoryEntryId: historyId,
      });
    });
  });
  return normalizePlatformMerchantConfigArchivePayload({ audits, backups });
}
