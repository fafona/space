"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AttendancePeriodDelegatedClosureClient, type PeriodDelegatedClosureScope, type PeriodDelegatedClosureStorage,
  type PeriodDelegatedClosureClientState, type PeriodDelegatedClosureView } from "@/lib/merchantAttendancePeriodDelegatedClosureClient";
import type { PeriodDelegatedClosureCommand, PeriodDelegatedClosureListItem } from "@/lib/merchantAttendancePeriodDelegatedClosure";
import type { PeriodDelegatedArtifactDraft, PeriodClosureSummary, PeriodClosureEntry } from "@/lib/merchantAttendancePeriodClosure";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { PeriodClosureSavedReport } from "./MerchantAttendancePeriodClosureWorkspace";
import CycleIntentLauncher from "./MerchantAttendanceCycleIntentLauncher";
import { cycleIntentAuthCurrent } from "@/lib/merchantAttendanceCycleIntentClient";

export type PeriodDelegatedClosureWorkspaceProps = PeriodDelegatedClosureScope & {
  fromDate:string; throughDate:string; enabled:boolean; apiFetch:AttendanceApiFetch; onClose:()=>void;
  isCurrentAuth?:()=>boolean; registerLeaveGuard?:(guard:(()=>boolean)|null)=>void;
  cycleIsCurrentAuth?:()=>boolean; cycleEnabled?:boolean;
};
type Action=PeriodDelegatedClosureCommand["action"];
const actions:Record<Action,string>={send:"保存版本并送本人核对",respond:"回复周期事项",seal:"封存本人已确认版本",reopen:"说明理由并重开"};
const historyActions:Record<PeriodClosureEntry["action"],string>={...actions,confirm:"本人确认",dispute:"本人提出争议"};
const states:Record<PeriodClosureSummary["state"],string>={open:"已重开，准备中",review:"待本人核对",confirmed:"本人已明确确认",disputed:"有争议待处理",sealed:"已封存"};
const button="max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const scopeKeys=["siteId","actorEmployeeId","expectedAuthUserId","grantId","workerId","targetEmployeeId","targetAuthUserId","authorizedFromDate","authorizedThroughDate","fromDate","throughDate"] as const;

/** Protect captured storage handles and late bodies during render-time scope
 * changes, before React has run the previous workspace's layout cleanup. */
export function periodDelegatedClosurePorts(apiFetch:AttendanceApiFetch,storage:()=>PeriodDelegatedClosureStorage,isCurrent:()=>boolean){
  const check=()=>{if(!isCurrent())throw Error("identity_changed");};
  const target=()=>{check();const value=storage();check();return value;};
  return {isCurrentAuth:isCurrent,storage:():PeriodDelegatedClosureStorage=>{check();return{
    getItem:key=>{const value=target().getItem(key);check();return value;},
    setItem:(key,value)=>{target().setItem(key,value);check();},removeItem:key=>{target().removeItem(key);check();}};},
    apiFetch:(async(path,init)=>{check();const response=await apiFetch(path,init);if(!isCurrent()){void response.body?.cancel().catch(()=>{});throw Error("identity_changed");}return response;}) satisfies AttendanceApiFetch};
}
export function confirmPeriodDelegatedClosureAction(confirm:()=>boolean,current:()=>boolean,act:()=>void){
  if(!current()||!confirm()||!current())return false;act();return true;
}

