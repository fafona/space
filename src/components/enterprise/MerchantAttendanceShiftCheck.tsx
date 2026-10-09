"use client";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { SourcesResponse } from "@/lib/merchantAttendanceSources";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceShiftCheckClient } from "@/lib/merchantAttendanceShiftCheckClient";
import { AttendanceShiftCheckAdoptionClient } from "@/lib/merchantAttendancePlanAdoptionViewClient";
import type { ShiftCheckClientState } from "@/lib/merchantAttendanceShiftCheckClient";
import type { ShiftCheckAdoptionClientState } from "@/lib/merchantAttendancePlanAdoptionViewClient";
import PlanAdoptionReceipt from "./MerchantAttendancePlanAdoptionReceipt";
import { formatShiftCheckDuration, type ShiftCheckResponse, type ShiftCheckSpan, type ShiftBreakCheck, type ShiftThresholdCheck } from "@/lib/merchantAttendanceShiftCheck";
import { AttendanceShiftRuleReviewDetail } from "./MerchantAttendanceShiftRuleReview";

export type ShiftCheckProps = { source: SourcesResponse; ownerId: string; apiFetch: AttendanceApiFetch; enabled?: boolean; adoptionEnabled?: boolean };
const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const labels: Readonly<Record<ShiftThresholdCheck["state"], string>> = Object.freeze({
  unavailable: "无法判断：没有可靠固定依据", unconfigured: "无法判断：此项未配置（不是 0）", disabled: "此项已明确停用（不是 0）",
  not_applicable: "此项不适用：原班次已结束", triggered: "本项参考提醒已触发", not_triggered: "本项参考提醒未触发（不代表出勤正常）",
});
const relationReasons: Readonly<Record<string, string>> = Object.freeze({ publication_missing: "当时缺少发布身份依据", cancelled: "上班时计划已取消",
  location_changed: "当时地点与选择不一致", outside_window: "当时选择超出核验日期窗口" });
