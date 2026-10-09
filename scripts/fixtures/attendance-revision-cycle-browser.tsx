import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import Workspace from "../../src/components/enterprise/MerchantAttendanceRevisionWorkspace";
import {revisionCycleModel} from "./attendance-revision-cycle-client-model";
import {revisionQuery as q} from "./attendance-revision-model";
const model=revisionCycleModel(),target={workerId:q.expectedWorkerId,baseRequestId:q.baseRequestId},employeeId=model.snapshot().employeeId;
function Demo(){
  const [mounted,setMounted]=useState(true),[recovery,setRecovery]=useState(false),[count,setCount]=useState("");
  return <><header className="qa-toolbar">连续修订 · 真实组件／合成传输 · 无生产连接和写入<div className="qa-controls">
    <label>模拟修订场景<select aria-label="模拟修订场景" defaultValue="normal" onChange={e=>model.setMode(e.target.value)}>{["normal","lost","missing","paused","denied","rebound","wrong_employee","corrupt"].map(v=><option key={v}>{v}</option>)}</select></label>
    <button onClick={()=>{setMounted(false);setRecovery(true);}}>卸载修订页面</button><button onClick={()=>setMounted(true)}>重新进入修订</button>
    <button onClick={()=>model.terminal("approved")}>模拟负责人批准</button><button onClick={()=>model.terminal("rejected")}>模拟负责人驳回</button>
    <button onClick={()=>setCount(JSON.stringify({posts:model.postCount(),calls:model.calls.length,pending:!!window.sessionStorage.getItem(`faolla:attendance:revision-cycle:v2:${q.siteId}:${employeeId}`)}))}>读取修订计数</button>
  </div><output aria-label="修订计数">{count}</output></header><main className="qa-main">{mounted?<Workspace siteId={q.siteId} employeeId={employeeId} initialTarget={recovery?null:target} apiFetch={model.fetch} onClose={()=>{setMounted(false);setRecovery(true);}}/>:<p>修订页面已关闭</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
