"use client";
import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from "react";
import {AttendanceRevisionApprovalClient} from "@/lib/merchantAttendanceRevisionApprovalClient";
import type {RevisionApprovalResult} from "@/lib/merchantAttendanceRevisionApproval";
import {previewCorrection,type CorrectionProposal} from "@/lib/merchantAttendanceCorrection";
import {CORRECTION_CHECK_LABELS} from "@/lib/merchantAttendanceCorrectionReview";
import {CORRECTION_RULE_LABELS} from "@/lib/merchantAttendanceCorrectionRules";
import {formatAttendanceTimesheetDuration as duration} from "@/lib/merchantAttendanceTimesheetDisplay";
import type {AttendanceSessionResult} from "@/lib/merchantAttendanceSession";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
import RulesNotice from "./MerchantAttendanceCorrectionRulesNotice";
const HistoryPanel=lazy(()=>import("./MerchantAttendanceRevisionHistoryPanel"));
const button="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input="mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:opacity-50";
const labels:Record<string,string>={...CORRECTION_CHECK_LABELS,...Object.fromEntries(Object.entries(CORRECTION_RULE_LABELS).map(([k,v])=>[`rule_${k}`,v])),
  effective_overlap:"申请与其他班次的最新有效时段重叠，不能批准。",missing_overlap:"与当前已批准的整段漏卡时段重叠，不能批准；请先核实并修订冲突来源。",already_decided:"本申请已有决定，不能重复审批。",base_changed:"当前有效核定与申请提交时基准不同，不能覆盖较新的结果。"};
