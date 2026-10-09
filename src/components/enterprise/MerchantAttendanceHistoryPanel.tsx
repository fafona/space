"use client";

import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from "react";
import {AttendanceHistoryClient,attendanceHistoryDateQuery} from "@/lib/merchantAttendanceHistoryClient";
import {attendanceManagementMessage} from "@/lib/merchantAttendanceManagementClient";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
import EventChannels from "./MerchantAttendanceEventChannels";

const button="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-40";
const input="mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const actions={clock_in:"上班",break_start:"开始休息",break_end:"结束休息",clock_out:"下班"};
const SessionPanel=lazy(()=>import("./MerchantAttendanceSessionPanel"));
type Props={siteId:string;employeeId:string;apiFetch:AttendanceApiFetch;onRequestCorrection?:(startEventId:string)=>void};
export default function MerchantAttendanceHistoryPanel(props:Props) {
  return <HistoryScreen key={`${props.siteId}:${props.employeeId}`} {...props}/>;
}
function HistoryScreen({siteId,employeeId,apiFetch,onRequestCorrection}:Props) {
  const client=useMemo(()=>new AttendanceHistoryClient({siteId,employeeId,apiFetch}),[siteId,employeeId,apiFetch]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
  const [start,setStart]=useState(()=>new Date(Date.now()-6*86400000).toISOString().slice(0,10));
  const [end,setEnd]=useState(()=>new Date().toISOString().slice(0,10));
  const [zone,setZone]=useState("UTC"),[displayZone,setDisplayZone]=useState("UTC"),[error,setError]=useState("");
  const [sessionId,setSessionId]=useState<string|null>(null);
  const selectedSession=useRef<string|null>(null);
  const closeSession=useCallback(()=>{selectedSession.current=null;setSessionId(null);},[]);
  const onSessionIdentityInvalidated=useCallback((startEventId:string)=>{
    if(selectedSession.current!==startEventId||!client.invalidateFromSession(state.result))return;
    closeSession();setError("");
  },[client,state.result,closeSession]);
  useEffect(()=>{
    const visible=()=>{closeSession();if(document.visibilityState==="hidden")client.invalidate();else void client.refresh();};
    document.addEventListener("visibilitychange",visible);
    return ()=>{selectedSession.current=null;document.removeEventListener("visibilitychange",visible);client.invalidate();};
  },[client,closeSession]);
  const busy=state.phase==="loading";
  return <section className="min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6" aria-label="本人历史打卡">
    <header><h3 className="text-lg font-bold">本人历史打卡</h3><p className="mt-1 text-sm leading-6 text-slate-500">仅查看当前本人档案中明确归属于本员工身份的原始记录；旧归属不明或有缺漏时请联系负责人核验，不需要主管明细权限。</p></header>
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={e=>{
      e.preventDefault();closeSession();try {const query=attendanceHistoryDateQuery(siteId,start,end,zone);setError("");setDisplayZone(zone);void client.load(query);}
      catch(error){client.invalidate(true);setError(attendanceManagementMessage(error));}
    }}>
      <label className="min-w-0 text-sm">开始日期<input type="date" className={input} value={start} onChange={e=>setStart(e.target.value)} required/></label>
      <label className="min-w-0 text-sm">结束日期（含当天）<input type="date" className={input} value={end} onChange={e=>setEnd(e.target.value)} required/></label>
      <label className="min-w-0 text-sm">查询／显示时区<input className={input} list="attendance-history-zones" value={zone} onChange={e=>setZone(e.target.value)} required/>
        <datalist id="attendance-history-zones">{["UTC","Europe/Madrid","Atlantic/Canary","Asia/Shanghai","America/New_York"].map(z=><option key={z} value={z}/>)}</datalist></label>
      <div className="flex items-end"><button type="submit" className={`${button} w-full`} disabled={busy}>查询本人记录</button></div>
    </form>
    <p className="text-xs leading-5 text-slate-500">一次最多 30 个自然日，每页最多 50 条。UTC 为默认查询时区，不代表门店时区。</p>
    <div role="status" className={`rounded-xl border p-3 text-sm ${error||state.phase==="blocked"?"border-rose-200 bg-rose-50 text-rose-900":"border-blue-100 bg-blue-50 text-blue-900"}`}>
      {error||state.message}{state.result&&!state.result.moduleEnabled&&<p className="mt-1">平台暂停新考勤，历史仍按本人当前权限提供。</p>}
    </div>
    {state.result&&<>
      <p className="text-xs leading-5 text-slate-500">显示时区：{displayZone}。人员、工号和地点名称为当前标签；时间和动作是原始记录。</p>
      <EventChannels siteId={siteId} actorId={employeeId} employeeId={employeeId} access="self" workerId={state.result.workerId} eventIds={state.result.items.map(item=>item.id)} readKey={state.result.asOf} apiFetch={apiFetch}/>
      <div className="space-y-3">{state.result.items.map(record=><article key={record.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words font-semibold">{record.workerName} · {record.workerNo}</p><p className="mt-1 break-words text-sm">{record.locationName}</p></div>
          <span className="rounded-lg bg-white px-3 py-1 text-sm font-semibold text-blue-800">{actions[record.action]}</span></div>
        <p className="mt-2 text-sm">{new Intl.DateTimeFormat("zh-CN",{timeZone:displayZone,dateStyle:"medium",timeStyle:"medium",hourCycle:"h23"}).format(new Date(record.occurredAt))}</p>
        <p className="mt-1 text-xs text-slate-500">{record.source==="web"?"网页打卡":"终端打卡"} · 序号 {record.sequence}{record.breakPaid===null?"":record.breakPaid?" · 带薪休息标记":" · 非带薪休息标记"}</p>
        <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">原始时间与记录编号</summary><p className="mt-2 break-all leading-6">UTC：{record.occurredAt}<br/>原记录时区：{record.timeZone}<br/>记录编号：{record.id}</p></details>
        {record.action==="clock_in"&&<button type="button" className={`${button} mt-3`} aria-expanded={sessionId===record.id} onClick={()=>{const next=sessionId===record.id?null:record.id;selectedSession.current=next;setSessionId(next);}}>{sessionId===record.id?"收起本班次核对":"核对本班次工作／休息"}</button>}
        {onRequestCorrection&&record.action==="clock_in"&&<button type="button" className={`${button} mt-3 ml-2`} onClick={()=>onRequestCorrection(record.id)}>选择本班次申请补正</button>}
        {record.action==="clock_in"&&sessionId===record.id&&<Suspense fallback={<p role="status" className="mt-3 text-sm">正在加载班次核对…</p>}><SessionPanel siteId={siteId} employeeId={employeeId} startEventId={record.id} expectedWorkerId={record.workerId} apiFetch={apiFetch} onIdentityInvalidated={onSessionIdentityInvalidated}/></Suspense>}
      </article>)}</div>
    </>}
    <div className="flex flex-wrap gap-3"><button className={button} disabled={busy||!state.query||!!error} onClick={()=>{closeSession();void client.refresh(true);}}>重新查询首页</button>
      <button className={button} disabled={busy||!state.result?.nextCursor||!!error} onClick={()=>{closeSession();void client.next();}}>下一页</button></div>
    <p className="text-xs leading-5 text-slate-500">只保留当前页，切回页面重新核验权限。新打卡或延迟提交的记录请重新查询首页；这里不是工资计算、正式报表或导出快照。如有缺漏，请联系负责人核对，不会自动补造打卡。</p>
  </section>;
}
