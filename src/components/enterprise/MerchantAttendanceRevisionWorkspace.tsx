"use client";
import {lazy,Suspense,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from "react";
import {AttendanceRevisionCycleClient,type RevisionTarget} from "@/lib/merchantAttendanceRevisionCycleClient";
import type {RevisionCycleEffect,RevisionCycleItem} from "@/lib/merchantAttendanceRevisionCycle";
import {correctionTimeInput,correctionTimeOffsets,correctionDraftProposal,correctionTimeControlValue,type CorrectionDraft,type CorrectionTimeInput} from "@/lib/merchantAttendanceCorrectionForm";
import {previewCorrection,type CorrectionProposal} from "@/lib/merchantAttendanceCorrection";
import {formatAttendanceTimesheetDuration as duration} from "@/lib/merchantAttendanceTimesheetDisplay";
import {summarizeAttendanceSessionRecords,type AttendanceSessionResult} from "@/lib/merchantAttendanceSession";
import type {AttendanceApiFetch} from "@/lib/merchantAttendanceSelfClient";
import RulesNotice from "./MerchantAttendanceCorrectionRulesNotice";
import ApplicationWindowPanel from "./MerchantAttendanceApplicationWindowPanel";
import WindowRecoveryLauncher from "./MerchantAttendanceApplicationWindowRecoveryLauncher";
import ReviewRoutingSelf from "./MerchantAttendanceReviewRoutingSelf";
import { applicationWindowLegacyPorts, type ApplicationWindowPrepareQuery } from "@/lib/merchantAttendanceApplicationWindowClient";
const HistoryPanel=lazy(()=>import("./MerchantAttendanceRevisionHistoryPanel"));
const button="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input="mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm";
const statuses:Record<RevisionCycleItem["status"],string>={submitted:"待负责人审批",withdrawn:"已撤回",approved:"已批准",rejected:"已驳回"};
type Props={siteId:string;employeeId:string;authUserId?:string|null;initialTarget:RevisionTarget|null;apiFetch:AttendanceApiFetch;onClose:()=>void;historyEnabled?:boolean;applicationWindowEnabled?:boolean;registerLeaveGuard?:(guard:(()=>boolean)|null)=>void};
export default function MerchantAttendanceRevisionWorkspace(props:Props){
  const enabled=props.applicationWindowEnabled??process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED==="1",key=`${props.siteId}:${props.employeeId}:${props.authUserId??""}:${enabled}:${JSON.stringify(props.initialTarget)}`;
  /* eslint-disable react-hooks/refs -- Monotonic authority revocation before effect cleanup; never rendered data. */
  const scope=useRef({key,apiFetch:props.apiFetch,token:0});if(scope.current.key!==key||scope.current.apiFetch!==props.apiFetch)scope.current={key,apiFetch:props.apiFetch,token:scope.current.token+1};
  const token=scope.current.token,isCurrentAuth=useCallback(()=>scope.current.token===token,[token]);
  return <Screen key={token} {...props} applicationWindowEnabled={enabled} isCurrentAuth={isCurrentAuth}/>;
  /* eslint-enable react-hooks/refs */
}
function Screen({siteId,employeeId,authUserId,initialTarget,apiFetch,onClose,applicationWindowEnabled,registerLeaveGuard,isCurrentAuth,historyEnabled=process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_HISTORY_ENABLED==="1"}:Props&{isCurrentAuth:()=>boolean}){
  const client=useMemo(()=>new AttendanceRevisionCycleClient({siteId,employeeId,...applicationWindowLegacyPorts(apiFetch,()=>window.sessionStorage,isCurrentAuth)}),[siteId,employeeId,apiFetch,isCurrentAuth]);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot),root=useRef<HTMLElement>(null);
  const [historyTarget,setHistoryTarget]=useState<RevisionTarget|null>(null);
  const [windowTarget,setWindowTarget]=useState<ApplicationWindowPrepareQuery|null>(null);
  const hasWindowAuth=typeof authUserId==="string"&&authUserId.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(authUserId),windowAvailable=!!applicationWindowEnabled&&hasWindowAuth;
  const historyRef=useRef(false);useEffect(()=>{historyRef.current=historyTarget!==null;},[historyTarget]);
  const dirty=()=>!!root.current?.querySelector('[data-revision-dirty="true"]');
  useEffect(()=>{
    if(windowTarget)return;
    if(document.visibilityState!=="hidden")void client.initialize(initialTarget);
    const visible=()=>{if(document.visibilityState==="hidden")client.pause();else if(!historyRef.current)void client.initialize();};
    const unload=(e:BeforeUnloadEvent)=>{if(dirty()||client.hasLeaveRisk()){e.preventDefault();e.returnValue="";}};
    document.addEventListener("visibilitychange",visible);window.addEventListener("beforeunload",unload);
    return()=>{document.removeEventListener("visibilitychange",visible);window.removeEventListener("beforeunload",unload);client.pause();};
  },[client,initialTarget,windowTarget]);
  const leave=useCallback(()=>{if((root.current?.querySelector('[data-revision-dirty="true"]')||client.hasLeaveRisk())&&!window.confirm("离开会清除未提交草稿；待确认完整原编号保留，不撤回已发送申请。继续？"))return false;client.pause();return true;},[client]);
  useLayoutEffect(()=>{if(windowTarget)return;registerLeaveGuard?.(leave);return()=>registerLeaveGuard?.(null);},[windowTarget,registerLeaveGuard,leave]);
  const navigate=(fn:()=>void)=>{if(!dirty()||window.confirm("未提交的时间和理由会清除，继续吗？"))fn();};
  const r=state.result,busy=state.phase==="loading"||state.phase==="saving",locked=busy||!!state.pending||state.phase!=="ready";
  const openWindow=(target:ApplicationWindowPrepareQuery,recovery=false)=>{if(!(recovery?hasWindowAuth:windowAvailable)||!isCurrentAuth()||document.hidden||busy||state.pending)return;navigate(()=>{client.pause();setHistoryTarget(null);setWindowTarget(target);});};
  if(windowTarget&&authUserId)return <ApplicationWindowPanel query={windowTarget} employeeId={employeeId} authUserId={authUserId} apiFetch={apiFetch} enabled={!!applicationWindowEnabled} isCurrentAuth={isCurrentAuth} registerLeaveGuard={registerLeaveGuard} onClose={()=>setWindowTarget(null)}/>;
  return <section ref={root} aria-label="本人连续修订" className="mt-5 min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">再次修订申请</h2><p className="mt-1 text-sm text-slate-600">基于当前核定申请调整；不修改原始打卡，不直接改变生效工时。</p></div>
      <button type="button" className={button} onClick={()=>{if(leave())onClose();}}>返回补正申请</button></header>
    {hasWindowAuth&&authUserId&&<WindowRecoveryLauncher siteId={siteId} employeeId={employeeId} authUserId={authUserId} family="correction_revision" isCurrentAuth={isCurrentAuth} disabled={busy||!!state.pending||!!historyTarget}
      beforeDiscover={()=>{if(dirty()&&!window.confirm("核验原编号会清除未提交草稿，继续吗？"))return false;client.pause();return true;}} onSelect={target=>openWindow(target,true)}/>}
    {historyEnabled&&historyTarget?<Suspense fallback={<p role="status">正在加载本班次修订历史…</p>}><HistoryPanel siteId={siteId} actorId={employeeId} access="self" workerId={historyTarget.workerId} rootRequestId={historyTarget.baseRequestId} apiFetch={apiFetch}
      onSelect={item=>{setHistoryTarget(null);void client.initialize({workerId:item.workerId,baseRequestId:item.rootRequestId},item.requestId);}}
      onClose={()=>{setHistoryTarget(null);void client.initialize();}}/></Suspense>:<>
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>navigate(()=>void client.initialize())}>重新读取／查原收据</button>
      {r?.mode==="detail"&&<button type="button" className={button} disabled={locked} onClick={()=>navigate(()=>void client.prepare())}>返回当前核定／准备新申请</button>}
      {historyEnabled&&r&&<button type="button" className={button} disabled={locked} onClick={()=>navigate(()=>{setHistoryTarget({workerId:r.workerId,baseRequestId:r.rootRequestId});client.pause();})}>本班次修订历史</button>}</div>
    {state.pending&&<div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm"><p>待确认：{state.pending.command.action==="submit"?"提交修订":"撤回修订"}；未查到不等于失败，先处理原编号。</p>
      <p className="break-all text-xs">原申请：{state.pending.query.requestId}<br/>原操作：{state.pending.command.operationId}</p>
      <button type="button" className={button} disabled={state.phase!=="unconfirmed"||!state.workerId} onClick={()=>{if(window.confirm("先查询收据；仍未确认时只重试原编号和原内容，继续？"))void client.retry();}}>明确按原编号重试</button></div>}
    {r&&<>
      {!r.moduleEnabled&&<p className="rounded-xl bg-amber-50 p-3 text-sm">平台已暂停新申请；按现有权限可核对历史、恢复收据和撤回待审申请。</p>}
      <div className="grid min-w-0 gap-3 md:grid-cols-2"><section aria-label="原始打卡工时" className="min-w-0 rounded-xl bg-slate-50 p-4 text-sm"><h3 className="font-bold">原始打卡 · 保留不变</h3>
        <p className="mt-2 text-lg font-semibold">{duration(summarizeAttendanceSessionRecords(r.basis).totals!.workedUs)}</p><p className="mt-2 break-all">原始上班（UTC）：{r.basis.events[0].occurredAt}<br/>原始下班（UTC）：{r.basis.events.at(-1)!.occurredAt}</p></section>
        <Source title="当前有效核定" effect={r.current}/></div>
      <RulesNotice rules={r.currentRules}/>
      {r.mode==="prepare"&&<>
        {r.pendingRequestId?<div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm"><p>本班次已有待审修订，不能重复创建。</p><button className={button} disabled={locked} onClick={()=>void client.detail(r.pendingRequestId!)}>查看待审修订</button></div>
          :r.canSubmit&&r.moduleEnabled?windowAvailable?<button type="button" className={button} disabled={locked} onClick={()=>openWindow({siteId,family:"correction_revision",mode:"prepare",workerId:r.workerId,baseRequestId:r.rootRequestId})}>通过规则窗口准备再次修订</button>:<RevisionEditor key={`${r.current.operationId}:${r.revision}:${r.asOf}`} basis={r.basis} current={r.current} disabled={locked} submit={(p,n)=>void client.submit(p,n)}/>
            :<p className="text-sm text-amber-900">当前状态、权限或申请规则不允许新建修订；没有创建申请。</p>}
        {r.current.revision>1&&<button type="button" className={button} disabled={locked} onClick={()=>navigate(()=>void client.detail(r.current.requestId))}>查看当前核定对应申请</button>}
      </>}
      {r.item&&<section aria-label="本次修订详情" className="space-y-3 rounded-2xl border border-slate-200 p-4">
        {hasWindowAuth&&authUserId&&!state.pending&&<ReviewRoutingSelf siteId={siteId} authUserId={authUserId} family="correction_revision" requestId={r.item.requestId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth}/>}
        <h3 className="font-bold">本次修订 · {statuses[r.item.status]}</h3><p className="break-all text-xs">申请编号：{r.item.requestId} · 提交版本 {r.item.submittedRevision}<br/>提交时间（UTC）：{r.item.submittedAt}</p>
        <p className="break-words text-sm">申请理由：{r.item.reason}</p>
        <div className="grid min-w-0 gap-3 md:grid-cols-2"><Source title="提交时的核定基准" effect={r.item.basedOn}/><Proposal title="本次申请声明" basis={r.basis} proposal={r.item.proposal}/></div>
        {r.item.decision&&<p className="break-words rounded-xl bg-slate-50 p-3 text-sm">负责人决定：{r.item.decision.action==="approve"?"批准":"驳回"}<br/>理由：{r.item.decision.reason}<br/>决定时间（UTC）：{r.item.decision.recordedAt}</p>}
        {r.item.decisionEffect?<Source title="本次批准结果 · 历史保留" effect={r.item.decisionEffect}/>:<p className="text-sm">本次没有已批准的结果；以页面上方当前有效核定为准，不把声明计入工时。</p>}
        {r.item.withdrawal&&<p className="break-words text-sm">撤回理由：{r.item.withdrawal.reason}</p>}
        {r.canWithdraw&&<Withdrawal key={`${r.item.requestId}:${r.item.revision}`} disabled={locked} submit={n=>void client.withdraw(n)}/>}
      </section>}
      <p className="break-all text-xs leading-6 text-slate-500">以上为整个班次，不是周期截取合计或工资。读取时间（UTC）：{r.asOf}。历史基准和本次结果不会随后续修订改写。</p>
    </>}
    </>}
    <p className="text-xs leading-6 text-slate-500">隐藏页面清空未提交草稿并重新核验身份。待确认命令只存当前标签页，包含时间和理由；关闭标签页、清理站点或换设备不能保证恢复。不采集定位，不自动提交或后台重试。</p>
  </section>;
}
function Source({title,effect:e}:{title:string;effect:RevisionCycleEffect}){return <section aria-label={title} className="min-w-0 space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm"><h3 className="font-bold">{title}</h3>
  <p className="text-lg font-semibold">{duration(e.workedUs)} · 修订 {e.revision}</p><p className="break-all text-xs">核定上班（UTC）：{e.proposal.startAt}<br/>核定下班（UTC）：{e.proposal.endAt}<br/>生效操作：{e.operationId}</p></section>;}
