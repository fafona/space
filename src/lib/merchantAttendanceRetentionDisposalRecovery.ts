// Recovery does not need current ownership or admit a fresh disposal. It can
// only read the original actor's one saved operation and compare its full hash.
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { AttendanceRetentionDisposalExecutionClient, disposalExecutionPendingKey, parseDisposalExecutionPending } from "./merchantAttendanceRetentionDisposalExecutionClient";
import { DISPOSAL_EXECUTION_API, parseDisposalExecutionJson, parseDisposalExecutionHttpQuery, type DisposalExecutionReceipt } from "./merchantAttendanceRetentionDisposalExecution";
import type { AccountStatusRecoveryOptions } from "./merchantAttendanceAccountStatusRecovery";
import type { DelegationRecoveryStorage } from "./merchantAttendanceDelegationRecovery";
export type KnownRetentionDisposalRecovery = Readonly<{ kind: "retention-disposal"; storageKey: string; siteId: string; authUserId: string; operationId: string; commandFingerprint: string }>;
const prefix = "faolla:attendance:retention-disposal:v1:";
function lease(auth: () => boolean, signal?: AbortSignal) {
  const controller = new AbortController(), deadline = performance.now() + 12000, abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort(); const timer = setTimeout(abort, 12000);
  const current = () => !controller.signal.aborted && performance.now() < deadline && auth() && !(typeof document !== "undefined" && document.hidden);
  const guard = () => { if (!current()) throw Error("recovery_scope_changed"); };
  const wait = async <T,>(work: () => Promise<T>): Promise<T> => { guard(); let stop!: () => void;
    const interrupted = new Promise<never>((_, reject) => { stop = () => reject(Error("recovery_scope_changed")); controller.signal.addEventListener("abort", stop, { once: true }); });
    try { guard(); const result = await Promise.race([work(), interrupted]); guard(); return result; } finally { controller.signal.removeEventListener("abort", stop); } };
  return { current, guard, wait, signal: controller.signal, close: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); abort(); } };
}
async function local(key: string, raw: string, auth: string, l: ReturnType<typeof lease>) {
  l.guard(); const match = /^faolla:attendance:retention-disposal:v1:(\d{8}):([0-9a-f-]{36})$/.exec(key);
  if (!match || key.length > 160) throw Error("invalid_recovery_key");
  const saved = captureBrowserExact(parseDisposalExecutionJson(raw, "request"), ["protocol", "version", "actorId", "query", "command", "commandFingerprint"]);
  if (saved.actorId !== auth) return null;
  if (match[2] !== auth || disposalExecutionPendingKey(match[1], auth) !== key) throw Error("invalid_recovery_key");
  const pending = await l.wait(() => parseDisposalExecutionPending(raw, { siteId: match[1], authUserId: auth }));
  const entry: KnownRetentionDisposalRecovery = Object.freeze({ kind: "retention-disposal", storageKey: key, siteId: match[1], authUserId: auth,
    operationId: pending.command.operationId, commandFingerprint: pending.commandFingerprint });
  return { entry, pending };
}
export async function listKnownRetentionDisposalRecoveries(storage: DelegationRecoveryStorage, authUserId: string, isCurrentAuth: () => boolean, signal?: AbortSignal) {
  const l = lease(isCurrentAuth, signal);
  try { l.guard(); disposalExecutionPendingKey("00000000", authUserId); const count = storage.length; l.guard();
    if (!Number.isSafeInteger(count) || count < 0 || count > 2048) throw Error("recovery_storage_limit");
    const keys: string[] = []; for (let n = 0; n < count; n++) { l.guard(); const key = storage.key(n); l.guard(); if (key?.startsWith(prefix)) keys.push(key); }
    if (keys.length > 64 || new Set(keys).size !== keys.length) throw Error("recovery_storage_limit");
    const entries: KnownRetentionDisposalRecovery[] = []; let invalid = false;
    for (const key of keys) { try { const raw = storage.getItem(key); l.guard(); if (raw === null) continue; const parsed = await local(key, raw, authUserId, l);
      l.guard(); const now = storage.getItem(key); l.guard(); if (raw !== now) { invalid = true; continue; } if (parsed) entries.push(parsed.entry);
    } catch { l.guard(); invalid = true; } }
    return Object.freeze({ entries: Object.freeze(entries), invalid });
  } finally { l.close(); }
}
export async function recoverKnownRetentionDisposal(entry: KnownRetentionDisposalRecovery, options: AccountStatusRecoveryOptions): Promise<DisposalExecutionReceipt | null> {
  const l = lease(options.isCurrentAuth, options.signal); let client: AttendanceRetentionDisposalExecutionClient | undefined;
  const stop = () => client?.pause(); l.signal.addEventListener("abort", stop, { once: true });
  try { l.guard(); const auth = options.authenticatedUserId; disposalExecutionPendingKey(entry.siteId, auth); if (entry.authUserId !== auth) throw Error("recovery_scope_changed");
    const original = options.storage.getItem(entry.storageKey); l.guard(); if (original === null) throw Error("recovery_record_changed");
    const parsed = await local(entry.storageKey, original, auth, l); l.guard(); if (!parsed || JSON.stringify(parsed.entry) !== JSON.stringify(entry)) throw Error("recovery_record_changed");
    const expected = { siteId: entry.siteId, mode: "recover", eventId: null, operationId: entry.operationId };
    const storage = { getItem: (key: string) => { l.guard(); if (key !== entry.storageKey) throw Error("recovery_key_changed"); const raw = options.storage.getItem(key); l.guard(); return raw; },
      setItem: () => { throw Error("recovery_is_read_only"); }, removeItem: (key: string) => { l.guard(); if (key !== entry.storageKey) throw Error("recovery_key_changed");
        const now = options.storage.getItem(key); l.guard(); if (now !== original) throw Error("recovery_record_changed"); options.storage.removeItem(key); l.guard(); } };
    client = new AttendanceRetentionDisposalExecutionClient({ siteId: entry.siteId, authUserId: auth, enabled: false, isCurrentAuth: l.current, storage: () => storage,
      apiFetch: async (path, init) => { l.guard(); if (init?.method !== "GET" || init.body != null || !path.startsWith(DISPOSAL_EXECUTION_API + "?")) throw Error("recovery_is_read_only");
        const query = parseDisposalExecutionHttpQuery("https://recovery.invalid" + path); if (JSON.stringify(query) !== JSON.stringify(expected)) throw Error("recovery_query_changed");
        const response = await options.apiFetch(path, init); if (!l.current()) { void response.body?.cancel().catch(() => {}); throw Error("recovery_scope_changed"); } return response; } });
    await l.wait(() => client!.initialize()); if (JSON.stringify(client.getSnapshot().pending) !== JSON.stringify(parsed.pending)) throw Error("recovery_record_changed");
    await l.wait(() => client!.recover()); l.guard(); const state = client.getSnapshot(), result = state.result;
    if (state.pending || result?.data.kind !== "receipt" || !result.data.receipt) return null;
    const receipt = result.data.receipt;
    if (result.actorId !== auth || receipt.actorId !== auth || receipt.operationId !== entry.operationId || receipt.commandFingerprint !== entry.commandFingerprint) throw Error("recovery_receipt_changed");
    return Object.freeze(receipt);
  } finally { l.signal.removeEventListener("abort", stop); client?.dispose(); l.close(); }
}
