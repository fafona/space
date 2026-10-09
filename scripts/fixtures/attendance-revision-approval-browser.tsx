import {createRoot} from "react-dom/client";
import {useState} from "react";
import Panel from "../../src/components/enterprise/MerchantAttendanceRevisionApprovalPanel";
import {revisionApprovalModel} from "./attendance-revision-approval-client-model";
import {revisionApprovalResponse} from "./attendance-revision-approval-model";
import {revisionApprovalKey} from "../../src/lib/merchantAttendanceRevisionApprovalClient";
const model=revisionApprovalModel(),base=revisionApprovalResponse(),ownerId="00000000-0000-4000-8000-000000000077";
function Demo(){
  const [open,setOpen]=useState(true),[count,setCount]=useState("");
  return <><header className="qa-toolbar">连续修订审批隔离验收 · 纯内存合成资料 · 无真实登录，不连接生产或写入业务。
    <div className="qa-controls"><select aria-label="模拟连续审批场景" onChange={e=>model.mode(e.target.value)}>{[["normal","正常"],["lost","提交成功但响应丢失"],["unsent","请求未送达"],["paused","暂停新审批"],["blocked","时间重叠"],["withdrawn","员工已撤回"],["denied","负责人权限撤销"],["advanced","后续批准已替换当前版本"]].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select>
      <button onClick={()=>setOpen(v=>!v)}>{open?"卸载连续审批":"重新进入连续审批"}</button>
      <button onClick={()=>setCount(JSON.stringify({posts:model.calls.filter(c=>c.method==="POST").length,writes:model.writes(),pending:!!sessionStorage.getItem(revisionApprovalKey(base.siteId,ownerId))}))}>读取连续审批计数</button><output aria-label="连续审批计数">{count}</output></div></header>
    <main className="qa-main">{open?<Panel siteId={base.siteId} ownerId={ownerId} apiFetch={model.apiFetch} initialRequestId={base.requestId} onClose={()=>setOpen(false)}/>:<p>已关闭；不会自动提交。</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