/** Pages, fixed-version reads and minimal receipts never grant fresh CAS. */
export function periodDelegatedClosureControls(state:PeriodDelegatedClosureClientState,scope:PeriodDelegatedClosureScope,shown:boolean,enabled:boolean,reason:string){
  const {query:q,result:r,pending,phase}=state;
  const period=r?.kind==="detail"?r.period:r?.kind==="preview"?r.preview.period:null;
  const artifact=r?.kind==="preview"?r.preview.artifact:r?.kind==="detail"?r.artifact:null;
  const matchesScope=!!q&&q.siteId===scope.siteId&&q.access==="delegate"&&q.grantId===scope.grantId&&q.workerId===scope.workerId
    &&q.fromDate>=scope.authorizedFromDate&&q.throughDate<=scope.authorizedThroughDate
    &&!!r&&r.siteId===scope.siteId&&r.grantId===scope.grantId&&r.workerId===scope.workerId&&r.access==="delegate"
    &&r.actorId===scope.expectedAuthUserId&&r.employeeId===scope.actorEmployeeId
    &&(!period||period.periodId===q.periodId&&period.workerId===scope.workerId&&period.employeeId===scope.targetEmployeeId&&period.employeeAuthUserId===scope.targetAuthUserId
      &&period.fromDate===q.fromDate&&period.throughDate===q.throughDate)
    &&(!artifact||artifact.worker.workerId===scope.workerId&&artifact.worker.employeeId===scope.targetEmployeeId&&artifact.worker.employeeAuthUserId===scope.targetAuthUserId
      &&artifact.period.fromDate===q.fromDate&&artifact.period.throughDate===q.throughDate);
  const ready=shown&&phase==="ready"&&!pending&&matchesScope;
  const freshDetail=ready&&q?.mode==="detail"&&q.version===null&&r?.kind==="detail"&&r.operation===null&&!r.replayed&&r.artifactVersion===r.period.currentVersion;
  const preview=ready&&q?.mode==="preview"&&r?.kind==="preview"&&q.periodId===(r.preview.period?.periodId??null)?r.preview:null;
  const writable=enabled&&!!r?.moduleEnabled;
  const validReason=reason.length>=1&&reason.length<=500&&reason===reason.trim()&&!/[\u0000-\u001f\u007f-\u009f]/.test(reason);
  const permitted=(action:Action)=>writable&&validReason&&r?.usableActions.includes(action)===true;
  const allowed:Record<Action,boolean>={
    send:!!(preview&&permitted("send")&&!preview.period?.sealed&&!preview.blockers.some(b=>b==="period_in_progress"||b==="unresolved_outage")),
    respond:!!(freshDetail&&permitted("respond")&&!period?.sealed),
    seal:!!(freshDetail&&permitted("seal")&&artifact&&period?.state==="confirmed"&&!period.sealed&&!period.unresolvedDispute
      &&period.confirmedVersion===period.currentVersion&&r?.kind==="detail"&&r.sourceChanged===false),
    reopen:!!(freshDetail&&permitted("reopen")&&period?.sealed),
  };
  const busy=phase==="loading"||phase==="saving";
  return{allowed,matchesScope,busy,canRead:shown&&enabled&&!busy&&!pending,canRecover:shown&&!busy&&!!pending,
    canEditReason:!!(writable&&(preview||freshDetail)&&r?.usableActions.some(a=>["send","respond","seal","reopen"].includes(a)))};
}

