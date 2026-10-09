// Whole real enterprise Manager; only Auth/API and the external shell are synthetic.
import {useCallback,useLayoutEffect,useMemo,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import Manager,{type MerchantEnterpriseView,type MerchantEnterpriseExternalNavigation} from "../../src/components/admin/MerchantEnterpriseManager";
declare const __PERIOD_ENTERPRISE_SEED__:{siteId:string;tokens:{employee:string;other:string;owner:string};closureEndpoint:string};
type Identity="employee"|"other"|"owner";
declare global {interface Window {__periodEnterpriseHarness:{
  identity(value:Identity):void;navigate(view:MerchantEnterpriseView):boolean;visibility(hidden:boolean):void;
  holdNext():void;release():void;snapshot():{identity:Identity;view:MerchantEnterpriseView;held:boolean};
};}}
const seed=__PERIOD_ENTERPRISE_SEED__,transport={hold:false,held:false,release:null as (()=>void)|null};
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url,location.origin);
  if(url.origin!==location.origin)throw Error("enterprise_qa_external_fetch");
  const delayed=transport.hold&&url.pathname===seed.closureEndpoint;
  if(delayed)transport.hold=false;
  const response=await originalFetch(input,init);if(!delayed)return response;
  const bytes=new Uint8Array(await response.arrayBuffer());let canceled=false;
  return new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes.slice(0,1));transport.held=true;
    transport.release=()=>{transport.held=false;transport.release=null;if(!canceled){controller.enqueue(bytes.slice(1));controller.close();}};
  },cancel(){canceled=true;}}),{status:response.status,headers:response.headers});
};
function Harness(){
  const [identity,setIdentity]=useState<Identity>("employee"),[view,setView]=useState<MerchantEnterpriseView>("overview");
  const navigationGuard=useRef<((view:MerchantEnterpriseView|null)=>boolean)|null>(null);
  const registerViewChangeGuard=useCallback((guard:((view:MerchantEnterpriseView|null)=>boolean)|null)=>{navigationGuard.current=guard;},[]);
  const onViewChange=useCallback((next:MerchantEnterpriseView)=>setView(next),[]);
  const navigation=useMemo<MerchantEnterpriseExternalNavigation>(()=>({mode:"external",activeView:view,onViewChange,registerViewChangeGuard}),[view,onViewChange,registerViewChangeGuard]);
  useLayoutEffect(()=>{window.__periodEnterpriseHarness={identity:next=>flushSync(()=>{setView("overview");setIdentity(next);}),
    navigate:next=>{if(!navigationGuard.current||!navigationGuard.current(next))return false;flushSync(()=>setView(next));return true;},
    visibility:hidden=>{Object.defineProperty(document,"hidden",{configurable:true,value:hidden});Object.defineProperty(document,"visibilityState",{configurable:true,value:hidden?"hidden":"visible"});document.dispatchEvent(new Event("visibilitychange"));},
    holdNext:()=>{transport.hold=true;},release:()=>transport.release?.(),snapshot:()=>({identity,view,held:transport.held})};},[identity,view]);
  return <main className="qa-main"><header className="m-2 rounded border bg-amber-50 p-3 text-sm"><h1 className="font-bold">完整企业宿主 · 合成浏览器验收</h1>
    <p>真实Manager／Admin与周期子页；身份、权限和API回执为本地合成，不代表真实登录、SQL或Next整站部署。</p></header>
    <Manager siteId={seed.siteId} siteName="Synthetic235 enterprise" accessToken={seed.tokens[identity]} standalone
      collaborationRefreshIntervalMs={240000} navigation={identity==="owner"?undefined:navigation}/></main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