function Proposal({title,basis,proposal:p}:{title:string;basis:AttendanceSessionResult;proposal:CorrectionProposal}){const total=previewCorrection(basis,p).proposed.totals!;return <section aria-label={title} className="min-w-0 space-y-2 rounded-xl bg-slate-50 p-4 text-sm"><h3 className="font-bold">{title}</h3><p>{duration(total.workedUs)} · 声明试算，是否生效以审批结果为准</p><p className="break-all text-xs">声明上班（UTC）：{p.startAt}<br/>声明下班（UTC）：{p.endAt}</p><details><summary>休息明细（{p.breaks.length} 段）</summary>{p.breaks.map((b,n)=><p key={n} className="break-all text-xs">{b.startAt} → {b.endAt} · {b.paid?"带薪声明":"非带薪声明"}</p>)}</details></section>;}
function Time({label,value,zone,change}:{label:string;value:CorrectionTimeInput;zone:string;change:(v:CorrectionTimeInput)=>void}){
  const offsets=useMemo(()=>correctionTimeOffsets(value.local,zone),[value.local,zone]);
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_7rem] gap-2"><label className="min-w-0 text-sm">{label}<input type="datetime-local" step="0.001" required className={input} value={correctionTimeControlValue(value.local)} onChange={e=>{const local=e.target.value,choices=correctionTimeOffsets(local,zone);change({local,offset:choices.length===1?choices[0]:""});}}/></label>
    <label className="text-sm">UTC 时差<select aria-label={`${label} UTC 时差`} className={input} value={offsets.includes(value.offset)?value.offset:""} required onChange={e=>change({...value,offset:e.target.value})}><option value="">{offsets.length>1?"重复时刻，请选":"先核对时间"}</option>{offsets.map(o=><option key={o}>{o}</option>)}</select></label></div>;
}
function RevisionEditor({basis,current,disabled,submit}:{basis:AttendanceSessionResult;current:RevisionCycleEffect;disabled:boolean;submit:(p:CorrectionProposal,n:string)=>void}){
  const zone=current.timeZone,convert=(s:string)=>correctionTimeInput(s,zone);
  const [draft,setDraft]=useState<CorrectionDraft>(()=>({start:convert(current.proposal.startAt),end:convert(current.proposal.endAt),breaks:current.proposal.breaks.map(b=>({start:convert(b.startAt),end:convert(b.endAt),paid:b.paid}))}));
  const [reason,setReason]=useState(""),[ack,setAck]=useState(false),[dirty,setDirty]=useState(false);let proposal:CorrectionProposal|null=null;
  try{proposal=correctionDraftProposal(draft,zone);}catch{/* Invalid/ambiguous local times never become a valid proposal. */}
  const changed=proposal&&JSON.stringify(proposal)!==JSON.stringify(current.proposal),valid=!!reason.trim()&&[...reason.trim()].length<=500&&!/[\u0000-\u001f\u007f-\u009f]/.test(reason);
  const change=(next:CorrectionDraft)=>{setDraft(next);setAck(false);setDirty(true);};
  return <form aria-label="提交再次修订" data-revision-dirty={dirty} className="space-y-3 rounded-2xl border border-slate-200 p-4" onSubmit={e=>{e.preventDefault();if(!disabled&&proposal&&changed&&valid&&ack)submit(proposal,reason);}}><fieldset disabled={disabled} className="min-w-0 space-y-3"><legend className="font-bold">基于当前修订 {current.revision} 填写完整声明</legend>
    <p className="text-xs leading-6 text-slate-500">班次时区 {zone}；未修改时间保留微秒，编辑时间按毫秒精度填写。夏令时重复时刻须选择 UTC 时差，不存在的时刻不能提交。当前核定不会因填写或提交而改变。</p>
    <div className="grid min-w-0 gap-3 xl:grid-cols-2"><Time label="修订上班时间" value={draft.start} zone={zone} change={start=>change({...draft,start})}/><Time label="修订下班时间" value={draft.end} zone={zone} change={end=>change({...draft,end})}/></div>
    {draft.breaks.map((b,n)=><div key={n} className="min-w-0 space-y-2 rounded-xl bg-slate-50 p-3"><Time label={`休息 ${n+1} 开始`} value={b.start} zone={zone} change={start=>change({...draft,breaks:draft.breaks.map((x,i)=>i===n?{...x,start}:x)})}/><Time label={`休息 ${n+1} 结束`} value={b.end} zone={zone} change={end=>change({...draft,breaks:draft.breaks.map((x,i)=>i===n?{...x,end}:x)})}/>
      <div className="flex flex-wrap items-center gap-3"><label className="text-sm"><input type="checkbox" checked={b.paid} onChange={e=>change({...draft,breaks:draft.breaks.map((x,i)=>i===n?{...x,paid:e.target.checked}:x)})}/> 带薪休息声明</label><button type="button" className={button} onClick={()=>change({...draft,breaks:draft.breaks.filter((_,i)=>i!==n)})}>移除此段休息</button></div></div>)}
    <button type="button" className={button} disabled={draft.breaks.length>=32} onClick={()=>change({...draft,breaks:[...draft.breaks,{start:{local:"",offset:""},end:{local:"",offset:""},paid:false}]})}>增加休息（{draft.breaks.length}/32）</button>
    <label className="block text-sm">修订理由（单行 1—500 字）<input className={input} value={reason} required maxLength={1000} onChange={e=>{setReason(e.target.value);setAck(false);setDirty(true);}}/></label>
    {proposal?<><Proposal title="新声明试算 · 未批准" basis={basis} proposal={proposal}/>{!changed&&<p className="text-sm text-amber-900">尚未更改时间；相同声明不能重复提交。</p>}</>:<p role="status" className="text-sm text-amber-900">请补全实际存在的时间、时差和休息段；结束须晚于开始，休息不能重叠或超出班次。</p>}
    <label className="block text-sm"><input type="checkbox" checked={ack} onChange={e=>{setAck(e.target.checked);setDirty(true);}}/> 我已核对全部时间与休息；提交只形成申请，仍需负责人审批。</label>
    <button type="submit" className={button} disabled={!proposal||!changed||!valid||!ack}>明确提交修订申请</button>
  </fieldset></form>;
}
function Withdrawal({disabled,submit}:{disabled:boolean;submit:(n:string)=>void}){
  const [reason,setReason]=useState(""),[ack,setAck]=useState(false),valid=!!reason.trim()&&[...reason.trim()].length<=500&&!/[\u0000-\u001f\u007f-\u009f]/.test(reason);
  return <form aria-label="撤回待审修订" data-revision-dirty={!!reason||ack} className="space-y-3 rounded-xl bg-amber-50 p-3" onSubmit={e=>{e.preventDefault();if(!disabled&&valid&&ack)submit(reason);}}><fieldset disabled={disabled} className="space-y-3"><legend className="font-semibold">撤回待审修订</legend><label className="block text-sm">撤回理由<input className={input} required value={reason} onChange={e=>{setReason(e.target.value);setAck(false);}}/></label><label className="block text-sm"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> 确认撤回；原始打卡、现有核定和申请历史保留。</label><button className={button} disabled={!valid||!ack}>明确撤回修订</button></fieldset></form>;
}
