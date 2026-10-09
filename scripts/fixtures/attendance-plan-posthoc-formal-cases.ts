//206 synthetic computation fixtures only. They attest neither database identity
//nor PostgreSQL canonical hashes, and never authorize a decision or a write.
//The privileged native harness may feed facts to the private SQL compute helper
//and compare its five fields with the independent205 TypeScript calculation.
import { parsePlanPosthocEvaluation } from "../../src/lib/merchantAttendancePlanPosthocEvaluation";
import type { PlanPosthocEvaluationFacts, PlanPosthocEvaluationResult } from "../../src/lib/merchantAttendancePlanPosthocEvaluationContract";
import type { PlanExceptionLeave } from "../../src/lib/merchantAttendancePlanExceptionSourceContract";
import type { WorkArrangementCommand } from "../../src/lib/merchantAttendanceWorkArrangement";
import { exceptionUiEligibleSource, exceptionUiId as id } from "./attendance-plan-exception-ui-model";
import { workArrangementDetail } from "./attendance-work-arrangement-model";

export type PlanPosthocFormalDerived = Omit<Pick<PlanPosthocEvaluationResult, "state" | "eligible" | "blockers" | "leaveEdges" | "candidate">, "state"> & {
  state: "required" | "blocked" | "not_applicable";
};
export type PlanPosthocFormalCase = { group: string; facts: PlanPosthocEvaluationFacts; expectedDerived5: PlanPosthocFormalDerived };

