"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createCheckoutClientController, type CheckoutClientSelection, type CheckoutCustomerDraft } from "@/lib/merchantCheckoutClient";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { MerchantCheckoutCouponPicker } from "./MerchantCheckoutCouponPicker";
import { MerchantSettlementBadge } from "./MerchantSettlementBadge";
import BookingDateTimeInput from "@/components/booking/BookingDateTimeInput";
import { createIntentPointsCheckoutController } from "@/lib/merchantCheckoutSingleIntentClient";
import { SingleCheckoutOriginalReview } from "./SingleCheckoutOriginalReview";

const copy = {
  zh: { heading: "会员预约与商品兑换", intro: "先核对项目、可用积分和券；确认后一次完成建单与兑换。", quantity: "数量", appointment: "预约日期与时间", timeNote: "按商户时区填写，报价后会显示商户时区；不按手机时区换算。", quote: "核对积分与券", working: "正在核对…", name: "姓名", title: "称呼", email: "联系邮箱", phone: "联系电话", note: "备注", choose: "请选择", points: "本次兑换积分", balance: "可用积分", after: "兑换后剩余", confirm: "确认兑换并提交", submit: "正在提交…", unavailable: "当前不能使用积分兑换。可检查有效会员身份、积分和所选券。", unknown: "原单结果尚未确认。请核对原单，不要重复提交；刷新后仍保留本次编号。", recover: "核对原单", done: "兑换已确认", details: "查看原单与取消规则", another: "已核对，开始另一单", other: "本设备其他页面有结算操作，请先核对原单。", storage: "浏览器暂时无法可靠保存原单编号，已暂停提交。请保留本页并检查浏览器存储设置。", unsupported: "此浏览器暂不支持安全的跨标签页提交保护，请使用更新的浏览器。", failed: "暂时无法完成，请重新核对。", changed: "项目、价格、积分、券或时段已变化，本次未扣减。请重新核对后确认。", login: "请先登录，核对本人的会员积分和券。", loginButton: "用户登录", rule: "付款／兑换不代表预约已确认或服务已完成。", return: "取消时按原单规则退回原券，有效期不延长。", keep: "本项目取消后不退券。", selected: "已选择", item: "项目", zone: "商户时区", invalid: "请填写姓名、有效邮箱、电话和预约称呼；姓名最多 40 字节，备注最多 100 字节。" },
  en: { heading: "Member booking & product redemption", intro: "Review your item, points and coupons before submitting one combined checkout.", quantity: "Quantity", appointment: "Booking date and time", timeNote: "Use the merchant's local time, shown after the quote. Do not convert it to your device time zone.", quote: "Review points & coupons", working: "Checking…", name: "Name", title: "Title", email: "Contact email", phone: "Phone", note: "Note", choose: "Choose", points: "Points to redeem", balance: "Available points", after: "Points remaining", confirm: "Confirm redemption & submit", submit: "Submitting…", unavailable: "Points redemption is unavailable. Check membership, points and selected coupons.", unknown: "The original checkout is unconfirmed. Check it; do not submit again. Its reference is kept after refresh.", recover: "Check original checkout", done: "Redemption confirmed", details: "Original checkout & cancellation policy", another: "Reviewed — start another", other: "Another page on this device has a checkout. Check the original first.", storage: "The browser cannot reliably save the checkout reference. Submission is paused. Keep this page and check browser storage settings.", unsupported: "This browser lacks safe cross-tab submission protection. Please use an updated browser.", failed: "This could not be completed. Please review again.", changed: "The item, price, points, coupon or slot changed. This attempt made no deduction. Review before confirming again.", login: "Sign in to review your own member points and coupons.", loginButton: "Sign in", rule: "Payment/redemption does not confirm a booking or complete a service.", return: "Cancellation returns the original coupon under its policy, without extending validity.", keep: "Coupons are not returned on cancellation for this item.", selected: "Selected", item: "Item", zone: "Merchant time zone", invalid: "Enter name, valid email, phone and booking title. Name: up to 40 UTF-8 bytes; note: 100 bytes." },
  es: { heading: "Reservas y canjes de socios", intro: "Revisa el artículo, los puntos y los cupones antes de confirmar un único canje.", quantity: "Cantidad", appointment: "Fecha y hora de la reserva", timeNote: "Usa la hora local del comercio, que se muestra tras consultar. No la conviertas a la zona del móvil.", quote: "Revisar puntos y cupones", working: "Comprobando…", name: "Nombre", title: "Tratamiento", email: "Correo de contacto", phone: "Teléfono", note: "Nota", choose: "Elige", points: "Puntos a canjear", balance: "Puntos disponibles", after: "Puntos restantes", confirm: "Confirmar canje y enviar", submit: "Enviando…", unavailable: "El canje no está disponible. Revisa tu membresía, puntos y cupones.", unknown: "El pedido original aún no está confirmado. Consúltalo, no lo envíes otra vez. La referencia se conserva al actualizar.", recover: "Consultar pedido original", done: "Canje confirmado", details: "Pedido original y política de cancelación", another: "Revisado — empezar otro", other: "Otra página de este dispositivo tiene un canje. Consulta primero el original.", storage: "El navegador no puede guardar la referencia de forma fiable. El envío está pausado. Conserva la página y revisa el almacenamiento del navegador.", unsupported: "Este navegador no permite proteger el envío entre pestañas. Utiliza un navegador actualizado.", failed: "No se pudo completar. Vuelve a revisar.", changed: "Han cambiado el artículo, precio, puntos, cupón u horario. Este intento no descontó nada. Revisa antes de confirmar de nuevo.", login: "Inicia sesión para consultar tus puntos y cupones de socio.", loginButton: "Iniciar sesión", rule: "El pago o canje no confirma la reserva ni completa el servicio.", return: "Al cancelar se devuelve el cupón original según su política, sin ampliar su validez.", keep: "Los cupones no se devuelven al cancelar este artículo.", selected: "Seleccionado", item: "Artículo", zone: "Zona del comercio", invalid: "Introduce nombre, correo válido, teléfono y tratamiento. Nombre: hasta 40 bytes UTF-8; nota: 100 bytes." },
};
const blankCustomer = (): CheckoutCustomerDraft => ({ name: "", title: "", email: "", phone: "", note: "" });
const policyCopy = {
  zh: { title: "取消规则", pointsReturn: "按原单规则退回本单实际扣除的积分。", pointsKeep: "本项目取消后不退积分。", advance: "允许自助取消时，至少提前", minutes: "分钟申请。" },
  en: { title: "Cancellation policy", pointsReturn: "Return the points actually debited under the original policy.", pointsKeep: "Points are not returned on cancellation for this item.", advance: "Where self-service cancellation is allowed, give at least", minutes: "minutes' notice." },
  es: { title: "Política de cancelación", pointsReturn: "Devolver los puntos realmente canjeados según la política original.", pointsKeep: "No se devuelven los puntos al cancelar este artículo.", advance: "Si se permite cancelar, solicita la cancelación con al menos", minutes: "minutos de antelación." },
};
const inputClass = "min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";
const buttonClass = "min-h-12 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-50";
export function MemberCheckoutStartPanel({ siteId, accountId, initialSelection, locale = "zh-CN", loginHref = "/login", controllerFactory = createCheckoutClientController, intentEnabled = false }: {
  siteId: string; accountId: string | null; initialSelection: Omit<CheckoutClientSelection, "siteId" | "couponClaims">; locale?: string; loginHref?: string;
  controllerFactory?: typeof createCheckoutClientController; intentEnabled?: boolean;
}) {
  const text = copy[merchantSettlementLanguage(locale)];
  if (!accountId) return <section className="mx-auto max-w-3xl space-y-4 p-5"><h1 className="text-2xl font-bold">{text.heading}</h1><p>{text.login}</p><a href={loginHref} className={buttonClass + " inline-block"}>{text.loginButton}</a></section>;
  return <ActivePanel key={JSON.stringify([siteId, accountId, initialSelection.offerId, initialSelection.offerRevision, initialSelection.quantity, initialSelection.appointmentAt ?? null])}
    siteId={siteId} accountId={accountId} initialSelection={initialSelection} locale={locale} controllerFactory={intentEnabled ? createIntentPointsCheckoutController : controllerFactory}/>;
}
function ActivePanel({ siteId, accountId, initialSelection, locale, controllerFactory }: {
  siteId: string; accountId: string; initialSelection: Omit<CheckoutClientSelection, "siteId" | "couponClaims">; locale: string; controllerFactory: typeof createCheckoutClientController;
}) {
  const text = copy[merchantSettlementLanguage(locale)], controller = useMemo(() => controllerFactory({ siteId, accountId }), [siteId, accountId, controllerFactory]);
  const policy = policyCopy[merchantSettlementLanguage(locale)];
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [customer, setCustomer] = useState(blankCustomer), [invalid, setInvalid] = useState(false);
  const [draft, setDraft] = useState<CheckoutClientSelection>({ ...initialSelection, siteId, couponClaims: [] });
  const busy = ["quoting", "submitting", "recovering"].includes(state.phase), frozen = busy || state.pending;
  const quote = state.quote, result = state.result;
  useEffect(() => {
    void controller.activate();
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === controller.storageKey) void controller.recover(); };
    window.addEventListener("storage", storage); return () => { window.removeEventListener("storage", storage); controller.deactivate(); };
  }, [controller]);
  const preview = (selection = draft) => { setInvalid(false); void controller.preview(selection); };
  const submit = () => {
    const cleaned = Object.fromEntries(Object.entries(customer).map(([key, value]) => [key, value.trim()])) as CheckoutCustomerDraft;
    const bytes = (value: string) => new TextEncoder().encode(value).length;
    if (!cleaned.name || bytes(cleaned.name) > 40 || bytes(cleaned.note) > 100 || !cleaned.phone || bytes(cleaned.phone) > 80
      || bytes(cleaned.email) > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned.email) || quote?.bookingForm && !quote.bookingForm.titles.includes(cleaned.title)) { setInvalid(true); return; }
    setInvalid(false); void controller.submit(cleaned);
  };
  const needsReview = state.error && ["checkout_conflict", "checkout_quote_changed", "checkout_quote_expired", "checkout_source_changed", "checkout_slot_unavailable", "checkout_quantity_unavailable", "checkout_coupon_unavailable"].includes(state.error);
  const message = state.originalReview ? state.error ? text.failed : "" : state.error === "checkout_storage_unavailable" ? text.storage : state.error === "checkout_browser_unsupported" ? text.unsupported
    : state.error === "checkout_other_tab" ? text.other : state.pending ? text.unknown : needsReview ? text.changed : state.error ? text.failed : "";
  const customerField = (key: keyof CheckoutCustomerDraft, type = "text") => <label className="min-w-0 space-y-1 text-sm"><span>{text[key]}</span><input type={type} aria-label={text[key]} className={inputClass} value={customer[key]} disabled={frozen}
    onChange={event => setCustomer(value => ({ ...value, [key]: event.target.value }))} autoComplete={key === "name" ? "name" : key === "email" ? "email" : key === "phone" ? "tel" : "off"}/></label>;
  return <section className="mx-auto max-w-3xl space-y-5 p-4 text-slate-900 sm:p-7" aria-label={text.heading}>
    <header><p className="text-xs font-semibold tracking-widest text-teal-700">FAOLLA · MEMBER CHECKOUT</p><h1 className="mt-2 text-2xl font-bold">{text.heading}</h1><p className="mt-2 text-sm leading-6 text-slate-600">{text.intro}</p></header>
    {message && <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">{message}</p>}
    {busy && <p role="status" className="text-sm text-slate-600">{state.phase === "submitting" ? text.submit : text.working}</p>}
    {state.pending && !result && !state.originalReview && <button type="button" className={buttonClass} disabled={busy} onClick={() => void controller.recover()}>{text.recover}</button>}
    {state.originalReview ? <SingleCheckoutOriginalReview siteId={siteId} original={state.originalReview} reviewRequired={state.intentReviewRequired === true} busy={busy} locale={locale} onRead={() => void controller.recover()}
      onAnother={() => void controller.startAnother().then(() => { if (controller.getSnapshot().phase === "idle") { setCustomer(blankCustomer()); setDraft({ ...initialSelection, siteId, couponClaims: [] }); } })}/>
      : result ? <article className="space-y-4 rounded-3xl border border-teal-100 bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">{text.done}</h2>
      <p className="break-all text-sm text-slate-600">{result.resourceId}</p><MerchantSettlementBadge locale={locale} showDetails snapshot={{ version: 1, method: "points", closed: result.closed, totalPoints: result.totalPoints, debitedPoints: result.totalPoints,
        returnedPoints: result.cancellation?.pointsReturned ?? 0, returnPending: false, ...(result.couponCount ? { coupons: { redeemedCount: result.couponCount, returnedCount: result.cancellation?.couponsReturned ?? 0, returnPending: false } } : {}) }}/>
      <a href={`/member-checkout/${siteId}/${result.operationKey}?uiLocale=${encodeURIComponent(locale)}`} className={buttonClass + " block text-center"}>{text.details}</a>
      <button type="button" className={buttonClass + " w-full"} disabled={busy} onClick={() => { void controller.startAnother().then(() => { if (controller.getSnapshot().phase === "idle") { setCustomer(blankCustomer()); setDraft({ ...initialSelection, siteId, couponClaims: [] }); } }); }}>{text.another}</button>
    </article> : !state.pending && <>
      <fieldset disabled={frozen} className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-5 sm:grid-cols-2"><label className="space-y-1 text-sm"><span>{text.quantity}</span>
        <input aria-label={text.quantity} type="number" min="1" max="999" className={inputClass} value={draft.quantity} onChange={event => { if (frozen) return; controller.edit(); setDraft(value => ({ ...value, quantity: Number(event.target.value), couponClaims: [] })); }}/></label>
        {initialSelection.appointmentAt !== undefined && <div role="group" aria-label={text.appointment} className="space-y-1 text-sm sm:col-span-2"><p>{text.appointment}</p>
          <BookingDateTimeInput dateValue={(draft.appointmentAt ?? "").split("T")[0]} timeValue={(draft.appointmentAt ?? "").split("T")[1] ?? ""} disabled={frozen}
            dateInputClassName={inputClass} timeInputClassName={`${inputClass} flex-1`} onDateChange={date => { if (frozen) return; controller.edit(); setDraft(value => ({ ...value, appointmentAt: `${date}T${(value.appointmentAt ?? "").split("T")[1] ?? ""}`, couponClaims: [] })); }}
            onTimeChange={time => { if (frozen) return; controller.edit(); setDraft(value => ({ ...value, appointmentAt: `${(value.appointmentAt ?? "").split("T")[0]}T${time}`, couponClaims: [] })); }}/>
          <p className="text-xs leading-5 text-slate-500">{text.timeNote}</p></div>}
        <button type="button" className={buttonClass + " sm:col-span-2"} onClick={() => preview()}>{text.quote}</button>
      </fieldset>
      {quote && <><article className="rounded-3xl border border-teal-100 bg-teal-50/60 p-5"><h2 className="text-lg font-semibold">{quote.title} × {quote.quantity}</h2>
        {quote.bookingForm && <p className="mt-2 text-sm leading-6 text-slate-600">{quote.bookingForm.store} · {quote.bookingForm.item}<br/>{text.zone}: {quote.bookingForm.timeZone}</p>}
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">{[[text.points, quote.points], [text.balance, quote.balance], [text.after, quote.balance !== null && quote.points !== null && quote.balance >= quote.points ? quote.balance - quote.points : null]].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-white p-3"><dt className="text-xs text-slate-600">{label}</dt><dd className="mt-1 text-xl font-bold">{value ?? "—"}</dd></div>)}</dl>
        {!quote.available && <p className="mt-3 text-sm text-amber-900">{text.unavailable}</p>}
        <MerchantCheckoutCouponPicker locale={locale} choices={quote.coupons} selected={draft.couponClaims ?? []} busy={frozen} onChange={claims => { const next = { ...draft, couponClaims: claims }; setDraft(next); preview(next); }}/>
        <div className="mt-4 space-y-1 border-t border-teal-100 pt-4 text-xs leading-5 text-slate-600"><h3 className="font-semibold text-slate-900">{policy.title}</h3>
          <p>{quote.cancellation.returnPoints ? policy.pointsReturn : policy.pointsKeep}</p>
          {(draft.couponClaims?.length ?? 0) > 0 && <p>{quote.cancellation.returnCoupons ? text.return : text.keep}</p>}
          {quote.kind === "booking" && <p>{policy.advance} {quote.cancellation.advanceMinutes} {policy.minutes}</p>}
        </div>
      </article>
      <fieldset disabled={frozen} className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        {customerField("name")}{quote.bookingForm ? <label className="space-y-1 text-sm"><span>{text.title}</span><select aria-label={text.title} className={inputClass} value={customer.title} onChange={event => setCustomer(value => ({ ...value, title: event.target.value }))}>
          <option value="">{text.choose}</option>{quote.bookingForm.titles.map(title => <option key={title} value={title}>{title}</option>)}</select></label> : customerField("title")}
        {customerField("email", "email")}{customerField("phone", "tel")}<label className="space-y-1 text-sm sm:col-span-2"><span>{text.note}</span><textarea aria-label={text.note} className={inputClass} value={customer.note} onChange={event => setCustomer(value => ({ ...value, note: event.target.value }))}/></label>
      </fieldset>
      {invalid && <p role="alert" className="text-sm leading-6 text-rose-700">{text.invalid}</p>}
      <p className="text-xs leading-5 text-slate-500">{text.rule}</p>
      <button type="button" className={buttonClass + " w-full !border-teal-700 !bg-teal-700 !text-white"} disabled={frozen || !quote.available || state.phase !== "ready"} onClick={submit}>{text.confirm}</button>
      </>}
    </>}
  </section>;
}
