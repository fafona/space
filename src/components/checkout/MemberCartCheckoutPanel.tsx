"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { createCartCheckoutController } from "@/lib/merchantCheckoutCartClient";
import type { CartClientOriginal, CartClientSelection } from "@/lib/merchantCheckoutCartReview";
import type { CheckoutCustomerDraft } from "@/lib/merchantCheckoutClient";
import { checkoutCouponClaimKey } from "@/lib/merchantCheckoutCoupons";
import { merchantSettlementLanguage, formatSettlementMoney } from "@/lib/merchantSettlement";
import { SERVICE_IDENTITY_CHANGED } from "@/components/service-center/serviceCenterClient";
import { MerchantCheckoutCouponPicker } from "./MerchantCheckoutCouponPicker";

const copy = {
  zh: { title: "购物车 · 会员结算", intro: "一次核对并提交全部所选商品。积分与现金分开计算；此处不在线扣款。", name: "姓名", email: "联系邮箱", phone: "联系电话", note: "备注", points: "积分兑换", cash: "到店付款", method: "结算方式", item: "商品", quantity: "数量", review: "核对整车与优惠券", confirm: "确认整车结算", agreed: "已核对全部商品、积分或金额及逐项取消规则", working: "正在核对…", unknown: "正在确认原单结果。请读取原单，不要重复提交。", recover: "读取原单", done: "整车原单", closed: "原单已取消", unpaid: "待到店付款 · 尚未收款", redeemed: "积分／券已兑换", covered: "优惠券已抵扣应付金额 · 未收取现金", policy: "取消规则", returnPoints: "按原单退积分", keepPoints: "不退积分", returnCoupons: "退回原券，原有效期不变", keepCoupons: "不退券", coupons: "券只分配给一个商品；需更换商品时先取消原选择。", clear: "清除全部所选券", total: "整车合计", balance: "当前可用积分", insufficient: "整车所需积分超过可用积分，不能提交。", acknowledged: "已核对原单，开始另一单", cancel: "取消整车原单", cancelConfirm: "确认取消整车（不能只取消其中一个商品）", reviewRequired: "原单资料需人工核对，请勿重复提交。", single: "找到原有的单项目结算，请先查看原单。", detail: "查看原单", login: "请登录本人账号后使用会员结算。", loginButton: "用户登录", invalid: "请填写姓名、有效邮箱及电话；姓名最多40字节，备注最多100字节。", failed: "暂时无法完成，请重新核对商品、会员或优惠券。", storage: "无法可靠保存原单编号，已暂停提交。请保留本页。", changed: "身份已变化，请重新打开购物车核对。", noReceipt: "提交不是在线付款；到店金额以商户核实收款为准。" },
  en: { title: "Cart · Member checkout", intro: "Review and submit all selected products together. Points and cash stay separate. No online charge is made here.", name: "Name", email: "Contact email", phone: "Phone", note: "Note", points: "Redeem points", cash: "Pay at venue", method: "Payment method", item: "Product", quantity: "Quantity", review: "Review cart & coupons", confirm: "Confirm cart checkout", agreed: "I reviewed every item, points or amount, and each cancellation policy", working: "Checking…", unknown: "The original outcome is unconfirmed. Read the original; do not submit again.", recover: "Read original", done: "Original cart checkout", closed: "Original cancelled", unpaid: "Pay at venue — unpaid", redeemed: "Points / coupons redeemed", covered: "Coupons cover the amount — no cash collected", policy: "Cancellation policy", returnPoints: "Return original points", keepPoints: "No points return", returnCoupons: "Return original coupons without extending validity", keepCoupons: "No coupon return", coupons: "Each coupon can belong to one product. Remove its existing selection before assigning it elsewhere.", clear: "Clear all selected coupons", total: "Cart total", balance: "Available points", insufficient: "The cart needs more points than are available. It cannot be submitted.", acknowledged: "Reviewed — start another", cancel: "Cancel whole original cart", cancelConfirm: "Confirm whole-cart cancellation (not an individual item)", reviewRequired: "The original needs manual review. Do not submit again.", single: "An earlier single-item checkout was found. Review that original first.", detail: "View original", login: "Sign in with your own account to use member checkout.", loginButton: "Sign in", invalid: "Enter name, valid email and phone. Name: 40 UTF-8 bytes; note: 100 bytes.", failed: "Could not complete. Review products, membership and coupons again.", storage: "The original reference cannot be saved reliably. Submission is paused; keep this page.", changed: "Your identity changed. Reopen the cart to review.", noReceipt: "Submitting is not an online payment. The merchant must verify any cash received." },
  es: { title: "Carrito · Pago de socios", intro: "Revisa y envía todos los productos juntos. Los puntos y el dinero se calculan por separado. Aquí no se cobra en línea.", name: "Nombre", email: "Correo de contacto", phone: "Teléfono", note: "Nota", points: "Canjear puntos", cash: "Pagar en el local", method: "Forma de pago", item: "Producto", quantity: "Cantidad", review: "Revisar carrito y cupones", confirm: "Confirmar pedido completo", agreed: "He revisado todos los artículos, puntos o importe y las reglas de cancelación", working: "Comprobando…", unknown: "El resultado original no está confirmado. Consulta el original; no lo envíes otra vez.", recover: "Consultar original", done: "Pedido original del carrito", closed: "Original cancelado", unpaid: "Pago en el local — pendiente", redeemed: "Puntos / cupones canjeados", covered: "Importe cubierto por cupones — sin cobro de efectivo", policy: "Reglas de cancelación", returnPoints: "Devolver los puntos originales", keepPoints: "No devolver puntos", returnCoupons: "Devolver cupones originales sin ampliar su validez", keepCoupons: "No devolver cupones", coupons: "Cada cupón corresponde a un solo producto. Quita su selección anterior para usarlo en otro.", clear: "Quitar todos los cupones", total: "Total del carrito", balance: "Puntos disponibles", insufficient: "El carrito requiere más puntos de los disponibles. No se puede enviar.", acknowledged: "Revisado — empezar otro", cancel: "Cancelar carrito original completo", cancelConfirm: "Confirmar cancelación completa (no de un artículo individual)", reviewRequired: "El original necesita revisión manual. No lo envíes otra vez.", single: "Hay un pedido anterior de un solo artículo. Consulta primero ese original.", detail: "Ver original", login: "Inicia sesión con tu cuenta para usar el pago de socios.", loginButton: "Iniciar sesión", invalid: "Introduce nombre, correo y teléfono válidos. Nombre: 40 bytes UTF-8; nota: 100 bytes.", failed: "No se pudo completar. Revisa los productos, membresía y cupones.", storage: "No se puede guardar la referencia de forma fiable. El envío está pausado; conserva la página.", changed: "Tu identidad ha cambiado. Abre de nuevo el carrito para revisar.", noReceipt: "Enviar no es pagar en línea. El comercio debe verificar cualquier cobro en efectivo." },
};
const blank = (): CheckoutCustomerDraft => ({ name: "", title: "", email: "", phone: "", note: "" });
const input = "min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";
const button = "min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-50";
const primaryButton = "min-h-11 w-full rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50";
type Props = { siteId: string; accountId: string | null; initialSelection: CartClientSelection; initialCustomer?: CheckoutCustomerDraft;
  locale?: string; controllerFactory?: typeof createCartCheckoutController; allowNewCheckout?: boolean; intentEnabled?: boolean;
  beforeSubmit?: (customer: CheckoutCustomerDraft) => void | Promise<void>;
  beforeRelease?: (original: CartClientOriginal, context: { createdHere: boolean }) => void | Promise<void>; onReleased?: () => void; onReturnToCart?: () => void };
