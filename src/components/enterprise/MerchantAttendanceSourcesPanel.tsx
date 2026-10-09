"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AttendanceSourcesClient } from "@/lib/merchantAttendanceSourcesClient";
import type { SourcesResponse } from "@/lib/merchantAttendanceSources";
import type { AttendanceSourcesPanelProps } from "./MerchantAttendanceSourcesLauncher";
import RuleResolution from "./MerchantAttendanceRuleResolution";
import ScheduleEvidence from "./MerchantAttendanceScheduleEvidence";
import ShiftRuleReview from "./MerchantAttendanceShiftRuleReview";
import ShiftCheck from "./MerchantAttendanceShiftCheck";
import PlanCoverage from "./MerchantAttendancePlanCoverage";
import PlanRuleApprovals from "./MerchantAttendancePlanRuleApprovals";
const PlanExceptionWorkspace = lazy(() => import("./MerchantAttendancePlanExceptionWorkspace"));
type ExceptionTarget = { workerId: string; slotId: string };
type PanelProps = AttendanceSourcesPanelProps & { onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm";
const visibilitySnapshot = () => document.visibilityState !== "hidden";
const serverVisibility = () => false;
const subscribeVisibility = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};
const statuses: Record<string, string> = { assigned: "原归组", ended: "已设结束日期", cancelled: "已取消", submitted: "待审批", approved: "已批准", withdrawn: "已撤回", rejected: "已拒绝", created: "已记录" };
const warningLabels: Record<string, string> = {
  candidate_rules_not_applied: "候选规则尚未应用，不能据此判定迟到、早退或缺勤。",
  historical_context_not_pinned: "这是当前资料读取，不是已封存的历史计算版本。",
  personal_exceptions_not_supported: "已审批个人规则例外尚未接入，不能视为没有个人例外。",
  assignment_identity_changed: "部分归组的历史员工身份与当前档案不同，需要人工核对。",
  leave_identity_changed: "部分请假的原员工身份与当前档案不同，需要人工核对。",
  assignment_utc_overlap: "归组日期按各自时区换算后存在时间重叠，不能自动选取其中一组。",
  identity_changed: "部分历史来源保存的员工身份与当前档案不同，需要人工核对，不能按姓名自动合并。",
  assignments_truncated: "归组来源超过读取上限，尚不能确认完整归属。",
  rules_truncated: "候选规则来源未完整取得，不能自动采用某个版本。",
  schedule_truncated: "排班来源超过读取上限，不能据此认定没有排班。",
  leave_truncated: "请假来源超过读取上限，不能据此认定没有请假。",
  calendar_truncated: "日历或地点来源未完整取得，不能据此认定没有提示。",
};

