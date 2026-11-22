"use client";

import { formatSettlementMoney, merchantSettlementLanguage } from "@/lib/merchantSettlement";
import type { CheckoutCouponChoice, CheckoutCouponClaim, CheckoutCouponReason } from "@/lib/merchantCheckoutCoupons";

const copy = {
  zh: { title: "会员优惠券", none: "暂没有可用于此项目的券", selected: "已选", clear: "不使用优惠券", points: "积分", cash: "优惠",
    voucher: "含兑换项目", use: "按券规则一次核销；不自动兑换现金或结转余值。", until: "有效期至", unavailable: "不可用",
    reasons: { inactive: "券已暂停", not_started: "尚未生效", expired: "已过期", used: "已使用", scenario: "不支持当前使用场景",
      target: "不适用于当前项目", minimum: "未达到使用门槛", wrong_units: "请选择对应的结算方式", invalid: "券资料待核对" } },
  en: { title: "Member coupons", none: "No coupons for this item", selected: "Selected", clear: "Use no coupon", points: "points", cash: "Discount",
    voucher: "Items covered", use: "Each claim is redeemed once under its terms. No automatic cash conversion or carried balance.", until: "Valid until", unavailable: "Unavailable",
    reasons: { inactive: "Coupon paused", not_started: "Not active yet", expired: "Expired", used: "Used", scenario: "Not valid in this context",
      target: "Not valid for this item", minimum: "Minimum not met", wrong_units: "Choose the matching payment method", invalid: "Coupon needs review" } },
  es: { title: "Cupones de socio", none: "No hay cupones para este artículo", selected: "Seleccionado", clear: "No usar cupón", points: "puntos", cash: "Descuento",
    voucher: "Artículos cubiertos", use: "Cada cupón se canjea una vez según sus condiciones. Sin conversión a efectivo ni saldo restante automático.", until: "Válido hasta", unavailable: "No disponible",
    reasons: { inactive: "Cupón pausado", not_started: "Aún no válido", expired: "Caducado", used: "Usado", scenario: "No válido en este contexto",
      target: "No válido para este artículo", minimum: "No cumple el mínimo", wrong_units: "Elige la forma de pago correspondiente", invalid: "Cupón pendiente de revisión" } },
};
const key = (claim: CheckoutCouponClaim) => JSON.stringify([claim.couponId, claim.claimEventId]);

/** Choices are server-issued display DTOs, not raw coupon/claim histories.
 * Parent requests a new trusted quote after a choice; this UI never redeems. */
export function MerchantCheckoutCouponPicker({ choices, selected, locale = "zh-CN", busy = false, onChange }: {
  choices: CheckoutCouponChoice[]; selected: CheckoutCouponClaim[]; locale?: string; busy?: boolean;
  onChange: (claims: CheckoutCouponClaim[]) => void;
}) {
  const text = copy[merchantSettlementLanguage(locale)], keys = new Set(selected.map(key));
  return <section aria-label={text.title} className="mt-5 min-w-0 rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-900">{text.title}</h3>
      {selected.length > 0 && <button type="button" disabled={busy} onClick={() => onChange([])} className="min-h-10 rounded-xl px-2 text-xs font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50">{text.clear}</button>}
    </div>
    {choices.length === 0 ? <p className="mt-3 text-xs leading-5 text-slate-500">{text.none}</p>
      : <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto overscroll-contain">
        {choices.map(choice => {
          const checked = keys.has(key(choice));
          const claim = { couponId: choice.couponId, claimEventId: choice.claimEventId };
          return <label key={key(choice)} className={`flex min-w-0 items-start gap-3 rounded-xl border bg-white p-3 ${checked ? "border-violet-500 ring-1 ring-violet-500" : "border-slate-200"} ${choice.available && !busy ? "cursor-pointer" : "opacity-60"}`}>
            <input type="checkbox" aria-label={choice.title} checked={checked} disabled={busy || !choice.available}
              className="mt-1 h-4 w-4 shrink-0 accent-violet-700" onChange={() => {
                if (busy || !choice.available) return;
                if (checked) return onChange(selected.filter(row => key(row) !== key(choice)));
                const keep = choice.kind === "points_voucher" ? selected.filter(row => choices.find(c => key(c) === key(row))?.kind === "points_voucher") : [];
                onChange([...keep, claim]);
              }} />
            <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium text-slate-900">{choice.title}</span>
              {choice.available ? <span className="mt-1 block text-xs leading-5 text-violet-800">
                {choice.pointsDiscount > 0 ? `−${choice.pointsDiscount} ${text.points}` : `${text.cash} ${formatSettlementMoney(choice.cashDiscountMinor, locale)}`}
                {choice.coveredQuantity > 0 ? ` · ${text.voucher} ${choice.coveredQuantity}` : ""}
              </span> : <span className="mt-1 block text-xs leading-5 text-slate-600">{choice.reason ? text.reasons[choice.reason as CheckoutCouponReason] : text.unavailable}</span>}
              {choice.validUntil && <span className="block text-xs leading-5 text-slate-500">{text.until} {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(choice.validUntil))}</span>}
            </span>
          </label>;
        })}
      </div>}
    <p className="mt-3 text-xs leading-5 text-slate-500">{text.use}</p>
  </section>;
}
