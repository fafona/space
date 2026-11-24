import { parseCheckoutHistoryRecoveryRequest } from "./merchantCheckoutHistoryRecovery";

type Scope = { siteId: string; operationKey: string };
export type UnusedReferenceReview = Scope & { version: 1; state: "unused" | "closed" | "original"; reviewHash: string | null; closedAt: string | null };
export type ClosedUnusedReference = Scope & { version: 1; closed: true; replayed: boolean; reviewHash: string; closedAt: string };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown): v is string => typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v));
function need(v: unknown): asserts v { if (!v) throw new Error("checkout_unused_invalid_response"); }
function scope(raw: Record<string, unknown>, expected: Scope) {
  need(/^\d{8}$/.test(expected.siteId) && hash(expected.operationKey) && raw.version === 1 && raw.siteId === expected.siteId && raw.operationKey === expected.operationKey);
}
/** No items, member, amounts or local draft authority. "unused" is NOT a
 * release proof; only a durable, explicit close forbids late financial writes. */
export function parseUnusedReferenceReview(raw: unknown, expected: Scope): UnusedReferenceReview {
  need(object(raw) && Object.keys(raw).length === 6); scope(raw, expected);
  need(["unused", "closed", "original"].includes(String(raw.state)));
  need(raw.state === "original" ? raw.reviewHash === null && raw.closedAt === null
    : hash(raw.reviewHash) && (raw.state === "closed" ? date(raw.closedAt) : raw.closedAt === null));
  return { version: 1, siteId: expected.siteId, operationKey: expected.operationKey, state: raw.state as UnusedReferenceReview["state"], reviewHash: raw.reviewHash as string | null, closedAt: raw.closedAt as string | null };
}
export function parseClosedUnusedReference(raw: unknown, expected: Scope & { reviewHash: string }): ClosedUnusedReference {
  need(object(raw) && Object.keys(raw).length === 7); scope(raw, expected);
  need(hash(expected.reviewHash) && raw.reviewHash === expected.reviewHash && raw.closed === true && typeof raw.replayed === "boolean" && date(raw.closedAt));
  return { version: 1, siteId: expected.siteId, operationKey: expected.operationKey, closed: true, replayed: raw.replayed, reviewHash: expected.reviewHash, closedAt: raw.closedAt };
}
export function parseUnusedReferenceRequest(raw: unknown, close: boolean) {
  if (!object(raw) || Object.keys(raw).length !== (close ? 3 : 2) || Object.keys(raw).some(k => !["siteId", "nonce", ...(close ? ["reviewHash"] : [])].includes(k))
    || close && !hash(raw.reviewHash)) throw new Error("checkout_invalid_request");
  return { ...parseCheckoutHistoryRecoveryRequest({ siteId: raw.siteId, nonce: raw.nonce }), ...(close ? { reviewHash: raw.reviewHash as string } : {}) };
}
