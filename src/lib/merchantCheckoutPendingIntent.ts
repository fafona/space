import { cartClientOriginalKey, parseCartClientOriginal, type CartClientOriginal } from "./merchantCheckoutCartReview";
export type PendingCheckoutOriginal = { operationKey: string; generation: number; reviewHash: string; reviewRequired: boolean; original: CartClientOriginal };
export type PendingCheckoutSnapshot = { version: 1; siteId: string; pending: PendingCheckoutOriginal | null };
export type CheckoutIntentAcknowledgement = { siteId: string; operationKey: string; generation: number; reviewHash: string };
export type CheckoutIntentReview = PendingCheckoutOriginal & { acknowledged: boolean };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const generation = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 1;
function need(v: unknown): asserts v { if (!v) throw new Error("checkout_intent_invalid_response"); }
/** Safe own-original hints only. No nonce, principal, contact, member ID,
 * coupon code or raw receipt crosses this projection. None is not permission
 * to clear a browser's unresolved nonce or bypass the commit-time guard. */
export function parsePendingCheckoutSnapshot(raw: unknown, siteId: string): PendingCheckoutSnapshot {
  need(/^\d{8}$/.test(siteId) && object(raw) && raw.version === 1 && raw.siteId === siteId && Object.hasOwn(raw, "pending"));
  if (raw.pending === null) return { version: 1, siteId, pending: null };
  const p = raw.pending; need(object(p) && hash(p.operationKey) && generation(p.generation) && hash(p.reviewHash) && typeof p.reviewRequired === "boolean");
  const original = parseCartClientOriginal(p.original, siteId); need(cartClientOriginalKey(original) === p.operationKey);
  const r = original.kind === "cart" ? original.result : original.original.result;
  const visiblyUnsafe = !r.resource || r.closed !== (r.resource.status === "cancelled") || original.kind === "cart" && original.result.reviewRequired
    || original.kind === "single" && original.original.method === "on_site" && !original.original.result.termsMatch;
  need(!visiblyUnsafe || p.reviewRequired);
  return { version: 1, siteId, pending: { operationKey: p.operationKey, generation: p.generation, reviewHash: p.reviewHash, reviewRequired: p.reviewRequired, original } };
}
export function parseCheckoutIntentAcknowledgement(raw: unknown): CheckoutIntentAcknowledgement {
  if (!object(raw) || Object.keys(raw).length !== 4 || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId)
    || !hash(raw.operationKey) || !generation(raw.generation) || !hash(raw.reviewHash)) throw new Error("checkout_invalid_request");
  return { siteId: raw.siteId, operationKey: raw.operationKey, generation: raw.generation, reviewHash: raw.reviewHash };
}
export function parseCheckoutIntentAckResult(raw: unknown, expected: CheckoutIntentAcknowledgement) {
  need(object(raw) && raw.version === 1 && raw.siteId === expected.siteId && raw.operationKey === expected.operationKey && raw.generation === expected.generation
    && raw.acknowledged === true && typeof raw.replayed === "boolean");
  return { version: 1 as const, siteId: expected.siteId, operationKey: expected.operationKey, generation: expected.generation, acknowledged: true as const, replayed: raw.replayed };
}
/** An own, operation-specific durable acknowledgement proof. A pending:null
 * response is intentionally NOT accepted in place of this proof. */
export function parseCheckoutIntentReview(raw: unknown, scope: { siteId: string; operationKey: string }): CheckoutIntentReview | null {
  need(object(raw) && raw.version === 1 && raw.siteId === scope.siteId && Object.hasOwn(raw, "review") && hash(scope.operationKey));
  if (raw.review === null) return null;
  need(object(raw.review) && raw.review.operationKey === scope.operationKey && typeof raw.review.acknowledged === "boolean");
  const parsed = parsePendingCheckoutSnapshot({ version: 1, siteId: scope.siteId, pending: raw.review }, scope.siteId).pending!;
  return { ...parsed, acknowledged: raw.review.acknowledged };
}
