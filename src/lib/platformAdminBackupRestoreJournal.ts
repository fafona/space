import { capturePlatformAdminBackupRestoreReceiptBinding } from "./platformAdminBackupRestoreReceiptClient";
import type { PlatformAdminBackupRestoreReceiptAttempt } from "./platformAdminBackupRestoreReceiptWorkflow";

export const STORAGE_KEY = "faolla:platform-admin:restore-journal:v1";
export const LOCK_NAME = "faolla:platform-admin:restore-journal-lock:v1";
const MAX_CHARS = 8_192;
export type RestoreJournalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
export type RestoreJournalRead =
  | { status: "empty" }
  | { status: "pending"; attempt: PlatformAdminBackupRestoreReceiptAttempt }
  | { status: "unavailable" };
type LockMode = "shared" | "exclusive";
export type RestoreJournalLockManager = {
  request<T>(name: string, options: { mode: LockMode; ifAvailable: true },
    callback: (lock: { readonly name: string; readonly mode: LockMode } | null) => Promise<T>): Promise<T>;
};
type StorageInput = RestoreJournalStorage | null | undefined;
type LocksInput = RestoreJournalLockManager | null | undefined;
function fail(code: string): never { throw new Error(code); }

function exact(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("restore_journal_unavailable");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== fields.length || fields.some((key) =>
    !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], "value"))) fail("restore_journal_unavailable");
}

function captureAttempt(value: unknown): PlatformAdminBackupRestoreReceiptAttempt {
  exact(value, ["binding", "deviceId"]);
  if (typeof value.deviceId !== "string" || value.deviceId.length < 1 || value.deviceId.length > 500 ||
      value.deviceId !== value.deviceId.trim()) fail("restore_journal_unavailable");
  return Object.freeze({ binding: Object.freeze(capturePlatformAdminBackupRestoreReceiptBinding(value.binding)), deviceId: value.deviceId });
}

/** JSON.parse alone discards duplicate object keys. Validate their decoded names
 * too, without executing getters or accepting extra state in the stored record.
 * Tokenization is bounded and runs only after JSON.parse accepted the grammar.
 */
function parseRecord(text: string): PlatformAdminBackupRestoreReceiptAttempt {
  if (typeof text !== "string" || text.length < 1 || text.length > MAX_CHARS) fail("restore_journal_unavailable");
  const value: unknown = JSON.parse(text);
  const stack: Array<{ keys: Set<string>; expectsKey: boolean } | null> = [];
  for (const token of text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]/g) ?? []) {
    if (token === "{") stack.push({ keys: new Set(), expectsKey: true });
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else {
      const frame = stack.at(-1);
      if (token === "," && frame) frame.expectsKey = true;
      else if (token.startsWith('"') && frame?.expectsKey) {
        const key = JSON.parse(token) as string;
        if (frame.keys.has(key)) fail("restore_journal_unavailable");
        frame.keys.add(key); frame.expectsKey = false;
      }
    }
  }
  exact(value, ["version", "attempt"]);
  if (value.version !== 1) fail("restore_journal_unavailable");
  return captureAttempt(value.attempt);
}

const serialize = (attempt: PlatformAdminBackupRestoreReceiptAttempt) => JSON.stringify({ version: 1, attempt });
const same = (left: PlatformAdminBackupRestoreReceiptAttempt, right: PlatformAdminBackupRestoreReceiptAttempt) => serialize(left) === serialize(right);

export function readRestoreJournal(storage: StorageInput): RestoreJournalRead {
  try {
    if (!storage) return { status: "unavailable" };
    const text = storage.getItem(STORAGE_KEY);
    if (text === null) return { status: "empty" };
    return { status: "pending", attempt: parseRecord(text) };
  } catch { return { status: "unavailable" }; }
}

/** Synchronous write-ahead acknowledgement. Caller must hold the exclusive Web
 * Lock across this and its restore lifecycle; localStorage is not a CAS primitive.
 * Do not remove a failed/unconfirmed write: another context may now own the key.
 */
export function writeRestoreJournalAhead(storage: StorageInput, value: unknown): PlatformAdminBackupRestoreReceiptAttempt {
  let attempt;
  try { attempt = captureAttempt(value); } catch { return fail("restore_journal_unavailable"); }
  const before = readRestoreJournal(storage);
  if (before.status === "pending") return fail("restore_journal_pending");
  if (before.status !== "empty" || !storage) return fail("restore_journal_unavailable");
  const text = serialize(attempt);
  if (text.length > MAX_CHARS) return fail("restore_journal_unavailable");
  try { storage.setItem(STORAGE_KEY, text); } catch { return fail("restore_journal_write_unconfirmed"); }
  const actual = readRestoreJournal(storage);
  if (actual.status !== "pending" || !same(actual.attempt, attempt)) return fail("restore_journal_write_unconfirmed");
  return attempt;
}

/** Only explicit reconciliation of this exact operation can clear the journal.
 * Missing/corrupt/foreign records are never deleted, and a silent failed delete
 * never permits resuming writes. Caller coordinates this under the exclusive lock.
 */
export function clearRestoreJournalExact(storage: StorageInput, value: unknown): void {
  let attempt;
  try { attempt = captureAttempt(value); } catch { return fail("restore_journal_clear_unconfirmed"); }
  const before = readRestoreJournal(storage);
  if (!storage || before.status !== "pending" || !same(before.attempt, attempt)) return fail("restore_journal_clear_unconfirmed");
  try { storage.removeItem(STORAGE_KEY); } catch { return fail("restore_journal_clear_unconfirmed"); }
  if (readRestoreJournal(storage).status !== "empty") fail("restore_journal_clear_unconfirmed");
}

async function withLock<T>(locks: LocksInput, mode: LockMode, callback: () => T | Promise<T>): Promise<T> {
  let entered = false;
  try {
    if (!locks || typeof locks.request !== "function") return fail("restore_journal_lock_unavailable");
    const result = await locks.request(LOCK_NAME, { mode, ifAvailable: true }, async (lock) => {
      if (!lock || lock.name !== LOCK_NAME || lock.mode !== mode || entered) return fail("restore_journal_lock_unavailable");
      entered = true;
      return await callback();
    });
    if (!entered) return fail("restore_journal_lock_unavailable");
    return result;
  } catch (error) {
    // Never relabel an already-started restore/writer failure as failure to acquire
    // a lock: its result may be unknown and must retain the caller's protection.
    if (entered) throw error;
    return fail("restore_journal_lock_unavailable");
  }
}

export function withRestoreJournalExclusive<T>(locks: LocksInput, callback: () => T | Promise<T>): Promise<T> {
  return withLock(locks, "exclusive", callback);
}

export async function withRestoreJournalWriter<T>(storage: StorageInput, locks: LocksInput, callback: () => T | Promise<T>): Promise<T> {
  const run = async () => {
    const current = readRestoreJournal(storage);
    if (current.status !== "empty") return fail(current.status === "pending" ? "restore_journal_pending" : "restore_journal_unavailable");
    return await callback();
  };
  // A platform without Web Locks may continue legacy ordinary writes only when
  // there is no pending record. Atomic restore itself is unavailable there.
  if (locks === undefined || locks === null) return run();
  return withLock(locks, "shared", run);
}
