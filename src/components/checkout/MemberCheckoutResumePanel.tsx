"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SERVICE_IDENTITY_CHANGED } from "@/components/service-center/serviceCenterClient";
import { createCheckoutResumeController, checkoutResumeOriginalHref } from "@/lib/merchantCheckoutResumeClient";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { CartCheckoutSummary } from "./CartCheckoutSummary";
import { OnSiteCheckoutSummary } from "./OnSiteCheckoutSummary";
import { MerchantSettlementBadge } from "./MerchantSettlementBadge";
const copy = {
  zh: { title: "我的结算原单", note: "这里仅查看服务器已登记的原单，不重新提交、扣减、确认已核对，也不清空原表单或购物车。没有显示原单，不代表其他尚未确认的提交已经失败；请保留原结算页和编号，不要重复提交。", read: "重新读取原单", reading: "正在读取本人原单…", empty: "当前没有待核对的已登记原单。", failed: "暂时无法核对本人原单，请重新读取，不要重复提交。", changed: "账号状态已变化，请重新打开本页。", review: "原单需要人工核对，不能据此认定已付款或再次扣减。", detail: "查看原单详情与取消规则", single: "单项目结算原单" },
  en: { title: "My original checkout", note: "Read registered originals only. This does not submit, debit, acknowledge or clear a form/cart. No original shown does not prove another unconfirmed submission failed. Keep its page and reference; do not submit again.", read: "Read original again", reading: "Reading your original…", empty: "No registered original is awaiting review.", failed: "Your original could not be checked. Read it again; do not resubmit.", changed: "Your account changed. Reopen this page.", review: "The original needs manual review. Do not infer payment or debit again.", detail: "Original details & cancellation policy", single: "Single-item original" },
  es: { title: "Mi pago original", note: "Solo consulta originales registrados. No envía, descuenta, confirma revisión ni vacía formularios o carritos. Que no aparezca un original no demuestra que otro envío sin confirmar haya fallado. Conserva su página y referencia; no lo envíes de nuevo.", read: "Consultar original de nuevo", reading: "Consultando tu original…", empty: "No hay originales registrados pendientes de revisión.", failed: "No se pudo consultar tu original. Consulta de nuevo; no lo reenvíes.", changed: "Tu cuenta ha cambiado. Abre de nuevo esta página.", review: "El original requiere revisión manual. No deduzcas que está pagado ni vuelvas a descontar.", detail: "Detalles y política de cancelación", single: "Original de un artículo" },
};
const button = "inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-50";
const historyCopy = {
  zh: { note: "只读查阅原单；这里不下单、扣减、确认下一单、取消或退款。", policy: "原单取消规则", returnPoints: "按原单退实际扣除积分", keepPoints: "原单不退积分", returnCoupons: "按原单退券，不顺延有效期", keepCoupons: "原单不退券" },
  en: { note: "Read-only original. No order, debit, next-order acknowledgement, cancellation or refund is made here.", policy: "Original cancellation policy", returnPoints: "Return actual points under the original policy", keepPoints: "Original points are not returned", returnCoupons: "Return original coupons without extending expiry", keepCoupons: "Original coupons are not returned" },
  es: { note: "Original de solo lectura. Aquí no se pide, descuenta, confirma otro pedido, cancela ni reembolsa.", policy: "Política original de cancelación", returnPoints: "Devolver puntos descontados según la política original", keepPoints: "No se devuelven los puntos originales", returnCoupons: "Devolver cupones originales sin ampliar validez", keepCoupons: "No se devuelven los cupones originales" },
};
/** Viewing cannot acknowledge/release an original: only its original host can
 * preserve/consume the corresponding account-owned draft before release. */
