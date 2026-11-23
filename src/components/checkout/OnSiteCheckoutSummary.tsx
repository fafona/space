"use client";
import type { OnSiteCheckoutResult } from "@/lib/merchantCheckoutOnSiteResult";
import { formatSettlementMoney, merchantSettlementLanguage } from "@/lib/merchantSettlement";
const copy = {
  zh: { method: "到店付款", unpaid: "待到店付款", covered: "已使用优惠券兑换", collected: "商户登记已收款", closed: "原单已关闭", review: "原单需人工核对", gross: "原价", discount: "优惠券抵扣", due: "原单应收", received: "商户登记收款", returned: "已退原券", coupons: "张", note: "预约／订单状态与收款分开；登记收款不是银行或线上支付凭证。" },
  en: { method: "Pay at venue", unpaid: "Pay at venue — unpaid", covered: "Redeemed with coupon", collected: "Cash receipt recorded by merchant", closed: "Original checkout closed", review: "Original checkout needs review", gross: "Original price", discount: "Coupon discount", due: "Original amount due", received: "Merchant-recorded receipt", returned: "Original coupons returned", coupons: "", note: "Booking/order status is separate. A merchant receipt record is not a bank or online-payment confirmation." },
  es: { method: "Pago en el local", unpaid: "Pendiente de pago en el local", covered: "Canjeado con cupón", collected: "Cobro registrado por el comercio", closed: "Pedido original cerrado", review: "Revisar el pedido original", gross: "Precio original", discount: "Descuento del cupón", due: "Importe original a pagar", received: "Cobro registrado", returned: "Cupones originales devueltos", coupons: "", note: "La reserva/pedido y el cobro son distintos. El registro del comercio no acredita un pago bancario o en línea." },
};
export function OnSiteCheckoutSummary({ result, locale = "zh-CN" }: { result: OnSiteCheckoutResult; locale?: string }) {
  const t = copy[merchantSettlementLanguage(locale)], terms = result.terms;
  const state = !result.termsMatch || !result.resource || result.closed !== (result.resource.status === "cancelled") ? "review"
    : result.closed ? "closed" : result.collection ? "collected" : terms.dueMinor === 0 ? "covered" : "unpaid";
  return <div className="space-y-3" data-on-site-summary>
    <p className="text-xs font-semibold text-slate-500">{t.method}</p><p className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${state === "unpaid" || state === "review" ? "bg-amber-100 text-amber-900" : state === "closed" ? "bg-slate-100 text-slate-700" : "bg-teal-100 text-teal-900"}`}>{t[state]}</p>
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[[t.gross, terms.grossMinor], [t.discount, terms.discountMinor], [t.due, terms.dueMinor], [t.received, result.collection?.amountMinor ?? 0]].map(([label, amount]) =>
      <div className="min-w-0 rounded-xl bg-slate-50 p-3" key={String(label)}><dt className="text-xs text-slate-600">{label}</dt><dd className="mt-1 break-words text-lg font-semibold">{formatSettlementMoney(Number(amount), locale)}</dd></div>)}</dl>
    {!!result.cancellation?.couponsReturned && <p className="text-xs text-slate-600">{t.returned} · {result.cancellation.couponsReturned} {t.coupons}</p>}
    <p className="text-xs leading-5 text-slate-500">{t.note}</p>
  </div>;
}
