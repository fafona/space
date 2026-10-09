"use client";
import {useEffect,useMemo,useSyncExternalStore} from "react";
import {AttendanceSessionClient} from "@/lib/merchantAttendanceSessionClient";
import {formatAttendanceDurationUs} from "@/lib/merchantAttendanceSession";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
import EventChannels from "./MerchantAttendanceEventChannels";
type Props={siteId:string;employeeId:string;startEventId:string;expectedWorkerId?:string;apiFetch:AttendanceApiFetch;onIdentityInvalidated?:(startEventId:string)=>void};
export default function MerchantAttendanceSessionPanel(props:Props){return <SessionScreen key={`${props.siteId}:${props.employeeId}:${props.startEventId}`} {...props}/>;}
function SessionScreen(props:Props){
  const {siteId,employeeId,startEventId,expectedWorkerId,apiFetch,onIdentityInvalidated}=props;
  const client=useMemo(()=>new AttendanceSessionClient({siteId,employeeId,startEventId,expectedWorkerId,apiFetch,
    onIdentityInvalidated:()=>onIdentityInvalidated?.(startEventId)}),[siteId,employeeId,startEventId,expectedWorkerId,apiFetch,onIdentityInvalidated]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),r=state.report;
  useEffect(()=>{void client.initialize();const visible=()=>{if(document.visibilityState==="hidden")client.invalidate();else void client.load();};
    document.addEventListener("visibilitychange",visible);return()=>{document.removeEventListener("visibilitychange",visible);client.dispose();};},[client]);
  const at=(value:string)=>r?new Intl.DateTimeFormat("zh-CN",{timeZone:r.timeZone,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"shortOffset",hourCycle:"h23"}).format(new Date(value)):value;
  return <section className="mt-4 min-w-0 space-y-3 rounded-xl border border-blue-200 bg-white p-4" aria-label="本人班次核对">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-bold">本班次工作／休息核对</h4><button type="button" disabled={state.phase==="loading"} onClick={()=>void client.load()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">重新核对</button></div>
    <p role="status" className={`rounded-lg p-3 text-sm ${state.phase==="blocked"?"bg-rose-50 text-rose-900":"bg-blue-50 text-blue-900"}`}>{state.message}</p>
    {r&&state.result&&<>
      {state.result.administrativeBoundary&&<p className="rounded-xl bg-amber-50 p-3 text-sm" role="status">本班次已行政关闭，工时仍待核定。未补造下班记录，不计算为零工时；核验边界仅用于分段，不是工时终点。</p>}
      {state.result.predecessorBoundary&&<p className="text-xs text-slate-500">上一原始班次已行政关闭；本班次独立核对，不续接上一班次的未知工时。</p>}
      <EventChannels siteId={siteId} actorId={employeeId} employeeId={employeeId} access="self" workerId={state.result.workerId} eventIds={state.result.events.map(item=>item.id)} readKey={state.result.asOf} apiFetch={apiFetch}/>
      <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">上班记录</dt><dd>{at(r.startAt)}</dd></div><div><dt className="text-slate-500">下班记录</dt><dd>{r.endAt?at(r.endAt):r.status==="break"?"未下班，最近记录为休息中":"未下班，最近记录为工作中"}</dd></div></dl>
      <p className="text-xs leading-5 text-slate-500">按上班记录时区 {r.timeZone} 分日；整次班次不受历史列表日期和分页截断。这里是原始记录核对，不代表当前审批或实际在岗证明。</p>
      {r.totals&&<><div className="grid gap-2 sm:grid-cols-2">{([
        ["上下班间隔",r.totals.elapsedUs],["工作段合计（扣除所有已记休息）",r.totals.workedUs],
        ["全部已记休息",r.totals.breakUs],["其中有带薪标记的休息",r.totals.paidBreakUs],
      ] as const).map(([label,value])=><div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold">{formatAttendanceDurationUs(value)}</p></div>)}</div>
        <div className="space-y-2"><h5 className="text-sm font-semibold">按自然日拆分</h5>{r.days.length?r.days.map(day=><div key={day.date} className="rounded-lg border border-slate-200 p-3 text-sm"><p className="font-semibold">{day.date}</p><p className="mt-1">工作段 {formatAttendanceDurationUs(day.workedUs)} · 休息 {formatAttendanceDurationUs(day.breakUs)}</p></div>):<p className="text-sm">上下班时间相同，已记录间隔为 0；请核查是否误操作。</p>}</div></>}
      <details className="text-sm"><summary className="cursor-pointer">休息明细（已结束 {r.breaks.length} 次{r.openBreak?"，另有未结束休息":""}）</summary>
        <div className="mt-2 max-h-64 space-y-2 overflow-auto">{r.breaks.map((b,n)=><div key={n} className="rounded-lg bg-slate-50 p-2"><p>{n+1}. {at(b.startAt)} → {at(b.endAt)} · {b.paid?"带薪标记":"非带薪标记"}</p><p className="mt-1 break-all text-xs text-slate-500">UTC：{b.startAt} → {b.endAt}</p></div>)}
          {r.openBreak&&<p className="rounded-lg bg-amber-50 p-2">{at(r.openBreak.startAt)} 开始的休息尚未结束；不补造结束时间。</p>}</div>
      </details>
      <details className="text-xs text-slate-500"><summary className="cursor-pointer">原始时间与核对边界</summary><p className="mt-2 break-all leading-6">上班 UTC：{r.startAt}<br/>下班 UTC：{r.endAt??"未记录"}<br/>读取时间 UTC：{state.result.asOf}<br/>读取 {state.result.events.length} 条原始记录；保留微秒精度、不按分钟取整。每次最多 2,002 条、1,000 次休息，已结束班次最多 31 天。</p></details>
      {!state.result.moduleEnabled&&<p className="text-xs text-amber-800">新考勤已暂停；本次仅按当前本人权限核对既有记录。</p>}
    </>}
    <p className="text-xs leading-5 text-slate-500">不计算应出勤、加班或工资，不自动扣休息、不补卡；异常需后续补正／审批流程处理。工作段不包含任何休息，带薪标记另列，不代表工资规则。</p>
  </section>;
}
