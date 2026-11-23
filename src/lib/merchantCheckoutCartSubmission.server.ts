import { cartSubmissionIdentity, cartSelectionIdentity, parseCartSubmissionSnapshot, planCartSubmission, cartConfirmationHash } from "./merchantCheckoutCartSubmissionPlan.server";
import { quoteCheckoutCartSnapshot } from "./merchantCheckoutCartQuote.server";
import { parseCartCheckoutResult } from "./merchantCheckoutCartResult";
import { checkoutPrincipalKey, MerchantCheckoutError, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";
import { checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";
import { isDeepStrictEqual } from "node:util";

export type CartSubmissionRpc = (name: "faolla_member_checkout_cart_submission_snapshot_v1" | "faolla_member_checkout_cart_commit_v1" | "faolla_member_checkout_cart_result_v1" | "faolla_member_checkout_cart_cancel_v1",
  args: Record<string, unknown>, signal: AbortSignal) => Promise<{ data: unknown; error: { message?: string } | null }>;
type Input = { principal: CheckoutPrincipal; authorize(): Promise<CheckoutPrincipal | null>; enabled?: (siteId: string) => boolean; signal?: AbortSignal; now?: () => number };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const safe = new Set(["checkout_invalid_request", "checkout_invalid_customer", "checkout_invalid_cart", "checkout_invalid_selection", "checkout_invalid_coupon_selection", "checkout_unauthorized",
  "checkout_quote_changed", "checkout_conflict", "checkout_quote_expired", "checkout_operation_conflict", "checkout_disabled", "checkout_offer_not_found", "checkout_source_changed",
  "checkout_membership_unavailable", "checkout_module_unavailable", "checkout_quantity_unavailable", "checkout_coupon_unavailable", "checkout_coupon_stack_not_allowed", "checkout_cart_coupon_reused",
  "checkout_cart_duplicate_product", "checkout_cart_source_mismatch", "checkout_cart_method_unavailable", "checkout_insufficient_points", "checkout_total_too_large", "checkout_not_found",
  "checkout_cancellation_not_allowed", "checkout_cancellation_review_required", "checkout_refund_required"]);
function publicError(error: unknown, writing: boolean) {
  const code = error instanceof Error ? error.message : "";
  const selected = safe.has(code) ? code : writing ? "checkout_unconfirmed" : "checkout_unavailable";
  return new MerchantCheckoutError(selected, selected === "checkout_unauthorized" ? 401 : selected.startsWith("checkout_invalid_") ? 400
    : ["checkout_unconfirmed", "checkout_unavailable", "checkout_disabled"].includes(selected) ? 503 : 409);
}
function ports(input: Input, siteId: string, rpc: CartSubmissionRpc, requirePilot: boolean) {
  const principal = structuredClone(input.principal), scope = checkoutPrincipalKey(principal), now = input.now ?? Date.now, deadline = now() + 12_000;
  const timer = AbortSignal.timeout(12_000), signal = input.signal ? AbortSignal.any([input.signal, timer]) : timer;
  const guard = () => { if (signal.aborted || now() >= deadline || requirePilot && input.enabled?.(siteId) !== true) throw new Error("checkout_unavailable"); };
  const bounded = async <T>(run: () => PromiseLike<T>): Promise<T> => {
    guard(); let abort: () => void = () => {};
    try { return await Promise.race([Promise.resolve().then(() => { guard(); return run(); }), new Promise<never>((_, reject) => {
      abort = () => reject(new Error("checkout_unavailable")); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    })]); } finally { signal.removeEventListener("abort", abort); }
  };
  const authorize = async () => { const current = await bounded(() => input.authorize()); guard();
    if (!current || checkoutPrincipalKey(current) !== scope) throw new Error("checkout_unauthorized"); };
  const call = async (name: Parameters<CartSubmissionRpc>[0], args: Record<string, unknown>) => {
    let response: Awaited<ReturnType<CartSubmissionRpc>>;
    try { response = await bounded(() => rpc(name, args, signal)); } catch { throw new Error("checkout_unavailable"); } guard();
    if (!object(response) || response.error !== null && !object(response.error) || !Object.hasOwn(response, "data")) throw new Error("checkout_invalid_response");
    if (response.error) throw new Error(safe.has(response.error.message ?? "") ? response.error.message : "checkout_unavailable");
    return response.data;
  };
  return { principal, scope, now, deadline, guard, bounded, authorize, call };
}
/** No live connection, route or env fallback. Default off. Exactly ONE
 * financial write, no automatic retry or inverse compensation. */
async function run(input: Input & { request: unknown }, rpc: CartSubmissionRpc, preview: boolean) {
  let writing = false;
  try {
    const identity = cartSubmissionIdentity(input.request, input.principal), p = ports(input, identity.siteId, rpc, true), selection = cartSelectionIdentity(identity, p.principal);
    await p.authorize();
    const args = { p_site_id: identity.siteId, p_operation_key: identity.operationKey, p_principal_key: identity.principalKey, p_request_hash: identity.requestHash };
    const read = await p.call("faolla_member_checkout_cart_submission_snapshot_v1", { ...args, p_quote_request_hash: selection.requestHash, p_offer_ids: selection.request.lines.map(l => l.offerId) });
    await p.authorize(); if (!object(read)) throw new Error("checkout_invalid_response");
    if (read.replayed === true) {
      const result = parseCartCheckoutResult(read.result, identity);
      if (result.method !== identity.request.method || !isDeepStrictEqual(result.lines.map(l => [l.offerId, l.offerRevision, l.quantity]), identity.request.lines.map(l => [l.offerId, l.offerRevision, l.quantity]))
        || result.couponCount !== identity.request.lines.reduce((s, l) => s + l.couponClaims.length, 0)) throw new Error("checkout_invalid_response");
      return { replayed: true as const, result };
    }
    if (read.replayed !== false) throw new Error("checkout_invalid_response");
    const snapshot = parseCartSubmissionSnapshot(read.snapshot, identity), stamp = Date.parse(snapshot.quoteSnapshot.databaseNow);
    if (!Number.isFinite(stamp) || stamp > p.now() + 2_000 || p.now() - stamp > 12_000) throw new Error("checkout_quote_expired");
    if (preview) {
      const quote = await p.bounded(() => quoteCheckoutCartSnapshot(snapshot.quoteSnapshot, selection, p.principal)); await p.authorize();
      return { replayed: false as const, quote, confirmationHash: cartConfirmationHash(quote, p.principal) };
    }
    const prepared = await p.bounded(() => planCartSubmission(snapshot, identity, p.principal)); await p.authorize(); p.guard();
    const notAfter = new Date(Math.min(Date.parse(prepared.notAfter), Date.now() + Math.max(0, p.deadline - p.now()))).toISOString();
    if (Date.parse(notAfter) <= Date.now()) throw new Error("checkout_quote_expired");
    writing = true;
    const written = await p.call("faolla_member_checkout_cart_commit_v1", { ...args, p_snapshot: snapshot, p_plan: prepared.plan, p_not_after: notAfter });
    try {
      await p.authorize(); if (!object(written) || typeof written.replayed !== "boolean") throw new Error("invalid");
      const result = parseCartCheckoutResult(written.result, identity);
      const expectedLines = prepared.plan.lines.map(l => ({ offerId: l.offerId, offerRevision: l.offerRevision, productId: l.productId, title: l.title, quantity: l.quantity,
        points: l.points, grossMinor: l.grossMinor, discountMinor: l.discountMinor, dueMinor: l.dueMinor, returnPoints: l.returnPoints, returnCoupons: l.returnCoupons, couponCount: l.couponClaims.length }));
      if (result.method !== prepared.plan.method || !written.replayed && result.resourceId !== prepared.plan.record.id
        || result.totalPoints !== prepared.plan.terms.totalPoints || result.dueMinor !== prepared.plan.terms.dueMinor || result.couponCount !== prepared.plan.terms.couponCount
        || result.grossMinor !== prepared.plan.terms.grossMinor || result.discountMinor !== prepared.plan.terms.discountMinor || !isDeepStrictEqual(result.lines, expectedLines)) throw new Error("invalid");
      return { replayed: written.replayed, result };
    } catch { throw new Error("checkout_unconfirmed"); }
  } catch (error) { throw publicError(error, writing); }
}
export const previewCartSubmission = (input: Input & { request: unknown }, rpc: CartSubmissionRpc) => run(input, rpc, true);
export const submitCartCheckout = (input: Input & { request: unknown }, rpc: CartSubmissionRpc) => run(input, rpc, false);
export async function recoverCartCheckout(raw: unknown, input: Input, rpc: CartSubmissionRpc) {
  try {
    const identity = checkoutSubmissionRecoveryIdentity(raw, input.principal), p = ports(input, identity.siteId, rpc, false); await p.authorize();
    const result = await p.call("faolla_member_checkout_cart_result_v1", { p_site_id: identity.siteId, p_operation_key: identity.operationKey, p_principal_key: identity.principalKey });
    await p.authorize(); return result === null ? null : parseCartCheckoutResult(result, identity);
  } catch (error) { throw publicError(error, false); }
}
export async function cancelCartCheckout(raw: unknown, input: Input, rpc: CartSubmissionRpc) {
  let writing = false;
  try {
    if (!object(raw) || Object.keys(raw).length !== 3 || typeof raw.siteId !== "string" || !/^\d{8}$/.test(raw.siteId)
      || typeof raw.operationKey !== "string" || !/^[a-f0-9]{64}$/.test(raw.operationKey) || typeof raw.expectedUpdatedAt !== "string"
      || raw.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(raw.expectedUpdatedAt))) throw new Error("checkout_invalid_request");
    const p = ports(input, raw.siteId, rpc, false); await p.authorize(); p.guard(); writing = true;
    const written = await p.call("faolla_member_checkout_cart_cancel_v1", { p_site_id: raw.siteId, p_operation_key: raw.operationKey, p_principal_key: p.scope,
      p_expected_updated_at: raw.expectedUpdatedAt, p_not_after: new Date(Date.now() + Math.max(0, p.deadline - p.now())).toISOString() });
    try { await p.authorize(); if (!object(written) || typeof written.replayed !== "boolean") throw new Error("invalid");
      const result = parseCartCheckoutResult(written.result, { siteId: raw.siteId, operationKey: raw.operationKey });
      if (!result.closed) throw new Error("invalid"); return { replayed: written.replayed, result };
    } catch { throw new Error("checkout_unconfirmed"); }
  } catch (error) { throw publicError(error, writing); }
}