function baseline(): PlanPosthocEvaluationFacts {
  const old = exceptionUiEligibleSource(), approval = old.source.approval!;
  return { protocol: "plan-posthoc-evaluation-v1", siteId: old.siteId, actorId: old.actorId, worker: structuredClone(old.worker), slot: structuredClone(old.slot), readAt: old.readAt,
    fingerprint: "a".repeat(64), source: { protocol: "posthoc-evaluation-evidence-v1", basis: old.source,
      posthoc: { revision: 1, current: { operationId: id(206001), revision: 1, action: "apply", actorId: old.actorId,
        employeeId: old.worker.employeeId, employeeAuthUserId: old.worker.employeeAuthUserId, reason: "Synthetic explicit activation for computation only", sources: [], sourceFingerprint: "b".repeat(64), recordedAt: old.readAt }, selected: [],
        approval: { operationId: approval.operationId, revision: approval.revision, sourceId: approval.sourceId, sourceSha256: approval.sourceSha256, recordedAt: approval.recordedAt } },
      observations: [], approval: structuredClone(approval), leave: { limited: false, resolved: true, items: [] }, resolutionBlockers: [] } };
}
function withoutWork(v = baseline(), withoutApproval = false) {
  v.source.basis.sessions = []; v.source.basis.approval = null;
  if (withoutApproval) { v.source.approval = null; v.source.posthoc.approval = null; }
  return v;
}
function leave(v: PlanPosthocEvaluationFacts, startAt: string, endAt: string, status: PlanExceptionLeave["status"] = "approved") {
  //122/159 approved leave endpoints are minute-aligned UTC3; microsecond cases
  //belong to actual-work edges, not fabricated sub-minute leave approvals.
  startAt = startAt.replace(/\.000000Z$/, ".000Z"); endAt = endAt.replace(/\.000000Z$/, ".000Z");
  const requestId = id(206100 + v.source.leave.items.length * 2), item: PlanExceptionLeave = {
    requestId, operationId: status === "submitted" ? requestId : id(206101 + v.source.leave.items.length * 2), revision: status === "submitted" ? 1 : status === "cancelled" ? 3 : 2,
    status, startAt, endAt, recordedAt: "2026-10-09T10:00:00.000000Z" };
  v.source.basis.context.leave.items.push(item); v.source.leave.items.push({ ...structuredClone(item), current: true }); return v;
}
function span(v: PlanPosthocEvaluationFacts, startAt: string, endAt: string) {
  const s = v.source.basis.sessions[0]; s.original = { startAt, endAt }; s.selected = { startAt, endAt };
  s.relation.recordedAt = startAt; s.adoption!.recordedAt = startAt; return v;
}
function innerLeave() {
  const v = span(baseline(), "2026-10-08T08:10:00.000000Z", "2026-10-08T12:00:00.000000Z"), second = structuredClone(v.source.basis.sessions[0]);
  second.startEventId = id(206200); second.operationId = id(206201); second.lastEventId = id(206202); second.lastSequence = 4;
  for (const r of [second.relation, second.adoption!]) { r.startEventId = second.startEventId; r.operationId = second.operationId; r.recordedAt = "2026-10-08T13:00:00.000000Z"; }
  second.original = { startAt: "2026-10-08T13:00:00.000000Z", endAt: "2026-10-08T15:50:00.000000Z" }; second.selected = structuredClone(second.original);
  v.source.basis.sessions.push(second); return leave(v, "2026-10-08T12:00:00.000000Z", "2026-10-08T13:00:00.000000Z");
}
function rule(state: "disabled" | "unconfigured") {
  const v = baseline();
  for (const a of [v.source.approval!, v.source.basis.approval!]) {
    const p = a.source, f = p.fields.lateGraceMinutes;
    if (state === "disabled") {
      p.personal.approval!.rules.lateGraceMinutes = { mode: "disabled" };
      f.trace[0].mode = "disabled"; f.trace[0].minutes = null; f.state = "disabled"; f.minutes = null; f.source = structuredClone(f.trace[0].source);
    } else {
      p.personal.approval!.rules.lateGraceMinutes = { mode: "inherit" }; p.group!.publication!.rules.lateGraceMinutes = { mode: "inherit" }; p.enterprise.publication!.rules.lateGraceMinutes = { mode: "inherit" };
      for (const t of f.trace) { t.mode = "inherit"; t.minutes = null; } f.state = "unconfigured"; f.minutes = null; f.source = null;
    }
  }
  return v;
}
function fixedDst(day: "2026-03-29" | "2026-10-25") {
  const v = baseline(), startAt = `${day}T00:00:00.000Z`, endAt = `${day}T03:00:00.000Z`, s = v.source.basis.sessions[0];
  const before = day === "2026-03-29" ? "2026-03-28" : "2026-10-24", after = day === "2026-03-29" ? "2026-03-30" : "2026-10-26";
  for (const slot of [v.slot, v.source.basis.slot, s.relation.slot!]) Object.assign(slot, { workDate: day, startAt, endAt, timeZone: "Europe/Madrid" });
  v.readAt = `${after}T12:00:00.000000Z`; v.source.posthoc.current!.recordedAt = v.readAt;
  for (const a of [v.source.approval!, v.source.basis.approval!]) {
    a.recordedAt = `${before}T12:00:00.000000Z`; Object.assign(a.source.slot, { startAt, endAt, timeZone: "Europe/Madrid" });
    a.source.assignment!.fromAt = `${before}T00:00:00.000000Z`; a.source.assignment!.toAt = `${after}T00:00:00.000000Z`;
    a.source.personal.approval!.fromAt = `${before}T01:00:00.000Z`; a.source.personal.approval!.toAt = `${after}T00:00:00.000Z`;
    a.source.personal.approval!.recordedAt = `${before}T00:00:00.000000Z`;
    for (const p of [a.source.enterprise.publication!, a.source.group!.publication!]) { p.recordedAt = `${before}T00:00:00.000000Z`; p.effectiveAt = `${before}T01:00:00.000Z`; }
  }
  v.source.posthoc.approval!.recordedAt = v.source.approval!.recordedAt; s.adoption!.approval!.recordedAt = v.source.approval!.recordedAt;
  return span(v, `${day}T00:10:00.000001Z`, `${day}T02:50:00.000000Z`);
}
function workV2(approved: boolean) {
  const v = baseline(), { conflicts, conflictsFingerprint, issues, sealed, canWithdraw, canApprove, canReject, canCancel, ...item } = workArrangementDetail();
  void conflicts; void conflictsFingerprint; void issues; void sealed; void canWithdraw; void canApprove; void canReject; void canCancel;
  Object.assign(item, { workerId: v.worker.workerId, employeeId: v.worker.employeeId, employeeAuthUserId: v.worker.employeeAuthUserId,
    startAt: v.slot.startAt, endAt: v.slot.endAt, submittedAt: "2026-08-01T00:00:00.000001Z" });
  item.history[0].actorId = v.worker.employeeAuthUserId; item.history[0].recordedAt = item.submittedAt;
  item.history[0].command = { ...item.history[0].command, expectedWorkerId: v.worker.workerId, startAt: item.startAt, endAt: item.endAt } as WorkArrangementCommand;
  if (approved) {
    item.status = "approved"; item.revision = 2;
    const command: WorkArrangementCommand = { action: "approve", operationId: id(206999), requestId: item.requestId, expectedRevision: 1, reason: "Synthetic approval", expectedConflictsFingerprint: "a".repeat(64), confirmConflicts: true };
    item.history.push({ operationId: command.operationId, revision: 2, action: "approve", actorId: v.actorId, reason: command.reason, recordedAt: "2026-10-07T12:00:00.000000Z", command });
  }
  v.source.basis.protocol = "plan-exception-evidence-v2"; v.source.basis.policy = "owner-confirmed-plan-edges-work-v2";
  v.source.basis.context.workArrangements = { limited: false, items: [item] }; return v;
}
export function planPosthocFormalExpected(facts: PlanPosthocEvaluationFacts): PlanPosthocFormalDerived {
  const r = parsePlanPosthocEvaluation(facts, { siteId: facts.siteId, workerId: facts.worker.workerId, slotId: facts.slot.id }, facts.actorId);
  return { state: r.state === "not_active" ? "blocked" : r.state, eligible: r.eligible, blockers: r.blockers, leaveEdges: r.leaveEdges, candidate: r.candidate };
}
export function createPlanPosthocFormalCases(): PlanPosthocFormalCase[] {
  const partial = leave(baseline(), "2026-10-08T08:00:00.000000Z", "2026-10-08T08:10:00.000000Z");
  leave(partial, "2026-10-08T15:50:00.000000Z", "2026-10-08T16:00:00.000000Z");
  const touching = leave(withoutWork(baseline(), true), "2026-10-08T08:00:00.000000Z", "2026-10-08T12:00:00.000000Z");
  leave(touching, "2026-10-08T12:00:00.000000Z", "2026-10-08T16:00:00.000000Z");
  const overlapping = leave(withoutWork(baseline(), true), "2026-10-08T07:00:00.000000Z", "2026-10-08T13:00:00.000000Z");
  leave(overlapping, "2026-10-08T12:00:00.000000Z", "2026-10-08T17:00:00.000000Z");
  const microOverlap = leave(span(baseline(), "2026-10-08T08:09:59.999999Z", "2026-10-08T15:50:00.000000Z"), "2026-10-08T08:00:00.000Z", "2026-10-08T08:10:00.000Z");
  const revoked = baseline(); revoked.source.posthoc.revision = 2; revoked.source.posthoc.current!.revision = 2; revoked.source.posthoc.current!.action = "revoke";
  revoked.source.posthoc.approval = null; revoked.source.resolutionBlockers = ["posthoc_inactive"];
  const inactive = baseline(); inactive.source.posthoc = { revision: 0, current: null, selected: [], approval: null }; inactive.source.resolutionBlockers = ["posthoc_inactive"];
  const unknown = baseline(); unknown.source.leave.resolved = false; unknown.source.resolutionBlockers = ["context_unknown"];
  const groups: [string, PlanPosthocEvaluationFacts][] = [
    ["original_associated_zero_and_five_minute_rules", baseline()],
    ["full_leave_no_work_no_rule", leave(withoutWork(baseline(), true), "2026-10-08T08:00:00.000000Z", "2026-10-08T16:00:00.000000Z")],
    ["partial_edges_touch_work", partial], ["internal_leave_keeps_outer_edges", innerLeave()], ["touching_leave_union", touching], ["overlapping_leave_clipped_union", overlapping],
    ["actual_work_overlaps_leave", leave(baseline(), "2026-10-08T12:00:00.000000Z", "2026-10-08T13:00:00.000000Z")],
    ["one_microsecond_leave_overlap", microOverlap], ["one_microsecond_late", span(baseline(), "2026-10-08T08:00:00.000001Z", "2026-10-08T15:50:00.000000Z")],
    ["spring_dst_fixed_utc", fixedDst("2026-03-29")], ["autumn_dst_fixed_utc", fixedDst("2026-10-25")],
    ["no_work_not_absence", withoutWork()], ["disabled_not_zero", rule("disabled")], ["unconfigured_not_zero", rule("unconfigured")],
    ["revoked_not_active", revoked], ["no_posthoc_ledger", inactive], ["unresolved_leave_not_empty", unknown],
    ["work_v2_pending", workV2(false)], ["work_v2_approved_not_work_or_leave", workV2(true)],
  ];
  return groups.map(([group, facts]) => {
    try { return { group, facts, expectedDerived5: planPosthocFormalExpected(facts) }; }
    catch (cause) { throw new Error(`Invalid synthetic formal-computation case: ${group}`, { cause }); }
  });
}
export const planPosthocFormalCases = createPlanPosthocFormalCases();
