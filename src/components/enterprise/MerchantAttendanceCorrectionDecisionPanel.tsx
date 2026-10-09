"use client";
import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import {AttendanceCorrectionDecisionClient} from "@/lib/merchantAttendanceCorrectionDecisionClient";
import type {CurrentCorrectionDecisionResult} from "@/lib/merchantAttendanceCurrentCorrectionDecision";
import {formatAttendanceTimesheetDuration as duration} from "@/lib/merchantAttendanceTimesheetDisplay";
import {CORRECTION_CHECK_LABELS} from "@/lib/merchantAttendanceCorrectionReview";
import {CORRECTION_RULE_LABELS} from "@/lib/merchantAttendanceCorrectionRules";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
const button="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:opacity-50";
const blockerLabels:Record<string,string>={...CORRECTION_CHECK_LABELS,
  ...Object.fromEntries(Object.entries(CORRECTION_RULE_LABELS).map(([k,v])=>[`rule_${k}`,v])),
  already_decided:"申请已有决定，不能重复处理。",already_effective:"本班次已有核定结果；后续调整须走再次修订流程，本页面不会覆盖。",effective_overlap:"声明与其他班次当前有效时段重叠，不能批准。",missing_overlap:"与当前已批准的整段漏卡时段重叠，不能批准；请先核实并修订冲突来源。"};
