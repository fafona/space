// Real enterprise hosts. Only authentication and the API are local synthetic data.
import {useLayoutEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import Manager from "../../src/components/admin/MerchantEnterpriseManager";
declare const __CORRECTION_BROWSER_SEED__:{siteId:string;tokens:Record<string,string>;endpoint:string};
declare global {interface Window {__correctionHarness:{identity(v:"owner"|"delegate"|"other"):void;hold():void;release():void;held():boolean;visibility(v:boolean):void};}}
const seed=__CORRECTION_BROWSER_SEED__,transport={hold:false,held:false,release:null as (()=>void)|null},fetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url,location.origin);if(url.origin!==location.origin)throw Error("external_fetch");
  const hold=transport.hold&&url.pathname===seed.endpoint;if(hold)transport.hold=false;const r=await fetch(input,init);if(!hold)return r;
  const bytes=new Uint8Array(await r.arrayBuffer());let canceled=false;return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes.slice(0,1));transport.held=true;
    transport.release=()=>{transport.held=false;transport.release=null;if(!canceled){c.enqueue(bytes.slice(1));c.close();}};},cancel(){canceled=true;}}),{status:r.status,headers:r.headers});};
function Harness(){const [identity,setIdentity]=useState<"owner"|"delegate"|"other">("owner");
  useLayoutEffect(()=>{window.__correctionHarness={identity:v=>flushSync(()=>setIdentity(v)),hold:()=>{transport.hold=true;},release:()=>transport.release?.(),held:()=>transport.held,
    visibility:v=>{Object.defineProperty(document,"hidden",{configurable:true,value:v});Object.defineProperty(document,"visibilityState",{configurable:true,value:v?"hidden":"visible"});document.dispatchEvent(new Event("visibilitychange"));}};},[]);
  return <main className="qa-main"><header className="m-2 rounded border bg-amber-50 p-3 text-sm">首次补正委托 · 真实企业页面；仅合成 Auth/API，不代表真实登录或 SQL。</header>
    <Manager siteId={seed.siteId} siteName="Synthetic238 enterprise" accessToken={seed.tokens[identity]} standalone collaborationRefreshIntervalMs={240000}/></main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
