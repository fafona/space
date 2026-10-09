// Independent original-actor recovery. No owner lookup, catalogs, rules display,
// scope adoption, POST retry, or deletion of an unknown outcome.
import { captureBrowserExact, captureBrowserUuid } from "./merchantAttendanceRuleCapturesBrowser";
import { AttendanceOperationalPunchActivationClient, operationalPunchActivationPendingKey, parseOperationalPunchActivationPending } from "./merchantAttendanceOperationalPunchActivationClient";
import { operationalRuleLedgerEqual } from "./merchantAttendanceOperationalRuleLedger";
import { OPERATIONAL_PUNCH_ACTIVATION_API, parseOperationalPunchActivationJson, parseOperationalPunchActivationHttpQuery,
  type OperationalPunchActivationItem } from "./merchantAttendanceOperationalPunchActivation";
import type { AccountStatusRecoveryOptions } from "./merchantAttendanceAccountStatusRecovery";
import type { DelegationRecoveryStorage } from "./merchantAttendanceDelegationRecovery";

export type KnownOperationalPunchActivationRecovery = Readonly<{ kind: "operational-punch-activation"; storageKey: string; siteId: string; authUserId: string; operationId: string; commandFingerprint: string }>;
export const OPERATIONAL_PUNCH_ACTIVATION_RECOVERY_PREFIX = /^faolla:attendance:operational-punch-activation:v1:/;
function lease(auth: () => boolean, signal?: AbortSignal) {
  const controller = new AbortController(), deadline = performance.now() + 12000, abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort(); const timer = setTimeout(abort, 12000);
  const current = () => !controller.signal.aborted && performance.now() < deadline && auth() && !(typeof document !== "undefined" && document.hidden);
  const guard = () => { if (!current()) throw Error("recovery_scope_changed"); };
  const wait = async <T,>(work: () => Promise<T>): Promise<T> => { guard(); let stop!: () => void;
    const ended = new Promise<never>((_, reject) => { stop = () => reject(Error("recovery_scope_changed")); controller.signal.addEventListener("abort", stop, { once: true }); });
    try { guard(); const value = await Promise.race([work(), ended]); guard(); return value; } finally { controller.signal.removeEventListener("abort", stop); } };
  return { current, guard, wait, signal: controller.signal, close: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); abort(); } };
}
type Lease = ReturnType<typeof lease>;
async function local(key: string, raw: string, auth: string, l: Lease) {
  l.guard(); const match = /^faolla:attendance:operational-punch-activation:v1:(\d{8}):([0-9a-f-]{36})$/.exec(key);
  if (!match || key.length > 180) throw Error("invalid_recovery_key");
  const saved = captureBrowserExact(parseOperationalPunchActivationJson(raw, true), ["version", "actorId", "query", "command", "commandFingerprint"]);
  if (captureBrowserUuid(saved.actorId) !== auth) return null;
  const siteId = match[1]; if (captureBrowserUuid(match[2]) !== auth || operationalPunchActivationPendingKey(siteId, auth) !== key) throw Error("invalid_recovery_key");
  const pending = await l.wait(() => parseOperationalPunchActivationPending(raw, { siteId, actorId: auth })); l.guard();
  const entry: KnownOperationalPunchActivationRecovery = Object.freeze({ kind: "operational-punch-activation", storageKey: key, siteId, authUserId: auth, operationId: pending.command.operationId, commandFingerprint: pending.commandFingerprint });
  return { entry, pending };
}
export async function listKnownOperationalPunchActivationRecoveries(storage: DelegationRecoveryStorage, authenticatedUserId: string, isCurrentAuth: () => boolean, signal?: AbortSignal) {
  const l = lease(isCurrentAuth, signal); try { l.guard(); const auth = captureBrowserUuid(authenticatedUserId), count = storage.length; l.guard();
    if (!Number.isSafeInteger(count) || count < 0 || count > 2048) throw Error("recovery_storage_limit");
    const keys: string[] = []; for (let n = 0; n < count; n++) { l.guard(); const key = storage.key(n); l.guard(); if (key && OPERATIONAL_PUNCH_ACTIVATION_RECOVERY_PREFIX.test(key)) keys.push(key); }
    if (keys.length > 64 || new Set(keys).size !== keys.length) throw Error("recovery_storage_limit");
    const entries: KnownOperationalPunchActivationRecovery[] = []; let invalid = false;
    for (const key of keys) { try { const raw = storage.getItem(key); l.guard(); if (raw === null) continue;
      const parsed = await local(key, raw, auth, l); l.guard(); const now = storage.getItem(key); l.guard(); if (raw !== now) { invalid = true; continue; } if (parsed) entries.push(parsed.entry);
    } catch { l.guard(); invalid = true; } }
    return Object.freeze({ entries: Object.freeze(entries), invalid });
  } finally { l.close(); }
}
export async function recoverKnownOperationalPunchActivation(entry: KnownOperationalPunchActivationRecovery, options: AccountStatusRecoveryOptions): Promise<OperationalPunchActivationItem | null> {
  const l = lease(options.isCurrentAuth, options.signal); let client: AttendanceOperationalPunchActivationClient | undefined;
  const stop = () => client?.pause(); l.signal.addEventListener("abort", stop, { once: true });
  try { l.guard(); const auth = captureBrowserUuid(options.authenticatedUserId); if (entry.authUserId !== auth) throw Error("recovery_scope_changed");
    const original = options.storage.getItem(entry.storageKey); l.guard(); if (original === null) throw Error("recovery_record_changed");
    const parsed = await local(entry.storageKey, original, auth, l); l.guard(); if (!parsed || !operationalRuleLedgerEqual(parsed.entry, entry)) throw Error("recovery_record_changed");
    const expected = { siteId: entry.siteId, mode: "recover", operationId: entry.operationId };
    const locked = { getItem: (key: string) => { l.guard(); if (key !== entry.storageKey) throw Error("recovery_key_changed"); const raw = options.storage.getItem(key); l.guard(); return raw; },
      setItem: () => { throw Error("recovery_is_read_only"); }, removeItem: (key: string) => { l.guard(); if (key !== entry.storageKey) throw Error("recovery_key_changed"); const now = options.storage.getItem(key); l.guard(); if (now !== original) throw Error("recovery_record_changed"); options.storage.removeItem(key); l.guard(); } };
    client = new AttendanceOperationalPunchActivationClient({ siteId: entry.siteId, actorId: auth, enabled: false, isCurrentAuth: l.current, storage: () => locked,
      apiFetch: async (path, init) => { l.guard(); if (init?.method !== "GET" || init.body != null || !path.startsWith(OPERATIONAL_PUNCH_ACTIVATION_API + "?")) throw Error("recovery_is_read_only");
        const q = parseOperationalPunchActivationHttpQuery("https://recovery.invalid" + path); if (!operationalRuleLedgerEqual(q, expected)) throw Error("recovery_query_changed");
        const response = await options.apiFetch(path, init); if (!l.current()) { void response.body?.cancel().catch(() => {}); throw Error("recovery_scope_changed"); } return response; } });
    await l.wait(() => client!.initialize()); l.guard(); if (!operationalRuleLedgerEqual(client.getSnapshot().pending, parsed.pending)) throw Error("recovery_record_changed");
    await l.wait(() => client!.recover()); l.guard(); const state = client.getSnapshot(), result = state.result, receipt = result?.receipt;
    if (state.pending || !receipt) return null;
    if (result.actorId !== auth || receipt.actorId !== auth || receipt.operationId !== entry.operationId || receipt.commandFingerprint !== entry.commandFingerprint || result.current !== null) throw Error("recovery_receipt_changed");
    return Object.freeze(receipt);
  } finally { l.signal.removeEventListener("abort", stop); client?.dispose(); l.close(); }
}
