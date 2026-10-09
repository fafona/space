"use client";
import { useMemo, useState } from "react";
import { RULE_DEFINITIONS, RULE_KEYS } from "@/lib/merchantAttendanceRuleDraft";
import { resolveCandidateThreeLayerRules, type ThreeLayerRuleField, type ThreeLayerRuleProvenance } from "@/lib/merchantAttendanceThreeLayerRules";
import type { RuleSourcesResult } from "@/lib/merchantAttendanceRuleSources";

const blockers: Record<string, string> = {
  assignments_truncated: "归组来源未完整取得，不能确认归属。",
  rules_truncated: "企业或组候选来源未完整取得，不能确认版本。",
  personal_truncated: "个人核准来源未完整取得，不能当作没有个人例外。",
  identity_changed: "历史来源与当前员工身份不同，不能按姓名合并或回退到下层。",
  inactive_worker: "当前考勤档案已停用，暂不解析候选。",
  inactive_employee: "当前关联员工已停用，暂不解析候选。",
  unbound_employee: "当前员工与登录身份未完整绑定，暂不解析候选。",
  assignment_overlap: "本段存在重叠归组，不能任选一组或回退企业层。",
  personal_overlap: "本段存在重叠个人核准，需先核对来源。",
  inactive_group: "当前组已停用，不能推定历史状态或自动回退企业层。",
  missing_rule_stream: "必要的候选规则流缺失；未知不等于未配置。",
};
const layerName = (layer: string) => layer === "personal" ? "个人核准层" : layer === "group" ? "考勤组层" : "企业层";
function choiceName(state: string, minutes: number | null) {
  if (state === "value") return `${minutes} 分钟`;
  if (state === "disabled") return "明确停用（不向下继承）";
  if (state === "inherit") return "继承下一层（本层未设值）";
  if (state === "missing_approval") return "该时点无未撤回个人核准（已读取个人来源）";
  if (state === "no_assignment") return "该时点无有效归组（已读取归组来源）";
  if (state === "missing_publication") return "该时点无候选发布（已读取该规则流）";
  if (state === "blocked") return "资料不足或冲突，未解析（不是 0）";
  return "未配置（不是 0，不补默认值）";
}

export function ThreeLayerRuleProvenanceView({ source }: { source: ThreeLayerRuleProvenance }) {
  return <dl className="mt-2 grid min-w-0 gap-1 break-all text-xs leading-5 text-slate-600">
    <div><dt className="inline font-semibold">来源：</dt><dd className="inline">{layerName(source.layer)} · 账本版本 {source.ledgerRevision} · {source.layer === "personal" ? `核准版本 ${source.approvalRevision}` : `候选发布版本 ${source.publishRevision}`}</dd></div>
    <div><dt className="inline font-semibold">原操作：</dt><dd className="inline">{source.operationId} · 原操作人 {source.actorId}</dd></div>
    <div><dt className="inline font-semibold">原登记时间：</dt><dd className="inline">{source.recordedAt}</dd></div>
    <div><dt className="inline font-semibold">保存上下文：</dt><dd className="inline">时区 {source.timeZone} · 设置版本 {source.settingsVersion}{source.layer === "personal" ? ` · 档案版本 ${source.workerVersion}` : source.groupRevision === null ? "" : ` · 组版本 ${source.groupRevision}`}</dd></div>
    {source.layer === "personal" ? <>
      <div><dt className="inline font-semibold">原身份：</dt><dd className="inline">员工 {source.employeeId} · 登录身份 {source.employeeAuthUserId}</dd></div>
      <div><dt className="inline font-semibold">原核准日期（含尾日）：</dt><dd className="inline">{source.startsOn} → {source.endsOn}</dd></div>
      <div><dt className="inline font-semibold">原 UTC 半开区间：</dt><dd className="inline">{source.fromAt} → {source.toAt}</dd></div>
    </> : <>
      <div><dt className="inline font-semibold">原候选起点：</dt><dd className="inline">{source.effectiveOn} · {source.effectiveAt}</dd></div>
      <div><dt className="inline font-semibold">目标：</dt><dd className="inline">{source.groupId === null ? "企业层" : `组 ${source.groupId}`}</dd></div>
    </>}
  </dl>;
}

