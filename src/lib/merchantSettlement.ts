/** A read-only projection of reconciled ledger totals. Not a payment command,
 * booking status, client-supplied receipt, or permission to change a balance. */
export type MerchantSettlementMethod = "online" | "points" | "on_site";
export type MerchantSettlementState =
  | "unpaid" | "processing" | "partially_paid" | "deposit_paid" | "paid"
  | "refund_pending" | "refund_failed" | "partially_refunded" | "refunded" | "disputed"
  | "points_due" | "points_redeemed" | "points_return_pending" | "points_partially_returned" | "points_returned"
  | "cancelled";

type Common = { version: 1; closed: boolean };
export type MerchantSettlementSnapshot = Common & ({
  method: "online" | "on_site";
  currency: "eur";
  totalMinor: number;
  initialDueMinor: number;
  capturedMinor: number;
  refundedMinor: number;
  refundPendingMinor: number;
  paymentPending: boolean;
  refundFailed: boolean;
  disputed: boolean;
} | {
  method: "points";
  totalPoints: number;
  debitedPoints: number;
  returnedPoints: number;
  returnPending: boolean;
});

export type MerchantSettlementSummary = {
  method: MerchantSettlementMethod;
  state: MerchantSettlementState;
  totalMinor: number | null;
  capturedMinor: number | null;
  refundedMinor: number | null;
  originalUnpaidMinor: number | null;
  collectibleMinor: number;
  totalPoints: number | null;
  debitedPoints: number | null;
  returnedPoints: number | null;
  canPayBalance: boolean;
};

const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function need(v: unknown): asserts v { if (!v) throw new Error("settlement_invalid_snapshot"); }

export function summarizeMerchantSettlement(s: MerchantSettlementSnapshot): MerchantSettlementSummary {
  need(s && s.version === 1 && typeof s.closed === "boolean");
  if (s.method === "points") {
    need([s.totalPoints, s.debitedPoints, s.returnedPoints].every(integer) && s.totalPoints > 0);
    need((s.debitedPoints === 0 || s.debitedPoints === s.totalPoints) && s.returnedPoints <= s.debitedPoints);
    need(typeof s.returnPending === "boolean" && (!s.returnPending || s.returnedPoints < s.debitedPoints));
    const state: MerchantSettlementState = s.returnPending ? "points_return_pending"
      : s.returnedPoints === s.totalPoints ? "points_returned"
      : s.returnedPoints > 0 ? "points_partially_returned"
      : s.debitedPoints === s.totalPoints ? "points_redeemed"
      : s.closed ? "cancelled" : "points_due";
    return { method: s.method, state, totalMinor: null, capturedMinor: null, refundedMinor: null,
      originalUnpaidMinor: null, collectibleMinor: 0, totalPoints: s.totalPoints,
      debitedPoints: s.debitedPoints, returnedPoints: s.returnedPoints, canPayBalance: false };
  }
  need((s.method === "online" || s.method === "on_site") && s.currency === "eur");
  need([s.totalMinor, s.initialDueMinor, s.capturedMinor, s.refundedMinor, s.refundPendingMinor].every(integer));
  need(s.totalMinor > 0 && s.initialDueMinor > 0 && s.initialDueMinor <= s.totalMinor && s.capturedMinor <= s.totalMinor);
  need(s.refundedMinor <= s.capturedMinor && s.refundPendingMinor <= s.capturedMinor - s.refundedMinor);
  need([s.paymentPending, s.refundFailed, s.disputed].every(v => typeof v === "boolean"));
  need(!s.refundFailed || s.capturedMinor > s.refundedMinor);
  const unpaid = s.totalMinor - s.capturedMinor;
  const blocked = s.closed || s.disputed || s.paymentPending || s.refundFailed || s.refundPendingMinor > 0 || s.refundedMinor > 0;
  const canPayBalance = s.method === "online" && s.capturedMinor >= s.initialDueMinor && unpaid > 0 && !blocked;
  const state: MerchantSettlementState = s.disputed ? "disputed" : s.refundPendingMinor > 0 ? "refund_pending"
    : s.refundFailed ? "refund_failed" : s.refundedMinor > 0 ? (s.refundedMinor === s.capturedMinor ? "refunded" : "partially_refunded")
    : s.capturedMinor === s.totalMinor ? "paid" : s.paymentPending ? "processing"
    : s.capturedMinor > 0 ? (s.capturedMinor < s.initialDueMinor ? "partially_paid" : "deposit_paid") : s.closed ? "cancelled" : "unpaid";
  return { method: s.method, state, totalMinor: s.totalMinor, capturedMinor: s.capturedMinor, refundedMinor: s.refundedMinor,
    originalUnpaidMinor: unpaid, collectibleMinor: s.method === "online" && !blocked
      ? s.capturedMinor === 0 ? s.initialDueMinor : canPayBalance ? unpaid : 0 : 0,
    totalPoints: null, debitedPoints: null, returnedPoints: null, canPayBalance };
}

const labels: Record<"zh" | "en" | "es", Record<MerchantSettlementState, string>> = {
  zh: { unpaid: "待支付", processing: "支付处理中", partially_paid: "付款待核对", deposit_paid: "已付定金", paid: "已结清", refund_pending: "退款中",
    refund_failed: "退款待处理", partially_refunded: "部分退款", refunded: "已退款", disputed: "付款有争议",
    points_due: "待积分兑换", points_redeemed: "积分已兑换", points_return_pending: "积分退回中",
    points_partially_returned: "积分部分退回", points_returned: "积分已退回", cancelled: "已关闭结算" },
  en: { unpaid: "Unpaid", processing: "Processing", partially_paid: "Payment needs review", deposit_paid: "Deposit paid", paid: "Paid", refund_pending: "Refund pending",
    refund_failed: "Refund needs attention", partially_refunded: "Partly refunded", refunded: "Refunded", disputed: "Disputed",
    points_due: "Points due", points_redeemed: "Points redeemed", points_return_pending: "Points return pending",
    points_partially_returned: "Points partly returned", points_returned: "Points returned", cancelled: "Checkout closed" },
  es: { unpaid: "Pendiente de pago", processing: "Pago en proceso", partially_paid: "Pago pendiente de revisión", deposit_paid: "Anticipo pagado", paid: "Pagado", refund_pending: "Reembolso en proceso",
    refund_failed: "Reembolso pendiente de revisión", partially_refunded: "Reembolso parcial", refunded: "Reembolsado", disputed: "Pago en disputa",
    points_due: "Canje pendiente", points_redeemed: "Puntos canjeados", points_return_pending: "Devolución de puntos en proceso",
    points_partially_returned: "Puntos devueltos parcialmente", points_returned: "Puntos devueltos", cancelled: "Pago cerrado" },
};

export function merchantSettlementLanguage(locale = "zh-CN"): "zh" | "en" | "es" {
  return locale.toLowerCase().startsWith("zh") ? "zh" : locale.toLowerCase().startsWith("es") ? "es" : "en";
}
export function merchantSettlementLabel(state: MerchantSettlementState, locale?: string) {
  return labels[merchantSettlementLanguage(locale)][state];
}

export function formatSettlementMoney(amountMinor: number, locale = "zh-CN") {
  need(integer(amountMinor));
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(amountMinor / 100);
}
