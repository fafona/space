import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { ACCOUNT_SUSPENSION_API, parseAccountSuspensionJson, parseAccountSuspensionHttpQuery,
  parseAccountStatusCommand, accountStatusCommandFingerprint } from "./merchantAttendanceAccountSuspension";
import { AttendanceAccountStatusClient, accountStatusPendingKey } from "./merchantAttendanceAccountSuspensionClient";
import type { DelegationRecoveryStorage } from "./merchantAttendanceDelegationRecovery";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

export type KnownAccountStatusRecovery = Readonly<{ kind: "account-status"; storageKey: string; siteId: string; authUserId: string;
  operationId: string; commandFingerprint: string }>;
export type AccountStatusRecoveryReceipt = Readonly<{ operationId: string; actorId: string; employeeId: string; status: "active" | "disabled";
  expectedVersion: number; version: number; suspensionId: string | null; recordedAt: string }>;
export type AccountStatusRecoveryOptions = { authenticatedUserId: string; storage: DelegationRecoveryStorage; apiFetch: AttendanceApiFetch;
  signal: AbortSignal; isCurrentAuth: () => boolean };
export const ACCOUNT_STATUS_RECOVERY_PREFIX = "faolla:attendance:account-status:v1:";
function uuid(v: unknown): string { if (typeof v !== "string" || v.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) throw Error("invalid_recovery_identity"); return v; }

/** Local descriptions never carry the target employee, status intent or task handoff. */
export async function parseKnownAccountStatusRecovery(key: string, raw: string, authenticatedUserId: string): Promise<KnownAccountStatusRecovery | null> {
  const auth = uuid(authenticatedUserId);
  if (typeof key !== "string" || !key.startsWith(ACCOUNT_STATUS_RECOVERY_PREFIX) || key.length > 160 || typeof raw !== "string") throw Error("invalid_recovery_record");
  const p = captureBrowserExact(parseAccountSuspensionJson(raw, "request"), ["version", "siteId", "actorId", "command", "commandFingerprint"]);
  if (uuid(p.actorId) !== auth) return null;
  if (p.version !== 1 || typeof p.siteId !== "string" || accountStatusPendingKey(p.siteId, auth) !== key) throw Error("invalid_recovery_identity");
  const command = parseAccountStatusCommand(p.command), commandFingerprint = await accountStatusCommandFingerprint(p.siteId, command);
  if (p.commandFingerprint !== commandFingerprint) throw Error("invalid_recovery_fingerprint");
  return Object.freeze({ kind: "account-status", storageKey: key, siteId: p.siteId, authUserId: auth, operationId: command.operationId, commandFingerprint });
}

export async function listKnownAccountStatusRecoveries(storage: DelegationRecoveryStorage, authUserId: string, isCurrentAuth: () => boolean, signal?: AbortSignal) {
  const guard = () => { if (signal?.aborted || !isCurrentAuth() || typeof document !== "undefined" && document.hidden) throw Error("recovery_scope_changed"); };
  guard(); uuid(authUserId); const size = storage.length; guard(); if (!Number.isSafeInteger(size) || size < 0 || size > 2048) throw Error("recovery_storage_limit");
  const keys: string[] = []; for (let i = 0; i < size; i++) { guard(); const key = storage.key(i); guard(); if (key?.startsWith(ACCOUNT_STATUS_RECOVERY_PREFIX)) keys.push(key); }
  if (keys.length > 64 || new Set(keys).size !== keys.length) throw Error("recovery_storage_limit");
  const entries: KnownAccountStatusRecovery[] = []; let invalid = false;
  for (const key of keys) { guard(); try { const raw = storage.getItem(key); guard(); if (raw === null) continue;
    const entry = await parseKnownAccountStatusRecovery(key, raw, authUserId); guard(); const current = storage.getItem(key); guard();
    if (current !== raw) { invalid = true; continue; } if (entry) entries.push(entry);
  } catch { guard(); invalid = true; } }
  guard(); return Object.freeze({ entries: Object.freeze(entries), invalid });
}

/** Reuses the original 193 controller but physically removes all write authority. */
export async function recoverKnownAccountStatus(entry: KnownAccountStatusRecovery, options: AccountStatusRecoveryOptions): Promise<AccountStatusRecoveryReceipt | null> {
  const { storage, signal } = options, auth = uuid(options.authenticatedUserId);
  const guard = () => { if (signal.aborted || !options.isCurrentAuth() || typeof document !== "undefined" && document.hidden || entry.authUserId !== auth) throw Error("recovery_scope_changed"); };
  guard(); const original = storage.getItem(entry.storageKey); guard(); if (original === null) throw Error("recovery_record_changed");
  const parsed = await parseKnownAccountStatusRecovery(entry.storageKey, original, auth); guard();
  if (!parsed || JSON.stringify(parsed) !== JSON.stringify(entry)) throw Error("recovery_record_changed");
  const current = storage.getItem(entry.storageKey); guard(); if (current !== original) throw Error("recovery_record_changed");
  const lockedStorage = {
    getItem: (key: string) => { guard(); if (key !== entry.storageKey) throw Error("recovery_key_changed"); const value = storage.getItem(key); guard(); return value; },
    setItem: () => { throw Error("recovery_is_read_only"); },
    removeItem: (key: string) => { guard(); if (key !== entry.storageKey) throw Error("recovery_key_changed"); const value = storage.getItem(key); guard(); if (value !== original) throw Error("recovery_record_changed"); storage.removeItem(key); guard(); },
  };
  const fetch: AttendanceApiFetch = (path, init) => { guard(); if (init?.method !== "GET" || init.body != null || !path.startsWith(ACCOUNT_SUSPENSION_API + "?")) throw Error("recovery_is_read_only");
    const q = parseAccountSuspensionHttpQuery("https://recovery.invalid" + path);
    if (q.mode !== "recover-status" || q.siteId !== entry.siteId || q.operationId !== entry.operationId || q.suspensionId !== null || q.afterId !== null) throw Error("recovery_query_changed");
    return options.apiFetch(path, init); };
  const client = new AttendanceAccountStatusClient({ siteId: entry.siteId, actorId: auth, apiFetch: fetch, storage: () => lockedStorage,
    isCurrentAuth: () => !signal.aborted && options.isCurrentAuth() });
  const abort = () => client.pause(); signal.addEventListener("abort", abort, { once: true });
  try { await client.initialize(); guard(); const p = client.getSnapshot().pending;
    if (!p || p.actorId !== auth || p.siteId !== entry.siteId || p.command.operationId !== entry.operationId || p.commandFingerprint !== entry.commandFingerprint) throw Error("recovery_record_changed");
    await client.recover(); guard(); const state = client.getSnapshot(), r = state.result?.statusReceipt; if (state.pending || !r) return null;
    if (r.actorId !== auth || r.operationId !== entry.operationId || r.commandFingerprint !== entry.commandFingerprint) throw Error("recovery_receipt_changed");
    return Object.freeze({ operationId: r.operationId, actorId: r.actorId, employeeId: r.employeeId, status: r.status, expectedVersion: r.expectedVersion,
      version: r.version, suspensionId: r.suspensionId, recordedAt: r.recordedAt });
  } finally { signal.removeEventListener("abort", abort); client.pause(); }
}
