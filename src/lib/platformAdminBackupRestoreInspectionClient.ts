import { capturePlatformAdminBackupRestoreReceiptBinding, isPlatformAdminBackupRestoreTimestamp,
  parsePlatformAdminBackupRestoreReceiptLookup, type PlatformAdminBackupRestoreReceipt,
  type PlatformAdminBackupRestoreReceiptBinding } from "./platformAdminBackupRestoreReceiptClient";

export type PlatformAdminBackupRestoreInspection = {
  version: 1;
  observedAt: string;
  targetState: "matches_commit" | "differs_from_commit";
  targetHash: string;
};
export type PlatformAdminBackupRestoreInspectionResult =
  | { ok: true; outcome: "unknown"; receipt: null; inspection: null }
  | { ok: true; outcome: "committed"; receipt: PlatformAdminBackupRestoreReceipt; inspection: PlatformAdminBackupRestoreInspection };
const invalid = "super_admin_backup_restore_inspection_invalid_request";
const unconfirmed = "super_admin_backup_restore_inspection_unconfirmed";
const maxBytes = 32_768;

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"));
}

/** Evidence at one observation, never an authorization to clear a journal or resume.
 * PostgreSQL computes both hashes over its exact physical target representation.
 * The client only checks the reported relationship; it never hashes normalized data.
 */
export function parsePlatformAdminBackupRestoreInspection(
  value: unknown, expected: PlatformAdminBackupRestoreReceiptBinding,
): PlatformAdminBackupRestoreInspectionResult | null {
  try {
    const binding = capturePlatformAdminBackupRestoreReceiptBinding(expected);
    if (!exact(value, ["ok", "outcome", "receipt", "inspection"])) return null;
    const lookup = parsePlatformAdminBackupRestoreReceiptLookup({ ok: value.ok, outcome: value.outcome, receipt: value.receipt }, binding);
    if (!lookup) return null;
    if (lookup.outcome === "unknown") return value.inspection === null ? { ...lookup, inspection: null } : null;
    const observation = value.inspection;
    if (!exact(observation, ["version", "observedAt", "targetState", "targetHash"]) || observation.version !== 1 ||
        !isPlatformAdminBackupRestoreTimestamp(observation.observedAt) ||
        typeof observation.targetHash !== "string" || !/^[a-f0-9]{64}$/.test(observation.targetHash) ||
        observation.targetState !== (observation.targetHash === lookup.receipt.resultHash ? "matches_commit" : "differs_from_commit")) return null;
    return { ...lookup, inspection: { version: 1, observedAt: observation.observedAt,
      targetState: observation.targetHash === lookup.receipt.resultHash ? "matches_commit" : "differs_from_commit",
      targetHash: observation.targetHash } };
  } catch { return null; }
}

/** Exactly one same-origin inspection GET with bounded headers/body and no retry.
 * No business payload, storage access, Auth recovery or mutation belongs here.
 */
export async function inspectPlatformAdminBackupRestoreOnce(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  expected: PlatformAdminBackupRestoreReceiptBinding,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PlatformAdminBackupRestoreInspectionResult> {
  let binding;
  try { binding = capturePlatformAdminBackupRestoreReceiptBinding(expected); } catch { throw new Error(invalid); }
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error(invalid);
  if (options.signal?.aborted) throw new Error(unconfirmed);
  const controller = new AbortController();
  const slot: { response: Response | null; reader: ReadableStreamDefaultReader<Uint8Array> | null } = { response: null, reader: null };
  const cancel = () => {
    controller.abort();
    if (slot.reader) void slot.reader.cancel().catch(() => undefined);
    else if (slot.response?.body) void slot.response.body.cancel().catch(() => undefined);
  };
  let stop!: () => void;
  const interrupted = new Promise<never>((_, reject) => { stop = () => { cancel(); reject(new Error(unconfirmed)); }; });
  options.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, timeoutMs);
  const run = async () => {
    if (controller.signal.aborted) throw new Error(unconfirmed);
    const response = await fetcher(`/api/super-admin/data-backups/restore-inspection?${new URLSearchParams(binding)}`, {
      method: "GET", credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
      headers: { accept: "application/json" }, signal: controller.signal,
    });
    slot.response = response;
    if (controller.signal.aborted || response.status !== 200 || response.redirected || !response.body) { cancel(); throw new Error(unconfirmed); }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Error(unconfirmed);
    const reader = response.body.getReader(); slot.reader = reader;
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0; let text = "";
    try {
      while (true) {
        const next = await reader.read();
        if (controller.signal.aborted) throw new Error(unconfirmed);
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) throw new Error(unconfirmed);
        bytes += next.value.byteLength; if (bytes > maxBytes) throw new Error(unconfirmed);
        text += decoder.decode(next.value, { stream: true });
      }
      const result = parsePlatformAdminBackupRestoreInspection(JSON.parse(text + decoder.decode()), binding);
      if (!result) throw new Error(unconfirmed);
      return result;
    } finally {
      void reader.cancel().catch(() => undefined); reader.releaseLock(); slot.reader = null;
    }
  };
  try { return await Promise.race([run(), interrupted]); }
  catch { cancel(); throw new Error(unconfirmed); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", stop); }
}
