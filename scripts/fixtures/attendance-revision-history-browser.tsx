import {createRoot} from "react-dom/client";
import {useState} from "react";
import OwnerPanel from "../../src/components/enterprise/MerchantAttendanceRevisionApprovalPanel";
import SelfPanel from "../../src/components/enterprise/MerchantAttendanceRevisionWorkspace";
import {historyModel,historyItem,historySite,historyEmployee,historyWorker,historyRoot,historyOwner} from "./attendance-revision-history-model";
import {revisionApprovalModel} from "./attendance-revision-approval-client-model";
import {revisionCycleModel} from "./attendance-revision-cycle-client-model";
import {wire} from "./attendance-revision-cycle-model";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
const history=historyModel(),owner=revisionApprovalModel(),self=revisionCycleModel();self.setValue(wire('submitted'));
let scenario='normal';const target={workerId:historyWorker,baseRequestId:historyRoot};
const apiFetch:AttendanceApiFetch=async(path,init)=>{
  if(path.startsWith('/api/merchant-enterprise/attendance/revision-history')){
    if(scenario==='normal'||scenario==='paused'){
      const d=owner.value(null).decision,i=historyItem();i.submittedRevision=2;
      if(d){i.status=d.action==='approve'?'approved':'rejected';i.closedAt=d.recordedAt;i.decisionOperationId=d.operationId;}
      history.records([i]);
    }
    return history.apiFetch(path,init);
  }
  return path.startsWith('/api/merchant-enterprise/attendance/revision-decisions')?owner.apiFetch(path,init):self.fetch(path,init);
};
function Demo(){
  const [scope,setScope]=useState<'owner'|'self'>('owner'),[open,setOpen]=useState(true),[count,setCount]=useState('');
  return <><header className="qa-toolbar">修订列表隔离验收 · 实际负责人／员工组件 · 合成传输，不是真实登录或生产连接
    <div className="qa-controls"><label>验收身份<select aria-label="验收身份" value={scope} onChange={e=>{setScope(e.target.value as typeof scope);setOpen(true);}}><option value="owner">负责人</option><option value="self">员工</option></select></label>
      <select aria-label="模拟列表场景" defaultValue="normal" onChange={e=>{scenario=e.target.value;history.mode(['sparse','lost'].includes(scenario)?'normal':scenario);owner.mode(['denied','lost'].includes(scenario)?scenario:'normal');self.setMode(scenario==='denied'?'denied':'normal');if(scenario==='sparse')history.records(Array.from({length:61},(_,n)=>historyItem(n,n<50?'withdrawn':'approved')));}}>{['normal','sparse','paused','denied','offline','corrupt','lost'].map(v=><option key={v}>{v}</option>)}</select>
      <button onClick={()=>setOpen(v=>!v)}>{open?'卸载列表验收':'重新进入列表验收'}</button>
      <button onClick={()=>setCount(JSON.stringify({historyGets:history.calls.length,historyPosts:history.calls.filter(c=>c.method!=='GET').length,ownerGets:owner.calls.filter(c=>c.method==='GET').length,ownerPosts:owner.calls.filter(c=>c.method==='POST').length,selfPosts:self.postCount()}))}>读取列表计数</button><output aria-label="列表计数">{count}</output></div></header>
    <main className="qa-main">{open?(scope==='owner'?<OwnerPanel siteId={historySite} ownerId={historyOwner} apiFetch={apiFetch} historyEnabled onClose={()=>setOpen(false)}/>:<SelfPanel siteId={historySite} employeeId={historyEmployee} apiFetch={apiFetch} initialTarget={target} historyEnabled onClose={()=>setOpen(false)}/>):<p>已卸载；不发送后台请求。</p>}</main></>;
}
createRoot(document.getElementById('qa-root')!).render(<Demo/>);
