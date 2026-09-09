import { createHash } from "node:crypto";
import type { PlatformAdminDataBackupEntry, PlatformAdminDataBackupRestoreScope } from "./platformAdminDataBackup";
import type { PlatformMerchantSnapshotPayload } from "./platformMerchantSnapshot";
import type { PlatformMerchantConfigArchivePayload } from "./platformMerchantConfigArchive";
import type { PlatformSupportInboxPayload } from "./platformSupportInbox";
import type { PlatformAdminBackupRestorePreview } from "./platformAdminBackupRestorePreview";
import { PLATFORM_ADMIN_DATA_BACKUP_SCOPE } from "./platformAdminDataBackupScope";

export type PlatformAdminBackupRestoreCurrent =
  | { scope: "user_manage"; merchantSnapshot: PlatformMerchantSnapshotPayload | null; merchantConfigArchive: PlatformMerchantConfigArchivePayload }
  | { scope: "support_messages"; supportInbox: PlatformSupportInboxPayload };

function canonicalJson(value: unknown): string {
  // Inputs have already passed the backup-specific shape validation. Roundtrip
  // matches stored JSON semantics (optional undefined object fields are omitted).
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, sort(nested)]),
    );
    return item;
  };
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}

function historyCount(snapshot: PlatformMerchantSnapshotPayload | null) {
  return Object.values(snapshot?.merchantConfigHistoryBySiteId ?? {}).reduce((count, entries) => count + entries.length, 0);
}

function messageCount(inbox: PlatformSupportInboxPayload) {
  return inbox.threads.reduce((count, thread) => count + thread.messages.length, 0);
}

export function buildPlatformAdminBackupRestorePreview(
  target: PlatformAdminDataBackupEntry,
  current: PlatformAdminBackupRestoreCurrent,
): PlatformAdminBackupRestorePreview {
  const counts: PlatformAdminBackupRestorePreview["counts"] = [];
  const server = (key: string, label: string, before: number, after: number) =>
    counts.push({ key, label, current: before, target: after, source: "server" });
  const browser = (key: string, label: string, after: number) =>
    counts.push({ key, label, current: null, target: after, source: "browser" });
  if (current.scope === "user_manage") {
    server("merchant_directory", "商户目录条目", current.merchantSnapshot?.snapshot.length ?? 0, target.snapshot.merchantSnapshot?.snapshot.length ?? 0);
    server("merchant_history", "商户配置历史（既有保存逻辑会合并）", historyCount(current.merchantSnapshot), historyCount(target.snapshot.merchantSnapshot));
    server("archive_backups", "配置归档快照", current.merchantConfigArchive.backups.length, target.snapshot.merchantConfigArchive.backups.length);
    server("archive_audits", "配置归档记录", current.merchantConfigArchive.audits.length, target.snapshot.merchantConfigArchive.audits.length);
    // These are browser-local display/configuration collections, not real Auth
    // accounts or employee roles. Their current contents are not server-observed.
    browser("browser_sites", "本浏览器后台站点配置", target.snapshot.platformState.sites.length);
    browser("browser_users", "本浏览器后台用户配置（非登录身份）", target.snapshot.platformState.users.length);
    browser("browser_roles", "本浏览器后台角色配置（非员工权限）", target.snapshot.platformState.roles.length);
    browser("browser_accounts", "本浏览器商户账号展示摘要", target.snapshot.merchantAccounts.length);
  } else {
    server("support_threads", "平台客服会话", current.supportInbox.threads.length, target.snapshot.supportInbox.threads.length);
    server("support_messages", "平台客服消息", messageCount(current.supportInbox), messageCount(target.snapshot.supportInbox));
  }
  // An entirely empty scope, a known nonempty->empty collection, or an empty
  // browser collection whose current content cannot be checked needs explicit consent.
  const allEmpty = counts.every((item) => item.target === 0);
  const emptyKeys = counts.filter((item) => item.target === 0 &&
    (allEmpty || item.current === null || item.current > 0)).map((item) => item.key);
  const confirmationToken = `v1.${createHash("sha256").update(canonicalJson({
    domain: "faolla-application-snapshot-restore-preview-v1", target, current,
  })).digest("hex")}`;
  return {
    version: 1, backupId: target.id, backupAt: target.at, scope: current.scope,
    confirmationToken, counts, requiresEmptyConfirmation: emptyKeys.length > 0, emptyKeys,
    excluded: [...PLATFORM_ADMIN_DATA_BACKUP_SCOPE.excluded],
    warning: `${PLATFORM_ADMIN_DATA_BACKUP_SCOPE.restoreScopes[current.scope].warning} 数量为当前已读取内容与快照内容对比，不是逐条变更清单；本浏览器当前数据未由服务器核对。预览校验不是数据库锁，不能排除首写之后的并发或分步失败。`,
  };
}

export function matchesPlatformAdminBackupRestorePreviewToken(value: unknown, preview: PlatformAdminBackupRestorePreview) {
  return typeof value === "string" && /^v1\.[a-f0-9]{64}$/.test(value) && value === preview.confirmationToken;
}

export function isPlatformAdminBackupRestoreAction(value: unknown): value is "preview" | "restore" {
  return value === "preview" || value === "restore";
}

export function isPlatformAdminBackupRestoreScope(value: unknown): value is PlatformAdminDataBackupRestoreScope {
  return value === "user_manage" || value === "support_messages";
}
