// Recovery is not a second approval UI. Only exact intents already persisted in
// this tab by the two delegated clients may be queried, never submitted again.
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { AttendanceMissingDelegationClient, missingDelegationPendingKey } from "./merchantAttendanceMissingDelegationClient";
import { MISSING_DELEGATION_API, parseMissingDelegationJson, parseMissingDelegationBody, parseMissingDelegationHttpQuery,
  missingDelegationOperation, missingDelegationCommandFingerprint } from "./merchantAttendanceMissingDelegation";
import { AttendanceApplicationDelegationClient, applicationDelegationPendingKey } from "./merchantAttendanceApplicationDelegationClient";
import { APPLICATION_DELEGATION_API, parseApplicationDelegationJson, parseApplicationDelegationBody, parseApplicationDelegationHttpQuery,
  applicationDelegationOperation, applicationDelegationCommandFingerprint } from "./merchantAttendanceApplicationDelegation";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

export const DELEGATION_RECOVERY_PATH = "/enterprise/attendance-recovery";
export const DELEGATION_RECOVERY_AUTH_TIMEOUT_MS = 12000;
/** A late Supabase response cannot keep checking open or win after this deadline. */
export async function boundedDelegationRecoveryAuth<T>(run: () => PromiseLike<T>, timeoutMs = DELEGATION_RECOVERY_AUTH_TIMEOUT_MS): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs > DELEGATION_RECOVERY_AUTH_TIMEOUT_MS || timeoutMs <= 0) throw Error("recovery_auth_timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve().then(run), new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(Error("recovery_auth_timeout")), timeoutMs);
  })]); } finally { if (timer !== undefined) clearTimeout(timer); }
}
export type DelegationRecoveryStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type KnownDelegationRecovery = Readonly<{ kind: "missing" | "application"; storageKey: string; siteId: string;
  access: "owner" | "delegate"; anchorId: string; authUserId: string; operationId: string; commandFingerprint: string }>;
export type DelegationRecoveryReceipt = Readonly<{ operationId: string; action: "grant" | "revoke" | "approve" | "reject";
  grantId: string; requestId: string | null; actorId: string; recordedAt: string }>;
const uuid = (v: unknown): string => {
  if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) throw Error("invalid_recovery_identity");
  return v;
};
const prefix = /^faolla:attendance:(missing|application)-delegation:v1:/;
export async function parseKnownDelegationRecovery(key: string, raw: string, authenticatedUserId: string): Promise<KnownDelegationRecovery | null> {
  const auth = uuid(authenticatedUserId), match = key.match(prefix);
  if (!match || key.length > 160 || raw.length > 8192) throw Error("invalid_recovery_record");
  const kind = match[1] as "missing" | "application";
  const value = kind === "missing" ? parseMissingDelegationJson(raw, "request") : parseApplicationDelegationJson(raw, "request");
  const p = captureBrowserExact(value, ["version", "anchorId", "actorId", "employeeId", "query", "command", "commandFingerprint"]);
  if (uuid(p.actorId) !== auth) return null; // No foreign account identifiers leave this parser.
  const anchorId = uuid(p.anchorId);
  const body = kind === "missing" ? parseMissingDelegationBody({ query: p.query, command: p.command }) : parseApplicationDelegationBody({ query: p.query, command: p.command });
  const { query } = body;
  if (p.version !== 1 || (query.access === "owner" ? p.employeeId !== null || anchorId !== auth : uuid(p.employeeId) !== anchorId)) throw Error("invalid_recovery_identity");
  const expectedKey = kind === "missing" ? missingDelegationPendingKey(query.siteId, query.access, anchorId) : applicationDelegationPendingKey(query.siteId, query.access, anchorId);
  if (key !== expectedKey) throw Error("invalid_recovery_key");
  // Separate branches preserve the strict command types of both protocols.
  let operationId: string, fingerprint: string;
  if (kind === "missing") { const b = parseMissingDelegationBody({ query: p.query, command: p.command });
    operationId = missingDelegationOperation(b.command); fingerprint = await missingDelegationCommandFingerprint(b.query.siteId, b.query.access, b.command);
  } else { const b = parseApplicationDelegationBody({ query: p.query, command: p.command });
    operationId = applicationDelegationOperation(b.command); fingerprint = await applicationDelegationCommandFingerprint(b.query.siteId, b.query.access, b.command); }
  if (p.commandFingerprint !== fingerprint) throw Error("invalid_recovery_fingerprint");
  return Object.freeze({ kind, storageKey: key, siteId: query.siteId, access: query.access, anchorId, authUserId: auth, operationId, commandFingerprint: fingerprint });
}

