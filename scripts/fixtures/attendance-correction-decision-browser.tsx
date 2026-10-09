import {createRoot} from "react-dom/client";
import {useState} from "react";
import ReviewPanel from "../../src/components/enterprise/MerchantAttendanceCorrectionReviewPanel";
import {createCorrectionReviewFixture} from "./attendance-correction-review-model";
import {createDecisionClientFixture} from "./attendance-correction-decision-client-model";
import {decisionOwner,decisionQuery,decisionAsOf} from "./attendance-correction-decision-model";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
const decisions=createDecisionClientFixture(),reviews=createCorrectionReviewFixture();
const apiFetch:AttendanceApiFetch=async(path,init)=>{
  if(path.startsWith("/api/merchant-enterprise/attendance/correction-decisions"))return decisions.apiFetch(path,init);
  const response=await reviews.apiFetch(path,init),value=await response.json(),d=decisions.value(null).decision;
  if(d){
    if(value.mode==="detail"){
      value.asOf=value.application.asOf=value.evidence.currentBasis.asOf=decisionAsOf;value.application.rules.checkedAt=decisionAsOf;
      value.item.decision=value.application.item.decision=d;
    }else if(value.mode==="list"){
      value.asOf=new URL(path,"https://synthetic.invalid").searchParams.get("asOf")??decisionAsOf;
      if(d.recordedAt<=value.asOf)for(const item of value.items)item.decision=d;
    }
  }
  return Response.json(value,{status:response.status});
};
function Demo(){
  const [mount,setMount]=useState(0),[open,setOpen]=useState(true),[count,setCount]=useState("");
  return <><header className="qa-toolbar">补正审批隔离验收 · 纯内存合成资料 · 查询日期 2026-09-30 · 禁止生产连接，模拟决定不是业务写入。
    <div className="qa-controls"><select aria-label="模拟审批场景" onChange={e=>decisions.mode(e.target.value)}>
      {[["normal","正常"],["lost","已提交但响应丢失"],["unsent","请求未送达"],["changed","核对条件变化"],["paused","暂停新审批"],["legacy","旧未绑定申请"],["blocked","核定重叠"],["withdrawn","员工已撤回"],["denied","权限撤销"],["revised","已批准后修订到第六版"],["other_root","被驳回后另一申请获批"]].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select>
      <button onClick={()=>{setOpen(true);setMount(n=>n+1);}}>重新进入界面</button>
      <button onClick={()=>setCount(JSON.stringify({reads:decisions.calls.filter(c=>c.method==="GET").length,posts:decisions.calls.filter(c=>c.method==="POST").length,writes:decisions.writes()}))}>读取审批计数</button>
      <output aria-label="审批计数">{count}</output></div></header>
    <main className="qa-main">{open?<ReviewPanel key={mount} siteId={decisionQuery.siteId} ownerId={decisionOwner} apiFetch={apiFetch} decisionsEnabled onClose={()=>setOpen(false)}/>:<p>已关闭；不会自动提交审批。</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
