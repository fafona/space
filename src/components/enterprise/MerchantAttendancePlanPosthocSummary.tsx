"use client";
import { useState } from "react";
import type { PlanPosthocResult } from "@/lib/merchantAttendancePlanPosthocContract";

export type PlanPosthocSummaryProps =
  | { verification: "unverified" }
  | { verification: "verified"; result: PlanPosthocResult; view: "current" | "saved" };
type Operation = NonNullable<PlanPosthocResult["current"]>;
type Reference = Operation["sources"][number];
type Candidate = NonNullable<PlanPosthocResult["preview"]>["candidates"][number];
const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs disabled:opacity-40";
const blockerLabels: Readonly<Record<string, string>> = {
  case_missing: "尚未建立明确核查事项", plan_not_ended: "计划尚未结束", slot_cancelled: "计划已取消", publication_missing: "缺少计划发布身份依据",
  worker_inactive: "当前人员未启用", context_unknown: "相关资料未完整核验", pending_correction: "有待处理补正或再次修订", pending_missing: "有待处理整段漏卡或漏卡修订",
  pending_leave: "有待审批请假", pending_work_arrangement: "有待审批工作安排", calendar_entry: "有相关日历提示，仍需核查", sealed: "相关周期已封存，不能在此自动重开",
  identity_unproven: "历史身份依据尚未证实", source_open: "来源班次尚未结束", source_zero_duration: "来源为零时长，不能当作完整工作区间",
  source_outside_plan: "来源与本计划没有有效时间交集", location_mismatch: "来源地点不匹配", associated_elsewhere: "已有原始选择指向其他排班",
  already_associated: "已有原始选择关联，不重复作为事后采用", approval_missing: "没有可核验的原计划固定核准", claimed_elsewhere: "此来源已被其他计划采用",
};

/** Presentation only. A caller must pass the result of the authorized strict
 * parser, never a local pending command. No source, identity, or eligibility is
 * inferred here; current candidate endpoints never fill a saved reference. */
