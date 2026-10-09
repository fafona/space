"use client";
import { useId, useMemo, useState, type ReactNode } from "react";
import { resolveAttendanceScheduleEvidence, type ScheduleEvidenceRecord, type ScheduleEvidenceRelation,
  type ScheduleEvidenceResult, type ScheduleEvidenceSlot, type ScheduleEvidenceView } from "@/lib/merchantAttendanceScheduleEvidence";
import { formatAttendanceTimesheetDuration } from "@/lib/merchantAttendanceTimesheetDisplay";
import type { SourcesResult } from "@/lib/merchantAttendanceSources";

const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const relations: Record<ScheduleEvidenceRelation, string> = {
  "schedule-limited": "排班来源不完整，候选未知",
  "outside-window": "该版本区间在查询窗口之外，仍保留来源",
  "zero-duration": "零时长记录：保留时间点，不产生正区间候选",
  "no-time-candidate": "未见时间相交候选，不代表缺勤",
  "one-time-candidate": "一条时间相交候选，不代表已匹配",
  ambiguous: "存在多条时间关系，不能自动配对",
};
const reasons: Record<string, string> = {
  record_crosses_window: "记录跨越查询边界，当前窗口不足以核对整个班次。",
  schedule_crosses_window: "候选排班跨越查询边界，需要窗口外资料。",
  open_record: "记录尚未结束；观察截至时间不是下班时间。",
  schedule_not_ended: "候选排班尚未结束，不能提前作结论。",
  identity_changed: "来源保存的员工身份与当前档案不同，需人工核对。",
  leave_limited: "请假资料不完整，不能视为没有请假。",
  calendar_limited: "日历资料不完整，不能视为没有提示。",
  inactive_worker: "当前档案已停用；仅保留来源核对。",
  multiple_temporal_candidates: "一条记录可能跨多个排班，一个排班也可能涉及多条记录。",
};
const leaveStatuses = { submitted: "待审批", withdrawn: "已撤回", approved: "已批准", rejected: "已拒绝", cancelled: "已取消" };

