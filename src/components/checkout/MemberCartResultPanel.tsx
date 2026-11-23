"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkoutClientRequest, type CheckoutClientRequest } from "@/lib/merchantCheckoutClient";
import { parseCartClientOriginal } from "@/lib/merchantCheckoutCartReview";
import { parseCartCheckoutResult, type CartCheckoutResult } from "@/lib/merchantCheckoutCartResult";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { SERVICE_IDENTITY_CHANGED } from "@/components/service-center/serviceCenterClient";
import { CartCheckoutSummary } from "./CartCheckoutSummary";
const copy = {
  zh: { title: "整车结算原单", reload: "重新读取原单", loading: "正在读取…", login: "请登录查看本人原单。", loginButton: "用户登录", failed: "暂时无法核验原单，请重新读取，不要重复提交或据此认定未付款。", missing: "暂未确认本人整车原单，请核对账号和链接后重新读取。", unknown: "取消结果尚未确认，请重新读取原单，不要重复取消。", cancel: "取消整车原单", confirm: "确认取消整车", back: "保留本单", review: "将按各商品的原单规则处理实扣积分、原券及库存，不能只取消其中一个商品。这里不发起现金退款。", working: "正在取消…", business: "订单状态", pending: "待确认", confirmed: "已确认", completed: "已完成", cancelled: "已取消" },
  en: { title: "Original cart checkout", reload: "Reload original", loading: "Reading…", login: "Sign in to view your own original.", loginButton: "Sign in", failed: "The original could not be verified. Reload; do not submit again or infer nonpayment.", missing: "Your cart original is not confirmed. Check your account and link, then reload.", unknown: "Cancellation is unconfirmed. Reload the original; do not cancel again.", cancel: "Cancel original cart", confirm: "Confirm whole-cart cancellation", back: "Keep original", review: "Apply each product's original points, coupon and stock policy to the whole cart. Individual items cannot be cancelled here. No cash refund is made.", working: "Cancelling…", business: "Order status", pending: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" },
  es: { title: "Pedido original del carrito", reload: "Volver a leer el original", loading: "Leyendo…", login: "Inicia sesión para ver tu original.", loginButton: "Iniciar sesión", failed: "No se pudo verificar el original. Vuelve a leer; no repitas el envío ni lo consideres impagado.", missing: "No se ha confirmado tu pedido original. Revisa la cuenta y el enlace y vuelve a leer.", unknown: "La cancelación no está confirmada. Consulta el original; no la repitas.", cancel: "Cancelar carrito original", confirm: "Confirmar cancelación completa", back: "Conservar original", review: "Se aplican las reglas originales de puntos, cupones e inventario de cada producto al carrito completo. No se cancelan artículos sueltos ni se reembolsa efectivo aquí.", working: "Cancelando…", business: "Estado del pedido", pending: "Pendiente", confirmed: "Confirmado", completed: "Completado", cancelled: "Cancelado" },
};
const financial = (r: CartCheckoutResult) => JSON.stringify([r.siteId, r.operationKey, r.resourceKind, r.resourceId, r.method, r.currency,
  r.totalPoints, r.grossMinor, r.discountMinor, r.dueMinor, r.capturedMinor, r.couponCount, r.lines]);
/** Original key view, no new intent/nonce creation and no cart clearing.
 * Unknown cancellation hides old financial facts until a read confirms them. */
export function MemberCartResultPanel({ siteId, operationKey, identityKey, locale = "zh-CN", loginHref = "/login", request = checkoutClientRequest }: {
  siteId: string; operationKey: string; identityKey: string | null; locale?: string; loginHref?: string; request?: CheckoutClientRequest;
}) {
  const t = copy[merchantSettlementLanguage(locale)], scope = JSON.stringify([siteId, operationKey, identityKey]);
  const [loaded, setLoaded] = useState<{ scope: string; result: CartCheckoutResult } | null>(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [review, setReview] = useState(false);
  const [message, setMessage] = useState<"failed" | "missing" | "unknown" | "">("");
  const epoch = useRef(0), abort = useRef<AbortController | null>(null), writing = useRef(false), result = identityKey && loaded?.scope === scope ? loaded.result : null;
  const invalidate = useCallback(() => { ++epoch.current; abort.current?.abort(); }, []);
  const load = useCallback(async () => {
    if (!identityKey || writing.current || document.visibilityState === "hidden") return;
    invalidate(); const run = epoch.current, controller = new AbortController(); abort.current = controller; setLoaded(null); setLoading(true); setMessage(""); setReview(false);
    try {
      const raw = await request("/api/member-checkout/cart/result", { siteId, operationKey }, controller.signal);
      if (controller.signal.aborted || run !== epoch.current) return;
      if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true || !("state" in raw)) throw new Error("invalid");
      if (raw.state === "unconfirmed") { setMessage("missing"); return; }
      if (raw.state !== "confirmed" || !("original" in raw)) throw new Error("invalid");
      const original = parseCartClientOriginal(raw.original, siteId);
      if (original.kind !== "cart" || original.result.operationKey !== operationKey) throw new Error("invalid");
      setLoaded({ scope, result: original.result });
    } catch { if (!controller.signal.aborted && run === epoch.current) { setLoaded(null); setMessage("failed"); } }
    finally { if (run === epoch.current) setLoading(false); }
  }, [identityKey, invalidate, operationKey, request, scope, siteId]);
  useEffect(() => {
    const clear = () => { invalidate(); writing.current = false; setLoaded(null); setReview(false); setBusy(false); setLoading(false); setMessage(""); };
    const visibility = () => { if (document.visibilityState === "hidden") clear(); else void load(); };
    const focus = () => void load();
    clear(); void load(); window.addEventListener("focus", focus); window.addEventListener(SERVICE_IDENTITY_CHANGED, clear); document.addEventListener("visibilitychange", visibility);
    return () => { invalidate(); window.removeEventListener("focus", focus); window.removeEventListener(SERVICE_IDENTITY_CHANGED, clear); document.removeEventListener("visibilitychange", visibility); };
  }, [load, invalidate]);
  const cancel = async () => {
    if (!result?.cancellationAvailable || !result.resource || !review || loading || writing.current) return;
    const original = result, run = epoch.current, controller = new AbortController(); abort.current = controller; writing.current = true; setBusy(true); setLoaded(null); setMessage(""); setReview(false);
    try {
      const raw = await request("/api/member-checkout/cart/cancel", { siteId, operationKey, expectedUpdatedAt: original.resource!.updatedAt }, controller.signal);
      if (controller.signal.aborted || run !== epoch.current) return;
      if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true || !("replayed" in raw) || typeof raw.replayed !== "boolean" || !("result" in raw)) throw new Error("invalid");
      const closed = parseCartCheckoutResult(raw.result, { siteId, operationKey });
      if (!closed.closed || financial(closed) !== financial(original)) throw new Error("invalid");
      setLoaded({ scope, result: closed });
    } catch { if (!controller.signal.aborted && run === epoch.current) { setLoaded(null); setMessage("unknown"); } }
    finally { if (run === epoch.current) { writing.current = false; setBusy(false); } }
  };
  const button = "min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50";
  return <section data-member-cart-result aria-label={t.title} className="mx-auto max-w-4xl space-y-4 p-4 text-slate-900 sm:p-7">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">{t.title}</h1>{identityKey && <button className={button} disabled={loading || busy} onClick={() => void load()}>{t.reload}</button>}</header>
    {!identityKey ? <><p>{t.login}</p><a href={loginHref} className={button + " inline-block"}>{t.loginButton}</a></> : <>
      {loading && <p role="status">{t.loading}</p>}{busy && <p role="status">{t.working}</p>}{message && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">{t[message]}</p>}
      {result && <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><p className="break-all text-xs text-slate-500">{result.resourceId}</p><CartCheckoutSummary result={result} locale={locale}/>
        {result.resource && <p className="text-sm">{t.business}: {t[result.resource.status as "pending" | "confirmed" | "completed" | "cancelled"]}</p>}
        {result.cancellationAvailable && (!review ? <button className={button} disabled={loading || busy} onClick={() => setReview(true)}>{t.cancel}</button>
          : <div role="region" aria-label={t.confirm} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6"><p>{t.review}</p><div className="flex flex-wrap gap-2"><button className={button + " !bg-rose-700 !text-white"} disabled={loading || busy} onClick={() => void cancel()}>{t.confirm}</button><button className={button} disabled={busy} onClick={() => setReview(false)}>{t.back}</button></div></div>)}
      </article>}
    </>}
  </section>;
}
