"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMerchantBusinessApiClient, type MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
import { checkoutReportingNeedsReview, checkoutReportingSettlement, checkoutReportingTsv, parseCheckoutReportingRequest,
  parseCheckoutReportingSnapshot, type CheckoutResourceReference, type CheckoutReportingSnapshot } from "@/lib/merchantCheckoutReporting";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { MerchantSettlementBadge } from "./MerchantSettlementBadge";

const copy = {
  zh: { title: "结算核对", note: "仅核对本页记录。业务状态与结算状态独立；积分兑换不代表收到现金。", reload: "重新读取", export: "导出本页", all: "全部", linked: "已关联结算", closed: "已关闭", review: "需人工核对", unlinked: "未关联新结算账本", unknown: "暂无可核对记录", loading: "读取结算状态…", failed: "暂时无法核对结算，不能据此认定未付款或重新扣减。", login: "请使用商户负责人账号核验。", booking: "预约", order: "订单", business: "业务状态", missing: "原记录待核对", policy: "原单取消规则", returnPoints: "退实际扣除积分", keepPoints: "不退积分", returnCoupons: "退原券，不顺延有效期", keepCoupons: "不退券", reviewNote: "原记录缺失、内容或状态与结算不一致。请人工核对，勿在旧入口重复扣减、取消或恢复。", legacy: "沿用原有记录；此处不判断付款情况。", closedNote: "已按原单规则关闭，是否退还以实际退还记录为准。", pending: "待确认", active: "待确认", confirmed: "已确认", completed: "已完成", no_show: "未到店", cancelled: "已取消", filter: "本页筛选", readOnly: "只读核对，不更改预约、订单、积分或券。" },
  en: { title: "Settlement review", note: "Current page only. Business and financial states are separate. Points redemption is not cash received.", reload: "Reload", export: "Export this page", all: "All", linked: "Linked settlements", closed: "Closed", review: "Needs review", unlinked: "No new-ledger link", unknown: "No records to review", loading: "Reading settlements…", failed: "Settlement could not be verified. Do not assume unpaid or debit again.", login: "Verify with the merchant owner account.", booking: "Booking", order: "Order", business: "Business status", missing: "Original record needs review", policy: "Original cancellation policy", returnPoints: "Return actual points debited", keepPoints: "Keep points", returnCoupons: "Return original coupons; no expiry extension", keepCoupons: "Keep coupons", reviewNote: "The original record is missing or its terms/status differ from the ledger. Review manually; do not debit, cancel or restore through old actions.", legacy: "Use the original record. No payment status is inferred here.", closedNote: "Closed under the original policy. Returns are shown only when actually recorded.", pending: "Pending", active: "Pending", confirmed: "Confirmed", completed: "Completed", no_show: "No-show", cancelled: "Cancelled", filter: "Current-page filter", readOnly: "Read-only. Bookings, orders, points and coupons are unchanged." },
  es: { title: "Revisión del pago", note: "Solo esta página. El estado del servicio y el pago son distintos. Canjear puntos no equivale a cobrar dinero.", reload: "Volver a leer", export: "Exportar esta página", all: "Todos", linked: "Pagos vinculados", closed: "Cerrados", review: "Revisar", unlinked: "Sin vínculo al nuevo registro", unknown: "No hay registros que revisar", loading: "Leyendo pagos…", failed: "No se pudo verificar el pago. No lo consideres impagado ni vuelvas a descontar.", login: "Verifica con la cuenta del titular del comercio.", booking: "Reserva", order: "Pedido", business: "Estado del servicio", missing: "Revisar registro original", policy: "Política original de cancelación", returnPoints: "Devolver los puntos descontados", keepPoints: "No devolver puntos", returnCoupons: "Devolver cupones originales sin ampliar validez", keepCoupons: "No devolver cupones", reviewNote: "Falta el registro original o sus datos/estado difieren del pago. Revísalo manualmente; no uses las acciones antiguas para descontar, cancelar o restaurar.", legacy: "Consulta el registro original. Aquí no se deduce su estado de pago.", closedNote: "Cerrado según la política original. Solo se muestran devoluciones realmente registradas.", pending: "Pendiente", active: "Pendiente", confirmed: "Confirmado", completed: "Completado", no_show: "No presentado", cancelled: "Cancelado", filter: "Filtro de esta página", readOnly: "Solo lectura. No cambia reservas, pedidos, puntos ni cupones." },
};
type Filter = "all" | "linked" | "closed" | "review" | "unlinked";

/** Standalone read-only integration component. The host must pass its verified
 * owner identity generation and its current page of resource keys. It does not
 * register legacy actions, assume an employee's finance permissions or fetch
 * customer profiles. Not mounted into the old manager before its write guards. */
