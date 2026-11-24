"use client";
import { useState } from "react";
import type { CartClientOriginal } from "@/lib/merchantCheckoutCartReview";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { checkoutResumeOriginalHref } from "@/lib/merchantCheckoutResumeClient";
import { CartCheckoutSummary } from "./CartCheckoutSummary";
import { OnSiteCheckoutSummary } from "./OnSiteCheckoutSummary";
import { MerchantSettlementBadge } from "./MerchantSettlementBadge";
const copy = {
  zh: { title: "请先核对原单", review: "原单需要人工核对。请勿重复提交或再次扣减。", cart: "这是整车原单，请返回原购物车核对。单品页不会释放其编号或改变购物车、会员和备注。", single: "这里只确认您已核对这笔单品原单，不取消、不退款，也不改变原商户表单或购物车。", read: "重新核对原单", detail: "原单详情与取消规则", another: "已核对，开始另一单", shop: "返回商户购物车" },
  en: { title: "Review the original first", review: "This original needs manual review. Do not resubmit or debit again.", cart: "This is a whole-cart original. Return to its cart to review it. This page cannot release its reference or change the cart, member or note.", single: "This only acknowledges your review of a single-item original. It does not cancel, refund or change the merchant form/cart.", read: "Check original again", detail: "Original details & cancellation policy", another: "Reviewed — start another", shop: "Back to merchant cart" },
  es: { title: "Revisa primero el original", review: "El original requiere revisión manual. No lo reenvíes ni vuelvas a descontar.", cart: "Este original corresponde a un carrito completo. Vuelve a su carrito para revisarlo. Esta página no libera su referencia ni cambia el carrito, socio o nota.", single: "Solo confirma que has revisado este original de un artículo. No cancela, reembolsa ni cambia el formulario o carrito del comercio.", read: "Consultar original de nuevo", detail: "Original y política de cancelación", another: "Revisado — empezar otro", shop: "Volver al carrito del comercio" },
};
const registrationCopy = {
  zh: { note: "这份原单尚未登记到恢复流程。登记只保留已有结果，不重新扣积分、收款、取消或清空原表单、购物车。", agreed: "我已核对原单，保留原表单和购物车，登记恢复记录", action: "核对并登记原单", policy: "原取消规则", returnPoints: "按原单退积分", keepPoints: "不退积分", returnCoupons: "退原券，原有效期不变", keepCoupons: "不退券" },
  en: { note: "This original is not registered for recovery. Registration keeps the existing result; it does not charge, redeem again, cancel or clear the original form/cart.", agreed: "I reviewed the original; keep the original form/cart and register recovery", action: "Register reviewed original", policy: "Original cancellation policy", returnPoints: "Return original points", keepPoints: "No points return", returnCoupons: "Return original coupons without extending validity", keepCoupons: "No coupon return" },
  es: { note: "Este original no está registrado para su recuperación. Registrarlo conserva el resultado; no cobra, no vuelve a canjear, no cancela ni vacía el formulario/carrito original.", agreed: "He revisado el original; conservar el formulario/carrito y registrar la recuperación", action: "Registrar original revisado", policy: "Regla de cancelación original", returnPoints: "Devolver puntos originales", keepPoints: "No devolver puntos", returnCoupons: "Devolver cupones originales sin ampliar su validez", keepCoupons: "No devolver cupones" },
};
export function SingleCheckoutOriginalReview({ siteId, original, reviewRequired, busy, locale, onRead, onAnother, registrationRequired = false, onRegister }: {
  siteId: string; original: CartClientOriginal; reviewRequired: boolean; busy: boolean; locale: string; onRead(): void; onAnother(): void;
  registrationRequired?: boolean; onRegister?(): void;
}) {
  const t = copy[merchantSettlementLanguage(locale)], rt = registrationCopy[merchantSettlementLanguage(locale)], single = original.kind === "single" ? original.original : null;
  // Consent belongs to the exact displayed object, not a later read-back.
  // Derive it without an effect/cascading render when the original changes.
  const [agreedOriginal, setAgreedOriginal] = useState<CartClientOriginal | null>(null);
  const agreed = agreedOriginal === original && registrationRequired && !busy;
  const policy = single?.result.cancellationPolicy;
  const button = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-50";
  return <article data-single-original-review className="min-w-0 space-y-4 rounded-3xl border border-teal-200 bg-white p-5">
    <h2 className="text-xl font-semibold">{t.title}</h2>
    {reviewRequired ? <p role="alert">{t.review}</p> : original.kind === "cart" ? <CartCheckoutSummary result={original.result} locale={locale}/>
      : single?.method === "on_site" ? <OnSiteCheckoutSummary result={single.result} locale={locale}/>
        : single?.method === "points" ? <><p className="break-all">{single.result.resourceId}</p><MerchantSettlementBadge locale={locale} showDetails snapshot={{ version: 1, method: "points", closed: single.result.closed, totalPoints: single.result.totalPoints,
          debitedPoints: single.result.totalPoints, returnedPoints: single.result.cancellation?.pointsReturned ?? 0, returnPending: false, ...(single.result.couponCount ? { coupons: { redeemedCount: single.result.couponCount, returnedCount: single.result.cancellation?.couponsReturned ?? 0, returnPending: false } } : {}) }}/></> : null}
    <p className="text-sm leading-6 text-slate-600">{original.kind === "cart" ? t.cart : registrationRequired ? rt.note : t.single}</p>
    {single && registrationRequired && !reviewRequired && policy && <p className="text-xs leading-5 text-slate-600">{rt.policy}: {"returnPoints" in policy ? `${policy.returnPoints ? rt.returnPoints : rt.keepPoints} · ` : ""}{policy.returnCoupons ? rt.returnCoupons : rt.keepCoupons}</p>}
    {single && registrationRequired && !reviewRequired && onRegister && <div data-single-retained-registration className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-teal-700" checked={agreed} disabled={busy} onChange={e => setAgreedOriginal(e.target.checked ? original : null)}/><span>{rt.agreed}</span></label>
      <button type="button" className={button} disabled={busy || !agreed} onClick={() => { setAgreedOriginal(null); onRegister(); }}>{rt.action}</button>
    </div>}
    <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy} onClick={() => { setAgreedOriginal(null); onRead(); }}>{t.read}</button>
      <a className={button} href={checkoutResumeOriginalHref(original, siteId, locale)}>{t.detail}</a>
      {original.kind === "cart" ? <a className={button} href={`/site/${siteId}`}>{t.shop}</a> : !registrationRequired && <button type="button" className={button} disabled={busy || reviewRequired} onClick={onAnother}>{t.another}</button>}
    </div>
  </article>;
}
