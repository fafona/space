"use client";
import { useEffect, useRef, useState } from "react";
import { serviceRequest, SERVICE_IDENTITY_CHANGED } from "@/components/service-center/serviceCenterClient";
import { parseMemberCheckoutResult, type MemberCheckoutResult } from "@/lib/merchantMemberCheckoutResult";
import { checkoutReportingSettlement } from "@/lib/merchantCheckoutReporting";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { MerchantSettlementBadge } from "./MerchantSettlementBadge";
import { parseOnSiteCheckoutResult, type OnSiteCheckoutResult } from "@/lib/merchantCheckoutOnSiteResult";
import { OnSiteCheckoutSummary } from "./OnSiteCheckoutSummary";
const copy = {
  zh: { check: "核对原单结算", checking: "正在核对…", open: "查看结算与取消规则", legacy: "未关联新结算账本，请查看原记录；不据此判断是否付款。", failed: "暂时无法核对原单，请重试，勿重复扣减。" },
  en: { check: "Check original settlement", checking: "Checking…", open: "Settlement & cancellation policy", legacy: "No new-ledger link. Use the original record; no payment status is inferred.", failed: "Settlement could not be checked. Retry the read; do not debit again." },
  es: { check: "Consultar pago original", checking: "Consultando…", open: "Pago y política de cancelación", legacy: "Sin vínculo al nuevo registro. Consulta el original; no se deduce si está pagado.", failed: "No se pudo verificar. Consulta de nuevo; no vuelvas a descontar." },
};
export function MemberCheckoutRecordEntry({ active, accountId, siteId, kind, id, revision, locale = "zh-CN", request = serviceRequest }: {
  active: boolean; accountId: string; siteId: string; kind: "booking" | "order"; id: string; revision?: string; locale?: string; request?: typeof serviceRequest;
}) {
  const scope = JSON.stringify([active, accountId, siteId, kind, id, revision]), text = copy[merchantSettlementLanguage(locale)];
  const [loaded, setLoaded] = useState<{ scope: string; result: MemberCheckoutResult | null; onSite?: OnSiteCheckoutResult } | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const invalidate = () => { ++sequence.current; controller.current?.abort(); };
    const clear = () => { invalidate(); setLoaded(null); setBusy(false); setFailed(false); };
    const visibility = () => { if (document.visibilityState === "hidden") clear(); };
    const storage = (event: StorageEvent) => { if (event.key === null || /auth|account|session/i.test(event.key)) clear(); };
    clear(); window.addEventListener("focus", clear); window.addEventListener("pagehide", clear); window.addEventListener(SERVICE_IDENTITY_CHANGED, clear); window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visibility);
    return () => { invalidate(); window.removeEventListener("focus", clear); window.removeEventListener("pagehide", clear); window.removeEventListener(SERVICE_IDENTITY_CHANGED, clear); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visibility); };
  }, [scope]);
  if (!active || !/^\d{8}$/.test(accountId) || !/^\d{8}$/.test(siteId) || !/^[A-Za-z0-9:_-]{1,160}$/.test(id)) return null;
  const value = loaded?.scope === scope ? loaded : null;
  const check = async () => {
    if (busy) return;
    const run = ++sequence.current, abort = new AbortController(); controller.current = abort; setBusy(true); setFailed(false); setLoaded(null);
    try {
      const payload = await request<{ ok: boolean; result: unknown; onSite?: unknown }>(`/api/member-checkout/resource?siteId=${siteId}&kind=${kind}&id=${encodeURIComponent(id)}`, { signal: abort.signal, headers: { "x-checkout-account-scope": accountId } });
      if (abort.signal.aborted || sequence.current !== run) return;
      if (payload.ok !== true) throw new Error("unavailable");
      if (payload.onSite !== undefined) {
        if (payload.result !== null || !payload.onSite || typeof payload.onSite !== "object" || !("operationKey" in payload.onSite) || typeof payload.onSite.operationKey !== "string") throw new Error("unavailable");
        const onSite = parseOnSiteCheckoutResult(payload.onSite, { siteId, operationKey: payload.onSite.operationKey });
        if (onSite.terms.resourceKind !== kind || onSite.terms.resourceId !== id) throw new Error("unavailable"); setLoaded({ scope, result: null, onSite }); return;
      }
      let result: MemberCheckoutResult | null = null;
      if (payload.result !== null) {
        if (!payload.result || typeof payload.result !== "object" || !("operationKey" in payload.result) || typeof payload.result.operationKey !== "string") throw new Error("unavailable");
        result = parseMemberCheckoutResult(payload.result, { siteId, operationKey: payload.result.operationKey });
        if (result.resourceKind !== kind || result.resourceId !== id) throw new Error("unavailable");
      }
      setLoaded({ scope, result });
    } catch { if (!abort.signal.aborted && sequence.current === run) setFailed(true); }
    finally { if (sequence.current === run) setBusy(false); }
  };
  return <div data-checkout-record-entry className="mt-3 space-y-2 text-sm">
    <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900 disabled:opacity-50" onClick={() => void check()}>{busy ? text.checking : text.check}</button>
    {failed && <p role="status" className="text-amber-800">{text.failed}</p>}
    {value?.onSite ? <div className="space-y-3"><OnSiteCheckoutSummary result={value.onSite} locale={locale}/><a className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 py-2" href={`/member-checkout/${siteId}/on-site/${value.onSite.operationKey}?uiLocale=${encodeURIComponent(locale)}`}>{text.open}</a></div> : value?.result ? <div className="flex flex-wrap items-center gap-3"><MerchantSettlementBadge snapshot={checkoutReportingSettlement({ kind, id, termsMatch: false, result: value.result })} locale={locale}/>
      <a className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900" href={`/member-checkout/${siteId}/${value.result.operationKey}?uiLocale=${encodeURIComponent(locale)}`}>{text.open}</a></div>
      : value && <p className="text-slate-600">{text.legacy}</p>}
  </div>;
}