/** Shared review for standalone tests and the independently gated real cart.
 * Host callbacks own durable draft preservation; no implicit cart cleanup,
 * member change, cash collection or online payment happens here. */
export function MemberCartCheckoutPanel(props: Props) {
  const t = copy[merchantSettlementLanguage(props.locale ?? "zh-CN")];
  if (!props.accountId) return <section className="space-y-4 p-5"><p>{t.login}</p><Link href="/login" className={button + " inline-block"}>{t.loginButton}</Link></section>;
  return <Active key={JSON.stringify([props.siteId, props.accountId, props.initialSelection])} {...props} accountId={props.accountId}/>;
}
function Active({ siteId, accountId, initialSelection, initialCustomer, locale = "zh-CN", controllerFactory = createCartCheckoutController,
  allowNewCheckout = true, intentEnabled = false, beforeSubmit, beforeRelease, onReleased, onReturnToCart }: Props & { accountId: string }) {
  const t = copy[merchantSettlementLanguage(locale)], controller = useMemo(() => controllerFactory({ siteId, accountId, intentEnabled }), [siteId, accountId, intentEnabled, controllerFactory]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [selection, setSelection] = useState(() => structuredClone(initialSelection)), [customer, setCustomer] = useState(() => initialCustomer ? structuredClone(initialCustomer) : blank());
  const [agreed, setAgreed] = useState(false), [cancelConfirm, setCancelConfirm] = useState(false), [blocked, setBlocked] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false), [draftBusy, setDraftBusy] = useState(false);
  const busy = ["quoting", "submitting", "recovering", "cancelling", "acknowledging"].includes(state.phase), frozen = busy || state.pending;
  useEffect(() => {
    void controller.activate();
    const identity = () => { controller.deactivate(); setCustomer(blank()); setBlocked(true); setAgreed(false); setCancelConfirm(false); };
    const storage = (e: StorageEvent) => { if (e.key === null || /auth|account|session/i.test(e.key ?? "")) identity(); else if (e.key === controller.storageKey) { setCancelConfirm(false); void controller.recover(); } };
    window.addEventListener(SERVICE_IDENTITY_CHANGED, identity); window.addEventListener("storage", storage);
    return () => { controller.deactivate(); window.removeEventListener(SERVICE_IDENTITY_CHANGED, identity); window.removeEventListener("storage", storage); };
  }, [controller]);
  if (blocked) return <p role="alert" className="p-5">{t.changed}</p>;
  const quote = state.review?.quote, original = state.original, cart = original?.kind === "cart" ? original.result : null;
  const pointUnit = merchantSettlementLanguage(locale) === "zh" ? "积分" : merchantSettlementLanguage(locale) === "es" ? "puntos" : "points";
  const amount = (value: number | null, method = selection.method) => method === "points" ? `${value ?? "—"} ${pointUnit}` : value === null ? "—" : formatSettlementMoney(value, locale);
  const preview = (next = selection) => { setAgreed(false); setCancelConfirm(false); void controller.preview(next, customer); };
  const editField = (key: "name" | "email" | "phone" | "note", value: string) => { controller.edit(); setAgreed(false); setDraftFailed(false);
    const next = { ...customer, [key]: value }; setCustomer(next); };
  const submit = async () => { if (draftBusy) return; setDraftBusy(true); setDraftFailed(false);
    try { await beforeSubmit?.(structuredClone(customer)); await controller.submit(); } catch { setDraftFailed(true); } finally { setDraftBusy(false); } };
  const acknowledge = async () => { if (draftBusy) return; setDraftBusy(true); setDraftFailed(false);
    try { await controller.startAnother(beforeRelease); const next = controller.getSnapshot(); if (!next.pending && next.phase === "idle") onReleased?.(); }
    catch { setDraftFailed(true); } finally { setDraftBusy(false); } };
  const returnToCart = async () => { if (draftBusy || busy || state.pending || !onReturnToCart) return; setDraftBusy(true); setDraftFailed(false);
    try { await beforeSubmit?.(structuredClone(customer)); if (!controller.getSnapshot().pending) onReturnToCart(); }
    catch { setDraftFailed(true); } finally { setDraftBusy(false); } };
  const field = (key: "name" | "email" | "phone" | "note", type = "text") => <label className="min-w-0 space-y-1 text-sm"><span>{t[key]}</span>{key === "note"
    ? <textarea className={input} rows={2} aria-label={t[key]} value={customer[key]} onChange={e => editField(key, e.target.value)}/>
    : <input className={input} aria-label={t[key]} type={type} value={customer[key]} onChange={e => editField(key, e.target.value)}/>}</label>;
  const error = state.error === "checkout_invalid_customer" ? t.invalid : state.error === "checkout_storage_unavailable" ? t.storage : state.error ? state.pending ? t.unknown : t.failed : "";
  return <section data-member-cart-checkout className="mx-auto max-w-4xl space-y-5 p-4 text-slate-900 sm:p-7">
    <header><p className="text-xs font-semibold tracking-widest text-teal-700">FAOLLA · MEMBER CHECKOUT</p><h1 className="mt-2 text-2xl font-bold">{t.title}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{t.intro}</p></header>
    {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">{error}</p>}
    {draftFailed && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">{t.storage}</p>}
    {busy && <p role="status">{t.working}</p>}
    {onReturnToCart && !state.pending && <button type="button" className={button} disabled={busy || draftBusy} onClick={() => void returnToCart()}>{merchantSettlementLanguage(locale) === "zh" ? "返回购物车修改" : merchantSettlementLanguage(locale) === "es" ? "Volver al carrito" : "Back to cart"}</button>}
    {state.pending && !original && !busy && <button className={button} onClick={() => void controller.recover()}>{t.recover}</button>}
    {original ? <article className="space-y-4 rounded-2xl border border-teal-200 bg-white p-5">
      {cart ? <><h2 className="text-xl font-semibold">{t.done}</h2><p className="break-all text-xs text-slate-500">{cart.resourceId}</p>
        {cart.reviewRequired ? <p role="alert">{t.reviewRequired}</p> : <p data-cart-payment-status className="font-semibold text-teal-800">{cart.closed ? t.closed : cart.method === "points" ? t.redeemed : cart.dueMinor === 0 ? t.covered : t.unpaid}</p>}
        <ul className="divide-y divide-slate-100">{cart.lines.map(l => <li key={l.offerId} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{l.title} × {l.quantity}</span><strong>{amount(l.points ?? l.dueMinor, cart.method)}</strong></li>)}</ul>
        {!cart.reviewRequired && <p className="font-semibold">{t.total}: {amount(cart.totalPoints ?? cart.dueMinor, cart.method)}</p>}
        <a className={button + " inline-flex items-center"} href={`/member-checkout/${siteId}/cart/${cart.operationKey}?uiLocale=${encodeURIComponent(locale)}`}>{t.detail}</a>
        {cart.cancellationAvailable && !cancelConfirm && <button className={button} disabled={busy} onClick={() => setCancelConfirm(true)}>{t.cancel}</button>}
        {cancelConfirm && cart.cancellationAvailable && <button className={button + " border-rose-300 text-rose-800"} disabled={busy} onClick={() => { setCancelConfirm(false); void controller.cancel(); }}>{t.cancelConfirm}</button>}
      </> : original.kind === "single" ? <><p>{t.single}</p><a className={button + " inline-block"} href={`/member-checkout/${siteId}/${original.original.method === "on_site" ? "on-site/" : ""}${original.original.result.operationKey}?uiLocale=${encodeURIComponent(locale)}`}>{t.detail}</a></> : null}
      <button className={button} disabled={busy} onClick={() => { setCancelConfirm(false); void controller.recover(); }}>{t.recover}</button>
      {state.intentReviewRequired && <p role="alert">{t.reviewRequired}</p>}
      {!cart?.reviewRequired && !state.intentReviewRequired && <button className={button} disabled={busy || draftBusy} onClick={() => { setCancelConfirm(false); setAgreed(false); void acknowledge(); }}>{t.acknowledged}</button>}
    </article> : !state.pending && allowNewCheckout && <>
      <fieldset disabled={frozen} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        {field("name")}{field("email", "email")}{field("phone", "tel")}{field("note")}
        <label className="space-y-1 text-sm sm:col-span-2"><span>{t.method}</span><select aria-label={t.method} className={input} value={selection.method} onChange={e => {
          controller.edit(); setAgreed(false); setSelection(v => ({ ...v, method: e.target.value as CartClientSelection["method"], lines: v.lines.map(l => ({ ...l, couponClaims: [] })) }));
        }}><option value="points">{t.points}</option><option value="on_site">{t.cash}</option></select></label>
        <p className="text-sm text-slate-600 sm:col-span-2">{selection.lines.length} {t.item} · {t.quantity}: {selection.lines.reduce((s, l) => s + l.quantity, 0)}</p>
        <button type="button" className={button + " sm:col-span-2"} onClick={() => preview()}>{t.review}</button>
        {selection.lines.some(l => l.couponClaims?.length) && <button type="button" className={button + " sm:col-span-2"} onClick={() => { controller.edit(); setAgreed(false); setSelection(v => ({ ...v, lines: v.lines.map(l => ({ ...l, couponClaims: [] })) })); }}>{t.clear}</button>}
      </fieldset>
      {quote && <article className="space-y-4 rounded-2xl border border-teal-200 bg-teal-50/50 p-4 sm:p-5">
        <p className="text-xs leading-5 text-slate-600">{t.coupons}</p>
        {quote.lines.map(l => {
          const elsewhere = new Set(selection.lines.filter(row => row.offerId !== l.offerId).flatMap(row => row.couponClaims ?? []).map(checkoutCouponClaimKey));
          const choices = state.review!.couponChoices.find(w => w.offerId === l.offerId)!.choices.filter(c => !elsewhere.has(checkoutCouponClaimKey(c)));
          return <section data-cart-review-line key={l.offerId} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="break-words text-lg font-semibold">{l.title} × {l.quantity}</h2><p className="mt-2 text-lg font-bold text-teal-800">{amount(l.duePoints ?? l.dueMinor)}</p>
            <p className="mt-2 text-xs leading-5 text-slate-600">{t.policy}: {selection.method === "points" ? `${l.cancellationPolicy.returnPoints ? t.returnPoints : t.keepPoints} · ` : ""}{l.cancellationPolicy.returnCoupons ? t.returnCoupons : t.keepCoupons}</p>
            <MerchantCheckoutCouponPicker locale={locale} choices={choices} selected={l.couponClaims} busy={frozen} onChange={claims => {
              const next = { ...selection, lines: selection.lines.map(row => row.offerId === l.offerId ? { ...row, couponClaims: claims } : row) };
              controller.edit(); setSelection(next); preview(next);
            }}/>
          </section>;
        })}
        <p className="text-xl font-bold">{t.total}: {amount(quote.duePoints ?? quote.dueMinor)}</p>
        {quote.ownPointBalance !== null && <p className="text-sm">{t.balance}: {quote.ownPointBalance}</p>}
        {!quote.methodAvailable && <p role="alert" className="text-sm text-rose-800">{t.insufficient}</p>}
        <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1 h-4 w-4 shrink-0 accent-teal-700" type="checkbox" checked={agreed} disabled={frozen || !quote.methodAvailable} onChange={e => setAgreed(e.target.checked)}/><span>{t.agreed}</span></label>
        <button className={primaryButton} disabled={frozen || draftBusy || !agreed || !quote.methodAvailable} onClick={() => void submit()}>{t.confirm}</button>
        <p className="text-xs leading-5 text-slate-500">{t.noReceipt}</p>
      </article>}
    </>}
  </section>;
}
