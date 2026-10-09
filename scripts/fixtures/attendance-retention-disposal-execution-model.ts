// Synthetic wire only. No authentication, database source or actual disposal.
import { createHash } from "node:crypto";
import { evaluateRetentionDisposal, RETENTION_DISPOSAL_INPUT_PROTOCOL, RETENTION_DISPOSAL_FIELDS, RETENTION_DISPOSAL_PREVIEW_PROTOCOL, type RetentionDisposalInput } from "../../src/lib/merchantAttendanceRetentionDisposal";
import { DISPOSAL_TRUSTED_PREVIEW_PROTOCOL, DISPOSAL_EXECUTION_PROTOCOL, type DisposalCoverage, type DisposalExecutionCommand, type DisposalExecutionBlocker, type DisposalTrustedPreview, type DisposalExecutionResult } from "../../src/lib/merchantAttendanceRetentionDisposalExecution";
export const disposalId = (n: number) => `19700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const disposalSite = "99990197", disposalActor = disposalId(1), disposalAt = "2026-10-08T12:00:00.123456Z";
export function disposalBasis(): RetentionDisposalInput {
  const empty = () => ({ revision: 0, held: false, operationId: null, recordedAt: null });
  return { protocol: RETENTION_DISPOSAL_INPUT_PROTOCOL, siteId: disposalSite, asOf: disposalAt,
    location: { evidenceId: disposalId(2), workerId: disposalId(3), sourceFingerprint: "a".repeat(64), anchorAt: "2026-10-07T12:00:00.123456Z", reason: "inside", needsReview: false,
      precisionPresent: { capturedAt: true, accuracyMeters: true, distanceMeters: true } },
    policy: { category: "location_results", revision: 1, retentionDays: 1, operationId: disposalId(4), recordedAt: "2026-10-01T00:00:00.000000Z" },
    dependencies: { session: { state: "closed", sessionId: disposalId(5), sourceFingerprint: "b".repeat(64) }, review: { coverage: "complete", hasReview: false, hasDiscussion: false },
      locationSnapshotHistory: { coverage: "complete", hasAnySnapshot: false }, artifacts: { coverage: "complete", items: [{ artifactId: disposalId(6), sourceFingerprint: "c".repeat(64) }] } },
    preservation: { coverage: "complete", location: empty(), event: empty(), artifacts: [{ artifactId: disposalId(6), ...empty() }] } };
}
const encode = (v: unknown): string => Array.isArray(v) ? "[" + v.map(encode).join(", ") + "]" : JSON.stringify(v);
const sha = (v: unknown) => createHash("sha256").update(encode(v), "utf8").digest("hex");
export async function disposalPreview(basis = disposalBasis(), coverage: DisposalCoverage = { eventCovered: true, artifactsComplete: true, artifactLimitExceeded: false, alreadyDisposed: false }): Promise<DisposalTrustedPreview> {
  const p = await evaluateRetentionDisposal(basis), l = basis.location, blockers: DisposalExecutionBlocker[] = [...p.blockers];
  if (!coverage.eventCovered) blockers.push("dependency_coverage_unknown");
  if (!coverage.artifactsComplete) blockers.push("artifact_coverage_incomplete");
  if (coverage.artifactLimitExceeded) blockers.push("artifact_dependency_limit");
  if (coverage.alreadyDisposed) blockers.push("already_disposed");
  return { protocol: DISPOSAL_TRUSTED_PREVIEW_PROTOCOL, siteId: basis.siteId, asOf: basis.asOf, eventId: l.evidenceId, workerId: l.workerId,
    fields: RETENTION_DISPOSAL_FIELDS, dueAt: p.dueAt, candidateState: blockers.length ? "blocked" : "candidate", blockers,
    sourceFingerprint: p.sourceFingerprint, policyFingerprint: p.policyFingerprint, dependencyFingerprint: p.dependencyFingerprint, holdFingerprint: p.holdFingerprint,
    previewFingerprint: sha([RETENTION_DISPOSAL_PREVIEW_PROTOCOL, basis.siteId, basis.asOf,
      [l.evidenceId, l.workerId, l.sourceFingerprint, l.anchorAt, l.reason, l.needsReview, [l.precisionPresent.capturedAt, l.precisionPresent.accuracyMeters, l.precisionPresent.distanceMeters]],
      RETENTION_DISPOSAL_FIELDS, p.policyFingerprint, p.dependencyFingerprint, p.holdFingerprint, p.dueAt, blockers]), basis, coverage };
}
export async function disposalApprove(): Promise<DisposalExecutionCommand> {
  const p = await disposalPreview(); return { action: "approve", operationId: disposalId(7), eventId: p.eventId, fields: RETENTION_DISPOSAL_FIELDS, previewAt: p.asOf,
    expectedSourceFingerprint: p.sourceFingerprint, expectedPolicyFingerprint: p.policyFingerprint, expectedDependencyFingerprint: p.dependencyFingerprint,
    expectedHoldFingerprint: p.holdFingerprint, expectedPreviewFingerprint: p.previewFingerprint, reason: "明确批准此合成资料的三字段处置" };
}
export const disposalQuery = () => ({ siteId: disposalSite, mode: "preview" as const, eventId: disposalId(2), operationId: null });
export async function disposalReceipt(rawCommand?: DisposalExecutionCommand) {
  const command = rawCommand ?? await disposalApprove();
  const tuple = command.action === "approve" ? [command.action, command.operationId, command.eventId, command.fields, command.previewAt, command.expectedSourceFingerprint,
    command.expectedPolicyFingerprint, command.expectedDependencyFingerprint, command.expectedHoldFingerprint, command.expectedPreviewFingerprint, command.reason]
    : [command.action, command.operationId, command.eventId, command.approvalOperationId];
  return { operationId: command.operationId, action: command.action, eventId: command.eventId,
    approvalOperationId: command.action === "approve" ? command.operationId : command.approvalOperationId, actorId: disposalActor, recordedAt: disposalAt,
    commandFingerprint: sha(["attendance-retention-disposal-command-v1", disposalSite, disposalActor, tuple]) };
}
export const disposalResult = <T extends DisposalExecutionResult["data"]>(data: T) => ({ protocol: DISPOSAL_EXECUTION_PROTOCOL, siteId: disposalSite, actorId: disposalActor, readAt: disposalAt, data });
