"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AttendancePlanExceptionClient, planExceptionPendingKey } from "@/lib/merchantAttendancePlanExceptionClient";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { PlanExceptionAccess, PlanExceptionOutcome, PlanExceptionResponse } from "@/lib/merchantAttendancePlanExceptionContract";
import type { PlanExceptionSource } from "@/lib/merchantAttendancePlanExceptionSourceContract";
import { canClearPlanException } from "@/lib/merchantAttendancePlanClearance";
import { canMarkPlanExceptionNotApplicable } from "@/lib/merchantAttendancePlanPosthocReview";
import PlanPosthocReviewEvidenceView from "./MerchantAttendancePlanPosthocReviewEvidenceView";
import MerchantAttendancePlanPosthocWorkspace from "./MerchantAttendancePlanPosthocWorkspace";
import { AttendancePlanPosthocClient } from "@/lib/merchantAttendancePlanPosthocClient";
import { ownerNotificationsPorts } from "./MerchantAttendanceOwnerNotificationsPanel";

export type PlanExceptionNotificationTarget = { caseId: string; workerId: string; employeeId: string; employeeAuthUserId: string; slotId: string };
export function planExceptionNotificationMatches(result: PlanExceptionResponse | null, target: PlanExceptionNotificationTarget) {
  const d = result?.detail;
  return !!d && d.caseId === target.caseId && d.slotId === target.slotId && d.worker.workerId === target.workerId
    && d.worker.employeeId === target.employeeId && d.worker.employeeAuthUserId === target.employeeAuthUserId;
}