type Props={siteId:string;ownerId:string;apiFetch:AttendanceApiFetch;onClose:()=>void;initialRequestId?:string|null;historyEnabled?:boolean;registerLeaveGuard?:(guard:(()=>boolean)|null)=>void};
export default function MerchantAttendanceRevisionApprovalPanel(props:Props){return <Screen key={`${props.siteId}:${props.ownerId}`} {...props}/>;}
function Screen({siteId,ownerId,apiFetch,onClose,registerLeaveGuard,initialRequestId=null,historyEnabled=process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_HISTORY_ENABLED==="1"}:Props){
  const client=useMemo(()=>new AttendanceRevisionApprovalClient({siteId,ownerId,apiFetch,storage:()=>window.sessionStorage}),[siteId,ownerId,apiFetch]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),[draft,setDraft]=useState(""),[dirty,setDirty]=useState(false);
  const [historyOpen,setHistoryOpen]=useState(historyEnabled&&initialRequestId===null);
  const [initialized,setInitialized]=useState(false),initializedRef=useRef(false),historyRef=useRef(historyOpen);
  useEffect(()=>{historyRef.current=historyOpen;},[historyOpen]);
  useEffect(()=>{
    let active=true;
    const restore=async(first:boolean)=>{await client.initialize(first?initialRequestId:undefined);if(!active)return;initializedRef.current=true;setInitialized(true);
      if(client.getSnapshot().pending||client.getSnapshot().result?.receipt){historyRef.current=false;setHistoryOpen(false);}};
    if(document.visibilityState!=="hidden")void restore(true);
    const visible=()=>{setDirty(false);setDraft("");if(document.visibilityState==="hidden")client.pause();else if(!initializedRef.current)void restore(true);else if(!historyRef.current)void restore(false);};
    document.addEventListener("visibilitychange",visible);return()=>{active=false;document.removeEventListener("visibilitychange",visible);client.pause();};
  },[client,initialRequestId]);
  useEffect(()=>{const unload=(e:BeforeUnloadEvent)=>{if(dirty||client.hasLeaveRisk()){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",unload);return()=>window.removeEventListener("beforeunload",unload);},[client,dirty]);
  const leavePanel=useCallback(()=>{if((dirty||client.hasLeaveRisk())&&!window.confirm("离开清除未提交草稿，不撤销已发送审批。未确认操作请在同一账号和标签页回来查询原编号。继续？"))return false;
    client.pause();return true;},[client,dirty]);
  useEffect(()=>{registerLeaveGuard?.(leavePanel);return()=>registerLeaveGuard?.(null);},[leavePanel,registerLeaveGuard]);
  const navigate=(fn:()=>void)=>{if(!dirty||window.confirm("未提交的审批理由和确认会清除，继续吗？")){setDirty(false);fn();}};
  const r=state.result,busy=state.phase==="loading"||state.phase==="saving";
  const historyVisible=historyEnabled&&historyOpen&&!state.pending&&(state.phase==="idle"||state.phase==="ready");
  return <section aria-label="负责人连续修订审批" className="mt-5 min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">连续修订审批</h2><p className="mt-1 text-sm text-slate-600">仅当前负责人 · 先核对基准，再明确批准或驳回</p></div>
      <button type="button" className={button} onClick={()=>{if(leavePanel())onClose();}}>返回考勤管理</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">批准产生下一版核定，不覆盖原始打卡或历史批准。驳回保留申请并不改变工时。当前不能撤销决定，不代表工资结算。{historyEnabled?"可从修订待办与历史进入详情；进入后重新核验最新状态。":"待办列表候选入口尚未开放，目前按修订申请编号核对或恢复原操作。"}</p>
    {historyEnabled&&<button type="button" className={button} disabled={busy||!!state.pending} onClick={()=>navigate(()=>{client.pause();setHistoryOpen(true);})}>修订待办／已处理记录</button>}
    {!initialized?<p role="status">正在核对待确认审批…</p>:historyVisible?<Suspense fallback={<p role="status">正在加载修订列表…</p>}><HistoryPanel siteId={siteId} actorId={ownerId} access="owner" apiFetch={apiFetch}
      onSelect={item=>{setHistoryOpen(false);setDraft("");void client.initialize(item.requestId);}} onClose={()=>{setHistoryOpen(false);void client.initialize();}}/></Suspense>:<>
    <form aria-label="选择修订申请" className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();if(!busy&&!state.pending)navigate(()=>void client.initialize(draft.trim()));}}>
      <label className="min-w-0 flex-1 text-sm">修订申请编号<input className={input} value={draft} maxLength={36} required disabled={busy||!!state.pending} placeholder="员工修订详情中的申请编号" onChange={e=>setDraft(e.target.value)}/></label><button className={button} disabled={busy||!!state.pending||!draft.trim()}>读取修订申请</button></form>
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm ${state.phase==="blocked"?"bg-rose-50 text-rose-900":"bg-blue-50 text-blue-950"}`}>{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>navigate(()=>void client.initialize())}>重新核对／查原收据</button>
      {state.pending&&<button type="button" className={button} disabled={state.phase!=="unconfirmed"||busy} onClick={()=>{if(window.confirm("先查询收据，仍未确认时只用原编号和原内容重试，继续？"))void client.retry();}}>明确按原编号重试审批</button>}</div>
    {state.pending&&<div className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm"><p>先处理本标签页未确认审批，不能换目标。未查到收据不等于失败。</p><p className="break-all text-xs">原申请：{state.pending.command.requestId}<br/>原操作：{state.pending.command.operationId}</p><p>原决定：{state.pending.command.action==="approve"?"批准":"驳回"}</p></div>}
    {r&&<>
      <Review result={r}/>
      {!r.moduleEnabled&&<p className="rounded-xl bg-amber-50 p-3 text-sm">平台暂停新审批，只核对历史和恢复既有收据。</p>}
      <section aria-label="修订审批阻断项" className="space-y-2 rounded-xl border border-slate-200 p-4 text-sm"><h3 className="font-bold">当前审批检查</h3>
        {r.blockers.length?<ul className="list-disc space-y-1 pl-5">{r.blockers.map(k=><li key={k}>{labels[k]??"需进一步核查。"}</li>)}</ul>:<p>已接入检查未发现阻断项，提交事务仍会复核；不代表已批准。</p>}
        {r.canReject&&!r.canApprove&&!r.decision&&<p>当前不能批准；仍可说明理由后明确驳回，不产生新核定工时。</p>}</section>
      {!r.decision&&r.review.requestState==="submitted"&&<DecisionForm key={`${r.requestId}:${r.evidenceToken}:${r.asOf}`} result={r} disabled={busy||!!state.pending||state.phase!=="ready"||!r.moduleEnabled}
        onDirty={()=>setDirty(true)} onSubmit={intent=>{setDirty(false);void client.submit(intent);}}/>}
    </>}
    </>}
    <p className="text-xs leading-6 text-slate-500">隐藏页面清除结果和未提交草稿，返回时重新鉴权。待确认命令只暂存当前标签页的企业／负责人专属槽，包含理由；关闭标签页、清理站点或换设备不能保证恢复。不轮询、不后台自动审批。</p>
  </section>;
}
function Review({result:r}:{result:RevisionApprovalResult}){
  const a=r.review.review.application,b=r.review.base,comparison=previewCorrection(a.basis,a.proposal),raw=comparison.original;
  const state=r.decision?(r.decision.action==="approve"?"已批准":"已驳回"):r.review.requestState==="withdrawn"?"已撤回":"待审批";
  return <div className="space-y-4"><header><h3 className="text-lg font-bold">{r.review.review.item.workerName} · {r.review.review.item.workerNo}</h3><p className="mt-1 text-sm">本次申请 · {state} · 提交版本 {r.review.submittedRevision}</p><p className="mt-2 break-all text-xs">申请编号：{r.requestId}<br/>申请时区：{b.timeZone} · 提交时间（UTC）：{a.item.submittedAt}</p></header>
    <p className="break-words rounded-xl bg-slate-50 p-3 text-sm">申请理由：{a.reason}{a.withdrawal&&<><br/>撤回理由：{a.withdrawal.reason}</>}</p><RulesNotice rules={a.rules}/>
    <div className="grid min-w-0 gap-3 md:grid-cols-3"><section aria-label="原始打卡工时" className="min-w-0 space-y-2 rounded-xl bg-slate-50 p-4 text-sm"><h4 className="font-bold">原始打卡 · 保留不变</h4><p className="text-lg font-semibold">{duration(raw.totals!.workedUs)}</p><p className="break-all text-xs">UTC：{raw.startAt} → {raw.endAt}</p></section>
      <Statement title={`提交时核定 · 修订 ${b.revision}`} basis={a.basis} proposal={b.proposal}/><Statement title="本次员工声明 · 非生效凭证" basis={a.basis} proposal={a.proposal}/></div>
    <div className="grid min-w-0 gap-3 md:grid-cols-2"><section aria-label="本次审批结果" className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-4 text-sm"><h4 className="font-bold">本次审批结果</h4>
      {r.decision?<><p>{r.decision.action==="approve"?"已批准该声明":"已驳回，不产生新核定"}</p>{r.decision.action==="approve"&&<><p className="text-lg font-semibold">{duration(comparison.proposed.totals!.workedUs)} · 修订 {b.revision+1}</p><p className="text-xs">按本次保存的已批准声明复算，不用后续版本替换历史结果。</p></>}
        <p className="break-words">决定理由：{r.decision.reason}</p><p className="break-all text-xs">决定操作：{r.decision.operationId}<br/>决定时间（UTC）：{r.decision.recordedAt}</p></>:<p>{r.review.requestState==="withdrawn"?"申请已撤回，没有审批决定。":"尚未审批，声明不计入当前核定。"}</p>}</section>
      <section aria-label="当前有效核定" className="min-w-0 space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm"><h4 className="font-bold">当前有效核定</h4><p className="text-lg font-semibold">{duration(r.current.workedUs)} · 修订 {r.current.revision}</p><p className="break-all text-xs">来源申请：{r.current.requestId}<br/>生效操作：{r.current.operationId}<br/>生效时间（UTC）：{r.current.recordedAt}</p>
        <p>{r.decision?.action==="approve"?(r.current.operationId===r.decision.operationId?"当前采用本次批准结果。":"已有后续批准替换当前工时，本次历史结果保留。"):"本申请尚未产生有效批准，当前工时来自其他已批准来源。"}</p></section></div>
    <details className="rounded-xl border border-slate-200 p-3 text-sm"><summary className="cursor-pointer font-semibold">原始依据、相邻班次与在职日期</summary><div className="mt-3 space-y-3">
      {([['提交时原始记录',a.basis],['当前原始记录',r.review.review.evidence.currentBasis]] as const).map(([label,basis])=><div key={label}><h4 className="font-bold">{label}</h4>{basis?<ol className="max-h-56 space-y-1 overflow-auto text-xs">{basis.events.map(e=><li key={e.id} className="break-all">{e.sequence}. {e.action} · {e.occurredAt}</li>)}</ol>:<p>当前依据无法完整读取，不能据此批准。</p>}</div>)}
      <p className="break-all text-xs">前一班次结束：{r.review.review.evidence.previous?.occurredAt??"无可核对记录"}<br/>后一班次开始：{r.review.review.evidence.next?.occurredAt??"无可核对记录"}</p>
      {r.review.review.evidence.employmentPeriods.map(p=><p key={p.startsOn}>{p.startsOn} → {p.endsOn??"未设置结束"}</p>)}</div></details>
    <p className="break-all text-xs leading-6 text-slate-500">以上为全班次，不是周期截取合计或工资。休息带薪标记不等于计薪规则；定位、排班与其他劳动条件不能据此推断通过。读取时间（UTC）：{r.asOf}</p>
  </div>;
}
function Statement({title,basis,proposal:p}:{title:string;basis:AttendanceSessionResult;proposal:CorrectionProposal}){const totals=previewCorrection(basis,p).proposed.totals!;return <section aria-label={title} className="min-w-0 space-y-2 rounded-xl bg-slate-50 p-4 text-sm"><h4 className="font-bold">{title}</h4><p className="text-lg font-semibold">{duration(totals.workedUs)}</p><p className="break-all text-xs">UTC：{p.startAt} → {p.endAt}</p><p>全部休息 {duration(totals.breakUs)}</p><details><summary>休息声明（{p.breaks.length} 段）</summary>{p.breaks.map((b,n)=><p key={n} className="break-all text-xs">{b.startAt} → {b.endAt} · {b.paid?"带薪标记":"非带薪标记"}</p>)}</details></section>;}
function DecisionForm({result:r,disabled,onDirty,onSubmit}:{result:RevisionApprovalResult;disabled:boolean;onDirty:()=>void;onSubmit:(v:{action:"approve"|"reject";reason:string})=>void}){
  const [action,setAction]=useState<""|"approve"|"reject">(""),[reason,setReason]=useState(""),[ack,setAck]=useState(false),permitted=action==="approve"?r.canApprove:action==="reject"?r.canReject:false;
  const valid=!!reason.trim()&&[...reason.trim()].length<=500&&!/[\u0000-\u001f\u007f-\u009f]/.test(reason);
  return <form aria-label="确认修订审批" className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={e=>{e.preventDefault();if(!disabled&&action&&permitted&&valid&&ack)onSubmit({action,reason:reason.trim()});}}><fieldset disabled={disabled} className="space-y-3"><legend className="font-bold">明确决定</legend>
    <label className="block text-sm">修订审批决定<select aria-label="修订审批决定" className={input} value={action} required onChange={e=>{setAction(e.target.value as typeof action);setAck(false);onDirty();}}><option value="">请选择，不默认批准</option><option value="approve" disabled={!r.canApprove}>批准为下一版核定</option><option value="reject" disabled={!r.canReject}>驳回并保留历史</option></select></label>
    <label className="block text-sm">修订审批理由（单行 1—500 字，员工可见）<input className={input} value={reason} required maxLength={1000} onChange={e=>{setReason(e.target.value);setAck(false);onDirty();}}/></label>
    <p className="break-all text-xs text-slate-500">提交版本 {r.review.submittedRevision} · 核定前驱：{r.review.base.operationId}</p>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={!permitted||!valid} onChange={e=>{setAck(e.target.checked);onDirty();}}/><span>我已核对员工、原始记录、提交时基准、声明差异和理由；确认{action==="approve"?"批准":action==="reject"?"驳回":"所选决定"}，了解当前不能撤销决定。</span></label>
    <button className={button} disabled={!permitted||!valid||!ack}>{action==="approve"?"确认批准修订":action==="reject"?"确认驳回修订":"请选择修订决定"}</button>
  </fieldset></form>;
}
