// This entry point can only query an exact, locally persisted original intent.
// It cannot submit a schedule, discover employees, or restore authority.
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { SCHEDULE_DELEGATION_API, parseScheduleDelegationJson, parseScheduleDelegationBody,
  parseScheduleDelegationHttpQuery, scheduleDelegationOperation, scheduleDelegationFingerprint,
  type ScheduleDelegationReceipt } from "./merchantAttendanceScheduleDelegation";
import { AttendanceScheduleDelegationClient, scheduleDelegationPendingKey } from "./merchantAttendanceScheduleDelegationClient";
import type { DelegationRecoveryStorage } from "./merchantAttendanceDelegationRecovery";
import type { AccountStatusRecoveryOptions } from "./merchantAttendanceAccountStatusRecovery";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

export const SCHEDULE_DELEGATION_RECOVERY_PREFIX = "faolla:attendance:schedule-delegation:v1:";
export type KnownScheduleDelegationRecovery = Readonly<{ kind: "schedule"; storageKey: string; siteId: string;
  access: "owner" | "delegate"; anchorId: string; authUserId: string; operationId: string; commandFingerprint: string }>;
export type ScheduleDelegationRecoveryReceipt = Readonly<Omit<ScheduleDelegationReceipt, "commandFingerprint">>;
const uuid = (v: unknown): string => {
  if (typeof v !== "string" || v.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) throw Error("invalid_recovery_identity"); return v;
};
export async function parseKnownScheduleDelegationRecovery(key: string, raw: string, authenticatedUserId: string): Promise<KnownScheduleDelegationRecovery | null> {
  const auth = uuid(authenticatedUserId);
  if (typeof key !== "string" || !key.startsWith(SCHEDULE_DELEGATION_RECOVERY_PREFIX) || key.length > 160 || typeof raw !== "string") throw Error("invalid_recovery_record");
  const p = captureBrowserExact(parseScheduleDelegationJson(raw, "request"), ["version", "anchorId", "actorId", "employeeId", "query", "command", "commandFingerprint"]);
  if (uuid(p.actorId) !== auth) return null;
  const anchorId = uuid(p.anchorId), { query, command } = parseScheduleDelegationBody({ query: p.query, command: p.command });
  if (p.version !== 1 || (query.access === "owner" ? p.employeeId !== null || anchorId !== auth : uuid(p.employeeId) !== anchorId)
    || scheduleDelegationPendingKey(query.siteId, query.access, anchorId) !== key) throw Error("invalid_recovery_identity");
  const commandFingerprint = await scheduleDelegationFingerprint(query, command);
  if (p.commandFingerprint !== commandFingerprint) throw Error("invalid_recovery_fingerprint");
  return Object.freeze({ kind: "schedule", storageKey: key, siteId: query.siteId, access: query.access, anchorId,
    authUserId: auth, operationId: scheduleDelegationOperation(command), commandFingerprint });
}
export async function listKnownScheduleDelegationRecoveries(storage: DelegationRecoveryStorage, authUserId: string, isCurrentAuth: () => boolean, signal?: AbortSignal) {
  const guard = () => { if (signal?.aborted || !isCurrentAuth() || typeof document !== "undefined" && document.hidden) throw Error("recovery_scope_changed"); };
  guard(); uuid(authUserId); const count = storage.length; guard();
  if (!Number.isSafeInteger(count) || count < 0 || count > 2048) throw Error("recovery_storage_limit");
  const keys: string[] = []; for (let i = 0; i < count; i++) { guard(); const key = storage.key(i); guard(); if (key?.startsWith(SCHEDULE_DELEGATION_RECOVERY_PREFIX)) keys.push(key); }
  if (keys.length > 64 || new Set(keys).size !== keys.length) throw Error("recovery_storage_limit");
  const entries: KnownScheduleDelegationRecovery[] = []; let invalid = false;
  for (const key of keys) { guard(); try { const raw = storage.getItem(key); guard(); if (raw === null) continue;
    const entry = await parseKnownScheduleDelegationRecovery(key, raw, authUserId); guard(); const current = storage.getItem(key); guard();
    if (current !== raw) { invalid = true; continue; } if (entry) entries.push(entry);
  } catch { guard(); invalid = true; } }
  guard(); return Object.freeze({ entries: Object.freeze(entries), invalid });
}
export async function recoverKnownScheduleDelegation(entry: KnownScheduleDelegationRecovery, options: AccountStatusRecoveryOptions): Promise<ScheduleDelegationRecoveryReceipt | null> {
  const { storage, signal } = options, auth = uuid(options.authenticatedUserId);
  const guard = () => { if (signal.aborted || !options.isCurrentAuth() || typeof document !== "undefined" && document.hidden || entry.authUserId !== auth) throw Error("recovery_scope_changed"); };
  guard(); const original = storage.getItem(entry.storageKey); guard(); if (original === null) throw Error("recovery_record_changed");
  const parsed = await parseKnownScheduleDelegationRecovery(entry.storageKey, original, auth); guard();
  if (!parsed || JSON.stringify(parsed) !== JSON.stringify(entry)) throw Error("recovery_record_changed");
  const current = storage.getItem(entry.storageKey); guard(); if (current !== original) throw Error("recovery_record_changed");
  const lockedStorage = {
    getItem: (key: string) => { guard(); if (key !== entry.storageKey) throw Error("recovery_key_changed"); const value = storage.getItem(key); guard(); return value; },
    setItem: () => { throw Error("recovery_is_read_only"); },
    removeItem: (key: string) => { guard(); if (key !== entry.storageKey) throw Error("recovery_key_changed"); const value = storage.getItem(key); guard();
      if (value !== original) throw Error("recovery_record_changed"); storage.removeItem(key); guard(); },
  };
  const fetch: AttendanceApiFetch = (path, init) => { guard();
    if (init?.method !== "GET" || init.body != null || !path.startsWith(SCHEDULE_DELEGATION_API + "?")) throw Error("recovery_is_read_only");
    const q = parseScheduleDelegationHttpQuery("https://recovery.invalid" + path);
    if (q.mode !== "recover" || q.siteId !== entry.siteId || q.access !== entry.access || q.operationId !== entry.operationId
      || q.catalog !== null || q.grantId !== null || q.afterId !== null || q.fromDate !== null || q.throughDate !== null) throw Error("recovery_query_changed");
    return options.apiFetch(path, init);
  };
  const client = new AttendanceScheduleDelegationClient({ siteId: entry.siteId, access: entry.access, actorId: entry.anchorId,
    expectedAuthUserId: auth, recoveryOnly: true, enabled: false, apiFetch: fetch, storage: () => lockedStorage,
    isCurrentAuth: () => !signal.aborted && options.isCurrentAuth() });
  const abort = () => client.pause(); signal.addEventListener("abort", abort, { once: true });
  try { await client.initialize(); guard(); const p = client.getSnapshot().pending;
    if (!p || p.actorId !== auth || p.anchorId !== entry.anchorId || scheduleDelegationOperation(p.command) !== entry.operationId || p.commandFingerprint !== entry.commandFingerprint) throw Error("recovery_record_changed");
    await client.recover(); guard(); const state = client.getSnapshot(), r = state.result?.receipt; if (state.pending || !r) return null;
    if (state.result?.actorId !== auth || r.actorId !== auth || r.operationId !== entry.operationId || r.commandFingerprint !== entry.commandFingerprint) throw Error("recovery_receipt_changed");
    return Object.freeze({ operationId: r.operationId, actorId: r.actorId, action: r.action, grantId: r.grantId,
      grantRevision: r.grantRevision, scheduleRevision: r.scheduleRevision, recordedAt: r.recordedAt });
  } finally { signal.removeEventListener("abort", abort); client.pause(); }
}