export default function MerchantAttendanceSourcesPanel(props: PanelProps) {
  return <Screen key={`${props.siteId}:${props.ownerId}:${props.workerId}`} {...props}/>;
}
function Screen({ siteId, ownerId, workerId, apiFetch, onClose, registerLeaveGuard }: PanelProps) {
  const client = useMemo(() => new AttendanceSourcesClient({ siteId, ownerId, workerId, apiFetch }), [siteId, ownerId, workerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [fromDate, setFrom] = useState(""), [throughDate, setThrough] = useState("");
  const [exceptionScope, setExceptionScope] = useState<{ target: ExceptionTarget | null; apiFetch: typeof apiFetch }>({ target: null, apiFetch });
  const exceptionTarget = exceptionScope.apiFetch === apiFetch ? exceptionScope.target : null;
  const setExceptionTarget = useCallback((target: ExceptionTarget | null) => setExceptionScope({ target, apiFetch }), [apiFetch]);
  const workflowGuard = useRef<(() => boolean) | null>(null);
  const registerWorkflowGuard = useCallback((guard: (() => boolean) | null) => { workflowGuard.current = guard; }, []);
  const mayLeave = useCallback(() => !workflowGuard.current || workflowGuard.current(), []);
  useLayoutEffect(() => { registerLeaveGuard?.(mayLeave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, mayLeave]);
  const visible = useSyncExternalStore(subscribeVisibility, visibilitySnapshot, serverVisibility);
  useLayoutEffect(() => {
    const hide = () => { setFrom(""); setThrough(""); setExceptionTarget(null); client.pause(); };
    const hidden = () => flushSync(hide);
    const visibility = () => { if (document.visibilityState === "hidden") hidden(); };
    if (document.visibilityState === "hidden") client.pause();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hidden);
    return () => { client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hidden); };
  }, [client, setExceptionTarget]);
  const result = visible ? state.result : null;
  return <section aria-label="单员工资料核查" className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">员工考勤资料核查</h2><p className="mt-1 text-sm text-slate-600">仅负责人 · 单员工 · 最多 7 个当地日期 · 资料只读核查</p></div><button type="button" className={button} onClick={() => { if (mayLeave()) onClose(); }}>关闭资料核查</button></header>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6">原始打卡、已批准补正、整段漏卡申报、排班、请假和日历提示分别展示。开放的独立班次核查仅提示未结束时长与单段休息参考阈值；计划关联核对仅比较明确关联的上下班跨度。资料核查本身不作迟到、早退、缺勤或工资判定，不阻止打卡。独立开放的排班规则核准只保存本计划依据；异常处理须进入独立操作、重新读取依据并明确确认，不自动修改原记录。</p>
    <p className="break-all text-xs text-slate-600">当前考勤档案编号：{workerId}。姓名只用于展示，不用来关联不同来源。</p>
    <form className="grid min-w-0 gap-3 sm:grid-cols-3" onSubmit={event => { event.preventDefault(); if (visible && mayLeave()) { setExceptionTarget(null); void client.read(fromDate, throughDate); } }}>
      <label className="min-w-0 text-sm">开始日期<input aria-label="核查开始日期" type="date" className={input} min="2000-01-01" max="2100-12-31" value={fromDate} disabled={!visible}
        onChange={event => { if (mayLeave()) { setExceptionTarget(null); client.invalidate(); setFrom(event.target.value); } }}/></label>
      <label className="min-w-0 text-sm">结束日期<input aria-label="核查结束日期" type="date" className={input} min="2000-01-01" max="2100-12-31" value={throughDate} disabled={!visible}
        onChange={event => { if (mayLeave()) { setExceptionTarget(null); client.invalidate(); setThrough(event.target.value); } }}/></label>
      <button type="submit" className={`${button} self-end`} disabled={!visible || !fromDate || !throughDate || state.phase === "loading"}>读取核查资料</button>
    </form>
    <p role="status" className="text-sm leading-6">{visible ? state.message : "资料已隐藏；返回后不会自动读取。"}</p>
    {state.phase === "blocked" && visible && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">{state.message}</p>}
    {exceptionTarget && visible ? <Suspense fallback={<p role="status">正在加载异常处理…</p>}><PlanExceptionWorkspace siteId={siteId} access="owner" actorId={ownerId} apiFetch={apiFetch}
      initialTarget={exceptionTarget} registerLeaveGuard={registerWorkflowGuard} onClose={() => { setExceptionTarget(null); client.invalidate(); }}/></Suspense>
      : result && <Evidence result={result} ownerId={ownerId} apiFetch={apiFetch} onOpenException={setExceptionTarget}/>}
    <p className="text-xs leading-6 text-slate-600">资料核查不轮询、不导出；独立核准与异常处理仅在本标签页保存小型待核验命令，不保存来源或报表。改日期、隐藏、关闭、切换人员或身份后旧资料清除，已发送操作不撤销，原号仍待核验；返回需重新选择并读取。当前查询不是可重放的历史快照。</p>
  </section>;
}

function Coverage({ title, limited, count, children }: { title: string; limited: boolean; count: number; children: ReactNode }) {
  return <section aria-label={title} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3">
    <h3 className="font-bold">{title}</h3>
    {limited ? <p className="rounded-lg bg-amber-50 p-3 text-sm">资料未完整取得，不能判定没有记录。请缩短范围或继续核对来源；此处不展示被截断的部分列表。</p>
      : <><p className="text-sm text-slate-600">本次范围返回 {count} 条；数量不是正常、缺勤或异常结论。</p>{children}</>}
  </section>;
}
function Evidence({ result: r, ownerId, apiFetch, onOpenException }: { result: SourcesResponse; onOpenException: (target: ExceptionTarget) => void } & Pick<AttendanceSourcesPanelProps, "ownerId" | "apiFetch">) {
  const report = r.attendance;
  return <div data-attendance-sources-result className="min-w-0 space-y-4">
    <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold">当前档案</dt><dd>{r.worker.workerName} · {r.worker.workerNo} · {r.worker.active ? "启用" : "停用"} · 版本 {r.worker.version}</dd></div>
      <div><dt className="font-semibold">查询范围与企业时区</dt><dd>{r.fromDate} — {r.throughDate} · {r.timeZone} · 设置版本 {r.settingsVersion}</dd></div>
      <div className="break-all"><dt className="font-semibold">UTC 半开区间</dt><dd>{r.fromAt} 至 {r.toAt}（不含结束时刻）</dd></div>
      <div className="break-all"><dt className="font-semibold">本次服务器读取时间</dt><dd>{r.readAt}</dd></div>
    </dl>
    {!r.moduleEnabled && <p className="rounded-xl bg-amber-50 p-3 text-sm">新考勤已暂停；本页只核查当前仍有权限读取的资料。</p>}
    <section aria-label="资料边界" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><h3 className="font-bold">资料边界</h3>
      <ul className="mt-2 list-disc space-y-2 pl-5">{r.warnings.map(warning => <li key={warning}>{warningLabels[warning] ?? `该来源需要进一步核对：${warning}`}</li>)}</ul>
    </section>
    <RuleResolution source={r}/>
    <ScheduleEvidence source={r}/>
    <ShiftRuleReview source={r} ownerId={ownerId} apiFetch={apiFetch}/>
    <ShiftCheck source={r} ownerId={ownerId} apiFetch={apiFetch}/>
    <PlanCoverage source={r} ownerId={ownerId} apiFetch={apiFetch} onOpenException={onOpenException}/>
    <PlanRuleApprovals source={r} ownerId={ownerId} apiFetch={apiFetch}/>
    <Coverage title="打卡与核定来源" limited={false} count={report.base.rows.length + report.missing.length}>
      <p className="text-sm text-slate-600">原始记录、已批准补正与整段漏卡分列；未结束班次不折算为零工时。</p>
      <p className="break-all text-xs text-slate-600">原始资料截至：{report.base.asOf}。{report.base.periodInProgress ? "查询日期尚未全部结束，资料仍可能增加；空列表不代表缺勤。" : "当前核定仍可能因后续批准而变化。"}</p>
      {report.base.rows.map(row => <article key={row.startEventId} className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
        <p className="font-semibold">{row.source === "approved" ? "原始打卡 + 已批准补正" : "原始打卡"}{row.selected.endAt === null ? " · 班次未结束" : ""}</p>
        <p className="break-all">原始：{row.original.startAt} → {row.original.endAt ?? "未结束"}</p>
        {row.correction && <p className="break-all">当前核定：{row.selected.startAt} → {row.selected.endAt ?? "未结束"} · 核定版本 {row.correction.revision}</p>}
        <p className="break-all text-xs text-slate-600">来源起点 {row.startEventId} · 末事件 {row.lastEventId}{row.correction ? ` · 核定操作 ${row.correction.operationId}` : ""}</p>
      </article>)}
      {report.missing.map(row => <article key={row.requestId} className="space-y-2 rounded-lg bg-blue-50 p-3 text-sm"><p className="font-semibold">已批准整段漏卡申报（不是原始打卡）</p>
        <p className="break-all">{row.proposal.startAt} → {row.proposal.endAt} · {row.locationName}</p><p className="break-all text-xs">申请 {row.requestId} · 批准操作 {row.operationId}</p></article>)}
    </Coverage>
    <Coverage title="排班来源" limited={r.schedule.limited} count={r.schedule.items.length}>
      {r.schedule.items.map(item => <article key={item.id} className="rounded-lg bg-slate-50 p-3 text-sm"><p>{item.cancelled ? "已取消排班" : "已发布排班"} · {item.locationName} · 发布版本 {item.revision}</p>
        <p className="break-all">{item.startAt} → {item.endAt} · {item.timeZone}</p><p className="break-all text-xs text-slate-600">{item.id}</p></article>)}
    </Coverage>
    <Coverage title="请假来源" limited={r.leave.limited} count={r.leave.items.length}>
      {r.leave.items.map(item => <article key={item.summary.requestId} className="rounded-lg bg-slate-50 p-3 text-sm"><p>{statuses[item.summary.status]} · {item.summary.workerName} · 版本 {item.summary.revision}</p>
        <p className="break-all">{item.summary.startAt} → {item.summary.endAt} · {item.summary.timeZone}</p><p className="break-all text-xs text-slate-600">申请 {item.summary.requestId} · 最后操作 {item.operationId}</p></article>)}
    </Coverage>
    <Coverage title="归组来源" limited={r.assignments.limited} count={r.assignments.items.length}>
      {r.assignments.items.map(({ detail, currentGroup, fromAt, toAt }) => <article key={detail.assignmentId} className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm"><p>{detail.groupName} · {statuses[detail.status]} · 归组版本 {detail.revision}</p>
        <p>{detail.startsOn} — {detail.endsOn ?? "未设结束日"} · 原时区 {detail.timeZone}</p><p>当前组：{currentGroup.name} · {currentGroup.active ? "启用" : "停用"} · 版本 {currentGroup.revision}；不代替原归组快照</p>
        <p className="break-all">当前投影 UTC：{fromAt} → {toAt ?? "未设结束"}。原归组曾覆盖本查询，不表示结束／取消后仍适用于本区间。</p>
        <details><summary>核对归组生命周期来源</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(detail.history, null, 2)}</pre></details></article>)}
    </Coverage>
    <Coverage title="候选规则来源（未应用）" limited={r.rules.limited} count={r.rules.items.length}>
      {r.rules.items.map(stream => <article key={stream.groupId ?? "enterprise"} className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm"><p className="break-all">{stream.groupId ? `考勤组 ${stream.groupId}` : "企业默认层"} · 账本版本 {stream.revision}</p>
        {!stream.publications.length && <p>此目标在本次区间没有关联候选发布；不能擅自采用默认阈值。</p>}
        {stream.publications.map(item => <details key={item.revision}><summary>候选发布 {item.revision} · {item.effectiveOn} · {item.timeZone}</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(item, null, 2)}</pre></details>)}</article>)}
    </Coverage>
    <Coverage title="日历提示来源" limited={r.calendar.limited} count={r.calendar.items.length}>
      <p className="text-sm text-slate-600">企业提示与实际来源涉及地点的提示；不使用当前默认地点推断历史地点，也不自动免除排班或异常。</p>
      {r.calendar.items.map(item => <article key={item.entryId} className="rounded-lg bg-slate-50 p-3 text-sm"><p>{item.title} · {item.locationName ?? "企业范围"} · {statuses[item.status]}</p>
        <p>{item.fromDate} — {item.throughDate} · {item.timeZone}</p></article>)}
    </Coverage>
  </div>;
}
