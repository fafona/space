import type { PlanExceptionDetail, PlanExceptionEvidence } from "./merchantAttendancePlanExceptionContract";

// A clearance concerns these two saved, configured rule checks only. It is not
// proof of full attendance, a payroll decision, or a substitute for SQL authority.
export function hasClearPlanExceptionBasis(basis: Pick<PlanExceptionEvidence, "eligible" | "candidate">): boolean {
  return basis.eligible === true && basis.candidate.late.state === "not_triggered"
    && basis.candidate.early.state === "not_triggered";
}

export function canClearPlanException(detail: PlanExceptionDetail | null): boolean {
  return detail !== null && detail.caseId !== null && detail.revision >= 1 && detail.canDecide
    && detail.currentValidation === "checked" && detail.current !== null && hasClearPlanExceptionBasis(detail.current);
}
