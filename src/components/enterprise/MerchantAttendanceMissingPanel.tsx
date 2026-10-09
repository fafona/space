"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceMissingClient, type MissingIntent } from "@/lib/merchantAttendanceMissingClient";
import { MISSING_ISSUE_LABELS, missingProposal, type MissingDetail, type MissingQuery, type MissingResult } from "@/lib/merchantAttendanceMissing";
import { correctionDraftProposal, correctionTimeOffsets, correctionTimeInput, correctionTimeControlValue, type CorrectionDraft, type CorrectionTimeInput } from "@/lib/merchantAttendanceCorrectionForm";
import { confirmMissingPanelLeave, missingInitialQuery } from "@/lib/merchantAttendanceMissingSelection";
import type { MissingPanelProps } from "./MerchantAttendanceMissingLauncher";
import ApplicationWindowPanel from "./MerchantAttendanceApplicationWindowPanel";
import WindowRecoveryLauncher from "./MerchantAttendanceApplicationWindowRecoveryLauncher";
import ReviewRoutingSelf from "./MerchantAttendanceReviewRoutingSelf";
import { parseApplicationWindowQuery } from "@/lib/merchantAttendanceApplicationWindow";
import { applicationWindowLegacyPorts, type ApplicationWindowPrepareQuery } from "@/lib/merchantAttendanceApplicationWindowClient";
import type { CorrectionProposal } from "@/lib/merchantAttendanceCorrection";
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:opacity-50";
const statuses = { submitted: "待审核", approved: "已批准", withdrawn: "已撤回", rejected: "已驳回" };
const stamp = (s: string, zone: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s));
const emptyTime = (): CorrectionTimeInput => ({ local: "", offset: "" });
export default function MerchantAttendanceMissingPanel(props: MissingPanelProps & { onClose: () => void }) {
  const query = useMemo(() => { try { return missingInitialQuery(props.siteId, props.access, props.initialSelection ?? null); } catch { return null; } }, [props.siteId, props.access, props.initialSelection]);
  const enabled=props.applicationWindowEnabled??process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED==="1",scopeKey=`${props.siteId}:${props.actorId}:${props.access}:${props.authUserId??""}:${enabled}:${query?.requestId??"list"}:${query?.fromDate}:${query?.throughDate}`;
  /* eslint-disable react-hooks/refs -- Monotonic authority revocation before effect cleanup; never rendered data. */
  const scope=useRef({scopeKey,apiFetch:props.apiFetch,token:0});if(scope.current.scopeKey!==scopeKey||scope.current.apiFetch!==props.apiFetch)scope.current={scopeKey,apiFetch:props.apiFetch,token:scope.current.token+1};
  const token=scope.current.token,isCurrentAuth=useCallback(()=>scope.current.token===token,[token]);
  if (!query) return <section role="alert" className="my-4 space-y-3 rounded-xl border border-amber-200 p-4"><p>漏卡目标无效，未读取或提交申请。请返回待审列表重新选择。</p><button type="button" className={button} onClick={props.onClose}>关闭整段漏卡</button></section>;
  return <Screen key={token} {...props} applicationWindowEnabled={enabled} isCurrentAuth={isCurrentAuth} initialQuery={query}/>;
  /* eslint-enable react-hooks/refs */
}
function Screen({ actorId, access, authUserId, applicationWindowEnabled, apiFetch, onClose, initialQuery, registerLeaveGuard, isCurrentAuth }: MissingPanelProps & { onClose: () => void; initialQuery: MissingQuery; isCurrentAuth: () => boolean }) {
  const [query] = useState(initialQuery);
  const client = useMemo(() => new AttendanceMissingClient({
    // initialize restores a pending query before this hint and only issues GET.
    // Never follow recovery with an automatic load of a different request.
    query, actorId, ...applicationWindowLegacyPorts(apiFetch, () => window.sessionStorage,isCurrentAuth) }), [actorId, apiFetch, query,isCurrentAuth]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [dirty, setDirty] = useState(false);
  const [windowTarget,setWindowTarget]=useState<{query:ApplicationWindowPrepareQuery;proposal?:CorrectionProposal;reason?:string}|null>(null),[windowMessage,setWindowMessage]=useState("");
  const hasWindowAuth=access==="self"&&typeof authUserId==="string"&&authUserId.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(authUserId),windowAvailable=!!applicationWindowEnabled&&hasWindowAuth;
  const leave = useCallback(() => {
    const snapshot = client.getSnapshot();
    return confirmMissingPanelLeave({ dirty, pending: !!snapshot.pending, confirm: message => window.confirm(message), current: () => client.getSnapshot() === snapshot,
      pause: () => { setDirty(false); client.pause(); } });
  }, [client, dirty]);
  useLayoutEffect(() => { if(windowTarget)return;registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave,windowTarget]);
  useEffect(() => { if(windowTarget)return;if (document.visibilityState !== "hidden") void client.initialize(); const visibility = () => { setDirty(false);setWindowMessage(""); if (document.visibilityState === "hidden") client.pause(); else void client.initialize(); };
    document.addEventListener("visibilitychange", visibility); return () => { document.removeEventListener("visibilitychange", visibility); client.pause(); }; }, [client,windowTarget]);
  useEffect(() => { const unload = (e: BeforeUnloadEvent) => { if (dirty || state.pending) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload); }, [dirty, state.pending]);
  const discard = () => !dirty || window.confirm("尚未提交的漏卡草稿会丢失，继续吗？");
  const load = (query: MissingQuery) => { if (discard()) { setDirty(false); void client.load(query); } };
  const submit = (intent: MissingIntent) => {
    if(windowAvailable&&(intent.action==="submit"||intent.action==="revise")){
      const snapshot=client.getSnapshot();if(!isCurrentAuth()||document.hidden||snapshot.pending||snapshot.phase!=="ready"||!snapshot.result)return;
      try{const q=parseApplicationWindowQuery({siteId:snapshot.query.siteId,family:intent.action==="submit"?"missing":"missing_revision",mode:"prepare",workerId:snapshot.result.workerId,
        fromDate:snapshot.query.fromDate,throughDate:snapshot.query.throughDate,proposedStartAt:intent.proposal.startAt,supersedesRequestId:intent.action==="revise"?snapshot.result.detail?.requestId:null});
        if(q.mode!=="prepare")return;client.pause();setDirty(false);setWindowMessage("");setWindowTarget({query:q,proposal:intent.proposal,reason:intent.reason});
      }catch{setWindowMessage("无法完整核实申请起点及身份，未提交任何申请；请重新读取。 ");}return;
    }
    setDirty(false); void client.submit(intent);
  };
  const r = state.result, busy = state.phase === "loading" || state.phase === "saving", disabled = busy || !!state.pending;
  const firstQuery = { ...state.query, requestId: null, operationId: null, beforeAt: null, beforeId: null };
  if(windowTarget&&authUserId)return <ApplicationWindowPanel query={windowTarget.query} employeeId={actorId} authUserId={authUserId} apiFetch={apiFetch} enabled={!!applicationWindowEnabled} isCurrentAuth={isCurrentAuth}
    initialProposal={windowTarget.proposal} initialReason={windowTarget.reason} registerLeaveGuard={registerLeaveGuard} onClose={()=>setWindowTarget(null)}/>;
  return <section aria-label={access === "owner" ? "整段漏卡审核工作区" : "整段漏卡申请工作区"} className="my-4 min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">{access === "owner" ? "整段漏卡审核" : "整段漏卡申请"}</h2>
      <button type="button" className={button} onClick={() => { if (leave()) onClose(); }}>关闭整段漏卡</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">适用于整段工作均没有打卡的情况。独立保存申请与审核，不生成原始打卡；{process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_UNIFIED_REPORT_ENABLED === "1"
      ? "已批准申报须在“含整段漏卡的工时核对”入口查看合计，原报表及其导出不含整段申报；不自动计算工资。"
      : "已批准申报尚未纳入统一工时报表，也不自动计算工资。"}</p>
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    {windowMessage&&<p role="alert">{windowMessage}</p>}
    {hasWindowAuth&&authUserId&&<WindowRecoveryLauncher siteId={query.siteId} employeeId={actorId} authUserId={authUserId} family="missing" isCurrentAuth={isCurrentAuth} disabled={busy||!!state.pending}
      beforeDiscover={()=>{if(!discard())return false;client.pause();setDirty(false);return true;}}
      onSelect={target=>{if(!isCurrentAuth()||document.hidden||busy||state.pending)return;client.pause();setDirty(false);setWindowTarget({query:target});}}/>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => { if (discard()) { setDirty(false); void client.initialize(); } }}>重新读取／查原收据</button>
      {state.pending && <button type="button" className={button} disabled={state.phase !== "unconfirmed"} onClick={() => void client.retry()}>用原编号明确重试</button>}
      {!state.pending && <button type="button" className={button} disabled={busy} onClick={() => load(firstQuery)}>返回申请列表</button>}</div>
    {state.pending && <p className="break-all text-sm text-amber-900">待确认编号：{state.pending.command.operationId}。核对前不发起新操作。</p>}
    <RangeForm key={`${state.query.fromDate}:${state.query.throughDate}`} query={firstQuery} disabled={disabled} onLoad={load}/>
    {r && <>
      {!r.moduleEnabled && <p className="text-sm text-amber-900">平台暂未开放新申请和审批；可以查询及撤回本人待审申请。</p>}
      {access === "self" && !r.detail && <SubmissionForm key={`${r.workerId}:${r.locationId}:${r.settingsVersion}:${r.policyRevision}`} result={r} windowEnabled={windowAvailable} disabled={disabled || !r.moduleEnabled || !r.canRequest || !r.policyRevision} onDirty={() => setDirty(true)} onSubmit={submit}/>}
      {r.detail && <Detail key={`${r.detail.requestId}:${r.detail.revision}:${r.detail.evidenceToken}`} result={r} detail={r.detail} access={access} windowEnabled={windowAvailable} disabled={disabled} enabled={r.moduleEnabled} onDirty={() => setDirty(true)} onSubmit={submit} onView={requestId => load({ ...firstQuery, requestId })}/>}
      {access === "self" && hasWindowAuth && authUserId && r.detail && !state.pending && <ReviewRoutingSelf siteId={query.siteId} authUserId={authUserId} family={r.detail.lineage?.supersedesRequestId ? "missing_revision" : "missing"} requestId={r.detail.requestId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth}/>}
      <h3 className="font-bold">申请记录 · 按提交时间倒序</h3>
      {!r.items.length && <p className="rounded-xl border border-slate-200 p-4 text-sm">当前提交日期范围内没有申请，不代表没有出勤。</p>}
      <div className="space-y-2">{r.items.map(i => <article className="rounded-xl border border-slate-200 p-3" key={i.requestId}>
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{i.workerName} · {statuses[i.status]}</strong><button type="button" className={button} disabled={disabled} onClick={() => load({ ...firstQuery, requestId: i.requestId })}>查看申请 {i.requestId.slice(-4)}</button></div>
        <p className="mt-1 text-sm">申报 {stamp(i.startAt, r.timeZone)} — {stamp(i.endAt, r.timeZone)}（{r.timeZone}）</p>
        <p className="text-xs text-slate-500">提交于 {stamp(i.submittedAt, "UTC")} UTC · 版本 {i.revision}</p>
      </article>)}</div>
      {r.nextCursor && <button type="button" className={button} disabled={disabled} onClick={() => load({ ...firstQuery, beforeAt: r.nextCursor!.at, beforeId: r.nextCursor!.id })}>下一页申请</button>}
    </>}
    <p className="text-xs leading-5 text-slate-500">员工只能处理本人申请，负责人或获授权审批人不能审核自己的申请。待确认编号限当前账号、企业及标签页保存；隐藏页面会清除未提交草稿并重新核验身份。</p>
  </section>;
}
function RangeForm({ query, disabled, onLoad }: { query: MissingQuery; disabled: boolean; onLoad: (q: MissingQuery) => void }) {
  const [from, setFrom] = useState(query.fromDate), [through, setThrough] = useState(query.throughDate);
  return <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); onLoad({ ...query, fromDate: from, throughDate: through }); }}>
    <label className="text-sm">提交开始日期（UTC）<input className={input} type="date" required value={from} disabled={disabled} onChange={e => setFrom(e.target.value)}/></label>
    <label className="text-sm">提交结束日期（含，最多 31 天）<input className={input} type="date" required value={through} disabled={disabled} onChange={e => setThrough(e.target.value)}/></label>
    <button className={button} disabled={disabled}>查询申请</button></form>;
}
function TimeInput({ label, value, zone, onChange }: { label: string; value: CorrectionTimeInput; zone: string; onChange: (v: CorrectionTimeInput) => void }) {
  const offsets = correctionTimeOffsets(value.local, zone);
  return <div className="min-w-0"><label className="text-sm">{label}<input className={input} type="datetime-local" required step="0.001" value={correctionTimeControlValue(value.local)} onChange={e => { const choices = correctionTimeOffsets(e.target.value, zone); onChange({ local: e.target.value, offset: choices.length === 1 ? choices[0] : "" }); }}/></label>
    {offsets.length > 1 ? <label className="text-xs">{label}重复时间偏移<select className={input} required value={value.offset} onChange={e => onChange({ ...value, offset: e.target.value })}><option value="">请选择偏移</option>{offsets.map(o => <option key={o} value={o}>UTC{o}</option>)}</select></label>
      : <p className="mt-1 text-xs text-slate-500">{offsets.length ? `UTC${offsets[0]}` : value.local ? "此地点时区不存在这个时间，请修改。" : `地点时区：${zone}`}</p>}</div>;
}
function SubmissionForm({ result: r, disabled, onDirty, onSubmit, revision = false, windowEnabled=false }: { result: MissingResult; disabled: boolean; onDirty: () => void; onSubmit: (intent: MissingIntent) => void; revision?: boolean;windowEnabled?:boolean }) {
  const [draft, setDraft] = useState<CorrectionDraft>(() => {
    const p = revision ? r.detail?.proposal : null, convert = (s: string) => correctionTimeInput(s, r.timeZone);
    return p ? { start: convert(p.startAt), end: convert(p.endAt), breaks: p.breaks.map(b => ({ start: convert(b.startAt), end: convert(b.endAt), paid: b.paid })) } : { start: emptyTime(), end: emptyTime(), breaks: [] };
  }), [reason, setReason] = useState(""), [ack, setAck] = useState(false), [message, setMessage] = useState("");
  const change = () => { setAck(false); setMessage(""); onDirty(); };
  return <form className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={e => { e.preventDefault(); if (disabled || !ack) return;
    try { const proposal = missingProposal(correctionDraftProposal(draft, r.timeZone)); if (proposal.endAt > r.asOf) throw Error("future"); onSubmit({ action: revision ? "revise" : "submit", proposal, reason: reason.trim() }); }
    catch { setMessage("请核对起止、休息和夏令时偏移：每段最长 24 小时，必须已经结束，休息不得交叉或越界。"); }
  }}><h3 className="font-bold">{revision ? "修订已批准整段申报" : "新增整段申请"}</h3>
    {revision && <p className="rounded-xl bg-blue-50 p-3 text-sm">新版本批准前，原批准版本继续计时。驳回或撤回不改变原版本；重新批准后统一核对与导出只计最新版本。必须先解锁原时段及新时段；移动日期不能延长原申报的申请窗口。</p>}
    <p className="text-xs leading-5 text-slate-500">使用本人当前默认地点时区 {r.timeZone}；申报开始日决定申请期限。起止最长 24 小时，可跨夜；最多 8 段休息，不自动扣除。</p>
    {!r.canRequest && <p role="alert" className="text-sm text-amber-900">尚无申请权限，或考勤档案／默认地点未启用，请联系负责人。</p>}
    {!r.policyRevision && <p role="alert" className="text-sm text-amber-900">负责人需先配置补正申请期限。</p>}
    <fieldset disabled={disabled} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2">
      <TimeInput label="申报开始时间" zone={r.timeZone} value={draft.start} onChange={start => { setDraft({ ...draft, start }); change(); }}/>
      <TimeInput label="申报结束时间" zone={r.timeZone} value={draft.end} onChange={end => { setDraft({ ...draft, end }); change(); }}/></div>
      {draft.breaks.map((b, index) => <div className="space-y-2 rounded-xl bg-slate-50 p-3" key={index}><div className="grid gap-3 sm:grid-cols-2">
        {(["start", "end"] as const).map(key => <TimeInput key={key} label={`休息 ${index + 1} ${key === "start" ? "开始" : "结束"}`} zone={r.timeZone} value={b[key]} onChange={value => { setDraft({ ...draft, breaks: draft.breaks.map((item, i) => i === index ? { ...item, [key]: value } : item) }); change(); }}/>)}</div>
        <div className="flex flex-wrap items-center gap-3"><label className="flex gap-2 text-sm"><input type="checkbox" checked={b.paid} onChange={e => { setDraft({ ...draft, breaks: draft.breaks.map((item, i) => i === index ? { ...item, paid: e.target.checked } : item) }); change(); }}/>休息 {index + 1} 计入申报工时（带薪）</label>
          <button type="button" className={button} onClick={() => { setDraft({ ...draft, breaks: draft.breaks.filter((_, i) => i !== index) }); change(); }}>删除休息 {index + 1}</button></div></div>)}
      <button type="button" className={button} disabled={draft.breaks.length >= 8} onClick={() => { setDraft({ ...draft, breaks: [...draft.breaks, { start: emptyTime(), end: emptyTime(), paid: false }] }); change(); }}>增加休息时段</button>
      <label className="block text-sm">{revision ? "修订原因" : "漏卡原因"}<input className={input} required maxLength={200} value={reason} onChange={e => { setReason(e.target.value); change(); }}/></label>
      {message && <p role="alert" className="text-sm text-red-800">{message}</p>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e => { setAck(e.target.checked); onDirty(); }}/>确认整段无打卡，起止、休息及理由真实，提交负责人或获授权审批人审核</label>
      {windowEnabled&&<p className="text-sm">此步只带入已确认的声明和理由；接着显式读取规则窗口，核对固定截止后才提交。</p>}
      <button className={button} disabled={!ack || !reason.trim()}>{windowEnabled?"继续核验规则窗口":revision ? "提交整段修订" : "提交整段申请"}</button>
    </fieldset></form>;
}
function Detail({ result, detail: d, access, disabled, enabled, windowEnabled=false, onDirty, onSubmit, onView }: { result: MissingResult; detail: MissingDetail; access: "owner" | "self"; disabled: boolean; enabled: boolean; windowEnabled?:boolean;onDirty: () => void; onSubmit: (i: MissingIntent) => void; onView: (requestId: string) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false), [revising, setRevising] = useState(false);
  return <article aria-label="整段申请详情" className="space-y-3 rounded-xl border border-blue-200 p-4">
    <h3 className="font-bold">{d.workerName} · {statuses[d.status]}</h3>
    {d.lineage && <div className="space-y-2 rounded-xl bg-blue-50 p-3 text-sm">
      <p>{d.status === "approved" ? d.lineage.currentRequestId === d.requestId ? "这是当前计时使用的批准版本。" : "这是历史批准版本，不再重复计入工时。" : d.lineage.supersedesRequestId ? "这是修订申请；批准前仍使用原批准版本。" : "此申请尚未形成批准版本。"}</p>
      <div className="flex flex-wrap gap-2">
        {d.lineage.supersedesRequestId && <button type="button" className={button} disabled={disabled} onClick={() => onView(d.lineage!.supersedesRequestId!)}>查看上一批准版本</button>}
        {d.lineage.currentRequestId && d.lineage.currentRequestId !== d.requestId && <button type="button" className={button} disabled={disabled} onClick={() => onView(d.lineage!.currentRequestId!)}>查看当前批准版本</button>}
        {d.lineage.canRevise && !revising && <button type="button" className={button} disabled={disabled || !enabled} onClick={() => setRevising(true)}>申请修订整段申报</button>}
      </div>
      {access === "self" && d.status === "approved" && d.lineage.currentRequestId === d.requestId && !d.lineage.canRevise && <p>若已有待审修订，请先处理或撤回；人员、默认地点及申请权限也须与原申报匹配。</p>}
    </div>}
    <p className="text-sm">{stamp(d.startAt, d.timeZone)} — {stamp(d.endAt, d.timeZone)}<br/>{d.locationName} · {d.timeZone}</p>
    <p className="break-words text-sm">漏卡原因：{d.reason}</p>
    {d.proposal.breaks.map((b, i) => <p className="text-sm" key={i}>休息 {i + 1}：{stamp(b.startAt, d.timeZone)} — {stamp(b.endAt, d.timeZone)} · {b.paid ? "计入申报工时（带薪）" : "不计入申报工时（无薪）"}</p>)}
    {!d.proposal.breaks.length && <p className="text-sm">未申报休息。</p>}
    <p className="text-xs text-slate-500">申请期限：{stamp(d.deadlineAt, d.timeZone)}（{d.timeZone}）之前 · 保存规则版本 {d.policyRevision}</p>
    {d.terminal && <p className="rounded-xl bg-slate-50 p-3 text-sm">处理理由：{d.terminal.reason}<br/>处理时间：{stamp(d.terminal.recordedAt, d.timeZone)}</p>}
    {d.issues.filter(i => i !== "terminal").map(i => <p role="alert" className="text-sm text-amber-900" key={i}>{MISSING_ISSUE_LABELS[i]}</p>)}
    <details className="break-all text-xs text-slate-500"><summary>查看原始 UTC 时间与申请编号</summary>{d.startAt} — {d.endAt}<br/>{d.requestId}</details>
    {d.status === "submitted" && <fieldset disabled={disabled} className="space-y-3">
      <label className="block text-sm">{access === "self" ? "撤回理由" : "审核意见"}<input className={input} maxLength={200} value={reason} onChange={e => { setReason(e.target.value); setAck(false); onDirty(); }}/></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e => { setAck(e.target.checked); onDirty(); }}/>{access === "self" ? "确认撤回此申请，保留历史记录" : "已核对完整申报及当前冲突提示，明确作出审核决定"}</label>
      <div className="flex flex-wrap gap-2">{access === "self" ? <button type="button" className={button} disabled={!ack || !reason.trim()} onClick={() => onSubmit({ action: "withdraw", reason })}>撤回申请</button>
        : <><button type="button" className={button} disabled={!enabled || !d.canApprove || !ack || !reason.trim()} onClick={() => onSubmit({ action: "approve", reason })}>批准整段申请</button>
          <button type="button" className={button} disabled={!enabled || !d.canReject || !ack || !reason.trim()} onClick={() => onSubmit({ action: "reject", reason })}>驳回整段申请</button></>}</div>
    </fieldset>}
    {revising && d.lineage?.canRevise && <SubmissionForm result={result} revision windowEnabled={windowEnabled} disabled={disabled || !enabled} onDirty={onDirty} onSubmit={onSubmit}/>}
  </article>;
}
