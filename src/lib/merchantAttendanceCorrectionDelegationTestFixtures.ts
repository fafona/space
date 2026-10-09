// Synthetic DTO builders for isolated protocol/client/route tests. Not SQL or real-auth evidence.
import { correctionDelegationCommandFingerprint, correctionDelegationOperation, type CorrectionDelegationAccess, type CorrectionDelegationQuery,
  type CorrectionDelegationCommand, type CorrectionDelegationGrantCommand, type CorrectionDelegationDecideCommand, type CorrectionDelegationGrant,
  type CorrectionDelegationCatalog, type CorrectionDelegationCatalogItem, type CorrectionDelegationSummary, type CorrectionDelegationDetail,
  type CorrectionDelegationResponse } from "./merchantAttendanceCorrectionDelegation";
export const correctionDelegationId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const id = correctionDelegationId;
export const correctionDelegationOwner = id(1), correctionDelegationEmployee = id(2), correctionDelegationAuth = id(3), correctionDelegationWorker = id(4);
export const correctionDelegationReadAt = "2026-10-06T12:00:00.000000Z";
export function correctionDelegationQuery(access: CorrectionDelegationAccess = "delegate", mode?: string): CorrectionDelegationQuery {
  if (access === "owner") return { siteId: "99990001", access, mode: (mode ?? "list") as "list" | "catalog" | "detail" | "recover",
    catalog: mode === "catalog" ? "delegates" : null, grantId: mode === "detail" ? id(10) : null, operationId: mode === "recover" ? id(30) : null, afterId: null };
  return { siteId: "99990001", access, mode: (mode ?? "grants") as "grants" | "list" | "detail" | "decide" | "recover", grantId: ["list", "detail", "decide"].includes(mode ?? "") ? id(10) : null,
    requestId: ["detail", "decide"].includes(mode ?? "") ? id(20) : null, operationId: mode === "recover" ? id(30) : null, beforeAt: null, beforeId: null, afterId: null };
}
export function correctionDelegationGrant(): CorrectionDelegationGrant { return { grantId: id(10), revision: 1, status: "granted",
  delegate: { employeeId: id(2), authUserId: id(3), name: "Synthetic delegate" }, worker: { workerId: id(4), employeeId: id(5), authUserId: id(6), name: "Synthetic worker", workerNo: "SYN-4" },
  location: { locationId: id(7), name: "Synthetic location", timeZone: "UTC" }, includePending: false, validFrom: "2026-10-01T00:00:00.000000Z", validUntil: "2026-11-01T00:00:00.000000Z",
  grantedBy: id(1), grantedAt: "2026-09-30T12:00:00.000000Z", reason: "Synthetic bounded authorization", revocation: null, usable: true }; }
export function correctionDelegationGrantCommand(): CorrectionDelegationGrantCommand { const g = correctionDelegationGrant(); return { action: "grant", operationId: g.grantId,
  delegateEmployeeId: g.delegate.employeeId, delegateAuthUserId: g.delegate.authUserId, workerId: g.worker.workerId, employeeId: g.worker.employeeId,
  employeeAuthUserId: g.worker.authUserId, locationId: g.location.locationId, includePending: g.includePending, validFrom: g.validFrom, validUntil: g.validUntil, reason: g.reason }; }
export function correctionDelegationCommand(): CorrectionDelegationDecideCommand { return { grantId: id(10), expectedGrantRevision: 1,
  decision: { action: "approve", operationId: id(30), requestId: id(20), expectedRevision: 3, expectedEvidence: "a".repeat(32), reason: "Synthetic review" } }; }
