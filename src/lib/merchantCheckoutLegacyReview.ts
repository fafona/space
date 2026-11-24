export type LegacyReviewRequest = { siteId: string; blockId: string; requestId: string };
export type LegacyOrderReview = { version: 1; siteId: string; blockId: string; requestId: string;
  order: null | { id: string; status: "pending" | "confirmed" | "completed" | "cancelled"; createdAt: string; updatedAt: string } };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_-]{1,160}$/.test(v);
function need(v: unknown): asserts v { if (!v) throw new Error("checkout_legacy_review_invalid"); }
export function parseLegacyReviewRequest(v: unknown): LegacyReviewRequest {
  need(object(v) && exact(v, ["siteId", "blockId", "requestId"]) && typeof v.siteId === "string" && /^\d{8}$/.test(v.siteId) && id(v.blockId) && id(v.requestId));
  return { siteId: v.siteId, blockId: v.blockId, requestId: v.requestId };
}
/** Only an order-record match. Never proof of payment, ownership of all local
 * draft contents, or permission to migrate/clear a draft or start a new order. */
export function parseLegacyOrderReview(v: unknown, expected: LegacyReviewRequest): LegacyOrderReview {
  const q = parseLegacyReviewRequest(expected);
  need(object(v) && exact(v, ["version", "siteId", "blockId", "requestId", "order"]) && v.version === 1
    && v.siteId === q.siteId && v.blockId === q.blockId && v.requestId === q.requestId);
  if (v.order === null) return { version: 1, ...q, order: null };
  const o = v.order;
  need(object(o) && exact(o, ["id", "status", "createdAt", "updatedAt"]) && id(o.id)
    && typeof o.status === "string" && ["pending", "confirmed", "completed", "cancelled"].includes(o.status));
  const stamp = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
  need(stamp(o.createdAt) && stamp(o.updatedAt) && o.updatedAt >= o.createdAt);
  return { version: 1, ...q, order: { id: o.id, status: o.status as NonNullable<LegacyOrderReview["order"]>["status"], createdAt: o.createdAt, updatedAt: o.updatedAt } };
}
