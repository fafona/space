import type { PlatformState } from "@/data/platformControlStore";
import type { PlatformAdminDataBackupRestoreScope } from "./platformAdminDataBackup";
import type { PlatformAdminBackupRestorePreview } from "./platformAdminBackupRestorePreview";
import type { PlatformSupportThread } from "./platformSupportInbox";
import { PLATFORM_ADMIN_DATA_BACKUP_SCOPE } from "./platformAdminDataBackupScope";
import { assertPlatformAdminBackupMerchantSnapshot } from "./platformAdminBackupValidation";
import { normalizePlatformMerchantSnapshotPayload } from "./platformMerchantSnapshot";
import { capturePlatformAdminBackupRestoreReceiptBinding } from "./platformAdminBackupRestoreReceiptClient";

const countKeys = {
  user_manage: ["merchant_directory", "merchant_history", "archive_backups", "archive_audits", "browser_sites", "browser_users", "browser_roles", "browser_accounts"],
  support_messages: ["support_threads", "support_messages"],
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function text(value: unknown, max = 500): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function parsePlatformAdminBackupRestorePreview(
  value: unknown,
  expected: { backupId: string; scope: PlatformAdminDataBackupRestoreScope },
): PlatformAdminBackupRestorePreview | null {
  if (!text(expected.backupId) || (expected.scope !== "user_manage" && expected.scope !== "support_messages")) return null;
  if (!record(value) || value.ok !== true || !record(value.preview)) return null;
  const preview = value.preview;
  if (Object.hasOwn(preview, "receiptProtocol") && preview.receiptProtocol !== 1) return null;
  if (preview.version !== 1 || preview.backupId !== expected.backupId || preview.scope !== expected.scope ||
      !text(preview.backupAt) || !Number.isFinite(Date.parse(preview.backupAt)) ||
      typeof preview.confirmationToken !== "string" || !/^v1\.[a-f0-9]{64}$/.test(preview.confirmationToken) ||
      !Array.isArray(preview.counts) || preview.counts.length !== countKeys[expected.scope].length ||
      typeof preview.requiresEmptyConfirmation !== "boolean" || !Array.isArray(preview.emptyKeys) ||
      !Array.isArray(preview.excluded) || !text(preview.warning, 4000)) return null;
  const counts: PlatformAdminBackupRestorePreview["counts"] = [];
  for (const [index, key] of countKeys[expected.scope].entries()) {
    const item = preview.counts[index];
    const source = key.startsWith("browser_") ? "browser" : "server";
    if (!record(item) || item.key !== key || !text(item.label) || !count(item.target) ||
        item.source !== source || (source === "browser" ? item.current !== null : !count(item.current))) return null;
    counts.push({ key, label: item.label, current: item.current as number | null, target: item.target, source });
  }
  const allEmpty = counts.every((item) => item.target === 0);
  const emptyKeys = counts.filter((item) => item.target === 0 &&
    (allEmpty || item.current === null || item.current > 0)).map((item) => item.key);
  if (preview.requiresEmptyConfirmation !== (emptyKeys.length > 0) ||
      JSON.stringify(preview.emptyKeys) !== JSON.stringify(emptyKeys) ||
      JSON.stringify(preview.excluded) !== JSON.stringify(PLATFORM_ADMIN_DATA_BACKUP_SCOPE.excluded)) return null;
  return {
    version: 1, backupId: expected.backupId, scope: expected.scope, backupAt: preview.backupAt,
    confirmationToken: preview.confirmationToken, counts, emptyKeys,
    requiresEmptyConfirmation: preview.requiresEmptyConfirmation,
    excluded: [...PLATFORM_ADMIN_DATA_BACKUP_SCOPE.excluded], warning: preview.warning,
    ...(preview.receiptProtocol === 1 ? { receiptProtocol: 1 as const } : {}),
  };
}

export function buildPlatformAdminBackupRestoreRequest(preview: PlatformAdminBackupRestorePreview, confirmEmpty: boolean, operationId?: string) {
  const checked = parsePlatformAdminBackupRestorePreview({ ok: true, preview }, preview);
  if (!checked || (checked.requiresEmptyConfirmation && confirmEmpty !== true)) return null;
  if (checked.receiptProtocol === 1) {
    try { capturePlatformAdminBackupRestoreReceiptBinding({ operationId, backupId: checked.backupId,
      scope: checked.scope, confirmationToken: checked.confirmationToken }); } catch { return null; }
  } else if (operationId !== undefined) return null;
  return {
    backupId: checked.backupId, scope: checked.scope, action: "restore" as const,
    confirmationToken: checked.confirmationToken, confirmEmpty: confirmEmpty === true,
    ...(checked.receiptProtocol === 1 ? { operationId } : {}),
  };
}

/** Unlike the general admin wrapper, a destructive restore is never automatically replayed after 401/403. */
export async function requestPlatformAdminBackupRestoreOnce(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  preview: PlatformAdminBackupRestorePreview,
  confirmEmpty: boolean,
  signal?: AbortSignal,
  operationId?: string,
) {
  const body = buildPlatformAdminBackupRestoreRequest(preview, confirmEmpty, operationId);
  if (!body) throw new Error("super_admin_backup_restore_preview_required");
  if (signal?.aborted) throw new Error("super_admin_backup_restore_response_unconfirmed");
  return fetcher("/api/super-admin/data-backups", {
    method: "PATCH", credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

/** Header completion must not leave restore or a paused writer waiting forever on a stalled body. */
export async function readPlatformAdminBackupRestoreJson(response: Response, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new Error("super_admin_backup_restore_response_unconfirmed");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      response.json() as Promise<unknown>,
      new Promise<never>((_, reject) => {
        const fail = () => reject(new Error("super_admin_backup_restore_response_unconfirmed"));
        timer = setTimeout(fail, timeoutMs);
        abort = fail;
        signal?.addEventListener("abort", fail, { once: true });
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export function parsePlatformAdminBackupRestoreAuthoritativeSnapshot(value: unknown) {
  if (!record(value) || value.ok !== true || !record(value.payload) || !text(value.payload.revision) ||
      !Array.isArray(value.payload.snapshot)) return null;
  try {
    assertPlatformAdminBackupMerchantSnapshot(value.payload);
    const payload = normalizePlatformMerchantSnapshotPayload(value.payload);
    return payload.revision === value.payload.revision && payload.snapshot.length === value.payload.snapshot.length ? payload : null;
  } catch { return null; }
}

/** POST acknowledges only the saved version; unlike GET it intentionally omits the directory. */
export function parsePlatformAdminBackupRestoreSnapshotWriteAck(value: unknown): string | null {
  if (!record(value) || value.ok !== true || !record(value.payload) || !text(value.payload.revision) ||
      (Object.hasOwn(value, "revision") && value.revision !== value.payload.revision)) return null;
  return value.payload.revision;
}

export type PlatformAdminBackupRestoreResult =
  | { scope: "user_manage"; platformState: PlatformState; merchantAccounts: Record<string, unknown>[] }
  | { scope: "support_messages"; threads: PlatformSupportThread[] };

/** Validate the UI contract before applying local projections; nested business validation remains server-side. */
export function parsePlatformAdminBackupRestoreResult(
  value: unknown,
  preview: PlatformAdminBackupRestorePreview,
): PlatformAdminBackupRestoreResult | null {
  if (!record(value) || value.ok !== true || value.scope !== preview.scope || !record(value.backup) ||
      value.backup.id !== preview.backupId || value.backup.at !== preview.backupAt) return null;
  const target = (key: string) => preview.counts.find((item) => item.key === key)?.target;
  if (preview.scope === "user_manage") {
    if (!record(value.platformState) || value.platformState.version !== 1 || !record(value.platformState.homeLayout) ||
        typeof value.platformState.homeLayout.merchantDefaultSortRule !== "string" ||
        !Array.isArray(value.merchantAccounts) || !value.merchantAccounts.every(record)) return null;
    for (const key of ["tenants", "sites", "planTemplates", "industryCategories", "roles", "users", "pageAssets", "publishRecords", "approvals", "alerts", "audits"]) {
      const items = value.platformState[key];
      if (!Array.isArray(items) || !items.every(record)) return null;
    }
    const state = value.platformState as unknown as PlatformState;
    if (state.sites.length !== target("browser_sites") || state.users.length !== target("browser_users") ||
        state.roles.length !== target("browser_roles") || value.merchantAccounts.length !== target("browser_accounts")) return null;
    return { scope: "user_manage", platformState: state, merchantAccounts: value.merchantAccounts };
  }
  if (!Array.isArray(value.threads) || !value.threads.every((item) => record(item) &&
      text(item.merchantId) && typeof item.siteId === "string" && typeof item.merchantName === "string" &&
      typeof item.merchantEmail === "string" && text(item.updatedAt) && Number.isFinite(Date.parse(item.updatedAt)) &&
      Array.isArray(item.messages) && item.messages.every((message) => record(message) && text(message.id) &&
        (message.sender === "merchant" || message.sender === "super_admin") && typeof message.text === "string" && message.text.trim().length > 0 &&
        text(message.createdAt) && Number.isFinite(Date.parse(message.createdAt))))) return null;
  const threads = value.threads as PlatformSupportThread[];
  if (threads.length !== target("support_threads") ||
      threads.reduce((sum, thread) => sum + thread.messages.length, 0) !== target("support_messages")) return null;
  return { scope: "support_messages", threads };
}

/** Only an exact, known pre-write rejection can safely release a restore pause. */
export function isPlatformAdminBackupRestoreRejectedBeforeWrite(status: number, payload: unknown) {
  if (!record(payload) || payload.ok === true || payload.retrySafe === false ||
      (Object.hasOwn(payload, "outcome") && payload.outcome !== "not_started")) return false;
  // New atomic-only rejections need an explicit pre-write outcome. This allows
  // a manual new preview, never a replay of the consumed destructive request.
  if (payload.outcome === "not_started" &&
      ((status === 404 && payload.error === "super_admin_backup_not_found") ||
       (status === 503 && payload.error === "platform_snapshot_atomic_shadow_unsupported"))) return true;
  const expected: Record<number, readonly string[]> = {
    400: ["super_admin_backup_restore_preview_required", "super_admin_backup_restore_empty_confirmation_required"],
    401: ["unauthorized"], 403: ["forbidden_origin"],
    409: ["super_admin_backup_restore_preview_stale"], 503: ["super_admin_backup_read_unavailable"],
  };
  return typeof payload.error === "string" && (expected[status]?.includes(payload.error) ?? false);
}

export function platformAdminBackupRestoreFailureMessage(error: unknown, status?: number) {
  if (status === 404 && error === "super_admin_backup_not_found") return "所选快照已不存在，尚未开始恢复。请刷新快照列表，重新选择并预览。";
  if (status === 503 && error === "platform_snapshot_atomic_shadow_unsupported") return "当前客服影子写入配置不支持原子恢复，尚未开始恢复。请先核对服务器配置，再手动重新预览；不会自动重发恢复。";
  if ((status === 401 && error === "unauthorized") || (status === 403 && error === "forbidden_origin")) return "超级后台登录或权限已失效。已停止恢复，请重新登录后重新预览；不会自动重发恢复。";
  if (status === 503 && error === "super_admin_backup_read_unavailable") return PLATFORM_ADMIN_DATA_BACKUP_SCOPE.readUnavailableNotice;
  if (status === 409 && error === "super_admin_backup_restore_preview_stale") return "快照或当前数据已发生变化，旧确认已失效。请重新预览后再决定是否恢复。";
  if (status === 400 && error === "super_admin_backup_restore_empty_confirmation_required") return "快照包含空内容，必须先预览并单独确认空内容恢复。";
  if (status === 400 && error === "super_admin_backup_restore_preview_required") return "尚无有效恢复预览，请先重新预览。";
  return "恢复未能确认完整完成，可能已有部分写入。已暂停本页配置同步，不会自动重试；请先核对服务器数据。";
}

export function createPlatformAdminBackupRestoreRequestGuard() {
  let generation = 0;
  return {
    begin: () => ++generation,
    invalidate: () => { generation += 1; },
    isCurrent: (value: number) => generation === value,
  };
}

/** Page-local coordination only: waiting for a known response is not a cross-instance database lock. */
export function createPlatformAdminBackupRestoreSyncGuard(options: { initiallyPaused?: boolean } = {}) {
  let paused = options.initiallyPaused === true;
  let unknown = false;
  let generation = 0;
  const pending = new Set<Promise<void>>();
  return {
    isPaused: () => paused,
    captureCurrent() {
      const current = generation;
      return () => !paused && current === generation;
    },
    async runWrite<T>(write: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
      if (paused) throw new Error("super_admin_backup_restore_sync_paused");
      const current = generation;
      let finish!: () => void;
      const completion = new Promise<void>((resolve) => { finish = resolve; });
      pending.add(completion);
      try {
        return await write(() => !paused && current === generation);
      } catch (error) {
        unknown = true;
        throw error;
      } finally {
        pending.delete(completion);
        finish();
      }
    },
    async pause(timeoutMs = 30_000) {
      paused = true;
      generation += 1;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([...pending]),
          new Promise<void>((resolve) => { timer = setTimeout(() => { unknown = true; resolve(); }, timeoutMs); }),
        ]);
      } finally { if (timer !== undefined) clearTimeout(timer); }
      return !unknown;
    },
    resume() {
      if (unknown || pending.size > 0) return false;
      paused = false;
      generation += 1;
      return true;
    },
    block() { unknown = true; paused = true; generation += 1; },
  };
}