/* eslint-disable react-hooks/refs -- This exact monotonic scope fence revokes old async/storage authority before effects. An abandoned render can only invalidate a lease; it cannot reauthorize an old A-B-A token. */
export default function MerchantAttendancePeriodDelegatedClosureWorkspace(props:PeriodDelegatedClosureWorkspaceProps){
  const key=JSON.stringify(scopeKeys.map(k=>props[k]));
  // Synchronously revoke the old lease during a scope render, not only cleanup.
  const live=useRef({key,apiFetch:props.apiFetch,authCheck:props.isCurrentAuth,enabled:props.enabled,token:0});
  if(live.current.key!==key||live.current.apiFetch!==props.apiFetch||live.current.authCheck!==props.isCurrentAuth||live.current.enabled!==props.enabled){
    live.current={key,apiFetch:props.apiFetch,authCheck:props.isCurrentAuth,enabled:props.enabled,token:live.current.token+1};
  }
  const token=live.current.token;
  const isCurrent=useCallback(()=>live.current.token===token&&props.isCurrentAuth?.()!==false,[token,props.isCurrentAuth]);
  return <Prepared key={token} {...props} scopeKey={key} isCurrent={isCurrent}/>;
}
/* eslint-enable react-hooks/refs */
function Prepared(props:PeriodDelegatedClosureWorkspaceProps&{scopeKey:string;isCurrent:()=>boolean}){
  const client=useMemo(()=>{try{return new AttendancePeriodDelegatedClosureClient({siteId:props.siteId,actorEmployeeId:props.actorEmployeeId,
    expectedAuthUserId:props.expectedAuthUserId,grantId:props.grantId,workerId:props.workerId,targetEmployeeId:props.targetEmployeeId,
    targetAuthUserId:props.targetAuthUserId,authorizedFromDate:props.authorizedFromDate,authorizedThroughDate:props.authorizedThroughDate,
    fromDate:props.fromDate,throughDate:props.throughDate,enabled:props.enabled,
    ...periodDelegatedClosurePorts(props.apiFetch,()=>sessionStorage,props.isCurrent)});}catch{return null;}},
    [props.siteId,props.actorEmployeeId,props.expectedAuthUserId,props.grantId,props.workerId,props.targetEmployeeId,props.targetAuthUserId,
      props.authorizedFromDate,props.authorizedThroughDate,props.fromDate,props.throughDate,props.enabled,props.apiFetch,props.isCurrent]);
  return client?<Screen {...props} client={client}/>:<section aria-label="受托周期核对" className="min-w-0 space-y-3 p-4"><p role="alert">当前授权、身份或日期范围无法核验；未读取或提交。</p><button type="button" className={button} onClick={props.onClose}>返回授权列表</button></section>;
}
function Screen(props:PeriodDelegatedClosureWorkspaceProps&{client:AttendancePeriodDelegatedClosureClient;isCurrent:()=>boolean}){
  const {client,isCurrent,enabled,onClose,registerLeaveGuard}=props;
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
  const [reason,setReason]=useState(""),[shown,setShown]=useState(()=>typeof document==="undefined"||!document.hidden);
  const epoch=useRef(0),dirty=useRef(false),draft=useRef("");
  const cycleChildGuard=useRef<(()=>boolean)|null>(null);
  const registerCycleChild=useCallback((guard:(()=>boolean)|null)=>{cycleChildGuard.current=guard;},[]);
  const clear=useCallback(()=>{dirty.current=false;draft.current="";setReason("");},[]);
  const invalidate=useCallback(()=>{epoch.current++;client.pause();},[client]);
  const leave=useCallback(()=>{const generation=epoch.current,snapshot=client.getSnapshot();
    return confirmPeriodDelegatedClosureAction(()=>!(dirty.current||client.hasLeaveRisk())||window.confirm("离开会清除未提交理由；已保存操作不会撤销，原编号保留待核对。继续？"),
      ()=>isCurrent()&&generation===epoch.current&&snapshot===client.getSnapshot(),()=>{invalidate();clear();});
  },[client,clear,invalidate,isCurrent]);
  const leaveAll=useCallback(()=>!cycleChildGuard.current?leave():cycleChildGuard.current()&&leave(),[leave]);
  useLayoutEffect(()=>{registerLeaveGuard?.(leaveAll);return()=>registerLeaveGuard?.(null);},[registerLeaveGuard,leaveAll]);
  useLayoutEffect(()=>{
    const conceal=()=>{invalidate();clear();setShown(false);};
    const hide=()=>flushSync(()=>{invalidate();clear();setShown(false);});
    const show=()=>{if(!isCurrent()||document.hidden)return;epoch.current++;clear();setShown(true);void client.initialize();};
    const visibility=()=>document.hidden?hide():show();
    const unload=(event:BeforeUnloadEvent)=>{if(dirty.current||client.hasLeaveRisk()){event.preventDefault();event.returnValue="";}};
    if(document.hidden)conceal();else if(isCurrent())void client.initialize();
    document.addEventListener("visibilitychange",visibility);window.addEventListener("pagehide",hide);window.addEventListener("pageshow",show);window.addEventListener("beforeunload",unload);
    return()=>{invalidate();document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",hide);window.removeEventListener("pageshow",show);window.removeEventListener("beforeunload",unload);};
  },[client,clear,invalidate,isCurrent]);
  const result=shown?state.result:null,pending=shown?state.pending:null,controls=periodDelegatedClosureControls(state,props,shown,enabled,reason);
  const current=(generation:number,snapshot=state)=>isCurrent()&&shown&&!document.hidden&&generation===epoch.current&&snapshot===client.getSnapshot();
  const read=(run:()=>Promise<void>,recover=false)=>{const generation=epoch.current,snapshot=client.getSnapshot(),value=draft.current;
    if(!current(generation,snapshot)||snapshot!==state||!(recover?controls.canRecover:controls.canRead))return;
    confirmPeriodDelegatedClosureAction(()=>!dirty.current||window.confirm("读取或翻页会清除未提交理由，继续？"),
      ()=>current(generation,snapshot)&&draft.current===value,()=>{epoch.current++;clear();void run();});};
  const edit=(value:string)=>{if(!current(epoch.current)||!controls.canEditReason)return;epoch.current++;dirty.current=true;draft.current=value;setReason(value);};
  const submit=(action:Action)=>{const generation=epoch.current,snapshot=client.getSnapshot(),value=draft.current;
    const message=action==="seal"?"以本人的明确确认为前提封存这个保存版本？不能代本人确认，也不修改工时。"
      :action==="reopen"?"按此理由重开？旧档与旧确认保留，新版本仍须本人重新核对。":`确认“${actions[action]}”？只保存这一次明确操作，不代表本人已经确认。`;
    confirmPeriodDelegatedClosureAction(()=>window.confirm(message),()=>current(generation,snapshot)&&snapshot===state&&draft.current===value&&reason===value
      &&periodDelegatedClosureControls(snapshot,props,shown,enabled,value).allowed[action],()=>{epoch.current++;clear();void client[action](value);});};
  const selected=result&&"period" in result?result.period:result?.kind==="preview"?result.preview.period:null;
  const receipt=result?.kind==="receipt"?result.receipt:null;
  const cycleCurrent=useCallback(()=>isCurrent()&&shown&&cycleIntentAuthCurrent(props.cycleIsCurrentAuth),[isCurrent,shown,props.cycleIsCurrentAuth]);
  // These nine values originate in the actual 185 grant selection, not in a
  // saved intent. Navigation dates are not substituted for authorized dates.
  const cycleScope:PeriodDelegatedClosureScope={siteId:props.siteId,actorEmployeeId:props.actorEmployeeId,expectedAuthUserId:props.expectedAuthUserId,
    grantId:props.grantId,workerId:props.workerId,targetEmployeeId:props.targetEmployeeId,targetAuthUserId:props.targetAuthUserId,
    authorizedFromDate:props.authorizedFromDate,authorizedThroughDate:props.authorizedThroughDate};
  return <section aria-label="受托周期核对" data-period-delegated-closure className="min-w-0 space-y-4 rounded-2xl border border-indigo-300 bg-white p-3 text-slate-900 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">受托周期核对</h2><button type="button" className={button} onClick={()=>{if(leaveAll())onClose();}}>返回授权列表</button></header>
    <CycleIntentLauncher scope={{siteId:props.siteId,access:"delegate",workerId:props.workerId,grantId:props.grantId}} actorId={props.expectedAuthUserId}
      delegateScope={cycleScope} apiFetch={props.apiFetch} isCurrentAuth={cycleCurrent} active={shown}
      enabled={enabled&&(props.cycleEnabled??process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OPERATIONAL_CYCLE_ENABLED==="1")}
      disabled={controls.busy} beforeOpen={()=>cycleCurrent()&&leave()} registerLeaveGuard={registerCycleChild}/>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">仅处理负责人明确授予的指定员工完整周期。每次读取和操作均重新核权；本人确认与本人争议仍由本人操作，回复、沉默或已读不能替代本人确认。不修改打卡与工时，不计算工资，不提供资料输出。</p>
    <p className="break-words text-sm">授权日期 {props.authorizedFromDate} → {props.authorizedThroughDate}；本次导航 {props.fromDate} → {props.throughDate}，单次最多31日。已有周期沿保存的完整日期、时区和UTC日界核对。</p>
    <p className="text-sm">旧归档不改写、不删除；正文继续共用商户现有64 MiB额度，本入口不提额。</p>
    {!enabled&&<p className="text-sm text-amber-900">受托新操作及普通读取关闭；已保存原编号只能明确GET核对，不保证当前服务器一定可恢复。</p>}
    <p role="status" className="break-words text-sm">{shown?state.message:"资料已隐藏，返回后请明确重新读取。"}</p>
    {shown&&(state.phase==="blocked"||state.phase==="unconfirmed")&&<p role="alert" className="text-sm text-amber-900">{state.message}</p>}
    {pending&&<div className="min-w-0 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p className="break-all">待确认操作 {pending.command.operationId} · 周期 {pending.command.periodId}</p>
      <p>原意图保留；不自动重新提交，也不把查无回执当作失败。</p><button type="button" className={button} disabled={!controls.canRecover} onClick={()=>read(client.recover,true)}>只读核对原周期编号</button></div>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!controls.canRead} onClick={()=>read(client.load)}>读取受托周期列表</button>
      <button type="button" className={button} disabled={!controls.canRead} onClick={()=>read(()=>client.preview(null))}>预览导航日期完整周期</button></div>
    {result&&(result.kind==="list"||result.kind==="history"||result.kind==="versions")&&<PeriodDelegatedClosurePages result={result} canRead={controls.canRead&&controls.matchesScope}
      select={item=>read(()=>client.selectPeriod(item))} next={()=>read(client.next)} detail={(id,version)=>read(()=>client.detail(id,version))}/>}
    {receipt&&<div className="min-w-0 space-y-2 rounded-xl border border-emerald-300 p-3 text-sm"><p className="break-all">已核实原操作 {receipt.operationId} · 修订 {receipt.periodRevision} · {actions[receipt.action as Action]}</p>
      <p>这只是已保存操作的最小回执，不表示当前仍有授权，不是新的审批依据。</p><button type="button" className={button} disabled={!controls.canRead} onClick={()=>read(()=>client.detail(receipt.periodId!))}>重新读取当前周期</button></div>}
    {selected&&<div className="min-w-0 space-y-2 rounded-xl bg-slate-50 p-3 text-sm"><p className="break-words">{selected.workerName} · {selected.fromDate} → {selected.throughDate} · {states[selected.state]}</p>
      <p className="break-all">周期 {selected.periodId} · 修订 {selected.revision} · 当前保存版本 {selected.currentVersion}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!controls.canRead} onClick={()=>read(()=>client.detail(selected.periodId))}>读取当前保存版本</button>
        <button type="button" className={button} disabled={!controls.canRead} onClick={()=>read(()=>client.preview(selected.periodId))}>重采此周期当前资料</button>
        <button type="button" className={button} disabled={!controls.canRead} onClick={()=>read(()=>client.history(selected.periodId))}>读取操作历史</button>
        <button type="button" className={button} disabled={!controls.canRead} onClick={()=>read(()=>client.versions(selected.periodId))}>读取保存版本列表</button></div></div>}
    {result?.kind==="preview"&&<PeriodDelegatedClosureCandidate artifact={result.preview.artifact} blockers={result.preview.blockers}/>}
    {result?.kind==="detail"&&<><p className="text-sm">正在查看保存版本 {result.artifactVersion??"无"}。{state.query?.version!==null?"这是固定历史读取，不能作为当前写入依据。":result.sourceChanged===false?"本次读取的来源未变化，提交时仍会再次核验。":result.sourceChanged===true?"当前来源已变化，旧正文保持不变。":"当前来源状态未知，不能据此封存。"}</p>
      {result.artifact&&<><PeriodClosureSavedReport key={`${result.period.periodId}:${result.artifactVersion}:${result.artifact.sourceFingerprint}`} artifact={result.artifact}/>
        {result.artifact.protocol==="attendance-period-artifact-v2"&&<p className="break-all rounded-xl bg-indigo-50 p-3 text-xs">保存时受托授权 {result.artifact.authority.grantId} · 操作者员工 {result.artifact.authority.actorEmployeeId} · 授权核验UTC {result.artifact.authority.authorizedAt}。历史旁证不代表当前授权有效。</p>}</>}</>}
    {controls.canEditReason&&<fieldset className="min-w-0 space-y-3 rounded-xl border border-slate-300 p-3"><legend className="font-semibold">明确受托操作</legend>
      <label className="block text-sm">本次操作理由（1–500字符）<textarea className="mt-1 min-h-24 w-full min-w-0 max-w-full rounded-xl border border-slate-300 p-2" maxLength={500} value={reason} onChange={event=>edit(event.target.value)}/></label>
      <div className="flex flex-wrap gap-2">{(Object.keys(actions) as Action[]).filter(action=>result?.usableActions.includes(action)).map(action=><button key={action} type="button" className={button} disabled={!controls.allowed[action]} onClick={()=>submit(action)}>{actions[action]}</button>)}</div>
    </fieldset>}
  </section>;
}

