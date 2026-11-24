import { cartClientOriginalKey, parseCartClientOriginal, type CartClientOriginal } from "./merchantCheckoutCartReview";

export type CheckoutHistoryRecovery = { version: 1; siteId: string; operationKey: string } & (
  { original: null; reviewRequired: null } | { original: CartClientOriginal; reviewRequired: boolean }
);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function parseCheckoutHistoryRecoveryRequest(raw: unknown) {
  if (!object(raw) || Object.keys(raw).length !== 2 || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId)
    || typeof raw.nonce !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(raw.nonce))
    throw new Error("checkout_invalid_request");
  return { siteId: raw.siteId, nonce: raw.nonce.toLowerCase() };
}
/** Response/request consistency only, NEVER an ownership/payment proof. Does
 * not expose the original nonce or include contacts, amounts or member IDs. */
export async function checkoutHistoryRecoveryReference(siteId: string, accountId: string, nonce: string) {
  const request = parseCheckoutHistoryRecoveryRequest({ siteId, nonce });
  if (!/^\d{8}$/.test(accountId)) throw new Error("checkout_invalid_request");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["checkout-history-v1", request.siteId, accountId, request.nonce])));
  return Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, "0")).join("");
}
export function parseCheckoutHistoryRecovery(raw: unknown, scope: { siteId: string; operationKey?: string }): CheckoutHistoryRecovery {
  if (!object(raw) || raw.version !== 1 || !/^\d{8}$/.test(scope.siteId) || raw.siteId !== scope.siteId
    || typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey) || scope.operationKey !== undefined && raw.operationKey !== scope.operationKey)
    throw new Error("checkout_history_unavailable");
  const base = { version: 1 as const, siteId: scope.siteId, operationKey: raw.operationKey };
  if (raw.original === null && raw.reviewRequired === null) return { ...base, original: null, reviewRequired: null };
  if (!raw.original || typeof raw.reviewRequired !== "boolean") throw new Error("checkout_history_unavailable");
  const original = parseCartClientOriginal(raw.original, scope.siteId), r = original.kind === "cart" ? original.result : original.original.result;
  if (cartClientOriginalKey(original) !== base.operationKey || (!r.resource || r.closed !== (r.resource.status === "cancelled")
    || original.kind === "cart" && original.result.reviewRequired || original.kind === "single" && original.original.method === "on_site" && !original.original.result.termsMatch) && !raw.reviewRequired)
    throw new Error("checkout_history_unavailable");
  return { ...base, original, reviewRequired: raw.reviewRequired };
}
