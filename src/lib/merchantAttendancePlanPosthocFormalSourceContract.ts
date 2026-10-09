//206 independent read contract. A v3 source is not a saved decision or a
//period artifact; the existing review/period protocols remain unchanged.
import type { PlanExceptionCandidate, PlanExceptionSourceResult } from "./merchantAttendancePlanExceptionSourceContract";
import type { PlanLeaveEdgesResult } from "./merchantAttendancePlanLeaveEdges";
import type { PlanPosthocEvaluationBlocker, PlanPosthocEvaluationQuery, PlanPosthocEvaluationSource } from "./merchantAttendancePlanPosthocEvaluationContract";

export type PlanPosthocFormalSourceQuery = PlanPosthocEvaluationQuery;
export type PlanPosthocFormalSourceState = "required" | "blocked" | "not_applicable";
export type PlanPosthocFormalSource = {
  protocol: "plan-exception-evidence-v3";
  policy: "owner-confirmed-plan-edges-posthoc-v3";
  // Same complete facts as205, including work-v2, but SQL removes the dynamic
  //sealed write gate and only its proven derived unavailable flags. Hidden
  //location/pending/identity failures must remain; the browser cannot infer them.
  evaluation: PlanPosthocEvaluationSource;
};
export type PlanPosthocFormalSourceV3Result = {
  protocol: "plan-exception-source-v3";
  siteId: string; actorId: string; worker: PlanExceptionSourceResult["worker"];
  slot: PlanExceptionSourceResult["slot"]; readAt: string;
  source: PlanPosthocFormalSource; fingerprint: string;
  state: PlanPosthocFormalSourceState; eligible: boolean;
  blockers: PlanPosthocEvaluationBlocker[];
  candidate: PlanExceptionCandidate; leaveEdges: PlanLeaveEdgesResult;
};
// No171 head: precisely the old result, not an empty v3 wrapper. A revoked
//head remains v3/blocked with posthoc_inactive, so the prior fingerprint cannot
//silently become current again. SQL raw adds sourceText in either branch.
export type PlanPosthocFormalSourceResult = PlanExceptionSourceResult | PlanPosthocFormalSourceV3Result;
