"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createLegacyReviewController, legacyReviewStorageKey } from "@/lib/merchantCheckoutLegacyReviewClient";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { SERVICE_IDENTITY_CHANGED } from "@/components/service-center/serviceCenterClient";
import type { LegacyOrderReview } from "@/lib/merchantCheckoutLegacyReview";
const handoffCopy = {
  zh: { confirm: "我已核对原订单；保留旧车、不导入内容，使用当前账号的独立购物车。原订单不会被取消或标记付款。", button: "保留旧车，使用独立购物车", busy: "正在重新核对并交接…", done: "已保留旧共享车；当前账号购物车可独立使用，没有导入旧商品或联系方式。", error: "交接未能确认。旧车和当前账号车均保留；请重新核对，不要重复提交订单。" },
  en: { confirm: "I reviewed the original order. Keep the old cart without importing it and use my separate account cart. The order is not cancelled or marked paid.", button: "Keep old cart; use account cart", busy: "Rechecking and handing off…", done: "Old shared cart kept. Your account cart is independent; no old products or contacts were imported.", error: "Handoff could not be confirmed. Both carts are kept. Recheck; do not resubmit an order." },
  es: { confirm: "He revisado el pedido. Conservar el carrito antiguo, sin importarlo, y usar el de mi cuenta. No se cancela el pedido ni se marca como pagado.", button: "Conservar y usar carrito de mi cuenta", busy: "Comprobando el cambio…", done: "Se conserva el carrito compartido. El de tu cuenta es independiente; no se importaron productos ni contactos.", error: "No se pudo confirmar el cambio. Se conservan ambos carritos. Revisa; no reenvíes el pedido." },
};
const copy = {
  zh: { title: "旧普通订单核对", read: "核对旧普通订单", reading: "正在核对…", note: "仅核对旧编号是否对应本账号的普通订单，不按邮箱或商品认领。不会导入、清理旧车或解除结算保护。", owned: "已找到本账号的普通订单。", boundary: "这不证明旧购物车的全部商品和联系方式属于你，也不是付款证明；请在原订单列表核对。", unknown: "尚不能确认旧编号对应的本人普通订单。旧车与编号继续保留，不代表提交失败。", failed: "暂时无法核对，或旧车／账号已变化。请保留旧车，重新打开后核对，不要重复提交。", changed: "账号或旧车已变化，请重新打开本页。", id: "订单编号", status: "业务状态", created: "创建时间（UTC）", updated: "更新时间（UTC）", states: { pending: "待确认", confirmed: "已确认", completed: "已完成", cancelled: "已取消" } },
  en: { title: "Review old regular order", read: "Check old regular order", reading: "Checking…", note: "Check whether the old reference matches this account’s regular order, not by email or products. No cart import, clearing or release of checkout protection.", owned: "A regular order for this account was found.", boundary: "This does not prove ownership of all local cart products or contacts and is not payment proof. Review it in the original order list.", unknown: "Your old regular order is not confirmed. The cart and reference are kept; this does not prove submission failed.", failed: "Unavailable, or the cart/account changed. Keep the old cart and reopen to check; do not resubmit.", changed: "Account or old cart changed. Reopen this page.", id: "Order ID", status: "Business status", created: "Created (UTC)", updated: "Updated (UTC)", states: { pending: "Pending", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled" } },
  es: { title: "Revisar pedido normal antiguo", read: "Consultar pedido normal antiguo", reading: "Consultando…", note: "Comprueba si la referencia corresponde a un pedido normal de tu cuenta, no por correo ni productos. No importa ni borra carritos ni levanta la protección.", owned: "Se encontró un pedido normal de tu cuenta.", boundary: "No acredita la propiedad de todos los productos o contactos del carrito, ni el pago. Revísalo en la lista original de pedidos.", unknown: "No se ha confirmado tu pedido normal antiguo. Se conservan el carrito y la referencia; no significa que el envío falló.", failed: "No disponible, o cambió el carrito o la cuenta. Conserva el carrito y vuelve a abrir para consultar; no reenvíes.", changed: "Cambió la cuenta o el carrito. Abre de nuevo esta página.", id: "Número de pedido", status: "Estado del pedido", created: "Creado (UTC)", updated: "Actualizado (UTC)", states: { pending: "Pendiente", confirmed: "Confirmado", completed: "Completado", cancelled: "Cancelado" } },
};
export function MemberCheckoutLegacyReview({ siteId, blockId, accountId, locale, controllerFactory = createLegacyReviewController, onIsolate }: {
  siteId: string; blockId: string; accountId: string; locale: string; controllerFactory?: typeof createLegacyReviewController;
  onIsolate?: (review: LegacyOrderReview, confirmed: boolean) => Promise<void>;
}) {
  const controller = useMemo(() => controllerFactory({ siteId, blockId, accountId }), [siteId, blockId, accountId, controllerFactory]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), [blocked, setBlocked] = useState(false), t = copy[merchantSettlementLanguage(locale)];
  const [confirmed, setConfirmed] = useState(false), [handoff, setHandoff] = useState<"idle" | "busy" | "done" | "error">("idle"), ht = handoffCopy[merchantSettlementLanguage(locale)], live = state.review;
  const isolate = async () => {
    if (!onIsolate || !confirmed || handoff === "busy" || !live?.order || blocked) return;
    setHandoff("busy"); try { await onIsolate(live, confirmed); setHandoff("done"); } catch { setHandoff("error"); } finally { setConfirmed(false); }
  };
  useEffect(() => {
    controller.activate(); const stop = () => { controller.deactivate(); setBlocked(true); };
    const storage = (e: StorageEvent) => { if (e.key === null || e.key === legacyReviewStorageKey(siteId, blockId) || /auth|account|session/i.test(e.key)) stop(); };
    const hidden = () => { if (document.visibilityState === "hidden") stop(); };
    window.addEventListener(SERVICE_IDENTITY_CHANGED, stop); window.addEventListener("pagehide", stop); window.addEventListener("storage", storage); document.addEventListener("visibilitychange", hidden);
    return () => { controller.deactivate(); window.removeEventListener(SERVICE_IDENTITY_CHANGED, stop); window.removeEventListener("pagehide", stop); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", hidden); };
  }, [controller, siteId, blockId]);
  if (!blocked && (state.phase === "idle" || state.phase === "empty")) return null;
  const order = blocked ? null : state.review?.order;
  return <aside data-checkout-legacy-review className="max-h-[32dvh] min-w-0 shrink-0 space-y-2 overflow-y-auto overscroll-contain border-t border-amber-100 bg-amber-50 px-3 py-3 text-sm text-slate-900 sm:px-5">
    <h3 className="font-semibold">{t.title}</h3><p className="text-xs leading-5 text-slate-600">{t.note}</p>
    {blocked ? <p role="alert">{t.changed}</p> : <><button type="button" className="min-h-11 rounded-xl border border-amber-200 bg-white px-3 py-2 font-semibold disabled:opacity-50" disabled={state.phase === "reading" || handoff === "busy"} onClick={() => { setConfirmed(false); setHandoff("idle"); void controller.read(); }}>{t.read}</button>
      {state.phase === "reading" && <p role="status">{t.reading}</p>}{state.phase === "error" && <p role="alert">{t.failed}</p>}{state.phase === "unconfirmed" && <p role="status">{t.unknown}</p>}
      {order && <div className="space-y-2"><p className="font-semibold">{t.owned}</p><dl className="grid min-w-0 gap-2 sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">{t.id}</dt><dd data-legacy-review-order-id className="break-all">{order.id}</dd></div>
        <div><dt className="text-xs text-slate-500">{t.status}</dt><dd>{t.states[order.status]}</dd></div>
        <div><dt className="text-xs text-slate-500">{t.created}</dt><dd><time dateTime={order.createdAt}>{order.createdAt}</time></dd></div>
        <div><dt className="text-xs text-slate-500">{t.updated}</dt><dd><time dateTime={order.updatedAt}>{order.updatedAt}</time></dd></div></dl><p className="text-xs leading-5 text-slate-600">{t.boundary}</p>
        {onIsolate && <div data-legacy-handoff className="space-y-2 border-t border-amber-200 pt-2"><label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={confirmed} disabled={handoff === "busy"} onChange={e => setConfirmed(e.target.checked)}/><span>{ht.confirm}</span></label><button type="button" className="min-h-11 rounded-xl bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-50" disabled={!confirmed || handoff === "busy"} onClick={() => void isolate()}>{handoff === "busy" ? ht.busy : ht.button}</button></div>}
        {handoff === "done" && <p role="status">{ht.done}</p>}{handoff === "error" && <p role="alert">{ht.error}</p>}
      </div>}
    </>}
  </aside>;
}