export function PeriodDelegatedClosurePages({result,canRead,select,next,detail}:{result:Extract<PeriodDelegatedClosureView,{kind:"list"|"history"|"versions"}>;canRead:boolean;
  select:(item:PeriodDelegatedClosureListItem)=>void;next:()=>void;detail:(id:string,version:number)=>void}){
  return <section aria-label="受托周期服务器分页" className="min-w-0 space-y-3">
    <p className="text-sm">{result.kind==="list"?"与导航日期相交的周期，每页最多25条；选择后读取原完整周期。":result.kind==="history"?"操作历史每页最多50条；本页不是完整历史。":"每页最多20个保存版本；选择后才读取该版正文。"}</p>
    <ol className="space-y-2">{result.kind==="list"?result.items.map(item=><li key={item.periodId} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><p className="break-words">{item.workerName} · {item.workerNo} · {item.fromDate} → {item.throughDate}</p>
      <p className="break-all">{states[item.state]} · 当前版本 {item.currentVersion} · 修订 {item.revision} · {item.periodId}</p><button type="button" className={button} disabled={!canRead} onClick={()=>select(item)}>读取受托保存版本</button></li>)
      :result.kind==="history"?result.items.map(item=><li key={item.operationId} className="min-w-0 rounded-xl border p-3 text-sm"><p>{historyActions[item.action]} · 修订 {item.revision} · 版本 {item.version}</p><p className="break-words">{item.reason}</p><p className="break-all text-xs">{item.operationId} · 操作者 {item.actorId} · UTC {item.recordedAt}</p></li>)
      :result.items.map(item=><li key={item.version} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><p>保存版本 {item.version} · 正文 {item.artifactBytes} 字节</p><p className="break-all text-xs">{item.sourceFingerprint} · UTC {item.recordedAt}</p><button type="button" className={button} disabled={!canRead} onClick={()=>detail(result.period.periodId,item.version)}>查看保存版本 {item.version}</button></li>)}</ol>
    {!result.items.length&&<p className="text-sm">本页没有记录；这不证明不存在待核对事实。</p>}
    {result.nextCursor?<button type="button" className={button} disabled={!canRead} onClick={next}>读取下一页</button>:<p className="text-sm">本次读取已到末页。</p>}
  </section>;
}
function CandidateJson({value}:{value:unknown}){const [open,setOpen]=useState(false);return <details className="min-w-0 text-xs" onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open);}}><summary>展开本次候选完整结构化依据（只读）</summary>
  {open&&<pre className="max-h-96 max-w-full overflow-auto whitespace-pre-wrap break-all p-2" tabIndex={0}>{JSON.stringify(value,null,2)}</pre>}</details>;}
