"use client";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceCorrectionClient } from "@/lib/merchantAttendanceCorrectionClient";
import { previewCorrection, correctionStatusLabel,type CorrectionProposal, type CorrectionResult } from "@/lib/merchantAttendanceCorrection";
import { correctionDraftFromBasis, correctionDraftProposal, correctionTimeOffsets, correctionTimeControlValue, type CorrectionDraft, type CorrectionTimeInput } from "@/lib/merchantAttendanceCorrectionForm";
import { formatAttendanceDurationUs, summarizeAttendanceSessionRecords, type AttendanceSessionResult } from "@/lib/merchantAttendanceSession";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import RulesNotice from "./MerchantAttendanceCorrectionRulesNotice";
import DecisionNotice from "./MerchantAttendanceCorrectionDecisionNotice";
import EventChannels from "./MerchantAttendanceEventChannels";
import ApplicationWindowPanel from "./MerchantAttendanceApplicationWindowPanel";
import WindowRecoveryLauncher from "./MerchantAttendanceApplicationWindowRecoveryLauncher";
import ReviewRoutingSelf from "./MerchantAttendanceReviewRoutingSelf";
import { applicationWindowLegacyPorts, type ApplicationWindowPrepareQuery } from "@/lib/merchantAttendanceApplicationWindowClient";

