//Actual Manager and all original hosts, synthetic Auth/API only.
import {useCallback,useLayoutEffect,useMemo,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import Manager,{type MerchantEnterpriseView,type MerchantEnterpriseExternalNavigation} from "../../src/components/admin/MerchantEnterpriseManager";
declare const __REMINDER_RECIPIENT_SEED__:{siteId:string;paths:string[];tokens:Record<"self"|"delegate"|"other",string>};
type Identity="self"|"delegate"|"other";
declare global{interface Window{__recipientReminderHarness:{identity(value:Identity):void;redraw():void;navigate(value:MerchantEnterpriseView):boolean;
 hold(path:string):void;held():boolean;canceled():boolean;release():void;visibility(value:boolean):void;pagehide():void;}}}
const seed=__REMINDER_RECIPIENT_SEED__,nativeFetch=window.fetch.bind(window),held={path:"",active:false,canceled:false,release:null as (()=>void)|null};
window.fetch=async(input,init)=>{
 const u=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url,location.origin);
 if(u.origin!==location.origin||!seed.paths.includes(u.pathname)||(init?.method??"GET")!=="GET")throw Error("recipient_forbidden_fetch");
 const wait=u.pathname===held.path;if(wait){held.path="";held.canceled=false;}
 const response=await nativeFetch(input,init);if(!wait)return response;const bytes=new Uint8Array(await response.arrayBuffer());
 return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes.slice(0,1));held.active=true;held.release=()=>{held.active=false;held.release=null;if(!held.canceled){c.enqueue(bytes.slice(1));c.close();}};},cancel(){held.canceled=true;}}),{status:response.status,headers:response.headers});
};
function Harness(){
 const [identity,setIdentity]=useState<Identity>("self"),[,redraw]=useState(0),[view,setView]=useState<MerchantEnterpriseView>("overview"),guard=useRef<((view:MerchantEnterpriseView|null)=>boolean)|null>(null);
 const register=useCallback((value:((view:MerchantEnterpriseView|null)=>boolean)|null)=>{guard.current=value;},[]),onViewChange=useCallback((value:MerchantEnterpriseView)=>setView(value),[]);
 const navigation=useMemo<MerchantEnterpriseExternalNavigation>(()=>({mode:"external",activeView:view,onViewChange,registerViewChangeGuard:register}),[view,onViewChange,register]);
 useLayoutEffect(()=>{window.__recipientReminderHarness={identity:value=>flushSync(()=>{setIdentity(value);setView("overview");}),redraw:()=>flushSync(()=>redraw(n=>n+1)),
  navigate:value=>{if(!guard.current||!guard.current(value))return false;flushSync(()=>setView(value));return true;},
  hold:path=>{if(!seed.paths.includes(path))throw Error("invalid_hold");held.path=path;},held:()=>held.active,canceled:()=>held.canceled,release:()=>held.release?.(),
  visibility:hidden=>{Object.defineProperty(document,"hidden",{configurable:true,value:hidden});Object.defineProperty(document,"visibilityState",{configurable:true,value:hidden?"hidden":"visible"});document.dispatchEvent(new Event("visibilitychange"));},
  pagehide:()=>window.dispatchEvent(new Event("pagehide"))};},[]);
 return <main className="qa-main"><header className="p-3 text-sm">201 两条新增收件人导航 · 真实组件／合成 Auth 与严格 API；无 SQL、打卡、授权或审批写入。</header>
  <Manager siteId={seed.siteId} siteName="Synthetic201 recipient enterprise" accessToken={seed.tokens[identity]} standalone collaborationRefreshIntervalMs={240000} navigation={navigation}/></main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
