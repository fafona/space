//Actual Admin/Manager/Launcher and original hosts. All viewers/API are synthetic.
import {StrictMode,useCallback,useLayoutEffect,useMemo,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import Admin from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import Manager,{type MerchantEnterpriseView,type MerchantEnterpriseExternalNavigation} from "../../src/components/admin/MerchantEnterpriseManager";
import RemindersPanel from "../../src/components/enterprise/MerchantAttendanceRemindersPanel";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
declare const __REMINDERS_SEED__:{review:{siteId:string;owner:string};cycle:{siteId:string;owner:string};
 enterprise:{siteId:string;tokens:{employee:string;other:string;owner:string}};paths:string[]};
type Config={mode:"idle"|"review"|"cycle"|"overview"|"strict";enabled:boolean;requester:number;identity:"employee"|"other"};
declare global{interface Window{__reminderHarness:{configure(v:Partial<Config>):void;authValid(v:boolean):void;leave():boolean;navigate(v:MerchantEnterpriseView):boolean;
 hold(path:string,method:"GET"|"POST"):void;held():boolean;release():void;visibility(hidden:boolean):void;pagehide():void;}}}
const seed=__REMINDERS_SEED__,held={path:"",method:"",active:false,release:null as (()=>void)|null},nativeFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const u=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url,location.origin);
 if(u.origin!==location.origin||!seed.paths.includes(u.pathname))throw Error("external_or_unknown_fetch");
 const wait=u.pathname===held.path&&(init?.method??"GET")===held.method;if(wait){held.path="";held.method="";}
 const response=await nativeFetch(input,init);if(!wait)return response;const bytes=new Uint8Array(await response.arrayBuffer());let canceled=false;
 return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes.slice(0,1));held.active=true;
  held.release=()=>{held.active=false;held.release=null;if(!canceled){c.enqueue(bytes.slice(1));c.close();}};},cancel(){canceled=true;}}),{status:response.status,headers:response.headers});
};
function Harness(){
 const [config,setConfig]=useState<Config>({mode:"idle",enabled:true,requester:0,identity:"employee"}),[,renderAuth]=useState(0),valid=useRef(true),guard=useRef<(()=>boolean)|null>(null);
 const [view,setView]=useState<MerchantEnterpriseView>("overview"),viewGuard=useRef<((v:MerchantEnterpriseView|null)=>boolean)|null>(null),enabled=useRef(config.enabled);
 useLayoutEffect(()=>{enabled.current=config.enabled;},[config.enabled]);
 const current=useCallback(()=>valid.current,[]),register=useCallback((v:(()=>boolean)|null)=>{guard.current=v;},[]);
 const own=config.mode==="cycle"?seed.cycle:seed.review;
 const apiFetch=useCallback<AttendanceApiFetch>((url,init)=>{const headers=new Headers(init?.headers);headers.set("X-Synthetic-Actor",own.owner);
  headers.set("X-Synthetic-Requester",String(config.requester));headers.set("X-Synthetic-Enabled",String(enabled.current));return fetch(url,{...init,headers});},[own.owner,config.requester]);
 const registerViewChangeGuard=useCallback((v:((n:MerchantEnterpriseView|null)=>boolean)|null)=>{viewGuard.current=v;},[]),onViewChange=useCallback((v:MerchantEnterpriseView)=>setView(v),[]);
 const navigation=useMemo<MerchantEnterpriseExternalNavigation>(()=>({mode:"external",activeView:view,onViewChange,registerViewChangeGuard}),[view,onViewChange,registerViewChangeGuard]);
 useLayoutEffect(()=>{window.__reminderHarness={configure:v=>flushSync(()=>{setConfig(c=>({...c,...v}));setView("overview");}),authValid:v=>{valid.current=v;flushSync(()=>renderAuth(n=>n+1));},
  leave:()=>!guard.current||guard.current(),navigate:v=>{if(!viewGuard.current||!viewGuard.current(v))return false;flushSync(()=>setView(v));return true;},
  hold:(path,method)=>{if(!seed.paths.includes(path))throw Error("invalid_hold");held.path=path;held.method=method;},held:()=>held.active,release:()=>held.release?.(),
  visibility:hidden=>{Object.defineProperty(document,"hidden",{configurable:true,value:hidden});Object.defineProperty(document,"visibilityState",{configurable:true,value:hidden?"hidden":"visible"});document.dispatchEvent(new Event("visibilitychange"));},
  pagehide:()=>window.dispatchEvent(new Event("pagehide"))};},[]);
 return <main className="qa-main"><header className="p-3 text-sm">201 真实宿主及组件／合成身份和严格API，无真实Auth、SQL、审批授权或生产操作。</header>
  {config.mode==="idle"?<button onClick={()=>setConfig(c=>({...c,mode:"review"}))}>打开负责人合成父入口</button>
   :config.mode==="overview"?<Manager key={config.requester} siteId={seed.enterprise.siteId} siteName="Synthetic201 enterprise" accessToken={seed.enterprise.tokens[config.identity]}
     standalone collaborationRefreshIntervalMs={240000} navigation={navigation}/>
   :config.mode==="strict"?<StrictMode><RemindersPanel siteId={seed.review.siteId} actorId={seed.review.owner} apiFetch={apiFetch} isCurrentAuth={current}
     enabled={config.enabled} onClose={()=>setConfig(c=>({...c,mode:"idle"}))} registerLeaveGuard={register}/></StrictMode>
   :<Admin key={config.mode} siteId={own.siteId} ownerId={own.owner} authUserId={own.owner} apiFetch={apiFetch} isCurrentAuth={current} registerLeaveGuard={register}
     remindersEnabled={config.enabled} operationalCycleEnabled locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false} workArrangementsEnabled
     missingDelegationEnabled={false} applicationDelegationEnabled={false} scheduleDelegationEnabled={false} periodDelegationEnabled={false} correctionDelegationEnabled={false}
     operationalRulesEnabled={false} ownerNotificationsEnabled={false} employmentLifecycleEnabled={false} administrativeClosureEnabled={false} reviewRoutingEnabled={false}
     independentWorkersEnabled={false} outageEnabled={false} retentionEnabled={false} correctionReviewEnabled correctionControlsEnabled={false} timesheetEnabled={false}
     ownerBacklogEnabled={false} missingEnabled correctionDecisionsEnabled revisionApprovalEnabled/>}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
