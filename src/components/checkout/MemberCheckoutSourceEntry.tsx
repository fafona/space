"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { SERVICE_IDENTITY_CHANGED } from "@/components/service-center/serviceCenterClient";
import { buildCheckoutEntryHref, parseCheckoutEntryAccess, parseCheckoutEntryQuery, type CheckoutEntryAccess } from "@/lib/merchantCheckoutEntry";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
const copy = {
  zh: { title: "会员积分与券兑换", product: "选择兑换商品", choose: "请选择一个商品", quantity: "兑换数量", open: "在新页核对积分与券", selection: "请先选择有效的商品、数量或预约时间。", note: "此处单独兑换一个项目，不会提交或清空原预约表单、购物车。请勿同时在原入口重复提交。积分和券以兑换页重新核验为准。", booking: "沿用当前店铺、项目和预约时间。" },
  en: { title: "Member points & coupons", product: "Product to redeem", choose: "Choose one product", quantity: "Quantity to redeem", open: "Review points & coupons in a new tab", selection: "Choose a valid product, quantity or booking time first.", note: "Redeem one item separately. This does not submit or clear the original form/cart. Do not also submit it there. Points and coupons are checked again on the redemption page.", booking: "Uses the current store, service and booking time." },
  es: { title: "Puntos y cupones de socios", product: "Producto a canjear", choose: "Elige un producto", quantity: "Cantidad a canjear", open: "Revisar puntos y cupones en otra pestaña", selection: "Elige primero un producto, cantidad u horario válido.", note: "Canjea un artículo por separado. No envía ni vacía el formulario o carrito original. No lo envíes también allí. Los puntos y cupones se verifican de nuevo en la página de canje.", booking: "Usa el local, servicio y horario seleccionados." },
};
/** Additive gateway only. No financial writes, no legacy submit interception,
 * no cart repair/clearing and no contact fields copied into navigation URLs. */
export default function MemberCheckoutSourceEntry({ active, siteId, kind, blockId, viewport, bookingSelection, locale: suppliedLocale }: {
  active: boolean; siteId: string; kind: "booking" | "order"; blockId: string; viewport: "desktop" | "mobile";
  bookingSelection?: { store: string; item: string; appointmentAt: string }; locale?: string;
}) {
  const { locale: currentLocale } = useI18n(), locale = suppliedLocale ?? currentLocale, text = copy[merchantSettlementLanguage(locale)];
  const scope = JSON.stringify({ siteId, kind, blockId, viewport });
  const [loaded, setLoaded] = useState<{ scope: string; access: CheckoutEntryAccess } | null>(null), [chosen, setChosen] = useState(""), [quantity, setQuantity] = useState("1");
  const generation = useRef(0);
  useEffect(() => {
    let disposed = false, controller: AbortController | null = null;
    const invalidate = () => { ++generation.current; controller?.abort(); };
    const clear = () => { invalidate(); setLoaded(null); setChosen(""); setQuantity("1"); };
    const load = async () => {
      clear(); if (!active || document.visibilityState === "hidden") return;
      let query; try { query = parseCheckoutEntryQuery(JSON.parse(scope)); } catch { return; }
      const run = generation.current, ownedController = new AbortController(); controller = ownedController; const signal = ownedController.signal;
      const timeout = setTimeout(() => ownedController.abort(), 10_000);
      try {
        const response = await fetch("/api/member-checkout/entry", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(query), signal });
        if (!response.ok) return;
        const access = parseCheckoutEntryAccess(await response.json(), query);
        if (access && !disposed && !signal.aborted && run === generation.current) setLoaded({ scope, access });
      } catch { /* unavailable discovery never blocks the original form/cart */ }
      finally { clearTimeout(timeout); }
    };
    const visible = () => document.visibilityState === "hidden" ? clear() : void load();
    const storage = (e: StorageEvent) => { if (e.key === null || /auth|account|session/i.test(e.key)) clear(); };
    void load(); window.addEventListener("focus", load); window.addEventListener("pagehide", clear); window.addEventListener(SERVICE_IDENTITY_CHANGED, load);
    window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; invalidate(); window.removeEventListener("focus", load); window.removeEventListener("pagehide", clear); window.removeEventListener(SERVICE_IDENTITY_CHANGED, load); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visible); };
  }, [active, scope]);
  const access = active && loaded?.scope === scope ? loaded.access : null;
  if (!access?.offers.length) return null;
  const matches = kind === "booking" ? access.offers.filter(o => o.source.kind === "booking" && o.source.store === bookingSelection?.store && o.source.item === bookingSelection.item)
    : access.offers.filter(o => o.offerId === chosen);
  const offer = matches.length === 1 ? matches[0] : null;
  const cash = offer?.onSiteOnly || access.offers.every(o => o.onSiteOnly);
  const cashCopy = merchantSettlementLanguage(locale) === "zh" ? { title: "会员到店付款与券", open: "在新页核对到店金额与券", note: "单独提交一个项目，不会提交或清空原表单、购物车；请勿在两个入口重复提交。金额和券需在新页重新核验。" }
    : merchantSettlementLanguage(locale) === "es" ? { title: "Pago en local y cupones de socio", open: "Revisar importe y cupones en otra pestaña", note: "Un artículo por separado, sin enviar ni vaciar el formulario/carrito original. No lo envíes en ambos lugares. El importe y los cupones se verifican de nuevo." }
      : { title: "Member pay-at-venue & coupons", open: "Review venue amount & coupons in a new tab", note: "One item separately, without submitting or clearing the original form/cart. Do not submit in both places. Amount and coupons are checked again." };
  if (kind === "booking" && !offer) return null;
  let href = "";
  if (offer) try { href = buildCheckoutEntryHref(siteId, offer, kind === "booking" ? 1 : /^[1-9][0-9]{0,2}$/.test(quantity) ? Number(quantity) : 0, kind === "booking" ? bookingSelection?.appointmentAt : undefined, locale); } catch { /* invalid selection is not navigable */ }
  const input = "min-h-11 w-full min-w-0 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900";
  return <aside data-checkout-source-entry className="my-3 min-w-0 space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-slate-900">
    <h3 className="font-semibold">{cash ? cashCopy.title : text.title}</h3>
    {kind === "order" ? <div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_8rem]">
      <label className="min-w-0 space-y-1 text-sm"><span>{text.product}</span><select aria-label={text.product} className={input} value={chosen} onChange={e => setChosen(e.target.value)}>
        <option value="">{text.choose}</option>{access.offers.map(o => <option key={o.offerId} value={o.offerId}>{o.title}</option>)}</select></label>
      <label className="min-w-0 space-y-1 text-sm"><span>{text.quantity}</span><input aria-label={text.quantity} type="number" min="1" max={offer?.maxQuantity ?? 999} className={input} value={quantity} onChange={e => setQuantity(e.target.value)}/></label>
    </div> : <p className="text-sm">{offer?.title} · {bookingSelection?.appointmentAt || text.selection}<br/>{text.booking}</p>}
    <p className="text-xs leading-5 text-slate-600">{cash ? cashCopy.note : text.note}</p>
    {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center rounded-xl bg-sky-800 px-4 py-2 text-sm font-semibold text-white">{cash ? cashCopy.open : text.open}</a>
      : <p role="status" className="text-sm text-slate-600">{text.selection}</p>}
  </aside>;
}
