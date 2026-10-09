"use client";
//194 Self-only application entry. Existing records/approval paths are not edited.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { CorrectionProposal } from "@/lib/merchantAttendanceCorrection";
import { correctionDraftFromBasis, correctionDraftProposal, correctionTimeInput, correctionTimeOffsets, correctionTimeControlValue, parseCorrectionTimeInput,
  type CorrectionDraft, type CorrectionTimeInput } from "@/lib/merchantAttendanceCorrectionForm";
import { applicationWindowQueryString, parseApplicationWindowHttpQuery, type ApplicationWindowResult } from "@/lib/merchantAttendanceApplicationWindow";
import { AttendanceApplicationWindowClient, type ApplicationWindowPrepareQuery } from "@/lib/merchantAttendanceApplicationWindowClient";
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40";
const inputClass = "mt-1 block min-w-0 w-full max-w-full rounded-lg border p-2";
const currentAuth = () => true;
export type ApplicationWindowPanelProps = { query: ApplicationWindowPrepareQuery; employeeId: string; authUserId: string; apiFetch: AttendanceApiFetch;
  enabled?: boolean; isCurrentAuth?: () => boolean; initialProposal?: CorrectionProposal; initialReason?: string; onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
export function applicationWindowEditor(result: ApplicationWindowResult, initialProposal?: CorrectionProposal): { draft: CorrectionDraft; zone: string } | null {
  const a = result.application; if (!a || result.mode !== "prepare") return null;
  if (result.family === "correction" && "basis" in a) return { draft: correctionDraftFromBasis(a.basis), zone: a.basis.events[0].timeZone };
  const proposal = "current" in a ? a.current.proposal : initialProposal ?? ("detail" in a ? a.detail?.proposal : null);
  const zone = "current" in a ? a.current.timeZone : "timeZone" in a ? a.timeZone : null; if (!zone) return null;
  const convert = (s: string) => correctionTimeInput(s, zone), empty = { local: "", offset: "" };
  return { zone, draft: proposal ? { start: convert(proposal.startAt), end: convert(proposal.endAt), breaks: proposal.breaks.map(b => ({ start: convert(b.startAt), end: convert(b.endAt), paid: b.paid })) }
    : { start: { ...empty }, end: { ...empty }, breaks: [] } };
}
export function ApplicationWindowEvidence({ result }: { result: ApplicationWindowResult }) {
  const w = result.window, a = result.application;
  return <div className="min-w-0 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
    <p>这是申请资格与期限核验，不是审批；原打卡、核定和工时不会在本页改写。</p>
    {w && <dl className="space-y-1 break-words">
      <div>独立原政策：v{w.baselinePolicy.revision} · {w.baselinePolicy.submissionWindowDays} 个自然日 · {w.baselinePolicy.timeZone}</div>
      <div>额外规则：{w.selectedDays === null ? "未设置额外期限，仍受原政策限制" : `${w.selectedDays} 个自然日（只收紧）`}</div>
      <div>原始依据起点：{w.anchorAt}</div><div>原政策截止：{w.baselineDeadlineAt}</div>
      {w.operationalDeadlineAt && <div>额外规则截止：{w.operationalDeadlineAt}</div>}{w.rootDeadlineAt && <div>原根申请截止上限：{w.rootDeadlineAt}</div>}
      <div>本次最晚截止（到点即过期）：{w.effectiveDeadlineAt}</div><div>消费者版本：{w.activationRevision} · 核验时刻：{w.observedAt}</div>
      <div className="break-all">来源指纹：{w.sourceFingerprint}</div>
    </dl>}
    {a && "basis" in a && <p className="break-words">原始打卡（只读）：{a.basis.events[0].occurredAt} 至 {a.basis.events.at(-1)?.occurredAt}；共 {a.basis.events.length} 条。</p>}
    {a && "current" in a && <p className="break-words">当前核定（只读）：{a.current.proposal.startAt} 至 {a.current.proposal.endAt}；休息 {a.current.proposal.breaks.length} 段。</p>}
    {a && "detail" in a && a.detail && <p className="break-words">原申请（只读）：{a.detail.proposal.startAt} 至 {a.detail.proposal.endAt}；状态 {a.detail.status}。</p>}
    {result.receipt && <p className="break-all">已确认原编号：{result.receipt.operationId}。申请收据不等于批准，也不授予新写资格。</p>}
  </div>;
}
export function ApplicationWindowTimeField({ label, value, zone, disabled, onChange }: { label: string; value: CorrectionTimeInput; zone: string; disabled: boolean; onChange: (v: CorrectionTimeInput) => void }) {
  const offsets = correctionTimeOffsets(value.local, zone);
  return <div className="grid min-w-0 gap-2 sm:grid-cols-2"><label className="min-w-0">{label}<input aria-label={label} type="datetime-local" step="0.001" className={inputClass} value={correctionTimeControlValue(value.local)} disabled={disabled}
    onChange={e => { const local = e.target.value, choices = correctionTimeOffsets(local, zone); onChange({ local, offset: choices.length === 1 ? choices[0] : "" }); }} /></label>
    <label className="min-w-0">{label}的 UTC 偏移<select aria-label={`${label}的 UTC 偏移`} className={inputClass} value={value.offset} disabled={disabled} onChange={e => onChange({ ...value, offset: e.target.value })}>
      <option value="">请选择有效偏移</option>{offsets.map(offset => <option key={offset} value={offset}>{offset}</option>)}</select></label>
    {value.local && !offsets.length && <p className="text-red-700">该当地时间不存在或无效，请检查企业时区。</p>}
  </div>;
}
export default function MerchantAttendanceApplicationWindowPanel({ query, employeeId, authUserId, apiFetch,
  enabled = process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED === "1", isCurrentAuth = currentAuth, initialProposal, initialReason, onClose, registerLeaveGuard }: ApplicationWindowPanelProps) {
  const queryKey = applicationWindowQueryString(query);
  const stableQuery = useMemo(() => { const value = parseApplicationWindowHttpQuery("https://local.invalid/?" + queryKey); if (value.mode !== "prepare") throw Error("invalid_query"); return value; }, [queryKey]);
  const marker = useMemo(() => ({ query: stableQuery, employeeId, authUserId, apiFetch, enabled, isCurrentAuth }), [stableQuery, employeeId, authUserId, apiFetch, enabled, isCurrentAuth]);
  const liveMarker = useRef(marker), mounted = useRef(false); liveMarker.current = marker;
  const seed = useRef<{ marker: typeof marker; proposal?: CorrectionProposal; reason?: string } | null>(null), seededMarker = useRef<typeof marker | null>(null);
  if (seededMarker.current !== marker) { seededMarker.current = marker; seed.current = { marker, proposal: initialProposal ? structuredClone(initialProposal) : undefined, reason: initialReason }; }
  const live = useCallback(() => mounted.current && liveMarker.current === marker && isCurrentAuth() === true, [marker, isCurrentAuth]);
  const client = useMemo(() => new AttendanceApplicationWindowClient({ ...marker, isCurrentAuth: live, storage: () => {
    if (!live()) throw Error("scope_changed"); return sessionStorage;
  } }), [marker, live]); // query identity is the exact canonical marker above.
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [editor, setEditor] = useState<{ marker: typeof marker; draft: CorrectionDraft; zone: string } | null>(null), [reasonState, setReasonState] = useState({ marker, value: "" });
  const [note, setNote] = useState({ marker, value: "" }), [ack, setAck] = useState({ marker, value: false });
  const dirtyRef = useRef(false), currentEditor = editor?.marker === marker ? editor : null, reason = reasonState.marker === marker ? reasonState.value : "";
  const result = state.result, busy = state.phase === "loading" || state.phase === "saving", pending = state.pending;
  const clear = useCallback(() => { seed.current = null; dirtyRef.current = false; setEditor(null); setReasonState({ marker, value: "" }); setNote({ marker, value: "" }); setAck({ marker, value: false }); }, [marker]);
  const leave = useCallback(() => {
    if ((dirtyRef.current || client.hasLeaveRisk()) && !window.confirm("离开会清除未提交草稿；待确认完整原编号仍保留，不会撤回已发送的申请。确定离开？")) return false;
    client.pause(); clear(); return true;
  }, [client, clear]);
  useEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useEffect(() => {
    mounted.current = true; dirtyRef.current = !!seed.current?.proposal || !!seed.current?.reason; void client.initialize();
    const hide = () => { if (document.hidden) flushSync(() => { client.pause(); clear(); }); else void client.initialize(); };
    const pagehide = () => { client.pause(); clear(); }, pageshow = () => { if (!document.hidden) void client.initialize(); };
    const unload = (e: BeforeUnloadEvent) => { if (dirtyRef.current || client.hasLeaveRisk()) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", pagehide); window.addEventListener("pageshow", pageshow); window.addEventListener("beforeunload", unload);
    return () => { mounted.current = false; client.pause(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", pagehide); window.removeEventListener("pageshow", pageshow); window.removeEventListener("beforeunload", unload); };
  }, [client, clear]);
  const read = async () => {
    if (!live() || document.hidden || busy || pending) return;
    try { let next = query;
      if ((query.family === "missing" || query.family === "missing_revision") && currentEditor) next = { ...query, proposedStartAt: parseCorrectionTimeInput(currentEditor.draft.start, currentEditor.zone) };
      setNote({ marker, value: "" }); setAck({ marker, value: false }); await client.prepare(next); if (!live() || document.hidden) return; const r = client.getSnapshot().result;
      if (r && !currentEditor) { const held = seed.current?.marker === marker ? seed.current : null, nextEditor = applicationWindowEditor(r, held?.proposal);
        if (nextEditor) { setEditor({ marker, ...nextEditor }); if (held?.reason) setReasonState({ marker, value: held.reason }); seed.current = null; } }
    } catch { if (live()) setNote({ marker, value: "请先填写有效的申请起点及明确 UTC 偏移，再读取窗口。" }); }
  };
  const edit = (draft: CorrectionDraft) => { if (!currentEditor || busy || pending || !live()) return; dirtyRef.current = true; setEditor({ ...currentEditor, draft }); setAck({ marker, value: false }); };
  let proposal: CorrectionProposal | null = null;
  try { if (currentEditor) proposal = correctionDraftProposal(currentEditor.draft, currentEditor.zone); } catch { /* Invalid drafts remain editable; no network. */ }
  const preparedStart = state.query?.mode === "prepare" && (state.query.family === "missing" || state.query.family === "missing_revision") ? state.query.proposedStartAt : null;
  const startChanged = preparedStart !== null && proposal?.startAt !== preparedStart;
  const validReason = reason === reason.trim() && reason.length > 0 && [...reason].length <= (query.family.startsWith("missing") ? 200 : 500) && !/[\u0000-\u001f\u007f-\u009f]/u.test(reason);
  const canSubmit = enabled && !busy && !pending && !!result?.canSubmit && result.mode === "prepare" && !!proposal && !startChanged && validReason && ack.marker === marker && ack.value;
  const submit = async () => {
    if (!live() || document.hidden || !canSubmit || !proposal || !window.confirm("按当前显示的固定期限提交本人申请？这不会改写原打卡，也不代表已获批准。")) return;
    await client.submit(proposal, reason); if (!live() || document.hidden) return;
    if (client.getSnapshot().pending || client.getSnapshot().result?.receipt) { dirtyRef.current = false; setEditor(null); setReasonState({ marker, value: "" }); setAck({ marker, value: false }); }
  };
  return <section aria-label="规则申请窗口" className="min-w-0 max-w-full space-y-4 rounded-2xl border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">规则申请窗口 · {{ correction: "本人补正", correction_revision: "再次修订", missing: "漏卡申请", missing_revision: "漏卡再次修订" }[query.family]}</h2>
      <button type="button" className={button} onClick={() => { if (leave()) onClose(); }}>返回原申请页</button></div>
    <p role="status" className="break-words text-sm">{note.marker === marker && note.value || state.message}</p>
    {!enabled && <p>新申请入口当前关闭；本页仍可显式核对已经保存的原编号。</p>}
    <p className="text-sm">不会自动读取、提交或审批。旧待确认编号优先；GET 暂未找到不代表失败。</p>
    {pending ? <div className="space-y-2"><p className="break-all">{pending.kind === "legacy" ? "旧协议" : "规则窗口"}待确认编号：{pending.operationId}</p>
      <button type="button" className={button} disabled={busy} onClick={() => { clear(); void client.recover(); }}>仅 GET 核对原编号</button>
      {state.canEndRejectedAttempt && <button type="button" className={button} disabled={busy} onClick={() => { if (window.confirm("仅结束本次已明确零提交拒绝的本地尝试？不会撤回任何已提交申请；之后必须手动重读。")) { clear(); void client.endRejectedAttempt(); } }}>结束本次已拒绝尝试</button>}
    </div> : <button type="button" className={button} disabled={!enabled || busy} onClick={() => void read()}>读取当前申请窗口</button>}
    {result && <ApplicationWindowEvidence result={result} />}
    {currentEditor && !pending && <div className="min-w-0 space-y-3"><p className="text-sm">声明时间 · 企业时区 {currentEditor.zone}。重复当地时间必须明确选择偏移；不存在的当地时间不能提交。</p>
      <ApplicationWindowTimeField label="申请上班时间" value={currentEditor.draft.start} zone={currentEditor.zone} disabled={busy} onChange={start => edit({ ...currentEditor.draft, start })} />
      <ApplicationWindowTimeField label="申请下班时间" value={currentEditor.draft.end} zone={currentEditor.zone} disabled={busy} onChange={end => edit({ ...currentEditor.draft, end })} />
      {currentEditor.draft.breaks.map((b, index) => <fieldset key={index} className="min-w-0 space-y-2 rounded-xl border p-3"><legend>休息 {index + 1}</legend>
        <ApplicationWindowTimeField label={`休息 ${index + 1} 开始`} value={b.start} zone={currentEditor.zone} disabled={busy} onChange={start => edit({ ...currentEditor.draft, breaks: currentEditor.draft.breaks.map((x, i) => i === index ? { ...x, start } : x) })} />
        <ApplicationWindowTimeField label={`休息 ${index + 1} 结束`} value={b.end} zone={currentEditor.zone} disabled={busy} onChange={end => edit({ ...currentEditor.draft, breaks: currentEditor.draft.breaks.map((x, i) => i === index ? { ...x, end } : x) })} />
        <label><input type="checkbox" checked={b.paid} disabled={busy} onChange={e => edit({ ...currentEditor.draft, breaks: currentEditor.draft.breaks.map((x, i) => i === index ? { ...x, paid: e.target.checked } : x) })} /> 带薪休息</label>
        <button type="button" className={button} disabled={busy} onClick={() => edit({ ...currentEditor.draft, breaks: currentEditor.draft.breaks.filter((_, i) => i !== index) })}>删除休息 {index + 1}</button>
      </fieldset>)}
      <button type="button" className={button} disabled={busy || currentEditor.draft.breaks.length >= (query.family.startsWith("missing") ? 8 : 32)} onClick={() => edit({ ...currentEditor.draft, breaks: [...currentEditor.draft.breaks, { start: { local: "", offset: "" }, end: { local: "", offset: "" }, paid: false }] })}>添加休息段</button>
      <label className="block">申请理由<textarea aria-label="申请理由" className={inputClass} rows={3} value={reason} disabled={busy} onChange={e => { dirtyRef.current = true; setReasonState({ marker, value: e.target.value }); setAck({ marker, value: false }); }} /></label>
      {startChanged && <p>漏卡起点已变更，请再次“读取当前申请窗口”后提交。</p>}
      <label className="block text-sm"><input type="checkbox" checked={ack.marker === marker && ack.value} disabled={busy} onChange={e => { dirtyRef.current = true; setAck({ marker, value: e.target.checked }); }} /> 我已核对声明时间、休息、理由和本次固定截止，理解这仅是本人申请。</label>
      <button type="button" className={button} disabled={!canSubmit} onClick={() => void submit()}>提交本人申请</button>
    </div>}
  </section>;
}
