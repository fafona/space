// Independent post-hoc selection ledger. These types do not turn a selection
// into an original clock-time association, a working-hours change or a verdict.
import type { ShiftRuleBindingWorker } from "./merchantAttendanceShiftRuleBinding";
import type { SelfScheduleSlot } from "./merchantAttendanceSelfSchedule";
import type { PlanExceptionSource } from "./merchantAttendancePlanExceptionSourceContract";

export const PLAN_POSTHOC_BLOCKERS = ["case_missing", "plan_not_ended", "slot_cancelled", "publication_missing", "worker_inactive", "context_unknown", "pending_correction", "pending_missing", "pending_leave", "pending_work_arrangement", "calendar_entry", "sealed"] as const;
export const PLAN_POSTHOC_CANDIDATE_BLOCKERS = ["identity_unproven", "source_open", "source_zero_duration", "source_outside_plan", "location_mismatch", "associated_elsewhere", "already_associated", "pending_correction", "pending_missing", "approval_missing", "claimed_elsewhere", "sealed"] as const;
export type PlanPosthocBlocker = typeof PLAN_POSTHOC_BLOCKERS[number];
export type PlanPosthocCandidateBlocker = typeof PLAN_POSTHOC_CANDIDATE_BLOCKERS[number];
export type PlanPosthocReference =
  | { kind: "session"; startEventId: string; lastEventId: string; lastSequence: number; effectOperationId: string | null; effectRevision: number | null }
  | { kind: "missing"; requestId: string; rootRequestId: string; approvalOperationId: string };
export type PlanPosthocQuery = { siteId: string; workerId: string; slotId: string; mode: "detail" | "recover"; operationId: string | null };
type CommandBase = { operationId: string; expectedRevision: number; expectedFingerprint: string; employeeId: string; employeeAuthUserId: string; reason: string };
export type PlanPosthocCommand = CommandBase & ({ action: "apply"; sources: PlanPosthocReference[] } | { action: "revoke" });
export type PlanPosthocOperation = { operationId: string; revision: number; action: "apply" | "revoke"; actorId: string; employeeId: string; employeeAuthUserId: string; reason: string; sources: PlanPosthocReference[]; sourceFingerprint: string; recordedAt: string };
export type PlanPosthocApproval = { operationId: string; revision: number; sourceId: string; sourceSha256: string; recordedAt: string };
export type PlanPosthocEndpoints = { startAt: string | null; endAt: string | null };
export type PlanPosthocCandidate = { reference: PlanPosthocReference; original: PlanPosthocEndpoints | null; selected: PlanPosthocEndpoints; locationId: string; timeZone: string; available: boolean; blockers: PlanPosthocCandidateBlocker[]; claim: { slotId: string; operationId: string; revision: number } | null };
export type PlanPosthocPreviewSource = { protocol: "posthoc-adoption-preview-v1"; basis: PlanExceptionSource; caseId: string | null; caseRevision: number; revision: number; currentOperationId: string | null; candidates: PlanPosthocCandidate[]; approval: PlanPosthocApproval | null; blockers: PlanPosthocBlocker[] };
export type PlanPosthocPreview = { fingerprint: string; eligible: boolean; blockers: PlanPosthocBlocker[]; candidates: PlanPosthocCandidate[]; approval: PlanPosthocApproval | null; source: PlanPosthocPreviewSource };
export type PlanPosthocResult = { protocol: "plan-posthoc-adoption-v1"; siteId: string; actorId: string; worker: ShiftRuleBindingWorker; slot: SelfScheduleSlot; revision: number; current: PlanPosthocOperation | null; preview: PlanPosthocPreview | null; history: PlanPosthocOperation[]; historyTruncated: boolean; receipt: { operationId: string; command: PlanPosthocCommand; item: PlanPosthocOperation } | null; readAt: string };