export default function MerchantAttendancePlanPosthocSummary(props: PlanPosthocSummaryProps) {
  if (props.verification !== "verified") return <section aria-label="事后核对采用记录" data-plan-posthoc-summary="unverified" className="min-w-0 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
    <h4 className="font-semibold">事后核对采用记录</h4><p role="alert">操作结果尚未核验，不能显示为已采用或已撤销。请通过原编号核对；不从本地待确认内容恢复理由、人员或来源正文。</p>
  </section>;
  const { result, view } = props;
  return <section aria-label="事后核对采用记录" data-plan-posthoc-summary={view} className="min-w-0 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/30 p-3 text-sm">
    <h4 className="font-semibold">负责人事后核对采用 · 不改变工时</h4>
    <p>这是后来明确保存的计划证据采用，不是员工上班时的原始选班，也不是开班时已经采用核准规则的证明。采用或撤销不改原始打卡、补正、漏卡批准及工时，不重复增加分钟，不计算工资。</p>
    <p className="break-all text-xs">计划 {result.slot.id} · 采用账本版本 {result.revision} · 读取 UTC {result.readAt}</p>
    {view === "saved" ? <p data-plan-posthoc-current-validation="not_checked" className="rounded-lg bg-amber-50 p-2">这里只核对保存记录；当前来源和身份未在此重新评价，不声称该采用目前仍适用。新批准版本、本人说明或来源变化均不能由本组件自动沿用。</p>
      : <p data-plan-posthoc-current-validation="preview-only">下方当前候选属于本次读取，不是采用当时的端点快照。保存操作存在不等于来源当前仍有效；以重新核对的限制及后续明确处理为准。</p>}
    {result.current ? <OperationCard operation={result.current} latest/> : <p data-plan-posthoc-no-current>本次没有返回已保存采用操作；不代表没有真实工作、漏卡申报或排班。</p>}
    <p className="text-xs">保存的员工及绑定身份编号用于核对归属，不能单凭编号、姓名或当前绑定补造历史身份证明。本摘要没有单独展开历史身份证明明细，也不代替服务端逐项核验。</p>
    {view === "current" && result.preview && <section aria-label="事后采用当前候选" data-plan-posthoc-preview className="min-w-0 space-y-3 rounded-lg border border-indigo-200 bg-white p-3">
      <h5 className="font-semibold">本次候选核验（尚未提交新的采用）</h5>
      <p>{result.preview.eligible ? "服务端本次预览未报告采用阻断；仍须明确选择、理由及提交后重新核验。" : "本次预览有未满足条件；不能用部分资料或未知值当作可采用。"}</p>
      <Limitations items={result.preview.blockers}/>
      <p className="break-all text-xs">本次预览指纹 {result.preview.fingerprint}</p>
      <p className="text-xs">原始端点、当前核定端点分别展示。批准漏卡是独立申报来源，不制造原始打卡端点；本处不计算净工时、请假抵扣或异常结论。</p>
      <Candidates key={`${result.siteId}:${result.slot.id}:${result.readAt}:${result.preview.fingerprint}`} items={result.preview.candidates}/>
    </section>}
    {view === "current" && !result.preview && <p data-plan-posthoc-no-preview>本次没有当前候选预览；不把历史收据当作当前来源重新核验。</p>}
    <History key={`${result.siteId}:${result.slot.id}:${result.revision}:${result.readAt}`} items={result.history} truncated={result.historyTruncated}/>
  </section>;
}
function ReferenceView({ value }: { value: Reference }) {
  return value.kind === "session" ? <div data-plan-posthoc-reference="session" className="space-y-1 break-all text-xs">
    <p>真实班次来源 · 原始起点 {value.startEventId}</p><p>保存末事件 {value.lastEventId} · 序号 {value.lastSequence}</p>
    <p>保存核定操作 {value.effectOperationId ?? "当时未引用批准替换"} · 核定版本 {value.effectRevision ?? "无批准替换版本"}</p>
  </div> : <div data-plan-posthoc-reference="missing" className="space-y-1 break-all text-xs">
    <p>批准整段漏卡来源（不是原始打卡）</p><p>申请 {value.requestId} · 根申请 {value.rootRequestId}</p><p>保存批准操作 {value.approvalOperationId}</p>
  </div>;
}
function OperationCard({ operation: row, latest = false }: { operation: Operation; latest?: boolean }) {
  return <article data-plan-posthoc-operation={row.operationId} data-plan-posthoc-action={row.action} className="min-w-0 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
    <h5 className="font-semibold">{latest ? "最近保存操作：" : "历史操作："}{row.action === "apply" ? "已保存事后采用" : "已保存撤销采用"} · 版本 {row.revision}</h5>
    {row.action === "revoke" && <p>撤销的是本计划证据采用，不是撤销漏卡批准、补正或原始打卡，不减少已记录工时。</p>}
    <p className="whitespace-pre-wrap break-words">理由：{row.reason}</p>
    <p className="break-all text-xs">操作 {row.operationId} · 操作者 {row.actorId} · 保存 UTC {row.recordedAt}</p>
    <p className="break-all text-xs">保存员工 {row.employeeId} · 保存绑定身份 {row.employeeAuthUserId}</p>
    <details className="min-w-0 space-y-2 break-all text-xs"><summary className="cursor-pointer">保存来源引用 · {row.sources.length} 项（不含历史端点快照）</summary>
      <p>保存来源指纹 {row.sourceFingerprint}</p>
      {row.sources.map((source, index) => <ReferenceView key={index} value={source}/>)}
      <p>以上只展示操作保存的引用。当前候选的端点不回填到这份历史记录，不能据此声称保存时的所有正文仍与当前相同。</p>
    </details>
  </article>;
}
function Limitations({ items }: { items: readonly string[] }) {
  return items.length ? <ul aria-label="采用核验限制" className="list-disc space-y-1 break-all pl-5 text-xs">{items.map((value, index) => <li key={index}>{blockerLabels[value] ?? "存在未满足的核验条件"}（{value}）</li>)}</ul> : null;
}
function CandidateCard({ value }: { value: Candidate }) {
  return <article data-plan-posthoc-candidate={value.reference.kind} data-plan-posthoc-available={String(value.available)} className="min-w-0 space-y-2 rounded-lg border p-3 text-xs">
    <ReferenceView value={value.reference}/>
    <p>{value.available ? "本次服务端核验允许列为可选来源；尚未因此保存采用。" : "当前不可采用或有未解决限制，不能自动忽略。"}</p>
    <p className="break-all">保存地点 {value.locationId} · 保存时区 {value.timeZone}</p>
    {value.reference.kind === "session" && value.original ? <p data-plan-posthoc-original className="break-all">原始 UTC {value.original.startAt ?? "未知"} → {value.original.endAt ?? "未结束（未知）"}</p>
      : <p data-plan-posthoc-original-missing>{value.reference.kind === "missing" ? "批准漏卡没有原始打卡端点，不以申报时间补造。" : "本次未取得原始端点，不能从核定值反推。"}</p>}
    <p data-plan-posthoc-selected className="break-all">{value.reference.kind === "missing" ? "当前批准申报" : "当前核定"} UTC {value.selected.startAt ?? "未知"} → {value.selected.endAt ?? "未结束（未知）"}</p>
    <Limitations items={value.blockers}/>
    {value.claim && <p data-plan-posthoc-claim className="break-all">服务端返回已有采用占用：计划 {value.claim.slotId} · 操作 {value.claim.operationId} · 版本 {value.claim.revision}。不自动迁移或拆分此来源。</p>}
  </article>;
}
function Candidates({ items }: { items: readonly Candidate[] }) {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(items.length / 10));
  return <><p className="text-xs">本次返回 {items.length} 项；每页最多 10 项。没有候选不代表缺勤或没有其他来源。</p>
    {items.slice(page * 10, page * 10 + 10).map((value, index) => <CandidateCard key={page * 10 + index} value={value}/>)}
    {pages > 1 && <nav aria-label="采用候选本地分页" className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={!page} onClick={() => setPage(page - 1)}>上一页候选</button><span>{page + 1} / {pages}</span><button type="button" className={button} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页候选</button></nav>}
  </>;
}
function History({ items, truncated }: { items: readonly Operation[]; truncated: boolean }) {
  const [page, setPage] = useState(0), pages = Math.max(1, Math.ceil(items.length / 10));
  return <section aria-label="事后采用与撤销历史" className="min-w-0 space-y-2"><h5 className="font-semibold">采用与撤销历史</h5>
    {truncated && <p data-plan-posthoc-history-limited>这里只返回部分历史，不称为全部采用记录。</p>}
    {!items.length && <p>本次没有返回历史操作。</p>}
    {items.slice(page * 10, page * 10 + 10).map(item => <OperationCard key={item.operationId} operation={item}/>)}
    {pages > 1 && <nav aria-label="采用历史本地分页" className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={!page} onClick={() => setPage(page - 1)}>上一页采用历史</button><span>{page + 1} / {pages}</span><button type="button" className={button} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页采用历史</button></nav>}
  </section>;
}
