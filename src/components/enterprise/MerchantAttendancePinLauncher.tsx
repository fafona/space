"use client";
import {lazy,Suspense,useState} from "react";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
const Panel=lazy(()=>import("./MerchantAttendancePinAdmin"));
export default function MerchantAttendancePinLauncher(props:{siteId:string;apiFetch:AttendanceApiFetch}){
  const [open,setOpen]=useState(false);
  if(process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_ENABLED!=="1")return null;
  return open?<Suspense fallback={<p role="status">正在加载 PIN 管理…</p>}><Panel {...props}/></Suspense>
    :<button type="button" className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold" onClick={()=>setOpen(true)}>管理员工终端 PIN</button>;
}
