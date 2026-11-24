"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createCheckoutHistoryRecoveryController } from "@/lib/merchantCheckoutHistoryRecoveryClient";
import { checkoutClientStorageKey } from "@/lib/merchantCheckoutClient";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { SERVICE_IDENTITY_CHANGED } from "@/components/service-center/serviceCenterClient";
import { CartCheckoutSummary } from "./CartCheckoutSummary";
import { OnSiteCheckoutSummary } from "./OnSiteCheckoutSummary";
import { MerchantSettlementBadge } from "./MerchantSettlementBadge";
import { OriginalServiceLink } from "./OriginalServiceLink";
const copy = {
  zh: { title: "本设备保留的原单", note: "只核对本账号在此设备保留的原编号，不是下方最新待核对原单的替代。不清号、不清车、不重新提交。", read: "核对本设备原编号", reading: "正在核对原编号…", unknown: "原结果尚未确认，原编号已保留。不要重复提交或扣减，可稍后再次核对。", failed: "暂时无法核对或原编号已变化。不会据此判定未付款；请保留原结算页与购物车。", changed: "账号或本设备原编号已变化，请重新打开本页。", review: "已找到原单，但原记录需人工核对。不要重复提交或扣减。", policy: "原取消规则", returnPoints: "按原单退实际扣除积分", keepPoints: "原单不退积分", returnCoupons: "按原单退券，不顺延有效期", keepCoupons: "原单不退券" },
  en: { title: "Original kept on this device", note: "Check only this account’s retained reference. It does not replace the latest pending original below. No reference/cart is cleared and nothing is resubmitted.", read: "Check this device’s reference", reading: "Checking the retained reference…", unknown: "The outcome is unconfirmed; the reference is kept. Do not submit or debit again. Check again later.", failed: "The reference could not be checked or has changed. This does not mean unpaid. Keep the original page and cart.", changed: "Account or device reference changed. Reopen this page.", review: "Original found, but the record needs manual review. Do not submit or debit again.", policy: "Original cancellation policy", returnPoints: "Return actual original points", keepPoints: "No original points return", returnCoupons: "Return original coupons without extending expiry", keepCoupons: "No original coupon return" },
  es: { title: "Original guardado en este dispositivo", note: "Consulta solo la referencia guardada de esta cuenta. No sustituye al último original pendiente de abajo. No borra referencias ni carritos, ni reenvía pedidos.", read: "Consultar referencia del dispositivo", reading: "Consultando la referencia guardada…", unknown: "El resultado sigue sin confirmar; se conserva la referencia. No reenvíes ni vuelvas a descontar. Consulta más tarde.", failed: "No se pudo consultar o cambió la referencia. No significa que esté sin pagar. Conserva la página original y el carrito.", changed: "Cambió la cuenta o la referencia. Abre de nuevo esta página.", review: "Original encontrado, pero requiere revisión manual. No reenvíes ni vuelvas a descontar.", policy: "Política original de cancelación", returnPoints: "Devolver los puntos originales descontados", keepPoints: "No devolver puntos originales", returnCoupons: "Devolver cupones originales sin ampliar validez", keepCoupons: "No devolver cupones originales" },
};

/** Mounted only by the independently history-gated page after account checks. */
export function MemberCheckoutLocalRecovery({ siteId, accountId, locale = "zh-CN", originalServiceEnabled = false, controllerFactory = createCheckoutHistoryRecoveryController }: {
  siteId: string; accountId: string; locale?: string; originalServiceEnabled?: boolean; controllerFactory?: typeof createCheckoutHistoryRecoveryController;
}) {
  const controller = useMemo(() => controllerFactory({ siteId, accountId }), [siteId, accountId, controllerFactory]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), [blocked, setBlocked] = useState(false), t = copy[merchantSettlementLanguage(locale)];
  useEffect(() => {
    void controller.activate(); const stop = () => { controller.deactivate(); setBlocked(true); };
    const storage = (e: StorageEvent) => { if (e.key === null || e.key === checkoutClientStorageKey(siteId, accountId) || /auth|account|session/i.test(e.key)) stop(); };
    const visibility = () => { if (document.visibilityState === "hidden") stop(); };
    window.addEventListener(SERVICE_IDENTITY_CHANGED, stop); window.addEventListener("pagehide", stop); window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visibility);
    return () => { controller.deactivate(); window.removeEventListener(SERVICE_IDENTITY_CHANGED, stop); window.removeEventListener("pagehide", stop); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visibility); };
  }, [controller, siteId, accountId]);
  if (!blocked && (state.phase === "idle" || state.phase === "empty")) return null;
  const recovery = blocked ? null : state.recovery, original = recovery?.original, single = original?.kind === "single" ? original.original : null, points = single?.method === "points" ? single.result : null, policy = single?.result.cancellationPolicy;
  return <section data-checkout-local-recovery className="min-w-0 space-y-3 rounded-2xl border border-sky-200 bg-white p-5 text-sm">
    <h2 className="font-semibold">{t.title}</h2><p className="leading-6 text-slate-600">{t.note}</p>
    {blocked ? <p role="alert">{t.changed}</p> : <>
      <button type="button" className="min-h-11 rounded-xl border border-slate-200 px-4 py-3 font-semibold disabled:opacity-50" disabled={state.phase === "reading"} onClick={() => void controller.recover()}>{t.read}</button>
      {state.phase === "reading" && <p role="status">{t.reading}</p>}
      {state.phase === "unconfirmed" && <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">{t.unknown}</p>}
      {state.phase === "error" && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">{t.failed}</p>}
      {recovery?.reviewRequired ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-900">{t.review}</p>
        : original?.kind === "cart" ? <CartCheckoutSummary result={original.result} locale={locale}/> : single?.method === "on_site" ? <OnSiteCheckoutSummary result={single.result} locale={locale}/>
          : points ? <div className="space-y-3"><p className="break-all">{points.resourceId}</p><MerchantSettlementBadge locale={locale} showDetails snapshot={{ version: 1, method: "points", closed: points.closed, totalPoints: points.totalPoints, debitedPoints: points.totalPoints,
            returnedPoints: points.cancellation?.pointsReturned ?? 0, returnPending: false, ...(points.couponCount ? { coupons: { redeemedCount: points.couponCount, returnedCount: points.cancellation?.couponsReturned ?? 0, returnPending: false } } : {}) }}/></div> : null}
      {original && !recovery?.reviewRequired && policy && <details className="text-slate-600"><summary>{t.policy}</summary><ul className="mt-2 list-inside list-disc space-y-1">
        {"returnPoints" in policy && <li>{policy.returnPoints ? t.returnPoints : t.keepPoints}</li>}<li>{policy.returnCoupons ? t.returnCoupons : t.keepCoupons}</li></ul></details>}
      {original && recovery && <OriginalServiceLink enabled={originalServiceEnabled} siteId={siteId} operationKey={recovery.operationKey} locale={locale}/>}
    </>}
  </section>;
}