const History = lazy(() => import("./MerchantAttendanceHistoryPanel"));
const RevisionWorkspace = lazy(() => import("./MerchantAttendanceRevisionWorkspace"));
const button = "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm";
type Props = { siteId: string; employeeId: string; authUserId?: string | null; apiFetch: AttendanceApiFetch; onClose: () => void;
  applicationWindowEnabled?: boolean; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
export default function MerchantAttendanceCorrectionWorkspace(props: Props) {
  const enabled = props.applicationWindowEnabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED === "1";
  const key = `${props.siteId}:${props.employeeId}:${props.authUserId ?? ""}:${enabled}`;
  /* eslint-disable react-hooks/refs -- Monotonic authority revocation before effect cleanup; never rendered data. */
  const scope = useRef({ key, apiFetch: props.apiFetch, token: 0 });
  if(scope.current.key!==key||scope.current.apiFetch!==props.apiFetch)scope.current={key,apiFetch:props.apiFetch,token:scope.current.token+1};
  const token=scope.current.token,isCurrentAuth=useCallback(()=>scope.current.token===token,[token]);
  return <Screen key={token} {...props} applicationWindowEnabled={enabled} isCurrentAuth={isCurrentAuth}/>;
  /* eslint-enable react-hooks/refs */
}
function Screen({ siteId, employeeId, authUserId, apiFetch, onClose, applicationWindowEnabled, registerLeaveGuard, isCurrentAuth }: Props & { isCurrentAuth: () => boolean }) {
  const client = useMemo(() => new AttendanceCorrectionClient({ siteId, employeeId, ...applicationWindowLegacyPorts(apiFetch, () => window.sessionStorage, isCurrentAuth) }), [siteId, employeeId, apiFetch, isCurrentAuth]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [browse, setBrowse] = useState(false), root = useRef<HTMLElement>(null);
  const [revisionTarget,setRevisionTarget]=useState<{workerId:string;baseRequestId:string}|null|undefined>(undefined);
  const [windowTarget, setWindowTarget] = useState<ApplicationWindowPrepareQuery | null>(null);
  const hasWindowAuth = typeof authUserId === "string" && authUserId.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(authUserId), windowAvailable = !!applicationWindowEnabled && hasWindowAuth;
  const revisionsEnabled=process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_REVISION_CYCLES_ENABLED==="1";
  const dirty = () => !!root.current?.querySelector('[data-correction-dirty="true"]');
  useEffect(() => {
    if(revisionTarget!==undefined || windowTarget)return;
    void client.initialize();
    const visible = () => { setBrowse(false); if (document.visibilityState === "hidden") client.pause(); else void client.initialize(); };
    const unload = (e: BeforeUnloadEvent) => { if (dirty() || client.hasLeaveRisk()) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", visible); window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("beforeunload", unload); client.pause(); };
  }, [client,revisionTarget,windowTarget]);
  const leave = useCallback(() => {
    if ((root.current?.querySelector('[data-correction-dirty="true"]') || client.hasLeaveRisk()) && !window.confirm("离开会清除未提交草稿；完整待确认原编号保留，不代表撤回已发送申请。确定离开？")) return false;
    client.pause(); return true;
  }, [client]);
  useLayoutEffect(() => { if (windowTarget || revisionTarget !== undefined) return; registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [windowTarget, revisionTarget, registerLeaveGuard, leave]);
  const navigate = (action: () => void) => {
    if (dirty() && !window.confirm("尚未提交的文字和时间不会保存。确定离开当前编辑？")) return;
    action();
  };
  const busy = state.phase === "loading" || state.phase === "saving", r = state.result;
  const locked = busy || !!state.pending || !state.workerId;
  const openWindow = (target: ApplicationWindowPrepareQuery) => { if (!windowAvailable || !isCurrentAuth() || document.hidden || busy || state.pending) return; navigate(() => { client.pause(); setBrowse(false); setWindowTarget(target); }); };
  const recoverWindow = (target: ApplicationWindowPrepareQuery) => { if (!hasWindowAuth || !isCurrentAuth() || document.hidden || busy || state.pending) return; client.pause(); setBrowse(false); setWindowTarget(target); };
  if(windowTarget && authUserId)return <ApplicationWindowPanel query={windowTarget} employeeId={employeeId} authUserId={authUserId} apiFetch={apiFetch} enabled={!!applicationWindowEnabled} isCurrentAuth={isCurrentAuth} registerLeaveGuard={registerLeaveGuard} onClose={()=>setWindowTarget(null)}/>;
  if(revisionTarget!==undefined)return <Suspense fallback={<p role="status">正在加载连续修订…</p>}><RevisionWorkspace siteId={siteId} employeeId={employeeId} authUserId={authUserId} applicationWindowEnabled={applicationWindowEnabled} registerLeaveGuard={registerLeaveGuard} apiFetch={apiFetch} initialTarget={revisionTarget} onClose={()=>setRevisionTarget(undefined)}/></Suspense>;
  return <section ref={root} aria-label="本人考勤补正申请" className="mt-5 min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">我的补正申请</h2><p className="mt-1 text-sm text-slate-600">核对原始班次 → 填写声明 → 确认申请。这里不代为审批，不改原始记录。</p></div>
      <button type="button" className={button} onClick={() => {
        if (leave()) onClose();
      }}>返回我的考勤</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">支持已绑定本人身份的网页、终端上班记录，同一班次可包含两种来源；未绑定本人身份的终端记录不能在此申请。最多 202 条原始记录、32 段声明休息。补正需审批，不改写原始打卡、不替代正常下班打卡，也不等于工资结算；整段漏打请使用单独的申报入口。</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={locked} onClick={() => navigate(() => { setBrowse(false); void client.list(); })}>我的申请</button>
      <button type="button" className={button} disabled={locked} onClick={() => navigate(() => { setBrowse(true); })}>选择原始班次</button>
      <button type="button" className={button} disabled={busy} onClick={() => navigate(() => { setBrowse(false); void client.initialize(); })}>{state.pending ? "按原编号核对结果" : "重新读取"}</button></div>
    {revisionsEnabled&&<button type="button" className={button} disabled={locked} onClick={()=>navigate(()=>{client.pause();setRevisionTarget(null);})}>恢复待确认修订</button>}
    {hasWindowAuth && authUserId && <WindowRecoveryLauncher siteId={siteId} employeeId={employeeId} authUserId={authUserId} family="correction" isCurrentAuth={isCurrentAuth} disabled={busy || !!state.pending}
      beforeDiscover={() => { if (dirty() && !window.confirm("核验原编号会清除未提交草稿，继续吗？")) return false; client.pause(); setBrowse(false); return true; }} onSelect={recoverWindow}/>}
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm ${state.phase === "blocked" || state.pending ? "bg-amber-50 text-amber-950" : "bg-blue-50 text-blue-950"}`}>{state.message}</p>
    {state.pending && <div className="space-y-2 rounded-xl border border-amber-300 p-3 text-sm"><p>待确认：{state.pending.command.action === "submit" ? "提交补正" : "撤回申请"}。未查到申请也不代表提交失败。</p>
      <p className="break-all text-xs">操作编号：{state.pending.command.operationId}</p>
      <button type="button" className={button} disabled={state.phase !== "unconfirmed" || !state.workerId} onClick={() => {
        if (window.confirm("先核对原编号；如仍未找到结果，只重试原内容，不创建新申请编号。继续？")) void client.retry();
      }}>明确用原编号重试</button></div>}
    {browse && !locked ? <Suspense fallback={<p role="status">正在加载本人历史…</p>}><History siteId={siteId} employeeId={employeeId} apiFetch={apiFetch}
      onRequestCorrection={startEventId => { if (windowAvailable && state.workerId) openWindow({ siteId, family: "correction", mode: "prepare", workerId: state.workerId, startEventId }); else { setBrowse(false); void client.prepare(startEventId); } }}/></Suspense> : r && <>
      {r.mode !== "list" && <EventChannels siteId={siteId} actorId={employeeId} employeeId={employeeId} access="self" workerId={r.workerId} eventIds={r.basis.events.map(item=>item.id)} readKey={r.asOf} apiFetch={apiFetch}/>}
      {r.mode === "list" && <div className="space-y-3"><h3 className="font-bold">本人申请记录</h3>
        {!r.items.length && <p className="text-sm text-slate-600">本页没有申请记录。可选择原始班次开始申请。</p>}
        {r.items.map(item => <article key={item.requestId} className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
          <p className="font-semibold">{correctionStatusLabel(item)} · 版本 {item.revision}</p>
          <p className="break-all">声明 UTC：{item.startAt} → {item.endAt}</p><p className="break-all text-xs text-slate-500">申请编号：{item.requestId}<br/>提交 UTC：{item.submittedAt}</p>
          <button type="button" className={button} disabled={locked} onClick={() => void client.detail(item.requestId)}>查看差异／撤回</button></article>)}
        <button type="button" className={button} disabled={locked || !r.nextCursor} onClick={() => void client.next()}>下一页</button>
        <p className="text-xs text-slate-500">每页最多 25 条，仅保留当前页。新申请请重新读取首页；列表不是锁定报表。</p></div>}
      {r.mode === "prepare" && <>
        <Original basis={r.basis}/><RulesNotice rules={r.rules}/>
        {r.pendingRequestId ? <div className="rounded-xl bg-amber-50 p-3 text-sm"><p>本班次已有申请，不能重复提交。</p><button type="button" className={`${button} mt-2`} disabled={locked} onClick={() => void client.detail(r.pendingRequestId!)}>查看已有申请</button></div>
          : r.canRequest && r.moduleEnabled && r.rules?.policy && !r.rules.issues.length ? windowAvailable ? <button type="button" className={button} disabled={locked} onClick={() => openWindow({ siteId, family: "correction", mode: "prepare", workerId: r.workerId, startEventId: r.basis.events[0].id })}>通过规则窗口准备补正</button> : <Editor key={`${r.basis.events[0].id}:${r.revision}:${r.asOf}`} basis={r.basis} disabled={locked} submit={(p, reason) => void client.submit(p, reason)}/>
            : <p className="text-sm text-amber-900">当前权限、平台状态或申请规则不允许新提交；未创建补正。</p>}
      </>}
      {r.mode === "detail" && <><Detail key={`${r.item.requestId}:${r.item.revision}`} result={r} disabled={locked} withdraw={reason => void client.withdraw(reason)}/>
        {hasWindowAuth && authUserId && !state.pending && <ReviewRoutingSelf siteId={siteId} authUserId={authUserId} family="correction" requestId={r.item.requestId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth}/>}
        {revisionsEnabled&&r.item.decision?.action==="approve"&&<button type="button" className={button} disabled={locked} onClick={()=>navigate(()=>{client.pause();setRevisionTarget({workerId:r.workerId,baseRequestId:r.item.requestId});})}>查看当前核定／申请再次修订</button>}
        {r.item.decision?.action==="reject"&&<button type="button" className={button} disabled={locked} onClick={()=>void client.prepare(r.item.startEventId)}>按当前规则重新准备申请</button>}</>}
    </>}
    <p className="text-xs leading-6 text-slate-500">未提交草稿仅保留在当前页面，切到其他标签页或应用会隐藏并清空草稿，返回时重新核验权限。已发送待确认操作包含申请时间和理由，仅暂存当前浏览器标签页，确认后删除；关闭标签页、清理站点数据或换设备不能保证恢复。无定位采集，无自动提交或后台重试。</p>
  </section>;
}
const at = (value: string | null, zone: string) => value ? new Intl.DateTimeFormat("zh-CN", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "shortOffset", hourCycle: "h23" }).format(new Date(value)) : "未记录";
function Original({ basis }: { basis: AttendanceSessionResult }) {
  const r = summarizeAttendanceSessionRecords(basis);
  return <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm"><h3 className="font-bold">原始班次 · 只读</h3><p>上班：{at(r.startAt, r.timeZone)}<br/>下班：{at(r.endAt, r.timeZone)}</p>
    <p>时区：{r.timeZone} · 工作段：{r.totals ? formatAttendanceDurationUs(r.totals.workedUs) : "班次未结束，不推算总工时"}</p>
    {r.openBreak && <p className="text-amber-900">原始休息尚未结束。申请需明确填写该段结束时间或明确移除；不会自动填入当前时间。</p>}
    <details><summary className="cursor-pointer">查看完整原始动作（{basis.events.length} 条）</summary><ol className="mt-2 max-h-64 space-y-2 overflow-auto">{basis.events.map(e => <li key={e.id} className="break-all text-xs">{e.sequence}. {({ clock_in: "上班", clock_out: "下班", break_start: "开始休息", break_end: "结束休息" })[e.action]} · {e.source === "web" ? "网页打卡" : "终端打卡"} · UTC {e.occurredAt}{e.breakPaid === null ? "" : e.breakPaid ? " · 带薪标记" : " · 非带薪标记"}</li>)}</ol></details></div>;
}
function TimeInput({ label, value, zone, change }: { label: string; value: CorrectionTimeInput; zone: string; change: (value: CorrectionTimeInput) => void }) {
  const offsets = useMemo(() => correctionTimeOffsets(value.local, zone), [value.local, zone]);
  return <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_7rem] gap-2"><label className="min-w-0 text-sm">{label}<input type="datetime-local" step="0.001" className={input} value={correctionTimeControlValue(value.local)} onChange={e => {
    const local = e.target.value, choices = correctionTimeOffsets(local, zone);
    change({ local, offset: choices.length === 1 ? choices[0] : "" });
  }} required/></label>
    <label className="text-sm">UTC 时差<select aria-label={`${label} UTC 时差`} className={input} value={offsets.includes(value.offset) ? value.offset : ""} onChange={e => change({ ...value, offset: e.target.value })} required>
      <option value="">{offsets.length > 1 ? "重复时刻，请选择" : "先核对时间"}</option>{offsets.map(offset => <option key={offset} value={offset}>{offset}</option>)}
    </select></label></div>;
}
function Difference({ basis, proposal, approved=false }: { basis: AttendanceSessionResult; proposal: CorrectionProposal;approved?:boolean }) {
  const p = previewCorrection(basis, proposal), before = p.original.totals, after = p.proposed.totals!;
  const rows = [["工作段", before?.workedUs, after.workedUs], ["全部休息", before?.breakUs, after.breakUs], ["有带薪标记的休息", before?.paidBreakUs, after.paidBreakUs]] as const;
  return <section className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm" aria-label="声明差异试算"><h4 className="font-bold">申请前后核对 · {approved?"已批准的声明（非工资结算）":"未经审批的声明"}</h4>
    <p>上班：{at(p.original.startAt, p.original.timeZone)} → {at(p.proposed.startAt, p.proposed.timeZone)}<br/>下班：{at(p.original.endAt, p.original.timeZone)} → {at(p.proposed.endAt, p.proposed.timeZone)}</p>
    {rows.map(([label, a, b]) => <p key={label}>{label}：{a === undefined ? "原班次未结束" : formatAttendanceDurationUs(a)} → {formatAttendanceDurationUs(b)}{a === undefined ? "" : `（${b >= a ? "+" : "−"}${formatAttendanceDurationUs(Math.abs(b - a))}）`}</p>)}
    <details><summary className="cursor-pointer">声明 UTC 与按自然日拆分</summary><p className="mt-2 break-all text-xs">{proposal.startAt} → {proposal.endAt}</p>{p.proposed.days.map(d => <p className="mt-1" key={d.date}>{d.date} · 工作段 {formatAttendanceDurationUs(d.workedUs)} · 休息 {formatAttendanceDurationUs(d.breakUs)}</p>)}</details>
    <p className="text-xs">工作段扣除全部休息；带薪标记不代表工资规则。{approved?"这里按已批准声明复算，仍不等于周期报表或工资已结算。":"这里仅试算，提交时会校验期限与锁定；仍不代表跨班次及在职区间审批已通过。"}</p></section>;
}
function Editor({ basis, disabled, submit }: { basis: AttendanceSessionResult; disabled: boolean; submit: (p: CorrectionProposal, reason: string) => void }) {
  const [draft, setDraft] = useState(() => correctionDraftFromBasis(basis)), [reason, setReason] = useState(""), [ack, setAck] = useState(false), [dirty, setDirty] = useState(false);
  const zone = basis.events[0].timeZone;
  let proposal: CorrectionProposal | null = null;
  try { proposal = correctionDraftProposal(draft, zone); } catch { /* Invalid or ambiguous drafts are never previewed as valid. */ }
  const change = (next: CorrectionDraft) => { setDraft(next); setAck(false); setDirty(true); };
  const reasonValid = !!reason.trim() && [...reason.trim()].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(reason.trim());
  return <form className="space-y-4" data-correction-dirty={dirty} onSubmit={e => { e.preventDefault(); if (proposal && ack && reasonValid && !disabled) submit(proposal, reason); }}>
    <fieldset disabled={disabled} className="min-w-0 space-y-3"><legend className="font-bold">填写完整申请时间</legend><p className="text-xs leading-6 text-slate-500">按原班次时区 {zone} 输入，普通时刻自动匹配 UTC 时差；夏令时重复时刻需明确选择时差，不存在的时刻无法提交。未修改时间保留微秒，编辑时间按毫秒精度填写；不自动补下班或休息结束。</p>
      <div className="grid gap-3 xl:grid-cols-2"><TimeInput label="申请上班时间" zone={zone} value={draft.start} change={start => change({ ...draft, start })}/><TimeInput label="申请下班时间" zone={zone} value={draft.end} change={end => change({ ...draft, end })}/></div>
      <h4 className="text-sm font-bold">声明休息 · {draft.breaks.length} / 32</h4>
      {draft.breaks.map((b, n) => <div key={n} className="space-y-2 rounded-xl border border-slate-200 p-3"><div className="grid gap-3 xl:grid-cols-2">
        <TimeInput label={`休息 ${n + 1} 开始`} zone={zone} value={b.start} change={start => change({ ...draft, breaks: draft.breaks.map((x, i) => i === n ? { ...x, start } : x) })}/>
        <TimeInput label={`休息 ${n + 1} 结束`} zone={zone} value={b.end} change={end => change({ ...draft, breaks: draft.breaks.map((x, i) => i === n ? { ...x, end } : x) })}/></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><label className="text-sm"><input type="checkbox" checked={b.paid} onChange={e => change({ ...draft, breaks: draft.breaks.map((x, i) => i === n ? { ...x, paid: e.target.checked } : x) })}/> 声明为带薪休息（需核定）</label>
          <button type="button" className={button} onClick={() => change({ ...draft, breaks: draft.breaks.filter((_, i) => i !== n) })}>移除这段声明休息</button></div></div>)}
      <button type="button" className={button} disabled={draft.breaks.length >= 32} onClick={() => change({ ...draft, breaks: [...draft.breaks, { start: { local: "", offset: draft.start.offset }, end: { local: "", offset: draft.start.offset }, paid: false }] })}>增加休息段</button>
      <p className="text-xs text-slate-500">按开始时间顺序填写，休息不得重叠或超出上下班范围；移除只改本次声明，不会删除原始记录。</p>
      <label className="block text-sm">申请理由（1～500 字，不含换行）<input className={input} value={reason} maxLength={1000} onChange={e => { setReason(e.target.value); setAck(false); setDirty(true); }} required/></label>
      {proposal ? <Difference basis={basis} proposal={proposal}/> : <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">请补全并核对时间、UTC 时差及休息段：时间须实际存在、结束晚于开始，跨度不超过 31 天。未生成有效试算。</p>}
      <label className="block text-sm leading-6"><input type="checkbox" checked={ack} onChange={e => { setAck(e.target.checked); setDirty(true); }}/> 我已核对全部时间与休息；这只是补正申请，尚未批准，不改变原始记录、当前打卡状态或工资。</label>
      <button type="submit" className={`${button} font-semibold`} disabled={!proposal || !ack || !reasonValid}>明确提交补正申请</button>
    </fieldset></form>;
}
function Detail({ result: r, disabled, withdraw }: { result: Extract<CorrectionResult, { mode: "detail" }>; disabled: boolean; withdraw: (reason: string) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false);
  const valid = !!reason.trim() && [...reason.trim()].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(reason.trim());
  return <div className="space-y-3"><h3 className="font-bold">{correctionStatusLabel(r.item)}</h3><p className="break-all text-xs">申请编号：{r.item.requestId} · 版本 {r.item.revision}</p>
    <DecisionNotice decision={r.item.decision}/><RulesNotice rules={r.rules}/><Original basis={r.basis}/><Difference basis={r.basis} proposal={r.proposal} approved={r.item.decision?.action==="approve"}/><p className="break-words text-sm">申请理由：{r.reason}</p>
    <details className="text-sm"><summary className="cursor-pointer">声明休息明细（{r.proposal.breaks.length} 段）</summary>{r.proposal.breaks.map((b, n) => <p key={n} className="mt-2 break-all text-xs">UTC：{b.startAt} → {b.endAt} · {b.paid ? "带薪声明" : "非带薪声明"}</p>)}</details>
    {r.withdrawal && <p className="break-words text-sm">撤回理由：{r.withdrawal.reason}<br/>撤回 UTC：{r.withdrawal.recordedAt}</p>}
    {r.item.status === "submitted" && r.canRequest && <form data-correction-dirty={!!reason || ack} className="space-y-3 rounded-xl border border-amber-200 p-3" onSubmit={e => { e.preventDefault(); if (!disabled && ack && valid) withdraw(reason); }}>
      <fieldset disabled={disabled} className="space-y-3"><legend className="font-semibold">撤回这份申请</legend><label className="block text-sm">撤回理由（1～500 字，不含换行）<input className={input} value={reason} maxLength={1000} required onChange={e => { setReason(e.target.value); setAck(false); }}/></label>
        <label className="block text-sm"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/> 确认撤回；申请与撤回历史仍会保留，原始打卡不变。</label><button type="submit" className={button} disabled={!valid || !ack}>明确撤回申请</button></fieldset></form>}
  </div>;
}
