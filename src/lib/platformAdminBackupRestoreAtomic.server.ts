import { createHash } from "node:crypto";
import { summarizePlatformAdminDataBackupEntry, type PlatformAdminDataBackupRestoreScope } from "./platformAdminDataBackup";
import { readPlatformAdminDataBackupAtomicView } from "./platformAdminDataBackupAtomic.server";
import { buildPlatformAdminBackupRestorePreview, matchesPlatformAdminBackupRestorePreviewToken,
  type PlatformAdminBackupRestoreCurrent } from "./platformAdminBackupRestorePreview.server";
import { readPlatformMerchantUserManageAtomicView } from "./platformMerchantUserManageAtomic.server";
import { preparePlatformMerchantUserManageRestoreAtomic } from "./platformMerchantUserManageRestoreAtomic.server";
import { assertPlatformSupportInboxAtomicRestoreAvailable, readPlatformSupportInboxAtomicView,
  preparePlatformSupportInboxRestoreAtomic } from "./platformSupportInboxAtomic.server";
import { readPlatformSnapshotRestoreAtomic, PlatformSnapshotAtomicError,
  type PlatformSnapshotAtomicClient } from "./platformSnapshotAtomic.server";
import { capturePlatformSnapshotRestoreReceiptBinding, readPlatformSnapshotRestoreReceipt,
  commitPlatformSnapshotRestoreReceipt, publicPlatformSnapshotRestoreReceipt,
  type PlatformSnapshotRestoreReceiptBinding } from "./platformSnapshotRestoreReceipt.server";

