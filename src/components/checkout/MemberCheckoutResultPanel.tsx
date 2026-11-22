"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { serviceRequest, ServiceRequestError } from "@/components/service-center/serviceCenterClient";
import { parseMemberCheckoutCancellation, parseMemberCheckoutResult, type MemberCheckoutResult } from "@/lib/merchantMemberCheckoutResult";
import { merchantSettlementLanguage, type MerchantSettlementSnapshot } from "@/lib/merchantSettlement";
import { MerchantSettlementBadge } from "./MerchantSettlementBadge";
const copy = {
  zh: { title: "预约与订单结算", reload: "重新读取", loading: "正在读取原单…", login: "请登录后查看本人原单。", loginButton: "用户登录", missing: "未找到本人原单，请核对登录账号和链接。",
    failed: "暂时无法读取原单，请重试。", unknown: "取消结果尚未确认。请重新读取原单；不要重复提交。", changed: "原单状态已变化，请重新读取后核对。", booking: "预约", order: "订单", cancelled: "已取消", active: "待确认", pending: "待确认", confirmed: "已确认", completed: "已完成", no_show: "未到店",
    business: "业务状态", policy: "下单时的取消规则", pointsReturn: "退回本单实际扣除的积分", pointsKeep: "取消后不退积分", couponsReturn: "退回原券，有效期不顺延", couponsKeep: "取消后不退券", deadline: "取消截止（本设备时区）", cancel: "取消本单", confirm: "确认取消本单", back: "保留本单", review: "取消将按上述原单规则处理。不会重复退积分或退券，已完成的服务不能自助取消。", working: "正在取消…", unavailable: "当前不能自助取消，请联系商户核对。", retained: "付款／兑换记录与预约或订单状态分别显示，取消不代表一定退还。" },
  en: { title: "Booking & order settlement", reload: "Reload", loading: "Reading original checkout…", login: "Sign in to view your own checkout.", loginButton: "Sign in", missing: "Checkout not found. Check your signed-in account and link.",
    failed: "Checkout could not be read. Please try again.", unknown: "Cancellation is unconfirmed. Reload the original checkout; do not submit again.", changed: "The checkout changed. Reload and review it.", booking: "Booking", order: "Order", cancelled: "Cancelled", active: "Pending", pending: "Pending", confirmed: "Confirmed", completed: "Completed", no_show: "No-show",
    business: "Booking / order status", policy: "Original cancellation policy", pointsReturn: "Return points actually debited", pointsKeep: "Points are not returned", couponsReturn: "Return original coupons without extending validity", couponsKeep: "Coupons are not returned", deadline: "Cancel by (device time zone)", cancel: "Cancel checkout", confirm: "Confirm cancellation", back: "Keep checkout", review: "The original policy above applies. Points and coupons are returned only once. Completed services cannot be cancelled here.", working: "Cancelling…", unavailable: "Self-service cancellation is unavailable. Contact the merchant.", retained: "Settlement and booking/order status are separate. Cancellation does not always mean a return." },
  es: { title: "Pago de reservas y pedidos", reload: "Volver a leer", loading: "Leyendo el pedido original…", login: "Inicia sesión para ver tu pedido.", loginButton: "Iniciar sesión", missing: "No se encontró el pedido. Revisa tu cuenta y el enlace.",
    failed: "No se pudo leer el pedido. Inténtalo de nuevo.", unknown: "La cancelación no está confirmada. Vuelve a leer el pedido; no lo envíes otra vez.", changed: "El pedido ha cambiado. Vuelve a leerlo y revisarlo.", booking: "Reserva", order: "Pedido", cancelled: "Cancelado", active: "Pendiente", pending: "Pendiente", confirmed: "Confirmado", completed: "Completado", no_show: "No presentado",
    business: "Estado de reserva / pedido", policy: "Política original de cancelación", pointsReturn: "Devolver los puntos realmente canjeados", pointsKeep: "No se devuelven los puntos", couponsReturn: "Devolver cupones originales sin ampliar su validez", couponsKeep: "No se devuelven los cupones", deadline: "Cancelar antes de (zona del dispositivo)", cancel: "Cancelar pedido", confirm: "Confirmar cancelación", back: "Conservar pedido", review: "Se aplica la política original indicada. Los puntos y cupones se devuelven una sola vez. No puedes cancelar servicios completados aquí.", working: "Cancelando…", unavailable: "No se puede cancelar aquí. Contacta con el comercio.", retained: "El pago y el estado de la reserva/pedido son distintos. Cancelar no siempre implica una devolución." },
};
export function MemberCheckoutResultPanel({ siteId, operationKey, identityKey, locale = "zh-CN", loginHref = "/login?accountType=personal", request = serviceRequest }: {
  siteId: string; operationKey: string; identityKey: string | null; locale?: string; loginHref?: string; request?: typeof serviceRequest;
}) {
  const text = copy[merchantSettlementLanguage(locale)], scope = JSON.stringify([siteId, operationKey, identityKey]);
  const [loaded, setLoaded] = useState<{ scope: string; value: MemberCheckoutResult } | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [review, setReview] = useState(false);
  const [message, setMessage] = useState<"failed" | "missing" | "login" | "unknown" | "changed" | "">(""), [mustRead, setMustRead] = useState(false);
  const version = useRef(0), readController = useRef<AbortController | null>(null), writing = useRef(false);
  const result = identityKey && loaded?.scope === scope ? loaded.value : null;
  const load = useCallback(async () => {
    if (!identityKey || writing.current) return;
    const run = ++version.current; readController.current?.abort(); const controller = new AbortController(); readController.current = controller;
    setLoading(true); setMessage(""); setReview(false);
    try {
      const response = await request<{ ok: boolean; result: unknown }>(`/api/member-checkout/result?siteId=${siteId}&operationKey=${operationKey}`, { signal: controller.signal });
      if (controller.signal.aborted || run !== version.current) return;
      if (!response.ok) throw new Error("unconfirmed");
      setLoaded({ scope, value: parseMemberCheckoutResult(response.result, { siteId, operationKey }) }); setMustRead(false);
    } catch (error) {
      if (controller.signal.aborted || run !== version.current) return;
      setMustRead(true); setReview(false);
      const definitive = error instanceof ServiceRequestError && [401, 403, 404].includes(error.status);
      if (definitive) setLoaded(null);
      setMessage(error instanceof ServiceRequestError && [401, 403].includes(error.status) ? "login" : error instanceof ServiceRequestError && error.status === 404 ? "missing" : "failed");
    } finally { if (run === version.current) setLoading(false); }
  }, [identityKey, operationKey, request, scope, siteId]);
  const invalidate = useCallback(() => { ++version.current; readController.current?.abort(); }, []);
  useEffect(() => {
    setLoaded(null); setMustRead(false); setReview(false); setMessage(""); writing.current = false; setBusy(false);
    void load(); return invalidate;
  }, [load, invalidate]);
  const cancel = async () => {
    if (!result?.cancellationAvailable || !result.resource || !review || mustRead || loading || writing.current) return;
    const run = version.current; writing.current = true; setBusy(true); setMessage("");
    try {
      const response = await request<{ ok: boolean; replayed: boolean; cancellation: unknown }>("/api/member-checkout/cancel", { method: "POST", body: JSON.stringify({ siteId, operationKey, expectedUpdatedAt: result.resource.updatedAt }) });
      if (run !== version.current) return;
      if (!response.ok || typeof response.replayed !== "boolean") throw new Error("unconfirmed");
      const returned = parseMemberCheckoutCancellation(response.cancellation);
      if (returned.pointsReturned > result.totalPoints || returned.couponsReturned > result.couponCount) throw new Error("unconfirmed");
      // A confirmed write is followed ONLY by a read. Unknown writes are never
      // retried, compensated, or replaced with a new operation key.
      setMustRead(true); setReview(false); writing.current = false; await load();
    } catch (error) {
      if (run !== version.current) return;
      setReview(false); setMustRead(true); setMessage(error instanceof ServiceRequestError && error.status === 409 ? "changed" : "unknown");
      if (error instanceof ServiceRequestError && [401, 403].includes(error.status)) setLoaded(null);
    } finally { if (run === version.current || !writing.current) { writing.current = false; setBusy(false); } }
  };
  const snapshot: MerchantSettlementSnapshot | null = result ? { version: 1, closed: result.closed, method: "points", totalPoints: result.totalPoints,
    debitedPoints: result.totalPoints, returnedPoints: result.cancellation?.pointsReturned ?? 0, returnPending: false,
    ...(result.couponCount ? { coupons: { redeemedCount: result.couponCount, returnedCount: result.cancellation?.couponsReturned ?? 0, returnPending: false } } : {}) } : null;
  const button = "min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50";
  return <section className="mx-auto w-full max-w-3xl space-y-4 p-4 text-slate-900 sm:p-7" aria-label={text.title}>
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-bold sm:text-2xl">{text.title}</h1>
      {identityKey && <button type="button" className={button} disabled={loading || busy} onClick={() => void load()}>{text.reload}</button>}</header>
    {!identityKey ? <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"><p>{text.login}</p><a className={button + " inline-flex items-center"} href={loginHref}>{text.loginButton}</a></div> : <>
      {loading && <p role="status" className="text-sm text-slate-600">{text.loading}</p>}
      {message && <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">{text[message]}</p>}
      {result && <><article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="break-all text-sm text-slate-600">{text[result.resourceKind]} · {result.resourceId}</p>
        <MerchantSettlementBadge snapshot={snapshot} locale={locale} showDetails/>
        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3 text-sm"><span>{text.business}</span>
          <strong>{result.resource ? text[result.resource.status as keyof typeof text] : text.unavailable}</strong></div>
        <p className="text-xs leading-5 text-slate-500">{text.retained}</p></article>
        {result.cancellationPolicy && <article className="space-y-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-5 text-sm"><h2 className="font-semibold">{text.policy}</h2>
          <p>{result.cancellationPolicy.returnPoints ? text.pointsReturn : text.pointsKeep}</p><p>{result.cancellationPolicy.returnCoupons ? text.couponsReturn : text.couponsKeep}</p>
          {result.cancellationPolicy.cancellableUntil && <p className="text-xs leading-5 text-slate-600">{text.deadline} · {new Date(result.cancellationPolicy.cancellableUntil).toLocaleString(locale)}</p>}</article>}
        {!result.closed && (result.cancellationAvailable ? <div className="space-y-3">
          {!review ? <button type="button" className={button + " !border-rose-200 !text-rose-700"} disabled={mustRead || loading || busy} onClick={() => setReview(true)}>{text.cancel}</button>
            : <div role="region" aria-label={text.confirm} className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6"><p>{text.review}</p><div className="flex flex-wrap gap-2">
              <button type="button" className={button + " !border-rose-700 !bg-rose-700 !text-white"} disabled={busy || mustRead} onClick={() => void cancel()}>{busy ? text.working : text.confirm}</button>
              <button type="button" className={button} disabled={busy} onClick={() => setReview(false)}>{text.back}</button></div></div>}
        </div> : <p className="text-sm text-slate-500">{text.unavailable}</p>)}
      </>}
    </>}
  </section>;
}
