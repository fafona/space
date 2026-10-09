import { missingDelegationCommandFingerprint, missingDelegationOperation, type MissingDelegationAccess, type MissingDelegationQuery,
  type MissingDelegationCommand, type MissingDelegationGrantCommand, type MissingDelegationDecideCommand, type MissingDelegationGrant,
  type MissingDelegationCatalog, type MissingDelegationCatalogItem, type MissingDelegationSummary, type MissingDelegationDetail,
  type MissingDelegationResponse } from "../../src/lib/merchantAttendanceMissingDelegation";
export const missingDelegationId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const id = missingDelegationId;
export const missingDelegationOwner = id(1), missingDelegationEmployee = id(2), missingDelegationAuth = id(3), missingDelegationWorker = id(4);
export const missingDelegationReadAt = "2026-10-06T12:00:00.000000Z";
export function missingDelegationQuery(access: MissingDelegationAccess = "delegate", mode?: string): MissingDelegationQuery {
  if (access === "owner") return { siteId: "99990001", access, mode: (mode ?? "list") as "list" | "catalog" | "detail" | "recover",
    catalog: mode === "catalog" ? "delegates" : null, grantId: mode === "detail" ? id(10) : null, operationId: mode === "recover" ? id(30) : null, afterId: null };
  return { siteId: "99990001", access, mode: (mode ?? "grants") as "grants" | "list" | "detail" | "decide" | "recover", grantId: ["list", "detail", "decide"].includes(mode ?? "") ? id(10) : null,
    requestId: ["detail", "decide"].includes(mode ?? "") ? id(20) : null, operationId: mode === "recover" ? id(30) : null, beforeAt: null, beforeId: null, afterId: null };
}
export function missingDelegationGrant(): MissingDelegationGrant { return { grantId: id(10), revision: 1, status: "granted",
  delegate: { employeeId: id(2), authUserId: id(3), name: "Synthetic delegate" }, worker: { workerId: id(4), employeeId: id(5), authUserId: id(6), name: "Synthetic worker", workerNo: "SYN-4" },
  location: { locationId: id(7), name: "Synthetic location", timeZone: "UTC" }, validFrom: "2026-10-01T00:00:00.000000Z", validUntil: "2026-11-01T00:00:00.000000Z",
  grantedBy: id(1), grantedAt: "2026-09-30T12:00:00.000000Z", reason: "Synthetic bounded authorization", revocation: null, usable: true }; }
export function missingDelegationGrantCommand(): MissingDelegationGrantCommand { const g = missingDelegationGrant(); return { action: "grant", operationId: g.grantId,
  delegateEmployeeId: g.delegate.employeeId, delegateAuthUserId: g.delegate.authUserId, workerId: g.worker.workerId, employeeId: g.worker.employeeId,
  employeeAuthUserId: g.worker.authUserId, locationId: g.location.locationId, validFrom: g.validFrom, validUntil: g.validUntil, reason: g.reason }; }
export function missingDelegationCommand(): MissingDelegationDecideCommand { return { grantId: id(10), expectedGrantRevision: 1,
  decision: { action: "approve", operationId: id(30), requestId: id(20), expectedRevision: 1, evidenceToken: "a".repeat(32), reason: "Synthetic review" } }; }
export function missingDelegationCatalogItem(kind: MissingDelegationCatalog): MissingDelegationCatalogItem { const g = missingDelegationGrant(); return kind === "delegates"
  ? { id: g.delegate.employeeId, employeeId: g.delegate.employeeId, employeeAuthUserId: g.delegate.authUserId, name: g.delegate.name, workerNo: null, timeZone: null }
  : kind === "workers" ? { id: g.worker.workerId, employeeId: g.worker.employeeId, employeeAuthUserId: g.worker.authUserId, name: g.worker.name, workerNo: g.worker.workerNo, timeZone: null }
    : { id: g.location.locationId, employeeId: null, employeeAuthUserId: null, name: g.location.name, workerNo: null, timeZone: g.location.timeZone }; }
export function missingDelegationSummary(): MissingDelegationSummary { return { requestId: id(20), workerId: id(4), employeeId: id(5), employeeAuthUserId: id(6), workerName: "Synthetic worker",
  locationId: id(7), locationName: "Synthetic location", timeZone: "UTC", submittedAt: "2026-10-04T12:00:00.000000Z", status: "submitted" }; }
export function missingDelegationDetail(): MissingDelegationDetail { return { ...missingDelegationSummary(),
  proposal: { startAt: "2026-10-03T08:00:00.000000Z", endAt: "2026-10-03T10:00:00.000000Z", breaks: [] }, reason: "Synthetic missing interval", evidenceToken: "a".repeat(32), blocked: false, canApprove: true, canReject: true }; }
export function missingDelegationWire(q = missingDelegationQuery()): MissingDelegationResponse { return q.access === "owner"
  ? { protocol: "missing-delegations-v1", siteId: q.siteId, actorId: missingDelegationOwner, mode: q.mode, timeZone: "UTC", canWrite: q.mode !== "recover",
    items: q.mode === "list" ? [missingDelegationGrant()] : [], catalogItems: q.mode === "catalog" ? [missingDelegationCatalogItem(q.catalog!)] : [], nextId: null,
    detail: q.mode === "detail" ? missingDelegationGrant() : null, receipt: null, readAt: missingDelegationReadAt }
  : { protocol: "delegated-missing-v1", siteId: q.siteId, actorId: missingDelegationAuth, employeeId: missingDelegationEmployee, mode: q.mode, canWrite: q.mode !== "recover",
    grants: q.mode === "grants" ? [missingDelegationGrant()] : [], items: q.mode === "list" ? [missingDelegationSummary()] : [], nextCursor: null, nextId: null,
    detail: q.mode === "detail" ? missingDelegationDetail() : null, receipt: null, readAt: missingDelegationReadAt }; }
export function missingDelegationHttp(q = missingDelegationQuery()) { return { ok: true, ...missingDelegationWire(q) }; }
export async function missingDelegationReceiptHttp(q: MissingDelegationQuery, c: MissingDelegationCommand) {
  const commandFingerprint = await missingDelegationCommandFingerprint(q.siteId, q.access, c), operationId = missingDelegationOperation(c), result = missingDelegationWire(q);
  const recordedAt = "2026-10-06T11:00:00.000000Z";
  if (result.protocol === "missing-delegations-v1" && "action" in c) return { ok: true, ...result, items: [], catalogItems: [], nextId: null, detail: null,
    receipt: { operationId, action: c.action, grantId: c.action === "grant" ? c.operationId : c.grantId, revision: c.action === "grant" ? 1 : 2, recordedAt, commandFingerprint } };
  if (result.protocol !== "delegated-missing-v1" || !("decision" in c)) throw Error("fixture_access");
  return { ok: true, ...result, grants: [], items: [], nextCursor: null, nextId: null, detail: null,
    receipt: { operationId, requestId: c.decision.requestId, grantId: c.grantId, action: c.decision.action, status: c.decision.action === "approve" ? "approved" : "rejected",
      actorId: result.actorId, recordedAt, commandFingerprint } };
}
