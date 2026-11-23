"use client";
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
export function SingleCheckoutOriginalReview({ siteId, original, reviewRequired, busy, locale, onRead, onAnother }: {
  siteId: string; original: CartClientOriginal; reviewRequired: boolean; busy: boolean; locale: string; onRead(): void; onAnother(): void;
}) {
  const t = copy[merchantSettlementLanguage(locale)], single = original.kind === "single" ? original.original : null;
  const button = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-50";
  return <article data-single-original-review className="min-w-0 space-y-4 rounded-3xl border border-teal-200 bg-white p-5">
    <h2 className="text-xl font-semibold">{t.title}</h2>
    {reviewRequired ? <p role="alert">{t.review}</p> : original.kind === "cart" ? <CartCheckoutSummary result={original.result} locale={locale}/>
      : single?.method === "on_site" ? <OnSiteCheckoutSummary result={single.result} locale={locale}/>
        : single?.method === "points" ? <><p className="break-all">{single.result.resourceId}</p><MerchantSettlementBadge locale={locale} showDetails snapshot={{ version: 1, method: "points", closed: single.result.closed, totalPoints: single.result.totalPoints,
          debitedPoints: single.result.totalPoints, returnedPoints: single.result.cancellation?.pointsReturned ?? 0, returnPending: false, ...(single.result.couponCount ? { coupons: { redeemedCount: single.result.couponCount, returnedCount: single.result.cancellation?.couponsReturned ?? 0, returnPending: false } } : {}) }}/></> : null}
    <p className="text-sm leading-6 text-slate-600">{original.kind === "cart" ? t.cart : t.single}</p>
    <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy} onClick={onRead}>{t.read}</button>
      <a className={button} href={checkoutResumeOriginalHref(original, siteId, locale)}>{t.detail}</a>
      {original.kind === "cart" ? <a className={button} href={`/site/${siteId}`}>{t.shop}</a> : <button type="button" className={button} disabled={busy || reviewRequired} onClick={onAnother}>{t.another}</button>}
    </div>
  </article>;
}
