// Shared browser-safe wire types only. No authorization, source collection or
// current-owner impersonation is performed by this contract.
import type { ShiftRuleBindingWorker } from "./merchantAttendanceShiftRuleBinding";
import type { PlanExceptionCandidate, PlanExceptionBlocker,
  PlanExceptionApproval } from "./merchantAttendancePlanExceptionSourceContract";
import type { PlanPosthocFormalSourceResult } from "./merchantAttendancePlanPosthocFormalSourceContract";
import type { PlanExceptionPosthocEvidence } from "./merchantAttendancePlanPosthocEvidence";

export type PlanExceptionAccess = "owner" | "self";
export type PlanExceptionOutcome = "confirmed" | "excused" | "follow_up" | "cleared" | "not_applicable";
export type PlanExceptionQuery = {
  siteId: string; access: PlanExceptionAccess;
  mode: "list" | "detail" | "recover" | "decide" | "note" | "ack";
  workerId: string | null; slotId: string | null; operationId: string | null;
  beforeAt: string | null; beforeId: string | null;
};
export type PlanExceptionDecisionCommand = {
  operationId: string; expectedRevision: number; expectedFingerprint: string;
  employeeId: string; employeeAuthUserId: string; outcome: PlanExceptionOutcome; note: string;
};
export type PlanExceptionNoteCommand = {
  operationId: string; expectedRevision: number; decisionOperationId: string; note: string;
};
export type PlanExceptionAckCommand = { operationId: string; decisionOperationId: string };
export type PlanExceptionCommand = PlanExceptionDecisionCommand | PlanExceptionNoteCommand | PlanExceptionAckCommand;
export type PlanExceptionApprovalReference = Pick<PlanExceptionApproval,
  "operationId" | "revision" | "sourceId" | "sourceSha256" | "recordedAt">;
export type PlanExceptionSessionReference = {
  startEventId: string; lastEventId: string; lastSequence: number; effectOperationId: string | null;
};
export type PlanExceptionContextReference = { requestId: string; operationId: string; revision: number };
export type PlanExceptionReferenceSection<T> = { limited: boolean; items: T[] };
// This is a compact historical calculation/decision basis, not a full source
// archive. Its fingerprint identifies the complete source checked by SQL146.
export type PlanExceptionLegacyEvidence = {
  policy: "owner-confirmed-plan-edges-v1" | "owner-confirmed-plan-edges-work-v2";
  fingerprint: string; observedAt: string; eligible: boolean; blockers: PlanExceptionBlocker[];
  candidate: PlanExceptionCandidate; approval: PlanExceptionApprovalReference | null;
  sessions: PlanExceptionSessionReference[];
  contextRefs: {
    unassociated: PlanExceptionReferenceSection<PlanExceptionSessionReference>;
    leave: PlanExceptionReferenceSection<PlanExceptionContextReference>;
    workArrangements?: PlanExceptionReferenceSection<PlanExceptionContextReference>;
    calendar: PlanExceptionReferenceSection<{ entryId: string; operationId: string; revision: number }>;
    missing: PlanExceptionReferenceSection<PlanExceptionContextReference>;
    pendingCorrections: PlanExceptionReferenceSection<PlanExceptionContextReference & {
      kind: "correction" | "revision"; startEventId: string;
    }>;
  };
};
export type PlanExceptionEvidence = PlanExceptionLegacyEvidence | PlanExceptionPosthocEvidence;
export type PlanExceptionHistoryEntry = {
  operationId: string; revision: number; actorId: string; kind: "decision" | "note";
  outcome: PlanExceptionOutcome | null; note: string; decisionOperationId: string | null; recordedAt: string;
};
export type PlanExceptionDecision = PlanExceptionHistoryEntry & {
  kind: "decision"; outcome: PlanExceptionOutcome; decisionOperationId: null;
  evidence: PlanExceptionEvidence; readAt: string | null;
};
export type PlanExceptionReceipt = {
  operationId: string; command: PlanExceptionDecisionCommand | PlanExceptionNoteCommand;
  item: PlanExceptionHistoryEntry & { evidence: PlanExceptionEvidence | null };
};
export type PlanExceptionReadReceipt = {
  operationId: string; command: PlanExceptionAckCommand; decisionOperationId: string;
  actorId: string; employeeId: string; employeeAuthUserId: string; readAt: string;
};
export type PlanExceptionCaseItem = {
  caseId: string; workerId: string; slotId: string; employeeId: string; employeeAuthUserId: string;
  workerName: string; workerNo: string; slotStartAt: string; slotEndAt: string; timeZone: string;
  openedAt: string; revision: number;
  latestDecision: { operationId: string; revision: number; outcome: PlanExceptionOutcome; recordedAt: string; readAt: string | null };
};
export type PlanExceptionDetail = {
  caseId: string | null; openedAt: string | null; worker: ShiftRuleBindingWorker; slotId: string; revision: number;
  current: PlanPosthocFormalSourceResult | null; currentValidation: "checked" | "not_checked"; stale: boolean | null;
  latestDecision: PlanExceptionDecision | null; history: PlanExceptionHistoryEntry[]; historyTruncated: boolean;
  canDecide: boolean; canNote: boolean;
};
export type PlanExceptionResult = {
  protocol: "plan-exception-review-v1"; siteId: string; access: PlanExceptionAccess; actorId: string;
  employeeId: string | null; readAt: string; items: PlanExceptionCaseItem[];
  nextCursor: { at: string; id: string } | null; detail: PlanExceptionDetail | null;
  receipt: PlanExceptionReceipt | null; readReceipt: PlanExceptionReadReceipt | null;
};
export type PlanExceptionResponse = PlanExceptionResult & { moduleEnabled: boolean };
export type PlanExceptionExpectedIdentity = { ownerId?: string; employeeId?: string; authUserId?: string };
