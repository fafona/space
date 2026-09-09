import { createHash } from "node:crypto";
import type { MerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import type { MerchantCouponRecord } from "@/lib/merchantCoupons";
import type { MerchantOrderMembershipMutation, MerchantTransactionClient } from "@/lib/merchantOrderMembershipTransaction.server";

export type MerchantRedemptionOperation = { id: string; fingerprint: string; membershipId: string };
export type MerchantRedemptionMutation = {
  settings?: { expectedUpdatedAt: string | null; next: MerchantMembershipSettings };
  coupons?: { expectedUpdatedAt: string | null; next: MerchantCouponRecord[] };
  memberships?: MerchantOrderMembershipMutation["memberships"];
  operation?: MerchantRedemptionOperation;
};
export type MerchantRedemptionReceipt = {
  error: string | null;
  replayed?: boolean;
  versions?: { settings?: string | null; coupons?: string | null; memberships?: string | null };
  membershipId?: string;
};

const SAFE_ERRORS = new Set([
  "invalid_site_id", "merchant_membership_settings_conflict", "merchant_coupons_conflict",
  "merchant_memberships_conflict", "redemption_operation_conflict",
]);
function safeError(error: unknown) {
  const message = error instanceof Error ? error.message
    : error && typeof error === "object" && "message" in error ? String(error.message) : "";
  return SAFE_ERRORS.has(message) ? message : "merchant_transaction_unavailable";
}
function validSite(siteId: string) { return /^[A-Za-z0-9_-]{1,64}$/.test(siteId); }
function validStamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function requireMerchantRedemptionOperationId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw new Error("mutation_operation_id_required");
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(id)) throw new Error("mutation_operation_id_invalid");
  return id;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en")).map(([key, entry]) => [key, canonical(entry)]),
  );
  return value;
}

/** Hash server-normalized intent, not current price/stock/time or a client hash. */
export function buildMerchantRedemptionFingerprint(input: {
  siteId: string; membershipId: string; operatorId: string; items: unknown[]; note: string;
}) {
  const items = input.items.map((item) => JSON.stringify(canonical(item))).sort();
  return createHash("sha256").update(JSON.stringify({
    version: 1, siteId: input.siteId, membershipId: input.membershipId,
    operatorId: input.operatorId, items, note: input.note,
  })).digest("hex");
}

export async function lookupMerchantRedemptionOperation(
  client: MerchantTransactionClient, siteId: string, operation: MerchantRedemptionOperation,
): Promise<{ error: string | null; committed?: boolean; membershipId?: string }> {
  if (!validSite(siteId)) return { error: "invalid_site_id" };
  if (typeof client.rpc !== "function") return { error: "merchant_transaction_unavailable" };
  try {
    const result = await client.rpc("faolla_get_redemption_operation_v1", {
      p_site_id: siteId, p_operation_id: operation.id,
      p_fingerprint: operation.fingerprint, p_membership_id: operation.membershipId,
    });
    if (result.error) return { error: safeError(result.error) };
    const data = result.data as { committed?: unknown; membershipId?: unknown } | null;
    if (!data || typeof data.committed !== "boolean" ||
      (data.committed && data.membershipId !== operation.membershipId)) return { error: "merchant_transaction_unavailable" };
    return { error: null, committed: data.committed, ...(data.committed ? { membershipId: operation.membershipId } : {}) };
  } catch (error) { return { error: safeError(error) }; }
}

export async function commitMerchantRedemptionTransaction(
  client: MerchantTransactionClient, siteId: string, mutation: MerchantRedemptionMutation,
): Promise<MerchantRedemptionReceipt> {
  if (!validSite(siteId)) return { error: "invalid_site_id" };
  if (typeof client.rpc !== "function") return { error: "merchant_transaction_unavailable" };
  try {
    const result = await client.rpc("faolla_commit_redemption_v1", { p_site_id: siteId, p_mutation: mutation });
    if (result.error) return { error: safeError(result.error) };
    const data = result.data as { updatedAt?: unknown; replayed?: unknown; versions?: unknown; membershipId?: unknown } | null;
    if (!data || !validStamp(data.updatedAt) || typeof data.replayed !== "boolean" ||
      !data.versions || typeof data.versions !== "object" || Array.isArray(data.versions) ||
      (data.replayed && !mutation.operation) ||
      (mutation.operation && data.membershipId !== mutation.operation.membershipId)) return { error: "merchant_transaction_unavailable" };
    const versions = data.versions as NonNullable<MerchantRedemptionReceipt["versions"]>;
    if (Object.values(versions).some((value) => value !== null && !validStamp(value))) return { error: "merchant_transaction_unavailable" };
    if (!data.replayed && ((mutation.settings && !("settings" in versions)) ||
      (mutation.coupons && !("coupons" in versions)) || (mutation.memberships && !("memberships" in versions)))) {
      return { error: "merchant_transaction_unavailable" };
    }
    return { error: null, replayed: data.replayed, versions,
      ...(typeof data.membershipId === "string" ? { membershipId: data.membershipId } : {}) };
  } catch (error) {
    // A missing response may follow a successful COMMIT. Never compensate or
    // generate a replacement operation ID here; retry the same bound intent.
    return { error: safeError(error) };
  }
}
