"use client";
import { useMemo, useState } from "react";
import { RULE_DEFINITIONS, RULE_KEYS } from "@/lib/merchantAttendanceRuleDraft";
import { resolveCandidateAttendanceRules, type CandidateRuleField, type CandidateRuleProvenance } from "@/lib/merchantAttendanceRuleResolution";
import type { SourcesResult } from "@/lib/merchantAttendanceSources";

const reasons: Record<string, string> = {
  assignments_truncated: "归组资料未完整取得，不能确定应采用哪个组。",
  rules_truncated: "候选发布未完整取得，不能选择规则版本。",
  identity_changed: "来源保存的员工身份与当前档案不同，需负责人先核对。",
  inactive_worker: "当前考勤档案已停用；仍可核查原始来源，但不生成候选解析。",
  assignment_overlap: "本时间段同时存在多个归属，不能任选一组或退回企业规则。",
  inactive_group: "当前归属的组已停用，不能推定历史状态或自动退回企业规则。",
  missing_rule_stream: "必要的规则来源流缺失，不能将未知当作未配置。",
};
const limitationLabels: Record<string, string> = {
  schedule_truncated: "排班来源不完整，不能据此作出出勤判断。",
  leave_truncated: "请假来源不完整，不能视为没有请假。",
  calendar_truncated: "日历提示不完整，不能视为没有相关提示。",
};
const layerName = (layer: string) => layer === "group" ? "考勤组" : "企业默认层";
const choiceName = (state: string, minutes: number | null) => state === "value" ? `${minutes} 分钟`
  : state === "disabled" ? "明确停用（不向下继承）" : state === "inherit" ? "继承下一层"
    : state === "missing_publication" ? "该时点无候选发布" : state === "blocked" ? "资料不足，未解析" : "未配置（不是0）";

function Provenance({ source }: { source: CandidateRuleProvenance }) {
  return <dl className="mt-2 grid gap-1 break-all text-xs text-slate-600">
    <div><dt className="inline font-semibold">发布来源：</dt><dd className="inline">{source.operationId} · 候选发布版本 {source.publishRevision} · 账本版本 {source.ledgerRevision}</dd></div>
    <div><dt className="inline font-semibold">发布边界：</dt><dd className="inline">{source.effectiveAt} · 保存时区 {source.timeZone}</dd></div>
    <div><dt className="inline font-semibold">保存上下文：</dt><dd className="inline">设置版本 {source.settingsVersion}{source.groupRevision === null ? "" : ` · 组版本 ${source.groupRevision}`}</dd></div>
    <div><dt className="inline font-semibold">登记：</dt><dd className="inline">{source.recordedAt} · 原操作人 {source.actorId}</dd></div>
  </dl>;
}

function Field({ name, field }: { name: typeof RULE_KEYS[number]; field: CandidateRuleField }) {
  return <div data-rule-field={name} data-rule-state={field.state} data-rule-layer={field.source?.layer ?? "none"}
    className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm">
    <h5 className="font-semibold">{RULE_DEFINITIONS[name].label}</h5>
    <p className="mt-1">{choiceName(field.state, field.minutes)}</p>
    {field.source && <p className="mt-1 break-all text-xs text-slate-600">采用{layerName(field.source.layer)}候选 · 版本 {field.source.publishRevision} · {field.source.operationId}</p>}
    {!!field.trace.length && <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold">查看逐层依据</summary>
      <ol className="mt-2 space-y-3 border-l-2 border-slate-200 pl-3">{field.trace.map(item => <li key={item.layer}>
        <p className="text-xs font-semibold">{layerName(item.layer)}：{item.mode === "inherit" ? item.layer === "group" ? "继承企业层" : "本层未设值（不补默认值）" : choiceName(item.mode, item.minutes)}{item.source && field.source?.operationId === item.source.operationId ? " · 本项采用" : ""}</p>
        {item.source && <Provenance source={item.source}/>}
      </li>)}</ol>
    </details>}
  </div>;
}

export default function MerchantAttendanceRuleResolution({ source }: { source: SourcesResult }) {
  return <Resolution key={`${source.siteId}:${source.actorId}:${source.worker.workerId}:${source.fromAt}:${source.toAt}:${source.readAt}`} source={source}/>;
}
function Resolution({ source }: { source: SourcesResult }) {
  const [page, setPage] = useState(0);
  const resolved = useMemo(() => {
    try { return { result: resolveCandidateAttendanceRules(source), error: false } as const; }
    catch { return { result: null, error: true } as const; }
  }, [source]);
  const result = resolved.result, pages = result ? Math.max(1, Math.ceil(result.segments.length / 10)) : 1;
  const current = Math.min(page, pages - 1);
  return <section aria-label="候选规则解析（未应用）" data-rule-resolution className="min-w-0 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
    <h3 className="font-bold">候选规则解析（未应用）</h3>
    <p className="text-sm leading-6">这里只对照当前读取的企业／考勤组候选版本。个人例外尚未接入，历史来源尚未封存，因此不作正式考勤判定，不修改工时、工资或打卡结果。</p>
    <p className="text-xs leading-6 text-slate-600">按UTC半开区间展示：起点包含、终点不含。跨边界使用新候选版本；数值0、明确停用、继承与未配置分别处理。请假和日历只保留为核查资料，不在此自动覆盖规则。</p>
    {resolved.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">无法可靠解析候选规则。下方原始来源仍可核对；未使用默认值，也未执行任何修改。</p>}
    {result && <>
      <p className="break-all text-xs text-slate-600">来源读取时间：{result.readAt} · 共 {result.segments.length} 个时间段</p>
      {result.limitations.filter(code => Object.hasOwn(limitationLabels, code)).map(code => <p key={code} className="text-sm text-amber-900">{limitationLabels[code]}</p>)}
      {result.segments.slice(current * 10, current * 10 + 10).map(segment => <article key={segment.fromAt} data-rule-segment data-rule-status={segment.status}
        className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <h4 className="break-all text-sm font-semibold">{segment.fromAt} → {segment.toAt}</h4>
        {segment.assignmentId && <p className="break-all text-xs text-slate-600">归组来源 {segment.assignmentId} · 归组版本 {segment.assignmentRevision} · 组编号 {segment.groupId}</p>}
        {segment.status === "candidate" && !segment.assignmentId && <p className="text-xs text-slate-600">当前已知归组区间在此段无有效归属，仅对照企业层候选；不代表不存在个人例外。</p>}
        {!!segment.blockers.length && <ul className="list-disc space-y-1 rounded-lg bg-amber-50 py-2 pr-2 pl-6 text-sm text-amber-950">{segment.blockers.map(code => <li key={code}>{reasons[code] ?? "来源不足或相互矛盾，需先核对资料。"}</li>)}</ul>}
        <div className="grid min-w-0 gap-2 md:grid-cols-2">{RULE_KEYS.map(name => <Field key={name} name={name} field={segment.fields[name]}/>)}</div>
      </article>)}
      {pages > 1 && <nav aria-label="候选规则时间段分页" className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页时间段</button>
        <span>第 {current + 1} / {pages} 页 · 每页最多10段</span>
        <button type="button" className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页时间段</button>
      </nav>}
    </>}
  </section>;
}
