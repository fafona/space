"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkoutClientRequest, CheckoutClientError, type CheckoutClientRequest } from "@/lib/merchantCheckoutClient";
import { parseOnSiteCheckoutResult, parseOnSiteCancellation, type OnSiteCheckoutResult } from "@/lib/merchantCheckoutOnSiteResult";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { OnSiteCheckoutSummary } from "./OnSiteCheckoutSummary";
const copy = {
  zh: { heading: "到店付款原单", reload: "重新读取原单", loading: "正在读取…", login: "请登录查看本人原单。", loginButton: "用户登录", failed: "暂时无法核对，请重新读取；不要重复提交或据此认定未付款。", missing: "未找到本人原单，请检查账号和链接。", unknown: "取消结果未确认，请重新读取原单；不要重复取消。", business: "业务状态", active: "待确认", pending: "待确认", confirmed: "已确认", completed: "已完成", no_show: "未到店", cancelled: "已取消", policy: "原单取消规则", return: "按原单政策退回原券，有效期不顺延。", keep: "取消后不退券。", deadline: "自助取消截止（本设备时区）", unavailable: "当前不能自助取消，请联系商户核对。", cancel: "取消本单", confirm: "确认取消本单", back: "保留本单", review: "将取消原预约或订单，并按原单规则处理原券和库存。没有登记收款时不会生成现金退款；已经登记收款需另行处理。", working: "正在取消…" },
  en: { heading: "Original pay-at-venue checkout", reload: "Reload original", loading: "Reading…", login: "Sign in to view your own checkout.", loginButton: "Sign in", failed: "Could not verify. Reload; do not submit again or infer that it is unpaid.", missing: "Original checkout not found. Check your account and link.", unknown: "Cancellation is unconfirmed. Reload the original; do not cancel again.", business: "Booking / order status", active: "Pending", pending: "Pending", confirmed: "Confirmed", completed: "Completed", no_show: "No-show", cancelled: "Cancelled", policy: "Original cancellation policy", return: "Return original coupons under the policy, without extending validity.", keep: "Coupons are not returned.", deadline: "Cancel by (device time zone)", unavailable: "Self-service cancellation is unavailable. Contact the merchant.", cancel: "Cancel checkout", confirm: "Confirm cancellation", back: "Keep checkout", review: "Cancel the original booking/order and apply its coupon and stock policy. No cash refund is created where no receipt was recorded; recorded payments require separate handling.", working: "Cancelling…" },
  es: { heading: "Pedido original · Pago en el local", reload: "Volver a leer el original", loading: "Leyendo…", login: "Inicia sesión para ver tu pedido.", loginButton: "Iniciar sesión", failed: "No se pudo verificar. Vuelve a leer; no repitas el envío ni lo consideres impagado.", missing: "No se encontró el original. Revisa tu cuenta y el enlace.", unknown: "La cancelación no está confirmada. Vuelve a leer el original; no la repitas.", business: "Estado de reserva / pedido", active: "Pendiente", pending: "Pendiente", confirmed: "Confirmado", completed: "Completado", no_show: "No presentado", cancelled: "Cancelado", policy: "Política original de cancelación", return: "Se devuelven los cupones originales según la política, sin ampliar su validez.", keep: "No se devuelven los cupones.", deadline: "Cancelar antes de (zona del dispositivo)", unavailable: "No se puede cancelar aquí. Contacta con el comercio.", cancel: "Cancelar pedido", confirm: "Confirmar cancelación", back: "Conservar pedido", review: "Se cancela la reserva/pedido original según su política de cupones e inventario. No se genera un reembolso si no se registró un cobro; los cobros registrados requieren otro trámite.", working: "Cancelando…" },
};
export function MemberOnSiteResultPanel({ siteId, operationKey, identityKey, locale = "zh-CN", loginHref = "/login", request = checkoutClientRequest }: {
  siteId: string; operationKey: string; identityKey: string | null; locale?: string; loginHref?: string; request?: CheckoutClientRequest;
}) {
  const t = copy[merchantSettlementLanguage(locale)], scope = JSON.stringify([siteId, operationKey, identityKey]);
  const [loaded, setLoaded] = useState<{ scope: string; result: OnSiteCheckoutResult } | null>(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [review, setReview] = useState(false);
  const [message, setMessage] = useState<"failed" | "missing" | "unknown" | "">(""), [mustRead, setMustRead] = useState(false);
  const epoch = useRef(0), abort = useRef<AbortController | null>(null), writing = useRef(false), result = identityKey && loaded?.scope === scope ? loaded.result : null;
  const load = useCallback(async () => {
    if (!identityKey || writing.current) return; const run = ++epoch.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setLoading(true); setMessage(""); setReview(false);
    try {
      const raw = await request("/api/member-checkout/on-site/result", { siteId, operationKey }, controller.signal);
      if (controller.signal.aborted || run !== epoch.current) return;
      if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true || !("result" in raw)) throw new Error("invalid");
      setLoaded({ scope, result: parseOnSiteCheckoutResult(raw.result, { siteId, operationKey }) }); setMustRead(false);
    } catch (error) { if (!controller.signal.aborted && run === epoch.current) { setLoaded(null); setMustRead(true); setMessage(error instanceof CheckoutClientError && error.status === 404 ? "missing" : "failed"); } }
    finally { if (run === epoch.current) setLoading(false); }
  }, [identityKey, operationKey, request, scope, siteId]);
  const invalidate = useCallback(() => { ++epoch.current; abort.current?.abort(); }, []);
  useEffect(() => { setLoaded(null); setMustRead(false); setReview(false); setMessage(""); writing.current = false; setBusy(false); void load();
    return invalidate; }, [load, invalidate]);
  const cancel = async () => {
    if (!result?.cancellationAvailable || !result.resource || !review || mustRead || loading || writing.current) return;
    const run = epoch.current, original = result; writing.current = true; setBusy(true); setMessage("");
    try {
      const raw = await request("/api/member-checkout/on-site/cancel", { siteId, operationKey, expectedUpdatedAt: original.resource!.updatedAt }, AbortSignal.timeout(15_000));
      if (run !== epoch.current) return;
      if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true || !("replayed" in raw) || typeof raw.replayed !== "boolean" || !("cancellation" in raw)) throw new Error("invalid");
      const receipt = parseOnSiteCancellation(raw.cancellation, { siteId, operationKey });
      if (receipt.resourceId !== original.terms.resourceId || receipt.resourceKind !== original.terms.resourceKind || receipt.couponsReturned !== (original.cancellationPolicy.returnCoupons ? original.terms.couponCount : 0)) throw new Error("invalid");
      setMustRead(true); setReview(false); writing.current = false; await load();
    } catch { if (run === epoch.current) { setLoaded(null); setMustRead(true); setReview(false); setMessage("unknown"); } }
    finally { if (run === epoch.current || !writing.current) { writing.current = false; setBusy(false); } }
  };
  const button = "min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50";
  return <section aria-label={t.heading} className="mx-auto max-w-3xl space-y-4 p-4 text-slate-900 sm:p-7">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">{t.heading}</h1>{identityKey && <button className={button} disabled={loading || busy} onClick={() => void load()}>{t.reload}</button>}</header>
    {!identityKey ? <><p>{t.login}</p><a href={loginHref} className={button + " inline-block"}>{t.loginButton}</a></> : <>
      {loading && <p role="status">{t.loading}</p>}{message && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-6">{t[message]}</p>}
      {result && <><article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><p className="break-all text-sm text-slate-600">{result.terms.resourceId}</p><OnSiteCheckoutSummary result={result} locale={locale}/>
        <p className="border-t border-slate-100 pt-3 text-sm">{t.business} · {result.resource ? t[result.resource.status as "active" | "pending" | "confirmed" | "completed" | "no_show" | "cancelled"] : t.unavailable}</p></article>
        <article className="space-y-2 rounded-2xl border border-violet-100 bg-violet-50/50 p-5 text-sm"><h2 className="font-semibold">{t.policy}</h2><p>{result.cancellationPolicy.returnCoupons ? t.return : t.keep}</p>
          {result.cancellationPolicy.cancellableUntil && <p>{t.deadline} · {new Date(result.cancellationPolicy.cancellableUntil).toLocaleString(locale)}</p>}</article>
        {!result.closed && (result.cancellationAvailable ? <div className="space-y-3">{!review ? <button className={button + " !text-rose-700"} disabled={mustRead || loading || busy} onClick={() => setReview(true)}>{t.cancel}</button>
          : <div role="region" aria-label={t.confirm} className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6"><p>{t.review}</p><div className="flex flex-wrap gap-2"><button className={button + " !bg-rose-700 !text-white"} disabled={mustRead || busy} onClick={() => void cancel()}>{busy ? t.working : t.confirm}</button><button className={button} disabled={busy} onClick={() => setReview(false)}>{t.back}</button></div></div>}</div> : <p className="text-sm text-slate-600">{t.unavailable}</p>)}
      </>}
    </>}
  </section>;
}
