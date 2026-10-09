"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { UnifiedTimesheetClient } from "@/lib/merchantAttendanceUnifiedTimesheetClient";
import { parseUnifiedQuery, unifiedQueryString, type UnifiedReport, type UnifiedAmounts } from "@/lib/merchantAttendanceUnifiedTimesheet";
import { formatAttendanceTimesheetDuration as duration } from "@/lib/merchantAttendanceTimesheetDisplay";
import type { UnifiedTimesheetProps } from "./MerchantAttendanceUnifiedTimesheetLauncher";
import MerchantAttendanceUnifiedExport from "./MerchantAttendanceUnifiedExport";
import EventChannels from "./MerchantAttendanceEventChannels";
import PeriodClosureLauncher from "./MerchantAttendancePeriodClosureLauncher";
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm";
export default function MerchantAttendanceUnifiedTimesheetPanel(props: UnifiedTimesheetProps & { onClose: () => void }) {
  return <Screen key={`${props.actorId}:${unifiedQueryString(props.query)}`} {...props}/>;
}
function Screen({ query, actorId, apiFetch, onDenied, onClose, registerLeaveGuard }: UnifiedTimesheetProps & { onClose: () => void }) {
  const queryKey = unifiedQueryString(query), [from, setFrom] = useState(query.fromDate), [through, setThrough] = useState(query.throughDate);
  const client = useMemo(() => new UnifiedTimesheetClient({ query: parseUnifiedQuery(`https://local.invalid/?${queryKey}`), actorId, apiFetch, onDenied }), [queryKey, actorId, apiFetch, onDenied]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), busy = state.phase === "loading";
  const periodWorkerId = query.access === "self" ? query.expectedWorkerId : query.workerId;
  const periodGuard = useRef<(() => boolean) | null>(null);
  const registerPeriodGuard = useCallback((guard: (() => boolean) | null) => { periodGuard.current = guard; }, []);
  const mayLeave = useCallback(() => !periodGuard.current || periodGuard.current(), []);
  useLayoutEffect(() => { registerLeaveGuard?.(mayLeave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, mayLeave]);
  useEffect(() => { const hide = () => client.invalidate(), visible = () => { if (document.visibilityState === "hidden") hide(); };
    document.addEventListener("visibilitychange", visible); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", hide);
    return () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", hide); client.invalidate(); }; }, [client]);
  return <section aria-label="含整段漏卡工时工作区" className="my-4 min-w-0 space-y-4 rounded-2xl border border-blue-300 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-bold">含整段漏卡的工时核对</h2><button type="button" className={button} onClick={() => { if (mayLeave()) { client.invalidate(); onClose(); } }}>关闭合并核对</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">本页在原始记录／最新已批准补正的核定口径上，加入已批准的整段申报。待审、撤回及驳回不计入；发生来源冲突时不展示合计。原报表及其导出仍为旧口径，{process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_UNIFIED_EXPORT_ENABLED === "1" ? "本页另提供含整段申报的独立导出，生成时重新核验权限和数据。" : "本页暂不提供导出。"}</p>
    {query.access !== "owner" && <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6">仅包含当前完整可见的来源，{query.access === "self" ? "不包含换绑前他人记录或混合归属班次" : "只核对所选人员与地点的授权组合，不包含跨地点班次"}；不是该员工完整个人月报。</p>}
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); if (mayLeave()) void client.load({ ...query, fromDate: from, throughDate: through }); }}>
      <label className="text-sm">合并核对开始日期<input type="date" required min="2000-01-01" max="2100-12-31" className={input} value={from} disabled={busy} onChange={e => { if (mayLeave()) { client.invalidate(); setFrom(e.target.value); } }}/></label>
      <label className="text-sm">合并核对结束日期（含）<input type="date" required min="2000-01-01" max="2100-12-31" className={input} value={through} disabled={busy} onChange={e => { if (mayLeave()) { client.invalidate(); setThrough(e.target.value); } }}/></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button className={button} disabled={busy}>查询含整段漏卡工时</button><span className="text-xs text-slate-500">最多 31 个企业自然日 · 不使用浏览器时区</span></div>
    </form>
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm ${state.phase === "blocked" ? "bg-rose-50 text-rose-900" : "bg-blue-50 text-blue-900"}`}>{state.message}</p>
    {query.access !== "manager" && periodWorkerId && <PeriodClosureLauncher key={state.result?.base.asOf ?? state.phase} siteId={query.siteId} access={query.access} actorId={actorId}
      workerId={periodWorkerId} fromDate={from} throughDate={through}
      apiFetch={apiFetch} registerLeaveGuard={registerPeriodGuard}/>}
    {state.result && <Report result={state.result}/>}
    {state.result && <EventChannels siteId={state.result.base.siteId} actorId={actorId} access={state.result.access} workerId={state.result.base.workerId}
      locationId={"locationId" in state.result.base ? state.result.base.locationId : null} employeeId={"viewerEmployeeId" in state.result.base ? state.result.base.viewerEmployeeId : undefined}
      eventIds={state.result.base.rows.flatMap(row=>row.eventIds)} readKey={state.result.base.asOf} apiFetch={apiFetch}/>}
    {state.result && <MerchantAttendanceUnifiedExport report={state.result} actorId={actorId} apiFetch={apiFetch} onDenied={onDenied ?? client.invalidate} onStale={client.invalidate}/>}
    <p className="text-xs leading-5 text-slate-500">只读，不改原始打卡；未结束班次不估算，空白不等于缺勤。资料仅在页面内存保留，隐藏页面或显示时限／授权到期后清除，不轮询或自动延长授权。</p>
  </section>;
}
function Comparison({ value: v }: { value: UnifiedAmounts }) {
  return <div className="max-w-full overflow-x-auto" role="region" aria-label="含整段申报工时合计" tabIndex={0}><table className="w-full min-w-[38rem] text-left text-sm">
    <caption className="pb-2 text-left font-bold">区间内已结束来源合计</caption><thead><tr>{["项目", "原始打卡", "原记录／补正核定", "整段申报", "合并核定"].map(t => <th className="p-2" key={t}>{t}</th>)}</tr></thead>
    <tbody>{([["workedUs", "工作段"], ["elapsedUs", "起止总时长"], ["breakUs", "全部休息"], ["paidBreakUs", "带薪休息标记"]] as const).map(([key, label]) => <tr key={key} className="border-t border-slate-200"><th className="p-2 font-medium">{label}</th>{(["original", "recordedSelected", "missingSelected", "selected"] as const).map(source => <td className="p-2" key={source}>{duration(v[source][key])}</td>)}</tr>)}</tbody></table></div>;
}
function Report({ result: r }: { result: UnifiedReport & { moduleEnabled: boolean } }) {
  const b = r.base, stamp = (s: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: b.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s));
  return <article aria-label="含整段漏卡工时结果" className="min-w-0 space-y-4 border-t border-slate-200 pt-4">
    <header><h3 className="font-bold">{b.workerName} · {b.workerNo}</h3><p className="text-sm">{b.fromDate} 至 {b.throughDate} · 企业时区 {b.timeZone}</p><p className="break-all text-xs text-slate-500">只读核对时间 UTC：{b.asOf}；人员标题为当前资料，整段申报另列提交时姓名。</p></header>
    {!r.moduleEnabled && <p className="rounded-xl bg-amber-50 p-3 text-sm">平台暂停新考勤；本页按有效权限核对历史记录。</p>}
    {!!b.administrativeUnassessedCount && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{b.administrativeUnassessedCount} 个已行政关闭班次仍待核定；合并合计与按日数值仅为已知部分小计，不是完整工时，未知不按零计算。</p>}
    {(b.openSessionCount > 0 || b.periodInProgress) && <p className="text-sm text-amber-900">{b.openSessionCount > 0 ? `${b.openSessionCount} 个班次未结束，不计入时长。` : ""}{b.periodInProgress ? "当前区间尚未结束，不是最终结算。" : ""}</p>}
    <Comparison value={r.totals}/>
    <p className="text-xs leading-5 text-slate-500">工作段＝起止总时长−全部休息；带薪休息单独列示，不自动加回工作段或计算工资。跨日按照企业当地自然日拆分，只计所选区间。</p>
    <details className="min-w-0 rounded-xl border border-slate-200 p-3"><summary className="font-semibold">合并按日明细（{r.days.length} 天）</summary><div className="mt-2 max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="合并每日明细"><table className="w-full min-w-[30rem] text-left text-sm">
      <thead><tr>{["日期", "原记录／补正工作段", "整段申报工作段", "合并工作段"].map(t => <th className="p-2" key={t}>{t}</th>)}</tr></thead><tbody>{r.days.map(d => <tr key={d.date} className="border-t border-slate-200"><th className="p-2 font-medium">{d.date}</th><td className="p-2">{duration(d.recordedSelected.workedUs)}</td><td className="p-2">{duration(d.missingSelected.workedUs)}</td><td className="p-2">{duration(d.selected.workedUs)}</td></tr>)}</tbody></table></div></details>
    {!!b.skippedDates.length && <p className="text-xs text-amber-900">时区历史跳过日期（不算缺勤）：{b.skippedDates.join("、")}</p>}
    <h4 className="font-bold">原始记录／补正来源 · {b.rows.length} 条</h4>
    {b.rows.map(row => <details className="min-w-0 rounded-xl border border-slate-200 p-3 text-sm" key={row.startEventId}><summary>{stamp(row.selected.startAt)} · {row.source === "approved" ? "已批准补正" : "原始记录"} · {row.administrativeBoundary ? "行政关闭，工时待核定（不是零）" : row.selected.endAt && row.selectedInPeriod ? duration(row.selectedInPeriod.workedUs) : "未结束，不计入"}</summary>
      <p className="mt-2 break-all text-xs">原始 UTC：{row.original.startAt} — {row.original.endAt ?? "未结束"}<br/>核定 UTC：{row.selected.startAt} — {row.selected.endAt ?? "未结束"}<br/>原始开始事件：{row.startEventId}</p>
      {row.correction && <p className="break-all text-xs">批准申请：{row.correction.requestId}<br/>核定操作：{row.correction.operationId} · 版本 {row.correction.revision}</p>}</details>)}
    <h4 className="font-bold">已批准整段申报 · {r.missing.length} 条</h4>
    {!r.missing.length && <p className="text-sm text-slate-600">此区间没有完整可见的已批准整段申报；不代表缺勤。</p>}
    {r.missing.map(m => <details className="min-w-0 rounded-xl border border-blue-200 p-3 text-sm" key={m.requestId}><summary>{stamp(m.proposal.startAt)} — {stamp(m.proposal.endAt)} · 整段申报 · {duration(m.inPeriod.workedUs)}</summary>
      <p className="mt-2 text-xs leading-6">提交时员工：{m.workerName}<br/>申报地点：{m.locationName} · {m.timeZone}<br/>原始打卡：无（未伪造事件）<br/>批准于 {stamp(m.approvedAt)} · 保存规则版本 {m.policyRevision}</p>
      {m.proposal.breaks.map((rest, n) => <p className="text-xs" key={n}>休息 {n + 1}：{stamp(rest.startAt)} — {stamp(rest.endAt)} · {rest.paid ? "带薪标记" : "非带薪标记"}</p>)}
      <p className="mt-2 break-all text-xs text-slate-500">申报 UTC：{m.proposal.startAt} — {m.proposal.endAt}<br/>申请编号：{m.requestId}<br/>批准操作：{m.operationId}</p></details>)}
  </article>;
}