export type PlanExceptionWorkspaceProps = { siteId: string; access: PlanExceptionAccess; actorId: string; apiFetch: AttendanceApiFetch;
  initialTarget?: { workerId: string; slotId: string }; enabled?: boolean; clearanceEnabled?: boolean; posthocReviewEnabled?: boolean; onClose: () => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void; onOpenCorrections?: () => void;
  expectedNotificationTarget?: PlanExceptionNotificationTarget; isCurrentAuth?: () => boolean };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white p-2 text-sm";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function planPosthocRecoveryTarget(workerId: string, slotId: string) {
  return workerId.length === 36 && slotId.length === 36 && uuid.test(workerId) && uuid.test(slotId) ? { workerId, slotId, recoveryOnly: true as const } : null;
}
const outcomeLabels: Record<PlanExceptionOutcome, string> = { confirmed: "确认异常", excused: "说明后豁免", follow_up: "继续核查", cleared: "核对后未触发本次迟到／早退规则", not_applicable: "整段获批请假，本次迟到／早退不适用" };
const fieldLabels: Record<string, string> = { blocked: "依据不足，未作判断", unconfigured: "未配置，未知", disabled: "明确停用", triggered: "超出已核准宽限", not_triggered: "未超出本项宽限（不代表整体出勤正常）" };
const blockerLabels: Record<string, string> = {
  posthoc_inactive: "事后采用已撤销，不能沿用原处理依据", source_changed: "已采用来源的版本发生变化，需重新核验", source_unavailable: "已采用来源当前不可用",
  approval_missing: "缺少可核验的固定规则核准", leave_context_unknown: "请假资料未完整核验", work_endpoint_missing: "工作时段端点缺失", work_zero_duration: "存在零时长工作时段",
  source_outside_plan: "来源时段与计划无交集", work_leave_overlap: "实际工作与已批准请假重叠，不能自动减免", identity_unproven: "历史身份归属未核实", associated_elsewhere: "来源已关联其他计划", claimed_elsewhere: "来源已被其他计划采用", pending_missing: "漏卡申报尚待审批", sealed: "相关周期已封存",
  work_arrangement_pending: "相关工作安排待审批，需人工核查",
  plan_not_ended: "计划尚未结束", slot_cancelled: "计划已取消", publication_missing: "排班发布依据缺失", worker_inactive: "当前人员未启用",
  no_associated_sessions: "没有明确关联班次（不等于未出勤）", association_unverified: "关联待核验", adoption_missing: "原开班未保存核准引用",
  adoption_unverified: "原核准引用待核验", approval_mismatch: "关联班次的核准依据不一致", session_open: "班次未结束", session_zero_duration: "存在零时长班次",
  session_outside_plan: "班次在计划之外", session_overlap: "关联班次重叠", session_location_mismatch: "地点不一致", context_unknown: "相关资料未完整取得",
  unassociated_session: "存在未纳入明确关联集合的班次", leave_pending: "有待审请假", leave_approved: "有已批准请假，需要人工核对",
  calendar_entry: "有日历提示，需要人工核对", missing_request: "有整段漏卡申报", pending_correction: "有待审补正或再次修订",
};
export function confirmPlanExceptionAction(confirm: () => boolean, current: () => boolean, submit: () => void) {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export function planExceptionOutcomeAllowed(outcome: PlanExceptionOutcome | "", canConclude: boolean, canClear: boolean, clearanceEnabled: boolean, canNotApplicable = false, posthocReviewEnabled = false) {
  return outcome === "follow_up" || (outcome === "confirmed" || outcome === "excused") && canConclude || outcome === "cleared" && clearanceEnabled && canClear || outcome === "not_applicable" && posthocReviewEnabled && canNotApplicable;
}
export function PlanExceptionOutcomeOptions({ canConclude, canClear, clearanceEnabled, canNotApplicable = false, posthocReviewEnabled = false }: { canConclude: boolean; canClear: boolean; clearanceEnabled: boolean; canNotApplicable?: boolean; posthocReviewEnabled?: boolean }) {
  return <><option value="">请选择明确处理</option><option value="follow_up">继续核查</option><option value="confirmed" disabled={!canConclude}>确认异常</option><option value="excused" disabled={!canConclude}>说明后豁免</option>
    {clearanceEnabled && <option value="cleared" disabled={!canClear}>{outcomeLabels.cleared}</option>}{posthocReviewEnabled && <option value="not_applicable" disabled={!canNotApplicable}>{outcomeLabels.not_applicable}</option>}</>;
}
/** An exact-key, local-only recovery affordance. It neither parses employee
 * evidence nor enumerates another workflow's storage. */
export function PlanExceptionEntry({ siteId, access, actorId, enabled, onOpen, disabled = false }: {
  siteId: string; access: PlanExceptionAccess; actorId: string; enabled: boolean; onOpen: () => void; disabled?: boolean;
}) {
  const snapshot = useCallback(() => { try { return sessionStorage.getItem(planExceptionPendingKey(siteId, access, actorId)) !== null; } catch { return true; } }, [siteId, access, actorId]);
  const subscribe = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const recovery = useSyncExternalStore(subscribe, snapshot, () => false);
  if (!enabled && !recovery && access !== "owner") return null;
  return <button type="button" className={button} disabled={disabled} onClick={onOpen}>{!enabled ? access === "owner" ? "按已知人员／排班核对采用原号" : "核对待确认异常处理" : access === "owner" ? "排班异常处理／历史与恢复" : "异常说明与处理结果"}</button>;
}
/* eslint-disable react-hooks/refs -- This exact monotonic notification-scope fence revokes old async/storage authority before effects. An abandoned render can only invalidate a lease; legacy historical/original-ID recovery stays separate. */
export default function MerchantAttendancePlanExceptionWorkspace(props: PlanExceptionWorkspaceProps) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_EXCEPTIONS_ENABLED === "1";
  const clearanceEnabled = props.clearanceEnabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED === "1";
  const posthocReviewEnabled = props.posthocReviewEnabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED === "1";
  const key = JSON.stringify([props.siteId, props.actorId, props.access, props.expectedNotificationTarget ?? null, enabled, clearanceEnabled, posthocReviewEnabled]);
  const live = useRef({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, token: 0 });
  if (live.current.key !== key || live.current.fetch !== props.apiFetch || live.current.auth !== props.isCurrentAuth)
    live.current = { key, fetch: props.apiFetch, auth: props.isCurrentAuth, token: live.current.token + 1 };
  const token = live.current.token;
  const current = useCallback(() => live.current.token === token && props.isCurrentAuth?.() !== false, [token, props.isCurrentAuth]);
  return <Lifetime key={props.expectedNotificationTarget ? token : "legacy"} {...props} isCurrentAuth={props.expectedNotificationTarget ? current : props.isCurrentAuth} enabled={enabled} clearanceEnabled={clearanceEnabled} posthocReviewEnabled={posthocReviewEnabled}/>;
}
/* eslint-enable react-hooks/refs */
function Lifetime(props: PlanExceptionWorkspaceProps & { enabled: boolean; clearanceEnabled: boolean; posthocReviewEnabled: boolean }) {
  const [scope, setScope] = useState({ siteId: props.siteId, access: props.access, actorId: props.actorId, apiFetch: props.apiFetch, enabled: props.enabled, clearanceEnabled: props.clearanceEnabled, posthocReviewEnabled: props.posthocReviewEnabled, key: 0 });
  if (scope.siteId !== props.siteId || scope.access !== props.access || scope.actorId !== props.actorId || scope.apiFetch !== props.apiFetch || scope.enabled !== props.enabled || scope.clearanceEnabled !== props.clearanceEnabled || scope.posthocReviewEnabled !== props.posthocReviewEnabled) {
    setScope({ siteId: props.siteId, access: props.access, actorId: props.actorId, apiFetch: props.apiFetch, enabled: props.enabled, clearanceEnabled: props.clearanceEnabled, posthocReviewEnabled: props.posthocReviewEnabled, key: scope.key + 1 }); return null;
  }
  return <Prepared key={scope.key} {...props}/>;
}
function Prepared(props: PlanExceptionWorkspaceProps & { enabled: boolean; clearanceEnabled: boolean; posthocReviewEnabled: boolean }) {
  const { siteId, access, actorId, apiFetch, enabled, clearanceEnabled, posthocReviewEnabled, expectedNotificationTarget, isCurrentAuth } = props;
  const client = useMemo(() => { try { return new AttendancePlanExceptionClient({ siteId, access, actorId, apiFetch, enabled, clearanceEnabled, posthocReviewEnabled, storage: () => sessionStorage,
    ...(expectedNotificationTarget ? ownerNotificationsPorts(apiFetch, () => sessionStorage, () => isCurrentAuth?.() !== false) : {}) }); } catch { return null; } }, [siteId, access, actorId, apiFetch, enabled, clearanceEnabled, posthocReviewEnabled, expectedNotificationTarget, isCurrentAuth]);
  if (!client) return <section aria-label="排班异常处理"><p role="alert">当前身份无法核对，未读取或提交异常资料。</p><button type="button" className={button} onClick={props.onClose}>返回</button></section>;
  return <Screen {...props} client={client}/>;
}
function Screen({ siteId, access, actorId, apiFetch, initialTarget, enabled, clearanceEnabled, posthocReviewEnabled, onClose, registerLeaveGuard, onOpenCorrections, expectedNotificationTarget, isCurrentAuth, client }: PlanExceptionWorkspaceProps & { enabled: boolean; clearanceEnabled: boolean; posthocReviewEnabled: boolean; client: AttendancePlanExceptionClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [workerId, setWorkerId] = useState(initialTarget?.workerId ?? ""), [slotId, setSlotId] = useState(initialTarget?.slotId ?? "");
  const [operationId, setOperationId] = useState(""), [note, setNote] = useState(""), [outcome, setOutcome] = useState<PlanExceptionOutcome | "">("");
  const [recoveryWorkerId, setRecoveryWorkerId] = useState(""), [recoverySlotId, setRecoverySlotId] = useState("");
  const [shown, setShown] = useState(() => typeof document === "undefined" || !document.hidden);
  const generation = useRef(0), dirty = useRef(false);
  const [posthoc, setPosthoc] = useState<{ workerId: string; slotId: string; recoveryOnly?: boolean } | null>(null);
  const posthocGuard = useRef<(() => boolean) | null>(null);
  const registerPosthocGuard = useCallback((guard: (() => boolean) | null) => { posthocGuard.current = guard; }, []);
  const clearDraft = useCallback(() => { dirty.current = false; setNote(""); setOutcome(""); }, []);
  const leave = useCallback(() => {
    const epoch = generation.current;
    if (posthocGuard.current && !posthocGuard.current()) return false;
    const risk = dirty.current || client.hasLeaveRisk();
    const accepted = (!risk || window.confirm("离开会清除未提交的输入。已发送操作不会撤销，待确认原编号仍保留；请返回后核对。继续吗？")) && epoch === generation.current && isCurrentAuth?.() !== false;
    if (accepted && expectedNotificationTarget) { generation.current++; client.pause(); clearDraft(); }
    return accepted;
  }, [client, isCurrentAuth, expectedNotificationTarget, clearDraft]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useLayoutEffect(() => {
    const invalidate = () => { generation.current++; client.pause(); };
    const clear = () => { invalidate(); clearDraft(); setPosthoc(null); setWorkerId(""); setSlotId(""); setOperationId(""); setRecoveryWorkerId(""); setRecoverySlotId(""); setShown(false); };
    const hide = () => flushSync(clear), show = () => { if (!document.hidden) { flushSync(() => setShown(true)); void client.initialize(); } };
    const visibility = () => { if (document.hidden) hide(); else show(); };
    const unload = (e: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { e.preventDefault(); e.returnValue = ""; } };
    if (document.hidden) clear(); else void client.initialize();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { invalidate(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clearDraft]);
  const notificationMismatch = !!expectedNotificationTarget && !!state.result && !planExceptionNotificationMatches(state.result, expectedNotificationTarget);
  const result = shown && !notificationMismatch ? state.result : null, d = result?.detail, pending = shown ? state.pending : null;
  const busy = state.phase === "loading" || state.phase === "saving", editable = shown && enabled && !busy && !pending;
  const noteValid = note === note.trim() && [...note].length >= 1 && [...note].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(note);
  const read = (action: () => void) => {
    if (!shown || document.hidden || busy || isCurrentAuth?.() === false) return;
    const epoch = generation.current;
    if (dirty.current && !window.confirm("重新读取会清除未提交的说明或处理理由，继续吗？")) return;
    if (epoch !== generation.current || document.hidden) return;
    generation.current++; clearDraft(); action();
  };
  const confirm = (message: string, action: () => void) => {
    const epoch = generation.current, snapshot = client.getSnapshot();
    confirmPlanExceptionAction(() => window.confirm(message), () => shown && !document.hidden && !busy && isCurrentAuth?.() !== false && !notificationMismatch && generation.current === epoch && client.getSnapshot() === snapshot,
      () => { clearDraft(); action(); });
  };
  const canConclude = !!d?.current?.eligible && [d.current.candidate.late.state, d.current.candidate.early.state].includes("triggered");
  const canClear = canClearPlanException(d ?? null), canNotApplicable = canMarkPlanExceptionNotApplicable(d ?? null);
  const posthocWriteAllowed = d?.current?.protocol !== "plan-exception-source-v3" || posthocReviewEnabled;
  const outcomeAllowed = posthocWriteAllowed && planExceptionOutcomeAllowed(outcome, canConclude, canClear, clearanceEnabled, canNotApplicable, posthocReviewEnabled);
  if (posthoc && access === "owner" && shown) return <PosthocScreen key={`${siteId}:${actorId}:${posthoc.workerId}:${posthoc.slotId}:${!!posthoc.recoveryOnly}`} siteId={siteId} actorId={actorId} apiFetch={apiFetch} target={posthoc} recoveryOnly={posthoc.recoveryOnly === true}
    registerLeaveGuard={registerPosthocGuard} onClose={() => { generation.current++; client.invalidate(); clearDraft(); setPosthoc(null); }}/>;
  return <section aria-label={access === "owner" ? "排班异常处理" : "异常说明与处理结果"} data-plan-exception-workspace className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{access === "owner" ? "排班异常处理" : "异常说明与处理结果"}</h2>
      <button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>返回考勤</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">按负责人明确确认的口径处理排班边缘异常；说明本身不减免规则。明确事后采用后，按保存的来源及已核验获批请假计算边缘；日历和工作安排不自动减免。不会改原始打卡、核定工时或工资。继续核查不是确认违规，已读不代表同意。</p>
    {!enabled && <p className="text-sm">新处理入口已关闭；仅可明确核对本标签页原编号。服务器关闭或权限变更时可能暂不可恢复，编号仍保留。</p>}
    <p role="status" aria-live="polite" className="text-sm">{shown ? state.message : "资料已隐藏；返回后需明确重新读取。"}</p>
    {expectedNotificationTarget && <div className="space-y-2 rounded-xl border p-3 text-sm"><p>此入口只核对消息保存的原案件与人员双身份；消息不授予处理权限，原待确认号优先。</p>
      {notificationMismatch && <p role="alert">当前结果与消息保存的原事项或身份不一致，来源正文与操作已隐藏。没有改用新身份重试，也没有删除原编号。</p>}
      <button type="button" className={button} disabled={!editable} onClick={() => read(() => { void client.detail(expectedNotificationTarget.workerId, expectedNotificationTarget.slotId); })}>读取消息原异常当前详情</button></div>}
    {shown && (state.phase === "blocked" || state.phase === "unconfirmed") && <p role="alert" className="text-sm text-amber-900">{state.message}</p>}
    {shown && access === "owner" && <section aria-label="按已知目标恢复采用原号" className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3 text-sm">
      <p>仅核对本标签页已知人员及排班的采用原编号，不读取当前异常依据，不查找其他目标，也不能提交采用或撤销。</p>
      <label className="block">恢复采用的考勤人员编号<input aria-label="恢复采用的考勤人员编号" className={input} value={recoveryWorkerId} disabled={busy} onChange={e => { generation.current++; setRecoveryWorkerId(e.target.value); }}/></label>
      <label className="block">恢复采用的排班编号<input aria-label="恢复采用的排班编号" className={input} value={recoverySlotId} disabled={busy} onChange={e => { generation.current++; setRecoverySlotId(e.target.value); }}/></label>
      <button type="button" className={button} disabled={busy || !planPosthocRecoveryTarget(recoveryWorkerId, recoverySlotId)} onClick={() => {
        const target = planPosthocRecoveryTarget(recoveryWorkerId, recoverySlotId);
        if (target) read(() => { client.pause(); setPosthoc(target); });
      }}>打开该目标的采用原号核对</button>
    </section>}
    {pending && <div data-plan-exception-pending className="min-w-0 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
      <p>本次结果待核验；只能处理原编号，不能换目标或覆盖原内容。离开不会阻止正常打卡或安全下班。</p>
      <p className="break-all">原操作编号：{pending.command.operationId}<br/>考勤人员：{pending.query.workerId}<br/>排班：{pending.query.slotId}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => read(() => { void client.recover(); })}>核对原异常编号</button>
        <button type="button" className={button} disabled={busy || !enabled || "outcome" in pending.command && (pending.command.outcome === "cleared" && !clearanceEnabled || pending.command.outcome === "not_applicable" && !posthocReviewEnabled)} onClick={() => confirm("先查询同一原号；如尚未找到，才重试完全相同的内容，不生成新编号。继续？", () => { void client.retry(); })}>原编号核对并重试</button>
        <button type="button" className={button} disabled={busy} onClick={() => confirm("先重新查询原号；只有成功查询且未找到收据时才结束本地尝试。已保存结果不会撤销。继续？", () => { void client.endAttempt(); })}>结束本次尝试</button></div>
    </div>}
    {enabled && <>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!editable} onClick={() => read(() => { void client.list(); })}>读取异常处理记录</button>
        <button type="button" className={button} disabled={!editable || !result?.nextCursor || state.query?.mode !== "list"} onClick={() => read(() => { void client.next(); })}>下一页处理记录</button></div>
      {access === "owner" && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm">考勤人员编号<input aria-label="异常考勤人员编号" className={input} value={workerId} disabled={!editable} onChange={e => { if (leave()) { generation.current++; clearDraft(); client.invalidate(); setWorkerId(e.target.value); } }}/></label>
        <label className="min-w-0 text-sm">排班编号<input aria-label="异常排班编号" className={input} value={slotId} disabled={!editable} onChange={e => { if (leave()) { generation.current++; clearDraft(); client.invalidate(); setSlotId(e.target.value); } }}/></label>
        <button type="button" className={`${button} sm:col-span-2`} disabled={!editable || !uuid.test(workerId) || !uuid.test(slotId)} onClick={() => read(() => { void client.detail(workerId, slotId); })}>读取本排班当前依据</button>
      </div>}
      {result && !d && !pending && <ul aria-label="异常处理记录" className="space-y-3">{result.items.map(item => <li key={item.caseId} data-plan-exception-case={item.caseId} data-plan-exception-slot={item.slotId} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
        <p className="break-words font-semibold">{item.workerName} · {item.workerNo} · {outcomeLabels[item.latestDecision.outcome]}</p>
        <p className="break-all">计划 UTC {item.slotStartAt} → {item.slotEndAt} · {item.timeZone}</p><p>处理版本 {item.revision} · {item.latestDecision.readAt ? "本人已明确已读" : "本人尚未明确已读"}</p>
        <button type="button" className={button} disabled={!editable} onClick={() => read(() => { setWorkerId(item.workerId); setSlotId(item.slotId); void client.detail(item.workerId, item.slotId); })}>查看说明与处理</button>
      </li>)}</ul>}
      {result && !d && !result.items.length && !pending && <p className="text-sm">本页没有已登记的处理记录；不是没有异常或没有出勤的证明。</p>}
      <details className="min-w-0 text-sm"><summary className="cursor-pointer">按已知原编号核对（不是全文历史检索）</summary>
        {access === "self" && <div className="grid min-w-0 gap-2 sm:grid-cols-2"><label>原考勤人员编号<input aria-label="原异常考勤人员编号" className={input} value={workerId} disabled={!editable} onChange={e => setWorkerId(e.target.value)}/></label><label>原排班编号<input aria-label="原异常排班编号" className={input} value={slotId} disabled={!editable} onChange={e => setSlotId(e.target.value)}/></label></div>}
        <label className="mt-2 block">异常操作编号<input aria-label="异常操作编号" className={input} value={operationId} disabled={!editable} onChange={e => setOperationId(e.target.value)}/></label>
        <button type="button" className={`${button} mt-2`} disabled={!editable || ![workerId, slotId, operationId].every(v => uuid.test(v))} onClick={() => read(() => { void client.recover({ workerId, slotId, operationId }); })}>读取指定异常原号</button>
      </details>
    </>}
    {result && d && <PlanExceptionDetail result={result}/>}
    {result && d && access === "owner" && !expectedNotificationTarget && <button type="button" className={button} disabled={busy || !!pending} data-plan-posthoc-entry
      onClick={() => read(() => { client.pause(); setPosthoc({ workerId: d.worker.workerId, slotId: d.slotId }); })}>事后来源采用／撤销与历史（采用后仍须明确保存结论）</button>}
    {d && enabled && <div className="min-w-0 space-y-3 rounded-xl border border-blue-200 p-3">
      {!result!.moduleEnabled && <p className="text-sm text-amber-900">平台已暂停新操作；只核对现有记录。</p>}
      {access === "owner" ? <>
        {!posthocWriteAllowed && <p role="note" className="text-sm text-amber-900">事后依据的新决定暂未启用；仍可核对已保存结果及原编号。</p>}
        <label className="block text-sm">处理选择<select aria-label="异常处理选择" className={input} value={outcome} disabled={!editable || !d.canDecide || !result!.moduleEnabled || !posthocWriteAllowed}
          onChange={e => { generation.current++; dirty.current = true; setOutcome(e.target.value as PlanExceptionOutcome | ""); }}><PlanExceptionOutcomeOptions canConclude={canConclude} canClear={canClear} clearanceEnabled={clearanceEnabled} canNotApplicable={canNotApplicable} posthocReviewEnabled={posthocReviewEnabled}/></select></label>
        {!canConclude && <p className="text-sm">当前不能确认异常或豁免。{canNotApplicable ? "整段获批请假，可在启用后明确保存本次规则不适用。" : clearanceEnabled && canClear ? "本案两项均未触发，可明确核对后结案。" : "当前仅可在允许时记录继续核查。"}</p>}
        {clearanceEnabled && <p data-plan-clearance-boundary className="text-sm">新结案只用于已有案件、完整依据且迟到和早退两项均未触发；包含仍在已核准宽限内的情况，不声称实际没有晚到或提前离开，不代表整班全部出勤正常。未配置、停用或其他阻断不能据此结案；未明确采用的来源不自动纳入，不改变周期争议和旧保存版本。</p>}
        {canNotApplicable && <p data-plan-not-applicable-boundary className="text-sm">整段请假是独立的“不适用”，不是“正常出勤”或“两项未触发”。实际工作与请假重叠、待审或资料不明时不可使用，不自动改工时、年假余额或工资。</p>}
      </> : <p className="text-sm">说明关联当前所见处理编号；不自动更改决定。若实际时间有误，请使用原补正申请路径。</p>}
      <label className="block text-sm">{access === "owner" ? "处理理由（员工可见）" : "本人说明"}<textarea aria-label={access === "owner" ? "异常处理理由" : "异常本人说明"} className={input} rows={3} maxLength={500} value={note}
        disabled={!editable || !result!.moduleEnabled || (access === "owner" ? !d.canDecide : !d.canNote)} onChange={e => { generation.current++; dirty.current = true; setNote(e.target.value); }}/></label>
      <p className="text-xs">1–500 字，不自动修剪。提交后保存原编号，依据变化须重新核查，原处理历史仍保留。</p>
      {access === "owner" ? <button type="button" className={button} disabled={!editable || !result!.moduleEnabled || !d.canDecide || !outcome || !noteValid || !outcomeAllowed}
        onClick={() => { if (outcome && outcomeAllowed) confirm(`确认“${outcomeLabels[outcome]}”？理由会向本人公开。服务器会重新核对依据；不自动修改工时、请假或工资。${outcome === "cleared" ? "仅本次两项规则未触发（可能仍在宽限内），不等于整班正常或周期确认；后续说明或来源变化仍须重新核查。" : ""}`, () => { void client.decide(outcome, note); }); }}>确认保存异常处理</button>
        : <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!editable || !result!.moduleEnabled || !d.canNote || !noteValid}
          onClick={() => confirm("确认提交这份本人说明？它不会自动改变处理决定、打卡或工时。", () => { void client.note(note); })}>提交本人说明</button>
          <button type="button" className={button} disabled={!editable || !result!.moduleEnabled || !d.canNote || !d.latestDecision || d.latestDecision.readAt !== null || note.length > 0}
            onClick={() => confirm("明确标记已阅读这份处理结果？已读不代表同意、工资确认或放弃争议。", () => { void client.ack(); })}>{d.latestDecision?.readAt ? "本决定已明确已读" : "明确已读处理结果"}</button>
        </div>}
    </div>}
    {access === "self" && onOpenCorrections && <button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onOpenCorrections(); } }}>打开我的补正申请</button>}
    <p className="text-xs leading-6">只保留当前页，不轮询。仅本标签页保存小型待确认命令，不保存依据正文；关闭标签页、清理存储或换设备不能保证恢复。隐藏、换身份或权限失效立即清屏。历史处理不是周期签认、缺勤或工资结论。</p>
    <details className="break-all text-xs"><summary>核对当前工作区身份</summary>{siteId} · {access} · {actorId}</details>
  </section>;
}
function PosthocScreen({ siteId, actorId, apiFetch, target, recoveryOnly = false, onClose, registerLeaveGuard }: {
  siteId: string; actorId: string; apiFetch: AttendanceApiFetch; target: { workerId: string; slotId: string }; onClose: () => void;
  recoveryOnly?: boolean;
  registerLeaveGuard: (guard: (() => boolean) | null) => void;
}) {
  const enabled = !recoveryOnly && process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_POSTHOC_ENABLED === "1";
  const client = useMemo(() => new AttendancePlanPosthocClient({ siteId, actorId, ...target, apiFetch, enabled, storage: () => sessionStorage }), [siteId, actorId, target, apiFetch, enabled]);
  return <MerchantAttendancePlanPosthocWorkspace siteId={siteId} actorId={actorId} {...target} enabled={enabled} recoveryOnly={recoveryOnly} client={client} onClose={onClose} registerLeaveGuard={registerLeaveGuard}/>;
}
export function PlanExceptionDetail({ result }: { result: PlanExceptionResponse }) {
  const d = result.detail; if (!d) return null;
  const evidence = d.current ?? d.latestDecision?.evidence;
  const currentPosthoc = d.current?.protocol === "plan-exception-source-v3" ? d.current : null;
  const savedPosthoc = d.latestDecision?.evidence.policy === "owner-confirmed-plan-edges-posthoc-v3" ? d.latestDecision.evidence : null;
  const notApplicable = currentPosthoc?.state === "not_applicable" || !d.current && savedPosthoc?.evaluation.state === "not_applicable";
  return <div data-plan-exception-detail className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3">
    <h3 className="break-words font-bold">{d.worker.workerName} · {d.worker.workerNo} · 处理版本 {d.revision}</h3>
    <p className="break-all text-xs">排班 {d.slotId} · 员工 {d.worker.employeeId} · 考勤档案 {d.worker.workerId}</p>
    {d.currentValidation === "not_checked" ? <p role="note" className="rounded-lg bg-amber-50 p-2 text-sm">当前依据未重新核查。这里展示保存时的处理结果，不声称它仍适用于当前资料；已读不等于认可。</p>
      : <p className="text-sm">当前依据已重新读取。{d.stale ? "历史决定与当前依据已不同，请重新核查；没有自动沿用或删除原决定。" : d.latestDecision ? "所示历史决定仍保留，是否重新处理须由负责人明确选择。" : "尚无保存的处理决定。"}</p>}
    {d.latestDecision && <article data-plan-exception-decision className="min-w-0 space-y-2 rounded-lg bg-blue-50 p-3 text-sm">
      <strong>{outcomeLabels[d.latestDecision.outcome]}</strong><p className="whitespace-pre-wrap break-words">{d.latestDecision.note}</p>
      {d.latestDecision.outcome === "cleared" && <p data-plan-exception-cleared>这是保存当时两项规则均未触发的核对结果，包含在已核准宽限内的情况；不声称实际没有晚到或提前离开，也不代表整班全部出勤正常、工资或周期确认。后续说明或来源变化仍须重新核查。</p>}
      {d.latestDecision.outcome === "not_applicable" && <p data-plan-exception-not-applicable>保存时获批请假覆盖整段计划且无工作冲突，本次迟到／早退不适用；不是正常出勤或工资结论。请假撤销、来源变化或新增说明后仍须核查。</p>}
      <p className="break-all text-xs">原决定 {d.latestDecision.operationId} · 版本 {d.latestDecision.revision} · 保存 UTC {d.latestDecision.recordedAt}</p>
      <p className="text-xs">{d.latestDecision.readAt ? `本人明确已读 UTC ${d.latestDecision.readAt}` : "本人尚未明确已读；未读不等于拒绝，沉默不作同意。"}</p>
    </article>}
    {d.latestDecision && d.revision > d.latestDecision.revision && <p role="note" data-plan-exception-newer-note className="rounded-lg bg-amber-50 p-2 text-sm">该决定之后有新的本人说明，尚待负责人再次处理；已读不会代替处理或周期确认。</p>}
    {evidence && <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">{(["late", "early"] as const).map(key => { const f = evidence.candidate[key]; return <article key={key} data-plan-exception-field={key} data-rule-state={f.state} className="min-w-0 rounded-lg border p-3 text-sm">
        <h4 className="font-semibold">{key === "late" ? "计划开始边缘" : "计划结束边缘"}</h4><p>{notApplicable ? "整段获批请假，本项不适用" : fieldLabels[f.state] ?? "需要核对"}</p><p>宽限：{f.minutes === null ? "未配置／不适用" : `${f.minutes} 分钟`}</p>
        <p className="break-all text-xs">原始差值（微秒）：{f.rawDeltaUs ?? "未知"}；超出宽限（微秒）：{f.excessUs ?? "未知"}</p>
      </article>; })}</div>
      {!!evidence.blockers.length && <ul aria-label="异常依据限制" className="list-disc space-y-1 pl-5 text-sm">{evidence.blockers.map(b => <li key={b}>{blockerLabels[b] ?? b}</li>)}</ul>}
      <details className="min-w-0 break-all text-xs"><summary className="cursor-pointer">核对依据指纹与边界</summary>
        <p>指纹 {evidence.fingerprint}</p><p>原始 UTC {evidence.candidate.original.startAt ?? "未知"} → {evidence.candidate.original.endAt ?? "未知"}</p>
        <p>核定 UTC {evidence.candidate.selected.startAt ?? "未知"} → {evidence.candidate.selected.endAt ?? "未知"}</p>
        <p>读取 UTC {result.readAt}；保存处理依据仅为紧凑引用，不是完整来源封存。</p>
      </details>
      {currentPosthoc && <PlanPosthocReviewEvidenceView state={currentPosthoc.state} posthoc={currentPosthoc.source.evaluation.posthoc} observations={currentPosthoc.source.evaluation.observations} leaveEdges={currentPosthoc.leaveEdges} saved={false}/>}
      {!d.current && savedPosthoc && <PlanPosthocReviewEvidenceView {...savedPosthoc.evaluation} saved/>}
      {d.current ? <Context value={d.current.protocol === "plan-exception-source-v3" ? d.current.source.evaluation.basis : d.current.source} posthoc={!!currentPosthoc} key={`${d.slotId}:${d.current.fingerprint}`}/>
        : d.latestDecision && <section aria-label="保存时的相关资料引用" className="space-y-1 text-xs"><h4 className="font-semibold">保存时的相关资料引用</h4>
          {Object.entries(d.latestDecision.evidence.contextRefs).map(([name, section]) => <p key={name}>{contextLabels[name]}：{section.limited ? "当时未完整取得，不能当作没有" : `${section.items.length} 项引用（正文未封存，当前未重查）`}</p>)}
        </section>}
    </>}
    <History entries={d.history} truncated={d.historyTruncated} key={`${d.slotId}:${d.revision}:${result.readAt}`}/>
  </div>;
}
const contextLabels: Record<string, string> = { workArrangements: "出差／外勤／远程安排（不自动减免）", unassociated: "未纳入关联集合的班次", leave: "请假", calendar: "日历", missing: "整段漏卡申报", pendingCorrections: "待审补正／再次修订" };
function Context({ value, posthoc = false }: { value: PlanExceptionSource; posthoc?: boolean }) {
  const rows = Object.entries(value.context).map(([key, s]) => ({ key, limited: s.limited, rows: s.items.map(item => {
    const id = "requestId" in item ? item.requestId : "entryId" in item ? item.entryId : item.startEventId;
    const times = "original" in item ? `原始 ${item.original.startAt ?? "未知"} → ${item.original.endAt ?? "未知"}；核定 ${item.selected.startAt ?? "未知"} → ${item.selected.endAt ?? "未知"}`
      : "fromAt" in item ? `${item.fromAt} → ${item.toAt} · ${item.timeZone}` : `${item.startAt} → ${item.endAt}`;
    return { id, text: `${"status" in item ? item.status : "kind" in item ? item.kind : "班次"} · ${times} · 原操作 ${"history" in item ? item.history.at(-1)?.operationId ?? "未知" : item.operationId}` };
  }) }));
  return <section aria-label="本次人工核对资料" className="min-w-0 space-y-2"><h4 className="font-semibold">本次人工核对资料（不自动减免）</h4>
    <p className="text-xs">{posthoc ? "以下是原始基础来源；明确采用及获批请假后的边缘见上方独立区域。日历和工作安排不自动减免，未关联班次不是缺勤。" : "请假、日历、漏卡及工作安排仅作为核查依据；未关联班次不是缺勤。本轮原始、核定均按原班次锚点展示。"}</p>
    {rows.map(s => <ContextSection key={s.key} title={contextLabels[s.key]} limited={s.limited} rows={s.rows}/>)}
    <details className="min-w-0 break-all text-xs"><summary>本排班采用的固定核准引用</summary>{value.approval
      ? <p>核准 {value.approval.operationId} · 版本 {value.approval.revision} · 来源 {value.approval.sourceId} · 摘要 {value.approval.sourceSha256}</p>
      : <p>没有可用的共同固定核准引用，不用当前规则补造。</p>}</details>
  </section>;
}
function ContextSection({ title, limited, rows }: { title: string; limited: boolean; rows: { id: string; text: string }[] }) {
  const [page, setPage] = useState(0), pages = Math.ceil(rows.length / 10);
  return <details className="min-w-0 rounded-lg border p-2 text-xs"><summary className="cursor-pointer">{title} · {limited ? "未完整取得" : `${rows.length} 项`}</summary>
    {limited ? <p>本项资料未完整取得，不能认为没有相关记录。</p> : <><ul className="mt-2 space-y-2">{rows.slice(page * 10, page * 10 + 10).map(r => <li key={r.id} className="break-all">{r.id}<br/>{r.text}</li>)}</ul>
      {pages > 1 && <nav aria-label={`${title}本地分页`} className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {pages}</span><button type="button" className={button} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页</button></nav>}</>}
  </details>;
}
function History({ entries, truncated }: { entries: NonNullable<PlanExceptionResponse["detail"]>["history"]; truncated: boolean }) {
  const [page, setPage] = useState(0), pages = Math.ceil(entries.length / 10);
  return <section aria-label="异常处理历史" className="min-w-0 space-y-2"><h4 className="font-semibold">保存的处理与说明</h4>
    {truncated && <p className="text-sm">这里只返回最近一部分历史，不代表全部操作。</p>}
    <ol className="space-y-2">{entries.slice(page * 10, page * 10 + 10).map(e => <li key={e.operationId} className="min-w-0 rounded-lg bg-slate-50 p-3 text-sm">
      <p>版本 {e.revision} · {e.kind === "decision" && e.outcome ? outcomeLabels[e.outcome] : "本人说明"}</p><p className="whitespace-pre-wrap break-words">{e.note}</p><p className="break-all text-xs">原号 {e.operationId} · 保存 UTC {e.recordedAt}</p>
    </li>)}</ol>{pages > 1 && <nav aria-label="处理历史本地分页" className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!page} onClick={() => setPage(page - 1)}>上一页历史</button><span>{page + 1} / {pages}</span><button type="button" className={button} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页历史</button></nav>}
  </section>;
}
