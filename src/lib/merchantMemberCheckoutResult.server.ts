import { createServerSupabaseServiceClient } from "./superAdminServer";
import { parseMemberCheckoutCancellation, parseMemberCheckoutResult } from "./merchantMemberCheckoutResult";
export type MemberCheckoutResultRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
function rpc(): MemberCheckoutResultRpc {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("checkout_unavailable");
  return (name, args) => client.rpc(name, args).abortSignal(AbortSignal.timeout(12_000));
}
const known = new Set(["checkout_not_found", "checkout_conflict", "checkout_cancellation_review_required", "checkout_cancellation_not_allowed", "checkout_cancellation_deadline", "booking_atomic_inactive"]);
function assertScope(input: { siteId: string; operationKey: string; principalKey: string }) {
  if (!/^\d{8}$/.test(input.siteId) || !/^[a-f0-9]{64}$/.test(input.operationKey) || !/^account:[0-9]{8}:[A-Za-z0-9_-]{8,128}$/.test(input.principalKey)) throw new Error("checkout_unauthorized");
}
export async function readMemberCheckoutResult(input: { siteId: string; operationKey: string; principalKey: string }, call = rpc()) {
  assertScope(input);
  const result = await Promise.resolve(call("faolla_member_checkout_result_v2", { p_site_id: input.siteId, p_operation_key: input.operationKey, p_principal_key: input.principalKey }))
    .catch(() => { throw new Error("checkout_unavailable"); });
  if (result.error) throw new Error("checkout_unavailable");
  return result.data === null ? null : parseMemberCheckoutResult(result.data, input);
}
/** One cancellation call. A timeout/malformed result keeps the original key;
 * explicit read/reconciliation is required. Never send an inverse mutation. */
export async function cancelMemberCheckout(input: { siteId: string; operationKey: string; principalKey: string; expectedUpdatedAt: string }, call = rpc()) {
  assertScope(input);
  if (typeof input.expectedUpdatedAt !== "string" || input.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw new Error("checkout_invalid_request");
  const result = await Promise.resolve(call("faolla_member_checkout_cancel_v2", { p_site_id: input.siteId, p_operation_key: input.operationKey, p_principal_key: input.principalKey, p_expected_updated_at: input.expectedUpdatedAt }))
    .catch(() => { throw new Error("checkout_unconfirmed"); });
  if (result.error) {
    if (["order_update_conflict", "merchant_memberships_conflict", "merchant_membership_settings_conflict", "merchant_coupons_conflict"].includes(result.error.message ?? "")) throw new Error("checkout_conflict");
    throw new Error(known.has(result.error.message ?? "") ? result.error.message : "checkout_unconfirmed");
  }
  const data = result.data as { replayed?: unknown; receipt?: Record<string, unknown> } | null;
  if (!data || typeof data.replayed !== "boolean" || data.receipt?.siteId !== input.siteId || data.receipt?.operationKey !== input.operationKey
    || data.receipt?.closed !== true) throw new Error("checkout_unconfirmed");
  try { return { replayed: data.replayed, cancellation: parseMemberCheckoutCancellation(data.receipt) }; }
  catch { throw new Error("checkout_unconfirmed"); }
}
