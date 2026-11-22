"use client";

import { formatSettlementMoney, merchantSettlementLanguage, type MerchantSettlementMethod } from "@/lib/merchantSettlement";
import type { CheckoutMethodUnavailable, MerchantCheckoutQuoteView } from "@/lib/merchantCheckoutQuote.server";

const copy = {
  zh: { heading: "选择结算方式", online: "在线支付", points: "积分兑换", on_site: "到店付款", now: "本次支付", remaining: "尾款", due: "到店支付",
    balance: "可用积分", after: "兑换后剩余", unit: "积分", pay: "前往支付", redeem: "确认积分兑换", booking: "提交预约", order: "提交订单",
    disabled: "结算暂未开放", working: "处理中…", note: "预约是否确认以预约详情为准，付款不代表服务已完成。",
    reasons: { login_required: "登录后可查看会员积分", membership_required: "仅限本店有效会员", insufficient_points: "积分不足",
      module_unavailable: "商户尚未开通此功能", merchant_payments_unavailable: "商户暂未开通在线收款", commission_not_configured: "在线收款设置待完成", amount_below_minimum: "定金低于支付渠道最低金额" } },
  en: { heading: "Choose how to pay", online: "Pay online", points: "Redeem points", on_site: "Pay on arrival", now: "Pay now", remaining: "Balance", due: "Due on arrival",
    balance: "Available points", after: "Points remaining", unit: "points", pay: "Continue to payment", redeem: "Confirm redemption", booking: "Submit booking", order: "Place order",
    disabled: "Checkout not available yet", working: "Processing…", note: "Check your booking details for confirmation. Payment does not mean the service is completed.",
    reasons: { login_required: "Sign in to view your points", membership_required: "Active membership at this merchant required", insufficient_points: "Not enough points",
      module_unavailable: "Feature not enabled by this merchant", merchant_payments_unavailable: "Online payments unavailable", commission_not_configured: "Payment setup incomplete", amount_below_minimum: "Deposit below the payment minimum" } },
  es: { heading: "Elige cómo pagar", online: "Pagar online", points: "Canjear puntos", on_site: "Pagar en el local", now: "Paga ahora", remaining: "Pendiente", due: "A pagar en el local",
    balance: "Puntos disponibles", after: "Puntos restantes", unit: "puntos", pay: "Continuar al pago", redeem: "Confirmar canje", booking: "Enviar reserva", order: "Realizar pedido",
    disabled: "Pago aún no disponible", working: "Procesando…", note: "Consulta la confirmación en los detalles de la reserva. El pago no significa que el servicio haya finalizado.",
    reasons: { login_required: "Inicia sesión para ver tus puntos", membership_required: "Se requiere ser socio activo de este comercio", insufficient_points: "Puntos insuficientes",
      module_unavailable: "Función no activada por el comercio", merchant_payments_unavailable: "Pago online no disponible", commission_not_configured: "Configuración de pagos pendiente", amount_below_minimum: "Anticipo inferior al mínimo de pago" } },
};

/** Controlled presentation only. The controller must retain a stable operation
 * nonce and submit through the authenticated atomic API. A missing callback is
 * deliberately disabled: mounting a preview can never initiate payment. */
export function MerchantCheckoutPaymentOptions({ quote, locale = "zh-CN", selected, busy = false, onSelect, onConfirm }: {
  quote: MerchantCheckoutQuoteView; locale?: string; selected: MerchantSettlementMethod | null; busy?: boolean;
  onSelect: (method: MerchantSettlementMethod) => void; onConfirm?: (method: MerchantSettlementMethod) => void;
}) {
  const text = copy[merchantSettlementLanguage(locale)], chosen = quote.options.find(row => row.method === selected);
  const confirm = selected === "points" ? text.redeem : selected === "on_site" ? quote.resourceKind === "booking" ? text.booking : text.order : text.pay;
  return <section aria-label={text.heading} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="text-lg font-semibold text-slate-900">{text.heading}</h2>
        <p className="mt-1 break-words text-sm text-slate-600">{quote.title} × {quote.quantity}</p></div>
      {quote.cashTotalMinor !== null && <span className="text-lg font-semibold text-slate-900">{formatSettlementMoney(quote.cashTotalMinor, locale)}</span>}
    </div>
    <fieldset disabled={busy} className="m-0 grid min-w-0 gap-3 border-0 p-0">
      <legend className="sr-only">{text.heading}</legend>
      {quote.options.map(option => {
        const active = selected === option.method, enabled = option.available && !busy;
        const theme = option.method === "points" ? "border-amber-200 bg-amber-50/60" : option.method === "online" ? "border-sky-200 bg-sky-50/60" : "border-slate-200 bg-slate-50";
        return <label key={option.method} className={`flex min-h-24 min-w-0 items-start gap-3 rounded-2xl border p-4 ${theme} ${active ? "ring-2 ring-teal-600 ring-offset-1" : ""} ${enabled ? "cursor-pointer" : "opacity-60"}`}>
          <input type="radio" name={`checkout-method-${quote.offerId}`} aria-label={text[option.method]} value={option.method}
            checked={active} disabled={!enabled} className="mt-1 h-4 w-4 shrink-0 accent-teal-700"
            onChange={() => { if (enabled) onSelect(option.method); }} />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">{text[option.method]}</span>
            <span className="mt-1 block text-sm leading-6 text-slate-700">
              {option.method === "points" ? `${option.totalPoints} ${text.unit}` : option.method === "on_site"
                ? `${text.due} ${formatSettlementMoney(option.remainingMinor!, locale)}`
                : option.payNowMinor === null ? "—" : `${text.now} ${formatSettlementMoney(option.payNowMinor, locale)} · ${text.remaining} ${formatSettlementMoney(option.remainingMinor!, locale)}`}
            </span>
            {option.method === "points" && quote.ownPointBalance !== null && <span className="block text-xs leading-5 text-slate-600">
              {text.balance} {quote.ownPointBalance}{quote.ownPointBalance >= option.totalPoints! ? ` · ${text.after} ${quote.ownPointBalance - option.totalPoints!}` : ""}
            </span>}
            {option.reason && <span className="mt-1 block text-xs leading-5 text-slate-600">{text.reasons[option.reason as CheckoutMethodUnavailable]}</span>}
          </span>
        </label>;
      })}
    </fieldset>
    {quote.resourceKind === "booking" && <p className="mt-4 text-xs leading-5 text-slate-500">{text.note}</p>}
    <button type="button" disabled={busy || !onConfirm || !chosen?.available} className="mt-5 min-h-12 w-full rounded-2xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
      onClick={() => { if (!busy && onConfirm && chosen?.available) onConfirm(chosen.method); }}>
      {busy ? text.working : !onConfirm ? text.disabled : confirm}
    </button>
  </section>;
}
