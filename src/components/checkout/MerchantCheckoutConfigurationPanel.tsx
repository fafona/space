"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createMerchantBusinessApiClient, type MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
import { checkoutEditFromOffer, parseCheckoutConfigurationEdit, type CheckoutConfigurationEdit,
  type CheckoutConfigurationOptions, type CheckoutConfigurationSnapshot, type ConfiguredCheckoutOffer } from "@/lib/merchantCheckoutConfiguration";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { getBookingTimeZoneOptions } from "@/lib/merchantBookingTimeZoneOptions";

const copy = {
  zh: { title: "预约与商品结算设置", intro: "单独配置会员自助结算，不改动现有预约、商品价格或收银设置。Stripe 在线支付稍后接入。",
    reload: "重新读取", new: "新增项目", list: "已配置项目", empty: "尚未配置项目", select: "选择已发布的项目", source: "绑定项目", titleField: "展示名称",
    desktop: "电脑", mobile: "手机", booking: "预约", order: "商品", cash: "单价（欧元）", points: "每份所需积分", stock: "关联现有兑换库存（可选）", none: "不关联",
    priceNote: "商品金额来自现有商品目录；关联兑换库存时，积分价格沿用该兑换项目。不会自动修改原价格或库存。",
    quantity: "单次最多数量", duration: "服务时长（分钟，可选）", zone: "预约所在时区", enabled: "启用此结算项目", onsite: "允许到店付款",
    policy: "取消规则", advance: "至少提前多少分钟允许取消", returnPoints: "取消后退回本单实际扣除的积分", returnCoupons: "取消后退回原券",
    yes: "是", no: "否", decide: "请选择", policyNote: "按下单时保存的规则处理；重复取消不重复退还，券有效期不自动延长。已履约项目不可自助取消。",
    vouchers: "可兑换本项目的券", vouchersEmpty: "没有可绑定的有效兑换类券", voucherNote: "金额券、折扣券和积分券仍按券本身条件计算；这里只明确绑定商品券、兑换券和门票券。",
    save: "保存设置", saved: "已保存新版本", saving: "保存中…", loading: "读取中…", failed: "暂时无法读取设置，请稍后重试。", invalid: "请填写有效的价格、积分、数量和取消规则。",
    conflict: "设置或发布项目已变化。草稿已保留，请重新读取并核对后保存。", unknown: "保存结果尚未确认。请先重新读取并核对原项目，不要重复创建。", denied: "仅限已授权的商户负责人使用。",
    stale: "发布来源已变化，请重新选择或核对当前来源后保存。", refreshSource: "核对并使用当前来源", draft: "未保存", unavailable: "新结算功能尚未开放。", discard: "当前有未保存的编辑，是否放弃？",
    enableNote: "启用设置不等于开启收款。新的用户结算流程需经过独立验收和灰度启用。", missing: "未找到已发布项目。请先发布预约模块，或在商品目录中配置可售商品。" },
  en: { title: "Booking & product checkout", intro: "Configure member self-checkout separately. Existing booking, catalog prices and cashier settings stay unchanged. Stripe will follow later.",
    reload: "Reload", new: "Add offer", list: "Configured offers", empty: "No offers yet", select: "Choose a published item", source: "Linked item", titleField: "Display name",
    desktop: "Desktop", mobile: "Mobile", booking: "Booking", order: "Product", cash: "Unit price (EUR)", points: "Points per unit", stock: "Link redemption stock (optional)", none: "No stock link",
    priceNote: "Product prices come from the existing catalog. Linked redemption stock keeps its current points price. Original prices and stock are not changed.",
    quantity: "Maximum quantity", duration: "Duration (minutes, optional)", zone: "Booking time zone", enabled: "Enable this offer", onsite: "Allow payment on arrival",
    policy: "Cancellation policy", advance: "Minimum notice in minutes", returnPoints: "Return points actually debited for this checkout", returnCoupons: "Return original coupons on cancellation",
    yes: "Yes", no: "No", decide: "Choose", policyNote: "The policy is captured at checkout. No duplicate returns or extended coupon expiry. Fulfilled items cannot be cancelled by the customer.",
    vouchers: "Vouchers redeemable for this item", vouchersEmpty: "No eligible vouchers to link", voucherNote: "Cash, discount and points coupons follow their own conditions. Link product, exchange and admission vouchers here.",
    save: "Save settings", saved: "New version saved", saving: "Saving…", loading: "Loading…", failed: "Settings could not be loaded. Please try again.", invalid: "Enter valid prices, points, quantity and cancellation choices.",
    conflict: "Settings or published items changed. Your draft is kept. Reload and review before saving.", unknown: "Save result is unconfirmed. Reload and review the original item; do not create it again.", denied: "Authorized merchant owners only.",
    stale: "The published source changed. Review and confirm the current source before saving.", refreshSource: "Confirm current source", draft: "Unsaved", unavailable: "New checkout is not enabled yet.", discard: "Discard the unsaved edits?",
    enableNote: "Enabling this offer does not activate payments. User checkout needs separate validation and rollout.", missing: "No published items found. Publish a booking block or configure available products in the operating catalog first." },
  es: { title: "Pago de reservas y productos", intro: "Configura el canje de socios por separado, sin cambiar las reservas, los precios del catálogo ni la caja actuales. Stripe se integrará después.",
    reload: "Volver a leer", new: "Añadir oferta", list: "Ofertas configuradas", empty: "Todavía no hay ofertas", select: "Elige un artículo publicado", source: "Artículo vinculado", titleField: "Nombre visible",
    desktop: "Ordenador", mobile: "Móvil", booking: "Reserva", order: "Producto", cash: "Precio unitario (EUR)", points: "Puntos por unidad", stock: "Vincular existencias de canje (opcional)", none: "Sin vínculo",
    priceNote: "El importe del producto procede del catálogo actual. Al vincular existencias se conserva su precio en puntos. No se cambian los precios ni las existencias originales.",
    quantity: "Cantidad máxima", duration: "Duración (minutos, opcional)", zone: "Zona horaria de la reserva", enabled: "Activar esta oferta", onsite: "Permitir pago en el local",
    policy: "Política de cancelación", advance: "Antelación mínima en minutos", returnPoints: "Devolver los puntos realmente canjeados", returnCoupons: "Devolver los cupones originales al cancelar",
    yes: "Sí", no: "No", decide: "Elige", policyNote: "Se guarda la política al realizar el pedido. Sin devoluciones duplicadas ni ampliación de validez. Los servicios realizados no admiten cancelación del cliente.",
    vouchers: "Vales canjeables por este artículo", vouchersEmpty: "No hay vales válidos para vincular", voucherNote: "Los cupones de importe, descuento y puntos siguen sus condiciones. Vincula aquí los vales de producto, canje y entrada.",
    save: "Guardar ajustes", saved: "Nueva versión guardada", saving: "Guardando…", loading: "Cargando…", failed: "No se pudieron leer los ajustes. Inténtalo de nuevo.", invalid: "Introduce precios, puntos, cantidades y políticas válidos.",
    conflict: "Han cambiado los ajustes o artículos publicados. Se conserva el borrador. Vuelve a leer y revisar antes de guardar.", unknown: "No se ha confirmado el guardado. Vuelve a leer y revisar la oferta original; no la crees otra vez.", denied: "Solo para titulares autorizados del comercio.",
    stale: "Ha cambiado el origen publicado. Revisa y confirma el origen actual antes de guardar.", refreshSource: "Confirmar origen actual", draft: "Sin guardar", unavailable: "El nuevo pago aún no está habilitado.", discard: "¿Descartar los cambios sin guardar?",
    enableNote: "Activar la oferta no activa los cobros. El proceso del cliente requiere validación y activación independientes.", missing: "No hay artículos publicados. Publica un módulo de reservas o configura productos disponibles en el catálogo." },
};
type Draft = { edit: CheckoutConfigurationEdit; cash: string; points: string; quantity: string; duration: string; advance: string; returnPoints: string; returnCoupons: string };
function draftFromOffer(offer: ConfiguredCheckoutOffer): Draft {
  const edit = checkoutEditFromOffer(offer);
  return { edit, cash: edit.cashMinor === null ? "" : (edit.cashMinor / 100).toFixed(2), points: edit.unitPoints === null ? "" : String(edit.unitPoints),
    quantity: String(edit.maxQuantity), duration: edit.durationMinutes === null ? "" : String(edit.durationMinutes), advance: String(edit.cancellationAdvanceMinutes),
    returnPoints: edit.pointsReturnOnCancel ? "yes" : "no", returnCoupons: edit.couponReturnOnCancel ? "yes" : "no" };
}
function readDraft(draft: Draft) {
  if (draft.cash !== "" && !/^\d+(\.\d{1,2})?$/.test(draft.cash) || !["yes", "no"].includes(draft.returnPoints) || !["yes", "no"].includes(draft.returnCoupons)) throw new Error("invalid");
  const integer = (value: string) => { if (!/^\d+$/.test(value)) throw new Error("invalid"); return Number(value); };
  const [whole, fraction = ""] = (draft.cash || "0").split(".");
  return parseCheckoutConfigurationEdit({ ...draft.edit, cashMinor: draft.cash === "" ? null : Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
    unitPoints: draft.points === "" ? null : integer(draft.points), maxQuantity: integer(draft.quantity), durationMinutes: draft.duration === "" ? null : integer(draft.duration),
    cancellationAdvanceMinutes: integer(draft.advance), pointsReturnOnCancel: draft.returnPoints === "yes", couponReturnOnCancel: draft.returnCoupons === "yes" });
}

