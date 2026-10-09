"use client";
import {useEffect,useRef,useState} from "react";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
import {attendanceManagementRequest} from "@/lib/merchantAttendanceManagementClient";
import {PIN_ADMIN_API,parsePinStatus,attendancePin,pinWorkerNo,pinErrorStatuses,pinMessage,type PinStatus,type PinQuery,type PinCommand} from "@/lib/merchantAttendancePin";
import {PIN_ADMIN_GUIDANCE} from "@/lib/merchantAttendanceTerminalGuidance";
const button="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40",input="mt-2 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-3";
export default function MerchantAttendancePinAdmin({siteId,apiFetch}:{siteId:string;apiFetch:AttendanceApiFetch}){
  const [workerNo,setWorkerNo]=useState(""),[pin,setPin]=useState(""),[show,setShow]=useState(false),[ack,setAck]=useState(false);
  const [data,setData]=useState<PinStatus|null>(null),[pending,setPending]=useState<PinQuery|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("输入准确考勤工号，只读取一名员工。");
  const controller=useRef<AbortController|null>(null),generation=useRef(0),moduleEnabled=useRef(false);
  useEffect(()=>{if(!busy&&!pending)return;const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[busy,pending]);
  useEffect(()=>{const invalidate=()=>{generation.current++;controller.current?.abort();controller.current=null;};
    const hide=()=>{if(document.hidden){invalidate();setBusy(false);setPin("");setShow(false);setAck(false);setData(null);setMessage("资料已隐藏；返回后请核对原操作。PIN 不保存在浏览器存储中。");}};
    document.addEventListener("visibilitychange",hide);return()=>{invalidate();document.removeEventListener("visibilitychange",hide);};},[]);
  async function request(query:PinQuery,command:PinCommand|null=null){
    if(controller.current)return;
    const g=++generation.current,c=new AbortController();controller.current=c;setBusy(true);setData(null);setPin("");setShow(false);setAck(false);
    if(command)setPending({...query,operationId:command.operationId});
    try{
      const params=new URLSearchParams({siteId,workerNo:query.workerNo});if(query.operationId)params.set("operationId",query.operationId);
      const b=await attendanceManagementRequest(apiFetch,PIN_ADMIN_API+(command?"":"?"+params),command?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({siteId,workerNo:query.workerNo,command})}:{},
        {signal:c.signal,errorStatuses:pinErrorStatuses,maxBytes:8192});
      if(g!==generation.current)return;const {ok,moduleEnabled:enabled,...raw}=b;if(ok!==true||typeof enabled!=="boolean")throw Error("invalid_response");
      const status=parsePinStatus(raw,{...query,operationId:command?.operationId??query.operationId});
      if(command&&(!status.receipt||status.receipt.action!==command.action||status.receipt.revision!==command.expectedRevision+1))throw Error("receipt_mismatch");
      moduleEnabled.current=enabled;setData(status);setWorkerNo(status.workerNo);
      if(status.receipt){setPending(null);setMessage(`原操作已确认（版本 ${status.receipt.revision}）；下方为当前版本 ${status.revision}。不会恢复已撤销或已被重置的旧 PIN。`);}
      else setMessage(query.operationId?"尚未查到原操作，不能判定未提交。可继续核对，或明确重新读取当前版本并设置一个全新 PIN。":"已读取当前状态。设置／重置后旧 PIN 立即失效；不修改网页密码或原始打卡。");
    }catch(e){if(g===generation.current)setMessage(pinMessage(e));}
    finally{if(g===generation.current){controller.current=null;setBusy(false);}}
  }
  const read=()=>{try{void request(pending??{siteId,workerNo:pinWorkerNo(workerNo.trim()),operationId:null});}catch(e){setMessage(pinMessage(e));}};
  const save=(action:"set"|"revoke")=>{
    if(!data||busy||pending||!ack)return;
    try{
      const command:PinCommand={action,operationId:crypto.randomUUID(),expectedRevision:data.revision,workerId:data.workerId,employeeId:data.employeeId};
      if(action==="set"){command.pin=attendancePin(pin);command.salt=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("");}
      void request({siteId,workerNo:data.workerNo,operationId:null},command);
    }catch(e){setMessage(pinMessage(e));}
  };
  return <section aria-label="员工终端 PIN 管理" className="space-y-4 rounded-xl border border-slate-300 p-4">
    <h4 className="font-bold">员工终端 PIN · 独立于网页登录密码</h4>
    <p className="text-sm leading-6">{PIN_ADMIN_GUIDANCE}</p>
    <label className="block text-sm">考勤工号<input className={input} value={workerNo} maxLength={40} disabled={busy||!!pending} onChange={e=>{setWorkerNo(e.target.value);setData(null);setPin("");setAck(false);}}/></label>
    <button className={button} disabled={busy||!workerNo.trim()} onClick={read}>{pending?"核对原 PIN 操作":"读取员工 PIN 状态"}</button>
    <p role="status" className="break-words text-sm leading-6">{message}</p>
    {pending&&<div className="space-y-2 text-sm"><p className="break-all">待核对编号：{pending.operationId}</p><button className={button} disabled={busy} onClick={()=>{
      if(window.confirm("原操作可能仍在提交。不会重试旧 PIN；重新读取后，可按当前版本明确设置全新 PIN。旧、新提交同时到达时仅一个版本可成功。继续？")){
        const q={...pending,operationId:null};setPending(null);void request(q);
      }
    }}>重新读取后设置全新 PIN</button></div>}
    {data&&<div className="space-y-3"><p className="break-words">{data.workerName} · {data.workerNo} · 版本 {data.revision} · {data.enabled&&data.bindingCurrent?"已设置":"未设置／已撤销或绑定已变更"}</p>
      <p className="text-xs">{data.ready?"当前成员和打卡权限有效":"当前成员或打卡权限不满足；仍可撤销原凭证"}</p>
      <fieldset disabled={busy||!!pending} className="space-y-3">
        <label className="block text-sm">新 PIN（8–12 位数字）<input className={input} type={show?"text":"password"} inputMode="numeric" autoComplete="new-password" maxLength={12} value={pin} onChange={e=>{setPin(e.target.value);setAck(false);}}/></label>
        <label className="mr-4 text-sm"><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/> 显示当前输入</label>
        <button type="button" className={button} onClick={()=>{let result="";while(result.length<8){const n=crypto.getRandomValues(new Uint8Array(1))[0];if(n<250)result+=String(n%10);}setPin(result);setShow(true);setAck(false);}}>生成随机 8 位 PIN</button>
        <label className="block text-sm leading-6"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> 我已核对员工，并安全记下新 PIN（设置时）；操作后旧 PIN 将失效，页面会清除输入。</label>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={!ack||!data.ready||!moduleEnabled.current||!/^\d{8,12}$/.test(pin)} onClick={()=>save("set")}>确认设置／重置 PIN</button>
          <button className={button} disabled={!ack||!data.enabled} onClick={()=>save("revoke")}>撤销当前 PIN</button></div>
      </fieldset>
    </div>}
    <p className="text-xs leading-6 text-slate-500">PIN 只在此页面内存短暂存在，发送后清空；切换标签页也清空。未知结果只读核对，不自动重试。关闭页面将丢失本地待核对编号，请先完成核对。不要通过公开聊天发送 PIN。</p>
  </section>;
}
