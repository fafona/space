import type { PlanExceptionDetail, PlanExceptionEvidence } from "./merchantAttendancePlanExceptionContract";
import type { PlanPosthocFormalSourceResult } from "./merchantAttendancePlanPosthocFormalSourceContract";

// A narrow applicability result, not full attendance, a fabricated endpoint or
//a payroll/working-hours decision. SQL independently enforces all write guards.
export function hasNotApplicablePlanExceptionBasis(basis: PlanExceptionEvidence | PlanPosthocFormalSourceResult): boolean {
  const state = "protocol" in basis
    ? basis.protocol === "plan-exception-source-v3" ? basis.state : null
    : basis.policy === "owner-confirmed-plan-edges-posthoc-v3" ? basis.evaluation.state : null;
  const edges = "protocol" in basis
    ? basis.protocol === "plan-exception-source-v3" ? basis.leaveEdges : null
    : basis.policy === "owner-confirmed-plan-edges-posthoc-v3" ? basis.evaluation.leaveEdges : null;
  return state === "not_applicable" && basis.eligible && basis.blockers.length === 0 && edges !== null
    && edges.fullCoverage === true && !edges.unknown && edges.state === "not_applicable"
    && edges.work.length === 0 && edges.workLeaveOverlaps?.length === 0
    && basis.candidate.late.state === "blocked" && basis.candidate.early.state === "blocked"
    && basis.candidate.original.startAt === null && basis.candidate.original.endAt === null
    && basis.candidate.selected.startAt === null && basis.candidate.selected.endAt === null;
}
export function canMarkPlanExceptionNotApplicable(detail: PlanExceptionDetail | null): boolean {
  return detail !== null && detail.caseId !== null && detail.revision >= 1 && detail.canDecide
    && detail.currentValidation === "checked" && detail.current !== null && hasNotApplicablePlanExceptionBasis(detail.current);
}