export function MerchantCheckoutConfigurationPanel({ siteId, locale = "zh-CN", apiClient }: { siteId: string; locale?: string; apiClient?: MerchantBusinessApiClient }) {
  const text = copy[merchantSettlementLanguage(locale)], api = useMemo(() => apiClient ?? createMerchantBusinessApiClient({ authMode: "owner" }), [apiClient]);
  const [snapshot, setSnapshot] = useState<CheckoutConfigurationSnapshot | null>(null), [options, setOptions] = useState<CheckoutConfigurationOptions | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [baseline, setBaseline] = useState(""), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<keyof typeof text | "">(""), [mustReload, setMustReload] = useState(false);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null), savingNow = useRef(false), loadedSite = useRef(siteId);
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;
  const load = useCallback(async (preserve: boolean) => {
    const run = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setMessage("");
    try {
      const response = await api(`/api/merchant-checkout/configuration?siteId=${encodeURIComponent(siteId)}`, { signal: abort.signal, cache: "no-store" });
      const payload = await response.json();
      if (run !== sequence.current || abort.signal.aborted) return;
      if (!response.ok || payload.ok !== true || !payload.snapshot || !payload.options) {
        setMessage(response.status === 401 || response.status === 403 ? "denied" : payload.error === "checkout_disabled" ? "unavailable" : "failed"); return;
      }
      setSnapshot(payload.snapshot); setOptions(payload.options); setMustReload(false);
      if (!preserve) { setDraft(null); setBaseline(""); }
    } catch { if (!abort.signal.aborted && run === sequence.current) setMessage("failed"); }
    finally { if (run === sequence.current) setLoading(false); }
  }, [api, siteId]);
  const cancelPendingRead = useCallback(() => { ++sequence.current; controller.current?.abort(); }, []);
  useEffect(() => { loadedSite.current = siteId; setSnapshot(null); setOptions(null); setDraft(null); setBaseline(""); setMustReload(false); savingNow.current = false; setSaving(false);
    void load(false); return cancelPendingRead; }, [load, siteId, cancelPendingRead]);
  const selectOffer = (offer: ConfiguredCheckoutOffer | null) => {
    if (dirty && !window.confirm(text.discard)) return;
    const next = offer ? draftFromOffer(offer) : null; setDraft(next); setBaseline(JSON.stringify(next)); setMessage("");
  };
  const selectSource = (key: string) => {
    const source = options?.sources.find(row => row.key === key); if (!source) return;
    const next: Draft = { edit: { offerId: null, sourceKey: source.key, sourceVersion: source.sourceVersion, title: source.title, enabled: false,
      cashMinor: source.cashMinor, unitPoints: null, allowOnSite: source.cashMinor !== null, maxQuantity: 1, timeZone: options?.defaultTimeZone || "",
      stockItemId: null, voucherCouponIds: [], durationMinutes: null, pointsReturnOnCancel: false, couponReturnOnCancel: false, cancellationAdvanceMinutes: 0 },
      cash: source.cashMinor === null ? "" : (source.cashMinor / 100).toFixed(2), points: "", quantity: "1", duration: "", advance: "0", returnPoints: "", returnCoupons: "" };
    setDraft(next); setMessage("");
  };
  const update = (value: Partial<Draft>) => setDraft(current => current && ({ ...current, ...value }));
  const updateEdit = (value: Partial<CheckoutConfigurationEdit>) => setDraft(current => current && ({ ...current, edit: { ...current.edit, ...value } }));
  const source = options?.sources.find(row => row.key === draft?.edit.sourceKey), stale = Boolean(draft && (!source || source.sourceVersion !== draft.edit.sourceVersion));
  const zones = useMemo(() => getBookingTimeZoneOptions(locale, options?.countryCode, draft?.edit.timeZone), [locale, options?.countryCode, draft?.edit.timeZone]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!draft || !snapshot || savingNow.current || loading || mustReload || stale) return;
    let edit: CheckoutConfigurationEdit; try { edit = readDraft(draft); } catch { setMessage("invalid"); return; }
    if (!edit.offerId && snapshot.offers.some(offer => offer.checkoutBinding.sourceKey === edit.sourceKey)) { setMessage("conflict"); return; }
    savingNow.current = true; setSaving(true); setMessage(""); const currentSite = siteId, run = sequence.current;
    try {
      const response = await api(`/api/merchant-checkout/configuration?siteId=${encodeURIComponent(siteId)}`, { method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: snapshot.version, edit }) });
      const payload = await response.json(); if (loadedSite.current !== currentSite || run !== sequence.current) return;
      if (!response.ok || payload.ok !== true) {
        if (response.status === 409 || response.status >= 500) setMustReload(true);
        setMessage(response.status === 409 ? "conflict" : response.status >= 500 ? "unknown" : response.status === 403 || response.status === 401 ? "denied" : "invalid"); return;
      }
      const saved = payload.snapshot as CheckoutConfigurationSnapshot;
      const offer = saved.offers.find(row => row.id === edit.offerId || !edit.offerId && row.checkoutBinding.sourceKey === edit.sourceKey);
      if (!offer || !saved.version) throw new Error("unknown");
      const next = draftFromOffer(offer); setSnapshot(saved); setDraft(next); setBaseline(JSON.stringify(next)); setMessage("saved");
    } catch { if (loadedSite.current === currentSite && run === sequence.current) { setMessage("unknown"); setMustReload(true); } }
    finally { if (loadedSite.current === currentSite && run === sequence.current) { savingNow.current = false; setSaving(false); } }
  };
  const field = "min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100";
  const label = "grid min-w-0 gap-1.5 text-sm text-slate-700";
  return <section className="mx-auto w-full max-w-6xl p-4 text-slate-900 sm:p-7" aria-label={text.title}>
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><p translate="no" className="text-xs tracking-widest text-teal-700">FAOLLA · CHECKOUT</p>
      <h1 className="mt-2 text-2xl font-bold">{text.title}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{text.intro}</p></div>
      <button type="button" onClick={() => void load(true)} disabled={loading || saving} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm disabled:opacity-50">{loading ? text.loading : text.reload}</button></header>
    {message && <p role="status" className={`mb-4 rounded-xl border p-3 text-sm leading-6 ${message === "saved" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>{text[message]}</p>}
    {snapshot && options && <div className="grid min-w-0 gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">{text.list}</h2>
        <button type="button" disabled={saving || loading} onClick={() => selectOffer(null)} className="my-3 min-h-11 w-full rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50">+ {text.new}</button>
        {!snapshot.offers.length && <p className="text-sm text-slate-500">{text.empty}</p>}
        <div className="grid gap-2">{snapshot.offers.map(offer => <button key={offer.id} type="button" disabled={saving || loading} onClick={() => selectOffer(offer)}
          aria-pressed={draft?.edit.offerId === offer.id} className={`min-h-14 break-words rounded-xl border p-3 text-left text-sm ${draft?.edit.offerId === offer.id ? "border-teal-500 bg-teal-50" : "border-slate-200"}`}>
          <span className="block font-medium">{offer.title}</span><span className="text-xs text-slate-500">{offer.checkoutBinding.viewport === "mobile" ? text.mobile : text.desktop} · {offer.enabled ? text.yes : text.no}</span></button>)}</div>
      </aside>
      <form onSubmit={event => void save(event)} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <fieldset disabled={saving || loading} className="min-w-0 space-y-5">
          <label className={label}>{text.source}<select aria-label={text.source} className={field} value={draft?.edit.sourceKey ?? ""} disabled={Boolean(draft?.edit.offerId) || saving || loading} onChange={event => selectSource(event.target.value)}>
            <option value="">{text.select}</option>{options.sources.map(row => <option key={row.key} value={row.key}>{row.kind === "booking" ? text.booking : text.order} · {row.viewport === "mobile" ? text.mobile : text.desktop} · {row.title}</option>)}</select></label>
          {!options.sources.length && <p className="text-sm leading-6 text-slate-500">{text.missing}</p>}
          {draft && <>
            {stale && <div role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{text.stale}{source && <button type="button" className="ml-2 underline" onClick={() => updateEdit({ sourceVersion: source.sourceVersion })}>{text.refreshSource}</button>}</div>}
            <label className={label}>{text.titleField}<input aria-label={text.titleField} className={field} maxLength={200} value={draft.edit.title} onChange={event => updateEdit({ title: event.target.value })}/></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className={label}>{text.cash}<input aria-label={text.cash} className={field} inputMode="decimal" value={draft.cash} disabled={source?.kind === "order" || saving || loading} onChange={event => update({ cash: event.target.value })}/></label>
              <label className={label}>{text.points}<input aria-label={text.points} className={field} inputMode="numeric" disabled={Boolean(draft.edit.stockItemId) || options.canPoints === false || saving || loading} value={draft.points} onChange={event => update({ points: event.target.value })}/></label></div>
            <label className={label}>{text.stock}<select aria-label={text.stock} className={field} value={draft.edit.stockItemId ?? ""} onChange={event => { const item = options.stockItems.find(row => row.id === event.target.value); updateEdit({ stockItemId: item?.id ?? null }); if (item) update({ points: item.points === null ? "" : String(item.points) }); }}>
              <option value="">{text.none}</option>{options.stockItems.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <p className="text-xs leading-5 text-slate-500">{text.priceNote}</p>
            <div className="grid gap-4 sm:grid-cols-2"><label className={label}>{text.quantity}<input aria-label={text.quantity} className={field} inputMode="numeric" value={draft.quantity} onChange={event => update({ quantity: event.target.value })}/></label>
              <label className={label}>{text.duration}<input aria-label={text.duration} className={field} inputMode="numeric" value={draft.duration} onChange={event => update({ duration: event.target.value })}/></label></div>
            {source?.kind === "booking" && <label className={label}>{text.zone}<select aria-label={text.zone} className={field} value={draft.edit.timeZone} onChange={event => updateEdit({ timeZone: event.target.value })}>
              <option value="">{text.decide}</option>{zones.map(zone => <option key={zone.value} value={zone.value}>{zone.label}</option>)}</select></label>}
            <div className="grid gap-3 rounded-xl bg-sky-50 p-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.edit.allowOnSite} onChange={event => updateEdit({ allowOnSite: event.target.checked })}/>{text.onsite}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.edit.enabled} onChange={event => updateEdit({ enabled: event.target.checked })}/>{text.enabled}</label><p className="text-xs leading-5 text-slate-600">{text.enableNote}</p></div>
            <section className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4"><h2 className="font-semibold">{text.policy}</h2>
              <label className={label}>{text.advance}<input aria-label={text.advance} className={field} inputMode="numeric" value={draft.advance} onChange={event => update({ advance: event.target.value })}/></label>
              <div className="grid gap-4 sm:grid-cols-2">{(["returnPoints", "returnCoupons"] as const).map(key => <label key={key} className={label}>{text[key]}<select aria-label={text[key]} className={field} value={draft[key]} onChange={event => update({ [key]: event.target.value })}>
                <option value="">{text.decide}</option><option value="yes">{text.yes}</option><option value="no">{text.no}</option></select></label>)}</div><p className="text-xs leading-5 text-slate-600">{text.policyNote}</p></section>
            <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4"><h2 className="font-semibold">{text.vouchers}</h2>
              {!options.vouchers.length && <p className="text-sm text-slate-500">{text.vouchersEmpty}</p>}
              {options.vouchers.filter(voucher => source?.kind === "order" ? voucher.kind === "product_voucher" : voucher.kind !== "product_voucher").map(voucher => <label key={voucher.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.edit.voucherCouponIds.includes(voucher.id)} onChange={event => updateEdit({ voucherCouponIds: event.target.checked ? [...draft.edit.voucherCouponIds, voucher.id] : draft.edit.voucherCouponIds.filter(id => id !== voucher.id) })}/>{voucher.title}</label>)}
              <p className="text-xs leading-5 text-slate-600">{text.voucherNote}</p></section>
            <div className="flex items-center gap-3"><button type="submit" disabled={saving || loading || mustReload || stale} className="min-h-12 flex-1 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{saving ? text.saving : text.save}</button>
              {dirty && <span className="text-xs text-amber-800">{text.draft}</span>}</div>
          </>}
        </fieldset>
      </form>
    </div>}
  </section>;
}
