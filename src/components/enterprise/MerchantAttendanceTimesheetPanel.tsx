"use client";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from "react";
import {AttendanceTimesheetClient} from "@/lib/merchantAttendanceTimesheetClient";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
import type {AttendanceTimesheetResult,AttendanceTimesheetRow} from "@/lib/merchantAttendanceTimesheet";
import type {AttendanceSessionAmounts} from "@/lib/merchantAttendanceSession";
import {formatAttendanceTimesheetDuration as formatAttendanceDurationUs} from "@/lib/merchantAttendanceTimesheetDisplay";
import MerchantAttendanceTimesheetExport from "./MerchantAttendanceTimesheetExport";
import UnifiedTimesheetLauncher from "./MerchantAttendanceUnifiedTimesheetLauncher";
import EventChannels from "./MerchantAttendanceEventChannels";

const button="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input="mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50";
const duration=(n:number)=>`${n<0?"−":n>0?"+":""}${formatAttendanceDurationUs(Math.abs(n))}`;
type Props={siteId:string;ownerId:string;apiFetch:AttendanceApiFetch;onClose:()=>void;registerLeaveGuard?:(guard:(()=>boolean)|null)=>void};
export default function MerchantAttendanceTimesheetPanel(props:Props){return <Screen key={`${props.siteId}:${props.ownerId}`} {...props}/>;}
function Screen({siteId,ownerId,apiFetch,onClose,registerLeaveGuard}:Props){
  const client=useMemo(()=>new AttendanceTimesheetClient({siteId,ownerId,apiFetch}),[siteId,ownerId,apiFetch]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
  const [search,setSearch]=useState("");
  const childGuard=useRef<(()=>boolean)|null>(null);
  const registerChildGuard=useCallback((guard:(()=>boolean)|null)=>{childGuard.current=guard;},[]);
  const mayLeave=useCallback(()=>!childGuard.current||childGuard.current(),[]);
  useLayoutEffect(()=>{registerLeaveGuard?.(mayLeave);return()=>registerLeaveGuard?.(null);},[registerLeaveGuard,mayLeave]);
  useEffect(()=>{
    const hide=()=>{client.invalidate();setSearch("");};
    const refresh=()=>{if(document.visibilityState!=="hidden")void client.initialize();else hide();};
    const shown=(e:PageTransitionEvent)=>{if(e.persisted)refresh();};
    refresh();document.addEventListener("visibilitychange",refresh);window.addEventListener("pagehide",hide);window.addEventListener("pageshow",shown);
    return()=>{document.removeEventListener("visibilitychange",refresh);window.removeEventListener("pagehide",hide);window.removeEventListener("pageshow",shown);client.invalidate();};
  },[client]);
  const busy=state.phase==="loading",r=state.result;
  return <section aria-label="周期工时核对" className="mt-5 min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">周期工时核对</h2><p className="mt-1 text-sm text-slate-600">仅当前商户负责人 · 只读报表</p></div>
      <button type="button" className={button} onClick={()=>{if(mayLeave()){client.invalidate();onClose();}}}>返回考勤管理</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">原始口径保留原始打卡记录；核定口径使用已批准补正，其他班次仍按原始记录。未结束班次不估算时长；空白或零工时不代表缺勤。此处不计算工资、加班、迟到或法定休息。</p>
    <div className="flex flex-wrap items-center gap-3"><button type="button" className={button} disabled={busy} onClick={()=>{if(mayLeave()){setSearch("");void client.initialize();}}}>重新读取设置与人员</button>
      {state.timeZone&&<p className="break-all text-sm">企业日期时区：{state.timeZone}</p>}</div>
    <form aria-label="搜索报表人员" className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();if(mayLeave())void client.loadChoices(search);}}>
      <label className="min-w-0 flex-1 text-sm">人员姓名／工号<input className={input} value={search} maxLength={80} disabled={busy||!state.timeZone} onChange={e=>{if(mayLeave()){client.clearReport();setSearch(e.target.value);}}}/></label>
      <button type="submit" className={button} disabled={busy||!state.timeZone}>搜索人员</button></form>
    {state.choices&&<div className="space-y-2"><div className="grid max-h-72 gap-2 overflow-y-auto p-1 sm:grid-cols-2 xl:grid-cols-3">{state.choices.items.map(c=><button key={c.id} type="button" disabled={busy} aria-pressed={state.worker?.id===c.id}
      className={`min-w-0 rounded-xl border p-3 text-left text-sm disabled:opacity-40 ${state.worker?.id===c.id?"border-blue-500 bg-blue-50":"border-slate-200 bg-white"}`} onClick={()=>{if(mayLeave())client.selectWorker(c.id);}}>
      <span className="block break-words font-semibold">{c.label}</span><span className="mt-1 block break-words text-xs text-slate-600">{c.detail} · {c.eligible?"启用":"停用／仍可核对历史"}</span></button>)}</div>
      {!state.choices.items.length&&<p className="text-sm text-slate-600">没有匹配的考勤人员。</p>}
      <div className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={busy} onClick={()=>{if(mayLeave())void client.loadChoices(state.search);}}>人员首页</button>
        <button type="button" className={button} disabled={busy||!state.choices.nextCursor} onClick={()=>{if(mayLeave())void client.loadChoices(state.search,state.choices!.nextCursor);}}>人员下一页</button><span className="text-xs text-slate-500">每批最多 25 人，不自动选择</span></div></div>}
    <form aria-label="工时查询条件" className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();if(mayLeave())void client.load();}}>
      <p className="break-words text-sm sm:col-span-2">当前人员：{state.worker?`${state.worker.label} · ${state.worker.detail}`:"未选择"}</p>
      <label className="text-sm">开始日期<input type="date" required min="2000-01-01" max="2100-12-31" className={input} disabled={busy||!state.timeZone} value={state.fromDate} onChange={e=>{if(mayLeave())client.setDates(e.target.value,state.throughDate);}}/></label>
      <label className="text-sm">结束日期（含）<input type="date" required min="2000-01-01" max="2100-12-31" className={input} disabled={busy||!state.timeZone} value={state.throughDate} onChange={e=>{if(mayLeave())client.setDates(state.fromDate,e.target.value);}}/></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={busy||!state.worker}>查询工时</button><p className="text-xs text-slate-500">最多 31 个自然日，使用企业时区，不使用浏览器时区。</p></div></form>
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm leading-6 ${state.phase==="blocked"?"bg-rose-50 text-rose-900":"bg-blue-50 text-blue-950"}`}>{state.message}</p>
    {r&&<Report result={r}/>}
    {r&&<EventChannels siteId={siteId} actorId={ownerId} access="owner" workerId={r.workerId} eventIds={r.rows.flatMap(row=>row.eventIds)} readKey={r.asOf} apiFetch={apiFetch}/>}
    {r&&<UnifiedTimesheetLauncher query={{siteId,access:"owner",workerId:r.workerId,fromDate:r.fromDate,throughDate:r.throughDate}} actorId={ownerId} apiFetch={apiFetch} onDenied={client.invalidate} registerLeaveGuard={registerChildGuard}/>}
    {r&&<MerchantAttendanceTimesheetExport report={r} actorId={ownerId} apiFetch={apiFetch} onDenied={client.invalidate}/>}
    <p className="text-xs leading-6 text-slate-500">每次查询重新核验权限；暂停新考勤仍可按有效权限查历史。资料仅保留在当前页面内存，不轮询、不写入浏览器持久存储；切到后台即清除，返回后重新选择人员。</p>
  </section>;
}
function Comparison({original,selected}: {original:AttendanceSessionAmounts;selected:AttendanceSessionAmounts}){
  return <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="工时口径对照"><table className="w-full min-w-[30rem] text-left text-sm"><caption className="mb-2 text-left font-semibold">区间内已结束班次合计</caption><thead><tr>{["项目","原始","核定","变化"].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>
    {([["workedUs","工作段"],["elapsedUs","起止总时长"],["breakUs","全部休息"],["paidBreakUs","带薪休息标记"]] as const).map(([k,label])=><tr key={k} className="border-t border-slate-200"><th className="p-2 font-medium">{label}</th><td className="p-2">{formatAttendanceDurationUs(original[k])}</td><td className="p-2">{formatAttendanceDurationUs(selected[k])}</td><td className="p-2">{duration(selected[k]-original[k])}</td></tr>)}
  </tbody></table></div>;
}
function Report({result:r}:{result:AttendanceTimesheetResult&{moduleEnabled:boolean}}){
  const stamp=(s:string)=>new Intl.DateTimeFormat("zh-CN",{timeZone:r.timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",timeZoneName:"shortOffset"}).format(new Date(s));
  return <article aria-label="工时查询结果" className="min-w-0 space-y-4 border-t border-slate-200 pt-4">
    <header><h3 className="break-words text-lg font-bold">{r.workerName} · {r.workerNo}</h3><p className="mt-1 text-sm">{r.fromDate} 至 {r.throughDate} · {r.timeZone}</p>
      <p className="mt-1 break-all text-xs text-slate-500">核对时刻 UTC：{r.asOf}；姓名、工号及账号关联为当前信息，不是历史身份快照。{r.employeeId===null?"当前未绑定员工账号。":""}</p></header>
    {!r.moduleEnabled&&<p className="rounded-xl bg-amber-50 p-3 text-sm">新考勤已暂停，本次只读核对既有记录。</p>}
    {!!r.administrativeUnassessedCount&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{r.administrativeUnassessedCount} 个班次已行政关闭，工时待核定；下方合计与按日数值仅为已知部分小计，不是完整工时。未知部分不按零计算。</p>}
    {(r.openSessionCount>0||r.periodInProgress)&&<p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6">{r.openSessionCount>0?`${r.openSessionCount} 个班次尚未结束，未计入时长；不是零工时班次。`:""}{r.periodInProgress?" 所选周期尚未结束，本次不是最终结算。":""}</p>}
    {!!r.skippedDates.length&&<p className="text-sm text-amber-900">时区历史变更跳过的自然日（不算缺勤）：{r.skippedDates.join("、")}</p>}
    <Comparison original={r.totals.original} selected={r.totals.selected}/>
    <p className="text-xs leading-6 text-slate-500">工作段＝起止总时长−全部休息；带薪休息独立列示，不自动加回工作段或换算工资。跨日班次按企业自然日拆分，只统计所选区间。</p>
    <details className="min-w-0 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer font-semibold">按日明细（{r.days.length} 天）</summary>
      <div className="mt-3 max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="每日工作段明细"><table className="w-full min-w-[30rem] text-left text-sm"><thead><tr>{["企业日期","原始工作段","核定工作段","变化"].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{r.days.map(d=><tr key={d.date} className="border-t border-slate-200"><th className="p-2 font-medium">{d.date}</th><td className="p-2">{formatAttendanceDurationUs(d.original.workedUs)}</td><td className="p-2">{formatAttendanceDurationUs(d.selected.workedUs)}</td><td className="p-2">{duration(d.selected.workedUs-d.original.workedUs)}</td></tr>)}</tbody></table></div></details>
    <h4 className="font-semibold">班次与核定来源 · {r.rows.length} 条</h4>
    {!r.rows.length&&<p className="rounded-xl bg-slate-50 p-3 text-sm">此区间没有相关班次；不会据此判断缺勤。</p>}
    {r.rows.map((row,n)=><details key={row.startEventId} className="min-w-0 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer break-words text-sm font-semibold">{n+1}. {stamp(row.original.startAt)} · {row.source==="approved"?"已批准补正":"原始记录"}{row.original.endAt===null?" · 尚未结束":""}</summary>
      <div className="mt-3 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Span value={row.original} title="原始完整班次"/><Span value={row.selected} title="核定完整班次"/></div>
        {row.originalInPeriod&&row.selectedInPeriod?<Comparison original={row.originalInPeriod} selected={row.selectedInPeriod}/>:<p className="rounded-xl bg-amber-50 p-3 text-sm">已行政关闭，原始与核定工时均待核定；未补造下班，不按零工时计算。</p>}
        {row.correction&&<p className="break-all rounded-xl bg-blue-50 p-3 text-xs leading-6">批准申请：{row.correction.requestId}<br/>操作编号：{row.correction.operationId}<br/>修订 {row.correction.revision} · 规则版本 {row.correction.policyRevision}<br/>核定 UTC：{row.correction.recordedAt}<br/>原始与核定区间可能跨出或移入本周期；以上区间合计不重复计时。</p>}
        <details className="text-xs"><summary className="cursor-pointer">原始动作编号（{row.eventIds.length} 条）</summary><ol className="mt-2 max-h-48 space-y-1 overflow-auto">{row.eventIds.map(id=><li key={id} className="break-all">{id}</li>)}</ol></details></div></details>)}
  </article>;
}
function Span({value:s,title}:{value:AttendanceTimesheetRow["original"];title:string}){
  return <div className="min-w-0 rounded-xl bg-slate-50 p-3 text-xs leading-6"><h5 className="font-bold">{title}</h5><p className="break-all">班次时区：{s.timeZone}<br/>上班 UTC：{s.startAt}<br/>下班 UTC：{s.endAt??"尚未结束，不推算"}</p>
    <p>完整工作段：{s.totals?formatAttendanceDurationUs(s.totals.workedUs):"未计入"}</p>
    <details><summary className="cursor-pointer">休息明细 · {s.breaks.length} 段已结束{s.openBreak?"／1 段进行中":""}</summary>{s.breaks.map((b,n)=><p key={n} className="break-all">{b.startAt} → {b.endAt} · {b.paid?"带薪标记":"非带薪标记"}</p>)}{s.openBreak&&<p className="break-all">{s.openBreak.startAt} → 尚未结束 · {s.openBreak.paid?"带薪标记":"非带薪标记"}</p>}</details>
  </div>;
}
