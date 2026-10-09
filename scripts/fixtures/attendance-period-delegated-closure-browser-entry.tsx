// Isolated synthetic Auth/API harness: real launcher and workspace, no production route.
import {StrictMode,useCallback,useLayoutEffect,useMemo,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import Workspace from "../../src/components/enterprise/MerchantAttendancePeriodDelegatedClosureWorkspace";
import Launcher from "../../src/components/enterprise/MerchantAttendancePeriodDelegationLauncher";
import type {PeriodDelegatedClosureScope} from "../../src/lib/merchantAttendancePeriodDelegatedClosureClient";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
declare const __DELEGATED_PERIOD_SEED__:PeriodDelegatedClosureScope&{fromDate:string;throughDate:string;otherEmployeeId:string;otherAuthUserId:string};
type Config={enabled:boolean;other:boolean;shown:boolean;direct:boolean};
declare global {interface Window {__delegatedPeriodHarness:{configure(p:Partial<Config>):void;visibility(hidden:boolean):void;holdNext():void;release():void;snapshot():{calls:number;held:boolean}};}}
const seed=__DELEGATED_PERIOD_SEED__;
function Harness(){
  const [config,setConfig]=useState<Config>(()=>({enabled:sessionStorage.getItem("qa-delegated-period-disabled")!=="1",other:false,shown:true,
    direct:sessionStorage.getItem("qa-delegated-period-direct")==="1"}));
  const guard=useRef<(()=>boolean)|null>(null),calls=useRef(0),held=useRef(false),hold=useRef(false),release=useRef<(()=>void)|null>(null);
  const configure=useCallback((patch:Partial<Config>)=>flushSync(()=>setConfig(c=>({...c,...patch}))),[]);
  const registerLeaveGuard=useCallback((value:(()=>boolean)|null)=>{guard.current=value;},[]);
  const visibility=useCallback((hidden:boolean)=>{Object.defineProperty(document,"hidden",{configurable:true,value:hidden});
    Object.defineProperty(document,"visibilityState",{configurable:true,value:hidden?"hidden":"visible"});document.dispatchEvent(new Event("visibilitychange"));},[]);
  useLayoutEffect(()=>{window.__delegatedPeriodHarness={configure,visibility,holdNext:()=>{hold.current=true;},release:()=>release.current?.(),snapshot:()=>({calls:calls.current,held:held.current})};},[configure,visibility]);
  const actorEmployeeId=config.other?seed.otherEmployeeId:seed.actorEmployeeId,expectedAuthUserId=config.other?seed.otherAuthUserId:seed.expectedAuthUserId;
  const apiFetch=useMemo<AttendanceApiFetch>(()=>async(path,init)=>{
    const url=new URL(path,location.origin);if(url.origin!==location.origin||!["/api/merchant-enterprise/attendance/period-delegated-closure","/api/merchant-enterprise/attendance/period-delegation"].includes(url.pathname)
      ||!['GET','POST'].includes(init?.method??""))throw Error("delegated_period_qa_route_refused");
    const delay=hold.current;hold.current=false;calls.current++;
    const response=await fetch(url.href,{...init,credentials:"omit",redirect:"error",headers:{...init?.headers,"x-delegated-period-qa-auth":expectedAuthUserId,
      "x-delegated-period-qa-employee":actorEmployeeId,"x-delegated-period-qa-enabled":config.enabled?"1":"0"}});
    if(delay){held.current=true;await new Promise<void>(resolve=>{release.current=resolve;});held.current=false;release.current=null;}
    return response;
  },[actorEmployeeId,expectedAuthUserId,config.enabled]);
  return <main className="qa-main space-y-3"><header className="rounded border bg-amber-50 p-3"><h1 className="text-lg font-bold">受托周期 · 合成浏览器验收</h1>
    <p className="text-sm">实际工作区与客户端；身份、API资料和回执均为合成协议，不代表真实Auth或SQL。</p>
    <button type="button" onClick={()=>{if(!guard.current||guard.current())configure({shown:false});}}>离开合成宿主</button></header>
    {config.shown&&(config.direct?<Workspace {...seed} actorEmployeeId={actorEmployeeId} expectedAuthUserId={expectedAuthUserId} enabled={config.enabled}
      apiFetch={apiFetch} onClose={()=>configure({shown:false})} registerLeaveGuard={registerLeaveGuard}/>
      :<Launcher siteId={seed.siteId} access="delegate" actorId={actorEmployeeId} authUserId={expectedAuthUserId} enabled={config.enabled}
        periodsEnabled={config.enabled} apiFetch={apiFetch} registerLeaveGuard={registerLeaveGuard}/>)}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Harness/></StrictMode>);
