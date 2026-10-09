//208 actual parents, synthetic validated actors. No business click, read,
//submission, polling or browser-control API is automated by this entrypoint.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import AdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import SelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";
declare global { interface Window {
 __posthocSeed:{site:string;owner:string;employee:string;auth:string;worker:string;slotId:string;token:string};
 __posthocFrontFlag:string;
 __posthocProbe:{errors:string[];csp:string[];storage:{method:string;key:string|null;local:boolean;bytes:number}[]};
} }
function observeLocalBrowser(){
 const probe={errors:[] as string[],csp:[] as string[],storage:[] as {method:string;key:string|null;local:boolean;bytes:number}[]};window.__posthocProbe=probe;
 window.addEventListener("error",event=>{if(probe.errors.length<30)probe.errors.push(String(event.message).slice(0,300));});
 document.addEventListener("securitypolicyviolation",event=>{if(probe.csp.length<30)probe.csp.push(event.violatedDirective);});
 for(const storage of [sessionStorage,localStorage])if(storage.getItem("qa-posthoc-unrelated")===null)storage.setItem("qa-posthoc-unrelated","keep");
 const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem,clear=Storage.prototype.clear;
 Storage.prototype.setItem=function(key,value){if(probe.storage.length<200)probe.storage.push({method:"setItem",key,local:this===localStorage,bytes:new TextEncoder().encode(String(value)).length});return set.call(this,key,value);};
 Storage.prototype.removeItem=function(key){if(probe.storage.length<200)probe.storage.push({method:"removeItem",key,local:this===localStorage,bytes:0});return remove.call(this,key);};
 Storage.prototype.clear=function(){if(probe.storage.length<200)probe.storage.push({method:"clear",key:null,local:this===localStorage,bytes:0});return clear.call(this);};
}
function Harness(){
 const seed=window.__posthocSeed,[access,setAccess]=useState<"owner"|"self">("owner"),[front,setFront]=useState(false),[server,setServer]=useState(false);
 const [exceptionEnabled,setExceptionEnabled]=useState(true),[epoch,setEpoch]=useState(0),[narrow,setNarrow]=useState(true),[hidden,setHidden]=useState(false);
 const [message,setMessage]=useState("新采用／新v3决定前后端均关闭。父页初始化是实际GET；业务工作区只在你明确点击后读取。"),[busy,setBusy]=useState(false),[ended,setEnded]=useState(false);
 const guard=useRef<(()=>boolean)|null>(null),register=useCallback((next:(()=>boolean)|null)=>{guard.current=next;},[]);
 const mayLeave=()=>!guard.current||guard.current();
 const control=async(action:string,value=true)=>{
  const reply=await fetch("/__qa/control",{method:"POST",headers:{"content-type":"application/json","x-posthoc-qa-token":seed.token},
   credentials:"omit",body:JSON.stringify({action,value})});const body=await reply.json();if(!reply.ok)throw Error(body.message??body.error??"QA failed");return body;
 };
 const task=(fn:()=>Promise<void>)=>{if(busy||ended)return;setBusy(true);void fn().catch(e=>setMessage(String(e.message??e))).finally(()=>setBusy(false));};
 const changeFront=(enabled:boolean)=>{window.__posthocFrontFlag=enabled?"1":"0";setFront(enabled);};
 const both=(enabled:boolean)=>{if(!mayLeave())return;task(async()=>{await control("server-gate",enabled);setServer(enabled);changeFront(enabled);setMessage(enabled?"新写前后端已启用，仅限本合成目标。":"新写前后端已关闭；历史与明确原号核对仍可读。");});};
 const apiFetch=useMemo(()=>async(url:string,init?:RequestInit)=>{
  const target=new URL(url,location.origin);if(target.origin!==location.origin)throw Error("QA only permits same-origin API");
  const headers=new Headers(init?.headers);headers.set("x-posthoc-qa-token",seed.token);headers.set("x-posthoc-qa-access",access);
  return fetch(target,{...init,headers,credentials:"omit"});
 },[access,seed.token]);
 const changeAccess=(next:"owner"|"self")=>{if(mayLeave()){setAccess(next);setEpoch(n=>n+1);}};
 const visibility=(value:boolean)=>{
  if(value)Object.defineProperty(document,"hidden",{configurable:true,value:true});
  else Reflect.deleteProperty(document,"hidden");
  document.dispatchEvent(new Event("visibilitychange"));if(!value)window.dispatchEvent(new Event("focus"));setHidden(value);
  setMessage(value?"仅模拟document.hidden，实际UI应清除正文及草稿。":"已恢复可见；应由你明确重新读取，不自动恢复晚回复。");
 };
 useEffect(()=>()=>{Reflect.deleteProperty(document,"hidden");},[]);
 const common={siteId:seed.site,siteName:"208隔离合成企业",apiFetch,registerLeaveGuard:register,planExceptionsEnabled:exceptionEnabled,
  locationWorkspaceEnabled:false,exceptionWorkspaceEnabled:false,workArrangementsEnabled:false,missingDelegationEnabled:false,applicationDelegationEnabled:false,scheduleDelegationEnabled:false};
 return <><header className="qa-toolbar">
  <strong>208真实父页本地验收：合成已验证身份 → 实际处理器／服务 → 拥有schema SQL</strong>
  <p>不是实际登录、用户浏览器或手机认证验收；390仅为布局容器。禁止点击无关配置保存／打卡：测试桥会拒绝这些写入。</p>
  <details><summary>本次固定合成目标（可用于原父入口）</summary><p>人员：{seed.worker}<br/>排班：{seed.slotId}<br/>企业：{seed.site}</p></details>
  <div className="qa-controls">
   <button data-testid="owner-parent" disabled={busy||ended} onClick={()=>changeAccess("owner")}>负责人父页</button>
   <button data-testid="self-parent" disabled={busy||ended} onClick={()=>changeAccess("self")}>本人父页</button>
   <button data-testid="flags-on" disabled={busy||ended} onClick={()=>both(true)}>启用前后端新写</button>
   <button data-testid="flags-off" disabled={busy||ended} onClick={()=>both(false)}>关闭前后端新写</button>
   <button data-testid="frontend-on" disabled={busy||ended} onClick={()=>{if(mayLeave())changeFront(true);}}>仅启用前端新写</button>
   <button data-testid="frontend-off" disabled={busy||ended} onClick={()=>{if(mayLeave())changeFront(false);}}>仅关闭前端新写</button>
   <button data-testid="server-on" disabled={busy||ended} onClick={()=>task(async()=>{await control("server-gate",true);setServer(true);})}>仅启用服务新写</button>
   <button data-testid="server-off" disabled={busy||ended} onClick={()=>task(async()=>{await control("server-gate",false);setServer(false);})}>仅关闭服务新写</button>
   <button data-testid="exception-off" disabled={busy||ended} onClick={()=>{if(mayLeave())setExceptionEnabled(false);}}>关闭异常普通入口旗标</button>
   <button data-testid="exception-on" disabled={busy||ended} onClick={()=>{if(mayLeave())setExceptionEnabled(true);}}>开启异常普通入口旗标</button>
  </div><div className="qa-controls">
   <button data-testid="drop-post" disabled={busy||ended} onClick={()=>task(async()=>{await control("drop-post");setMessage("下一次成功业务POST在服务器执行后丢失响应；只影响这一次，失败POST不消费。");})}>丢下次成功POST响应</button>
   <button data-testid="hold-get" disabled={busy||ended} onClick={()=>task(async()=>{await control("hold-get");setMessage("下一次业务GET读取后暂不回传；请先操作真实读取，再隐藏或换代并释放。");})}>延迟下一GET</button>
   <button data-testid="release-get" disabled={busy||ended} onClick={()=>task(async()=>{await control("release-get");setMessage("已释放延迟GET；晚回复不应重新显示已隐藏内容。");})}>释放延迟GET</button>
   <button data-testid="hide" disabled={ended} onClick={()=>visibility(true)}>模拟隐藏</button>
   <button data-testid="show" disabled={ended} onClick={()=>visibility(false)}>恢复可见</button>
   <button data-testid="pagehide" disabled={ended} onClick={()=>{window.dispatchEvent(new Event("pagehide"));setMessage("仅派发pagehide事件；没有退出浏览器。");}}>模拟pagehide</button>
   <button data-testid="remount" disabled={ended} onClick={()=>{window.dispatchEvent(new Event("pagehide"));setEpoch(n=>n+1);setMessage("同一合成身份／目标强制换代卸载，非实际换绑或授权验证；保存原号仍在。");}}>同身份scope换代</button>
   <button data-testid="width390" disabled={ended} onClick={()=>setNarrow(value=>!value)}>切换390px容器</button>
   <button data-testid="stats" disabled={busy||ended} onClick={()=>task(async()=>{const r=await fetch("/__qa/stats",{credentials:"omit"});const s=await r.json();setMessage(JSON.stringify(s,null,2));})}>读取只读请求统计</button>
   <button data-testid="finish" disabled={busy||ended} onClick={()=>{if(mayLeave()&&window.confirm("结束本次验收桥？这不会撤销任何已发送请求，根代理随后核验及清理合成环境。"))task(async()=>{const s=await control("finish");setEnded(true);setMessage(JSON.stringify(s,null,2));});}}>结束验收</button>
  </div><p data-testid="qa-state">当前：{access}；前端新写 {String(front)}；服务新写 {String(server)}；异常入口 {String(exceptionEnabled)}；hidden {String(hidden)}；epoch {epoch}</p>
  <pre role="status" className="qa-note">{message}</pre>
 </header><main key={access+":"+epoch} className="qa-main" data-narrow={String(narrow)} data-qa-access={access} data-front-enabled={String(front)}>
  {!ended&&(access==="owner"?<AdminPanel {...common} ownerId={seed.owner} employmentLifecycleEnabled={false} correctionReviewEnabled={false} correctionControlsEnabled={false} timesheetEnabled={false} revisionApprovalEnabled={false}/>
   :<SelfPanel {...common} employeeId={seed.employee} employeeName="208合成本人" canClock={false} eventNotificationsEnabled correctionWorkspaceEnabled={false} selfScheduleEnabled={false} selfScheduleAdoptionEnabled={false}/>)}
 </main></>;
}
observeLocalBrowser();
createRoot(document.getElementById("qa-root")!).render(<Harness/>);

