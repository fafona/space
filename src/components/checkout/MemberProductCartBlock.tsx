"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ProductBlock, { type ProductBlockProps } from "../blocks/ProductBlock";
import { useI18n } from "../I18nProvider";
import { SERVICE_IDENTITY_CHANGED } from "../service-center/serviceCenterClient";
import { parseCheckoutEntryDiscovery, type CheckoutEntryAccess } from "@/lib/merchantCheckoutEntry";
import { checkoutClientStorageKey } from "@/lib/merchantCheckoutClient";
import { productCartCheckoutSelection } from "@/lib/merchantCheckoutProductCart";
import type { ProductCartCheckoutAdapter, ProductCartCheckoutHost } from "./ProductCartCheckoutAdapter";
import { MemberCartCheckoutPanel } from "./MemberCartCheckoutPanel";
import { createAccountCartDraft, type AccountCartDraft } from "@/lib/merchantCheckoutAccountDraft";
import { MemberCheckoutRecoveryLink } from "./MemberCheckoutRecoveryLink";
import { MemberCheckoutLegacyReview } from "./MemberCheckoutLegacyReview";
import { createLegacyCartHandoff } from "@/lib/merchantCheckoutLegacyHandoff";
const noSubscribe = () => () => {};
const noSnapshot = () => null;
const ownedCopy = {
  zh: { isolated: "按当前账号独立保存。旧共享购物车仍保留，不会自动导入商品或联系方式。", failed: "购物车尚未可靠保存或已在另一页面变化。请重新核验；未提交新订单。" },
  en: { isolated: "Saved separately for this account. The old shared cart remains untouched; products and contacts are not imported.", failed: "The cart could not be saved reliably or changed elsewhere. Recheck; no new order was submitted." },
  es: { isolated: "Guardado por cuenta. El carrito compartido anterior se conserva; no se importan productos ni contactos.", failed: "No se pudo guardar con seguridad o cambió en otra página. Verifica; no se envió un pedido nuevo." },
};
const texts = {
  zh: { loading: "正在核验会员结算入口…", failed: "暂时无法核验结算入口。购物车和联系人已保留，请重新核验，不要在其他入口重复提交。", retry: "重新核验", begin: "核对会员积分与券", missing: "请勾选已开通会员结算的商品；全部所选商品必须有唯一有效绑定，不能漏掉其中一项。", legacy: "购物车保留着原普通订单编号，请先核对该订单，不能另建会员结算。", kept: "已核对原单。联系人与未提交商品保留在购物车中。", stale: "身份或另一页面的结算状态已变化，请重新核验。" },
  en: { loading: "Checking member checkout…", failed: "Checkout could not be verified. The cart and contacts are preserved. Recheck; do not submit elsewhere.", retry: "Recheck", begin: "Review member points & coupons", missing: "Select eligible products. Every selected product needs exactly one valid binding; no item can be omitted.", legacy: "An original regular-order ID is retained. Check that order before starting member checkout.", kept: "Original checked. Contacts and unsubmitted products remain in the cart.", stale: "Identity or checkout changed in another page. Recheck." },
  es: { loading: "Verificando pago de socio…", failed: "No se pudo verificar. Se conservan el carrito y los datos de contacto. Revisa; no envíes desde otra entrada.", retry: "Verificar", begin: "Revisar puntos y cupones", missing: "Selecciona productos habilitados. Cada producto debe tener un único enlace válido; no se omite ningún artículo.", legacy: "Se conserva el identificador de un pedido normal. Compruébalo antes de iniciar otro pago.", kept: "Original verificado. Se conservan los contactos y productos no enviados.", stale: "Ha cambiado la identidad o el pago en otra página. Vuelve a verificar." },
};
/** Only mounted by a server-authored independent UI gate. No production flag
 * is enabled by this component. Ordinary ProductBlock is untouched when off. */
