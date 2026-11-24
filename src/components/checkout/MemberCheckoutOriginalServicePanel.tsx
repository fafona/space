"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createOriginalServiceController } from "@/lib/merchantCheckoutOriginalServiceClient";
import { originalServiceClosed, type OriginalServiceReview } from "@/lib/merchantCheckoutOriginalService";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { SERVICE_IDENTITY_CHANGED } from "@/components/service-center/serviceCenterClient";
import { CartCheckoutSummary } from "./CartCheckoutSummary";
import { OnSiteCheckoutSummary } from "./OnSiteCheckoutSummary";
import { MerchantSettlementBadge } from "./MerchantSettlementBadge";
const copy = {
  zh: { title: "原单售后", note: "这里只处理已生成的本人原单，不新下单、不收款，也不确认下一单或清空购物车。取消按原单规则退积分和原券，不延长券有效期；已收款的单据需另行处理退款。", read: "重新读取原单", working: "正在核对原单…", failed: "暂时无法核对，请重新读取原单。", unknown: "取消结果尚未确认，可能已送达。请先重新读取原单，不要重复取消或扣减。", review: "原单需要人工核对，暂不能自助取消。", agree: "我已核对原单及原取消规则，确认取消整笔原单", cancel: "按原规则取消原单", done: "原单已取消", unavailable: "此原单暂不支持自助取消。请联系商户核对；这里不会自动退款。", changed: "账号已变化，请重新打开原单。", policy: "原取消规则", returnPoints: "退回原单实际扣除的积分", keepPoints: "原单取消不退积分", returnCoupons: "退回原券一次，有效期不延长", keepCoupons: "原单取消不退券", advance: "预约取消最少提前（分钟）" },
  en: { title: "Original order support", note: "Manage your existing original only. No new order, charge, next-order acknowledgement or cart clearing. Cancellation follows the original points/coupon policy without extending expiry. Collected payments need a separate refund process.", read: "Read original again", working: "Checking original…", failed: "Could not check. Read the original again.", unknown: "Cancellation is unconfirmed and may have arrived. Read the original before trying again. Do not debit again.", review: "The original needs manual review; self-service cancellation is unavailable.", agree: "I reviewed the original and its policy; cancel the whole original", cancel: "Cancel under original policy", done: "Original cancelled", unavailable: "Self-service cancellation is unavailable. Contact the merchant; no automatic cash refund is made here.", changed: "Your account changed. Reopen the original.", policy: "Original cancellation policy", returnPoints: "Return points actually debited", keepPoints: "No points return", returnCoupons: "Return original coupons once; no expiry extension", keepCoupons: "No coupon return", advance: "Booking cancellation notice (minutes)" },
  es: { title: "Atención del pedido original", note: "Solo gestiona tu original existente. No crea pedidos, cobra, confirma otro pedido ni vacía carritos. La cancelación sigue la política original de puntos y cupones, sin ampliar su validez. Los cobros requieren otro proceso de reembolso.", read: "Consultar original de nuevo", working: "Consultando original…", failed: "No se pudo consultar. Consulta el original de nuevo.", unknown: "La cancelación no está confirmada y puede haber llegado. Consulta el original antes de reintentarlo. No vuelvas a descontar.", review: "El original requiere revisión manual; no se puede cancelar aquí.", agree: "He revisado el original y su política; cancelar el original completo", cancel: "Cancelar según política original", done: "Original cancelado", unavailable: "No se puede cancelar aquí. Contacta con el comercio; no se reembolsa efectivo automáticamente.", changed: "Tu cuenta cambió. Abre de nuevo el original.", policy: "Política original de cancelación", returnPoints: "Devolver puntos realmente descontados", keepPoints: "No devolver puntos", returnCoupons: "Devolver cupones una vez, sin ampliar validez", keepCoupons: "No devolver cupones", advance: "Antelación para cancelar reserva (minutos)" },
};
export function MemberCheckoutOriginalServicePanel({ siteId, operationKey, accountId, locale, controllerFactory = createOriginalServiceController }: {
  siteId: string; operationKey: string; accountId: string; locale: string; controllerFactory?: typeof createOriginalServiceController;
}) {
  const controller = useMemo(() => controllerFactory({ siteId, operationKey, accountId }), [siteId, operationKey, accountId, controllerFactory]);
  const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), t = copy[merchantSettlementLanguage(locale)];
  const [agreed, setAgreed] = useState<OriginalServiceReview | null>(null), [blocked, setBlocked] = useState(false);
  useEffect(() => { void controller.activate(); const stop = () => { controller.deactivate(); setBlocked(true); };
    const storage = (e: StorageEvent) => { if (e.key === null || /auth|account|session/i.test(e.key)) stop(); };
    const visibility = () => { if (document.visibilityState === "hidden") stop(); };
    window.addEventListener(SERVICE_IDENTITY_CHANGED, stop); window.addEventListener("pagehide", stop); window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visibility);
    return () => { controller.deactivate(); window.removeEventListener(SERVICE_IDENTITY_CHANGED, stop); window.removeEventListener("pagehide", stop); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visibility); };
  }, [controller]);
  const r = blocked ? null : s.review, o = r?.original, single = o?.kind === "single" ? o.original : null, points = single?.method === "points" ? single.result : null;
  const result = o?.kind === "cart" ? o.result : single?.result, policy = single?.result.cancellationPolicy, busy = s.phase === "reading" || s.phase === "cancelling";
  const button = "min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-50";
  return <section data-original-service className="mx-auto max-w-4xl space-y-5 p-4 text-slate-900 sm:p-7">
    <header><p translate="no" className="text-xs font-semibold tracking-widest text-teal-700">FAOLLA · ORIGINAL SUPPORT</p><h1 className="mt-2 text-2xl font-bold">{t.title}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{t.note}</p></header>
    {blocked ? <p role="alert">{t.changed}</p> : <>
      <button type="button" className={button} disabled={busy} onClick={() => { setAgreed(null); void controller.read(); }}>{t.read}</button>
      {busy && <p role="status">{t.working}</p>}{s.phase === "error" && <p role="alert">{t.failed}</p>}
      {s.phase === "unconfirmed" && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-6">{t.unknown}</p>}
      {o && <article className="space-y-4 rounded-2xl border border-teal-100 bg-white p-5">
        {o.kind === "cart" ? <CartCheckoutSummary result={o.result} locale={locale}/> : single?.method === "on_site" ? <OnSiteCheckoutSummary result={single.result} locale={locale}/> : points ? <><p className="break-all text-sm">{points.resourceId}</p><MerchantSettlementBadge locale={locale} showDetails snapshot={{ version: 1, method: "points", closed: points.closed, totalPoints: points.totalPoints, debitedPoints: points.totalPoints, returnedPoints: points.cancellation?.pointsReturned ?? 0, returnPending: false, ...(points.couponCount ? { coupons: { redeemedCount: points.couponCount, returnedCount: points.cancellation?.couponsReturned ?? 0, returnPending: false } } : {}) }}/></> : null}
        {policy && <div className="space-y-1 text-sm leading-6"><h2 className="font-semibold">{t.policy}</h2>{"returnPoints" in policy && <p>{policy.returnPoints ? t.returnPoints : t.keepPoints}</p>}<p>{policy.returnCoupons ? t.returnCoupons : t.keepCoupons}</p><p>{t.advance}: {policy.advanceMinutes}</p></div>}
        {originalServiceClosed(o) ? <p role="status" className="font-semibold text-teal-800">{t.done}</p> : r?.reviewRequired ? <p role="alert">{t.review}</p> : result?.cancellationAvailable ? <>
          <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-teal-700" disabled={busy || s.phase !== "ready"} checked={agreed === r} onChange={e => setAgreed(e.target.checked ? r : null)}/><span>{t.agree}</span></label>
          <button type="button" className={button + " w-full !border-rose-700 !bg-rose-700 !text-white"} disabled={busy || s.phase !== "ready" || agreed !== r} onClick={() => { setAgreed(null); void controller.cancel(true); }}>{t.cancel}</button>
        </> : <p className="text-sm leading-6 text-slate-600">{t.unavailable}</p>}
      </article>}
    </>}
  </section>;
}
