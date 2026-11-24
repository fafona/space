"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SERVICE_IDENTITY_CHANGED } from "@/components/service-center/serviceCenterClient";
import { createCheckoutHistoryInventoryController } from "@/lib/merchantCheckoutHistoryInventoryClient";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { CartCheckoutSummary } from "./CartCheckoutSummary";
import { OnSiteCheckoutSummary } from "./OnSiteCheckoutSummary";
import { MerchantSettlementBadge } from "./MerchantSettlementBadge";
const copy = {
  zh: { title: "找不到原编号？查阅本人历史原单", note: "仅查阅尚未登记到恢复流程的本人原单，每页最多 10 笔，按固定编号排序，不代表交易先后。这里不登记、不确认下一单、不重复扣减，也不清空原表单或购物车。", read: "查阅／重读首页", next: "下一页", working: "正在查阅本人原单…", empty: "本页没有可查阅的未登记原单；这不代表其他未知提交已失败，请保留原页和编号。", failed: "暂时无法查阅，请重新读取，不能据此重复提交。", changed: "账号已变化，请重新打开原单页。", manual: "原单需要人工核对，不代表已付款或可再次扣减。", detail: "只读查看详情与取消规则", single: "单项目原单" },
  en: { title: "Lost the reference? View your historical originals", note: "Read your originals not yet registered for recovery. Up to 10 per page in fixed reference order, not transaction order. No registration, next-order acknowledgement, debit or form/cart clearing is made here.", read: "Read / reload first page", next: "Next page", working: "Reading your originals…", empty: "No unregistered originals on this page. This does not prove another unknown submission failed. Keep its page and reference.", failed: "Could not read originals. Read again; do not resubmit.", changed: "Your account changed. Reopen the original page.", manual: "Needs manual review. Do not infer payment or debit again.", detail: "Read-only details & cancellation policy", single: "Single-item original" },
  es: { title: "¿Sin referencia? Consulta tus originales históricos", note: "Solo originales tuyos aún no registrados para recuperación. Hasta 10 por página, en orden fijo de referencia, no cronológico. No registra, confirma otro pedido, descuenta ni vacía formularios o carritos.", read: "Consultar / recargar primera página", next: "Página siguiente", working: "Consultando tus originales…", empty: "No hay originales sin registrar en esta página. Esto no demuestra que otro envío sin confirmar haya fallado. Conserva su página y referencia.", failed: "No se pudieron consultar. Consulta de nuevo; no reenvíes.", changed: "Tu cuenta cambió. Abre de nuevo la página del original.", manual: "Requiere revisión manual. No deduzcas pago ni vuelvas a descontar.", detail: "Detalles y política de cancelación de solo lectura", single: "Original de un artículo" },
};
const button = "inline-flex min-h-11 max-w-full items-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold disabled:opacity-50";
const policies = {
  zh: { title: "原单取消规则", returnPoints: "按原单退实际扣除积分", keepPoints: "不退积分", returnCoupons: "退原券，不延长有效期", keepCoupons: "不退券" },
  en: { title: "Original cancellation policy", returnPoints: "Return original points debited", keepPoints: "No points return", returnCoupons: "Return original coupons; no expiry extension", keepCoupons: "No coupon return" },
  es: { title: "Política original de cancelación", returnPoints: "Devolver puntos descontados", keepPoints: "No devolver puntos", returnCoupons: "Devolver cupones sin ampliar validez", keepCoupons: "No devolver cupones" },
};
export function MemberCheckoutHistoryInventory({ siteId, accountId, locale = "zh-CN", controllerFactory = createCheckoutHistoryInventoryController }: {
  siteId: string; accountId: string; locale?: string; controllerFactory?: typeof createCheckoutHistoryInventoryController;
}) {
  const controller = useMemo(() => controllerFactory({ siteId, accountId }), [siteId, accountId, controllerFactory]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), [blocked, setBlocked] = useState(false);
  const t = copy[merchantSettlementLanguage(locale)], p = policies[merchantSettlementLanguage(locale)];
  useEffect(() => {
    controller.activate();
    const invalidate = () => { controller.deactivate(); setBlocked(true); };
    const storage = (event: StorageEvent) => { if (event.key === null || /auth|account|session/i.test(event.key)) invalidate(); };
    const visibility = () => { if (document.visibilityState === "hidden") invalidate(); };
    window.addEventListener(SERVICE_IDENTITY_CHANGED, invalidate); window.addEventListener("storage", storage); window.addEventListener("pagehide", invalidate); document.addEventListener("visibilitychange", visibility);
    return () => { controller.deactivate(); window.removeEventListener(SERVICE_IDENTITY_CHANGED, invalidate); window.removeEventListener("storage", storage); window.removeEventListener("pagehide", invalidate); document.removeEventListener("visibilitychange", visibility); };
  }, [controller]);
  return <section data-checkout-history-inventory className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
    <h2 className="text-lg font-semibold">{t.title}</h2><p className="text-sm leading-6 text-slate-600">{t.note}</p>
    {blocked ? <p role="alert">{t.changed}</p> : <>
      <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={state.phase === "reading"} onClick={() => void controller.read()}>{t.read}</button>
        {state.inventory?.nextCursor && <button type="button" className={button} onClick={() => void controller.next()}>{t.next}</button>}</div>
      {state.phase === "reading" && <p role="status">{t.working}</p>}
      {state.phase === "error" && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm">{t.failed}</p>}
      {state.phase === "ready" && !state.inventory?.items.length && <p role="status" className="text-sm leading-6">{t.empty}</p>}
      {state.inventory?.items.map(item => {
        const original = item.original, single = original.kind === "single" ? original.original : null, points = single?.method === "points" ? single.result : null;
        const resourceId = original.kind === "cart" ? original.result.resourceId : original.original.method === "on_site" ? original.original.result.terms.resourceId : original.original.result.resourceId, policy = single?.result.cancellationPolicy;
        return <article key={item.operationKey} data-history-original className="min-w-0 space-y-3 rounded-2xl border border-teal-100 bg-white p-4">
          <p className="break-all text-sm">{resourceId}</p>
          {item.reviewRequired ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm">{t.manual}</p> : original.kind === "cart" ? <CartCheckoutSummary result={original.result} locale={locale}/>
            : single?.method === "on_site" ? <OnSiteCheckoutSummary result={single.result} locale={locale}/> : points ? <>
              <h3 className="font-semibold">{t.single}</h3>
              <MerchantSettlementBadge locale={locale} showDetails snapshot={{ version: 1, method: "points", closed: points.closed, totalPoints: points.totalPoints, debitedPoints: points.totalPoints,
                returnedPoints: points.cancellation?.pointsReturned ?? 0, returnPending: false, ...(points.couponCount ? { coupons: { redeemedCount: points.couponCount, returnedCount: points.cancellation?.couponsReturned ?? 0, returnPending: false } } : {}) }}/>
            </> : null}
          {!item.reviewRequired && policy && <details className="text-sm leading-6"><summary>{p.title}</summary><ul className="mt-2 list-inside list-disc">
            {"returnPoints" in policy && <li>{policy.returnPoints ? p.returnPoints : p.keepPoints}</li>}<li>{policy.returnCoupons ? p.returnCoupons : p.keepCoupons}</li>
          </ul></details>}
        </article>;
      })}
    </>}
  </section>;
}