export function PeriodDelegatedClosureCandidate({artifact:a,blockers}:{artifact:PeriodDelegatedArtifactDraft;blockers:string[]}){
  const [page,setPage]=useState(0),items=[...a.report.base.rows.map(row=>({key:row.startEventId,row,missing:null})),...a.report.missing.map(missing=>({key:missing.requestId,row:null,missing}))],pages=Math.max(1,Math.ceil(items.length/10));
  return <article aria-label="受托周期当前候选" className="min-w-0 space-y-3 rounded-xl border border-indigo-200 p-3"><h3 className="font-semibold">当前候选，尚未保存</h3>
    <p className="break-words text-sm">{a.worker.workerName} · {a.worker.workerNo} · {a.period.fromDate} → {a.period.throughDate} · {a.period.timeZone}</p><p className="break-all text-xs">UTC [{a.period.startAt}, {a.period.endAt}) · 当前指纹 {a.sourceFingerprint}</p>
    <p className="text-sm">送审会保存本次资料，不代表本人已确认；历史归档不会因此改写。原始记录、批准补正、独立漏卡及上下文均保持各自来源。</p>
    <dl className="grid gap-2 text-sm sm:grid-cols-2">{([["original","原始打卡"],["recordedSelected","原记录／批准补正"],["missingSelected","独立批准漏卡"],["selected","合并核定"]] as const).map(([key,label])=><div key={key} className="min-w-0 rounded-lg bg-slate-50 p-2"><dt>{label}</dt><dd className="break-all">工作 {a.report.totals[key].workedUs} 微秒 · 起止 {a.report.totals[key].elapsedUs} · 休息 {a.report.totals[key].breakUs} · 带薪休息 {a.report.totals[key].paidBreakUs}</dd></div>)}</dl>
    {blockers.length>0&&<div className="rounded-xl bg-amber-50 p-3 text-sm"><p>待核验事项；未结束周期或未解决故障不允许送审，其余问题仍阻止封存。</p><ul>{blockers.map(x=><li className="break-all" key={x}>{x}</li>)}</ul></div>}
    <p className="text-xs">来源本地分页，每页最多10条；分页不删减候选依据。</p><ol className="space-y-2">{items.slice(page*10,page*10+10).map(({key,row,missing})=><li key={key} className="min-w-0 rounded-lg border p-2 text-xs"><p className="break-all">{row?"原记录／补正":"独立漏卡"} · {key}</p>
      {row?<><p className="break-all">原始UTC {row.original.startAt} → {row.original.endAt??"未结束"}</p><p className="break-all">核定UTC {row.selected.startAt} → {row.selected.endAt??"未结束"}</p></>:missing&&<p className="break-all">申报UTC {missing.proposal.startAt} → {missing.proposal.endAt} · 批准 {missing.operationId}</p>}</li>)}</ol>
    {pages>1&&<nav aria-label="候选来源本地分页" className="flex flex-wrap gap-2"><button type="button" className={button} disabled={page===0} onClick={()=>setPage(page-1)}>上一页来源</button><span>{page+1}/{pages}</span><button type="button" className={button} disabled={page+1===pages} onClick={()=>setPage(page+1)}>下一页来源</button></nav>}
    <CandidateJson value={{source:a.source,dayBoundaries:a.dayBoundaries,report:a.report}}/>
  </article>;
}
