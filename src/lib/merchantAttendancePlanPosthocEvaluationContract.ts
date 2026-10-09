//205 owner-only READ evidence. This is not a formal verdict, a v3 exception
//source, a period artifact, or authority for a future writer to trust the client.
import type { PlanExceptionApproval, PlanExceptionCandidate, PlanExceptionSource } from "./merchantAttendancePlanExceptionSourceContract";
import type { PlanPosthocApproval, PlanPosthocCandidate, PlanPosthocOperation, PlanPosthocReference } from "./merchantAttendancePlanPosthocContract";
import type { PlanLeaveEdgesResult, PlanLeaveResolvedContext } from "./merchantAttendancePlanLeaveEdges";

export const PLAN_POSTHOC_RESOLUTION_BLOCKERS = ["posthoc_inactive", "source_changed", "source_unavailable", "context_unknown"] as const;
export const PLAN_POSTHOC_OBSERVATION_BLOCKERS = ["source_changed", "source_unavailable"] as const;
export const PLAN_POSTHOC_EVALUATION_BLOCKERS = [
  ...PLAN_POSTHOC_RESOLUTION_BLOCKERS, "plan_not_ended", "slot_cancelled", "publication_missing", "worker_inactive",
  "association_unverified", "adoption_missing", "adoption_unverified", "approval_mismatch", "approval_missing",
  "session_open", "session_zero_duration", "session_outside_plan", "session_overlap", "session_location_mismatch",
  "unassociated_session", "missing_request", "pending_correction", "leave_pending", "calendar_entry", "work_arrangement_pending",
  "leave_context_unknown", "work_endpoint_missing", "work_zero_duration", "source_outside_plan", "work_leave_overlap",
  "identity_unproven", "associated_elsewhere", "claimed_elsewhere", "pending_missing", "sealed",
] as const;
export type PlanPosthocResolutionBlocker = typeof PLAN_POSTHOC_RESOLUTION_BLOCKERS[number];
export type PlanPosthocObservationBlocker = typeof PLAN_POSTHOC_OBSERVATION_BLOCKERS[number];
export type PlanPosthocEvaluationBlocker = typeof PLAN_POSTHOC_EVALUATION_BLOCKERS[number];
export type PlanPosthocEvaluationQuery = { siteId: string; workerId: string; slotId: string };
export type PlanPosthocObservation = { reference: PlanPosthocReference; current: PlanPosthocCandidate | null; blockers: PlanPosthocObservationBlocker[] };
export type PlanPosthocEvaluationSource = {
  protocol: "posthoc-evaluation-evidence-v1";
  basis: PlanExceptionSource;
  posthoc: { revision: number; current: PlanPosthocOperation | null; selected: PlanPosthocCandidate[]; approval: PlanPosthocApproval | null };
  observations: PlanPosthocObservation[];
  approval: PlanExceptionApproval | null;
  leave: PlanLeaveResolvedContext;
  resolutionBlockers: PlanPosthocResolutionBlocker[];
};
// SQL raw adds sourceText (canonical PostgreSQL JSONB text, at most1MiB).
// Server verifies its UTF8 SHA/semantic tree then strips it before exposure.
export type PlanPosthocEvaluationFacts = {
  protocol: "plan-posthoc-evaluation-v1"; siteId: string; actorId: string;
  worker: PlanExceptionSource["worker"]; slot: PlanExceptionSource["slot"];
  readAt: string; source: PlanPosthocEvaluationSource; fingerprint: string;
};
export type PlanPosthocEvaluationResult = PlanPosthocEvaluationFacts & {
  state: "not_active" | "blocked" | "required" | "not_applicable";
  eligible: boolean; blockers: PlanPosthocEvaluationBlocker[];
  leaveEdges: PlanLeaveEdgesResult; candidate: PlanExceptionCandidate;
};
