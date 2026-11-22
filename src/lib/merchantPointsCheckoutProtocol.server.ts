import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseMerchantCheckoutSelection, type MerchantCheckoutSelection } from "./merchantCheckoutCatalog";
import { checkoutPrincipalKey, MerchantCheckoutError, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";

/** Proposed atomic adapter contract, not a production adapter. The snapshot and
 * commit RPCs do not exist on the production database yet. No default client,
 * environment connection or old cashier/booking fallback is provided here. */
export type CheckoutJson = null | boolean | number | string | CheckoutJson[] | { [key: string]: CheckoutJson };
export type PointsCheckoutIntent = {
  siteId: string; nonce: string; resourceKind: "booking" | "order"; selection: MerchantCheckoutSelection;
};
export type PointsCheckoutIdentity = {
  siteId: string; principalKey: string; operationKey: string; requestHash: string;
  resourceKind: "booking" | "order"; selection: MerchantCheckoutSelection;
};
export type PointsCheckoutReceipt = {
  version: 1; siteId: string; principalKey: string; operationKey: string; requestHash: string;
  offerId: string; offerRevision: string; resourceKind: "booking" | "order"; resourceId: string;
  membershipId: string; transactionId: string; totalPoints: number; status: "points_redeemed";
};
export type PointsCheckoutSnapshot = {
  protocol: 1; siteId: string; principalKey: string; operationKey: string; requestHash: string;
  revision: string; data: CheckoutJson;
};
export type PointsCheckoutPlan = { receipt: PointsCheckoutReceipt; mutation: CheckoutJson };
export type PointsCheckoutRpc = (name: "faolla_member_checkout_snapshot_v1" | "faolla_member_checkout_commit_v1",
  args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;

function need(value: unknown, code = "checkout_invalid_response"): asserts value {
  if (!value) throw new MerchantCheckoutError(code, code === "checkout_unauthorized" ? 401 : 409);
}
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
    && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}
function serializable(value: unknown): value is CheckoutJson {
  try {
    const encoded = JSON.stringify(value);
    if (!encoded || Buffer.byteLength(encoded) > 262_144) return false;
    const visit = (v: unknown, depth: number): boolean => depth <= 24 && (v === null || typeof v === "boolean" || typeof v === "string"
      || (typeof v === "number" && Number.isFinite(v)) || (Array.isArray(v) ? v.every(item => visit(item, depth + 1))
        : record(v) && Object.values(v).every(item => visit(item, depth + 1))));
    return visit(value, 0);
  } catch { return false; }
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const key = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9:_-]{1,180}$/.test(v);

export function pointsCheckoutIdentity(intent: PointsCheckoutIntent, principal: CheckoutPrincipal): PointsCheckoutIdentity {
  need(intent && /^\d{8}$/.test(intent.siteId) && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(intent.nonce), "checkout_invalid_intent");
  need(intent.resourceKind === "booking" || intent.resourceKind === "order", "checkout_invalid_intent");
  const selection = parseMerchantCheckoutSelection(intent.selection);
  // v1 cannot atomically consume coupons. Do not let a coupon selection fall
  // through to a points-only commit while the combination bridge is pending.
  need(!selection.couponClaims?.length, "checkout_coupon_commit_unavailable");
  need((intent.resourceKind === "booking") === (selection.slotKey !== undefined), "checkout_invalid_intent");
  const principalKey = checkoutPrincipalKey(principal);
  return { siteId: intent.siteId, principalKey, resourceKind: intent.resourceKind, selection,
    operationKey: hash(JSON.stringify(["member-checkout-v1", intent.siteId, principalKey, intent.nonce.toLowerCase()])),
    requestHash: hash(JSON.stringify(["points", intent.resourceKind, selection.offerId, selection.offerRevision, selection.quantity, selection.slotKey ?? null])) };
}

function assertReceipt(raw: unknown, expected: PointsCheckoutIdentity): asserts raw is PointsCheckoutReceipt {
  need(record(raw) && raw.version === 1 && raw.status === "points_redeemed");
  for (const k of ["siteId", "principalKey", "operationKey", "requestHash", "resourceKind"] as const) need(raw[k] === expected[k]);
  need(raw.offerId === expected.selection.offerId && raw.offerRevision === expected.selection.offerRevision);
  need(key(raw.resourceId) && key(raw.membershipId) && key(raw.transactionId));
  need(Number.isSafeInteger(raw.totalPoints) && Number(raw.totalPoints) > 0 && Number(raw.totalPoints) <= 99_999_999);
  need(Object.keys(raw).every(k => ["version", "siteId", "principalKey", "operationKey", "requestHash", "offerId", "offerRevision", "resourceKind",
    "resourceId", "membershipId", "transactionId", "totalPoints", "status"].includes(k)));
}

/** Exactly one atomic write RPC per attempt. The FUTURE SQL implementation must
 * validate current catalog, principal/member mapping, membership CAS, inventory,
 * booking generation and capacity, and write all domain records and the receipt
 * in ONE transaction. JS orchestration/mocked RPC tests do not prove that SQL.
 *
 * Only an explicit no-write CAS conflict permits bounded re-planning. Unknown
 * commit results keep the original nonce; a later authorized lookup recovers it.
 */
async function execute(input: {
  intent: PointsCheckoutIntent; principal: CheckoutPrincipal;
  authorize: () => Promise<CheckoutPrincipal | null>; rpc: PointsCheckoutRpc;
  plan: (snapshot: PointsCheckoutSnapshot, identity: PointsCheckoutIdentity) => Promise<PointsCheckoutPlan>;
  signal?: AbortSignal; deadline?: number; now?: () => number;
}): Promise<{ replayed: boolean; receipt: PointsCheckoutReceipt }> {
  // Capture before any await; caller edits cannot change a pending operation.
  const identity = pointsCheckoutIdentity(structuredClone(input.intent), structuredClone(input.principal));
  const now = input.now ?? Date.now, deadline = input.deadline ?? now() + 12_000;
  need(Number.isFinite(deadline), "checkout_invalid_deadline");
  const guard = () => {
    need(!input.signal?.aborted && now() < deadline, "checkout_deadline_exceeded");
  };
  const authorize = async () => {
    guard(); const principal = await input.authorize(); guard();
    need(principal && checkoutPrincipalKey(principal) === identity.principalKey, "checkout_unauthorized");
  };
  const args = { p_site_id: identity.siteId, p_principal_key: identity.principalKey, p_operation_key: identity.operationKey, p_request_hash: identity.requestHash };
  const call = async (name: Parameters<PointsCheckoutRpc>[0], values: Record<string, unknown>, writing: boolean) => {
    let response: Awaited<ReturnType<PointsCheckoutRpc>>;
    try { response = await input.rpc(name, values); } catch { throw new MerchantCheckoutError(writing ? "checkout_unconfirmed" : "checkout_unavailable", 503); }
    if (response.error) {
      const allowed = new Set(["checkout_conflict", "checkout_cancelled", "checkout_quote_changed", "checkout_membership_unavailable",
        "checkout_insufficient_points", "checkout_quantity_unavailable", "checkout_operation_conflict"]);
      throw new MerchantCheckoutError(allowed.has(response.error.code ?? "") ? response.error.code! : writing ? "checkout_unconfirmed" : "checkout_unavailable", 409);
    }
    need(record(response.data), writing ? "checkout_unconfirmed" : "checkout_invalid_response"); return response.data;
  };
  const outcome = (raw: Record<string, unknown>, planned?: PointsCheckoutReceipt) => {
    need(typeof raw.replayed === "boolean"); assertReceipt(raw.receipt, identity);
    if (planned) need(isDeepStrictEqual(raw.receipt, planned), "checkout_unconfirmed");
    return { replayed: raw.replayed, receipt: structuredClone(raw.receipt) };
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    await authorize();
    const read = await call("faolla_member_checkout_snapshot_v1", { ...args }, false);
    if (read.replayed === true) { await authorize(); return outcome(read); }
    need(read.replayed === false && record(read.snapshot));
    const snapshot = read.snapshot;
    need(snapshot.protocol === 1 && key(snapshot.revision) && serializable(snapshot.data));
    for (const field of ["siteId", "principalKey", "operationKey", "requestHash"] as const) need(snapshot[field] === identity[field]);
    guard();
    const plan = structuredClone(await input.plan(structuredClone(snapshot) as PointsCheckoutSnapshot, structuredClone(identity)));
    guard(); assertReceipt(plan.receipt, identity); need(serializable(plan.mutation), "checkout_invalid_plan");
    await authorize(); guard();
    try {
      const written = await call("faolla_member_checkout_commit_v1", { ...args, p_expected_revision: snapshot.revision,
        p_mutation: plan.mutation, p_receipt: plan.receipt }, true);
      try { await authorize(); return outcome(written, plan.receipt); } catch { throw new MerchantCheckoutError("checkout_unconfirmed", 503); }
    } catch (error) {
      if (!(error instanceof MerchantCheckoutError) || error.code !== "checkout_conflict" || attempt === 2) throw error;
    }
  }
  throw new MerchantCheckoutError("checkout_conflict");
}

const SAFE_CODES = new Set(["checkout_invalid_response", "checkout_unauthorized", "checkout_invalid_intent", "checkout_invalid_selection",
  "checkout_invalid_deadline", "checkout_deadline_exceeded", "checkout_unconfirmed", "checkout_unavailable", "checkout_conflict",
  "checkout_cancelled", "checkout_quote_changed", "checkout_membership_unavailable", "checkout_insufficient_points",
  "checkout_quantity_unavailable", "checkout_operation_conflict", "checkout_invalid_plan", "checkout_coupon_commit_unavailable", "checkout_invalid_coupon_selection"]);
export async function executePointsCheckout(input: Parameters<typeof execute>[0]): ReturnType<typeof execute> {
  try { return await execute(input); }
  catch (error) {
    if (error instanceof MerchantCheckoutError && SAFE_CODES.has(error.code)) throw error;
    if (error instanceof Error && SAFE_CODES.has(error.message)) throw new MerchantCheckoutError(error.message);
    throw new MerchantCheckoutError("checkout_unavailable", 503);
  }
}