type Props={siteId:string;ownerId:string;initialRequestId:string|null;apiFetch:AttendanceApiFetch;onClose:()=>void;renderReview:(r:CurrentCorrectionDecisionResult)=>ReactNode;registerLeaveGuard?:(guard:(()=>boolean)|null)=>void};
export default function MerchantAttendanceCorrectionDecisionPanel(props:Props){return <Screen key={`${props.siteId}:${props.ownerId}`} {...props}/>;}
function Screen({siteId,ownerId,initialRequestId,apiFetch,onClose,renderReview,registerLeaveGuard}:Props){
  const client=useMemo(()=>new AttendanceCorrectionDecisionClient({siteId,ownerId,apiFetch,storage:()=>window.sessionStorage}),[siteId,ownerId,apiFetch]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),[dirty,setDirty]=useState(false);
  const initializedRef=useRef(false);
  useEffect(()=>{
    let active=true;initializedRef.current=false;
    const restore=async(first:boolean)=>{await client.initialize(first?initialRequestId:undefined);if(active)initializedRef.current=true;};
    if(document.visibilityState!=="hidden")void restore(true);
    const visible=()=>{setDirty(false);if(document.visibilityState==="hidden")client.pause();else void restore(!initializedRef.current);};
    document.addEventListener("visibilitychange",visible);return()=>{active=false;document.removeEventListener("visibilitychange",visible);client.pause();};
  },[client,initialRequestId]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty||client.hasLeaveRisk()){e.preventDefault();e.returnValue="";}};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[client,dirty]);
  const leavePanel=useCallback(()=>{if(dirty&&!window.confirm("未提交的审批理由和确认会清除，继续吗？"))return false;
    if(client.hasLeaveRisk()&&!window.confirm("审批结果可能尚未确认，离开不会撤销已发送操作。请在同一账号和标签页回来查询原编号，继续吗？"))return false;
    client.pause();return true;},[client,dirty]);
  useEffect(()=>{registerLeaveGuard?.(leavePanel);return()=>registerLeaveGuard?.(null);},[leavePanel,registerLeaveGuard]);
  const leaveDraft=()=>!dirty||window.confirm("未提交的审批理由和确认会清除，继续吗？");
  const busy=state.phase==="loading"||state.phase==="saving",r=state.result;
  return <section aria-label="负责人补正审批" className="mt-5 min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">补正审批</h2><p className="mt-1 text-sm text-slate-600">仅当前负责人 · 一份申请一个决定</p></div>
      <button type="button" className={button} onClick={()=>{if(leavePanel())onClose();}}>返回核对列表</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">批准保存本次核定结果，不覆盖原始打卡。历史审批结果与当前有效工时分别显示；周期报表按查询日期范围统计当前有效来源，不代表工资结算。驳回保留原申请。当前不支持撤销审批决定，请仔细核对。</p>
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm ${state.phase==="blocked"?"bg-rose-50 text-rose-900":"bg-blue-50 text-blue-950"}`}>{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>{if(leaveDraft()){setDirty(false);void client.initialize();}}}>重新核对／查原收据</button>
      {state.pending&&<button type="button" className={button} disabled={busy||state.phase!=="unconfirmed"} onClick={()=>void client.retry()}>先查收据，再用原编号重试</button>}</div>
    {state.pending&&<div className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs"><p>先处理本标签页待确认审批，不能换目标或发起新决定。</p>
      <p className="break-all">原申请：{state.pending.command.requestId}<br/>原操作编号：{state.pending.command.operationId}</p>
      <p>拟执行：{state.pending.command.action==="approve"?"批准":"驳回"}。当前结果不确定；未查到收据不等于失败，不会自动丢弃。</p></div>}
    {r&&<>
      {renderReview(r)}
      <section aria-label="决定事务检查" className="space-y-2 rounded-xl border border-slate-200 p-4"><h3 className="font-bold">当前审批检查</h3>
        {r.blockers.length?<ul className="list-disc space-y-1 pl-5 text-sm">{r.blockers.map(k=><li key={k}>{blockerLabels[k]??"需要负责人进一步核查。"}</li>)}</ul>
          :<p className="text-sm">已接入检查未发现阻断项；提交事务仍会再次核对，条件变化时不会直接批准。</p>}
        {!r.moduleEnabled&&<p className="text-sm text-amber-900">平台已暂停新审批，只核对既有结果。</p>}
        {r.canReject&&!r.canApprove&&!r.decision&&<p className="text-sm">当前不能批准；仍可说明理由后明确驳回，不产生核定工时。</p>}
      </section>
      {!r.decision&&<DecisionForm key={`${r.review.item.requestId}:${r.evidenceToken}:${r.asOf}`} result={r}
        disabled={busy||!!state.pending||state.phase!=="ready"||!r.moduleEnabled} onDirty={()=>setDirty(true)}
        onSubmit={intent=>{setDirty(false);void client.submit(intent);}}/>}
      <DecisionSources result={r}/>
    </>}
    <p className="text-xs leading-6 text-slate-500">待确认命令只暂存在本标签页的企业／负责人专属槽，包含决定理由，不保存员工打卡明细。隐藏页面清除未提交草稿并重新鉴权；不轮询、不后台自动审批。关闭标签页或清理站点后不能保证自动恢复，请先核对原编号。</p>
  </section>;
}
function DecisionSources({result:r}:{result:CurrentCorrectionDecisionResult}){
  const own=r.decisionEffect,current=r.current;
  return <section aria-label="审批结果与当前工时" className="space-y-3">
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      <article aria-label="本次审批结果" className="min-w-0 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
        <h3 className="font-bold">本次审批结果</h3>
        {own?<><p className="text-lg font-semibold">{duration(own.workedUs)}</p><p>首次核定 · 修订 {own.revision} · 政策版本 {own.policyRevision}</p>
          <p className="break-all">批准操作：{own.operationId}<br/>批准时间（UTC）：{own.recordedAt}</p><p>此结果保留为历史，不随后续修订改写。</p></>
          :<p>{r.decision?.action==="reject"?"本次申请已驳回，没有产生核定工时。":"本次申请尚无批准结果，不计为零工时。"}</p>}
      </article>
      <article aria-label="当前有效工时" className="min-w-0 space-y-2 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm">
        <h3 className="font-bold">当前有效工时</h3>
        {current?<><p className="text-lg font-semibold">{duration(current.workedUs)}</p><p>当前核定 · 修订 {current.revision} · 政策版本 {current.policyRevision}</p>
          <p className="break-all">来源申请：{current.requestId}<br/>生效操作：{current.operationId}<br/>核定时间（UTC）：{current.recordedAt}</p>
          <p>{current.lineage.rootRequestId!==r.review.item.requestId?"当前工时来自该班次的另一份获批申请，并非本次申请。":current.revision>1?"后续修订已替换当前工时，本次历史审批结果仍保留。":"当前仍采用本次首次核定结果。"}</p></>
          :<p>该班次尚无已批准的核定结果；原始打卡仍保留，不表示没有出勤。</p>}
      </article>
    </div>
    <p className="break-all text-xs leading-6 text-slate-500">以上为整个班次的工时，不是周期截取合计，也不是工资。读取时间（UTC）：{r.asOf}。需要最新状态时请重新核对。</p>
  </section>;
}
function DecisionForm({result:r,disabled,onDirty,onSubmit}:{result:CurrentCorrectionDecisionResult;disabled:boolean;onDirty:()=>void;onSubmit:(intent:{action:"approve"|"reject";reason:string})=>void}){
  const [action,setAction]=useState<""|"approve"|"reject">(""),[reason,setReason]=useState(""),[ack,setAck]=useState(false);
  const validReason=!!reason.trim()&&[...reason.trim()].length<=500&&!/[\u0000-\u001f\u007f-\u009f]/.test(reason);
  const permitted=action==="approve"?r.canApprove:action==="reject"?r.canReject:false;
  return <form aria-label="确认补正决定" className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={e=>{e.preventDefault();if(!disabled&&action&&ack&&permitted&&validReason)onSubmit({action,reason:reason.trim()});}}>
    <label className="block text-sm">选择决定<select aria-label="选择决定" className={input} value={action} required disabled={disabled} onChange={e=>{setAction(e.target.value as typeof action);setAck(false);onDirty();}}>
      <option value="">请选择，不默认批准</option><option value="approve" disabled={!r.canApprove}>批准并保存独立核定声明</option><option value="reject" disabled={!r.canReject}>驳回并保留申请</option></select></label>
    <label className="block text-sm">决定理由（单行，1—500 字，员工可见）<input type="text" className={input} required value={reason} disabled={disabled} onChange={e=>{setReason(e.target.value);setAck(false);onDirty();}}/></label>
    <p className="text-xs text-slate-500">当前申请版本 {r.review.item.revision} · 修改决定或理由后需要重新确认。</p>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={disabled||!permitted||!validReason} onChange={e=>{setAck(e.target.checked);onDirty();}}/><span>我已核对申请人、原始记录、声明差异和决定理由；确认{action==="approve"?"批准该声明":action==="reject"?"驳回该申请":"所选决定"}，了解当前不能撤销决定。</span></label>
    <button type="submit" className={button} disabled={disabled||!ack||!permitted||!validReason}>{action==="approve"?"确认批准":action==="reject"?"确认驳回":"请选择决定"}</button>
  </form>;
}
