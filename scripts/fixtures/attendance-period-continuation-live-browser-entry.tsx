//Actual Launcher/Workspace. SQL is supplied by the caller-owned local bridge;
//the authentication identity is synthetic, never a real login or production.
import { StrictMode, useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Launcher from "../../src/components/enterprise/MerchantAttendancePeriodClosureLauncher";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __PERIOD_LIVE_SEED__: { siteId: string; owner: string; employee: string; workerId: string; date: string };
const seed=__PERIOD_LIVE_SEED__;
function Harness(){
 const [access,setAccess]=useState<"owner"|"self">("owner"),[enabled,setEnabled]=useState(()=>sessionStorage.getItem("qa-period-live-disabled")!=="1");
 const guard=useRef<(()=>boolean)|null>(null);
 const register=useCallback((value:(()=>boolean)|null)=>{guard.current=value;},[]);
 const change=(next:"owner"|"self")=>{if(!guard.current||guard.current())setAccess(next);};
 const apiFetch=useMemo<AttendanceApiFetch>(()=>async(path,init)=>{
  const url=new URL(path,location.origin);
  if(url.origin!==location.origin||url.pathname!=="/api/merchant-enterprise/attendance/period-closures-v2"||!["GET","POST"].includes(init?.method??"GET"))throw Error("period_live_route_refused");
  const headers=new Headers(init?.headers);headers.set("x-period-live-access",access);headers.set("x-period-live-enabled",enabled?"1":"0");
  return fetch(url.href,{...init,headers,credentials:"omit",redirect:"error"});
 },[access,enabled]);
 return <main className="qa-main space-y-4"><header className="rounded border bg-amber-50 p-3"><h1 className="text-xl font-bold">周期续办 · 本地真实 SQL 联合验收</h1>
  <p>真实页面、处理器、服务与隔离数据库；认证为合成身份，不代表真实登录或生产验收。仅新增一个空白日周期，旧周期不改。</p>
  <div className="flex flex-wrap gap-2"><button data-testid="live-owner" onClick={()=>change("owner")}>负责人</button>
   <button data-testid="live-self" onClick={()=>change("self")}>本人</button>
   <button data-testid="live-off" onClick={()=>{sessionStorage.setItem("qa-period-live-disabled","1");setEnabled(false);}}>关闭新写开关</button></div></header>
  <Launcher key={access} siteId={seed.siteId} actorId={access==="owner"?seed.owner:seed.employee} access={access} workerId={seed.workerId}
   fromDate={seed.date} throughDate={seed.date} apiFetch={apiFetch} enabled={enabled} continuationEnabled={enabled} registerLeaveGuard={register}/>
 </main>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Harness/></StrictMode>);