function Field({ name, field }: { name: typeof RULE_KEYS[number]; field: ThreeLayerRuleField }) {
  return <div data-rule-field={name} data-rule-state={field.state} data-rule-layer={field.source?.layer ?? "none"}
    className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm">
    <h5 className="font-semibold">{RULE_DEFINITIONS[name].label}</h5>
    <p className="mt-1">{choiceName(field.state, field.minutes)}</p>
    {field.source && <p className="mt-1 text-xs font-semibold">本项采用{layerName(field.source.layer)}候选；并未应用于考勤</p>}
    {!!field.trace.length && <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold">查看个人 → 组 → 企业完整依据</summary>
      <ol className="mt-2 space-y-3 border-l-2 border-slate-200 pl-3">{field.trace.map(item => <li key={item.layer} data-rule-trace-layer={item.layer} data-rule-trace-mode={item.mode}>
        <p className="text-xs font-semibold">{layerName(item.layer)}：{item.layer === "enterprise" && item.mode === "inherit" ? "本层未设值（没有更低层，不补默认值）" : choiceName(item.mode, item.minutes)}{item.source && field.source?.layer === item.source.layer && field.source.groupId === item.source.groupId && field.source.operationId === item.source.operationId ? " · 本项采用" : ""}</p>
        <p className="break-all text-xs text-slate-600">已读账本版本：{item.ledgerRevision ?? "无归组，不涉及组账本"}{item.groupId ? ` · 组 ${item.groupId}` : ""}</p>
        {item.source && <ThreeLayerRuleProvenanceView source={item.source}/>}
      </li>)}</ol>
    </details>}
  </div>;
}

export default function MerchantAttendanceThreeLayerRules({ source }: { source: RuleSourcesResult }) {
  return <Resolution key={`${source.siteId}:${source.actorId}:${source.worker.workerId}:${source.fromAt}:${source.toAt}:${source.readAt}`} source={source}/>;
}
function Resolution({ source }: { source: RuleSourcesResult }) {
  const [page, setPage] = useState(0);
  const result = useMemo(() => { try { return resolveCandidateThreeLayerRules(source); } catch { return null; } }, [source]);
  const pages = Math.max(1, Math.ceil((result?.segments.length ?? 0) / 10)), current = Math.min(page, pages - 1);
  return <section aria-label="三层候选规则解析（未应用）" data-three-layer-resolution className="min-w-0 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
    <h3 className="font-bold">三层候选规则解析（未应用）</h3>
    <p className="text-sm leading-6">个人明确核准候选 → 考勤组候选 → 企业候选，逐项对照。0、明确停用、继承、缺少核准／发布与资料不足分别展示；不是正式生效规则，也不是异常或工资结论。</p>
    <p className="text-xs leading-6 text-slate-600">UTC 半开区间：包含起点、不含终点。个人核准结束后重新比较下层；已撤回核准不参与解析。历史与未来区间均是本次读取的当前候选投影，未历史固定、不可用作历史重算依据。</p>
    {!result && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">无法可靠解析三层候选。仍可核对下方来源；未使用默认值，也未执行任何修改。</p>}
    {result && <>
      <p className="break-all text-xs text-slate-600">读取时间 {result.readAt} · 共 {result.segments.length} 个候选时间段 · 每页最多 10 段</p>
      {result.segments.slice(current * 10, current * 10 + 10).map(segment => <article key={segment.fromAt} data-three-layer-segment data-rule-status={segment.status}
        className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <h4 className="break-all text-sm font-semibold">{segment.fromAt} → {segment.toAt}</h4>
        {segment.assignmentId && <p className="break-all text-xs">归组来源 {segment.assignmentId} · 归组版本 {segment.assignmentRevision} · 组 {segment.groupId}</p>}
        {segment.personalApprovalRevision !== undefined && <p className="text-xs">本段个人核准来源版本 {segment.personalApprovalRevision}；各字段是否采用见下方依据。</p>}
        {segment.status === "candidate" && !segment.assignmentId && <p className="text-xs">此段无有效归组；仍比较已读取的个人核准与企业候选，不虚构组规则。</p>}
        {!!segment.blockers.length && <ul className="list-disc space-y-1 rounded-lg bg-amber-50 py-2 pr-2 pl-6 text-sm text-amber-950">{segment.blockers.map(code => <li key={code}>{blockers[code] ?? "来源不足或相互矛盾，需先核对资料。"}</li>)}</ul>}
        <div className="grid min-w-0 gap-2 md:grid-cols-2">{RULE_KEYS.map(name => <Field key={name} name={name} field={segment.fields[name]}/>)}</div>
      </article>)}
      {pages > 1 && <nav aria-label="三层规则时间段分页" className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页时间段</button>
        <span>第 {current + 1} / {pages} 页</span>
        <button type="button" className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页时间段</button>
      </nav>}
    </>}
  </section>;
}
