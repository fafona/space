import type { PlanPosthocEvaluationSource } from "@/lib/merchantAttendancePlanPosthocEvaluationContract";
import type { PlanLeaveEdgesResult } from "@/lib/merchantAttendancePlanLeaveEdges";

// Both owner-current and employee-saved paths render the same bounded shape.
// This component does not fetch, resolve ownership or recalculate old records.
export default function PlanPosthocReviewEvidenceView({ state, posthoc, observations, leaveEdges, saved }: {
  state: "required" | "blocked" | "not_applicable";
  posthoc: PlanPosthocEvaluationSource["posthoc"]; observations: PlanPosthocEvaluationSource["observations"];
  leaveEdges: PlanLeaveEdgesResult; saved: boolean;
}) {
  const head = posthoc.current;
  return <section aria-label={saved ? "保存时的事后依据与请假边缘" : "本次事后依据与请假边缘"} data-plan-posthoc-review-evidence className="min-w-0 space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
    <h4 className="font-semibold">{saved ? "保存时" : "本次核查"} · 事后依据与请假边缘</h4>
    <p>{state === "not_applicable" ? "整段计划由获批请假覆盖，本次迟到／早退不适用。" : state === "blocked" ? "仍有阻断，不能把这份资料当作正常出勤或可减免的证明。" : "按获批请假后剩余的计划边缘核查迟到／早退。"}</p>
    <p>这不是原打卡时建立的关联；不改原始打卡、工时、余额或工资。{saved ? "下列快照是决定保存时的资料，当前未重查。" : "保存前服务器会再次核对来源、版本和封存状态。"}</p>
    {head && <div className="space-y-1 break-words">
      <p>采用版本 {posthoc.revision} · {head.action === "apply" ? "明确采用" : "已撤销"}</p>
      <p className="whitespace-pre-wrap">采用／撤销理由：{head.reason}</p>
      <p className="break-all text-xs">原操作 {head.operationId} · 保存 UTC {head.recordedAt}</p>
    </div>}
    <details className="min-w-0 rounded-lg border border-teal-200 bg-white p-2 text-xs">
      <summary>保存的采用来源 · {posthoc.selected.length} 项</summary>
      {posthoc.selected.length === 0 && <p>未额外采用实际班次或漏卡；不是没有工作记录的证明。</p>}
      <ol className="mt-2 space-y-2">{posthoc.selected.map((s, i) => { const r = s.reference, observation = observations[i]; return <li key={r.kind + ":" + (r.kind === "session" ? r.startEventId : r.requestId)} className="break-all">
        <p>{r.kind === "session" ? "实际班次" : "获批漏卡"} · {r.kind === "session" ? r.startEventId : r.requestId}</p>
        <p>采用时核定 UTC {s.selected.startAt ?? "未知"} → {s.selected.endAt ?? "未知"}</p>
        <p>{saved ? "保存时观察" : "当前观察"}：{!observation?.current ? "不可用" : observation.blockers.length ? "来源已变化或不可用，不能沿用" : "已核对采用版本"}</p>
        {observation?.current && <p>观察到的核定 UTC {observation.current.selected.startAt ?? "未知"} → {observation.current.selected.endAt ?? "未知"}</p>}
      </li>; })}</ol>
    </details>
    <p className="break-all">原计划 UTC {leaveEdges.plan.startAt} → {leaveEdges.plan.endAt}</p>
    <p className="break-all">剩余应核查边缘：{state === "not_applicable" ? "无（整段获批请假）" : `${leaveEdges.requiredStartAt ?? "未知"} → ${leaveEdges.requiredEndAt ?? "未知"}`}</p>
    <p>获批覆盖 {leaveEdges.approvedCoverage === null ? "未核实" : `${leaveEdges.approvedCoverage.length} 段`} · 待审 {leaveEdges.pending.length} 项 · 工作与请假冲突 {leaveEdges.workLeaveOverlaps === null ? "未核实" : `${leaveEdges.workLeaveOverlaps.length} 项`}</p>
    <details className="min-w-0 rounded-lg border border-teal-200 bg-white p-2 text-xs"><summary>获批覆盖与剩余时段（UTC）</summary>
      {leaveEdges.approvedCoverage === null || leaveEdges.remainingRequired === null ? <p>依据不完整，不能解释为没有请假或没有应出勤时段。</p> : <>
        <ul className="mt-2 space-y-1">{leaveEdges.approvedCoverage.map((s, i) => <li key={i} className="break-all">获批覆盖 {s.startAt} → {s.endAt} · {s.leaveRefs.length} 项批准引用</li>)}</ul>
        <ul className="mt-2 space-y-1">{leaveEdges.remainingRequired.map((s, i) => <li key={i} className="break-all">剩余时段 {s.startAt} → {s.endAt}</li>)}</ul>
      </>}
    </details>
  </section>;
}
