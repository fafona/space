import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { capturePlatformAdminBackupRestoreReceiptBinding, parsePlatformAdminBackupRestoreReceiptLookup,
  type PlatformAdminBackupRestoreReceipt, type PlatformAdminBackupRestoreReceiptBinding } from "./platformAdminBackupRestoreReceiptClient";
import { PlatformSnapshotAtomicError, PLATFORM_SNAPSHOT_ATOMIC_MAX_BYTES,
  preparePlatformSnapshotRestoreAtomicCommit, verifyPlatformSnapshotRestoreAtomicCommit,
  type PlatformSnapshotAtomicClient, type PlatformSnapshotAtomicWrite,
  type PlatformSnapshotRestoreAtomicView } from "./platformSnapshotAtomic.server";

export type PlatformSnapshotRestoreReceiptBinding = PlatformAdminBackupRestoreReceiptBinding & { actorKey: string };
export type PlatformSnapshotRestoreReceipt = PlatformAdminBackupRestoreReceipt & { actorKey: string };
const invalid = "platform_snapshot_atomic_invalid_request";
const unconfirmed = "platform_snapshot_atomic_write_unconfirmed";
const errors = new Set([invalid, unconfirmed, "platform_snapshot_atomic_conflict", "platform_snapshot_atomic_store_corrupt"]);
function fail(code = invalid): never { throw new PlatformSnapshotAtomicError(code); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], "value"))) fail();
}
/** Only pass the freshly verified/revocation-checked session, never a request
 * body or a device-cookie value. Stable across session renewal on this device.
 * Current super-admin auth has no distinct administrator user ID.
 */
export function platformSnapshotRestoreReceiptActorKey(session: { deviceId: string }): string {
  if (!session || typeof session.deviceId !== "string" || !session.deviceId.trim() || session.deviceId.length > 500) fail();
  return createHash("sha256").update(JSON.stringify(["faolla-platform-restore-receipt-actor-v1", session.deviceId])).digest("hex");
}
export function capturePlatformSnapshotRestoreReceiptBinding(value: unknown): PlatformSnapshotRestoreReceiptBinding {
  try {
    exact(value, ["operationId", "actorKey", "scope", "backupId", "confirmationToken"]);
    if (typeof value.actorKey !== "string" || !/^[0-9a-f]{64}$/.test(value.actorKey)) fail();
    const { actorKey, ...publicBinding } = value;
    return { ...capturePlatformAdminBackupRestoreReceiptBinding(publicBinding), actorKey };
  } catch { return fail(); }
}
function receipt(value: unknown, expected: PlatformSnapshotRestoreReceiptBinding): PlatformSnapshotRestoreReceipt {
  exact(value, ["version", "operationId", "actorKey", "scope", "backupId", "confirmationToken", "planHash", "resultHash", "committedAt"]);
  if (value.actorKey !== expected.actorKey) fail();
  const { actorKey: _actorKey, ...publicReceipt } = value;
  const { actorKey: _expectedActorKey, ...publicBinding } = expected;
  const parsed = parsePlatformAdminBackupRestoreReceiptLookup({ ok: true, outcome: "committed", receipt: publicReceipt }, publicBinding);
  if (!parsed || parsed.outcome !== "committed" || !parsed.receipt) fail();
  return { ...parsed.receipt, actorKey: expected.actorKey };
}
export function publicPlatformSnapshotRestoreReceipt(value: PlatformSnapshotRestoreReceipt): PlatformAdminBackupRestoreReceipt {
  // Explicit projection: a future internal field must not become public by default.
  return { version: 1, operationId: value.operationId, scope: value.scope, backupId: value.backupId,
    confirmationToken: value.confirmationToken, planHash: value.planHash, resultHash: value.resultHash, committedAt: value.committedAt };
}
function args(binding: PlatformSnapshotRestoreReceiptBinding) {
  return { p_operation_id: binding.operationId, p_actor_key: binding.actorKey, p_scope: binding.scope,
    p_backup_id: binding.backupId, p_confirmation_token: binding.confirmationToken };
}
async function invoke(client: PlatformSnapshotAtomicClient, name: string, input: Record<string, unknown>): Promise<unknown> {
  let response;
  try { response = await client.rpc(name, input); } catch { return fail(unconfirmed); }
  if (!response || response.error !== null || response.data === undefined || response.data === null) {
    const error = response?.error;
    if (response?.data === null && error && typeof error === "object" && !Array.isArray(error) &&
      "code" in error && error.code === "P0001" && "message" in error && typeof error.message === "string" && errors.has(error.message)) fail(error.message);
    fail(unconfirmed);
  }
  return response.data;
}
/** One read, no restore and no retry. Null means UNKNOWN, not safe-to-resend. */
export async function readPlatformSnapshotRestoreReceipt(
  client: PlatformSnapshotAtomicClient, input: PlatformSnapshotRestoreReceiptBinding,
): Promise<PlatformSnapshotRestoreReceipt | null> {
  const binding = capturePlatformSnapshotRestoreReceiptBinding(input);
  const data = await invoke(client, "faolla_read_platform_snapshot_restore_receipt_v1", args(binding));
  try {
    exact(data, ["version", "receipt"]);
    if (data.version !== 1) fail();
    return data.receipt === null ? null : receipt(data.receipt, binding);
  } catch { return fail(unconfirmed); }
}
/** Local candidate adapter, used by the receipt-enabled atomic restore route.
 * Binding and physical plan are captured before I/O; an ACK loss never causes
 * replay here. A matching DB replay returns metadata, never today's data.
 */
export async function commitPlatformSnapshotRestoreReceipt(
  client: PlatformSnapshotAtomicClient, input: PlatformSnapshotRestoreReceiptBinding,
  expected: PlatformSnapshotRestoreAtomicView, writes: readonly PlatformSnapshotAtomicWrite[],
): Promise<{ receipt: PlatformSnapshotRestoreReceipt; result: PlatformSnapshotRestoreAtomicView | null; replayed: boolean }> {
  const binding = capturePlatformSnapshotRestoreReceiptBinding(input);
  const plan = preparePlatformSnapshotRestoreAtomicCommit(expected, writes);
  if (binding.scope !== plan.expected.scope) fail();
  const inputArgs = { ...args(binding), p_catalog_expected: plan.expected.catalog.rows,
    p_target_expected: plan.expected.target.rows, p_writes: plan.writes };
  if (Buffer.byteLength(JSON.stringify(inputArgs), "utf8") > PLATFORM_SNAPSHOT_ATOMIC_MAX_BYTES) fail();
  const data = await invoke(client, "faolla_commit_platform_snapshot_restore_receipt_v1", inputArgs);
  try {
    exact(data, ["version", "receipt", "result", "replayed"]);
    if (data.version !== 1 || typeof data.replayed !== "boolean") fail();
    const committed = receipt(data.receipt, binding);
    if (data.replayed) {
      if (data.result !== null) fail();
      return { receipt: committed, result: null, replayed: true };
    }
    return { receipt: committed, result: verifyPlatformSnapshotRestoreAtomicCommit(plan, data.result), replayed: false };
  } catch { return fail(unconfirmed); }
}
