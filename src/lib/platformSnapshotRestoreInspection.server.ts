import { Buffer } from "node:buffer";
import { parsePlatformAdminBackupRestoreInspection,
  type PlatformAdminBackupRestoreInspection } from "./platformAdminBackupRestoreInspectionClient";
import { capturePlatformSnapshotRestoreReceiptBinding,
  type PlatformSnapshotRestoreReceipt, type PlatformSnapshotRestoreReceiptBinding } from "./platformSnapshotRestoreReceipt.server";
import { PlatformSnapshotAtomicError, type PlatformSnapshotAtomicClient } from "./platformSnapshotAtomic.server";

export type PlatformSnapshotRestoreInspection =
  | { receipt: null; inspection: null }
  | { receipt: PlatformSnapshotRestoreReceipt; inspection: PlatformAdminBackupRestoreInspection };
const unconfirmed = "platform_snapshot_restore_inspection_unconfirmed";
function fail(): never { throw new PlatformSnapshotAtomicError(unconfirmed); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some((key) =>
    !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], "value"))) fail();
}

/** One bounded read of historical metadata plus the current target hash. No
 * commit, receipt rewrite, fallback, retry, business data or journal clearing.
 * Timeout abandons the result; the injected RPC API cannot cancel its SQL read.
 */
export async function readPlatformSnapshotRestoreInspection(
  client: PlatformSnapshotAtomicClient, value: PlatformSnapshotRestoreReceiptBinding,
  options: { timeoutMs?: number } = {},
): Promise<PlatformSnapshotRestoreInspection> {
  const binding = capturePlatformSnapshotRestoreReceiptBinding(value);
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new PlatformSnapshotAtomicError("platform_snapshot_atomic_invalid_request");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      Promise.resolve(client.rpc("faolla_inspect_platform_snapshot_restore_receipt_v1", {
        p_operation_id: binding.operationId, p_actor_key: binding.actorKey, p_scope: binding.scope,
        p_backup_id: binding.backupId, p_confirmation_token: binding.confirmationToken,
      })),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new PlatformSnapshotAtomicError(unconfirmed)), timeoutMs);
      }),
    ]);
    if (!response || response.error !== null || response.data === undefined || response.data === null) fail();
    const data = response.data;
    exact(data, ["version", "receipt", "inspection"]);
    if (data.version !== 1) fail();
    const { actorKey, ...publicBinding } = binding;
    let publicReceipt: Record<string, unknown> | null = null;
    if (data.receipt !== null) {
      exact(data.receipt, ["version", "operationId", "actorKey", "scope", "backupId", "confirmationToken", "planHash", "resultHash", "committedAt"]);
      if (data.receipt.actorKey !== actorKey) fail();
      publicReceipt = { version: data.receipt.version, operationId: data.receipt.operationId,
        scope: data.receipt.scope, backupId: data.receipt.backupId,
        confirmationToken: data.receipt.confirmationToken, planHash: data.receipt.planHash,
        resultHash: data.receipt.resultHash, committedAt: data.receipt.committedAt };
    }
    if (data.inspection !== null) exact(data.inspection, ["version", "observedAt", "targetState", "targetHash"]);
    const parsed = parsePlatformAdminBackupRestoreInspection({ ok: true,
      outcome: publicReceipt ? "committed" : "unknown", receipt: publicReceipt, inspection: data.inspection }, publicBinding);
    if (!parsed || Buffer.byteLength(JSON.stringify(parsed), "utf8") > 32_768) fail();
    return parsed.outcome === "unknown" ? { receipt: null, inspection: null }
      : { receipt: { ...parsed.receipt, actorKey }, inspection: parsed.inspection };
  } catch { return fail(); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
