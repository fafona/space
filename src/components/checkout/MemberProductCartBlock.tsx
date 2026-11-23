"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProductBlock, { type ProductBlockProps } from "../blocks/ProductBlock";
import { useI18n } from "../I18nProvider";
import { SERVICE_IDENTITY_CHANGED } from "../service-center/serviceCenterClient";
import { parseCheckoutEntryAccess, type CheckoutEntryAccess } from "@/lib/merchantCheckoutEntry";
import { checkoutClientStorageKey } from "@/lib/merchantCheckoutClient";
import { productCartCheckoutSelection } from "@/lib/merchantCheckoutProductCart";
import type { ProductCartCheckoutAdapter, ProductCartCheckoutHost } from "./ProductCartCheckoutAdapter";
import { MemberCartCheckoutPanel } from "./MemberCartCheckoutPanel";
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
  const scope = JSON.stringify(query), [loaded, setLoaded] = useState<{ scope: string; access: CheckoutEntryAccess | null; intent: boolean } | null>(null), [failed, setFailed] = useState(false);
  const [active, setActive] = useState(false), [notice, setNotice] = useState(false), [revision, setRevision] = useState(0);
  const lock = useRef(true), generation = useRef(0), capture = useRef<{ host: ProductCartCheckoutHost; customer: ProductCartCheckoutHost["customer"]; raw: string | null; fresh: boolean; selection: ReturnType<typeof productCartCheckoutSelection> } | null>(null);
  const setLocked = useCallback((value: boolean) => { lock.current = value; }, []);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    let disposed = false, abort: AbortController | null = null;
    const clear = () => { generation.current++; abort?.abort(); setLocked(true); setLoaded(null); setActive(false); capture.current = null; setNotice(false); setFailed(true); };
    const load = async () => { clear(); setFailed(false); if (document.visibilityState === "hidden") return;
      const run = generation.current, owned = new AbortController(); abort = owned;
      const timeout = setTimeout(() => owned.abort(), 13_000);
      try { const response = await fetch("/api/member-checkout/cart/entry", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: scope, signal: owned.signal });
        if (!response.ok) throw new Error("unavailable"); const body = await response.json(), access = parseCheckoutEntryAccess(body, query);
        if (disposed || owned.signal.aborted || run !== generation.current) return;
        // A retained nonce keeps all existing cart data frozen even before the
        // original read completes. Malformed/blocked storage never means clear.
        const pending = access ? window.localStorage.getItem(checkoutClientStorageKey(query.siteId, access.accountId)) !== null : false;
        setLocked(pending); setLoaded({ scope, access, intent: body.intent === true });
      } catch { if (!disposed && run === generation.current) { setFailed(true); setLocked(true); } }
      finally { clearTimeout(timeout); }
    };
    const visible = () => document.visibilityState === "hidden" ? clear() : void load();
    const storage = (e: StorageEvent) => { if (e.key === null || /auth|account|session/.test(e.key ?? "") || e.key?.startsWith(`faolla-member-checkout-v2:${query.siteId}:`) || e.key?.startsWith(`merchant-space:product-cart:v1:${query.siteId}:`)) clear(); };
    void load(); window.addEventListener(SERVICE_IDENTITY_CHANGED, load); window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; invalidate(); abort?.abort(); window.removeEventListener(SERVICE_IDENTITY_CHANGED, load); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visible); };
  }, [invalidate, query, revision, scope, setLocked]);
  const access = loaded?.scope === scope ? loaded.access : null;
  const adapter: ProductCartCheckoutAdapter | undefined = loaded?.scope === scope && !access ? undefined : {
    isLocked: () => lock.current,
    render: host => {
      const button = "min-h-11 rounded-xl border border-teal-200 bg-white px-4 py-2 text-sm font-semibold text-teal-900";
      const retry = <button type="button" className={button} onClick={() => setRevision(v => v + 1)}>{t.retry}</button>;
      if (!access) return <div data-cart-member-entry className="shrink-0 space-y-3 border-t bg-slate-50 p-4 text-sm"><p role="status">{failed ? t.failed : t.loading}</p>{failed && retry}</div>;
      const pending = lock.current && !active;
      const begin = () => {
        try {
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
        {!captured ? <div className="space-y-3 text-sm">{notice && <p role="status">{t.kept}</p>}{host.clientRequestId && !pending ? <p role="alert">{t.legacy}</p> : <button type="button" className={button} onClick={begin}>{pending ? t.retry : t.begin}</button>}
          {failed && <><p role="alert">{t.missing}</p>{retry}</>}</div>
          : <MemberCartCheckoutPanel siteId={query.siteId} accountId={access.accountId} initialSelection={captured.selection} initialCustomer={captured.host.customer} locale={locale}
            intentEnabled={loaded?.intent} allowNewCheckout={captured.fresh && captured.selection.lines.length > 0} beforeSubmit={customer => { captured.raw = captured.host.persist(captured.raw, customer); captured.customer = customer; }}
            beforeRelease={(original, context) => { captured.raw = captured.host.persist(captured.raw, captured.customer, { selection: captured.selection, original, fresh: captured.fresh && (!loaded?.intent || context.createdHere) }); }}
            onReturnToCart={() => { if (window.localStorage.getItem(checkoutClientStorageKey(query.siteId, access.accountId)) !== null) throw new Error("checkout_cart_changed");
              capture.current = null; setActive(false); setLocked(false); }}
            onReleased={() => { capture.current = null; setActive(false); setLocked(false); setNotice(true); }}/>}
      </div>;
    },
  };
  return <ProductBlock {...props} runtimeCheckoutAdapter={adapter}/>;
}
