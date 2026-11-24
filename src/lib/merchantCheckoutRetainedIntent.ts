import { parsePendingCheckoutSnapshot, parseCheckoutIntentReview, type CheckoutIntentReview } from "./merchantCheckoutPendingIntent";
import { parseCheckoutHistoryRecoveryRequest } from "./merchantCheckoutHistoryRecovery";
import type { CartClientOriginal } from "./merchantCheckoutCartReview";

export type RetainedIntentReview = { operationKey: string; reviewHash: string; reviewRequired: boolean; original: CartClientOriginal };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function need(v: unknown): asserts v { if (!v) throw new Error("checkout_intent_invalid_response"); }
/** A registration proposal is NOT a claim, acknowledgement or release proof. */
export function parseRetainedIntentReview(raw: unknown, scope: { siteId: string; operationKey?: string }): RetainedIntentReview | null {
  need(object(raw) && Object.keys(raw).length === 4 && raw.version === 1 && raw.siteId === scope.siteId
    && typeof raw.operationKey === "string" && /^[a-f0-9]{64}$/.test(raw.operationKey) && (!scope.operationKey || raw.operationKey === scope.operationKey));
  if (raw.proposal === null) return null;
  const p = raw.proposal;
  need(object(p) && Object.keys(p).length === 3 && Object.hasOwn(p, "original") && Object.hasOwn(p, "reviewRequired") && Object.hasOwn(p, "reviewHash"));
  const parsed = parsePendingCheckoutSnapshot({ version: 1, siteId: scope.siteId, pending: { ...p, operationKey: raw.operationKey, generation: 1 } }, scope.siteId).pending!;
  return { operationKey: parsed.operationKey, reviewHash: parsed.reviewHash, reviewRequired: parsed.reviewRequired, original: parsed.original };
}
export function parseRetainedIntentRequest(raw: unknown, register: boolean) {
  if (!object(raw) || Object.keys(raw).length !== (register ? 3 : 2) || register && (typeof raw.reviewHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.reviewHash))) throw new Error("checkout_invalid_request");
  const request = parseCheckoutHistoryRecoveryRequest({ siteId: raw.siteId, nonce: raw.nonce });
  return { ...request, ...(register ? { reviewHash: raw.reviewHash as string } : {}) };
}
export function parseRetainedIntentRegistration(raw: unknown, scope: { siteId: string; operationKey: string; reviewHash: string }): { review: CheckoutIntentReview; replayed: boolean } {
  need(object(raw) && Object.keys(raw).length === 4 && typeof raw.replayed === "boolean");
  const review = parseCheckoutIntentReview({ version: raw.version, siteId: raw.siteId, review: raw.review }, scope);
  need(review && review.reviewHash === scope.reviewHash && !review.reviewRequired);
  return { review, replayed: raw.replayed };
}
