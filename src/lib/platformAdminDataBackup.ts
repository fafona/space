import type { PlatformState } from "@/data/platformControlStore";
import {
  normalizePlatformMerchantConfigArchivePayload,
  type PlatformMerchantConfigArchivePayload,
} from "@/lib/platformMerchantConfigArchive";
import {
  normalizePlatformMerchantSnapshotPayload,
  type PlatformMerchantSnapshotPayload,
} from "@/lib/platformMerchantSnapshot";
import { normalizePlatformSupportInboxPayload, type PlatformSupportInboxPayload } from "@/lib/platformSupportInbox";

export const PLATFORM_ADMIN_DATA_BACKUP_SLUG = "__platform_admin_data_backup__";
export const PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG = "__platform_admin_data_backup_backup__";
const PLATFORM_ADMIN_DATA_BACKUP_BLOCK_ID = "__platform_admin_data_backup__";
const PLATFORM_ADMIN_DATA_BACKUP_VERSION = 1;
export const PLATFORM_ADMIN_DATA_BACKUP_MAX_RECORDS = 8;

export type PlatformAdminDataBackupSource = "manual" | "auto";
export type PlatformAdminDataBackupRestoreScope = "user_manage" | "support_messages";

export type PlatformAdminBackupMerchantVisits = {
  today: number;
  day7: number;
  day30: number;
  total: number;
};

export type PlatformAdminBackupMerchantAccountItem = {
  merchantId: string;
  merchantName: string;
  email: string;
  username: string;
  loginId: string;
  createdAt: string | null;
  authUserId: string | null;
  emailConfirmed: boolean;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  manualCreated: boolean;
  hasPublishedSite: boolean;
  siteSlug: string;
  siteUpdatedAt: string | null;
  publishedBytes: number;
  publishedBytesKnown: boolean;
  visits: PlatformAdminBackupMerchantVisits;
  visitsKnown: boolean;
};

export type PlatformAdminDataBackupSnapshot = {
  platformState: PlatformState;
  merchantSnapshot: PlatformMerchantSnapshotPayload | null;
  merchantConfigArchive: PlatformMerchantConfigArchivePayload;
  supportInbox: PlatformSupportInboxPayload;
  merchantAccounts: PlatformAdminBackupMerchantAccountItem[];
};

export type PlatformAdminDataBackupEntry = {
  id: string;
  at: string;
  operator: string;
  source: PlatformAdminDataBackupSource;
  scheduleDateKey: string | null;
  summary: string;
  userManageCounts: {
    siteCount: number;
    userCount: number;
    roleCount: number;
    merchantAccountCount: number;
    merchantSnapshotCount: number;
    merchantConfigBackupCount: number;
  };
  supportCounts: {
    threadCount: number;
    messageCount: number;
  };
  snapshot: PlatformAdminDataBackupSnapshot;
};

export type PlatformAdminDataBackupListItem = Omit<PlatformAdminDataBackupEntry, "snapshot">;