export function correctionDelegationCatalogItem(kind: CorrectionDelegationCatalog): CorrectionDelegationCatalogItem { const g = correctionDelegationGrant(); return kind === "delegates"
  ? { id: g.delegate.employeeId, employeeId: g.delegate.employeeId, employeeAuthUserId: g.delegate.authUserId, name: g.delegate.name, workerNo: null, timeZone: null }
  : kind === "workers" ? { id: g.worker.workerId, employeeId: g.worker.employeeId, employeeAuthUserId: g.worker.authUserId, name: g.worker.name, workerNo: g.worker.workerNo, timeZone: null }
    : { id: g.location.locationId, employeeId: null, employeeAuthUserId: null, name: g.location.name, workerNo: null, timeZone: g.location.timeZone }; }
export function correctionDelegationSummary(): CorrectionDelegationSummary { return { requestId: id(20), startEventId: id(21), revision: 3, workerId: id(4), employeeId: id(5), employeeAuthUserId: id(6), workerName: "Synthetic worker",
  locationId: id(7), locationName: "Synthetic location", timeZone: "UTC", submittedAt: "2026-10-04T12:00:00.000000Z", status: "submitted" }; }
export function correctionDelegationDetail(): CorrectionDelegationDetail { return { ...correctionDelegationSummary(),
  original: { startAt: "2026-10-03T08:00:00.000000Z", endAt: "2026-10-03T09:59:00.000000Z", breaks: [] }, blockers: [],
  proposal: { startAt: "2026-10-03T08:00:00.000000Z", endAt: "2026-10-03T10:00:00.000000Z", breaks: [] }, reason: "Synthetic requested correction", evidenceToken: "a".repeat(32), blocked: false, canApprove: true, canReject: true }; }
export function correctionDelegationWire(q = correctionDelegationQuery()): CorrectionDelegationResponse { return q.access === "owner"
  ? { protocol: "correction-delegations-v1", siteId: q.siteId, actorId: correctionDelegationOwner, mode: q.mode, timeZone: "UTC", canWrite: q.mode !== "recover",
    items: q.mode === "list" ? [correctionDelegationGrant()] : [], catalogItems: q.mode === "catalog" ? [correctionDelegationCatalogItem(q.catalog!)] : [], nextId: null,
    detail: q.mode === "detail" ? correctionDelegationGrant() : null, receipt: null, readAt: correctionDelegationReadAt }
  : { protocol: "delegated-corrections-v1", siteId: q.siteId, actorId: correctionDelegationAuth, employeeId: correctionDelegationEmployee, mode: q.mode, canWrite: q.mode !== "recover",
    grants: q.mode === "grants" ? [correctionDelegationGrant()] : [], items: q.mode === "list" ? [correctionDelegationSummary()] : [], nextCursor: null, nextId: null,
    detail: q.mode === "detail" ? correctionDelegationDetail() : null, receipt: null, readAt: correctionDelegationReadAt }; }
export function correctionDelegationHttp(q = correctionDelegationQuery()) { return { ok: true, ...correctionDelegationWire(q) }; }
export async function correctionDelegationReceiptHttp(q: CorrectionDelegationQuery, c: CorrectionDelegationCommand) {
  const commandFingerprint = await correctionDelegationCommandFingerprint(q.siteId, q.access, c), operationId = correctionDelegationOperation(c), result = correctionDelegationWire(q);
  const recordedAt = "2026-10-06T11:00:00.000000Z";
  if (result.protocol === "correction-delegations-v1" && "action" in c) return { ok: true, ...result, items: [], catalogItems: [], nextId: null, detail: null,
    receipt: { operationId, action: c.action, grantId: c.action === "grant" ? c.operationId : c.grantId, revision: c.action === "grant" ? 1 : 2, recordedAt, commandFingerprint } };
  if (result.protocol !== "delegated-corrections-v1" || !("decision" in c)) throw Error("fixture_access");
  return { ok: true, ...result, grants: [], items: [], nextCursor: null, nextId: null, detail: null,
    receipt: { operationId, requestId: c.decision.requestId, grantId: c.grantId, action: c.decision.action, status: c.decision.action === "approve" ? "approved" : "rejected",
      actorId: result.actorId, recordedAt, commandFingerprint } };
}
