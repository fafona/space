"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createMerchantBusinessApiClient, type MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
import { checkoutManagerResourcePages, parseCheckoutManagerAccess } from "@/lib/merchantCheckoutManagerIntegration";
import type { CheckoutResourceReference } from "@/lib/merchantCheckoutReporting";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { MerchantCheckoutSettlementPanel } from "./MerchantCheckoutSettlementPanel";

const copy = {
  zh: { show: "核对结算状态", hide: "收起结算状态", group: "本页结算记录分组", previous: "上一组", next: "下一组", tooMany: "当前显示记录过多，请先筛选到 1000 条以内再核对结算；不能据此认定未付款。" },
  en: { show: "Review settlements", hide: "Hide settlements", group: "Current-page settlement group", previous: "Previous group", next: "Next group", tooMany: "Too many displayed records. Filter to at most 1,000 before reviewing settlements; no payment status is inferred." },
  es: { show: "Revisar pagos", hide: "Ocultar pagos", group: "Grupo de pagos de esta página", previous: "Grupo anterior", next: "Grupo siguiente", tooMany: "Hay demasiados registros. Filtra hasta un máximo de 1000 antes de revisar; no se deduce si están pagados." },
};
/** Owner-only, async discovery does not block the old record list. Disabled
 * pilot and employee views render nothing. No balances/receipts in storage;
 * financial reads begin only after an explicit expand action. */
export function MerchantCheckoutManagerIntegration({ active, employeeMode = false, siteId, resources, revision = "", locale = "zh-CN", apiClient }: {
  active: boolean; employeeMode?: boolean; siteId: string; resources: CheckoutResourceReference[]; revision?: string; locale?: string; apiClient?: MerchantBusinessApiClient;
}) {
  const api = useMemo(() => apiClient ?? createMerchantBusinessApiClient({ authMode: "owner" }), [apiClient]);
  const scope = JSON.stringify([siteId, resources, revision]), text = copy[merchantSettlementLanguage(locale)];
  const [access, setAccess] = useState<{ scope: string; owner: string; epoch: number } | null>(null), [open, setOpen] = useState(false), [group, setGroup] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    let disposed = false, abort: AbortController | null = null;
    const invalidate = () => { ++sequence.current; abort?.abort(); };
    const load = async () => {
      const epoch = ++sequence.current; abort?.abort(); setAccess(null); setOpen(false); setGroup(0);
      if (!active || employeeMode || !/^\d{8}$/.test(siteId) || document.visibilityState === "hidden") return;
      abort = new AbortController(); const signal = abort.signal;
      try {
        const response = await api(`/api/merchant-checkout/settlements?siteId=${siteId}`, { signal, cache: "no-store" });
        if (!response.ok) return;
        const owner = parseCheckoutManagerAccess(await response.json(), siteId);
        if (owner && !disposed && !signal.aborted && epoch === sequence.current) setAccess({ scope, owner, epoch });
      } catch { /* unavailable discovery never exposes stale financial data */ }
    };
    const hide = () => { ++sequence.current; abort?.abort(); setAccess(null); setOpen(false); };
    const visibility = () => document.visibilityState === "hidden" ? hide() : void load();
    const storage = (e: StorageEvent) => { if (e.key === null || /auth|account|session/i.test(e.key)) hide(); };
    void load(); window.addEventListener("focus", load); window.addEventListener("pagehide", hide);
    window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; invalidate(); window.removeEventListener("focus", load); window.removeEventListener("pagehide", hide); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visibility); };
  }, [active, employeeMode, siteId, scope, api]);
  let pages: CheckoutResourceReference[][] = [], invalid = false;
  try { pages = checkoutManagerResourcePages(resources); } catch { invalid = true; }
  if (!active || employeeMode || access?.scope !== scope) return null;
  if (invalid) return <p role="status" className="my-3 text-sm text-amber-800">{text.tooMany}</p>;
  if (!pages.length) return null;
  const page = Math.min(group, pages.length - 1), button = "min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50";
  return <div className="my-3 space-y-3" data-checkout-manager>
    <button type="button" className={button} aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? text.hide : text.show}</button>
    {open && <>
      {pages.length > 1 && <nav aria-label={text.group} className="flex flex-wrap items-center gap-2 text-sm"><span>{text.group} {page + 1} / {pages.length}</span>
        <button type="button" className={button} disabled={page === 0} onClick={() => setGroup(v => v - 1)}>{text.previous}</button>
        <button type="button" className={button} disabled={page === pages.length - 1} onClick={() => setGroup(v => v + 1)}>{text.next}</button></nav>}
      <MerchantCheckoutSettlementPanel key={`${access.epoch}:${page}`} siteId={siteId} resources={pages[page]} identityKey={`${access.owner}:${access.epoch}`} ownerScope={access.owner} locale={locale} apiClient={api}/>
    </>}
  </div>;
}