function displayTime(value: string, zone: string) {
  try { return new Intl.DateTimeFormat("zh-CN", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
  catch { return value; } // Historical zone labels are never reinterpreted for calculations.
}

export default function MerchantAttendanceShiftCheck(props: ShiftCheckProps) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SHIFT_CHECK_ENABLED === "1";
  const adoptionEnabled = props.adoptionEnabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_ENABLED === "1";
  return enabled ? <Lifetime {...props} adoptionEnabled={adoptionEnabled}/> : null;
}
function Lifetime(props: ShiftCheckProps) {
  const [identity, setIdentity] = useState({ source: props.source, ownerId: props.ownerId, apiFetch: props.apiFetch, adoptionEnabled: props.adoptionEnabled, key: 0 });
  // Reset before commit, including same-scope replacement of source/auth fetch.
  if (identity.source !== props.source || identity.ownerId !== props.ownerId || identity.apiFetch !== props.apiFetch || identity.adoptionEnabled !== props.adoptionEnabled) {
    setIdentity({ source: props.source, ownerId: props.ownerId, apiFetch: props.apiFetch, adoptionEnabled: props.adoptionEnabled, key: identity.key + 1 }); return null;
  }
  return <Prepared key={identity.key} {...props}/>;
}
function Prepared({ source, ownerId, apiFetch, adoptionEnabled }: ShiftCheckProps) {
  const client = useMemo(() => { try { return adoptionEnabled ? new AttendanceShiftCheckAdoptionClient({ source, ownerId, apiFetch }) : new AttendanceShiftCheckClient({ source, ownerId, apiFetch }); } catch { return null; } }, [source, ownerId, apiFetch, adoptionEnabled]);
  if (!client) return <section aria-label="单班次独立核查" data-shift-check className="min-w-0 rounded-xl border border-amber-200 p-3">
    <h3 className="font-bold">单班次独立核查</h3><p role="alert">本次员工资料或原始锚点无法核对；请重新读取资料。没有查询其它员工或补算当前规则。</p>
  </section>;
  return <Screen client={client} identityReady={source.worker.employeeId !== null}/>;
}
function Screen({ client, identityReady }: { client: AttendanceShiftCheckClient | AttendanceShiftCheckAdoptionClient; identityReady: boolean }) {
  const state = useSyncExternalStore<ShiftCheckClientState | ShiftCheckAdoptionClientState>(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [selected, setSelected] = useState(""), [shown, setShown] = useState(() => typeof document === "undefined" || !document.hidden);
  const generation = useRef(0);
  useLayoutEffect(() => {
    const invalidate = () => { generation.current++; client.pause(); };
    const hide = () => { invalidate(); setSelected(""); setShown(false); };
    const onHide = () => flushSync(hide);
    const visibility = () => { if (document.hidden) onHide(); else flushSync(() => setShown(true)); };
    const show = () => { if (!document.hidden) flushSync(() => setShown(true)); };
    if (document.hidden) hide();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", onHide); window.addEventListener("pageshow", show);
    return () => { invalidate(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", onHide); window.removeEventListener("pageshow", show); };
  }, [client]);
  const anchor = shown ? client.anchors.find(row => row.startEventId === selected) : undefined;
  const result = shown ? state.result : null;
  const read = async () => {
    if (!shown || document.hidden || !identityReady || !anchor || client.getSnapshot().phase === "loading") return;
    const lease = generation.current; await client.read(anchor.startEventId);
    if (lease !== generation.current) return;
    if (document.hidden) client.pause();
  };
  return <section aria-label="单班次独立核查" data-shift-check className="min-w-0 space-y-3 rounded-xl border border-teal-200 bg-teal-50/30 p-3">
    <h3 className="font-bold">单班次独立核查</h3>
    <p className="text-sm leading-6">按原开班固定依据核查未结束经过时间、单段已结束休息。不是迟到、早退、缺勤、法定休息或工资判定，不改变打卡、审批或工时报表。</p>
    <p className="text-xs leading-6">仅选择原始开班事件；整段漏卡申报不适用。缺少原依据时不采用今天的规则补齐。计划关系只保留当时选择，不自动匹配。</p>
    {!identityReady && <p role="alert">当前员工身份尚未就绪；请重新核对员工资料，此处不发起读取。</p>}
    {identityReady && client.anchors.length === 0 && <p>本次资料没有可选择的原始班次；这不代表缺勤或零工时。</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-[1fr_auto]">
      <label className="min-w-0 text-sm">选择核查原始班次<select aria-label="选择核查原始班次" value={selected} disabled={!shown || !identityReady || !client.anchors.length}
        className="mt-1 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
        onChange={event => { generation.current++; client.invalidate(); setSelected(event.target.value); }}>
        <option value="">请选择原始班次（最多 100 条）</option>
        {shown && identityReady && client.anchors.map((row, index) => <option key={row.startEventId} value={row.startEventId}>{index + 1}. {displayTime(row.original.startAt, row.original.timeZone)} · {row.original.timeZone}</option>)}
      </select></label>
      <button type="button" className={`${button} self-end`} disabled={!shown || !identityReady || !anchor || state.phase === "loading"} onClick={() => { void read(); }}>读取班次核查</button>
    </div>
    <p role="status" className="text-sm">{shown ? state.message : "核查已隐藏；返回后请重新选择并明确读取。"}</p>
    {shown && state.phase === "blocked" && <p role="alert" className="text-sm text-rose-900">{state.message}</p>}
    {result && <AttendanceShiftCheckDetail result={result}/>}
    {result && "fixedReference" in state && state.fixedReference && <PlanAdoptionReceipt {...state.fixedReference}/>}
    <p className="text-xs leading-6">仅按需读取一个班次，不轮询、不重试、不导出、不写浏览器存储。改变选择、资料、身份或隐藏页面后旧核查清除。</p>
  </section>;
}

function Span({ span, title }: { span: ShiftCheckSpan; title: string }) {
  return <div className="min-w-0 space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
    <h5 className="font-semibold">{title}</h5><p>{displayTime(span.startAt, span.timeZone)} → {span.endAt === null ? "未结束" : displayTime(span.endAt, span.timeZone)}</p>
    <p className="break-words text-xs">保存时区：{span.timeZone}。显示时间不参与核查；比较使用原 UTC 微秒。</p>
    <details className="break-all text-xs"><summary className="cursor-pointer">查看完整 UTC 起止</summary><p>{span.startAt} → {span.endAt ?? "没有下班事实（不以读取时间替代）"}</p></details>
  </div>;
}
function Breaks({ rows, span, name }: { rows: readonly ShiftBreakCheck[]; span: ShiftCheckSpan; name: "original" | "approved" }) {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(rows.length / 10)), current = Math.min(page, pages - 1);
  const title = name === "original" ? "原始休息" : "核定休息";
  return <section aria-label={`${title}逐段核查`} data-shift-check-breaks={name} className="min-w-0 space-y-2">
    <h5 className="font-semibold">{title}逐段核查</h5>
    {!rows.length && <p>没有可比较的已结束休息段；不表示没有休息义务。</p>}
    {rows.slice(current * 10, current * 10 + 10).map((row, index) => <article key={`${current}:${index}`} data-shift-check-break data-check-state={row.state} className="min-w-0 space-y-1 rounded-lg border border-slate-200 p-3 text-sm">
      <p className="font-semibold">第 {current * 10 + index + 1} 段 · {row.paid ? "带薪休息" : "非带薪休息"} · {formatShiftCheckDuration(row.durationUs)}</p>
      <p>{labels[row.state]}{row.minutes === null ? "" : `；参考下限 ${row.minutes} 分钟`}</p>
      <details className="break-all text-xs"><summary className="cursor-pointer">核对本段 UTC</summary><p>{row.startAt} → {row.endAt}</p><p>精确时长 {row.durationUs} 微秒；不四舍五入后比较。</p></details>
    </article>)}
    {span.openBreak && <p data-shift-check-open-break className="break-words rounded-lg bg-amber-50 p-3 text-sm">尚未结束的{span.openBreak.paid ? "带薪" : "非带薪"}休息，自 {displayTime(span.openBreak.startAt, span.timeZone)} 开始；不假设结束，不参与已结束单段下限比较。</p>}
    {pages > 1 && <nav aria-label={`${title}分页`} className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" className={button} disabled={!current} onClick={() => setPage(current - 1)}>上一页{title}</button><span>第 {current + 1} / {pages} 页 · 共 {rows.length} 段</span>
      <button type="button" className={button} disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页{title}</button>
    </nav>}
  </section>;
}
export function AttendanceShiftCheckDetail({ result: r }: { result: ShiftCheckResponse }) {
  const open = r.checks.open, rule = r.checks.breakRule, relation = r.relation;
  return <div data-shift-check-detail data-rule-status={r.rule.status} className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-3 text-sm">
    <h4 className="font-bold">本次班次核查</h4>
    <p className="break-words">{r.rule.worker.workerName} · {r.rule.worker.workerNo} · {r.rule.worker.active ? "档案启用" : "档案停用"}</p>
    <p className="break-all text-xs">本次服务器截止 UTC：{r.asOf} · 算法 {r.algorithmVersion}</p>
    <p className="text-xs leading-6">此详情可能包含父资料读取后新增的下班或核定；不刷新父工时合计。当前读取结果没有封账，不是不可变历史签认。</p>
    {!r.moduleEnabled && <p>新考勤已暂停；仍仅展示当前有权限的只读核查。</p>}
    <section aria-label="未结束班次提醒" data-shift-check-open={open.state} className="space-y-2 rounded-lg border border-teal-100 bg-teal-50/30 p-3">
      <h5 className="font-semibold">未结束班次提醒</h5><p>{labels[open.state]}</p>
      {open.minutes !== null && <p>原开班保存阈值：{open.minutes} 分钟；达到或超过才触发。</p>}
      {open.elapsedUs !== null && <p>截至本次读取的经过时间：{formatShiftCheckDuration(open.elapsedUs)}（不是工作时长，不扣休息）。</p>}
    </section>
    <section aria-label="单段已结束休息参考下限" className="space-y-3">
      <h5 className="font-semibold">单段已结束休息参考下限</h5>
      <p>{rule.state === "value" ? `原开班保存下限 ${rule.minutes} 分钟；每段小于才提醒，恰好相等不触发。` : labels[rule.state]}</p>
      <p className="text-xs">paid／unpaid分别保留，不合计成全班休息，不推断法定休息、处罚或工资。</p>
      <div data-shift-check-view="original" className="min-w-0 space-y-3"><Span span={r.original} title="原始班次"/><Breaks rows={r.checks.originalBreaks} span={r.original} name="original"/></div>
      {r.approved && r.effect ? <div data-shift-check-view="approved" className="min-w-0 space-y-3 border-t pt-3">
        <Span span={r.approved} title="最新已批准核定"/>
        <p>核定与原始分别比较，同用原开班固定依据；没有按补正起点重选规则，不替换审批或工时。</p>
        <p className="break-all text-xs">核定修订 {r.effect.revision} · 操作 {r.effect.operationId} · 批准 UTC {r.effect.recordedAt}</p>
        <Breaks rows={r.checks.approvedBreaks ?? []} span={r.approved} name="approved"/>
        <details className="break-all text-xs"><summary className="cursor-pointer">核对批准来源链</summary><p>申请 {r.effect.requestId} · 政策 {r.effect.policyRevision} · 原末事件 {r.effect.originalLastEventId}</p>
          <p>根申请 {r.effect.lineage.rootRequestId} · 根操作 {r.effect.lineage.rootOperationId} · 根时间 {r.effect.lineage.rootRecordedAt} · 前驱 {r.effect.lineage.previousOperationId ?? "首次批准"}</p></details>
      </div> : <p data-shift-check-no-correction>没有批准替换，当前核定沿用原始；不重复统计同一提醒。</p>}
    </section>
    <section aria-label="原选择与计划字面时间差" data-shift-check-plan className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3">
      <h5 className="font-semibold">原选择与计划字面时间差</h5>
      {!relation ? <p>没有已保存的原选择关系；不表示没有排班或缺勤，不用当前时间候选补配。</p> : <>
        <p>{relation.status === "linked" ? "已保存员工上班时明确选择；不是自动时间匹配或现场证明。" : relation.status === "unselected" ? "本次明确不关联排班；不等于没有工作。" : `原选择待核验：${relationReasons[relation.reason ?? ""] ?? "依据不足"}。没有自动换班。`}</p>
        {relation.slot && <><p className="break-words">当时计划：{relation.slot.locationName} · {displayTime(relation.slot.startAt, relation.slot.timeZone)} → {displayTime(relation.slot.endAt, relation.slot.timeZone)} · {relation.slot.timeZone}</p>
          <details className="break-all text-xs"><summary className="cursor-pointer">核对原选择与计划 UTC</summary><p>排班 {relation.slot.id} · 发布版本 {relation.slot.revision} · 保存 {relation.recordedAt}</p><p>{relation.slot.startAt} → {relation.slot.endAt}</p></details></>}
        {relation.currentCancelled && <p>{relation.slot?.cancelled === false ? "该计划后来已取消" : "该计划当前已取消"}；不改写上班时的原选择，也不取消原始打卡。</p>}
      </>}
      {(["original", "approved"] as const).map(name => { const difference = r.plan[name]; return difference && <p key={name} data-shift-check-difference={name} className="break-words">{name === "original" ? "原始" : "核定"}带符号 UTC 差：开始 {formatShiftCheckDuration(difference.startDeltaUs)}；结束 {difference.endDeltaUs === null ? "未结束，不生成差值" : formatShiftCheckDuration(difference.endDeltaUs)}。</p>; })}
      <p className="text-xs leading-6">差值为实际／核定减原计划：正值表示晚于，负值表示早于；不叫迟到或早退。一个计划可以对应多个实际时段，未作整班覆盖或多段分配。请假、日历和计划开始时的规则未用于减免或判断。</p>
    </section>
    <details><summary className="cursor-pointer font-semibold">核对原开班固定依据、来源摘要与版本</summary><div className="mt-3"><AttendanceShiftRuleReviewDetail result={{ ...r.rule, moduleEnabled: r.moduleEnabled }}/></div></details>
    <details className="break-all text-xs"><summary className="cursor-pointer">核对完整原始事件编号</summary><p>原始开班 {r.rule.event.startEventId} · 共 {r.events.length} 个连续事件；完整读取，不按父日期窗口裁剪。</p><p>{r.events.map(event => event.id).join(" · ")}</p></details>
  </div>;
}
