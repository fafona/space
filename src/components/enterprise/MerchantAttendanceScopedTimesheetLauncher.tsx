"use client";
import {lazy,Suspense,useState} from "react";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
const Panel=lazy(()=>import("./MerchantAttendanceScopedTimesheetPanel"));
export type ScopedTimesheetProps={siteId:string;actorId:string;access:"self"|"manager";apiFetch:AttendanceApiFetch;registerLeaveGuard?:(guard:(()=>boolean)|null)=>void};
export default function MerchantAttendanceScopedTimesheetLauncher({enabled=process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCOPED_TIMESHEET_ENABLED==="1",...props}:ScopedTimesheetProps&{enabled?:boolean}){
  return enabled?<Launcher key={props.siteId+":"+props.actorId+":"+props.access} {...props}/>:null;
}
function Launcher(props:ScopedTimesheetProps){
  const [open,setOpen]=useState(false);
  return open?<Suspense fallback={<p role="status">正在加载只读工时核对…</p>}><Panel {...props} onClose={()=>setOpen(false)}/></Suspense>:
    <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold" onClick={()=>setOpen(true)}>{props.access==="self"?"我的周期工时核对":"授权范围工时核对"}</button>;
}
