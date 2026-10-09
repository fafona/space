"use client";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useSyncExternalStore} from "react";
import {AttendanceScopedTimesheetClient} from "@/lib/merchantAttendanceScopedTimesheetClient";
import {scopedPairKey} from "@/lib/merchantAttendanceScopedTimesheetContext";
import {formatAttendanceTimesheetDuration as duration} from "@/lib/merchantAttendanceTimesheetDisplay";
import type {parseScopedTimesheetResponse} from "@/lib/merchantAttendanceScopedTimesheetResponse";
import type {AttendanceTimesheetRow} from "@/lib/merchantAttendanceTimesheet";
import type {ScopedTimesheetProps} from "./MerchantAttendanceScopedTimesheetLauncher";
import MerchantAttendanceTimesheetExport from "./MerchantAttendanceTimesheetExport";
import UnifiedTimesheetLauncher from "./MerchantAttendanceUnifiedTimesheetLauncher";
import EventChannels from "./MerchantAttendanceEventChannels";
const button="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input="mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm";
const signed=(n:number)=>(n<0?"−":n>0?"+":"")+duration(Math.abs(n));
type Props=ScopedTimesheetProps&{onClose:()=>void};
export default function MerchantAttendanceScopedTimesheetPanel(props:Props){return <Screen key={props.siteId+":"+props.actorId+":"+props.access} {...props}/>;}
function Screen({siteId,actorId,access,apiFetch,onClose,registerLeaveGuard}:Props){
  const client=useMemo(()=>new AttendanceScopedTimesheetClient({siteId,actorId,access,apiFetch}),[siteId,actorId,access,apiFetch]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
  const childGuard=useRef<(()=>boolean)|null>(null);
  const registerChildGuard=useCallback((guard:(()=>boolean)|null)=>{childGuard.current=guard;},[]);
  const mayLeave=useCallback(()=>!childGuard.current||childGuard.current(),[]);
  useLayoutEffect(()=>{registerLeaveGuard?.(mayLeave);return()=>registerLeaveGuard?.(null);},[registerLeaveGuard,mayLeave]);
  useEffect(()=>{
    const hide=()=>client.invalidate();
    const visible=()=>{if(document.visibilityState==="hidden")hide();else void client.initialize();};
    const show=(e:PageTransitionEvent)=>{if(e.persisted)visible();};
    visible();document.addEventListener("visibilitychange",visible);window.addEventListener("pagehide",hide);window.addEventListener("pageshow",show);
    return()=>{document.removeEventListener("visibilitychange",visible);window.removeEventListener("pagehide",hide);window.removeEventListener("pageshow",show);client.invalidate();};
  },[client]);
  const busy=state.phase==="loading",c=state.context;
  return <section aria-label="受限周期工时核对" className="mt-4 min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-bold">{access==="self"?"我的周期工时核对":"授权范围工时核对"}</h2><button type="button" className={button} onClick={()=>{if(mayLeave()){client.invalidate();onClose();}}}>关闭工时核对</button></header>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6"><strong>仅统计当前可完整查看的班次，不是完整个人月报。</strong>
      <p>{access==="self"?"只包含打卡时明确归属于本人账号的完整班次。换绑前他人记录、旧归属不明或混合归属的班次不纳入，请联系负责人核查。":"只包含所选人员在所选授权地点的完整班次。跨地点班次整段不纳入，不能将此处合计视为该员工全部工时。"}</p>
      <p>空白或零值不代表缺勤；未结束班次不估算。核定口径仅替换已批准补正，不重复累加，也不计算工资、加班或迟到。</p></div>
    <button type="button" className={button} disabled={busy} onClick={()=>{if(mayLeave())void client.initialize();}}>重新读取当前权限与范围</button>
    {c&&<p className="break-words text-sm">企业日期时区：{c.timeZone}{c.worker?" · 本人："+c.worker.label+" · "+c.worker.detail:" · 主管范围版本："+c.scopeRevision}</p>}
    {access==="manager"&&<form aria-label="搜索授权组合" className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();if(mayLeave())void client.loadContext(state.searchDraft);}}>
      <label className="min-w-0 flex-1 text-sm">人员／工号／地点<input className={input} maxLength={80} value={state.searchDraft} disabled={busy||!c} onChange={e=>{if(mayLeave())client.setSearch(e.target.value);}}/></label>
      <button type="submit" className={button} disabled={busy||!c}>搜索授权组合</button></form>}
    {access==="manager"&&c&&<div className="space-y-2"><div className="grid max-h-64 gap-2 overflow-y-auto p-1 sm:grid-cols-2">{c.items.map(p=><button type="button" key={scopedPairKey(p)} className={"min-w-0 rounded-xl border p-3 text-left text-sm "+(state.pair&&scopedPairKey(state.pair)===scopedPairKey(p)?"border-blue-500 bg-blue-50":"border-slate-200")}
      disabled={busy} aria-pressed={!!state.pair&&scopedPairKey(state.pair)===scopedPairKey(p)} onClick={()=>{if(mayLeave())client.selectPair(scopedPairKey(p));}}><span className="block break-words font-semibold">{p.workerName} · {p.workerNo}</span><span className="block break-words">{p.locationName}</span></button>)}</div>
      {!c.items.length&&<p className="text-sm">没有匹配且当前获授权的人员与地点组合。</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>{if(mayLeave())void client.loadContext(state.search);}}>组合首页</button><button type="button" className={button} disabled={busy||!c.nextCursor} onClick={()=>{if(mayLeave())void client.loadContext(state.search,c.nextCursor);}}>组合下一页</button><span className="text-xs text-slate-500">每页最多 25 组，不自动选择</span></div></div>}
    <form aria-label="受限工时查询条件" className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();if(mayLeave())void client.load();}}>
      {access==="manager"&&<p className="break-words text-sm sm:col-span-2">当前组合：{state.pair?state.pair.workerName+" · "+state.pair.locationName:"未选择"}</p>}
      <label className="text-sm">开始日期<input type="date" min="2000-01-01" max="2100-12-31" className={input} required disabled={busy||!c} value={state.fromDate} onChange={e=>{if(mayLeave())client.setDates(e.target.value,state.throughDate);}}/></label>
      <label className="text-sm">结束日期（含）<input type="date" min="2000-01-01" max="2100-12-31" className={input} required disabled={busy||!c} value={state.throughDate} onChange={e=>{if(mayLeave())client.setDates(state.fromDate,e.target.value);}}/></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={busy||!c||(access==="manager"&&!state.pair)}>查询可见工时</button><span className="text-xs text-slate-500">最多 31 个企业当地自然日</span></div></form>
    <p role="status" className={"rounded-xl p-3 text-sm "+(state.phase==="blocked"?"bg-rose-50 text-rose-900":"bg-blue-50 text-blue-900")}>{state.message}</p>
    {state.result&&<Report r={state.result} location={state.pair?.locationName}/>}
    {state.result&&<EventChannels siteId={siteId} actorId={actorId} employeeId={state.result.viewerEmployeeId} access={access} workerId={state.result.workerId} locationId={state.result.locationId} eventIds={state.result.rows.flatMap(row=>row.eventIds)} readKey={state.result.asOf} apiFetch={apiFetch}/>}
    {state.result&&<UnifiedTimesheetLauncher query={access==="self"?{siteId,access,expectedWorkerId:state.result.workerId,fromDate:state.result.fromDate,throughDate:state.result.throughDate}
      :{siteId,access,workerId:state.result.workerId,locationId:state.result.locationId!,fromDate:state.result.fromDate,throughDate:state.result.throughDate}} actorId={actorId} apiFetch={apiFetch} onDenied={client.invalidate} registerLeaveGuard={registerChildGuard}/>}
    {state.result&&<MerchantAttendanceTimesheetExport report={state.result} actorId={actorId} apiFetch={apiFetch} onDenied={client.invalidate}/>}
    <p className="text-xs leading-6 text-slate-500">仅当前页面内存保存；切到后台、关闭、条件变化或查询失败时清除结果。每次请求重新核验权限，无实时撤权推送；授权到期或资料显示满 5 分钟会清除。无后台轮询、自动续期或持久存储。</p>
  </section>;
}
function Report({r,location}:{r:ReturnType<typeof parseScopedTimesheetResponse>;location?:string}){
  return <article aria-label="可见工时查询结果" className="min-w-0 space-y-3 border-t border-slate-200 pt-4">
    <h3 className="break-words font-bold">{r.workerName} · {r.workerNo}{location?" · "+location:""}</h3>
    <p className="text-sm">{r.fromDate} 至 {r.throughDate} · {r.timeZone} · 仅完整可见班次</p>
    <p className="break-all text-xs text-slate-500">核对 UTC：{r.asOf}；姓名、工号和地点为当前标签，不是历史身份快照。</p>
    {!r.moduleEnabled&&<p className="text-sm text-amber-900">新考勤已暂停，本次仅查看既有记录。</p>}
    {!!r.administrativeUnassessedCount&&<p role="status" className="text-sm text-amber-900">{r.administrativeUnassessedCount} 个已行政关闭班次的工时待核定；合计与按日数值仅为已知部分小计，未知不按零计算。</p>}
    {(r.openSessionCount>0||r.periodInProgress)&&<p className="text-sm text-amber-900">{r.openSessionCount} 个可见班次尚未结束，不计入时长。{r.periodInProgress?"所选周期尚未结束，不是最终结算。":""}</p>}
    <div role="region" aria-label="可见工时合计" tabIndex={0} className="max-w-full overflow-x-auto"><table className="w-full min-w-[28rem] text-left text-sm"><caption className="text-left">区间内可见已结束班次合计</caption><thead><tr>{["项目","原始","核定","变化"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{([["workedUs","工作段"],["elapsedUs","起止总时长"],["breakUs","全部休息"],["paidBreakUs","带薪休息标记"]] as const).map(([k,label])=><tr key={k} className="border-t"><th className="p-2">{label}</th><td className="p-2">{duration(r.totals.original[k])}</td><td className="p-2">{duration(r.totals.selected[k])}</td><td className="p-2">{signed(r.totals.difference[k])}</td></tr>)}</tbody></table></div>
    <p className="text-xs">工作段＝起止总时长−全部休息；带薪休息独立列示，不自动加回或换算工资。</p>
    {!!r.skippedDates.length&&<p className="text-sm">时区跳过的自然日，不计缺勤：{r.skippedDates.join("、")}</p>}
    <details className="min-w-0 rounded-xl border p-3"><summary className="cursor-pointer">按日可见工作段（{r.days.length} 天）</summary><div className="max-w-full overflow-x-auto"><table className="w-full min-w-[28rem] text-left text-sm"><thead><tr>{["日期","原始","核定","变化"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{r.days.map(d=><tr key={d.date}><th className="p-2">{d.date}</th><td className="p-2">{duration(d.original.workedUs)}</td><td className="p-2">{duration(d.selected.workedUs)}</td><td className="p-2">{signed(d.selected.workedUs-d.original.workedUs)}</td></tr>)}</tbody></table></div></details>
    {!r.rows.length&&<p className="text-sm">此范围没有可完整查看的相关班次，不据此判断缺勤。</p>}
    {r.rows.map((row,n)=><details className="min-w-0 rounded-xl border p-3" key={row.startEventId}><summary className="cursor-pointer break-all text-sm">{n+1}. {row.original.startAt} · {row.source==="approved"?"已批准补正":"原始记录"}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><Span title="原始完整班次" s={row.original}/><Span title="核定完整班次" s={row.selected}/></div>
      <p className="mt-2 text-xs">本区间原始工作段：{row.originalInPeriod?duration(row.originalInPeriod.workedUs):"行政关闭，待核定"}；核定：{row.selectedInPeriod?duration(row.selectedInPeriod.workedUs):"待核定（不是零工时）"}</p>
      {row.correction&&<p className="mt-2 break-all text-xs leading-6">批准申请：{row.correction.requestId}<br/>操作编号：{row.correction.operationId}<br/>修订 {row.correction.revision} · 规则版本 {row.correction.policyRevision}<br/>核定 UTC：{row.correction.recordedAt}</p>}
      <details className="mt-2 text-xs"><summary>原始动作编号（{row.eventIds.length}）</summary><ol className="max-h-40 overflow-auto">{row.eventIds.map(id=><li className="break-all" key={id}>{id}</li>)}</ol></details></details>)}
  </article>;
}
function Span({s,title}:{s:AttendanceTimesheetRow["original"];title:string}){
  return <div className="min-w-0 rounded-xl bg-slate-50 p-3 text-xs leading-6"><h4 className="font-semibold">{title}</h4><p className="break-all">时区：{s.timeZone}<br/>上班 UTC：{s.startAt}<br/>下班 UTC：{s.endAt??"尚未结束，不推算"}</p><p>完整工作段：{s.totals?duration(s.totals.workedUs):"未计入"}</p>
    <details><summary>休息明细 · {s.breaks.length} 段已结束{s.openBreak?"／1 段进行中":""}</summary>{s.breaks.map((b,n)=><p className="break-all" key={n}>{b.startAt} → {b.endAt} · {b.paid?"带薪标记":"非带薪标记"}</p>)}{s.openBreak&&<p className="break-all">{s.openBreak.startAt} → 尚未结束 · {s.openBreak.paid?"带薪标记":"非带薪标记"}</p>}</details></div>;
}