export type PlatformAdminDataBackupPayload = {
  backups: PlatformAdminDataBackupEntry[];
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoString(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeBackupSource(value: unknown): PlatformAdminDataBackupSource {
  return value === "auto" ? "auto" : "manual";
}

function normalizeScheduleDateKey(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function nextBackupId() {
  return `platform-backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeInt(value: unknown, fallback = 0, min = 0, max = 1_000_000) {
  const next = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, next));
}

function normalizeVisits(value: unknown): PlatformAdminBackupMerchantVisits {
  const input = value && typeof value === "object" ? (value as Partial<PlatformAdminBackupMerchantVisits>) : {};
  return {
    today: normalizeInt(input.today),
    day7: normalizeInt(input.day7),
    day30: normalizeInt(input.day30),
    total: normalizeInt(input.total),
  };
}

function normalizeMerchantAccountItem(value: unknown): PlatformAdminBackupMerchantAccountItem | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<PlatformAdminBackupMerchantAccountItem>;
  const merchantId = normalizeText(input.merchantId);
  const merchantName = normalizeText(input.merchantName);
  const email = normalizeText(input.email).toLowerCase();
  const username = normalizeText(input.username);
  const loginId = normalizeText(input.loginId);
  if (!merchantId && !email && !username && !loginId) return null;
  return {
    merchantId,
    merchantName,
    email,
    username,
    loginId,
    createdAt: normalizeIsoString(input.createdAt) || null,
    authUserId: normalizeText(input.authUserId) || null,
    emailConfirmed: input.emailConfirmed === true,
    emailConfirmedAt: normalizeIsoString(input.emailConfirmedAt) || null,
    lastSignInAt: normalizeIsoString(input.lastSignInAt) || null,
    manualCreated: input.manualCreated === true,
    hasPublishedSite: input.hasPublishedSite === true,
    siteSlug: normalizeText(input.siteSlug),
    siteUpdatedAt: normalizeIsoString(input.siteUpdatedAt) || null,
    publishedBytes: normalizeInt(input.publishedBytes),
    publishedBytesKnown: input.publishedBytesKnown === true,
    visits: normalizeVisits(input.visits),
    visitsKnown: input.visitsKnown === true,
  };
}

function sortMerchantAccounts(items: PlatformAdminBackupMerchantAccountItem[]) {
  return [...items].sort((left, right) => {
    const rightTs = new Date(right.createdAt ?? 0).getTime();
    const leftTs = new Date(left.createdAt ?? 0).getTime();
    if (rightTs !== leftTs) return rightTs - leftTs;
    return `${left.merchantId}:${left.email}`.localeCompare(`${right.merchantId}:${right.email}`, "en");
  });
}

function normalizePlatformAdminDataBackupSnapshot(value: unknown): PlatformAdminDataBackupSnapshot {
  const input = value && typeof value === "object" ? (value as Partial<PlatformAdminDataBackupSnapshot>) : {};
  const platformState =
    input.platformState && typeof input.platformState === "object"
      ? (input.platformState as PlatformState)
      : ({
          version: 1,
          tenants: [],
          sites: [],
          planTemplates: [],
          industryCategories: [],
          homeLayout: {
            heroTitle: "",
            heroSubtitle: "",
            featuredCategoryIds: [],
            merchantDefaultSortRule: "created_desc",
            sections: [],
          },
          roles: [],
          users: [],
          pageAssets: [],
          publishRecords: [],
          approvals: [],
          alerts: [],
          audits: [],
        } satisfies PlatformState);
  return {
    platformState,
    merchantSnapshot: input.merchantSnapshot ? normalizePlatformMerchantSnapshotPayload(input.merchantSnapshot) : null,
    merchantConfigArchive: normalizePlatformMerchantConfigArchivePayload(input.merchantConfigArchive),
    supportInbox: normalizePlatformSupportInboxPayload(input.supportInbox),
    merchantAccounts: Array.isArray(input.merchantAccounts)
      ? sortMerchantAccounts(
          input.merchantAccounts
            .map((item) => normalizeMerchantAccountItem(item))
            .filter((item): item is PlatformAdminBackupMerchantAccountItem => !!item),
        )
      : [],
  };
}

function backupTimestamp(value: PlatformAdminDataBackupEntry) {
  return new Date(value.at).getTime();
}

function countSupportMessages(payload: PlatformSupportInboxPayload) {
  return payload.threads.reduce((total, thread) => total + thread.messages.length, 0);
}

function createDefaultEntryCounts(snapshot: PlatformAdminDataBackupSnapshot) {
  return {
    userManageCounts: {
      siteCount: snapshot.platformState.sites.length,
      userCount: snapshot.platformState.users.length,
      roleCount: snapshot.platformState.roles.length,
      merchantAccountCount: snapshot.merchantAccounts.length,
      merchantSnapshotCount: snapshot.merchantSnapshot?.snapshot.length ?? 0,
      merchantConfigBackupCount: snapshot.merchantConfigArchive.backups.length,
    },
    supportCounts: {
      threadCount: snapshot.supportInbox.threads.length,
      messageCount: countSupportMessages(snapshot.supportInbox),
    },
  };
}

function normalizeBackupEntry(value: unknown): PlatformAdminDataBackupEntry | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<PlatformAdminDataBackupEntry>;
  const snapshot = normalizePlatformAdminDataBackupSnapshot(input.snapshot);
  const counts = createDefaultEntryCounts(snapshot);
  const at = normalizeIsoString(input.at);
  if (!at) return null;
  const id = normalizeText(input.id) || nextBackupId();
  return {
    id,
    at,
    operator: normalizeText(input.operator) || "平台管理员",
    source: normalizeBackupSource(input.source),
    scheduleDateKey: normalizeScheduleDateKey(input.scheduleDateKey),
    summary: normalizeText(input.summary) || "超级后台数据备份",
    userManageCounts: {
      siteCount: normalizeInt(input.userManageCounts?.siteCount, counts.userManageCounts.siteCount),
      userCount: normalizeInt(input.userManageCounts?.userCount, counts.userManageCounts.userCount),
      roleCount: normalizeInt(input.userManageCounts?.roleCount, counts.userManageCounts.roleCount),
      merchantAccountCount: normalizeInt(input.userManageCounts?.merchantAccountCount, counts.userManageCounts.merchantAccountCount),
      merchantSnapshotCount: normalizeInt(input.userManageCounts?.merchantSnapshotCount, counts.userManageCounts.merchantSnapshotCount),
      merchantConfigBackupCount: normalizeInt(input.userManageCounts?.merchantConfigBackupCount, counts.userManageCounts.merchantConfigBackupCount),
    },
    supportCounts: {
      threadCount: normalizeInt(input.supportCounts?.threadCount, counts.supportCounts.threadCount),
      messageCount: normalizeInt(input.supportCounts?.messageCount, counts.supportCounts.messageCount),
    },
    snapshot,
  };
}

function sortBackupEntries(entries: PlatformAdminDataBackupEntry[]) {
  return [...entries].sort((left, right) => {
    const rightTs = backupTimestamp(right);
    const leftTs = backupTimestamp(left);
    if (rightTs !== leftTs) return rightTs - leftTs;
    return right.id.localeCompare(left.id, "en");
  });
}

function mergeBackupEntries(...groups: Array<PlatformAdminDataBackupEntry[] | undefined>) {
  const map = new Map<string, PlatformAdminDataBackupEntry>();
  groups.forEach((group) => {
    if (!Array.isArray(group)) return;
    group.forEach((item) => {
      const existing = map.get(item.id);
      if (!existing || backupTimestamp(item) >= backupTimestamp(existing)) {
        map.set(item.id, item);
      }
    });
  });
  return sortBackupEntries([...map.values()]).slice(0, PLATFORM_ADMIN_DATA_BACKUP_MAX_RECORDS);
}

export function normalizePlatformAdminDataBackupPayload(value: unknown): PlatformAdminDataBackupPayload {
  const backups = Array.isArray((value as { backups?: unknown } | null | undefined)?.backups)
    ? (value as { backups: unknown[] }).backups
        .map((item) => normalizeBackupEntry(item))
        .filter((item): item is PlatformAdminDataBackupEntry => !!item)
    : [];
  return {
    backups: mergeBackupEntries(backups),
  };
}

export function mergePlatformAdminDataBackupPayloads(
  ...payloads: Array<PlatformAdminDataBackupPayload | null | undefined>
): PlatformAdminDataBackupPayload {
  return {
    backups: mergeBackupEntries(...payloads.map((item) => item?.backups)),
  };
}

export function createPlatformAdminDataBackupEntry(input: {
  source: PlatformAdminDataBackupSource;
  operator: string;
  summary?: string;
  scheduleDateKey?: string | null;
  snapshot: PlatformAdminDataBackupSnapshot;
}) {
  const snapshot = normalizePlatformAdminDataBackupSnapshot(input.snapshot);
  const counts = createDefaultEntryCounts(snapshot);
  return {
    id: nextBackupId(),
    at: new Date().toISOString(),
    operator: normalizeText(input.operator) || "平台管理员",
    source: normalizeBackupSource(input.source),
    scheduleDateKey: normalizeScheduleDateKey(input.scheduleDateKey),
    summary:
      normalizeText(input.summary) ||
      (input.source === "auto" ? "超级后台自动备份" : "超级后台手动备份"),
    userManageCounts: counts.userManageCounts,
    supportCounts: counts.supportCounts,
    snapshot,
  } satisfies PlatformAdminDataBackupEntry;
}

export function buildPlatformAdminDataBackupBlocks(payload: PlatformAdminDataBackupPayload) {
  return [
    {
      id: PLATFORM_ADMIN_DATA_BACKUP_BLOCK_ID,
      type: "common",
      content: "platform admin data backups",
      props: {
        isPlatformAdminDataBackup: true,
        version: PLATFORM_ADMIN_DATA_BACKUP_VERSION,
        payload: normalizePlatformAdminDataBackupPayload(payload),
      },
    },
  ];
}

export function readPlatformAdminDataBackupFromBlocks(blocks: unknown): PlatformAdminDataBackupPayload {
  if (!Array.isArray(blocks)) return { backups: [] };
  const matched = (blocks as Array<{ props?: Record<string, unknown> | null }>).find((block) => {
    const props = block?.props;
    return !!props && props.isPlatformAdminDataBackup === true;
  });
  return normalizePlatformAdminDataBackupPayload(matched?.props?.payload);
}

export function summarizePlatformAdminDataBackupEntry(entry: PlatformAdminDataBackupEntry): PlatformAdminDataBackupListItem {
  return {
    id: entry.id,
    at: entry.at,
    operator: entry.operator,
    source: entry.source,
    scheduleDateKey: entry.scheduleDateKey,
    summary: entry.summary,
    userManageCounts: entry.userManageCounts,
    supportCounts: entry.supportCounts,
  };
}

export function getMadridDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function dateKeyToUtcDayNumber(value: string) {
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function getDaysBetweenDateKeys(left: string, right: string) {
  const leftDay = dateKeyToUtcDayNumber(left);
  const rightDay = dateKeyToUtcDayNumber(right);
  if (leftDay === null || rightDay === null) return Number.POSITIVE_INFINITY;
  return rightDay - leftDay;
}

export function isPlatformAdminAutoBackupDue(
  payload: PlatformAdminDataBackupPayload,
  currentMadridDateKey = getMadridDateKey(),
) {
  const latestAutoBackup = payload.backups.find((item) => item.source === "auto");
  if (!latestAutoBackup) return true;
  const latestDateKey = latestAutoBackup.scheduleDateKey ?? getMadridDateKey(new Date(latestAutoBackup.at));
  return getDaysBetweenDateKeys(latestDateKey, currentMadridDateKey) >= 3;
}
