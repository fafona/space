"use client";
import {useEffect,useMemo,useState,useSyncExternalStore} from "react";
import Link from "next/link";
import {AttendancePinClockClient} from "@/lib/merchantAttendancePinClockClient";
import {AttendancePinScheduleClient,pinScheduleOwnsInput} from "@/lib/merchantAttendancePinScheduleClient";
import type {AttendanceAction} from "@/lib/merchantAttendance";
import {pinClockMessage} from "@/lib/merchantAttendancePinClock";
import MerchantAttendanceTerminalRecovery from "./MerchantAttendanceTerminalRecovery";
import MerchantAttendancePinScheduleClock from "./MerchantAttendancePinScheduleClock";
import OperationalPunchWorkspace from "./MerchantAttendanceOperationalPunchWorkspace";
import { operationalPunchPendingKey } from "@/lib/merchantAttendanceOperationalPunchClient";
import { pinWorkerNo } from "@/lib/merchantAttendancePin";
const operationalFetch = (url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "same-origin", redirect: "error" });
export default function MerchantAttendancePinClock({recoveryUrl,pinScheduleEnabled=process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PIN_SCHEDULE_ENABLED==="1"}:{recoveryUrl?:string|null;pinScheduleEnabled?:boolean}={}){
  const client=useMemo(()=>new AttendancePinClockClient({apiFetch:(url,init)=>fetch(url,{...init,credentials:"same-origin",redirect:"error"}),storage:()=>sessionStorage}),[]);
  const schedule=useMemo(()=>new AttendancePinScheduleClient({enabled:pinScheduleEnabled,apiFetch:(url,init)=>fetch(url,{...init,credentials:"same-origin",redirect:"error"}),storage:()=>sessionStorage}),[pinScheduleEnabled]);
  const scheduleState=useSyncExternalStore(schedule.subscribe,schedule.getSnapshot,schedule.getSnapshot),[owner,setOwner]=useState<"old"|"schedule">("old");
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),[no,setNo]=useState(""),[pin,setPin]=useState("");
  const [operationalNo,setOperationalNo]=useState<string|null>(null);
  useEffect(()=>{void client.initialize();const hide=()=>{if(document.hidden){client.clear();setNo("");setPin("");}};document.addEventListener("visibilitychange",hide);return()=>{client.dispose();document.removeEventListener("visibilitychange",hide);};},[client]);
  useEffect(()=>{const clear=()=>{schedule.clear();client.clear();setNo("");setPin("");};const hide=()=>{if(document.hidden)clear();};document.addEventListener("visibilitychange",hide);window.addEventListener("pagehide",clear);return()=>{schedule.dispose();client.clear();document.removeEventListener("visibilitychange",hide);window.removeEventListener("pagehide",clear);};},[schedule,client]);
  const busy=state.phase==="loading"||state.phase==="saving"||scheduleState.phase==="loading"||scheduleState.phase==="saving",r=owner==="old"?state.result:null;
  const clear=()=>{client.clear();schedule.clear();setNo("");setPin("");setOwner("old");};
  const read=(workerNo:string,value:string)=>{if(document.hidden||busy||!state.device)return;
    try { const scope={siteId:state.device.siteId,channel:"pin" as const,authUserId:null,terminalId:state.device.terminalId,workerNo};
      if(sessionStorage.getItem(operationalPunchPendingKey(scope))!==null){client.clear();schedule.clear();setOperationalNo(pinWorkerNo(workerNo));return;}
    } catch { client.clear();schedule.clear();return; }
    if(pinScheduleOwnsInput(pinScheduleEnabled,state.device,workerNo,()=>sessionStorage)){client.clear();setOwner("schedule");void schedule.read(workerNo,value,state.device);}
    else{schedule.clear();setOwner("old");void client.read(workerNo,value);}};
  const punch=(action:AttendanceAction|null)=>{if(document.hidden||busy)return;if(state.device&&r&&pinScheduleOwnsInput(false,state.device,r.workerNo,()=>sessionStorage)){client.clear();schedule.clear();setOwner("schedule");return;}void client.punch(action);};
  const button="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm disabled:opacity-40";
  if(operationalNo&&state.device)return <main className="mx-auto min-h-screen max-w-2xl space-y-5 p-5 py-8 text-slate-900"><h1 className="text-2xl font-bold">门店 PIN 规则打卡</h1>
    <p className="break-words text-sm">{state.device.label} · 工号 {operationalNo} · 请重新输入本人 PIN</p>
    <OperationalPunchWorkspace key={`${state.device.siteId}:${state.device.terminalId}:${operationalNo}`} scope={{siteId:state.device.siteId,channel:"pin",authUserId:null,terminalId:state.device.terminalId,workerNo:operationalNo}}
      apiFetch={operationalFetch} onClose={()=>{clear();setOperationalNo(null);}}/>
  </main>;
  return <main className="mx-auto min-h-screen max-w-2xl space-y-5 p-5 py-8 text-slate-900">
    <h1 className="text-2xl font-bold">门店 PIN 打卡</h1>
    <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6">仅在线打卡，以服务器时间为准。配对设备不代表真实到场；需要定位验证的地点不能用此入口绕过。</p>
    <div className="flex flex-wrap items-center gap-3"><Link prefetch={false} className="text-sm underline" href="/enterprise/attendance-terminal">终端配对／撤销状态</Link><button className={button} disabled={busy} onClick={()=>{clear();void client.initialize();}}>重新检查设备</button></div>
    {state.device&&<p className="break-words text-sm">{state.device.label} · 企业 {state.device.siteId}</p>}
    <form className="space-y-4 rounded-2xl border border-slate-300 bg-white p-5" onSubmit={e=>{e.preventDefault();const a=no,b=pin;setNo("");setPin("");read(a,b);}}>
      <label className="block text-sm">考勤工号<input className="mt-2 w-full min-w-0 rounded-xl border p-3" value={no} maxLength={40} autoComplete="off" disabled={busy||!state.device} onChange={e=>{client.clear();schedule.clear();setNo(e.target.value);}}/></label>
      <label className="block text-sm">员工 PIN<input className="mt-2 w-full min-w-0 rounded-xl border p-3" value={pin} type="password" inputMode="numeric" maxLength={12} autoComplete="off" disabled={busy||!state.device} onChange={e=>{client.clear();schedule.clear();setPin(e.target.value);}}/></label>
      <button className={button+" font-semibold"} disabled={busy||!state.device||!no.trim()||!/^\d{8,12}$/.test(pin)}>验证并读取／核对原操作</button>
      <button type="button" className={button} disabled={busy||!state.device||!no.trim()} onClick={()=>{
        if(document.hidden||!state.device)return;
        try{const workerNo=pinWorkerNo(no);if(!window.confirm("打开规则打卡将清除当前 PIN 和未提交选择。请在新操作区重新输入本人 PIN；不会自动打卡。"))return;clear();setOperationalNo(workerNo);}catch{setNo("");setPin("");}
      }}>规则打卡／原号核对</button>
    </form>
    {owner==="old"&&<p role="status" className="break-words text-sm leading-6">{state.message}</p>}
    <MerchantAttendanceTerminalRecovery url={recoveryUrl}/>
    {owner==="schedule"&&<MerchantAttendancePinScheduleClock client={schedule} enabled={pinScheduleEnabled} onClear={clear}/>}
    {r&&<section aria-label="当前员工打卡状态" className="space-y-4 rounded-2xl border border-blue-200 bg-blue-50 p-5">
      <h2 className="break-words font-bold">{r.workerName} · {r.workerNo}</h2><p>当前：{{off:"未上班",working:"工作中",break:"休息中"}[r.state.status]} · 顺序 {r.state.sequence}</p>
      {r.receipt&&<p className="break-all text-sm">服务器收据时间：{r.receipt.occurredAt}（UTC）</p>}
      {r.blockReason&&<p className="text-sm">{pinClockMessage(r.blockReason)}</p>}
      {state.phase==="ready"&&<div className="flex flex-wrap gap-3">
        {r.state.status==="off"&&<button className={button} disabled={!r.canStart} onClick={()=>punch("clock_in")}>确认上班</button>}
        {r.state.status==="working"&&<><button className={button} disabled={!r.canStart} onClick={()=>punch("break_start")}>确认开始休息</button><button className={button} disabled={!r.canFinish} onClick={()=>punch("clock_out")}>确认下班</button></>}
        {r.state.status==="break"&&<button className={button} disabled={!r.canFinish} onClick={()=>punch("break_end")}>确认结束休息</button>}
        {!r.canStart&&r.canFinish&&<p className="text-sm">暂停新上班／休息，仍可结束已有休息并下班。</p>}
      </div>}
      {state.phase==="unconfirmed"&&<button className={button} onClick={()=>punch(null)}>按原编号重试原动作</button>}
      <button className={button} disabled={busy} onClick={clear}>清除资料／下一位</button>
    </section>}
    <p className="text-xs leading-6 text-slate-500">验证后 PIN 仅在页面内存保留最多 30 秒，供您确认一个动作；提交后、切换标签页或离开时清除，不保存为登录凭证。待核对时仅在本标签页保存工号、设备和操作编号等非秘密信息；再次输入本人 PIN 才能读取结果。成功提示 15 秒后隐藏。不自动重试、不离线补传。</p>
  </main>;
}
