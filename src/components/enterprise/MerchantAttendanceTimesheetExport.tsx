"use client";
import {useEffect,useMemo,useState,useSyncExternalStore} from "react";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
import type {TimesheetExportReport,TimesheetExportCommand} from "@/lib/merchantAttendanceTimesheetExport";
import {AttendanceTimesheetExportClient} from "@/lib/merchantAttendanceTimesheetExportClient";
import MerchantAttendancePrint from "./MerchantAttendancePrint";
type Props={report:TimesheetExportReport;actorId:string;apiFetch:AttendanceApiFetch;onDenied:()=>void;enabled?:boolean;printEnabled?:boolean};
export default function MerchantAttendanceTimesheetExport(props:Props){
  if(!(props.enabled??process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_TIMESHEET_EXPORT_ENABLED==="1"))return null;
  const r=props.report,access="access" in r?r.access:"owner";
  const selection:Omit<TimesheetExportCommand,"operationId">={siteId:r.siteId,query:{access,workerId:access==="self"?null:r.workerId,
    expectedWorkerId:access==="self"?r.workerId:null,locationId:"locationId" in r?r.locationId:null,expectedScopeRevision:"scopeRevision" in r?r.scopeRevision:null,
    fromDate:r.fromDate,throughDate:r.throughDate,expectedTimeZone:r.timeZone}};
  const serialized=JSON.stringify(selection);
  return <><Export key={props.actorId+":"+serialized+":"+r.asOf} {...props} serialized={serialized}/>
    <MerchantAttendancePrint kind="timesheet" selection={selection} actorId={props.actorId} apiFetch={props.apiFetch}
      onDenied={props.onDenied} contextKey={r.asOf} enabled={props.printEnabled}/></>;
}
function Export({actorId,apiFetch,onDenied,serialized}:Props&{serialized:string}){
  const client=useMemo(()=>new AttendanceTimesheetExportClient({selection:JSON.parse(serialized),actorId,apiFetch,onDenied,
    available:()=>document.visibilityState!=="hidden",deliver:file=>{
      const blob=new Blob([file.csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),anchor=document.createElement("a");
      try{anchor.href=url;anchor.download=file.filename;anchor.hidden=true;document.body.append(anchor);anchor.click();}
      finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }}),[serialized,actorId,apiFetch,onDenied]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),[ack,setAck]=useState(false);
  useEffect(()=>{const hide=()=>{client.invalidate();setAck(false);};const visibility=()=>{if(document.visibilityState==="hidden")hide();};
    document.addEventListener("visibilitychange",visibility);window.addEventListener("pagehide",hide);
    return()=>{document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",hide);client.invalidate();};},[client]);
  return <section aria-label="受控工时导出" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <h3 className="font-semibold">导出工时 CSV</h3>
    <p className="text-xs leading-6 text-slate-600">独立导出权限，每次重新核验。包含原始／核定汇总、日明细、班次、休息和批准来源；不是工资结算表。服务器只记录来源读取凭据，不存整份文件。</p>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ack} disabled={state.phase==="loading"} onChange={e=>setAck(e.target.checked)}/>
      我了解文件包含人员工时，下载后无法通过撤销平台权限收回，会妥善保管。</label>
    <button type="button" disabled={!ack||state.phase==="loading"} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40"
      onClick={()=>{void client.download(ack).finally(()=>setAck(false));}}>{state.phase==="loading"?"正在生成…":state.operationId?"再次生成新文件":"生成并下载 CSV"}</button>
    <p role="status" className="text-sm leading-6">{state.message}</p>{state.operationId&&<p className="break-all text-xs text-slate-500">本次编号：{state.operationId}（不是文件保存凭据）</p>}
  </section>;
}
