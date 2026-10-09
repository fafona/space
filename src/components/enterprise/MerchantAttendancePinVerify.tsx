"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {PIN_VERIFY_API,attendancePin,pinWorkerNo,pinMessage,pinErrorStatuses,parsePinVerification} from "@/lib/merchantAttendancePin";
import {attendanceManagementRequest} from "@/lib/merchantAttendanceManagementClient";
import {PIN_VERIFICATION_GUIDANCE} from "@/lib/merchantAttendanceTerminalGuidance";
export default function MerchantAttendancePinVerify(){
  const [no,setNo]=useState(""),[pin,setPin]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("请先在同一浏览器完成门店终端配对。");
  const controller=useRef<AbortController|null>(null),generation=useRef(0),clearTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{const invalidate=()=>{generation.current++;controller.current?.abort();controller.current=null;if(clearTimer.current)clearTimeout(clearTimer.current);clearTimer.current=null;};
    const hide=()=>{if(document.hidden){invalidate();setBusy(false);setPin("");setNo("");setMessage("资料已清除；不会自动重新验证。");}};
    document.addEventListener("visibilitychange",hide);return()=>{invalidate();document.removeEventListener("visibilitychange",hide);};},[]);
  const verify=async()=>{
    if(controller.current)return;
    let workerNo:string,value:string;try{workerNo=pinWorkerNo(no.trim());value=attendancePin(pin);}catch(e){setMessage(pinMessage(e));return;}
    const g=++generation.current,c=new AbortController();controller.current=c;setBusy(true);setPin("");setNo("");setMessage("正在验证，不会产生打卡记录…");
    if(clearTimer.current)clearTimeout(clearTimer.current);
    try{
      const b=await attendanceManagementRequest((url,init)=>fetch(url,{...init,credentials:"same-origin",redirect:"error"}),PIN_VERIFY_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workerNo,pin:value})},{signal:c.signal,errorStatuses:pinErrorStatuses,maxBytes:4096});
      if(g!==generation.current)return;const {ok,moduleEnabled,...raw}=b;if(ok!==true||moduleEnabled!==true)throw Error("invalid_response");const r=parsePinVerification(raw);
      if(r.workerNo.toLowerCase()!==workerNo.toLowerCase())throw Error("invalid_response");
      setMessage(`已验证：${r.workerName} · ${r.workerNo}。${PIN_VERIFICATION_GUIDANCE}`);
    }catch(e){if(g===generation.current)setMessage(pinMessage(e));}
    finally{value="";if(g===generation.current){controller.current=null;setBusy(false);clearTimer.current=setTimeout(()=>setMessage("验证信息已清除。请输入工号与 PIN；不会自动操作。"),15000);}}
  };
  return <main className="mx-auto min-h-screen max-w-xl space-y-5 p-5 py-10 text-slate-900">
    <h1 className="text-2xl font-bold">门店终端 PIN 验证</h1><p className="rounded-xl bg-amber-50 p-4 text-sm leading-6">试点验证入口，仅验证凭证，不产生上下班记录、不建立员工登录会话。配对不能证明设备实际位于门店，也不是系统锁屏。</p>
    <Link prefetch={false} className="text-sm underline" href="/enterprise/attendance-terminal">返回终端配对／撤销状态</Link>
    <form className="space-y-4 rounded-xl border border-slate-300 p-5" onSubmit={e=>{e.preventDefault();void verify();}}>
      <label className="block text-sm">考勤工号<input className="mt-2 w-full rounded-xl border p-3" autoComplete="off" maxLength={40} value={no} disabled={busy} onChange={e=>setNo(e.target.value)}/></label>
      <label className="block text-sm">员工 PIN<input className="mt-2 w-full rounded-xl border p-3" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={pin} disabled={busy} onChange={e=>setPin(e.target.value)}/></label>
      <button className="rounded-xl bg-slate-900 px-4 py-3 text-white disabled:opacity-40" disabled={busy||!no.trim()||!/^\d{8,12}$/.test(pin)}>验证 PIN（不打卡）</button>
    </form><p role="status" className="text-sm leading-6">{message}</p>
    <p className="text-xs leading-6 text-slate-500">每个工号 15 分钟最多验证 10 次，每台终端每分钟最多 60 次，成功与失败均计数。切换页面清除输入，验证结果 15 秒后隐藏。不保存 PIN，不下载员工名单，也不自动重试。</p>
  </main>;
}