function Range({ start, end, zone }: { start: string; end: string | null; zone?: string }) {
  return <p className="break-all text-xs leading-6">UTC：<time>{start}</time> → {end === null ? "未结束（未知，不计作 0）" : <time>{end}</time>}{zone && <> · 保存时区 {zone}</>}</p>;
}
function Pages<T>({ items, label, itemKey, children }: { items: readonly T[]; label: string; itemKey: (item: T) => string; children: (item: T) => ReactNode }) {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(items.length / 10)), current = Math.min(page, pages - 1);
  return <>
    <div className="min-w-0 space-y-3">{items.slice(current * 10, current * 10 + 10).map(item => <div key={itemKey(item)} className="min-w-0">{children(item)}</div>)}</div>
    {pages > 1 && <nav aria-label={`${label}分页`} className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <button type="button" className={button} disabled={current === 0} onClick={() => setPage(current - 1)}>上一页{label}</button>
      <span>第 {current + 1} / {pages} 页 · 每页最多 10 条</span>
      <button type="button" className={button} disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页{label}</button>
    </nav>}
  </>;
}
function RecordOrigin({ record, source }: { record: ScheduleEvidenceRecord; source: SourcesResult }) {
  const row = source.attendance.base.rows.find(row => row.startEventId === record.startEventId);
  const correction = record.kind === "approved" ? row?.correction : null;
  const missing = record.kind === "missing-approved" ? source.attendance.missing.find(row => row.requestId === record.referenceId) : null;
  return <details className="text-xs"><summary className="cursor-pointer font-semibold">记录依据与原编号</summary>
    <dl className="mt-2 space-y-1 break-all leading-6">
      <div><dt className="inline font-semibold">{record.startEventId ? "原始起点事件：" : "漏卡申请："}</dt><dd className="inline">{record.referenceId}</dd></div>
      {record.operationId && <div><dt className="inline font-semibold">{missing ? "批准操作：" : "核定操作："}</dt><dd className="inline">{record.operationId}{record.revision !== null && ` · 核定版本 ${record.revision}`}</dd></div>}
      {correction && <><div><dt className="inline font-semibold">补正申请： </dt><dd className="inline">{correction.requestId} · 记录于 {correction.recordedAt}</dd></div>
        {correction.lineage && <div><dt className="inline font-semibold">原批准链： </dt><dd className="inline">申请 {correction.lineage.rootRequestId} · 操作 {correction.lineage.rootOperationId} · {correction.lineage.rootRecordedAt}{correction.lineage.previousOperationId && ` · 上一步操作 ${correction.lineage.previousOperationId}`}</dd></div>}</>}
      {row && <div><dt className="inline font-semibold">原末事件： </dt><dd className="inline">{row.lastEventId}</dd></div>}
      {missing && <><div><dt className="inline font-semibold">漏卡批准来源：</dt><dd className="inline">{missing.approvedAt} · 策略版本 {missing.policyRevision}</dd></div>
        <div><dt className="inline font-semibold">申报地点：</dt><dd className="inline">{missing.locationName} · {missing.locationId}</dd></div></>}
    </dl>
  </details>;
}
function RecordCard({ record, result, source }: { record: ScheduleEvidenceRecord; result: ScheduleEvidenceResult; source: SourcesResult }) {
  const candidates = record.candidateScheduleIds.map(id => result.slots.find(slot => slot.id === id)!);
  return <article data-schedule-evidence-record data-evidence-kind={record.kind} data-evidence-relation={record.relation}
    className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
    <h5 className="font-semibold">{record.kind === "missing-approved" ? "独立整段漏卡申报，不是原始打卡" : record.kind === "approved" ? "已批准补正的当前核定记录" : "原始打卡记录"}</h5>
    <Range start={record.startAt} end={record.endAt} zone={record.timeZone}/>
    {record.observedUntilAt && <p className="break-all text-xs text-amber-900">观察截至：{record.observedUntilAt}；只用于识别已观察部分的时间相交，不补造结束时刻。</p>}
    <p className="font-medium">{relations[record.relation]}</p>
    {!!record.reasons.length && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-900">{record.reasons.map(reason => <li key={reason}>{reasons[reason] ?? "该来源需要进一步核对。"}</li>)}</ul>}
    {record.timeDifference ? <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs" data-evidence-time-difference>
      <p>仅显示端点相减，不解释为迟到或早退；未使用宽限、请假抵扣或工资规则。</p>
      <p>记录起点 − 排班起点：{formatAttendanceTimesheetDuration(record.timeDifference.startDeltaUs, true)}（{record.timeDifference.startDeltaUs} 微秒）</p>
      <p>记录终点 − 排班终点：{formatAttendanceTimesheetDuration(record.timeDifference.endDeltaUs, true)}（{record.timeDifference.endDeltaUs} 微秒）</p>
    </div> : <p className="text-xs text-slate-600">未展示端点差值；未知不能记为 0。</p>}
    <RecordOrigin record={record} source={source}/>
    {!!candidates.length && <details><summary className="cursor-pointer text-xs font-semibold">查看时间相交候选排班（{candidates.length} 条，不自动选取）</summary>
      <div className="mt-2 border-l-2 border-slate-200 pl-3"><Pages items={candidates} label="候选排班" itemKey={slot => slot.id}>{slot => <div data-evidence-candidate className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
        <p className="break-all">{slot.locationName} · 排班版本 {slot.revision} · {slot.id}</p><Range start={slot.startAt} end={slot.endAt} zone={slot.timeZone}/>
      </div>}</Pages></div>
    </details>}
  </article>;
}
function SlotAnnotations({ slot, source }: { slot: ScheduleEvidenceSlot; source: SourcesResult }) {
  return <>
    {!!slot.leave.length && <details><summary className="cursor-pointer text-xs font-semibold">请假注记（只列窗口内交集，不自动免除排班）</summary>
      <div className="mt-2 space-y-2"><Pages items={slot.leave} label="请假注记" itemKey={item => item.requestId}>{item => {
        const original = source.leave.items.find(row => row.summary.requestId === item.requestId)!;
        return <div data-evidence-leave data-employee-matches={item.employeeMatches} className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
          <p>{leaveStatuses[item.status]} · 请假版本 {item.revision}{item.employeeMatches ? " · 原员工编号与当前档案一致（非历史身份证明）" : " · 员工身份不一致，不能套用"}</p>
          <p>与本排班及查询窗口的时间交集：</p><Range start={item.fromAt} end={item.toAt} zone={original.summary.timeZone}/>
          <p className="break-all">申请 {item.requestId} · 最后操作 {item.operationId} · 记录于 {original.recordedAt}</p>
          <p className="break-all">原员工编号 {original.employeeId}；当前 {source.worker.employeeId ?? "未关联"}</p>
          <p>{item.status === "approved" ? "批准状态仅作注记；部分交集不等于整段免除。" : "此状态不是当前批准，不作为批准请假使用。"}</p>
        </div>;
      }}</Pages></div>
    </details>}
    {!!slot.calendar.length && <details><summary className="cursor-pointer text-xs font-semibold">日历注记（节假日／停业提示，不是免班依据）</summary>
      <div className="mt-2"><Pages items={slot.calendar} label="日历注记" itemKey={item => item.entryId}>{item => <div data-evidence-calendar className="space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
        <p>{item.title} · {item.kind === "holiday" ? "节假日提示" : "停业提示"} · {item.status === "cancelled" ? "已取消" : "已记录"}</p>
        <p className="break-all">{item.locationId === null ? "企业范围" : `排班保存地点 ${item.locationId}`} · 版本 {item.revision} · {item.entryId}</p>
        <Range start={item.fromAt} end={item.toAt} zone={item.timeZone}/><p>仅为时间交集和地点范围注记，不替代批准请假或排班决定。</p>
      </div>}</Pages></div>
    </details>}
  </>;
}
function SlotCard({ slot, view, source }: { slot: ScheduleEvidenceSlot; view: ScheduleEvidenceView; source: SourcesResult }) {
  const reverse = view.schedules.find(item => item.id === slot.id), records = reverse?.recordKeys.map(key => view.records.find(record => record.key === key)!) ?? [];
  return <article data-schedule-evidence-slot data-evidence-cancelled={slot.cancelled} className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
    <h5 className="font-semibold">{slot.cancelled ? "已取消排班，不纳入候选" : "排班时间来源"} · {slot.locationName}</h5>
    <Range start={slot.startAt} end={slot.endAt} zone={slot.timeZone}/>
    <p className="break-all text-xs">排班编号 {slot.id} · 发布版本 {slot.revision} · 保存地点编号 {slot.locationId}</p>
    <p className="text-xs">相对于资料截至时间：{slot.phase === "future" ? "尚未开始" : slot.phase === "ongoing" ? "尚未结束" : "已过结束时刻（不是出勤结论）"}</p>
    {slot.windowPartial && <p className="text-xs text-amber-900">排班跨越查询边界，窗口外记录尚不足以核对。</p>}
    {!slot.cancelled && <p className="text-xs font-medium">{reverse ? relations[reverse.relation] : "候选关系未知"}</p>}
    {!!records.length && <details><summary className="cursor-pointer text-xs font-semibold">反向查看相交记录（{records.length} 条）</summary><div className="mt-2">
      <Pages items={records} label="相交记录" itemKey={record => record.key}>{record => <div className="rounded-lg bg-slate-50 p-2 text-xs">
        <p className="break-all">{record.kind === "missing-approved" ? "独立漏卡申报" : record.kind === "approved" ? "当前核定" : "原始记录"} · {record.referenceId}</p>
        <Range start={record.startAt} end={record.endAt} zone={record.timeZone}/>
      </div>}</Pages>
    </div></details>}
    <SlotAnnotations slot={slot} source={source}/>
  </article>;
}
function Comparison({ result, source }: { result: ScheduleEvidenceResult; source: SourcesResult }) {
  const [selected, setSelected] = useState<"original" | "selected">("original"), prefix = useId();
  const view = result.views.find(item => item.kind === selected)!;
  return <>
    <div role="tablist" aria-label="时间对照记录版本" className="flex flex-wrap gap-2">
      {(["original", "selected"] as const).map((kind, index) => <button key={kind} type="button" role="tab" id={`${prefix}-${kind}`} aria-controls={`${prefix}-graph`}
        aria-selected={kind === selected} tabIndex={kind === selected ? 0 : -1} className={`${button} ${kind === selected ? "border-blue-600 text-blue-800" : ""}`}
        onClick={() => setSelected(kind)} onKeyDown={event => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : ["ArrowLeft", "ArrowRight"].includes(event.key) ? 1 - index : null;
          if (next === null) return; event.preventDefault(); setSelected(next === 0 ? "original" : "selected");
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{kind === "original" ? "原始记录" : "当前核定记录"}</button>)}
    </div>
    <div id={`${prefix}-graph`} role="tabpanel" aria-labelledby={`${prefix}-${selected}`} data-schedule-evidence-view={selected} className="min-w-0 space-y-4">
      <ScheduleEvidenceGraph key={selected} view={view} result={result} source={source}/>
    </div>
  </>;
}
// Shared presentation for both views of the already resolved display graph.
export function ScheduleEvidenceGraph({ view, result, source }: { view: ScheduleEvidenceView; result: ScheduleEvidenceResult; source: SourcesResult }) {
  return <>
      <p className="text-xs leading-6 text-slate-600">{view.kind === "original" ? "仅使用原始打卡区间；整段漏卡申报不进入原始图。" : "使用当前已批准补正的区间，并将已批准整段漏卡申报作为独立来源。两者不合并成原始打卡。"}</p>
      <section aria-label="时间对照记录" className="min-w-0 space-y-3"><h4 className="font-semibold">记录 → 候选排班</h4>
        {!view.records.length ? <p className="text-sm">本视图未返回记录；不代表缺勤或没有其他来源。</p> : <Pages items={view.records} label="时间记录" itemKey={record => record.key}>
          {record => <RecordCard record={record} result={result} source={source}/>}
        </Pages>}
      </section>
      <section aria-label="时间对照排班" className="min-w-0 space-y-3"><h4 className="font-semibold">排班 → 候选记录与注记</h4>
        {result.coverage.schedule === "limited" ? <p className="rounded-lg bg-amber-50 p-3 text-sm">排班资料未完整取得，不能展示部分列表或认定没有排班。</p>
          : !result.slots.length ? <p className="text-sm">本次范围未返回排班；没有候选不等于缺勤，也不证明无需出勤。</p>
            : <Pages items={result.slots} label="时间排班" itemKey={slot => slot.id}>{slot => <SlotCard slot={slot} view={view} source={source}/>}</Pages>}
      </section>
  </>;
}

export default function MerchantAttendanceScheduleEvidence({ source }: { source: SourcesResult }) {
  const resolved = useMemo(() => { try { return resolveAttendanceScheduleEvidence(source); } catch { return null; } }, [source]);
  return <section aria-label="排班与记录时间对照" data-schedule-evidence className="min-w-0 space-y-3 rounded-xl border border-cyan-200 bg-cyan-50/40 p-3">
    <h3 className="font-bold">排班与记录时间对照</h3>
    <p className="text-sm leading-6">这里只展示 UTC 时间相交关系，不认定已匹配、正常、迟到、早退或缺勤，不计算合计、不应用规则、不改写工时或工资。</p>
    <p className="text-xs leading-6 text-slate-600">区间起点包含、终点不含；跨夜按原 UTC 时刻核对，不按日期标签配对。当前读取未封存；历史打卡身份、地点及班次规则绑定未由本协议证明。请假和日历只是注记，不自动免除排班。</p>
    {!resolved ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">无法可靠生成时间对照。已有原始来源仍可核查；未补默认值或生成业务结论。</p> : <>
      <div className="break-all text-xs leading-6 text-slate-600"><p>查询 UTC 窗口：{resolved.fromAt} → {resolved.toAt} · 查询时区 {resolved.timeZone}</p>
        <p>资料截至：{resolved.asOf} · 读取时间：{resolved.readAt}</p></div>
      {resolved.coverage.identityChanged && <p role="note" className="rounded-lg bg-amber-50 p-3 text-sm">历史来源员工身份与当前档案不一致；时间候选不是身份确认，也不能按姓名合并。</p>}
      {resolved.coverage.leave === "limited" && <p className="text-sm text-amber-900">请假资料未完整取得，不能视为没有请假。</p>}
      {resolved.coverage.calendar === "limited" && <p className="text-sm text-amber-900">日历资料未完整取得，不能视为没有提示。</p>}
      <Comparison key={`${resolved.siteId}:${resolved.actorId}:${resolved.workerId}:${resolved.fromAt}:${resolved.toAt}:${resolved.readAt}`} result={resolved} source={source}/>
    </>}
  </section>;
}
