import { formatSettlementMoney, merchantSettlementLabel, merchantSettlementLanguage, summarizeMerchantSettlement,
  type MerchantSettlementSnapshot } from "@/lib/merchantSettlement";

export function MerchantSettlementBadge({ snapshot, locale = "zh-CN", showDetails = false }: {
  snapshot: MerchantSettlementSnapshot | null; locale?: string; showDetails?: boolean;
}) {
  const language = merchantSettlementLanguage(locale);
  let summary: ReturnType<typeof summarizeMerchantSettlement>;
  try { if (!snapshot) throw new Error("missing"); summary = summarizeMerchantSettlement(snapshot); }
  catch {
    return <span role="status" className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
      {language === "zh" ? "结算状态待核对" : language === "es" ? "Pago pendiente de revisión" : "Payment status needs review"}
    </span>;
  }
  const green = ["paid", "points_redeemed"].includes(summary.state);
  const red = ["disputed", "refund_failed", "partially_paid"].includes(summary.state);
  const amber = ["unpaid", "points_due", "deposit_paid"].includes(summary.state);
  const style = green ? "border-emerald-200 bg-emerald-50 text-emerald-800" : red ? "border-rose-200 bg-rose-50 text-rose-800"
    : amber ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900";
  const method = language === "zh" ? { online: "在线支付", points: "积分", on_site: "到店付款" }
    : language === "es" ? { online: "Pago online", points: "Puntos", on_site: "Pago en el local" }
      : { online: "Online", points: "Points", on_site: "Pay on arrival" };
  const detail = summary.method === "points"
    ? language === "zh" ? `扣除 ${summary.debitedPoints} 积分 · 已退 ${summary.returnedPoints} 积分`
      : language === "es" ? `${summary.debitedPoints} puntos canjeados · ${summary.returnedPoints} devueltos`
        : `${summary.debitedPoints} points redeemed · ${summary.returnedPoints} returned`
    : language === "zh" ? `总价 ${formatSettlementMoney(summary.totalMinor!, locale)} · 已收 ${formatSettlementMoney(summary.capturedMinor!, locale)} · 已退 ${formatSettlementMoney(summary.refundedMinor!, locale)}`
      : language === "es" ? `Total ${formatSettlementMoney(summary.totalMinor!, locale)} · Cobrado ${formatSettlementMoney(summary.capturedMinor!, locale)} · Devuelto ${formatSettlementMoney(summary.refundedMinor!, locale)}`
        : `Total ${formatSettlementMoney(summary.totalMinor!, locale)} · Received ${formatSettlementMoney(summary.capturedMinor!, locale)} · Refunded ${formatSettlementMoney(summary.refundedMinor!, locale)}`;
  return <span className="inline-flex max-w-full flex-col items-start gap-1" data-settlement-state={summary.state}>
    <span role="status" className={`inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${style}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {method[summary.method]} · {merchantSettlementLabel(summary.state, locale)}
    </span>
    {showDetails && <span className="text-xs leading-5 text-slate-600">{detail}</span>}
  </span>;
}
