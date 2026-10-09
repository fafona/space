//166 uses the actual parent panel. Data comes only through the local real RPC bridge.
import {useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import SourcesPanel from '../../src/components/enterprise/MerchantAttendanceSourcesPanel';
declare global {interface Window {__planRulesSeed:{site:string;worker:string;owner:string};}}
function Harness(){
  const seed=window.__planRulesSeed;
  const[epoch,setEpoch]=useState(0),[mounted,setMounted]=useState(true);
  const apiFetch=useMemo(()=>async(url:string,init?:RequestInit)=>fetch(url,{...init,credentials:'omit'}),[]);
  return <><header className="qa-toolbar">隔离排班规则验收 · 合成身份 · 本地 SQL · 非生产
    <div><button data-testid="remount" onClick={()=>{setEpoch(v=>v+1);setMounted(true);}}>重新挂载</button>
    <button data-testid="unmount" onClick={()=>setMounted(false)}>卸载</button></div></header>
    <main className="qa-main">{mounted?<SourcesPanel key={epoch} siteId={seed.site} workerId={seed.worker} ownerId={seed.owner} apiFetch={apiFetch} onClose={()=>setMounted(false)}/>:<p data-testid="closed">已关闭</p>}</main></>;
}
createRoot(document.getElementById('qa-root')!).render(<Harness/>);
