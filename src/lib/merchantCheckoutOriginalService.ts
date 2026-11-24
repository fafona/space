import { parseCheckoutHistoryRecovery } from "./merchantCheckoutHistoryRecovery";
import { cartClientOriginalKey, type CartClientOriginal } from "./merchantCheckoutCartReview";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function need(v: unknown): asserts v { if (!v) throw Error("checkout_service_unavailable"); }
export type OriginalServiceReview = { version: 1; siteId: string; operationKey: string; reviewHash: string; original: CartClientOriginal; reviewRequired: boolean };
export function originalServiceResource(original: CartClientOriginal) { return original.kind === "cart" ? original.result.resource : original.original.result.resource; }
export function originalServiceClosed(original: CartClientOriginal) { return original.kind === "cart" ? original.result.closed : original.original.result.closed; }
export function parseOriginalServiceRequest(raw: unknown, cancel: boolean) {
  if (!object(raw) || !exact(raw, cancel ? ["siteId", "operationKey", "reviewHash", "expectedUpdatedAt"] : ["siteId", "operationKey"])
    || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId) || !hash(raw.operationKey)
    || cancel && (!hash(raw.reviewHash) || typeof raw.expectedUpdatedAt !== "string" || raw.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(raw.expectedUpdatedAt)))) throw Error("checkout_invalid_request");
  return { siteId: raw.siteId, operationKey: raw.operationKey, ...(cancel ? { reviewHash: raw.reviewHash as string, expectedUpdatedAt: raw.expectedUpdatedAt as string } : {}) };
}
export function parseOriginalServiceReview(raw: unknown, scope: { siteId: string; operationKey: string }): OriginalServiceReview {
  need(object(raw) && exact(raw, ["version", "siteId", "operationKey", "reviewHash", "original", "reviewRequired"]) && hash(raw.reviewHash));
  const read = parseCheckoutHistoryRecovery({ version: raw.version, siteId: raw.siteId, operationKey: raw.operationKey, original: raw.original, reviewRequired: raw.reviewRequired }, scope);
  need(read.original && cartClientOriginalKey(read.original) === scope.operationKey);
  return { version: 1, siteId: read.siteId, operationKey: read.operationKey, original: read.original, reviewRequired: read.reviewRequired!, reviewHash: raw.reviewHash };
}
export function parseOriginalServiceCancellation(raw: unknown, scope: { siteId: string; operationKey: string; reviewHash: string }) {
  need(object(raw) && exact(raw, ["version", "siteId", "operationKey", "requestedReviewHash", "replayed", "review"]) && raw.version === 1
    && raw.siteId === scope.siteId && raw.operationKey === scope.operationKey && raw.requestedReviewHash === scope.reviewHash && typeof raw.replayed === "boolean");
  const review = parseOriginalServiceReview(raw.review, scope); need(!review.reviewRequired && originalServiceClosed(review.original));
  return { version: 1 as const, siteId: scope.siteId, operationKey: scope.operationKey, requestedReviewHash: scope.reviewHash, replayed: raw.replayed, review };
}
export function originalServiceHref(siteId: string, operationKey: string, locale = "zh-CN") {
  parseOriginalServiceRequest({ siteId, operationKey }, false);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || locale.length > 40) throw Error("checkout_invalid_request");
  return `/member-checkout/${siteId}/service/${operationKey}?uiLocale=${encodeURIComponent(locale)}`;
}
