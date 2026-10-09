"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceWorkArrangementClient } from "@/lib/merchantAttendanceWorkArrangementClient";
import { resolveWorkArrangementInterval, type WorkArrangementConflict, type WorkArrangementDecision, type WorkArrangementDetail,
  type WorkArrangementKind, type WorkArrangementPreviewInput, type WorkArrangementResponse } from "@/lib/merchantAttendanceWorkArrangement";
import { correctionTimeOffsets, type CorrectionTimeInput } from "@/lib/merchantAttendanceCorrectionForm";
import type { WorkArrangementPanelProps } from "./MerchantAttendanceWorkArrangementLauncher";
import ReviewRoutingSelf from "./MerchantAttendanceReviewRoutingSelf";

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50";
const kinds: Record<WorkArrangementKind, string> = { trip: "出差", field: "外勤", remote: "远程" };
const statuses: Record<string, string> = { submitted: "待审批", withdrawn: "已撤回", approved: "已批准", rejected: "已驳回", cancelled: "已取消", scheduled: "已排班" };
const actions: Record<string, string> = { submit: "提交申请", withdraw: "撤回申请", approve: "批准申请", reject: "驳回申请", cancel: "取消批准", set_policy: "设置补申请期限" };
const issues: Record<string, string> = { binding_changed: "员工归属已变化", employment_gap: "区间不满足有效在职范围", outside_window: "超出补申请期限", conflicts: "有重叠资料，需要负责人或获授权审批人明确核对", sealed: "相关周期已封存，请先按原流程重开" };
type Props = WorkArrangementPanelProps & { onClose: () => void };
type ArrangementDraft = { kind: WorkArrangementKind | ""; start: CorrectionTimeInput; end: CorrectionTimeInput; reason: string; ack: boolean };
const emptyDraft = (): ArrangementDraft => ({ kind: "", start: { local: "", offset: "" }, end: { local: "", offset: "" }, reason: "", ack: false });
export const workArrangementReasonValid = (value: string) => value === value.trim() && [...value].length >= 1 && [...value].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
export function confirmWorkArrangementAction(confirm: () => boolean, current: () => boolean, submit: () => void): boolean {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export function sameWorkArrangementPreview(a: WorkArrangementPreviewInput | null, b: WorkArrangementPreviewInput | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.timeZone === b.timeZone && a.startAt === b.startAt && a.endAt === b.endAt;
}
export async function readWorkArrangementSelectedDetail(client: Pick<AttendanceWorkArrangementClient, "initialize" | "getSnapshot" | "detail">,
  requestId: string, current: () => boolean): Promise<"stale" | "blocked" | "read"> {
  await client.initialize(); if (!current()) return "stale";
  const state = client.getSnapshot();
  // initialize only inspects local pending storage; idle is the expected safe
  // starting phase. It is not a successful network read or approval authority.
  if (state.pending || state.phase !== "idle" && state.phase !== "ready") return "blocked";
  await client.detail(requestId); return current() ? "read" : "stale";
}
export default function MerchantAttendanceWorkArrangementPanel(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_WORK_ARRANGEMENTS_ENABLED === "1";
  return <Prepared key={`${props.siteId}:${props.access}:${props.actorId}`} {...props} enabled={enabled}/>;
}
function Prepared(props: Props & { enabled: boolean }) {
  const { siteId, access, actorId, apiFetch, enabled } = props;
  const client = useMemo(() => { try { return new AttendanceWorkArrangementClient({ siteId, access, actorId, apiFetch, enabled, storage: () => sessionStorage }); } catch { return null; } }, [siteId, access, actorId, apiFetch, enabled]);
  return client ? <Screen {...props} client={client}/> : <section aria-label="工作安排申请与审批" className="p-4"><p role="alert">当前身份无法核对工作安排，未读取或提交。</p><button type="button" className={button} onClick={props.onClose}>关闭工作安排</button></section>;
}
function Screen({ client, access, enabled, onClose, registerLeaveGuard, initialSelection, isCurrentAuth, apiFetch }: Props & { enabled: boolean; client: AttendanceWorkArrangementClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [shown, setShown] = useState(false), [draftVersion, setDraftVersion] = useState(0);
  const [draft, setDraft] = useState<ArrangementDraft>(emptyDraft);
  const dirty = useRef(false), epoch = useRef(0);
  const clearDraft = useCallback(() => { dirty.current = false; setDraftVersion(v => v + 1); setDraft(emptyDraft()); }, []);
  const leave = useCallback(() => { const generation = epoch.current;
    return (!(dirty.current || client.hasLeaveRisk()) || window.confirm("离开会清除未提交的工作安排或理由。已发送操作不撤销，原编号仍须核对；继续吗？")) && generation === epoch.current;
  }, [client]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useLayoutEffect(() => {
    const hide = () => { epoch.current++; setShown(false); clearDraft(); client.pause(); };
    const show = () => { const generation = ++epoch.current; clearDraft();
      if (!initialSelection || access !== "owner") { void client.initialize(); setShown(true); return; }
      setShown(false); void (async () => {
        const outcome = await readWorkArrangementSelectedDetail(client, initialSelection.requestId,
          () => generation === epoch.current && !document.hidden && isCurrentAuth?.() !== false);
        if (outcome === "stale") return;
        if (outcome === "blocked") { setShown(true); return; }
        const d = client.getSnapshot().result?.detail, e = initialSelection;
        if (e.family !== "work_arrangement" || !d || d.requestId !== e.requestId || d.workerId !== e.workerId || d.employeeId !== e.employeeId || d.employeeAuthUserId !== e.employeeAuthUserId || d.kind !== e.kind || Date.parse(d.submittedAt) !== Date.parse(e.submittedAt)) { client.pause(); return; }
        setShown(true);
      })(); };
    const visibility = () => { if (document.hidden) hide(); else show(); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    visibility(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate work across the current lifetime, not a captured generation
      epoch.current++; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clearDraft, initialSelection, isCurrentAuth, access]);
  const result = shown ? state.result : null, pending = shown ? state.pending : null;
  const busy = state.phase === "loading" || state.phase === "saving", editable = shown && !busy && !pending && state.phase === "ready";
  const read = (run: () => void, discard = true) => {
    const generation = epoch.current;
    if (!shown || document.hidden || busy || discard && dirty.current && !window.confirm("重新读取会清除未提交的安排或处理理由，继续吗？") || epoch.current !== generation || document.hidden) return;
    if (discard) clearDraft(); epoch.current++; run();
  };
  const confirm = (message: string, run: () => void) => { const generation = epoch.current, snapshot = client.getSnapshot();
    return confirmWorkArrangementAction(() => window.confirm(message), () => shown && !document.hidden && editable && enabled && !!result?.moduleEnabled && epoch.current === generation && client.getSnapshot() === snapshot,
      () => { epoch.current++; clearDraft(); run(); });
  };
  const markDirty = () => { epoch.current++; dirty.current = true; };
  return <section aria-label="工作安排申请与审批" data-work-arrangements className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">{access === "self" ? "我的出差／外勤／远程申请" : "工作安排审批与政策"}</h2>
      <button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>关闭工作安排</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">批准只认可工作安排，不证明工作已经发生。不生成打卡、不改变工时、工资、请假余额，不绕过定位、现场码或 PIN，也不自动豁免异常。实际记录有误仍使用原补正申请入口。</p>
    {!enabled && <p className="text-sm text-amber-900">新操作入口已关闭；仅明确核对原编号。服务端若关闭读取，原编号继续保留，不能保证立即恢复。</p>}
    <p role="status" aria-live="polite" className="break-words rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!shown || !enabled || busy || !!pending} onClick={() => read(() => { void client.load(); })}>读取工作安排首页</button>
      {pending && <button type="button" className={button} disabled={!shown || busy} onClick={() => read(() => { void client.recover(); })}>核对原工作安排编号</button>}
    </div>
    {pending && <div data-work-arrangement-pending className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>结果待确认，不自动重新提交，也不能另起操作覆盖原编号。正常打卡不受此待确认限制。</p><p className="break-all">原操作编号：{pending.command.operationId}</p><p>{actions[pending.command.action]}</p></div>}
    {result && <>
      {!result.moduleEnabled && <p className="text-sm text-amber-900">当前暂停新工作安排操作，仍可按权限读取历史及核对原号。</p>}
      <p className="break-words text-sm">当前企业考勤时区：{result.timeZone} · 设置版本 {result.settingsVersion} · 补申请期限 {result.policy.retrospectiveDays} 天（政策版本 {result.policy.revision}）</p>
      {access === "self" && <p className="break-all text-xs">本人员工记录：{result.employeeId} · 当前考勤档案：{result.workerId ?? "未关联，不能提交"}</p>}
      <WorkArrangementReceipt result={result}/>
      {access === "self" && !pending && result.detail && <ReviewRoutingSelf siteId={result.siteId} authUserId={result.actorId} family="work_arrangement" requestId={result.detail.requestId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth}/>}
      {result.detail ? <WorkArrangementDetailView key={`${result.detail.requestId}:${result.detail.revision}:${result.detail.conflictsFingerprint}:${draftVersion}`} detail={result.detail} access={access}
        disabled={!editable || !enabled || !result.moduleEnabled} onDirty={markDirty} onDecide={(action, reason, conflicts) => {
          confirm(`确认${actions[action]}？决定与理由将保留，批准不生成实际工时。`, () => { void client.decide(action, reason, conflicts); });
        }}/> : <>
        {access === "self" && enabled && <WorkArrangementForm key={`${result.workerId}:${result.settingsVersion}:${result.policy.revision}:${result.timeZone}:${draftVersion}`} result={result}
          draft={draft} onDraft={value => { markDirty(); setDraft(value); }} disabled={!editable || !result.moduleEnabled || !result.canSubmit}
          onPreview={value => read(() => { void client.preview(value); }, false)} onSubmit={reason => confirm("确认提交这份工作安排，由负责人或获授权审批人处理？它只是申请，不是实际工时或到岗证明。", () => { void client.submit({ reason }); })}/>}
        <section aria-label="工作安排记录" className="space-y-2"><h3 className="font-bold">{access === "owner" ? "工作安排申请（含待审与历史）" : "本人工作安排记录"}</h3>
          {!result.items.length && <p className="text-sm">本页没有可显示的申请；不代表没有工作或没有出勤。</p>}
          <ul className="space-y-2">{result.items.map(item => <li key={item.requestId} className="min-w-0 rounded-xl border p-3 text-sm"><p className="break-words">{item.workerName} · {kinds[item.kind]} · {statuses[item.status]}</p>
            <Interval startAt={item.startAt} endAt={item.endAt} timeZone={item.timeZone}/><p className="break-all text-xs">申请 {item.requestId} · 版本 {item.revision}</p>
            <button type="button" className={`${button} mt-2`} disabled={!editable} onClick={() => read(() => { void client.detail(item.requestId); })}>查看工作安排详情</button></li>)}</ul>
          <button type="button" className={button} disabled={!editable || !result.nextCursor} onClick={() => read(() => { void client.next(); })}>下一页工作安排</button>
        </section>
      </>}
      {access === "owner" && enabled && <WorkArrangementPolicyForm key={`${result.policy.revision}:${draftVersion}`} result={result} disabled={!editable || !result.moduleEnabled} onDirty={markDirty}
        onSave={(days, reason) => confirm("确认保存独立工作安排补申请期限？不会改变补正或请假政策，也不追溯改写已有申请。", () => { void client.setPolicy(days, reason); })}/>}
    </>}
    <p className="text-xs leading-6 text-slate-500">每次明确读取，不轮询。仅本标签页保存小型待确认命令，不保存整份列表；关闭标签页或清理存储后不能保证恢复。换身份、隐藏或权限失效后清除旧显示。此原入口仍限当前负责人审批；获授权审批人须走独立委托入口，不支持本人自批。取消既有批准和政策配置仍仅当前负责人。</p>
  </section>;
}
export function WorkArrangementForm({ result, disabled, draft, onDraft, onPreview, onSubmit }: { result: WorkArrangementResponse; disabled: boolean; draft: ArrangementDraft; onDraft: (value: ArrangementDraft) => void;
  onPreview: (input: WorkArrangementPreviewInput) => void; onSubmit: (reason: string) => void }) {
  const { kind, start, end, reason, ack } = draft;
  const [error, setError] = useState("");
  const change = (patch: Partial<ArrangementDraft>) => { setError(""); onDraft({ ...draft, ...patch, ack: false }); };
  let value: WorkArrangementPreviewInput | null = null;
  try { if (kind) value = { kind, timeZone: result.timeZone, ...resolveWorkArrangementInterval(start, end, result.timeZone) }; } catch { /* Explicit preview describes invalid or ambiguous time. */ }
  const matched = sameWorkArrangementPreview(value, result.preview), ready = matched && !!result.preview?.canSubmit;
  return <form aria-label="提交工作安排申请" className="min-w-0 space-y-3 rounded-xl border p-3" onSubmit={event => { event.preventDefault(); if (!disabled && ready && ack && workArrangementReasonValid(reason)) onSubmit(reason); }}>
    <h3 className="font-bold">新工作安排申请</h3><p className="text-xs leading-6">以当前企业时区输入，精确到分钟，最长 366 天；重复的夏令时时刻须明确选择 UTC 时差，不存在的当地时间不能提交。当前补申请期限 {result.policy.retrospectiveDays} 天，服务端还会核对在职范围与封存状态。</p>
    <label className="block text-sm">安排类别<select aria-label="工作安排类别" className={input} disabled={disabled} value={kind} onChange={event => change({ kind: event.target.value as WorkArrangementKind | "" })}><option value="">请选择类别</option>{Object.entries(kinds).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2"><TimeField label="工作安排开始时间" zone={result.timeZone} value={start} disabled={disabled} onChange={value => change({ start: value })}/><TimeField label="工作安排结束时间" zone={result.timeZone} value={end} disabled={disabled} onChange={value => change({ end: value })}/></div>
    <label className="block text-sm">申请理由（1–200 字，单行）<input aria-label="工作安排申请理由" className={input} maxLength={400} disabled={disabled} value={reason} onChange={event => change({ reason: event.target.value })}/></label>
    <button type="button" className={button} disabled={disabled} onClick={() => { if (!value) { setError("请选择类别及有效时间。重复时刻须选择 UTC 时差，不存在的时刻不能提交。"); return; } setError(""); onDraft({ ...draft, ack: false }); onPreview(value); }}>预览时间与冲突</button>
    {error && <p role="alert" className="text-sm text-amber-900">{error}</p>}
    {matched && result.preview && <section data-work-arrangement-preview className="space-y-2 rounded-xl bg-blue-50 p-3 text-sm"><h4 className="font-semibold">本次服务端预览 · {kinds[result.preview.kind]}</h4>
      <Interval {...result.preview}/><p>区间经过 {Math.round((Date.parse(result.preview.endAt) - Date.parse(result.preview.startAt)) / 60000)} 分钟，不是已工作时长。</p>
      <Issues values={result.preview.issues}/><WorkArrangementConflicts key={result.preview.conflictsFingerprint} conflicts={result.preview.conflicts}/>
      {result.preview.sealed && <p>相关周期已封存，请负责人先重开；此处不能绕过。</p>}
    </section>}
    {result.preview && !matched && <p className="text-sm text-amber-900">输入已改变，原预览不再用于提交。请重新预览。</p>}
    <label className="flex items-start gap-2 text-sm"><input aria-label="确认工作安排申请" type="checkbox" checked={ack} disabled={disabled || !ready || !workArrangementReasonValid(reason)} onChange={event => onDraft({ ...draft, ack: event.target.checked })}/><span>我已核对类别、UTC 起止、保存时区、重叠资料与理由，了解提交只是待审批安排。</span></label>
    <button type="submit" className={button} disabled={disabled || !ready || !ack || !workArrangementReasonValid(reason)}>明确提交工作安排</button>
  </form>;
}
function TimeField({ label, zone, value, disabled, onChange }: { label: string; zone: string; value: CorrectionTimeInput; disabled: boolean; onChange: (value: CorrectionTimeInput) => void }) {
  const offsets = correctionTimeOffsets(value.local, zone);
  return <div className="min-w-0"><label className="block text-sm">{label}<input aria-label={label} type="datetime-local" step={60} className={input} disabled={disabled} value={value.local} onChange={event => {
    const local = event.target.value, choices = correctionTimeOffsets(local, zone); onChange({ local, offset: choices.length === 1 ? choices[0] : "" });
  }}/></label>{offsets.length > 1 ? <label className="mt-1 block text-xs">{label} UTC 时差<select aria-label={`${label} UTC 时差`} className={input} disabled={disabled} value={offsets.includes(value.offset) ? value.offset : ""} onChange={event => onChange({ ...value, offset: event.target.value })}><option value="">重复时刻：明确选择</option>{offsets.map(offset => <option key={offset} value={offset}>{offset}</option>)}</select></label>
    : <p className="mt-1 text-xs">{!value.local ? "请按企业时区输入" : offsets.length ? `UTC ${offsets[0]}` : "无有效 UTC 时差，请检查不存在的当地时间"}</p>}</div>;
}
function Interval({ startAt, endAt, timeZone }: { startAt: string; endAt: string; timeZone: string }) { return <p className="break-all text-xs leading-6">UTC：{startAt} → {endAt}<br/>保存时区：{timeZone}（保存 UTC 为准，不随手机旅行时区迁移）</p>; }
function Issues({ values }: { values: string[] }) { return values.length ? <ul aria-label="工作安排限制" className="list-disc pl-5 text-sm">{values.map(value => <li key={value}>{issues[value] ?? value}</li>)}</ul> : null; }
export function WorkArrangementConflicts({ conflicts }: { conflicts: WorkArrangementConflict[] }) {
  const [page, setPage] = useState(0), pages = Math.ceil(conflicts.length / 10);
  return <section aria-label="工作安排重叠资料" className="min-w-0 space-y-2"><h4 className="font-semibold">重叠资料 · {conflicts.length} 项</h4>
    {!conflicts.length ? <p className="text-xs">本次返回范围内没有重叠资料；不证明没有打卡、没有工作或考勤正常。</p> : <><p className="text-xs">仅供明确核对，不自动合并或重复计时。</p><ul className="space-y-2">{conflicts.slice(page * 10, page * 10 + 10).map(c => <li key={`${c.source}:${c.id}`} className="min-w-0 rounded-lg border p-2 text-xs"><p>{c.source === "leave" ? "请假" : c.source === "schedule" ? "排班" : `工作安排 · ${c.kind ? kinds[c.kind] : "未指定类别"}`} · {statuses[c.status] ?? c.status} · 版本 {c.revision}</p><Interval {...c}/><p className="break-all">原编号 {c.id}</p></li>)}</ul>
      {pages > 1 && <nav aria-label="工作安排冲突本地分页" className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={!page} onClick={() => setPage(page - 1)}>上一页冲突</button><span>{page + 1} / {pages}</span><button type="button" className={button} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页冲突</button></nav>}</>}
  </section>;
}
export function WorkArrangementDetailView({ detail: d, access, disabled = true, onDirty = () => {}, onDecide = () => {} }: { detail: WorkArrangementDetail; access: "self" | "owner"; disabled?: boolean; onDirty?: () => void; onDecide?: (action: WorkArrangementDecision, reason: string, conflicts: boolean) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false), [conflicts, setConflicts] = useState(false);
  const choices: { action: WorkArrangementDecision; allowed: boolean }[] = access === "self" ? [{ action: "withdraw", allowed: d.canWithdraw }]
    : [{ action: "approve", allowed: d.canApprove }, { action: "reject", allowed: d.canReject }, { action: "cancel", allowed: d.canCancel }];
  return <article data-work-arrangement-detail className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="break-words font-bold">{d.workerName} · {kinds[d.kind]} · {statuses[d.status]}</h3><Interval {...d}/>
    <p className="break-words text-sm">申请理由：{d.reason}</p><p className="break-all text-xs">申请 {d.requestId} · 版本 {d.revision}<br/>员工 {d.employeeId} · 考勤档案 {d.workerId}<br/>提交 UTC {d.submittedAt} · 采用补申请期限 {d.retrospectiveDays} 天／政策版本 {d.policyRevision}</p>
    <Issues values={d.issues}/>{d.sealed && <p className="text-sm text-amber-900">相关周期已封存。新批准或取消必须先通过现有周期入口明确重开。</p>}
    <WorkArrangementConflicts key={d.conflictsFingerprint} conflicts={d.conflicts}/>
    <section aria-label="工作安排处理历史" className="space-y-2 text-sm"><h4 className="font-semibold">申请与处理历史</h4><ol className="space-y-2">{d.history.map(h => <li key={h.operationId} className="rounded-lg bg-slate-50 p-2"><p>版本 {h.revision} · {actions[h.action]}</p><p className="break-words">{h.reason}</p><p className="break-all text-xs">UTC {h.recordedAt}<br/>原操作 {h.operationId} · 操作者 {h.actorId}</p></li>)}</ol></section>
    {choices.some(c => c.allowed) && <div className="space-y-3"><label className="block text-sm">{access === "self" ? "撤回理由" : "工作安排处理理由"}（1–200 字，单行）<input aria-label="工作安排处理理由" className={input} disabled={disabled} value={reason} maxLength={400} onChange={event => { onDirty(); setReason(event.target.value); setAck(false); setConflicts(false); }}/></label>
      {access === "owner" && d.canApprove && d.conflicts.length > 0 && <label className="flex items-start gap-2 text-sm"><input aria-label="明确确认重叠资料" type="checkbox" checked={conflicts} disabled={disabled} onChange={event => { onDirty(); setConflicts(event.target.checked); }}/><span>我已逐项核对上列重叠资料，并在处理理由中说明本次批准的处理依据；不自动合并或重复计时。</span></label>}
      <label className="flex items-start gap-2 text-sm"><input aria-label="确认工作安排处理" type="checkbox" checked={ack} disabled={disabled || !workArrangementReasonValid(reason)} onChange={event => { onDirty(); setAck(event.target.checked); }}/><span>已核对当前申请、版本与理由。处理只保存安排决定，不证明实际工作。</span></label>
      <div className="flex flex-wrap gap-2">{choices.filter(c => c.allowed).map(c => <button type="button" className={button} key={c.action} disabled={disabled || !ack || !workArrangementReasonValid(reason) || c.action === "approve" && d.conflicts.length > 0 && !conflicts}
        onClick={() => onDecide(c.action, reason, conflicts)}>明确{actions[c.action]}</button>)}</div>
    </div>}
    {access === "owner" && d.status === "submitted" && !d.canApprove && <p className="text-sm">当前不能批准。须满足身份、在职、封存和非本人自批等条件；不能从页面绕过。</p>}
  </article>;
}
export function WorkArrangementReceipt({ result }: { result: WorkArrangementResponse }) {
  const r = result.receipt; if (!r) return null;
  return <section aria-label="工作安排操作收据" data-work-arrangement-receipt className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><h3 className="font-semibold">已保存：{actions[r.command.action]}</h3><p className="break-all">原操作编号：{r.command.operationId}</p><p className="break-words">理由：{r.command.reason}</p>
    {r.item && <><p>{r.item.workerName} · {kinds[r.item.kind]} · {statuses[r.item.status]} · 版本 {r.item.revision}</p><Interval {...r.item}/><p className="break-all text-xs">申请 {r.item.requestId}</p></>}
    {r.policy && <p>补申请期限 {r.policy.retrospectiveDays} 天 · 政策版本 {r.policy.revision}</p>}
    <p className="text-xs">这是该操作保存时的收据，当前条件未重新核查；请明确读取详情核对后续状态。批准安排仍不是实际工时。</p>
  </section>;
}
export function WorkArrangementPolicyForm({ result, disabled, onDirty, onSave }: { result: WorkArrangementResponse; disabled: boolean; onDirty: () => void; onSave: (days: number, reason: string) => void }) {
  const [days, setDays] = useState(String(result.policy.retrospectiveDays)), [reason, setReason] = useState(""), [ack, setAck] = useState(false);
  const valid = /^\d{1,3}$/.test(days) && Number(days) <= 365 && workArrangementReasonValid(reason);
  return <details className="min-w-0 rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">独立工作安排补申请政策 · 当前 {result.policy.retrospectiveDays} 天</summary><form aria-label="工作安排补申请政策" className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); if (!disabled && valid && ack) onSave(Number(days), reason); }}>
    <p className="text-xs leading-6">未配置时默认最近 30 天，允许 0–365 天；按企业当地提交日期核对开始日期。这是独立产品政策，不是法律期限，不借用或修改请假／补正政策。封存仍须先重开。</p>
    <label className="block text-sm">允许补申请天数<input aria-label="工作安排补申请天数" className={input} type="number" min={0} max={365} step={1} disabled={disabled} value={days} onChange={event => { onDirty(); setDays(event.target.value); setAck(false); }}/></label>
    <label className="block text-sm">政策变更理由<input aria-label="工作安排政策理由" className={input} disabled={disabled} maxLength={400} value={reason} onChange={event => { onDirty(); setReason(event.target.value); setAck(false); }}/></label>
    <label className="flex items-start gap-2 text-sm"><input aria-label="确认工作安排政策" type="checkbox" disabled={disabled || !valid} checked={ack} onChange={event => { onDirty(); setAck(event.target.checked); }}/><span>明确核对独立政策与变更理由，不追溯改变已有申请。</span></label>
    <button type="submit" className={button} disabled={disabled || !valid || !ack}>保存工作安排补申请政策</button>
  </form></details>;
}
