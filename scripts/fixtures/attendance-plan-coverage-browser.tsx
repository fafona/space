//164 local synthetic lifecycle controls around actual production components.
// All source data is read from the root-owned SQL fixture, not generated here.
// Initial worker has explicit synthetic historical events/relations; the other
// worker has actual137 current clocks. Both use real128 and139 reads.
import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {SourcesResponse} from '../../src/lib/merchantAttendanceSources';
import SourcesPanel from '../../src/components/enterprise/MerchantAttendanceSourcesPanel';
import PlanCoverage from '../../src/components/enterprise/MerchantAttendancePlanCoverage';
declare global { interface Window { __planCoverageSeed:{source:SourcesResponse;otherSource:SourcesResponse;owner:string;otherOwner:string;flagOff:boolean}; } }
type Gate={used:boolean;promise:Promise<void>;release:()=>void};
const visibility=(hidden:boolean)=>{
  Object.defineProperty(document,'hidden',{configurable:true,value:hidden});
  Object.defineProperty(document,'visibilityState',{configurable:true,value:hidden?'hidden':'visible'});
  document.dispatchEvent(new Event('visibilitychange'));
};
function Harness(){
  const seed=window.__planCoverageSeed;
  const[source,setSource]=useState(seed.source),[owner,setOwner]=useState(seed.owner),[epoch,setEpoch]=useState(0);
  const[mounted,setMounted]=useState(true),[parent,setParent]=useState(false),[enabled,setEnabled]=useState(false),[generation,setGeneration]=useState(0);
  const[bodyPhase,setBodyPhase]=useState('idle'),gate=useRef<Gate|null>(null);
  useLayoutEffect(()=>()=>gate.current?.release(),[]);
  const apiFetch=useMemo(()=>async(url:string,init?:RequestInit)=>{
    const headers=new Headers(init?.headers);headers.set('x-qa-owner',owner);headers.set('x-qa-generation',String(generation));
    const response=await fetch(url,{...init,headers,credentials:'omit'}),held=gate.current;
    if(!held||held.used)return response;
    held.used=true;const bytes=new Uint8Array(await response.arrayBuffer());setBodyPhase('held');
    const body=new ReadableStream<Uint8Array>({async start(controller){await held.promise;try{controller.enqueue(bytes);controller.close();}catch{/* Aborted reader. */}}});
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  },[owner,generation]);
  const arm=()=>{gate.current?.release();let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});gate.current={used:false,promise,release};setBodyPhase('armed');};
  return <><header className="qa-toolbar"><strong>隔离计划关联验收 · 实际本地 SQL · 合成认证 · 非生产</strong><div className="qa-controls">
    <button data-testid="enable" onClick={()=>setEnabled(true)}>开启独立子组件验收</button>
    <button data-testid="parent" onClick={()=>{setParent(true);setMounted(true);}}>打开真实资料父组件</button>
    <button data-testid="source-change" onClick={()=>setSource(value=>structuredClone(value))}>替换来源引用</button>
    <button data-testid="worker-change" onClick={()=>setSource(seed.otherSource)}>切换另一个实际资料范围</button>
    <button data-testid="worker-restore" onClick={()=>setSource(seed.source)}>恢复员工</button>
    <button data-testid="owner-change" onClick={()=>setOwner(seed.otherOwner)}>切换负责人</button>
    <button data-testid="owner-restore" onClick={()=>setOwner(seed.owner)}>恢复负责人</button>
    <button data-testid="api-change" onClick={()=>setGeneration(value=>value+1)}>替换请求函数</button>
    <button data-testid="epoch" onClick={()=>setEpoch(value=>value+1)}>授权代次变化</button>
    <button data-testid="hide" onClick={()=>visibility(true)}>隐藏</button>
    <button data-testid="show" onClick={()=>visibility(false)}>显示</button>
    <button data-testid="pagehide" onClick={()=>window.dispatchEvent(new Event('pagehide'))}>pagehide</button>
    <button data-testid="pageshow" onClick={()=>window.dispatchEvent(new Event('pageshow'))}>pageshow</button>
    <button data-testid="unmount" onClick={()=>setMounted(false)}>卸载</button>
    <button data-testid="mount" onClick={()=>setMounted(true)}>挂载</button>
    <button data-testid="arm-body" onClick={arm}>延迟真实响应体</button>
    <button data-testid="release-body" onClick={()=>{gate.current?.release();setBodyPhase('released');}}>释放真实响应体</button>
    <output data-testid="body-phase">{bodyPhase}</output>
  </div></header><main className="qa-main">{mounted&&(parent
    ?<SourcesPanel key={`parent:${epoch}`} siteId={source.siteId} workerId={source.worker.workerId} ownerId={owner} apiFetch={apiFetch} onClose={()=>setMounted(false)}/>
    :<PlanCoverage key={`child:${epoch}`} source={source} ownerId={owner} apiFetch={apiFetch} enabled={enabled?true:seed.flagOff?undefined:false}/>)}
    {!mounted&&<p data-testid="closed">资料已关闭</p>}</main></>;
}
createRoot(document.getElementById('qa-root')!).render(<Harness/>);
