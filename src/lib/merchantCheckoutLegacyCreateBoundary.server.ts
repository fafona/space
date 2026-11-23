import type { MerchantOrderMembershipMutation, MerchantTransactionClient } from "./merchantOrderMembershipTransaction.server";
import { CheckoutLegacyBoundaryError } from "./merchantCheckoutLegacyBoundary.server";

const known = new Set(["order_update_conflict", "merchant_memberships_conflict", "invalid_site_id", "checkout_resource_locked", "checkout_change_requires_review", "checkout_original_cancellation_required"]);
/** Only the already-gated unpublished intent path. Exact original CAS and
 * histories run inside the guarded SQL wrapper. No preflight as authority,
 * retries, ordinary-write fallback, receipt adoption or financial effects. */
export async function commitLegacyOrderWithCheckoutIntent(client: MerchantTransactionClient, siteId: string, mutation: MerchantOrderMembershipMutation) {
  if (!/^\d{8}$/.test(siteId)) return { error: "invalid_site_id" };
  if (!client.rpc) return { error: "merchant_transaction_unavailable" };
  const notAfter = new Date(Date.now() + 11_000).toISOString(), signal = AbortSignal.timeout(12_000);
  let stop = () => {};
  try {
    const response = await Promise.race([Promise.resolve().then(() => {
      if (signal.aborted) throw new Error("expired");
      return client.rpc!("faolla_checkout_legacy_order_commit_v1", { p_site_id: siteId, p_mutation: mutation, p_not_after: notAfter });
    }), new Promise<never>((_, reject) => { stop = () => reject(new Error("expired")); signal.addEventListener("abort", stop, { once: true }); })]);
    if (response.error) {
      const error = response.error as { message?: unknown }, code = typeof error.message === "string" ? error.message : "";
      if (["checkout_original_pending", "checkout_intent_review_required"].includes(code)) throw new CheckoutLegacyBoundaryError(code);
      if (code === "checkout_intent_expired") return { error: "order_update_conflict" };
      if (known.has(code)) return { error: code };
      throw new Error("unknown");
    }
    const data = response.data as { updatedAt?: unknown } | null;
    if (signal.aborted || !data || typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error("unknown");
    return { error: null };
  } catch (error) {
    if (error instanceof CheckoutLegacyBoundaryError) throw error;
    throw new CheckoutLegacyBoundaryError("checkout_create_unconfirmed", 503);
  } finally { signal.removeEventListener("abort", stop); }
}
