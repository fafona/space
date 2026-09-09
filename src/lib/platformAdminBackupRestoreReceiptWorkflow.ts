import type { PlatformAdminBackupRestorePreview } from "./platformAdminBackupRestorePreview";
import { buildPlatformAdminBackupRestoreRequest } from "./platformAdminBackupRestoreClient";
import { capturePlatformAdminBackupRestoreReceiptBinding, createPlatformAdminBackupRestoreOperationId,
  lookupPlatformAdminBackupRestoreReceiptOnce, parsePlatformAdminBackupRestoreReceiptLookup,
  type PlatformAdminBackupRestoreReceipt, type PlatformAdminBackupRestoreReceiptBinding } from "./platformAdminBackupRestoreReceiptClient";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export type PlatformAdminBackupRestoreReceiptAttempt = Readonly<{
  binding: Readonly<PlatformAdminBackupRestoreReceiptBinding>;
  /** UI continuity check only; never sent as restore authority. */
  deviceId: string;
}>;
export type PlatformAdminBackupRestoreReceiptProgress = {
  attempt: PlatformAdminBackupRestoreReceiptAttempt;
  status: "pending" | "committed" | "unknown" | "rejected";
  receipt: PlatformAdminBackupRestoreReceipt | null;
  application: "unconfirmed" | "applied";
};
const identityError = "super_admin_backup_restore_identity_unconfirmed";
function validDevice(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 && value === value.trim();
}

/** Fresh server-validated/revocation-checked identity, not localStorage device metadata.
 * Single read, no login recovery or redirect; deadline includes headers and body.
 */
export async function readPlatformAdminBackupRestoreIdentityOnce(
  fetcher: Fetcher, options: { expected?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  if (options.expected !== undefined && !validDevice(options.expected)) throw new Error(identityError);
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || options.signal?.aborted) throw new Error(identityError);
  const controller = new AbortController();
  const slot: { response: Response | null; reader: ReadableStreamDefaultReader<Uint8Array> | null } = { response: null, reader: null };
  const cancel = () => {
    controller.abort();
    if (slot.reader) void slot.reader.cancel().catch(() => undefined);
    else if (slot.response?.body) void slot.response.body.cancel().catch(() => undefined);
  };
  let stop!: () => void;
  const interrupted = new Promise<never>((_, reject) => { stop = () => { cancel(); reject(new Error(identityError)); }; });
  options.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, timeoutMs);
  const run = async () => {
    if (controller.signal.aborted) throw new Error(identityError);
    const response = await fetcher("/api/super-admin/auth/session", { method: "GET", credentials: "same-origin",
      mode: "same-origin", cache: "no-store", redirect: "error", headers: { accept: "application/json" }, signal: controller.signal });
    slot.response = response;
    if (controller.signal.aborted || response.status !== 200 || response.redirected || !response.body) { cancel(); throw new Error(identityError); }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 32_768)) throw new Error(identityError);
    const reader = response.body.getReader(); slot.reader = reader;
    const decoder = new TextDecoder("utf-8", { fatal: true }); let size = 0; let text = "";
    try {
      while (true) {
        const next = await reader.read();
        if (controller.signal.aborted) throw new Error(identityError);
        if (next.done) break;
        size += next.value.byteLength; if (size > 32_768) throw new Error(identityError);
        text += decoder.decode(next.value, { stream: true });
      }
      const value = JSON.parse(text + decoder.decode()) as Record<string, unknown> | null;
      if (!value || value.ok !== true || value.authenticated !== true || !validDevice(value.deviceId) ||
          (options.expected !== undefined && value.deviceId !== options.expected)) throw new Error(identityError);
      return value.deviceId;
    } finally {
      void reader.cancel().catch(() => undefined); reader.releaseLock(); slot.reader = null;
    }
  };
  try { return await Promise.race([run(), interrupted]); }
  catch { cancel(); throw new Error(identityError); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", stop); }
}

/** Create once at explicit confirmation, before write-ahead retention and the only PATCH. */
export function createPlatformAdminBackupRestoreReceiptAttempt(
  preview: PlatformAdminBackupRestorePreview, confirmEmpty: boolean, deviceId: string,
): PlatformAdminBackupRestoreReceiptAttempt {
  if (preview.receiptProtocol !== 1 || !validDevice(deviceId)) throw new Error(identityError);
  const operationId = createPlatformAdminBackupRestoreOperationId();
  if (!buildPlatformAdminBackupRestoreRequest(preview, confirmEmpty, operationId)) throw new Error(identityError);
  const binding = capturePlatformAdminBackupRestoreReceiptBinding({ operationId, scope: preview.scope,
    backupId: preview.backupId, confirmationToken: preview.confirmationToken });
  return Object.freeze({ binding: Object.freeze(binding), deviceId });
}

/** Validate historical metadata independently from business/local application. */
export function parsePlatformAdminBackupRestoreReceiptReply(value: unknown, attempt: PlatformAdminBackupRestoreReceiptAttempt) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.scope !== attempt.binding.scope || typeof body.replayed !== "boolean") return null;
  const lookup = parsePlatformAdminBackupRestoreReceiptLookup({ ok: body.ok, outcome: body.outcome, receipt: body.receipt }, attempt.binding);
  if (lookup?.outcome !== "committed") return null;
  if (body.replayed && ["platformState", "merchantAccounts", "threads", "merchantSnapshot", "merchantConfigArchive", "result", "backup"]
    .some((key) => Object.hasOwn(body, key))) return null;
  return { receipt: lookup.receipt, replayed: body.replayed };
}

/** Session-before / receipt-GET / session-after. Never PATCH, retry, apply or unlock.
 * Caller also invalidates its generation on UI/logout/unmount transitions.
 */
export async function lookupPlatformAdminBackupRestoreReceiptForAttempt(
  fetcher: Fetcher, attempt: PlatformAdminBackupRestoreReceiptAttempt, signal?: AbortSignal,
) {
  // Capture before awaiting; callers cannot swap identity or operation underneath a query.
  const binding = capturePlatformAdminBackupRestoreReceiptBinding(attempt.binding);
  const deviceId = attempt.deviceId;
  if (!validDevice(deviceId)) throw new Error(identityError);
  await readPlatformAdminBackupRestoreIdentityOnce(fetcher, { expected: deviceId, signal });
  const result = await lookupPlatformAdminBackupRestoreReceiptOnce(fetcher, binding, { signal });
  await readPlatformAdminBackupRestoreIdentityOnce(fetcher, { expected: deviceId, signal });
  if (signal?.aborted) throw new Error(identityError);
  return result;
}
