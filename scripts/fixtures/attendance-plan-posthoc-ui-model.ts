import type { PlanPosthocCommand, PlanPosthocOperation, PlanPosthocQuery, PlanPosthocResult } from "../../src/lib/merchantAttendancePlanPosthocContract";
import { exceptionUiEligibleSource, exceptionUiId } from "./attendance-plan-exception-ui-model";
export const posthocUiId = exceptionUiId;
export function posthocUiValue(): PlanPosthocResult {
  const { source, worker, slot, actorId, siteId, readAt } = exceptionUiEligibleSource();
  source.sessions = []; source.approval = null;
  const preview = { fingerprint: "a".repeat(64), eligible: true, blockers: [], candidates: [], approval: null,
    source: { protocol: "posthoc-adoption-preview-v1" as const, basis: source, caseId: posthocUiId(790), caseRevision: 1, revision: 0, currentOperationId: null, candidates: [], approval: null, blockers: [] } };
  return { protocol: "plan-posthoc-adoption-v1", siteId, actorId, worker: structuredClone(worker), slot: structuredClone(slot), readAt, revision: 0, current: null, preview, history: [], historyTruncated: false, receipt: null };
}
export function posthocUiQuery(operationId: string | null = null): PlanPosthocQuery {
  const r = posthocUiValue(); return { siteId: r.siteId, workerId: r.worker.workerId, slotId: r.slot.id, mode: operationId ? "recover" : "detail", operationId };
}
export function posthocUiCommand(): PlanPosthocCommand {
  const r = posthocUiValue(); return { action: "apply", operationId: posthocUiId(800), expectedRevision: 0, expectedFingerprint: "a".repeat(64), employeeId: r.worker.employeeId, employeeAuthUserId: r.worker.employeeAuthUserId, reason: "Synthetic explicit leave-only activation", sources: [] };
}
export function posthocUiSaved(command = posthocUiCommand()): PlanPosthocResult {
  const r = posthocUiValue(), current: PlanPosthocOperation = { operationId: command.operationId, revision: command.expectedRevision + 1, action: command.action, actorId: r.actorId,
    employeeId: command.employeeId, employeeAuthUserId: command.employeeAuthUserId, reason: command.reason, sources: command.action === "apply" ? command.sources : [], sourceFingerprint: command.expectedFingerprint, recordedAt: r.readAt };
  return { ...r, revision: current.revision, current, preview: null, history: [structuredClone(current)], receipt: { operationId: command.operationId, command, item: structuredClone(current) } };
}
