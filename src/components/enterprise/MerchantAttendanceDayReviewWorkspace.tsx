"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceDayReviewAttempt } from "@/lib/merchantAttendanceDayReviewClient";
import { AttendanceDayReviewReader, type DayReviewReadResult } from "@/lib/merchantAttendanceDayReviewReader";
import { dayReviewPendingKey, type DayReviewPending } from "@/lib/merchantAttendanceDayReviewRecovery";
import { evaluateDayClassification, type DayClassificationBlocker, type DayClassificationOutcome } from "@/lib/merchantAttendanceDayClassification";
import { parseDayReviewCommand, type DayReviewAccess, type DayReviewCommand, type DayReviewQuery } from "@/lib/merchantAttendanceDayReviewContract";
import type { DayReviewCaseHead, DayReviewEntry } from "@/lib/merchantAttendanceDayReviewResult";
export type DayReviewWorkspaceProps = { siteId: string; actorId: string; access: DayReviewAccess; workerId?: string; apiFetch: AttendanceApiFetch;
  enabled?: boolean; isCurrentAuth?: () => boolean; onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const field = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm";
export const dayReviewOutcomeLabels: Record<DayClassificationOutcome, string> = { follow_up: "继续核查", calendar_exempt: "本计划停业豁免",
  not_worked_reported: "据本人说明，经负责人核对为未工作", recorded_work_reviewed: "已有记录，已核对本范围" };
const observationLabels: Record<string, string> = { evidence_insufficient: "资料不足，待核对", pending_source: "有待审来源或未解决故障", open_record: "记录未闭合",
  source_conflict: "存在来源冲突", unassociated_record: "有未核定计划归属的记录", no_record: "未发现记录，待本人说明（不等于未工作）", recorded_work: "存在工作记录（不等于整体正常）" };
const claimLabels = { worked_missing_records: "我有工作，可能漏记，需原流程核对", not_worked: "本范围内我未工作", uncertain: "情况不确定，需进一步核对" };
const blockerLabels: Record<DayClassificationBlocker, string> = { evidence_incomplete: "资料不完整", identity_unproven: "历史身份未核实",
  source_not_current: "来源已失效", target_not_ended: "本范围尚未结束", self_review: "不能为本人作负责人决定", pending_source: "有待审事项或故障",
  open_record: "有未闭合记录", source_conflict: "有冲突资料", unassociated_record: "有未核定计划归属的记录", administrative_hours_unassessed: "行政闭合班次仍待核定工时",
  plan_required: "须选完整排班", plan_cancelled: "计划已取消", publication_missing: "缺少发布依据", covering_closure_missing: "没有单条适用且完整覆盖的停业事项",
  work_record_present: "存在反向工作记录", latest_not_worked_statement_required: "缺少本案最新的本人未工作说明", recorded_work_required: "没有可核对的工作记录" };
const pendingLabels = { correction: "补正待审", revision: "连续修订待审", missing: "整段漏卡待审", leave: "请假待审", arrangement: "工作安排待审", outage: "故障待核对" };
export function confirmDayReviewAction(confirm: () => boolean, current: () => boolean, submit: () => void): boolean {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export function DayReviewEntryView({ entry }: { entry: DayReviewEntry }) {
  return <article className="min-w-0 space-y-1 rounded-xl border border-slate-200 p-3 text-sm">
    <p>版本 {entry.receipt.revision} · {entry.receipt.recordedAt}</p>
    <p className="font-semibold">{entry.action === "decide" ? dayReviewOutcomeLabels[entry.outcome] : entry.action === "dispute" ? "本人提出异议" : claimLabels[entry.claim]}</p>
    <p className="whitespace-pre-wrap break-words">{entry.reason}</p><p className="break-all text-xs text-slate-500">原编号：{entry.receipt.operationId}</p>
    {entry.action === "decide" && <p>{entry.observations.map(v => observationLabels[v]).join("；")}</p>}
  </article>;
}
function HeadView({ head }: { head: DayReviewCaseHead }) {
  const t = head.target;
  return <div className="min-w-0 space-y-3"><p>{t.workDate} · {t.kind === "plan" ? "完整排班范围" : "完整本地日范围"} · 保存时区 {t.timeZone}</p>
    <p className="break-all text-xs">固定 UTC：{t.fromAt} — {t.toAt}</p><DayReviewEntryView entry={head.latestDecision}/>
    {head.latestSelf && <DayReviewEntryView entry={head.latestSelf}/>}<p>{head.needsResponse ? "本人已有新说明／异议，等待负责人重新核查。" : "此处仅显示保存判断，不声称当前来源仍相同。"}</p>
  </div>;
}
export default function MerchantAttendanceDayReviewWorkspace(props: DayReviewWorkspaceProps) {
  const [scope, setScope] = useState({ siteId: props.siteId, actorId: props.actorId, access: props.access, workerId: props.workerId,
    apiFetch: props.apiFetch, isCurrentAuth: props.isCurrentAuth, enabled: props.enabled, sequence: 0 });
  if (scope.siteId !== props.siteId || scope.actorId !== props.actorId || scope.access !== props.access || scope.workerId !== props.workerId
    || scope.apiFetch !== props.apiFetch || scope.isCurrentAuth !== props.isCurrentAuth || scope.enabled !== props.enabled) {
    setScope({ siteId: props.siteId, actorId: props.actorId, access: props.access, workerId: props.workerId,
      apiFetch: props.apiFetch, isCurrentAuth: props.isCurrentAuth, enabled: props.enabled, sequence: scope.sequence + 1 }); return null;
  }
  // A stable callback can report lost Auth without changing function identity.
  // On the host's Auth render, unmount the private body synchronously.
  if (props.isCurrentAuth?.() === false) return null;
  return <Scope key={scope.sequence} {...props}/>;
}
function Scope({ siteId, actorId, access, workerId, apiFetch, enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_DAY_REVIEWS_ENABLED === "1",
  isCurrentAuth, onClose, registerLeaveGuard }: DayReviewWorkspaceProps) {
  const mounted = useRef(false), visible = useRef(true), epoch = useRef(0), working = useRef(false);
  const current = useCallback(() => mounted.current && visible.current && !document.hidden && isCurrentAuth?.() !== false, [isCurrentAuth]);
  const clients = useMemo(() => {
    const options = { siteId, actorId, access, apiFetch, storage: () => sessionStorage, isCurrent: current };
    return { attempt: new AttendanceDayReviewAttempt(options), reader: new AttendanceDayReviewReader(options) };
  }, [siteId, actorId, access, apiFetch, current]);
  const pauseClients = useCallback(() => { epoch.current++; clients.reader.pause(); clients.attempt.pause(); }, [clients]);
  const [data, setData] = useState<{ query: DayReviewQuery; result: DayReviewReadResult } | null>(null);
  const [pending, setPending] = useState<DayReviewPending | null>(null), [blocked, setBlocked] = useState(true), [busy, setBusy] = useState(false);
  const [date, setDate] = useState(""), [reason, setReason] = useState(""), [outcome, setOutcome] = useState<DayClassificationOutcome>("follow_up");
  const [calendarId, setCalendarId] = useState(""), [selfAction, setSelfAction] = useState<"explain" | "dispute">("explain"), [claim, setClaim] = useState<keyof typeof claimLabels>("uncertain");
  const [ack, setAck] = useState(false), [message, setMessage] = useState("");
  const draft = useRef({ reason, outcome, calendarId, selfAction, claim, ack }); draft.current = { reason, outcome, calendarId, selfAction, claim, ack };
  const selected = useRef(data); selected.current = data;
  const clearDraft = useCallback(() => { setReason(""); setOutcome("follow_up"); setCalendarId(""); setSelfAction("explain"); setClaim("uncertain"); setAck(false); }, []);
  const stored = useCallback(() => { try { return sessionStorage.getItem(dayReviewPendingKey(siteId, access, actorId)) !== null; } catch { return true; } }, [siteId, access, actorId]);
  const dirty = useCallback(() => !!draft.current.reason || draft.current.ack || draft.current.outcome !== "follow_up" || !!draft.current.calendarId
    || draft.current.selfAction !== "explain" || draft.current.claim !== "uncertain", []);
  const mayLeave = useCallback(() => !(working.current || stored() || dirty()) || window.confirm("仍有草稿或待确认原编号。离开不自动保存或重发；原编号保留供以后 GET 核验。确定离开吗？"), [dirty, stored]);
  const reloadLocal = useCallback(async () => {
    const token = epoch.current;
    try { const p = await clients.attempt.load(); if (current() && token === epoch.current) { setPending(p); setBlocked(p !== null); } }
    catch { if (current() && token === epoch.current) { setBlocked(true); setMessage("本标签页原编号需要核验，未覆盖或删除任何已有内容。"); } }
  }, [clients, current]);
  useLayoutEffect(() => {
    mounted.current = true; visible.current = !document.hidden;
    void reloadLocal(); registerLeaveGuard?.(mayLeave);
    const pause = () => { visible.current = false; pauseClients(); working.current = false;
      flushSync(() => { setData(null); clearDraft(); setPending(null); setBusy(false); setBlocked(true); setMessage("工作区已暂停，正文和草稿已清除；原编号仍保留。返回后请明确重新读取本地状态。"); }); };
    const visibility = () => { if (document.hidden) pause(); else visible.current = true; };
    const unload = (e: BeforeUnloadEvent) => { if (working.current || stored() || dirty()) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", pause); window.addEventListener("beforeunload", unload);
    return () => { mounted.current = false; pauseClients(); registerLeaveGuard?.(null);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", pause); window.removeEventListener("beforeunload", unload); };
  }, [clearDraft, dirty, mayLeave, pauseClients, registerLeaveGuard, reloadLocal, stored]);
  const read = async (query: DayReviewQuery) => {
    if (!current() || working.current || blocked || stored()) return;
    const token = epoch.current;
    if (dirty() && !window.confirm("重新读取将丢弃尚未保存的判断草稿。是否继续？")) return;
    if (!current() || token !== epoch.current || stored()) return;
    working.current = true; setBusy(true); setData(null); clearDraft(); setMessage("");
    try { const result = await clients.reader.read(query); if (current() && token === epoch.current) setData({ query, result }); }
    catch { if (current() && token === epoch.current) setMessage("未能核实完整资料，请明确重读或交负责人核验；这不表示没有记录。"); }
    finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); } }
  };
  const recover = async () => {
    if (!current() || working.current) return; const token = epoch.current; working.current = true; setBusy(true); setData(null); clearDraft();
    try { const result = await clients.attempt.recover(); if (current() && token === epoch.current) { setPending(null); setBlocked(false);
      setMessage(result.kind === "receipt" ? `原操作已确认：${result.receipt.operationId}。请明确读取保存结果。` : "原操作已确认。"); } }
    catch { if (current() && token === epoch.current) { setBlocked(true); setMessage("原编号仍未确认，已保留；不自动重发。未查到也不能视为失败。"); } }
    finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); } }
  };
  const send = () => {
    const snapshot = selected.current, frozenDraft = JSON.stringify(draft.current), token = epoch.current;
    if (!snapshot || !current() || working.current || blocked || stored() || !draft.current.ack || !draft.current.reason.trim()) return;
    let command: DayReviewCommand;
    try {
      const r = snapshot.result;
      if (access === "owner" && enabled && r.protocol === "attendance-day-review-preview-v1" && r.kind === "preview") {
        const candidate = evaluateDayClassification(r.input).candidates.find(c => c.outcome === draft.current.outcome);
        if (!candidate || candidate.candidateState !== "candidate") return;
        const calendar = candidate.calendarReferences.find(c => c.entryId === draft.current.calendarId);
        command = parseDayReviewCommand(snapshot.query, { action: "decide", operationId: crypto.randomUUID(), caseId: r.saved?.head.caseId ?? crypto.randomUUID(),
          expectedRevision: r.saved?.head.revision ?? 0, workerId: r.input.target.workerId, employeeId: r.input.target.employeeId, employeeAuthUserId: r.input.target.employeeAuthUserId,
          expectedFingerprint: r.input.source.fingerprint, outcome: draft.current.outcome, calendarReference: calendar ? { entryId: calendar.entryId, operationId: calendar.operationId, revision: 1 } : null,
          selfStatementOperationId: candidate.selfStatementReference?.operationId ?? null, reason: draft.current.reason.trim() });
      } else if (access === "self" && r.protocol === "attendance-day-review-v1" && r.kind === "detail") {
        command = parseDayReviewCommand(snapshot.query, { action: draft.current.selfAction, operationId: crypto.randomUUID(), expectedRevision: r.head.revision,
          decisionOperationId: r.head.latestDecision.receipt.operationId, claim: draft.current.selfAction === "dispute" ? null : draft.current.claim, reason: draft.current.reason.trim() });
      } else return;
    } catch { setMessage("请完整填写本次判断、依据和理由。"); return; }
    const still = () => current() && epoch.current === token && selected.current === snapshot && JSON.stringify(draft.current) === frozenDraft && !working.current && !stored();
    confirmDayReviewAction(() => window.confirm("只保存对以上固定范围的行政判断／本人说明，不修改打卡、工时、工资或旧周期。发送后先保留原编号，仅 GET 匹配回执后确认。是否提交？"), still, () => {
      working.current = true; setBusy(true); setBlocked(true); setMessage("正在提交一次；请勿重新发送。");
      void (async () => {
        try { await clients.attempt.post(snapshot.query, command); if (current() && token === epoch.current) setMessage("已收到本次结果，原编号仍保留。请点击仅 GET 核验原编号。"); }
        catch { if (current() && token === epoch.current) setMessage("结果尚未确认，保留原编号；请仅 GET 核验，不自动重发。"); }
        finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); setData(null); clearDraft(); await reloadLocal(); } }
      })();
    });
  };
  const r = data?.result, source = r?.protocol === "attendance-day-review-preview-v1" ? r : null;
  const saved = r?.protocol === "attendance-day-review-v1" ? r : null;
  const preview = source ? evaluateDayClassification(source.input) : null;
  const head = saved && (saved.kind === "detail" || saved.kind === "history") ? saved.head : source?.saved?.head;
  const choice = preview?.candidates.find(c => c.outcome === outcome);
  return <section aria-label="出勤情况核查" className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{access === "owner" ? "出勤情况核查" : "我的出勤核查与说明"}</h2>
      <button className={button} type="button" onClick={() => { if (mayLeave()) onClose(); }}>关闭出勤核查</button></header>
    <p className="text-sm text-slate-600">独立出勤判断；不改变原打卡、核定工时、工资、旧异常或周期状态。没有记录不等于未工作，停业豁免不抵消真实工作。</p>
    {message && <p role="status" className="break-words rounded-xl bg-amber-50 p-3 text-sm">{message}</p>}
    {blocked ? <div className="space-y-2 rounded-xl border border-amber-300 p-3"><p className="break-all">{pending ? `待确认原编号：${pending.command.operationId}` : "尚未核验本标签页的待确认状态。"}</p>
      <button className={button} type="button" disabled={busy} onClick={() => void reloadLocal()}>重新读取本地状态（零网络）</button>
      <button className={button} type="button" disabled={busy} onClick={() => void recover()}>仅 GET 核验原编号</button></div> : <>
      <div className="flex flex-wrap gap-2"><button className={button} type="button" disabled={busy} onClick={() => void read({ siteId, access, mode: "list", workerId: access === "owner" ? workerId ?? null : null, cursor: null })}>读取已保存核查</button>
        {access === "owner" && workerId && <><label className="min-w-0 text-sm">核查日期<input aria-label="出勤核查日期" type="date" className={field} value={date} onChange={e => { if (!dirty() || window.confirm("更改日期将清除草稿，继续吗？")) { clients.reader.pause(); epoch.current++; setData(null); clearDraft(); setDate(e.target.value); working.current = false; setBusy(false); } }}/></label>
          <button className={button} type="button" disabled={busy || !date} onClick={() => void read({ siteId, access: "owner", mode: "candidates", workerId, workDate: date })}>读取完整本日来源</button></>}</div>
      {source && <div className="min-w-0 space-y-3 rounded-xl border p-3"><p>{source.input.target.workDate} · 保存时区 {source.input.target.timeZone} · {source.input.target.kind === "day" ? "完整本日" : "完整排班"}</p>
        <p className="break-all text-xs">UTC：{source.input.target.fromAt} — {source.input.target.toAt}</p>
        <p>{preview?.observations.map(o => observationLabels[o]).join("；")}</p>
        {source.sourceChanged && <p className="text-amber-800">来源与上次保存决定不同，旧判断保留；本次必须重新明确决定。</p>}
        <p>计划 {source.input.source.plans.length} · 记录 {source.input.source.records.length} · 待审／故障 {source.input.source.pending.length} · 日历 {source.input.source.calendar.length}</p>
        {source.input.source.plans.map(plan => <div key={plan.slotId} className="min-w-0 rounded-lg bg-slate-50 p-2 text-sm"><p className="break-all">{plan.workDate} · {plan.timeZone} · {plan.startAt} — {plan.endAt} · {plan.cancelled ? "已取消" : "未取消"}</p>
          <p className="break-all text-xs">地点：{plan.locationId} · {plan.hasPublicationEvidence ? "有保存的发布依据" : "缺少发布依据"}</p>
          <button className={button} type="button" disabled={busy} onClick={() => void read({ siteId, access: "owner", mode: "preview", workerId: plan.workerId, workDate: plan.workDate, slotId: plan.slotId,
            caseId: source.saved?.head.target.slotId === plan.slotId ? source.saved.head.caseId : null })}>核查此完整排班</button></div>)}
        {source.input.source.records.map(record => <div key={record.kind + record.sourceId} className="min-w-0 rounded-lg border p-2 text-sm"><p className="break-all">{record.kind === "session" ? "原始班次" : "获批整段漏卡"} · {record.sourceId}</p>
          <p className="break-all">原始：{record.original?.startAt ?? "无原始端点"} — {record.original?.endAt ?? "无真实下班"}</p><p className="break-all">选定：{record.selected.startAt} — {record.selected.endAt ?? "未闭合"}</p>
          <p>{record.association ? "有保存的计划关联／采用依据" : "计划归属未核定"}{record.administrativeBoundary ? "；行政闭合，工时待核" : ""}</p>
          {record.administrativeBoundary && <p className="break-all text-xs">行政核验结束边界：{record.administrativeBoundary.verifiedEndAt}（不是补造的下班事件）</p>}</div>)}
        {source.input.source.calendar.map(entry => <div key={entry.entryId} className="min-w-0 rounded-lg border p-2 text-sm"><p>{entry.kind === "closure" ? "停业事项" : "节假日事项"} · {entry.status === "cancelled" ? "已撤销" : "有效登记"} · 版本 {entry.revision}</p>
          <p className="break-all">{entry.timeZone} · {entry.fromAt} — {entry.toAt}</p><p className="break-all text-xs">{entry.locationId ? `地点：${entry.locationId}` : "适用全企业"} · 原编号：{entry.operationId}</p></div>)}
        {source.input.source.pending.map(item => <p key={item.kind + item.sourceId} className="break-all rounded-lg bg-amber-50 p-2 text-sm">{pendingLabels[item.kind]} · 版本 {item.revision} · 原编号：{item.operationId}</p>)}
        {source.input.source.arrangements.map(item => <p key={item.requestId} className="break-all rounded-lg bg-slate-50 p-2 text-sm">获批工作安排 · {item.startAt} — {item.endAt} · 版本 {item.revision}（不自动产生工时或豁免）</p>)}
        {source.input.source.conflicts.map(item => <p key={item.kind + item.sourceIds.join(":")} className="break-all rounded-lg bg-amber-50 p-2 text-sm">{item.kind === "records_overlap" ? "工作记录重叠" : "工作与获批请假重叠"}：{item.sourceIds.join("；")}</p>)}
        {source.kind === "candidates" && <button className={button} type="button" disabled={busy} onClick={() => void read({ siteId, access: "owner", mode: "preview", workerId: source.input.target.workerId, workDate: source.input.target.workDate, slotId: null, caseId: null })}>核查本日固定范围</button>}
      </div>}
      {saved?.kind === "list" && <div className="space-y-3">{saved.items.length === 0 && <p>本页没有已保存核查；不代表没有工作或没有记录。</p>}{saved.items.map(item => <div key={item.caseId} className="min-w-0 rounded-xl border p-3"><HeadView head={item}/>
        <button className={button} type="button" disabled={busy} onClick={() => void read({ siteId, access, mode: "detail", caseId: item.caseId })}>读取此核查详情</button></div>)}
        {saved.nextCursor && <button className={button} type="button" disabled={busy} onClick={() => void read({ siteId, access, mode: "list", workerId: access === "owner" ? workerId ?? null : null, cursor: saved.nextCursor })}>读取下一页（25条）</button>}</div>}
      {head && <><HeadView head={head}/><div className="flex flex-wrap gap-2"><button className={button} type="button" disabled={busy} onClick={() => void read({ siteId, access, mode: "history", caseId: head.caseId, beforeRevision: null })}>读取保存历史</button>
        {access === "owner" && <button className={button} type="button" disabled={busy} onClick={() => void read({ siteId, access: "owner", mode: "preview", workerId: head.target.workerId, workDate: head.target.workDate, slotId: head.target.slotId, caseId: head.caseId })}>重新核验此固定范围</button>}</div></>}
      {saved?.kind === "history" && <div className="space-y-2">{saved.items.map(item => <DayReviewEntryView key={item.receipt.operationId} entry={item}/>)}{saved.nextRevision !== null && <button className={button} type="button" disabled={busy} onClick={() => void read({ siteId, access, mode: "history", caseId: saved.head.caseId, beforeRevision: saved.nextRevision })}>读取更早25条历史</button>}</div>}
      {(access === "owner" && source?.kind === "preview" || access === "self" && saved?.kind === "detail") && <fieldset disabled={busy} className="min-w-0 space-y-3 rounded-xl border p-3">
        {access === "owner" ? <><label>明确处理<select className={field} value={outcome} onChange={e => { setOutcome(e.target.value as DayClassificationOutcome); setCalendarId(""); setAck(false); }}>{preview?.candidates.map(c => <option key={c.outcome} value={c.outcome} disabled={c.candidateState !== "candidate"}>{dayReviewOutcomeLabels[c.outcome]}{c.candidateState !== "candidate" ? "（条件不足）" : ""}</option>)}</select></label>
          {outcome === "calendar_exempt" && <label>选择独立完整覆盖的停业原号<select className={field} value={calendarId} onChange={e => { setCalendarId(e.target.value); setAck(false); }}><option value="">请选择</option>{choice?.calendarReferences.map(c => <option key={c.entryId} value={c.entryId}>{c.entryId} · {c.timeZone} · {c.fromAt} — {c.toAt}</option>)}</select></label>}
          {!!choice?.blockers.length && <p className="text-sm text-amber-800">当前条件不足：{choice.blockers.map(b => blockerLabels[b]).join("；")}。</p>}
          {!enabled && <p>新决定开关关闭；保存结果、历史及原号核验仍可用。</p>}</> : <><label>本人回应<select className={field} value={selfAction} onChange={e => { setSelfAction(e.target.value as "explain" | "dispute"); setAck(false); }}><option value="explain">提交本人说明</option><option value="dispute">提出异议</option></select></label>
          {selfAction === "explain" && <label>情况<select className={field} value={claim} onChange={e => { setClaim(e.target.value as keyof typeof claimLabels); setAck(false); }}>{Object.entries(claimLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>}</>}
        <label className="block">理由／说明<textarea aria-label="出勤核查理由" className={field} maxLength={1000} value={reason} onChange={e => { setReason(e.target.value); setAck(false); }}/></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/>我确认以上固定范围与理由，仅保存本次行政判断／本人回应。</label>
        <button className={button} type="button" disabled={!ack || !reason.trim() || access === "owner" && (!enabled || choice?.candidateState !== "candidate" || outcome === "calendar_exempt" && !calendarId)} onClick={send}>明确提交一次</button>
      </fieldset>}
    </>}
  </section>;
}
