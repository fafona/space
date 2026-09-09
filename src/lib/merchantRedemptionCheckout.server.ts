import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import type { MerchantTransactionClient } from "@/lib/merchantOrderMembershipTransaction.server";
import type { MerchantRedemptionMutation, MerchantRedemptionOperation } from "@/lib/merchantRedemptionTransaction.server";
import {
  isMerchantRedemptionCheckoutReceipt, isMerchantRedemptionCheckoutSummary,
  type MerchantRedemptionCheckoutContext, type MerchantRedemptionCheckoutReceipt,
  type MerchantRedemptionCheckoutRequest,
} from "@/lib/merchantRedemptionCheckout";

const SAFE_ERRORS = new Set([
  "invalid_site_id", "merchant_membership_settings_conflict", "merchant_coupons_conflict", "merchant_memberships_conflict",
  "redemption_operation_conflict", "redemption_checkout_not_found", "redemption_checkout_cancelled",
  "redemption_pending_checkout_exists", "redemption_checkout_context_required", "redemption_checkout_quote_changed",
  "redemption_legacy_operation_requires_review", "redemption_checkout_pending", "redemption_checkout_not_terminal",
]);
function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : error && typeof error === "object" && "message" in error ? String(error.message) : "";
  throw new Error(SAFE_ERRORS.has(message) ? message : "merchant_transaction_unavailable");
}
function clientOrThrow(): MerchantTransactionClient {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("merchant_transaction_unavailable");
  return client;
}
async function call(client: MerchantTransactionClient, name: string, siteId: string, operatorId: string, args: Record<string, unknown>) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(siteId)) throw new Error("invalid_site_id");
  if (!operatorId || operatorId.length > 120 || operatorId.trim() !== operatorId || typeof client.rpc !== "function") {
    throw new Error("merchant_transaction_unavailable");
  }
  try {
    const response = await client.rpc(name, { p_site_id: siteId, p_operator_id: operatorId, ...args });
    if (response.error) fail(response.error);
    return response.data;
  } catch (error) { fail(error); }
}
function parseContext(data: unknown, siteId: string, operationId?: string): MerchantRedemptionCheckoutContext | null {
  if (!data || typeof data !== "object" || !("checkout" in data)) fail(null);
  const context = (data as { checkout: unknown }).checkout;
  if (context === null) return null;
  if (!isMerchantRedemptionCheckoutSummary(context) || typeof context !== "object" ||
    !("fingerprint" in context) || typeof context.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(context.fingerprint) ||
    !("membershipId" in context) || typeof context.membershipId !== "string" || !context.membershipId ||
    !("request" in context) || !context.request || typeof context.request !== "object") fail(null);
  const result = context as MerchantRedemptionCheckoutContext;
  if ((operationId && result.operationId !== operationId) || result.request.membershipId !== result.membershipId ||
    !Array.isArray(result.request.items) || typeof result.request.note !== "string" || !result.request.quote ||
    (result.result && (result.result.siteId !== siteId || result.result.operationId !== result.operationId || result.result.membershipId !== result.membershipId))) fail(null);
  return result;
}
export async function stageMerchantRedemptionCheckout(client: MerchantTransactionClient, siteId: string, operatorId: string,
  operation: MerchantRedemptionOperation, request: MerchantRedemptionCheckoutRequest) {
  const context = parseContext(await call(client, "faolla_stage_redemption_checkout_v1", siteId, operatorId, {
    p_operation: operation, p_request: request,
  }), siteId, operation.id);
  if (!context || context.fingerprint !== operation.fingerprint || context.membershipId !== operation.membershipId) fail(null);
  return context;
}
export async function getMerchantRedemptionCheckout(siteId: string, operatorId: string, operationId?: string,
  client: MerchantTransactionClient = clientOrThrow()) {
  return parseContext(await call(client, "faolla_get_redemption_checkout_v1", siteId, operatorId, {
    p_operation_id: operationId ?? null,
  }), siteId, operationId);
}
async function updateCheckout(name: string, siteId: string, operatorId: string, operationId: string, client: MerchantTransactionClient) {
  const context = parseContext(await call(client, name, siteId, operatorId, { p_operation_id: operationId }), siteId, operationId);
  if (!context) throw new Error("redemption_checkout_not_found");
  return context;
}
export async function cancelMerchantRedemptionCheckout(siteId: string, operatorId: string, operationId: string,
  client: MerchantTransactionClient = clientOrThrow()) {
  return updateCheckout("faolla_cancel_redemption_checkout_v1", siteId, operatorId, operationId, client);
}
export async function ackMerchantRedemptionCheckout(siteId: string, operatorId: string, operationId: string,
  client: MerchantTransactionClient = clientOrThrow()) {
  return updateCheckout("faolla_ack_redemption_checkout_v1", siteId, operatorId, operationId, client);
}
export async function commitMerchantRedemptionCheckout(client: MerchantTransactionClient, siteId: string, operatorId: string,
  mutation: MerchantRedemptionMutation, receipt: MerchantRedemptionCheckoutReceipt,
): Promise<{ error: string | null; replayed?: boolean; result?: MerchantRedemptionCheckoutReceipt }> {
  try {
    const data = await call(client, "faolla_commit_redemption_v2", siteId, operatorId, { p_mutation: mutation, p_result: receipt }) as {
      replayed?: unknown; result?: unknown;
    } | null;
    if (!data || typeof data.replayed !== "boolean" || !isMerchantRedemptionCheckoutReceipt(data.result) ||
      data.result.operationId !== mutation.operation?.id || data.result.siteId !== siteId ||
      data.result.membershipId !== mutation.operation?.membershipId) fail(null);
    return { error: null, replayed: data.replayed, result: data.result };
  } catch (error) {
    return { error: error instanceof Error && SAFE_ERRORS.has(error.message) ? error.message : "merchant_transaction_unavailable" };
  }
}
