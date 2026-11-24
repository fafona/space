import { parseCheckoutHistoryRecovery, type CheckoutHistoryRecovery } from "./merchantCheckoutHistoryRecovery";

export type CheckoutHistoryInventoryRequest = { siteId: string; after: string | null };
export type CheckoutHistoryInventory = CheckoutHistoryInventoryRequest & { version: 1; items: Array<{ operationKey: string; original: NonNullable<CheckoutHistoryRecovery["original"]>; reviewRequired: boolean }>; nextCursor: string | null };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function parseCheckoutHistoryInventoryRequest(raw: unknown): CheckoutHistoryInventoryRequest {
  if (!object(raw) || Object.keys(raw).length !== 2 || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId) || raw.after !== null && !hash(raw.after)) throw new Error("checkout_invalid_request");
  return { siteId: raw.siteId, after: raw.after };
}
/** Bounded, principal-scoped read projection only. No nonce, generation,
 * review hash or acknowledgement/registration capability is supplied. */
export function parseCheckoutHistoryInventory(raw: unknown, expected: CheckoutHistoryInventoryRequest): CheckoutHistoryInventory {
  const scope = parseCheckoutHistoryInventoryRequest(expected), fail = () => { throw new Error("checkout_history_unavailable"); };
  if (!object(raw) || Object.keys(raw).length !== 5 || raw.version !== 1 || raw.siteId !== scope.siteId || raw.after !== scope.after
    || !Array.isArray(raw.items) || raw.items.length > 10 || raw.nextCursor !== null && !hash(raw.nextCursor)) return fail();
  let previous = scope.after ?? "";
  const items = raw.items.map(item => {
    if (!object(item) || Object.keys(item).length !== 3 || !hash(item.operationKey) || item.operationKey <= previous) return fail();
    const value = parseCheckoutHistoryRecovery({ ...item, version: 1, siteId: scope.siteId }, { siteId: scope.siteId, operationKey: item.operationKey });
    if (!value.original || value.reviewRequired === null) return fail();
    previous = item.operationKey;
    return { operationKey: value.operationKey, original: value.original, reviewRequired: value.reviewRequired };
  });
  if (raw.nextCursor !== null && (items.length !== 10 || raw.nextCursor !== previous)) return fail();
  return { version: 1, ...scope, items, nextCursor: raw.nextCursor };
}
