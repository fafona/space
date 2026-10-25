type PendingSubmission = { nonce: string; hash: string; pending: boolean };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const prefix = "faolla-booking-submit-v1:";
const memory = new Map<string, string>();
function defaultStorage(): StorageLike {
  try { return window.sessionStorage; } catch { return { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); }, removeItem: (key) => { memory.delete(key); } }; }
}
export function readPendingBookingSubmission(scope: string, storage: StorageLike = defaultStorage()) {
  let raw: string | null = null;
  try { raw = storage.getItem(prefix + scope); } catch { /* Fall back to this mounted session, not a new request ID. */ }
  try { return JSON.parse(raw || memory.get(prefix + scope) || "null") as PendingSubmission | null; }
  catch { return null; }
}

/** Session-only hashes + random request IDs, NEVER names/emails/form payloads.
 * Keep the same ID after a timeout/lost response. Even a changed payload keeps
 * that ID until recovery/confirmation; server key-reuse checks prevent a second
 * reservation and never reinterpret an already saved request.
 */
export async function beginBookingSubmission(scope: string, payload: unknown, storage: StorageLike = defaultStorage(), cryptoProvider: Crypto = window.crypto) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = [...new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = prefix + scope;
  const previous = readPendingBookingSubmission(scope, storage);
  // Even a changed payload retains the previous uncertain key: the server can
  // either recover the existing booking or reject key reuse, NEVER create two.
  const nonce = previous?.pending && isBookingRequestNonce(previous.nonce) ? previous.nonce : cryptoProvider.randomUUID();
  const encoded = JSON.stringify({ nonce, hash, pending: true });
  memory.set(key, encoded);
  try { storage.setItem(key, encoded); } catch { /* Memory keeps this mounted session idempotent if browser storage is blocked. */ }
  return nonce;
}

export function finishBookingSubmission(scope: string, definite: boolean, storage: StorageLike = defaultStorage()) {
  if (definite) { memory.delete(prefix + scope); try { storage.removeItem(prefix + scope); } catch { /* No persistent authority lives here. */ } }
}

export function isBookingRequestNonce(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
