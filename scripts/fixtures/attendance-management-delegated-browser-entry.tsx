// Actual hosts/Launcher/Panel; API and Auth are explicitly synthetic, not SQL.
import {StrictMode,useCallback,useLayoutEffect,useMemo,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import Admin from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import Manager,{type MerchantEnterpriseView,type MerchantEnterpriseExternalNavigation} from "../../src/components/admin/MerchantEnterpriseManager";
import Launcher from "../../src/components/enterprise/MerchantAttendanceManagementDelegatedLauncher";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
declare const __MANAGEMENT_SEED__:{siteId:string;owner:string;delegate:string;other:string;paths:string[];enterprise:{siteId:string;tokens:{employee:string;other:string;owner:string}}};
type Config={mode:"idle"|"admin"|"overview"|"strict";requester:number;identity:"employee"|"other";ownerMode:boolean;grant:boolean;audit:boolean;groups:boolean;configuration:boolean;rules:boolean;terminals:boolean;pin:boolean;revisions:boolean};
declare global{interface Window{__managementHarness:{configure(v:Partial<Config>):void;authValid(v:boolean):void;leave():boolean;navigate(v:MerchantEnterpriseView):boolean;
 hold(path:string,method:"GET"|"POST"):void;held():boolean;release():void;visibility(hidden:boolean):void;pagehide():void;objectUrls():number;}}}
const seed=__MANAGEMENT_SEED__,held={path:"",method:"",active:false,release:null as (()=>void)|null},nativeFetch=window.fetch.bind(window);
const objectUrls=new Set<string>(),createUrl=URL.createObjectURL.bind(URL),revokeUrl=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=value=>{const result=createUrl(value);objectUrls.add(result);return result;};
URL.revokeObjectURL=value=>{objectUrls.delete(value);revokeUrl(value);};
window.fetch=async(input,init)=>{
 const u=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url,location.origin);
 if(u.origin!==location.origin||!seed.paths.includes(u.pathname))throw Error("external_or_unknown_fetch");
 const wait=u.pathname===held.path&&(init?.method??"GET")===held.method;if(wait){held.path="";held.method="";}
 const response=await nativeFetch(input,init);if(!wait)return response;const bytes=new Uint8Array(await response.arrayBuffer());let canceled=false;
 return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes.slice(0,1));held.active=true;
  held.release=()=>{held.active=false;held.release=null;if(!canceled){c.enqueue(bytes.slice(1));c.close();}};},cancel(){canceled=true;}}),{status:response.status,headers:response.headers});
};
function Harness(){
 const [config,setConfig]=useState<Config>({mode:"idle",requester:0,identity:"employee",ownerMode:true,grant:true,audit:true,groups:true,configuration:false,rules:false,terminals:false,pin:false,revisions:false}),[,renderAuth]=useState(0),
  valid=useRef(true),guard=useRef<(()=>boolean)|null>(null),[view,setView]=useState<MerchantEnterpriseView>("overview"),viewGuard=useRef<((v:MerchantEnterpriseView|null)=>boolean)|null>(null);
 const current=useCallback(()=>valid.current,[]),register=useCallback((v:(()=>boolean)|null)=>{guard.current=v;},[]),
  actor=config.mode==="admin"||config.ownerMode?seed.owner:config.identity==="employee"?seed.delegate:seed.other;
 const apiFetch=useCallback<AttendanceApiFetch>((url,init)=>{const headers=new Headers(init?.headers);headers.set("X-Synthetic-Actor",actor);
  headers.set("X-Synthetic-Requester",String(config.requester));return fetch(url,{...init,headers});},[actor,config.requester]);
 const registerViewChangeGuard=useCallback((v:((n:MerchantEnterpriseView|null)=>boolean)|null)=>{viewGuard.current=v;},[]);
 const onViewChange=useCallback((v:MerchantEnterpriseView)=>setView(v),[]);
 const navigation=useMemo<MerchantEnterpriseExternalNavigation>(()=>({mode:"external",activeView:view,onViewChange,registerViewChangeGuard}),[view,onViewChange,registerViewChangeGuard]);
 useLayoutEffect(()=>{window.__managementHarness={configure:v=>flushSync(()=>{setConfig(c=>({...c,...v}));setView("overview");}),
  authValid:v=>{valid.current=v;flushSync(()=>renderAuth(n=>n+1));},leave:()=>!guard.current||guard.current(),
  navigate:v=>{if(!viewGuard.current||!viewGuard.current(v))return false;flushSync(()=>setView(v));return true;},
  hold:(path,method)=>{if(!seed.paths.includes(path)||held.active)throw Error("invalid_hold");held.path=path;held.method=method;},held:()=>held.active,release:()=>held.release?.(),
  visibility:hidden=>{Object.defineProperty(document,"hidden",{configurable:true,value:hidden});Object.defineProperty(document,"visibilityState",{configurable:true,value:hidden?"hidden":"visible"});document.dispatchEvent(new Event("visibilitychange"));},
  pagehide:()=>window.dispatchEvent(new Event("pagehide")),objectUrls:()=>objectUrls.size};},[]);
 return <main className="qa-main"><header className="p-3 text-sm">202—208 真实宿主与组件。合成API和Auth；不证明真实授权、SQL、KDF、设备或生产写入。</header>
  {config.mode==="idle"?<button onClick={()=>setConfig(c=>({...c,mode:"admin"}))}>打开负责人合成父入口</button>
   :config.mode==="overview"?<Manager key={config.requester} siteId={seed.siteId} siteName="Synthetic204 enterprise" accessToken={seed.enterprise.tokens[config.identity]}
     standalone collaborationRefreshIntervalMs={240000} navigation={navigation}/>
   :config.mode==="strict"?<StrictMode><Launcher siteId={seed.siteId} actorId={actor} ownerMode={config.ownerMode} apiFetch={apiFetch} isCurrentAuth={current}
     requesterKey={String(config.requester)} grantEnabled={config.grant} auditEnabled={config.audit} groupsEnabled={config.groups} configurationEnabled={config.configuration} rulesEnabled={config.rules} terminalsEnabled={config.terminals} pinEnabled={config.pin} revisionsEnabled={config.revisions} registerLeaveGuard={register}/></StrictMode>
   :<Admin key={config.requester} siteId={seed.siteId} ownerId={seed.owner} authUserId={seed.owner} apiFetch={apiFetch} isCurrentAuth={current} registerLeaveGuard={register}
     managementDelegationsEnabled={config.grant} delegatedAuditEnabled={config.audit}
     locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false} workArrangementsEnabled={false}
     missingDelegationEnabled={false} applicationDelegationEnabled={false} scheduleDelegationEnabled={false} periodDelegationEnabled={false} correctionDelegationEnabled={false}
     operationalRulesEnabled={false} ownerNotificationsEnabled={false} employmentLifecycleEnabled={false} administrativeClosureEnabled={false} reviewRoutingEnabled={false}
     independentWorkersEnabled={false} outageEnabled={false} retentionEnabled={false} correctionReviewEnabled={false} correctionControlsEnabled={false} timesheetEnabled={false}
     ownerBacklogEnabled={false} missingEnabled={false} correctionDecisionsEnabled={false} revisionApprovalEnabled={false}/>}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