export type PlatformAdminBackupRestoreAtomicRequest = {
  backupId: string; scope: PlatformAdminDataBackupRestoreScope; action: "preview" | "restore";
  confirmationToken?: unknown; confirmEmpty?: unknown; operationId?: unknown;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const errorResult = (status: number, error: string, started = false) => ({ status, body: {
  error, outcome: started ? "partial_or_unknown" : "not_started", ...(started ? { retrySafe: false } : {}),
} });

/** Auth and same-origin checks remain at the route. No body-supplied restore
 * content or write set is accepted. A new read binds preview and commit to
 * the same physical catalog + target; the DB rechecks both inside the commit.
 */
export async function handlePlatformAdminBackupRestoreAtomic(
  client: PlatformSnapshotAtomicClient, value: unknown, context?: { actorKey: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  let started = false;
  let queryingReceipt = false;
  try {
    if (!context || typeof context.actorKey !== "string" || !/^[0-9a-f]{64}$/.test(context.actorKey)) {
      return errorResult(503, "super_admin_backup_restore_identity_unavailable");
    }
    const actorKey = context.actorKey;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return errorResult(400, "super_admin_backup_restore_invalid_payload");
    }
    const raw = value as Record<string, unknown>;
    const fields = raw.action === "preview" ? ["backupId", "scope", "action"]
      : ["backupId", "scope", "action", "confirmationToken", "confirmEmpty", "operationId"];
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(raw)) || Reflect.ownKeys(raw).length !== fields.length ||
        fields.some((key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], "value"))) {
      return errorResult(400, "super_admin_backup_restore_invalid_payload");
    }
    // Capture primitive request values before awaiting a database read.
    const request = { backupId: raw.backupId, scope: raw.scope, action: raw.action,
      confirmationToken: raw.confirmationToken, confirmEmpty: raw.confirmEmpty, operationId: raw.operationId };
    if (!request.backupId || typeof request.backupId !== "string" ||
      request.backupId !== request.backupId.trim() || request.backupId.length > 500 ||
      (request.scope !== "user_manage" && request.scope !== "support_messages") ||
      (request.action !== "preview" && request.action !== "restore")) {
      return errorResult(400, "super_admin_backup_restore_invalid_payload");
    }
    let binding: PlatformSnapshotRestoreReceiptBinding | null = null;
    if (request.action === "restore") {
      try {
        if (typeof request.confirmEmpty !== "boolean") throw new Error("invalid");
        binding = capturePlatformSnapshotRestoreReceiptBinding({ actorKey, operationId: request.operationId,
          scope: request.scope, backupId: request.backupId, confirmationToken: request.confirmationToken });
      } catch { return errorResult(400, "super_admin_backup_restore_invalid_payload"); }
      // Historical confirmation is independent of today's catalog, target and
      // shadow settings. Never reconstruct a plan or expose today's data here.
      queryingReceipt = true;
      const existing = await readPlatformSnapshotRestoreReceipt(client, binding);
      queryingReceipt = false;
      if (existing) return { status: 200, body: { ok: true, scope: request.scope, outcome: "committed",
        replayed: true, receipt: publicPlatformSnapshotRestoreReceipt(existing) } };
    }
    if (request.scope === "support_messages") assertPlatformSupportInboxAtomicRestoreAvailable();
    const physical = await readPlatformSnapshotRestoreAtomic(client, request.scope);
    const backup = readPlatformAdminDataBackupAtomicView(physical.catalog).backups.find((entry) => entry.id === request.backupId);
    if (!backup) return errorResult(404, "super_admin_backup_not_found");
    let current: PlatformAdminBackupRestoreCurrent;
    let plan;
    let effectiveBackup = backup;
    if (request.scope === "user_manage") {
      const before = readPlatformMerchantUserManageAtomicView(physical.target);
      current = { scope: request.scope, merchantSnapshot: before.snapshot, merchantConfigArchive: before.archive };
      const prepared = preparePlatformMerchantUserManageRestoreAtomic(physical.target,
        backup.snapshot.merchantSnapshot, backup.snapshot.merchantConfigArchive);
      plan = prepared;
      // Counts describe the actual merge/replace plan rather than implying that
      // restoring an old directory deletes merchants absent from that backup.
      effectiveBackup = { ...backup, snapshot: { ...backup.snapshot,
        merchantSnapshot: prepared.snapshot, merchantConfigArchive: prepared.archive } };
    } else {
      current = { scope: request.scope, supportInbox: readPlatformSupportInboxAtomicView(physical.target) };
      plan = preparePlatformSupportInboxRestoreAtomic(physical.target, backup.snapshot.supportInbox);
    }
    const preview = buildPlatformAdminBackupRestorePreview(effectiveBackup, current);
    // Bind raw row IDs/JSON/microseconds, not the normalized business projection
    // or newly generated revision/history IDs which change on every plan build.
    preview.confirmationToken = `v1.${createHash("sha256").update(canonical({
      domain: "faolla-application-snapshot-atomic-restore-preview-v2", receiptProtocol: 1,
      actorKey, backupId: request.backupId, physical,
    })).digest("hex")}`;
    preview.warning = "数量按本次服务器恢复计划计算。确认会同时核对备份来源与目标版本；任一变化需重新预览。事务仅包含所选服务器快照范围，不包含浏览器本地配置、真实登录账号、员工权限或客服影子表。浏览器本地内容仍需单独应用；结果未知时不要重复恢复。";
    if (request.action === "preview") return { status: 200, body: { ok: true, preview: { ...preview, receiptProtocol: 1 } } };
    if (!matchesPlatformAdminBackupRestorePreviewToken(request.confirmationToken, preview)) {
      return errorResult(409, "super_admin_backup_restore_preview_stale");
    }
    if (preview.requiresEmptyConfirmation && !request.confirmEmpty) {
      return errorResult(400, "super_admin_backup_restore_empty_confirmation_required");
    }
    // Recheck process configuration after the await too; never start a separate
    // mirror or fallback write to complete this protocol.
    if (request.scope === "support_messages") assertPlatformSupportInboxAtomicRestoreAvailable();
    if (!binding) return errorResult(400, "super_admin_backup_restore_invalid_payload");
    started = true;
    const committed = await commitPlatformSnapshotRestoreReceipt(client, binding, physical, plan.writes);
    const metadata = { outcome: "committed", replayed: committed.replayed,
      receipt: publicPlatformSnapshotRestoreReceipt(committed.receipt) };
    if (committed.replayed) return { status: 200, body: { ok: true, scope: request.scope, ...metadata } };
    if (!committed.result) throw new Error("unconfirmed");
    if (request.scope === "user_manage") {
      const actual = readPlatformMerchantUserManageAtomicView(committed.result.target);
      return { status: 200, body: { ok: true, scope: request.scope, ...metadata, backup: summarizePlatformAdminDataBackupEntry(backup),
        platformState: backup.snapshot.platformState, merchantAccounts: backup.snapshot.merchantAccounts,
        merchantSnapshot: actual.snapshot, merchantConfigArchive: actual.archive } };
    }
    return { status: 200, body: { ok: true, scope: request.scope, ...metadata, backup: summarizePlatformAdminDataBackupEntry(backup),
      threads: readPlatformSupportInboxAtomicView(committed.result.target).threads } };
  } catch (error) {
    if (queryingReceipt) return errorResult(503, "super_admin_backup_restore_incomplete", true);
    if (!started && error instanceof PlatformSnapshotAtomicError && error.message === "platform_snapshot_atomic_conflict") {
      // Only a conflict observed before sending the receipt commit is a safe
      // pre-write rejection. Commit conflicts also cover an occupied operation ID.
      return errorResult(409, "super_admin_backup_restore_preview_stale");
    }
    if (!started && error instanceof Error && error.message === "platform_snapshot_atomic_shadow_unsupported") {
      return errorResult(503, "platform_snapshot_atomic_shadow_unsupported");
    }
    return errorResult(started ? 500 : 503, started ? "super_admin_backup_restore_incomplete" : "super_admin_backup_read_unavailable", started);
  }
}
