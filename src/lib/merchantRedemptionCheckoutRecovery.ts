import { isMerchantRedemptionCheckoutReceipt, type MerchantRedemptionCheckoutReceipt, type MerchantRedemptionCheckoutSummary } from "@/lib/merchantRedemptionCheckout";
import type { MerchantRedemptionReceiptData } from "@/lib/merchantReceiptPrint";
import { isMerchantRedemptionPendingCart, isMerchantRedemptionPendingMember } from "@/lib/merchantRedemptionPendingCart";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const data = record(value);
  return data ? `{${Object.keys(data).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(data[key])}`).join(",")}}` : JSON.stringify(value);
}

/** Only server-confirmed amounts enter recovery, notifications or printing. */
export function readCashierCheckoutReceipt(value: unknown, siteId: string, operationId?: string): MerchantRedemptionCheckoutReceipt {
  if (!isMerchantRedemptionCheckoutReceipt(value) || value.siteId !== siteId ||
    !/^[A-Za-z0-9_.:-]{1,120}$/.test(value.operationId) || (operationId && value.operationId !== operationId)) {
    throw new Error("redemption_checkout_response_invalid");
  }
  return structuredClone(value);
}

export function readCashierCheckoutSummary(payload: unknown, siteId: string): MerchantRedemptionCheckoutSummary | null {
  const envelope = record(payload);
  if (envelope?.ok !== true || !("checkout" in envelope)) throw new Error("redemption_checkout_response_invalid");
  if (envelope.checkout === null) return null;
  const data = record(envelope.checkout);
  if (!data || typeof data.operationId !== "string" || !/^[A-Za-z0-9_.:-]{1,120}$/.test(data.operationId) ||
    !["pending", "committed", "cancelled"].includes(String(data.status)) || !validDate(data.createdAt) ||
    (data.acknowledgedAt !== null && !validDate(data.acknowledgedAt)) ||
    (data.status === "pending" && data.acknowledgedAt !== null)) throw new Error("redemption_checkout_response_invalid");
  const result = data.status === "committed"
    ? readCashierCheckoutReceipt(data.result, siteId, data.operationId)
    : null;
  if (data.status !== "committed" && data.result !== null) throw new Error("redemption_checkout_response_invalid");
  let pendingCart: MerchantRedemptionCheckoutSummary["pendingCart"];
  if (data.pendingCart !== undefined) {
    if (data.status !== "pending" || !isMerchantRedemptionPendingCart(data.pendingCart, siteId, data.operationId)) {
      throw new Error("redemption_checkout_response_invalid");
    }
    pendingCart = structuredClone(data.pendingCart);
  }
  let pendingMember: MerchantRedemptionCheckoutSummary["pendingMember"];
  if (data.pendingMember !== undefined) {
    if (data.status !== "pending" || (data.pendingMember !== null && !isMerchantRedemptionPendingMember(data.pendingMember))) {
      throw new Error("redemption_checkout_response_invalid");
    }
    pendingMember = structuredClone(data.pendingMember);
  }
  return { operationId: data.operationId, status: data.status as MerchantRedemptionCheckoutSummary["status"],
    createdAt: data.createdAt, acknowledgedAt: data.acknowledgedAt as string | null, result,
    ...(pendingCart ? { pendingCart } : {}),
    ...(pendingMember === undefined ? {} : { pendingMember }),
  };
}

export function cashierCheckoutBlocksNewSale(phase: "checking" | "ready" | "error", checkout: MerchantRedemptionCheckoutSummary | null) {
  return phase !== "ready" || Boolean(checkout && !checkout.acknowledgedAt);
}

/** Acknowledgement closes only an already terminal operation. Never infer it
 * from a missing checkout, a pending response or a different operation. */
export function readCashierCheckoutAcknowledgement(
  payload: unknown,
  siteId: string,
  original: MerchantRedemptionCheckoutSummary,
) {
  const checkout = readCashierCheckoutSummary(payload, siteId);
  if (original.status === "pending" || !checkout || !checkout.acknowledgedAt ||
    checkout.operationId !== original.operationId || checkout.status !== original.status ||
    canonicalJson(checkout.result) !== canonicalJson(original.result)) {
    throw new Error("redemption_checkout_response_invalid");
  }
  return checkout;
}

/** A claim represents one voucher, even when that voucher contains several products. */
export function cashierCheckoutRequestQuantity(row: { quantity: number; couponClaimId?: string }) {
  return row.couponClaimId?.trim() ? 1 : row.quantity;
}

export function cashierCouponQuantityLabel(includedQuantity: number) {
  return includedQuantity > 1 ? `1 张券（含 ${includedQuantity} 件）` : "1 张券";
}

/** Reconcile only the failed mutation's alert after its own terminal result is verified. */
export function cashierCheckoutErrorAfterRecovery(
  currentError: string,
  checkout: MerchantRedemptionCheckoutSummary | null,
  failedMutation: { operationId: string; message: string } | null,
) {
  return checkout && checkout.status !== "pending" && checkout.operationId === failedMutation?.operationId &&
    currentError === failedMutation.message ? "" : currentError;
}

export function cashierCheckoutPrintReceipt(
  receipt: MerchantRedemptionCheckoutReceipt,
  context: { siteName: string; memberName: string; memberNo: string },
): MerchantRedemptionReceiptData {
  return {
    receiptNo: receipt.operationId.slice(-12).toUpperCase(), siteId: receipt.siteId, siteName: context.siteName,
    memberName: context.memberName, memberNo: context.memberNo, beforePointBalance: receipt.beforePointBalance,
    afterPointBalance: receipt.afterPointBalance, totalQuantity: receipt.totalQuantity, grossPoints: receipt.grossPoints,
    couponPointDiscountTotal: receipt.couponPointDiscountTotal, totalPoints: receipt.totalPoints,
    note: receipt.note, createdAt: new Date(receipt.createdAt), lines: structuredClone(receipt.lines),
  };
}

/** In-memory epoch only; never serializes identity, token, cart or receipt. */
export function createCashierCheckoutRequestGuard() {
  let scope: object | null = null;
  let epoch = 0;
  let sequence = 0;
  return {
    setScope(next: object) { if (scope !== next) { scope = next; epoch += 1; sequence += 1; } },
    begin() { return { epoch, sequence: ++sequence }; },
    isCurrent(ticket: { epoch: number; sequence: number }) { return ticket.epoch === epoch && ticket.sequence === sequence; },
    invalidate() { epoch += 1; sequence += 1; },
  };
}