export function MerchantCheckoutSettlementPanel({ siteId, resources, identityKey, locale = "zh-CN", apiClient }: {
  siteId: string; resources: CheckoutResourceReference[]; identityKey: string | null; locale?: string; apiClient?: MerchantBusinessApiClient;
}) {
  const text = copy[merchantSettlementLanguage(locale)], api = useMemo(() => apiClient ?? createMerchantBusinessApiClient({ authMode: "owner" }), [apiClient]);
  const scope = JSON.stringify({ siteId, resources }), displayScope = JSON.stringify([scope, identityKey]);
  const [loaded, setLoaded] = useState<{ scope: string; snapshot: CheckoutReportingSnapshot } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(false), [filter, setFilter] = useState<Filter>("all");
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  const snapshot = identityKey && loaded?.scope === displayScope ? loaded.snapshot : null;
  const invalidate = useCallback(() => { ++generation.current; controller.current?.abort(); }, []);
  const load = useCallback(async () => {
    invalidate(); const run = generation.current;
    setLoaded(null); setError(false);
    if (!identityKey || !JSON.parse(scope).resources.length) { setLoading(false); return; }
    const abort = new AbortController(); controller.current = abort; setLoading(true);
    try {
      const request = parseCheckoutReportingRequest(JSON.parse(scope));
      const response = await api("/api/merchant-checkout/settlements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: abort.signal, cache: "no-store" });
      const payload = await response.json();
      if (abort.signal.aborted || run !== generation.current) return;
      if (!response.ok || payload.ok !== true) throw new Error("unavailable");
      setLoaded({ scope: displayScope, snapshot: parseCheckoutReportingSnapshot(payload.snapshot, request) });
    } catch { if (!abort.signal.aborted && run === generation.current) setError(true); }
    finally { if (run === generation.current) setLoading(false); }
  }, [api, scope, displayScope, identityKey, invalidate]);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  // Hide finance on background/account transitions; late responses can never
  // restore another owner's previous selection. The host updates identityKey.
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === "hidden") { invalidate(); setLoaded(null); } else void load(); };
    const focus = () => void load();
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); };
  }, [load, invalidate]);
  const rows = snapshot?.rows.filter(r => filter === "all" || filter === "linked" && r.result !== null || filter === "closed" && r.result?.closed
    || filter === "review" && checkoutReportingNeedsReview(r) || filter === "unlinked" && r.result === null) ?? [];
  const download = () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob(["\uFEFF" + checkoutReportingTsv({ ...snapshot, rows })], { type: "text/tab-separated-values;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `settlements-${siteId}.tsv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const button = "min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50";
  return <section aria-label={text.title} className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-900 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">{text.title}</h2><p className="mt-2 text-sm text-slate-600">{text.note}</p></div>
      {identityKey && <div className="flex flex-wrap gap-2"><button className={button} disabled={loading} onClick={() => void load()}>{text.reload}</button><button className={button} disabled={!snapshot} onClick={download}>{text.export}</button></div>}</header>
    {!identityKey ? <p role="status">{text.login}</p> : loading ? <p role="status">{text.loading}</p> : error ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{text.failed}</p>
      : snapshot ? <><label className="flex flex-wrap items-center gap-3 text-sm">{text.filter}<select aria-label={text.filter} value={filter} onChange={event => setFilter(event.target.value as Filter)} className={button}>
        {(["all", "linked", "closed", "review", "unlinked"] as Filter[]).map(value => <option key={value} value={value}>{text[value]}</option>)}</select><span>{rows.length} / {snapshot.rows.length}</span></label>
        <div className="grid gap-3 lg:grid-cols-2">{rows.map(row => {
          const r = row.result, policy = r?.cancellationPolicy, review = checkoutReportingNeedsReview(row);
          const status = r?.resource?.status as "active" | "pending" | "confirmed" | "completed" | "no_show" | "cancelled" | undefined;
          return <article data-resource-id={row.id} key={`${row.kind}:${row.id}`} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="break-all text-sm font-semibold">{text[row.kind]} · {row.id}</h3>
            {!r ? <><span className="text-sm text-slate-500">{text.unlinked}</span><p className="text-xs text-slate-500">{text.legacy}</p></> : <>
              <p className="text-sm">{text.business} · {status ? text[status] : text.missing}</p><MerchantSettlementBadge snapshot={checkoutReportingSettlement(row)} locale={locale} showDetails/>
              {r.closed && <p className="text-xs text-slate-600">{text.closedNote}</p>}
              {policy && <details className="text-sm text-slate-600"><summary className="cursor-pointer">{text.policy}</summary><ul className="mt-2 list-inside list-disc space-y-1"><li>{policy.returnPoints ? text.returnPoints : text.keepPoints}</li><li>{policy.returnCoupons ? text.returnCoupons : text.keepCoupons}</li></ul></details>}
              {review && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{text.reviewNote}</p>}</>}
          </article>;
        })}</div>{rows.length === 0 && <p>{text.unknown}</p>}</> : <p>{text.unknown}</p>}
    <p className="text-xs text-slate-500">{text.readOnly}</p>
  </section>;
}
