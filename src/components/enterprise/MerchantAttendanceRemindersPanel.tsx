"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceRemindersClient, remindersAuthCurrent, type RemindersClientState } from "@/lib/merchantAttendanceRemindersClient";
import { AttendanceReminderNavigation, reminderOriginalSupported, reminderOriginalTarget, type ReminderNavigationState, type ReminderReviewTarget } from "@/lib/merchantAttendanceRemindersNavigation";
import { AttendanceReminderSelfNavigation, type ReminderSelfSessionSelection } from "@/lib/merchantAttendanceRemindersSelfNavigation";
import { parseAttendanceReminderBody, type AttendanceReminderBody, type AttendanceReminderQuery, type AttendanceReminderBatch,
  type AttendanceReminderSummary, type AttendanceReminderResult, type AttendanceReminderTarget,
  type AttendanceReminderRunCursor } from "@/lib/merchantAttendanceReminders";
import type { ReviewRoutingRequest } from "@/lib/merchantAttendanceReviewRouting";
import type { CycleIntentResult } from "@/lib/merchantAttendanceCycleIntentResult";

export type RemindersPanelProps = { siteId: string; actorId: string; ownerId?: string | null; apiFetch: AttendanceApiFetch;
  isCurrentAuth?: () => boolean; requesterKey?: string; enabled?: boolean; active?: boolean; recoveryOnly?: boolean;
  selfEmployeeId?: string | null; onOpenSelfSession?: (value: ReminderSelfSessionSelection) => boolean;
  onOpenDelegateTarget?: (target: ReminderReviewTarget) => boolean;
  onOpenOriginal?: (request: ReviewRoutingRequest) => boolean; onOpenPeriod?: (value: CycleIntentResult) => boolean; onClose: () => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const categories = { open_session: "未结束班次", pending_review: "待处理审批", period_due: "周期到期" };
const families = { correction: "补卡申请", correction_revision: "补卡修订", missing: "缺卡申请", missing_revision: "缺卡修订", leave: "请假申请", work_arrangement: "工作安排" };
export function reminderTargetLabel(target: AttendanceReminderTarget): string {
  return target.kind === "pending_review" ? families[target.family] : categories[target.kind];
}
export function reminderConfirm(confirm: () => boolean, current: () => boolean, send: () => void): boolean {
  if (!current() || !confirm() || !current()) return false; send(); return true;
}
export function reminderUiCommand(siteId: string, operationId: string, action: "mark_read", value: AttendanceReminderBatch): AttendanceReminderBody;
export function reminderUiCommand(siteId: string, operationId: string, action: "run_due", value: AttendanceReminderRunCursor | null): AttendanceReminderBody;
export function reminderUiCommand(siteId: string, operationId: string, action: "mark_read" | "run_due", value: AttendanceReminderBatch | AttendanceReminderRunCursor | null): AttendanceReminderBody {
  return action === "mark_read" ? parseAttendanceReminderBody({ query: { siteId, mode: "detail", batchId: (value as AttendanceReminderBatch).batchId, operationId: null, cursor: null },
    command: { action, operationId, batchId: (value as AttendanceReminderBatch).batchId } })
    : parseAttendanceReminderBody({ query: { siteId, mode: "check", batchId: null, operationId: null, cursor: null }, command: { action, operationId, cursor: value } });
}
export function RemindersReceiptView({ value, verified }: { value: AttendanceReminderResult; verified: boolean }) {
  const receipt = value.receipt; if (!receipt) return null;
  return <article data-reminder-receipt className="min-w-0 space-y-2 rounded-xl border p-3 text-sm">
    <p className="font-semibold">{verified ? "原号 GET 已核验" : "仅收到提交响应，仍需原号 GET 核验"}</p><p className="break-all">原操作编号：{receipt.operationId}</p>
    {receipt.result.kind === "mark_read" ? <p>仅记录该提醒已读；未打开、审批或处理原业务。</p> : <><p>本次手动检查：{receipt.result.status === "completed" ? "已完成本页" : "未启用"}，检查 {receipt.result.checkedCount}，投递 {receipt.result.deliveredCount}，推迟 {receipt.result.deferredCount}，停止 {receipt.result.stoppedCount}。</p>
      <p>没有自动运行后续页，也没有自动处理员工审批、班次或工时表。</p></>}
  </article>;
}
export function ReminderTargetView({ target, canOpen, disabled, onOpen, destination = "owner" }: { target: AttendanceReminderTarget; canOpen: boolean; disabled: boolean; onOpen: () => void; destination?: "owner" | "self" | "delegate" }) {
  const supported = destination === "self" ? target.kind === "open_session" : destination === "delegate"
    ? target.kind === "pending_review" && target.family === "correction" : reminderOriginalSupported(target);
  return <div className="min-w-0 space-y-2"><p className="font-semibold">{reminderTargetLabel(target)}</p><p className="break-all text-xs text-slate-500">{target.kind === "pending_review" ? `申请 ${target.requestId} · 保存责任版本 ${target.responsibilityRevision}`
    : target.kind === "open_session" ? `人员 ${target.workerId} · 开始记录 ${target.startEventId}` : `人员 ${target.workerId} · 周期意向 ${target.intentId}`}</p>
    {canOpen && supported ? <button type="button" className={button} disabled={disabled} onClick={onOpen}>{destination === "self" ? "重新核验并打开本人当前班次" : destination === "delegate" ? "打开受托补正入口（需重新选择授权）" : `重新核验并打开${target.kind === "period_due" ? "周期意向" : "审批"}原入口`}</button>
      : <p className="text-sm text-slate-500">原入口尚待接线；请从现有对应工作区明确读取，提醒本身不授予权限。</p>}
  </div>;
}
//A changed actual Auth/requester/transport synchronously drops the old subtree.
export default function MerchantAttendanceRemindersPanel(props: RemindersPanelProps) {
  const key = JSON.stringify([props.siteId, props.actorId, props.ownerId ?? null, props.selfEmployeeId ?? null, props.requesterKey ?? null, props.enabled === true, props.active !== false, props.recoveryOnly === true]);
  const [marker, setMarker] = useState({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, version: 0 });
  if (marker.key !== key || marker.fetch !== props.apiFetch || marker.auth !== props.isCurrentAuth) {
    setMarker({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, version: marker.version + 1 }); return null;
  }
  if (props.active === false || !remindersAuthCurrent(props.isCurrentAuth) || typeof document !== "undefined" && document.hidden) return null;
  return <Scope key={marker.version} {...props}/>;
}
function Scope({ siteId, actorId, ownerId, selfEmployeeId, apiFetch, isCurrentAuth, enabled = false, recoveryOnly = false, onOpenOriginal, onOpenPeriod, onOpenSelfSession, onOpenDelegateTarget, onClose, registerLeaveGuard }: RemindersPanelProps) {
  const mounted = useRef(false), visible = useRef(true), epoch = useRef(0), working = useRef(false), [shown, setShown] = useState(true);
  const invalidate = useCallback(() => { epoch.current++; }, []);
  const current = useCallback(() => mounted.current && visible.current && !document.hidden && remindersAuthCurrent(isCurrentAuth), [isCurrentAuth]);
  const [state, setState] = useState<RemindersClientState | null>(null), [navState, setNavState] = useState<ReminderNavigationState | null>(null), [notice, setNotice] = useState("");
  const [busyUi, setBusyUi] = useState(false), [localReady, setLocalReady] = useState(false);
  const client = useMemo(() => new AttendanceRemindersClient({ siteId, actorId, apiFetch, storage: () => window.sessionStorage, isCurrentAuth: current,
    canWrite: () => enabled && !recoveryOnly && current(), onState: setState }), [siteId, actorId, apiFetch, current, enabled, recoveryOnly]);
  const navigation = useMemo(() => ownerId === actorId && !recoveryOnly ? new AttendanceReminderNavigation({ siteId, actorId, ownerId, apiFetch,
    storage: () => window.sessionStorage, isCurrentAuth: current, onState: setNavState }) : null, [siteId, actorId, ownerId, apiFetch, current, recoveryOnly]);
  // Ordinary host redraws rewrap callbacks; only capability/identity changes
  // invalidate the reader. The handoff below still uses the latest callback.
  const selfNavigationEnabled = !!selfEmployeeId && !!onOpenSelfSession && !recoveryOnly;
  const selfNavigation = useMemo(() => selfEmployeeId && selfNavigationEnabled ? new AttendanceReminderSelfNavigation({ siteId, actorId,
    employeeId: selfEmployeeId, apiFetch, storage: () => window.sessionStorage, isCurrentAuth: current, onState: setNavState }) : null,
  [siteId, actorId, selfEmployeeId, selfNavigationEnabled, apiFetch, current]);
  const snapshot = state ?? client.getSnapshot(), detail = snapshot.result?.data.kind === "batch" ? snapshot.result.data.batch : null;
  const raw = useCallback(() => client.hasLeaveRisk(), [client]);
  const mayLeave = useCallback(() => !(working.current || raw() || navigation?.hasLeaveRisk() || selfNavigation?.hasLeaveRisk())
    || window.confirm("仍有读取或待核验原操作。离开会清除提醒正文，但保留本地原操作编号，不会自动重发或处理业务。确定离开吗？"), [raw, navigation, selfNavigation]);
  useLayoutEffect(() => {
    mounted.current = true; visible.current = !document.hidden;
    void client.load().catch(() => {}).finally(() => { if (current()) setLocalReady(true); }); registerLeaveGuard?.(mayLeave);
    const pause = () => { visible.current = false; invalidate(); working.current = false;
      flushSync(() => { client.pause(); navigation?.pause(); selfNavigation?.pause(); setShown(false); setNotice(""); setBusyUi(false); setLocalReady(false); }); };
    const visibility = () => { if (document.hidden) pause(); else { visible.current = true; setShown(true); } };
    const show = () => { if (!document.hidden) { visible.current = true; setShown(true); } };
    const unload = (event: BeforeUnloadEvent) => { if (working.current || raw() || navigation?.hasLeaveRisk() || selfNavigation?.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", pause); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    // StrictMode may immediately set up this same memoized client again.
    // Pause fences late work and clears body without permanently disabling it.
    return () => { mounted.current = false; invalidate(); client.pause(); navigation?.pause(); selfNavigation?.pause(); registerLeaveGuard?.(null);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", pause); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, navigation, selfNavigation, mayLeave, raw, registerLeaveGuard, current, invalidate]);
  const run = async (work: () => Promise<unknown>) => {
    if (!current() || working.current) return; const token = epoch.current; working.current = true; setBusyUi(true); setNotice(""); setNavState(null);
    try { await work(); }
    catch { if (current() && token === epoch.current) setNotice("本次结果尚不能核实；原号保留，不会自动重发或跳转。请明确重新核验。"); }
    finally { if (current() && token === epoch.current) { working.current = false; setBusyUi(false); setLocalReady(true); } }
  };
  const read = (query: Exclude<AttendanceReminderQuery, { mode: "recover" }>) => {
    if (recoveryOnly || raw()) return; void run(() => client.read(query));
  };
  const post = (action: "mark_read" | "run_due", cursor: AttendanceReminderRunCursor | null = null) => {
    const selected = client.getSnapshot(), batch = selected.result?.data.kind === "batch" ? selected.result.data.batch : null, token = epoch.current;
    const still = () => current() && enabled && !recoveryOnly && !working.current && !raw() && epoch.current === token && client.getSnapshot() === selected
      && (action === "mark_read" ? batch !== null && batch.readAt === null : ownerId === actorId);
    reminderConfirm(() => window.confirm(action === "mark_read" ? "明确记录此提醒已读？不会自动审批、打开或处理原业务。仅发送一次，随后须原号 GET 核验。"
      : "现在手动检查当前提醒窗的一页？不会自动循环或处理原业务。仅发送一次，随后须原号 GET 核验。"), still, () => {
      let pair: AttendanceReminderBody;
      try { const operationId = crypto.randomUUID(); pair = action === "mark_read" ? reminderUiCommand(siteId, operationId, action, batch!) : reminderUiCommand(siteId, operationId, action, cursor); }
      catch { setNotice("命令尚未通过校验；未发送。"); return; }
      void run(() => client.submit(pair.query, pair.command));
    });
  };
  const openOriginal = async (target: AttendanceReminderTarget) => {
    if (!navigation || (target.kind === "period_due" ? !onOpenPeriod : !onOpenOriginal) || !current() || working.current || raw()) return;
    const token = epoch.current, selected = client.getSnapshot();
    await run(async () => {
      const ref = target.kind === "period_due" ? await navigation.freshPeriod(target) : await navigation.freshOriginal(target);
      if (!current() || token !== epoch.current || raw() || client.getSnapshot() !== selected) return;
      const opened = "protocol" in ref ? onOpenPeriod?.(ref) : onOpenOriginal?.(ref);
      if (!opened) throw Error("host_busy");
      //The host owns the actual original panel and independently re-reads it.
    });
  };
  const openRecipient = async (target: AttendanceReminderTarget) => {
    if (recoveryOnly || !current() || working.current || raw()) return;
    const token = epoch.current, selected = client.getSnapshot();
    await run(async () => {
      //Only the actual self193 GET may open a current self session. A delegate
      //pointer opens the old selector, not an authorized body or chosen grant.
      const self = target.kind === "open_session" && selfNavigation ? await selfNavigation.freshSession(target) : null;
      const delegated = !self && target.kind === "pending_review" && target.family === "correction" && onOpenDelegateTarget ? reminderOriginalTarget(target) : null;
      if (!current() || token !== epoch.current || raw() || client.getSnapshot() !== selected) return;
      if (!(self ? onOpenSelfSession?.(self) : delegated ? onOpenDelegateTarget?.(delegated) : false)) throw Error("host_busy");
    });
  };
  const busy = busyUi || snapshot.phase === "loading" || snapshot.phase === "saving" || snapshot.phase === "recovering" || navState?.phase === "loading";
  const blocked = !localReady || busy || raw(), value = snapshot.result, data = value?.data;
  const nextRun = snapshot.query?.mode === "recover" && !snapshot.pending && value?.receipt?.result.kind === "run" ? value.receipt.result.nextCursor : null;
  if (!shown) return <section className="min-w-0 p-4"><p>提醒正文已隐藏；本地原号保留。返回前台后请明确重新读取。</p></section>;
  return <section aria-label="考勤站内提醒工作区" className="min-w-0 max-w-full space-y-4 p-4 text-slate-900 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-bold">考勤站内提醒</h2><p className="mt-2 text-sm text-slate-600">按一小时提醒窗归并。只做提醒与明确核验，不自动审批、补打卡、结束班次或生成工时表。</p></div>
      <button type="button" className={button} onClick={() => { if (mayLeave()) onClose(); }}>关闭提醒</button></header>
    {!enabled && <p className="rounded-xl bg-amber-50 p-3 text-sm">新提醒操作尚未开放；当前账号可明确读取或核验原号，服务端仍独立核权。</p>}
    {recoveryOnly && <p className="text-sm">本页仅核验原账号保存的操作编号，不读取提醒列表或发起新操作。</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void run(() => client.load())}>读取本地原号（不联网）</button>
      <button type="button" className={button} disabled={busy} onClick={() => void run(() => client.recover())}>以 GET 核验原操作</button>
      {!recoveryOnly && <button type="button" className={button} disabled={blocked} onClick={() => read({ siteId, mode: "list", batchId: null, operationId: null, cursor: null })}>读取提醒列表</button>}
      {!recoveryOnly && ownerId === actorId && <button type="button" className={button} disabled={!enabled || blocked} onClick={() => post("run_due")}>现在手动检查本窗</button>}</div>
    {snapshot.pending && <p className="break-all rounded-xl bg-amber-50 p-3 text-sm">待核验原操作：{snapshot.pending.command.operationId}。只 GET 核验，不自动重发。</p>}
    <p role="status" className="break-words rounded-xl bg-slate-100 p-3 text-sm">{notice || navState?.message || snapshot.message}</p>
    {data?.kind === "list" && <RemindersListView items={data.items} disabled={blocked} onDetail={batchId => read({ siteId, mode: "detail", batchId, operationId: null, cursor: null })}/>}
    {data?.kind === "list" && data.nextCursor && <button type="button" className={button} disabled={blocked} onClick={() => read({ siteId, mode: "list", batchId: null, operationId: null, cursor: data.nextCursor })}>读取下一页提醒</button>}
    {detail && <article data-reminder-batch className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold">{categories[detail.category]} · {detail.itemCount} 项 · {detail.readAt ? "已读" : "未读"}</h3><p className="break-all text-xs text-slate-500">窗口 {detail.windowStart} 至 {detail.windowEnd} · 提醒编号 {detail.batchId}</p>
      {detail.items.map(item => { const destination = item.target.kind === "open_session" ? "self" : navigation ? "owner" : "delegate";
        const canOpen = destination === "self" ? !!selfNavigation && !!onOpenSelfSession : destination === "owner"
          ? (item.target.kind === "period_due" ? !!onOpenPeriod : !!onOpenOriginal) : !recoveryOnly && !!onOpenDelegateTarget;
        return <div key={item.planId} className="min-w-0 rounded-xl border p-3"><ReminderTargetView target={item.target} destination={destination}
          canOpen={canOpen} disabled={blocked} onOpen={() => void (destination === "owner" ? openOriginal(item.target) : openRecipient(item.target))}/></div>; })}
      <button type="button" className={button} disabled={!enabled || blocked || detail.readAt !== null} onClick={() => post("mark_read")}>明确标记此提醒已读</button></article>}
    {value?.receipt && <RemindersReceiptView value={value} verified={snapshot.query?.mode === "recover" && !snapshot.pending}/>}
    {nextRun && ownerId === actorId && !recoveryOnly && <button type="button" className={button} disabled={!enabled || blocked} onClick={() => post("run_due", nextRun)}>明确继续检查下一页</button>}
    <p className="text-xs text-slate-500">本人班次须重新核验；受托首次补正只打开原授权选择器，必须明确选用当前授权并读取范围内申请。其他受托类型仍从原工作区读取，提醒不授予权限。手动检查不是自动提醒调度。</p>
  </section>;
}
export function RemindersListView({ items, disabled, onDetail }: { items: readonly AttendanceReminderSummary[]; disabled: boolean; onDetail: (batchId: string) => void }) {
  return <div data-reminder-list className="min-w-0 space-y-3"><p className="text-sm">本页 {items.length} 条，最多 25 条；下一页须明确点击，不会自动加载。</p>
    {items.map(item => <article key={item.batchId} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><p>{categories[item.category]} · {item.itemCount} 项 · {item.readAt ? "已读" : "未读"}</p>
      <p className="break-all text-xs text-slate-500">{item.recordedAt} · {item.batchId}</p><button type="button" className={button} disabled={disabled} onClick={() => onDetail(item.batchId)}>明确读取此提醒详情</button></article>)}</div>;
}
