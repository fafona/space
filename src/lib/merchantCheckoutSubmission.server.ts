import { createServerMerchantCheckoutRuntimeClient } from "./merchantCheckoutRuntime.server";
import { checkoutPrincipalKey, MerchantCheckoutError, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";
import { checkoutSubmissionIdentity, parseCheckoutSubmissionSnapshot, planCheckoutSubmission } from "./merchantCheckoutSubmissionPlan.server";
import { parseMemberCheckoutResult } from "./merchantMemberCheckoutResult";

export type CheckoutSubmissionRpc = (name: "faolla_member_checkout_submission_snapshot_v2" | "faolla_member_checkout_submission_commit_v2",
  args: Record<string, unknown>, signal?: AbortSignal) => Promise<{ data: unknown; error: { message?: string } | null }>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const noWrite = new Set(["checkout_conflict", "checkout_quote_changed", "checkout_quote_expired", "checkout_operation_conflict", "checkout_disabled",
  "checkout_offer_not_found", "checkout_membership_unavailable", "checkout_insufficient_points", "checkout_quantity_unavailable", "checkout_coupon_unavailable"]);
function defaultRpc(): CheckoutSubmissionRpc {
  const client = createServerMerchantCheckoutRuntimeClient();
  if (!client) throw new MerchantCheckoutError("checkout_unavailable", 503);
  return async (name, args, signal) => client.rpc(name, args).abortSignal(signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000));
}

/** Exactly one composite financial write. No automatic conflict/transport
 * retry, no new nonce, no old cashier fallback and no inverse compensation. */
export async function submitMemberCheckout(input: {
  request: unknown; principal: CheckoutPrincipal; authorize: () => Promise<CheckoutPrincipal | null>;
  signal?: AbortSignal; now?: () => number;
}, suppliedRpc?: CheckoutSubmissionRpc) {
  let writing = false;
  try {
    const principal = structuredClone(input.principal), identity = checkoutSubmissionIdentity(structuredClone(input.request), principal);
    const now = input.now ?? Date.now, deadline = now() + 12_000, rpc = suppliedRpc ?? defaultRpc();
    const guard = () => { if (input.signal?.aborted || now() >= deadline) throw new Error("checkout_deadline_exceeded"); };
    const authorize = async () => { guard(); const principal = await input.authorize(); guard();
      if (!principal || checkoutPrincipalKey(principal) !== identity.principalKey) throw new Error("checkout_unauthorized"); };
    const args = { p_site_id: identity.siteId, p_operation_key: identity.operationKey, p_principal_key: identity.principalKey, p_request_hash: identity.requestHash };
    const call = async (name: Parameters<CheckoutSubmissionRpc>[0], values: Record<string, unknown>) => {
      let response: Awaited<ReturnType<CheckoutSubmissionRpc>>;
      try { response = await rpc(name, values, input.signal); } catch { throw new Error(writing ? "checkout_unconfirmed" : "checkout_unavailable"); }
      if (response.error) {
        const code = response.error.message ?? "";
        if (["merchant_memberships_conflict", "merchant_membership_settings_conflict", "merchant_coupons_conflict", "order_update_conflict", "booking_atomic_conflict"].includes(code)) throw new Error("checkout_conflict");
        throw new Error(noWrite.has(code) ? code : writing ? "checkout_unconfirmed" : "checkout_unavailable");
      }
      if (!object(response.data)) throw new Error(writing ? "checkout_unconfirmed" : "checkout_invalid_response");
      return response.data;
    };
    await authorize();
    const read = await call("faolla_member_checkout_submission_snapshot_v2", { ...args, p_offer_id: identity.request.selection.offerId });
    if (read.replayed === true) {
      await authorize(); return { replayed: true, result: parseMemberCheckoutResult(read.result, identity) };
    }
    if (read.replayed !== false) throw new Error("checkout_invalid_response");
    const snapshot = parseCheckoutSubmissionSnapshot(read.snapshot, identity);
    guard(); const prepared = await planCheckoutSubmission(snapshot, identity, principal); guard();
    await authorize(); guard();
    if (now() >= Date.parse(prepared.notAfter)) throw new Error("checkout_quote_expired");
    writing = true;
    const written = await call("faolla_member_checkout_submission_commit_v2", { ...args, p_snapshot: snapshot, p_plan: prepared.plan, p_not_after: prepared.notAfter });
    try {
      await authorize();
      if (typeof written.replayed !== "boolean") throw new Error("checkout_invalid_response");
      const result = parseMemberCheckoutResult(written.result, identity), expected = prepared.plan.receipt as Record<string, unknown>;
      if ((!written.replayed && result.resourceId !== expected.resourceId) || result.resourceKind !== expected.resourceKind
        || result.totalPoints !== expected.totalPoints || result.couponCount !== expected.couponCount) throw new Error("checkout_invalid_response");
      return { replayed: written.replayed, result };
    } catch { throw new Error("checkout_unconfirmed"); }
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const beforeWrite = new Set(["checkout_invalid_request", "checkout_invalid_selection", "checkout_invalid_coupon_selection", "checkout_invalid_customer",
      "checkout_unauthorized", "checkout_source_changed", "checkout_module_unavailable", "checkout_slot_unavailable", "checkout_booking_quantity_unsupported"]);
    const safe = noWrite.has(code) || !writing && beforeWrite.has(code);
    const publicCode = safe ? code : writing ? "checkout_unconfirmed" : "checkout_unavailable";
    throw new MerchantCheckoutError(publicCode, publicCode === "checkout_unauthorized" ? 401
      : ["checkout_invalid_request", "checkout_invalid_selection", "checkout_invalid_customer", "checkout_invalid_coupon_selection"].includes(publicCode) ? 400
        : publicCode === "checkout_module_unavailable" ? 403 : publicCode === "checkout_offer_not_found" ? 404
          : ["checkout_unavailable", "checkout_unconfirmed", "checkout_disabled"].includes(publicCode) ? 503 : 409);
  }
}
