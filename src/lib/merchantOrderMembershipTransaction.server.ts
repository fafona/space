import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import type { MerchantMembershipRecord } from "@/lib/merchantMemberships";

export type MerchantTransactionPageSnapshot = {
  id: string;
  slug: string;
  blocks: unknown;
  updated_at: string | null;
};

export type MerchantOrderMembershipMutation = {
  orders?: {
    expectedRows: MerchantTransactionPageSnapshot[];
    next: MerchantOrderRecord[];
  };
  memberships?: {
    expectedUpdatedAt: string | null;
    next: MerchantMembershipRecord[];
  };
};

export type MerchantTransactionClient = {
  rpc?: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: unknown }>;
};

const SAFE_ERROR_CODES = new Set([
  "order_update_conflict",
  "merchant_memberships_conflict",
  "invalid_site_id",
]);

function transactionError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
  // Never return SQL details, record contents or credentials through an API.
  return SAFE_ERROR_CODES.has(message) ? message : "merchant_transaction_unavailable";
}

export async function commitMerchantOrderMembershipTransaction(
  client: MerchantTransactionClient,
  siteId: string,
  mutation: MerchantOrderMembershipMutation,
): Promise<{ error: string | null }> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(siteId)) return { error: "invalid_site_id" };
  if (typeof client.rpc !== "function") return { error: "merchant_transaction_unavailable" };
  try {
    const result = await client.rpc("faolla_commit_order_membership_v1", {
      p_site_id: siteId,
      p_mutation: mutation,
    });
    if (result.error) return { error: transactionError(result.error) };
    const data = result.data as { updatedAt?: unknown } | null | undefined;
    if (!data || typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt))) {
      return { error: "merchant_transaction_unavailable" };
    }
    return { error: null };
  } catch (error) {
    // An ambiguous transport failure is not grounds for inverse compensation,
    // retrying a stale snapshot, or falling back to non-transactional writes.
    return { error: transactionError(error) };
  }
}