export default function MemberProductCartBlock(props: ProductBlockProps) {
  const { locale } = useI18n(), t = texts[locale.startsWith("zh") ? "zh" : locale.startsWith("es") ? "es" : "en"];
  const query = useMemo(() => ({ siteId: props.runtimeSiteId ?? "", kind: "order" as const, blockId: props.runtimeBlockId ?? "", viewport: props.runtimeCatalogViewport === "mobile" ? "mobile" as const : "desktop" as const }), [props.runtimeSiteId, props.runtimeBlockId, props.runtimeCatalogViewport]);
  const scope = JSON.stringify(query), [loaded, setLoaded] = useState<{ scope: string; access: CheckoutEntryAccess | null; recoveryEnabled: boolean; intent: boolean; owned: boolean; legacy: boolean; handoff: boolean; retained: boolean; unused: boolean } | null>(null), [failed, setFailed] = useState(false);
  const [active, setActive] = useState(false), [notice, setNotice] = useState(false), [revision, setRevision] = useState(0);
  const lock = useRef(true), generation = useRef(0), capture = useRef<{ host: ProductCartCheckoutHost; customer: ProductCartCheckoutHost["customer"]; raw: string | null; fresh: boolean; selection: ReturnType<typeof productCartCheckoutSelection> } | null>(null);
  const setLocked = useCallback((value: boolean) => { lock.current = value; }, []);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const owned = useMemo(() => loaded?.scope === scope && loaded.owned && loaded.access
    ? createAccountCartDraft({ siteId: query.siteId, blockId: query.blockId, accountId: loaded.access.accountId }, loaded.handoff ? {
      legacyHandoff: createLegacyCartHandoff({ siteId: query.siteId, blockId: query.blockId, accountId: loaded.access.accountId }),
      retainFinancialNonceOnHandoff: loaded.intent === true,
    } : {}) : null, [loaded, query, scope]);
  const ownedRef = useRef<AccountCartDraft | null>(null); ownedRef.current = owned;
  const ownedState = useSyncExternalStore(owned?.subscribe ?? noSubscribe, owned?.getSnapshot ?? noSnapshot, noSnapshot);
  useEffect(() => { void owned?.activate(); return () => owned?.deactivate(); }, [owned]);
  useEffect(() => {
    let disposed = false, abort: AbortController | null = null;
    const clear = () => { ownedRef.current?.deactivate(); generation.current++; abort?.abort(); setLocked(true); setLoaded(null); setActive(false); capture.current = null; setNotice(false); setFailed(true); };
    const load = async () => { clear(); setFailed(false); if (document.visibilityState === "hidden") return;
      const run = generation.current, owned = new AbortController(); abort = owned;
      const timeout = setTimeout(() => owned.abort(), 13_000);
      try { const response = await fetch("/api/member-checkout/cart/entry", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: scope, signal: owned.signal });
        if (!response.ok) throw new Error("unavailable"); const body = await response.json(), discovery = parseCheckoutEntryDiscovery(body, query), access = discovery.access;
        if (disposed || owned.signal.aborted || run !== generation.current) return;
        // A retained nonce keeps all existing cart data frozen even before the
        // original read completes. Malformed/blocked storage never means clear.
        const pending = access ? window.localStorage.getItem(checkoutClientStorageKey(query.siteId, access.accountId)) !== null : false;
        if (body.ownedDraft === true && body.intent !== true) throw new Error("unavailable");
        if (body.unusedReference === true && (body.ownedDraft !== true || body.intent !== true)) throw new Error("unavailable");
        setLocked(pending); setLoaded({ scope, access, recoveryEnabled: discovery.recoveryEnabled, intent: body.intent === true, owned: body.ownedDraft === true,
          retained: !!access && body.intent === true && body.ownedDraft === true && body.retainedIntent === true,
          unused: !!access && body.intent === true && body.ownedDraft === true && body.unusedReference === true,
          legacy: !!access && body.intent === true && body.ownedDraft === true && body.legacyReview === true,
          handoff: !!access && body.intent === true && body.ownedDraft === true && body.legacyReview === true && body.legacyHandoff === true });
      } catch { if (!disposed && run === generation.current) { setFailed(true); setLocked(true); } }
      finally { clearTimeout(timeout); }
    };
    const visible = () => document.visibilityState === "hidden" ? clear() : void load();
    const storage = (e: StorageEvent) => { if (e.key === null || /auth|account|session/.test(e.key ?? "") || e.key?.startsWith(`faolla-member-checkout-v2:${query.siteId}:`) || e.key?.startsWith(`merchant-space:product-cart:v1:${query.siteId}:`) || e.key === ownedRef.current?.storageKey || e.key === ownedRef.current?.handoffStorageKey) clear(); };
    void load(); window.addEventListener(SERVICE_IDENTITY_CHANGED, load); window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; invalidate(); abort?.abort(); window.removeEventListener(SERVICE_IDENTITY_CHANGED, load); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visible); };
  }, [invalidate, query, revision, scope, setLocked]);
  const access = loaded?.scope === scope ? loaded.access : null;
  const adapter: ProductCartCheckoutAdapter | undefined = loaded?.scope === scope && !access ? undefined : {
    ...(loaded?.scope === scope && !loaded.owned ? {} : { ownedDraft: owned }),
    isLocked: () => lock.current || !!owned && (!owned.getSnapshot().ready || owned.getSnapshot().busy || !!loaded?.handoff && owned.getSnapshot().legacyPending),
    render: host => {
      const button = "min-h-11 rounded-xl border border-teal-200 bg-white px-4 py-2 text-sm font-semibold text-teal-900";
      const retry = <button type="button" className={button} onClick={() => setRevision(v => v + 1)}>{t.retry}</button>;
      if (!access) return <div data-cart-member-entry className="shrink-0 space-y-3 border-t bg-slate-50 p-4 text-sm"><p role="status">{failed ? t.failed : t.loading}</p>{failed && retry}</div>;
      const ot = ownedCopy[locale.startsWith("zh") ? "zh" : locale.startsWith("es") ? "es" : "en"];
      if (owned && (!ownedState?.ready || ownedState.busy)) return <div data-cart-member-entry data-cart-draft-error={ownedState?.error || undefined} className="space-y-3 border-t p-4 text-sm"><p role="status">{ownedState?.error ? ot.failed : t.loading}</p>{ownedState?.error && retry}</div>;
      const pending = lock.current && !active;
      const begin = () => {
        try {
          if (owned && (!owned.getSnapshot().ready || owned.getSnapshot().busy || owned.getSnapshot().legacyPending)) throw new Error("legacy");
          const raw = window.localStorage.getItem(host.storageKey), key = checkoutClientStorageKey(query.siteId, access.accountId), originalPending = window.localStorage.getItem(key) !== null;
          if (raw !== host.serializedDraft) throw new Error("checkout_cart_changed");
          if (host.clientRequestId && !originalPending) throw new Error("legacy");
          let selection;
          try { selection = productCartCheckoutSelection(query.siteId, access, host.items); }
          catch { if (!originalPending && !loaded?.intent) throw new Error("missing"); selection = { siteId: query.siteId, method: "points" as const, lines: [] }; }
          capture.current = { host, customer: host.customer, raw, fresh: !originalPending, selection }; setLocked(true); setActive(true); setNotice(false); setFailed(false);
        } catch { setNotice(false); setFailed(true); }
      };
      const captured = active ? capture.current : null;
      return <div data-cart-member-entry className="max-h-[65dvh] shrink-0 overflow-y-auto border-t border-teal-100 bg-slate-50 p-3 text-slate-900 sm:p-5">
        {ownedState?.legacyPresent && <p className="mb-3 text-xs text-slate-500">{ot.isolated}</p>}
        {ownedState?.legacyPending ? <p role="alert">{t.legacy}</p> : null}
        {!captured ? <div className="space-y-3 text-sm">{notice && <p role="status">{t.kept}</p>}{host.clientRequestId && !pending ? <p role="alert">{t.legacy}</p> : <button type="button" className={button} disabled={!!loaded?.handoff && !!ownedState?.legacyPending && !pending} onClick={begin}>{pending ? t.retry : t.begin}</button>}
          {failed && <><p role="alert">{t.missing}</p>{retry}</>}</div>
          : <MemberCartCheckoutPanel siteId={query.siteId} accountId={access.accountId} initialSelection={captured.selection} initialCustomer={captured.host.customer} locale={locale}
            intentEnabled={loaded?.intent} retainedIntentEnabled={loaded?.retained} unusedReferenceEnabled={loaded?.unused} prepareInsideLock={!!owned} allowNewCheckout={captured.fresh && captured.selection.lines.length > 0}
            beforeSubmit={async (customer, lease) => { captured.raw = await captured.host.persist(captured.raw, customer, undefined, lease); captured.customer = customer; }}
            beforeRelease={async (original, context) => { captured.raw = await captured.host.persist(captured.raw, captured.customer, { selection: captured.selection, original, fresh: captured.fresh && (!loaded?.intent || context.createdHere) }, context.lease); }}
            verifyBeforeRelease={owned ? lease => owned.verify(captured.raw, lease) : undefined}
            onReturnToCart={() => { if (window.localStorage.getItem(checkoutClientStorageKey(query.siteId, access.accountId)) !== null) throw new Error("checkout_cart_changed");
              capture.current = null; setActive(false); setLocked(false); }}
            onUnusedReleased={() => { capture.current = null; setActive(false); setLocked(false); setNotice(false); }}
            onReleased={() => { capture.current = null; setActive(false); setLocked(false); setNotice(true); }}/>}
      </div>;
    },
  };
  return <ProductBlock key={loaded?.scope === scope ? owned?.storageKey ?? `legacy:${access?.accountId ?? "guest"}` : "unresolved"} {...props} runtimeCheckoutAdapter={adapter}
    runtimeCheckoutRecoveryEntry={loaded?.scope === scope ? <>
      {loaded.recoveryEnabled && <MemberCheckoutRecoveryLink siteId={query.siteId} locale={locale}/>}
      {loaded.handoff && ownedState?.legacyPending && lock.current && <p data-dual-original-handoff className="shrink-0 border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-slate-600">{locale.startsWith("zh") ? "先核对并隔离旧普通订单，结算原编号仍保留，之后需单独核对结算原单。这里不会新建、取消或确认付款。" : locale.startsWith("es") ? "Revisa y separa el pedido normal anterior. Se conserva la referencia de pago, que se revisará por separado. No crea, cancela ni confirma pagos." : "Review and isolate the old regular order first. The checkout reference stays and must be reviewed separately. No order is created, cancelled or marked paid here."}</p>}
      {loaded.legacy && access && !active && <MemberCheckoutLegacyReview siteId={query.siteId} blockId={query.blockId} accountId={access.accountId} locale={locale}
        onIsolate={loaded.handoff && owned && ownedState?.ready && ownedState.legacyPending && !active && (!lock.current || ownedState.raw !== null) ? (review, confirmed) => owned.confirmLegacyHandoff(review, confirmed) : undefined}/>}
    </> : undefined}/>;
}
