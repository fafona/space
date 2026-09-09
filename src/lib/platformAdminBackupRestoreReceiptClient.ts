/** Read-only historical receipt lookup. No UI state, storage, Auth material or restore replay lives here. */
export type PlatformAdminBackupRestoreReceiptBinding = {
  operationId: string;
  scope: "user_manage" | "support_messages";
  backupId: string;
  confirmationToken: string;
};
export type PlatformAdminBackupRestoreReceipt = PlatformAdminBackupRestoreReceiptBinding & {
  version: 1;
  planHash: string;
  resultHash: string;
  committedAt: string;
};
export type PlatformAdminBackupRestoreReceiptLookup =
  | { ok: true; outcome: "unknown"; receipt: null }
  | { ok: true; outcome: "committed"; receipt: PlatformAdminBackupRestoreReceipt };

export const PLATFORM_ADMIN_BACKUP_RESTORE_RECEIPT_MAX_BYTES = 32 * 1024;
const invalid = "super_admin_backup_restore_receipt_invalid_request";
const unconfirmed = "super_admin_backup_restore_receipt_lookup_unconfirmed";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const token = /^v1\.[0-9a-f]{64}$/;
const bindingKeys = ["operationId", "scope", "backupId", "confirmationToken"];
const receiptKeys = ["version", ...bindingKeys, "planHash", "resultHash", "committedAt"];

function exactDataRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) => {
    const field = descriptors[key];
    return !!field && field.enumerable && Object.hasOwn(field, "value");
  });
}

/** Capture only the public binding. The server independently binds its authenticated actor. */
export function capturePlatformAdminBackupRestoreReceiptBinding(value: unknown): PlatformAdminBackupRestoreReceiptBinding {
  try {
    if (!exactDataRecord(value, bindingKeys) || typeof value.operationId !== "string" || !uuid.test(value.operationId) ||
        (value.scope !== "user_manage" && value.scope !== "support_messages") ||
        typeof value.backupId !== "string" || value.backupId.length < 1 || value.backupId.length > 500 || value.backupId !== value.backupId.trim() ||
        typeof value.confirmationToken !== "string" || !token.test(value.confirmationToken)) throw new Error(invalid);
    return { operationId: value.operationId, scope: value.scope, backupId: value.backupId, confirmationToken: value.confirmationToken };
  } catch { throw new Error(invalid); }
}

export function isPlatformAdminBackupRestoreTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1] || (match[8] !== "Z" && (Number(match[9]) > 23 || Number(match[10]) > 59))) return false;
  return Number.isFinite(Date.parse(value));
}

/** A receipt confirms a historical commit, not that current data still equals that commit. */
export function parsePlatformAdminBackupRestoreReceiptLookup(
  value: unknown, expected: PlatformAdminBackupRestoreReceiptBinding,
): PlatformAdminBackupRestoreReceiptLookup | null {
  try {
    const binding = capturePlatformAdminBackupRestoreReceiptBinding(expected);
    if (!exactDataRecord(value, ["ok", "outcome", "receipt"]) || value.ok !== true) return null;
    if (value.outcome === "unknown") return value.receipt === null ? { ok: true, outcome: "unknown", receipt: null } : null;
    if (value.outcome !== "committed" || !exactDataRecord(value.receipt, receiptKeys)) return null;
    const receipt = value.receipt;
    if (receipt.version !== 1 || bindingKeys.some((key) => receipt[key] !== binding[key as keyof typeof binding]) ||
        typeof receipt.planHash !== "string" || !digest.test(receipt.planHash) ||
        typeof receipt.resultHash !== "string" || !digest.test(receipt.resultHash) || !isPlatformAdminBackupRestoreTimestamp(receipt.committedAt)) return null;
    return { ok: true, outcome: "committed", receipt: { version: 1, ...binding,
      planHash: receipt.planHash, resultHash: receipt.resultHash, committedAt: receipt.committedAt } };
  } catch { return null; }
}

/** Explicitly call once before a future restore send, never during status queries. No weak fallback. */
export function createPlatformAdminBackupRestoreOperationId(): string {
  try {
    const operationId = globalThis.crypto.randomUUID();
    if (!uuid.test(operationId)) throw new Error(invalid);
    return operationId;
  } catch { throw new Error(invalid); }
}

async function readSmallJson(
  response: Response, signal: AbortSignal,
  readerSlot: { current: ReadableStreamDefaultReader<Uint8Array> | null },
): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) ||
      Number(declared) > PLATFORM_ADMIN_BACKUP_RESTORE_RECEIPT_MAX_BYTES)) throw new Error(unconfirmed);
  if (!response.body) throw new Error(unconfirmed);
  const reader = response.body.getReader(); readerSlot.current = reader;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0; let text = "";
  try {
    while (true) {
      if (signal.aborted) throw new Error(unconfirmed);
      const next = await reader.read();
      if (signal.aborted) throw new Error(unconfirmed);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new Error(unconfirmed);
      size += next.value.byteLength;
      if (size > PLATFORM_ADMIN_BACKUP_RESTORE_RECEIPT_MAX_BYTES) throw new Error(unconfirmed);
      text += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    // Do not await cancellation: a faulty custom stream must not defeat the caller's deadline.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
    if (readerSlot.current === reader) readerSlot.current = null;
  }
}

/** Exactly one fixed-origin GET. Unknown/null never means the original restore was not sent. */
export async function lookupPlatformAdminBackupRestoreReceiptOnce(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  expected: PlatformAdminBackupRestoreReceiptBinding,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PlatformAdminBackupRestoreReceiptLookup> {
  const binding = capturePlatformAdminBackupRestoreReceiptBinding(expected);
  const signal = options.signal; const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error(invalid);
  if (signal?.aborted) throw new Error(unconfirmed);
  const controller = new AbortController();
  const readerSlot: { current: ReadableStreamDefaultReader<Uint8Array> | null } = { current: null };
  const responseSlot: { current: Response | null } = { current: null };
  const cancelRead = () => {
    if (readerSlot.current) void readerSlot.current.cancel().catch(() => undefined);
    else if (responseSlot.current?.body) void responseSlot.current.body.cancel().catch(() => undefined);
  };
  let stop!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => { controller.abort(); cancelRead(); reject(new Error(unconfirmed)); };
  });
  signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, timeoutMs);
  let succeeded = false;
  const request = async () => {
    if (signal?.aborted || controller.signal.aborted) throw new Error(unconfirmed);
    const query = new URLSearchParams(binding);
    const response = await fetcher(`/api/super-admin/data-backups/restore-operations?${query}`, {
      method: "GET", credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
      headers: { accept: "application/json" }, signal: controller.signal,
    });
    responseSlot.current = response;
    if (controller.signal.aborted) { cancelRead(); throw new Error(unconfirmed); }
    if (response.status !== 200 || response.redirected) throw new Error(unconfirmed);
    const body = await readSmallJson(response, controller.signal, readerSlot);
    if (controller.signal.aborted) throw new Error(unconfirmed);
    const result = parsePlatformAdminBackupRestoreReceiptLookup(body, binding);
    if (!result) throw new Error(unconfirmed);
    return result;
  };
  try {
    const result = await Promise.race([request(), interrupted]);
    succeeded = true; return result;
  } catch { throw new Error(unconfirmed); }
  finally {
    clearTimeout(timer); signal?.removeEventListener("abort", stop);
    if (!succeeded) { controller.abort(); cancelRead(); }
  }
}
