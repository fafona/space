"use client";
import {useLayoutEffect,useMemo,useSyncExternalStore} from "react";
import {AttendanceAuditExportClient} from "@/lib/merchantAttendanceAuditExportClient";
import {attendanceHistoryDateQuery} from "@/lib/merchantAttendanceHistoryClient";
import type {AttendanceAuditSource} from "@/lib/merchantAttendanceAudit";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";

type Props={siteId:string;start:string;end:string;zone:string;source:AttendanceAuditSource;apiFetch:AttendanceApiFetch;onDenied:()=>void};
export default function MerchantAttendanceAuditExport(props:Props){
  const {siteId,start,end,zone,source,apiFetch,onDenied}=props;
  const client=useMemo(()=>new AttendanceAuditExportClient({siteId,apiFetch,onDenied,
    available:()=>document.visibilityState==="visible",
    deliver:({csv,filename})=>{
      const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
      const anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.hidden=true;
      try{document.body.append(anchor);anchor.click();}finally{
        anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    }}),[siteId,apiFetch,onDenied]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
  useLayoutEffect(()=>{const hidden=()=>{if(document.visibilityState==="hidden")client.invalidate();};
    document.addEventListener("visibilitychange",hidden);
    return()=>{document.removeEventListener("visibilitychange",hidden);client.invalidate();};},[client]);
  useLayoutEffect(()=>{client.invalidate();},[client,start,end,zone,source]);
  return <aside className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="导出考勤配置变更">
    <h4 className="text-sm font-semibold">导出配置变更 CSV</h4>
    <p className="text-xs leading-5 text-slate-500">使用上方当前日期、时区及记录类型，最多 250 条／约 1.5 MiB 数据。包含当时的修改前后值，仅当前负责人可导出。文件含人员资料，请妥善保管。</p>
    <p className="text-xs leading-5 text-slate-500">不含打卡工时、定位政策／坐标或异常说明；不是工资报表。导出是本次读取可见的快照，迟到提交的记录须另行重查。</p>
    <button type="button" disabled={state.phase==="loading"} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40" onClick={()=>{
      try{const q=attendanceHistoryDateQuery(siteId,start,end,zone);void client.download({siteId,source,fromAt:q.fromAt,toAt:q.toAt});}
      catch{client.invalidInput();}
    }}>{state.phase==="loading"?"正在准备…":"导出当前条件 CSV"}</button>
    <p role="status" className={`text-xs leading-5 ${state.phase==="blocked"?"text-rose-700":"text-slate-500"}`}>{state.message}</p>
  </aside>;
}