export async function listKnownDelegationRecoveries(storage: DelegationRecoveryStorage, authUserId: string, isCurrentAuth: () => boolean, signal?: AbortSignal) {
  const guard = () => { if (signal?.aborted || !isCurrentAuth() || (typeof document !== "undefined" && document.hidden)) throw Error("recovery_scope_changed"); };
  guard();
  uuid(authUserId); const entries: KnownDelegationRecovery[] = []; let invalid = false;
  const size = storage.length; guard(); if (!Number.isSafeInteger(size) || size < 0 || size > 2048) throw Error("recovery_storage_limit");
  const keys: string[] = [];
  for (let n = 0; n < size; n++) { guard(); const key = storage.key(n); guard(); if (key && prefix.test(key)) keys.push(key); }
  if (keys.length > 64 || new Set(keys).size !== keys.length) throw Error("recovery_storage_limit");
  for (const key of keys) {
    guard();
    try { const raw = storage.getItem(key); guard(); if (raw === null) continue;
      const entry = await parseKnownDelegationRecovery(key, raw, authUserId);
      guard();
      const currentRaw = storage.getItem(key); guard();
      if (currentRaw !== raw) { invalid = true; continue; } if (entry) entries.push(entry);
    } catch { guard(); invalid = true; }
  }
  guard();
  return Object.freeze({ entries: Object.freeze(entries), invalid });
}

export async function recoverKnownDelegation(entry: KnownDelegationRecovery, options: { authenticatedUserId: string;
  storage: DelegationRecoveryStorage; apiFetch: AttendanceApiFetch; signal: AbortSignal; isCurrentAuth: () => boolean }): Promise<DelegationRecoveryReceipt | null> {
  const { storage, signal } = options, auth = uuid(options.authenticatedUserId);
  const guard = () => { if (signal.aborted || !options.isCurrentAuth() || (typeof document !== "undefined" && document.hidden) || entry.authUserId !== auth) throw Error("recovery_scope_changed"); };
  guard(); const original = storage.getItem(entry.storageKey); guard(); if (original === null) throw Error("recovery_record_changed");
  const parsed = await parseKnownDelegationRecovery(entry.storageKey, original, auth); guard();
  if (!parsed || JSON.stringify(parsed) !== JSON.stringify(entry) || storage.getItem(entry.storageKey) !== original) throw Error("recovery_record_changed");
  guard();
  const lockedStorage = {
    getItem: (key: string) => { guard(); if (key !== entry.storageKey) throw Error("recovery_key_changed"); const raw = storage.getItem(key); guard(); return raw; },
    setItem: () => { throw Error("recovery_is_read_only"); },
    removeItem: (key: string) => { guard(); if (key !== entry.storageKey || storage.getItem(key) !== original) throw Error("recovery_record_changed"); guard(); storage.removeItem(key); guard(); },
  };
  const fetch: AttendanceApiFetch = (path, init) => {
    guard(); const endpoint = entry.kind === "missing" ? MISSING_DELEGATION_API : APPLICATION_DELEGATION_API;
    if (init?.method !== "GET" || init.body != null || !path.startsWith(endpoint + "?")) throw Error("recovery_is_read_only");
    const q = entry.kind === "missing" ? parseMissingDelegationHttpQuery("https://recovery.invalid" + path) : parseApplicationDelegationHttpQuery("https://recovery.invalid" + path);
    if (q.mode !== "recover" || q.operationId !== entry.operationId || q.siteId !== entry.siteId || q.access !== entry.access) throw Error("recovery_query_changed");
    return options.apiFetch(path, init);
  };
  const common = { siteId: entry.siteId, access: entry.access, actorId: entry.anchorId, enabled: false, apiFetch: fetch, storage: () => lockedStorage };
  const client = entry.kind === "missing" ? new AttendanceMissingDelegationClient(common)
    : new AttendanceApplicationDelegationClient({ ...common, expectedAuthUserId: auth, recoveryOnly: true });
  const abort = () => client.pause(); signal.addEventListener("abort", abort, { once: true });
  try {
    await client.initialize(); guard();
    const p = client.getSnapshot().pending;
    if (!p || p.actorId !== auth || p.anchorId !== entry.anchorId || p.commandFingerprint !== entry.commandFingerprint) throw Error("recovery_record_changed");
    await client.recover(); guard();
    const state = client.getSnapshot(), result = state.result, receipt = result?.receipt;
    if (state.pending || !receipt) return null;
    if (result?.actorId !== auth || receipt.operationId !== entry.operationId || receipt.commandFingerprint !== entry.commandFingerprint) throw Error("recovery_receipt_changed");
    return Object.freeze({ operationId: receipt.operationId, action: receipt.action, grantId: receipt.grantId,
      requestId: "requestId" in receipt ? receipt.requestId : null, actorId: auth, recordedAt: receipt.recordedAt });
  } finally { signal.removeEventListener("abort", abort); client.pause(); }
}