export function MemberCheckoutResumePanel({ siteId, accountId, locale = "zh-CN", readOnly = false, controllerFactory = createCheckoutResumeController }: {
  siteId: string; accountId: string; locale?: string; readOnly?: boolean; controllerFactory?: typeof createCheckoutResumeController;
}) {
  const t = copy[merchantSettlementLanguage(locale)], controller = useMemo(() => controllerFactory({ siteId, accountId, ...(readOnly ? { readOnly: true } : {}) }), [siteId, accountId, readOnly, controllerFactory]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), [blocked, setBlocked] = useState(false);
  useEffect(() => {
    void controller.activate();
    const invalidate = () => { controller.deactivate(); setBlocked(true); };
    const storage = (e: StorageEvent) => { if (e.key === null || /auth|account|session/i.test(e.key)) invalidate(); };
    const visibility = () => { if (document.visibilityState === "hidden") invalidate(); };
    window.addEventListener(SERVICE_IDENTITY_CHANGED, invalidate); window.addEventListener("pagehide", invalidate); window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visibility);
    return () => { controller.deactivate(); window.removeEventListener(SERVICE_IDENTITY_CHANGED, invalidate); window.removeEventListener("pagehide", invalidate); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visibility); };
  }, [controller]);
  const pending = blocked ? null : state.snapshot?.pending, original = pending?.original, single = original?.kind === "single" ? original.original : null;
  const points = single?.method === "points" ? single.result : null;
  const history = historyCopy[merchantSettlementLanguage(locale)], policy = single?.result.cancellationPolicy;
  return <section data-checkout-resume className="mx-auto max-w-4xl space-y-5 p-4 text-slate-900 sm:p-7">
    <header><p translate="no" className="text-xs font-semibold tracking-widest text-teal-700">FAOLLA · ORIGINAL CHECKOUT</p><h1 className="mt-2 text-2xl font-bold">{t.title}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{t.note}</p></header>
    {readOnly && <p data-checkout-history-read className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">{history.note}</p>}
    {blocked ? <p role="alert">{t.changed}</p> : <>
      <button type="button" className={button} disabled={state.phase === "reading"} onClick={() => void controller.read()}>{t.read}</button>
      {(state.phase === "reading" || state.phase === "idle") && <p role="status">{t.reading}</p>}
      {state.phase === "error" && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">{t.failed}</p>}
      {state.phase === "ready" && !pending && <p role="status" className="rounded-xl border border-slate-200 bg-white p-4">{t.empty}</p>}
      {original && <article className="min-w-0 space-y-4 rounded-2xl border border-teal-100 bg-white p-5 shadow-sm">
        {pending?.reviewRequired ? <p role="alert" className="rounded-xl bg-amber-50 p-4">{t.review}</p> : original.kind === "cart" ? <CartCheckoutSummary result={original.result} locale={locale}/>
          : single?.method === "on_site" ? <OnSiteCheckoutSummary result={single.result} locale={locale}/> : points ? <>
            <h2 className="font-semibold">{t.single}</h2><p className="break-all text-sm">{points.resourceId}</p>
            <MerchantSettlementBadge locale={locale} showDetails snapshot={{ version: 1, method: "points", closed: points.closed, totalPoints: points.totalPoints, debitedPoints: points.totalPoints,
              returnedPoints: points.cancellation?.pointsReturned ?? 0, returnPending: false, ...(points.couponCount ? { coupons: { redeemedCount: points.couponCount, returnedCount: points.cancellation?.couponsReturned ?? 0, returnPending: false } } : {}) }}/>
          </> : null}
        {readOnly && !pending?.reviewRequired && policy && <details className="text-sm text-slate-600"><summary>{history.policy}</summary>
          <ul className="mt-2 list-inside list-disc space-y-1">{"returnPoints" in policy && <li>{policy.returnPoints ? history.returnPoints : history.keepPoints}</li>}<li>{policy.returnCoupons ? history.returnCoupons : history.keepCoupons}</li></ul></details>}
        {!readOnly && <a className={button} href={checkoutResumeOriginalHref(original, siteId, locale)}>{t.detail}</a>}
      </article>}
    </>}
  </section>;
}
