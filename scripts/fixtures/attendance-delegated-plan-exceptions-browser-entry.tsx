// Actual209 lazy Launcher/Panel, synthetic API/Auth only. No real host claims.
import {StrictMode,useCallback,useLayoutEffect,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import Launcher from "../../src/components/enterprise/MerchantAttendanceDelegatedPlanExceptionsLauncher";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
declare const __FORMAL209_SEED__:{siteId:string;owner:string;delegate:string;other:string;paths:string[]};
type Config={ownerMode:boolean;enabled:boolean;grant:boolean;requester:number;identity:"delegate"|"other"};
declare global{interface Window{__formal209Harness:{configure(v:Partial<Config>):void;authValid(v:boolean):void;leave():boolean;
 hold(path:string,method:"GET"|"POST"):void;held():boolean;release():void;visibility(hidden:boolean):void;pagehide():void;}}}
const seed=__FORMAL209_SEED__,held={path:"",method:"",active:false,release:null as (()=>void)|null},nativeFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const u=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url,location.origin);
 if(u.origin!==location.origin||!seed.paths.includes(u.pathname))throw Error("external_or_unknown_fetch");
 const wait=u.pathname===held.path&&(init?.method??"GET")===held.method;if(wait){held.path="";held.method="";}
 const response=await nativeFetch(input,init);if(!wait)return response;const bytes=new Uint8Array(await response.arrayBuffer());let canceled=false;
 return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes.slice(0,1));held.active=true;
  held.release=()=>{held.active=false;held.release=null;if(!canceled){c.enqueue(bytes.slice(1));c.close();}};},cancel(){canceled=true;}}),{status:response.status,headers:response.headers});
};
function Harness(){
 const [config,setConfig]=useState<Config>({ownerMode:true,enabled:true,grant:true,requester:0,identity:"delegate"}),[,renderAuth]=useState(0),
  valid=useRef(true),guard=useRef<(()=>boolean)|null>(null),current=useCallback(()=>valid.current,[]),register=useCallback((v:(()=>boolean)|null)=>{guard.current=v;},[]),
  actor=config.ownerMode?seed.owner:seed[config.identity];
 const apiFetch=useCallback<AttendanceApiFetch>((url,init)=>{const headers=new Headers(init?.headers);headers.set("X-Synthetic-Actor",actor);
  headers.set("X-Synthetic-Requester",String(config.requester));return fetch(url,{...init,headers});},[actor,config.requester]);
 useLayoutEffect(()=>{window.__formal209Harness={configure:v=>flushSync(()=>setConfig(c=>({...c,...v}))),
  authValid:v=>{valid.current=v;flushSync(()=>renderAuth(n=>n+1));},leave:()=>!guard.current||guard.current(),
  hold:(path,method)=>{if(!seed.paths.includes(path)||held.active)throw Error("invalid_hold");held.path=path;held.method=method;},held:()=>held.active,release:()=>held.release?.(),
  visibility:hidden=>{Object.defineProperty(document,"hidden",{configurable:true,value:hidden});Object.defineProperty(document,"visibilityState",{configurable:true,value:hidden?"hidden":"visible"});document.dispatchEvent(new Event("visibilitychange"));},
  pagehide:()=>window.dispatchEvent(new Event("pagehide"))};},[]);
 return <main className="qa-main"><header className="p-3 text-sm">209 真实独立组件；API和Auth合成，不证明真实SQL、授权、宿主导航或生产写入。</header>
  <StrictMode><Launcher siteId={seed.siteId} actorId={actor} ownerMode={config.ownerMode} apiFetch={apiFetch} isCurrentAuth={current}
   requesterKey={String(config.requester)} enabled={config.enabled} grantEnabled={config.grant} registerLeaveGuard={register}/></StrictMode></main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
