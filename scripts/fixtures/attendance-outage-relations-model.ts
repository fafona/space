/** Synthetic 222 protocol examples only; not database or real-account evidence.
 * Browser-safe: no environment, storage, network or Node imports. */
import type { OutageRelationEntry, OutageRelationEvidence, OutageRelationSummary, OutageRelationsCommand, OutageRelationsQuery,
  OutageRelationsResult } from "../../src/lib/merchantAttendanceOutageRelationsContract";

export const outageRelationsModelId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const OUTAGE_RELATIONS_MODEL = Object.freeze({ siteId: "99990222", owner: outageRelationsModelId(1), auth: outageRelationsModelId(2),
  worker: outageRelationsModelId(3), employee: outageRelationsModelId(4), declaration: outageRelationsModelId(10), related: outageRelationsModelId(11),
  operation: outageRelationsModelId(30), at: "2026-10-07T12:00:00.000000Z", fingerprint: "a".repeat(64) });
export function outageRelationsModelQuery(access: "owner" | "self" = "owner"): Extract<OutageRelationsQuery, { mode: "detail" }> {
  const m = OUTAGE_RELATIONS_MODEL;
  return { siteId: m.siteId, access, mode: "detail", declarationId: m.declaration, relatedDeclarationId: m.related };
}
export function outageRelationsModelEvidence(): OutageRelationEvidence {
  const m = OUTAGE_RELATIONS_MODEL;
  return { protocol: "outage-relation-evidence-v1", siteId: m.siteId, workerId: m.worker, employeeId: m.employee, employeeAuthUserId: m.auth,
    workerVersion: 2, employeeVersion: 3, generation: 0, declarations: [
      { declarationId: m.declaration, operationId: outageRelationsModelId(20), fingerprint: "b".repeat(64) },
      { declarationId: m.related, operationId: outageRelationsModelId(21), fingerprint: "c".repeat(64) }] };
}
export function outageRelationsModelCommand(patch: Partial<Extract<OutageRelationsCommand, { action: "apply" }>> = {}): Extract<OutageRelationsCommand, { action: "apply" }> {
  const m = OUTAGE_RELATIONS_MODEL;
  return { action: "apply", kind: "possible_duplicate", operationId: m.operation, expectedRevision: 0,
    expectedFingerprint: m.fingerprint, reason: "仅提示可能重复，不合并声明或替代逐项处理。", ...patch };
}
export function outageRelationsModelEntry(command: OutageRelationsCommand = outageRelationsModelCommand()): OutageRelationEntry {
  const m = OUTAGE_RELATIONS_MODEL;
  return { pair: [m.declaration, m.related], operationId: command.operationId, revision: command.expectedRevision + 1, action: command.action,
    kind: command.action === "apply" ? command.kind : "possible_duplicate", actorId: m.owner, reason: command.reason,
    evidence: command.action === "apply" ? outageRelationsModelEvidence() : null, fingerprint: command.expectedFingerprint, recordedAt: m.at };
}
export function outageRelationsModelSummary(entry: OutageRelationEntry): OutageRelationSummary {
  const { evidence: _evidence, ...summary } = entry; void _evidence; return summary;
}
export function outageRelationsModelResult(query: OutageRelationsQuery = outageRelationsModelQuery(), current: OutageRelationEntry | null = null): OutageRelationsResult {
  const m = OUTAGE_RELATIONS_MODEL;
  return { protocol: "attendance-outage-relations-v1", siteId: query.siteId, access: query.access, mode: query.mode,
    actorId: query.access === "owner" ? m.owner : m.auth, declarationId: query.declarationId,
    relatedDeclarationId: query.mode === "list" ? null : query.relatedDeclarationId, readAt: m.at,
    canWrite: query.mode === "detail" && query.access === "owner", items: [], revision: current?.revision ?? 0,
    current: query.mode === "detail" ? current : null,
    preview: query.mode === "detail" ? { fingerprint: m.fingerprint, evidence: outageRelationsModelEvidence(), eligible: true, blockers: [] } : null,
    history: [], historyTruncated: false, receipt: null };
}
export function outageRelationsModelSaved(query: OutageRelationsQuery, command: OutageRelationsCommand, commandFingerprint: string): OutageRelationsResult {
  return { ...outageRelationsModelResult(query), canWrite: false, revision: command.expectedRevision + 1, current: null, preview: null,
    receipt: { operationId: command.operationId, commandFingerprint, entry: outageRelationsModelEntry(command) } };
}
