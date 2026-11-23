import { checkoutPrincipalKey, MerchantCheckoutError, type CheckoutPrincipal } from "./merchantCheckoutQuote.server";
import { onSiteSubmissionIdentity, parseOnSiteSubmissionSnapshot, planOnSiteSubmission, quoteOnSiteSubmissionSnapshot } from "./merchantCheckoutOnSiteSubmissionPlan.server";
import { parseOnSiteCheckoutResult, readOnSiteCheckoutResult } from "./merchantCheckoutOnSiteResult.server";
import { checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";

export type OnSiteSubmissionRpc = (name: "faolla_member_checkout_on_site_snapshot_v1" | "faolla_member_checkout_on_site_commit_v1",
  args: Record<string, unknown>, signal: AbortSignal) => Promise<{ data: unknown; error: { message?: string } | null }>;
type Input = { request: unknown; principal: CheckoutPrincipal; authorize(): Promise<CheckoutPrincipal | null>; signal?: AbortSignal; now?: () => number };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const noWrite = new Set(["checkout_conflict", "checkout_quote_changed", "checkout_quote_expired", "checkout_operation_conflict", "checkout_disabled",
  "checkout_offer_not_found", "checkout_membership_unavailable", "checkout_quantity_unavailable", "checkout_coupon_unavailable", "checkout_on_site_unavailable"]);
const beforeWrite = new Set(["checkout_invalid_request", "checkout_invalid_selection", "checkout_invalid_coupon_selection", "checkout_invalid_customer",
  "checkout_unauthorized", "checkout_source_changed", "checkout_module_unavailable", "checkout_slot_unavailable", "checkout_booking_quantity_unsupported"]);

/** Explicit injected, bounded ports ONLY. No live client, env fallback,
 * role grant, HTTP route, automatic retry or points-path fallback. */
async function run(input: Input, rpc: OnSiteSubmissionRpc, preview: boolean) {
  let writing = false;
  try {
    const principal = structuredClone(input.principal), identity = onSiteSubmissionIdentity(structuredClone(input.request), principal);
    const now = input.now ?? Date.now, deadline = now() + 12_000;
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
    const guard = () => { if (signal.aborted || now() >= deadline) throw new Error("checkout_deadline_exceeded"); };
    const authorize = async () => { guard(); const current = await input.authorize(); guard();
      if (!current || checkoutPrincipalKey(current) !== identity.principalKey) throw new Error("checkout_unauthorized"); };
    const call = async (name: Parameters<OnSiteSubmissionRpc>[0], args: Record<string, unknown>) => {
      let response: Awaited<ReturnType<OnSiteSubmissionRpc>>;
      try { response = await rpc(name, args, signal); } catch { throw new Error(writing ? "checkout_unconfirmed" : "checkout_unavailable"); }
      if (!object(response) || !Object.hasOwn(response, "data") || !Object.hasOwn(response, "error")
        || response.error !== null && !object(response.error)) throw new Error(writing ? "checkout_unconfirmed" : "checkout_invalid_response");
      if (response.error) {
        const code = response.error.message ?? "";
        if (["merchant_memberships_conflict", "merchant_membership_settings_conflict", "merchant_coupons_conflict", "order_update_conflict", "booking_atomic_conflict"].includes(code)) throw new Error("checkout_conflict");
        throw new Error(noWrite.has(code) ? code : writing ? "checkout_unconfirmed" : "checkout_unavailable");
      }
      if (!object(response.data)) throw new Error(writing ? "checkout_unconfirmed" : "checkout_invalid_response");
      return response.data;
    };
    const args = { p_site_id: identity.siteId, p_operation_key: identity.operationKey, p_principal_key: identity.principalKey, p_request_hash: identity.requestHash };
    await authorize();
    const read = await call("faolla_member_checkout_on_site_snapshot_v1", { ...args, p_offer_id: identity.request.selection.offerId });
    await authorize();
    if (read.replayed === true) return { replayed: true as const, result: parseOnSiteCheckoutResult(read.result, identity) };
    if (read.replayed !== false) throw new Error("checkout_invalid_response");
    const snapshot = parseOnSiteSubmissionSnapshot(read.snapshot, identity);
    if (preview) {
      const quote = quoteOnSiteSubmissionSnapshot(snapshot, identity, principal); guard();
      return { replayed: false as const, quote };
    }
    const prepared = planOnSiteSubmission(snapshot, identity, principal); guard();
    await authorize(); guard();
    if (now() >= Date.parse(prepared.notAfter)) throw new Error("checkout_quote_expired");
    writing = true;
    const written = await call("faolla_member_checkout_on_site_commit_v1", { ...args, p_snapshot: snapshot, p_plan: prepared.plan, p_not_after: prepared.notAfter });
    try {
      await authorize();
      if (typeof written.replayed !== "boolean") throw new Error("checkout_invalid_response");
      const result = parseOnSiteCheckoutResult(written.result, identity), expected = prepared.plan.receipt;
      for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
        if (key === "resourceId" && written.replayed) continue;
        if (result.terms[key] !== expected[key]) throw new Error("checkout_invalid_response");
      }
      return { replayed: written.replayed, result };
    } catch { throw new Error("checkout_unconfirmed"); }
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const publicCode = noWrite.has(code) || !writing && beforeWrite.has(code) ? code : writing ? "checkout_unconfirmed" : "checkout_unavailable";
    throw new MerchantCheckoutError(publicCode, publicCode === "checkout_unauthorized" ? 401
      : ["checkout_invalid_request", "checkout_invalid_selection", "checkout_invalid_coupon_selection", "checkout_invalid_customer"].includes(publicCode) ? 400
        : publicCode === "checkout_module_unavailable" ? 403 : publicCode === "checkout_offer_not_found" ? 404
          : ["checkout_unavailable", "checkout_unconfirmed", "checkout_disabled"].includes(publicCode) ? 503 : 409);
  }
}
export async function previewOnSiteCheckout(input: Input, rpc: OnSiteSubmissionRpc) { return run(input, rpc, true); }
export async function submitOnSiteCheckout(input: Input, rpc: OnSiteSubmissionRpc) { return run(input, rpc, false); }

/** Read the same original nonce, not a new method-specific order. Null is NOT
 * proof that an in-flight submit cannot still commit; callers must retain it. */
export async function recoverOnSiteCheckout(input: unknown, ports: {
  authorize(): Promise<CheckoutPrincipal | null>;
  call(name: "faolla_member_checkout_on_site_result_v1", args: Record<string, unknown>, signal: AbortSignal): Promise<{ data: unknown; error: { message?: string } | null }>;
}) {
  const stable = structuredClone(input), signal = AbortSignal.timeout(12_000), principal = await ports.authorize();
  if (!principal) throw new Error("checkout_unauthorized");
  const identity = checkoutSubmissionRecoveryIdentity(stable, principal);
  return readOnSiteCheckoutResult({ siteId: identity.siteId, operationKey: identity.operationKey }, {
    authorize: async () => {
      if (signal.aborted) throw new Error("checkout_unavailable");
      const current = await ports.authorize();
      if (signal.aborted) throw new Error("checkout_unavailable");
      if (!current || checkoutPrincipalKey(current) !== identity.principalKey) throw new Error("checkout_identity_changed");
      return current;
    },
    call: (name, args) => {
      if (name !== "faolla_member_checkout_on_site_result_v1" || signal.aborted) throw new Error("checkout_unavailable");
      return ports.call(name, args, signal);
    },
  });
}
