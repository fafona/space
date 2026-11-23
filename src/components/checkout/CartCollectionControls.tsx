"use client";
import { useEffect, useRef, useState } from "react";
import type { CartCheckoutResult } from "@/lib/merchantCheckoutCartResult";
import type { MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
import { parseOnSiteCollectionReceipt } from "@/lib/merchantCheckoutOnSiteCollection";
import { formatSettlementMoney, merchantSettlementLanguage } from "@/lib/merchantSettlement";
const copy = {
  zh: { open: "登记整车到店收款", confirm: "确认整车全额已收", back: "取消登记", note: "请确认已实际收到这笔原单全部应付。只登记商户收款事实，不扣款、不赠积分。登记后取消需先核对退款，不会自动退款或退券。", working: "正在登记…" },
  en: { open: "Record cart venue receipt", confirm: "Confirm full cart amount received", back: "Do not record", note: "Confirm the full original amount was actually received. This records a merchant receipt only; it does not charge or award points. Cancellation then requires refund review; no automatic refund or coupon return.", working: "Recording…" },
  es: { open: "Registrar cobro del carrito", confirm: "Confirmar cobro completo del carrito", back: "No registrar", note: "Confirma que has recibido todo el importe original. Solo registra el cobro; no cobra ni concede puntos. Cancelar requerirá revisar el reembolso; no se devuelve dinero ni cupones automáticamente.", working: "Registrando…" },
};
/** Dedicated cart command: never calls the single-offer collector. The host
 * removes the whole snapshot on an unknown outcome and rereads on success. */
export function CartCollectionControls({ result, api, ownerScope, locale = "zh-CN", onReload, onUnknown, onBusy }: {
  result: CartCheckoutResult; api: MerchantBusinessApiClient; ownerScope?: string; locale?: string; onReload(): Promise<void>; onUnknown(): void; onBusy(value: boolean): void;
}) {
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false), writing = useRef(false), current = useRef(true), abort = useRef<AbortController | null>(null);
  useEffect(() => { current.current = true; return () => { current.current = false; abort.current?.abort(); if (writing.current) onBusy(false); }; }, [onBusy]);
  const text = copy[merchantSettlementLanguage(locale)], button = "min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50";
  if (result.method !== "on_site" || result.reviewRequired || result.closed || result.collection || !result.resource || !["pending", "confirmed", "completed"].includes(result.resource.status) || !result.dueMinor) return null;
  const collect = async () => {
    if (!review || writing.current || !current.current || !result.resource) return;
    writing.current = true; setBusy(true); onBusy(true); abort.current = new AbortController();
    try {
      const response = await api("/api/merchant-checkout/cart/collect", { method: "POST", headers: { "content-type": "application/json", ...(ownerScope ? { "x-checkout-owner-scope": ownerScope } : {}) },
        body: JSON.stringify({ siteId: result.siteId, operationKey: result.operationKey, expectedUpdatedAt: result.resource.updatedAt, expectedDueMinor: result.dueMinor, received: true }),
        signal: AbortSignal.any([abort.current.signal, AbortSignal.timeout(15_000)]), cache: "no-store" });
      const payload = await response.json(); if (!current.current) return;
      if (!response.ok || payload.ok !== true) throw new Error("unknown");
      const receipt = parseOnSiteCollectionReceipt(payload.receipt, { siteId: result.siteId, operationKey: result.operationKey, amountMinor: result.dueMinor! });
      if (receipt.resourceKind !== "order" || receipt.resourceId !== result.resourceId) throw new Error("unknown");
      await onReload();
    } catch { if (current.current) onUnknown(); }
    finally { writing.current = false; if (current.current) { setBusy(false); onBusy(false); } }
  };
  return review ? <div role="region" aria-label={text.confirm} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6"><p>{text.note}</p><p className="text-lg font-bold">{formatSettlementMoney(result.dueMinor!, locale)}</p><div className="flex flex-wrap gap-2"><button className={button + " !bg-teal-700 !text-white"} disabled={busy} onClick={() => void collect()}>{busy ? text.working : text.confirm}</button><button className={button} disabled={busy} onClick={() => setReview(false)}>{text.back}</button></div></div>
    : <button className={button} onClick={() => setReview(true)}>{text.open}</button>;
}
