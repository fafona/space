import { applicationDelegationCommandFingerprint, applicationDelegationOperation, type ApplicationDelegationAccess, type ApplicationDelegationQuery,
  type ApplicationDelegationCommand, type ApplicationDelegationGrantCommand, type ApplicationDelegationDecideCommand, type ApplicationDelegationGrant,
  type ApplicationDelegationCatalog, type ApplicationDelegationCatalogItem, type ApplicationDelegationSummary, type ApplicationDelegationDetail,
  type ApplicationDelegationCategory, type ApplicationDelegationResponse } from "../../src/lib/merchantAttendanceApplicationDelegation";
export const applicationDelegationId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const id = applicationDelegationId;
export const applicationDelegationOwner = id(1), applicationDelegationEmployee = id(2), applicationDelegationAuth = id(3), applicationDelegationWorker = id(4);
export const applicationDelegationReadAt = "2026-10-06T12:00:00.000000Z";
export function applicationDelegationQuery(access: ApplicationDelegationAccess = "delegate", mode?: string): ApplicationDelegationQuery {
  if (access === "owner") return { siteId: "99990001", access, mode: (mode ?? "list") as "list" | "catalog" | "detail" | "recover",
    catalog: mode === "catalog" ? "delegates" : null, grantId: mode === "detail" ? id(10) : null, operationId: mode === "recover" ? id(30) : null, afterId: null };
  return { siteId: "99990001", access, mode: (mode ?? "grants") as "grants" | "list" | "detail" | "decide" | "recover", grantId: ["list", "detail", "decide"].includes(mode ?? "") ? id(10) : null,
    requestId: ["detail", "decide"].includes(mode ?? "") ? id(20) : null, operationId: mode === "recover" ? id(30) : null, beforeAt: null, beforeId: null, afterId: null };
}
export function applicationDelegationGrant(category: ApplicationDelegationCategory = "leave"): ApplicationDelegationGrant { return { grantId: id(10), revision: 1, status: "granted",
  delegate: { employeeId: id(2), authUserId: id(3), name: "Synthetic delegate" }, worker: { workerId: id(4), employeeId: id(5), authUserId: id(6), name: "Synthetic worker", workerNo: "SYN-4" },
  category, kinds: category === "leave" ? [] : ["trip", "field", "remote"], includePending: false, validFrom: "2026-10-01T00:00:00.000000Z", validUntil: "2026-11-01T00:00:00.000000Z",
  grantedBy: id(1), grantedAt: "2026-09-30T12:00:00.000000Z", reason: "Synthetic bounded authorization", revocation: null, usable: true }; }
export function applicationDelegationGrantCommand(category: ApplicationDelegationCategory = "leave"): ApplicationDelegationGrantCommand { const g = applicationDelegationGrant(category); return { action: "grant", operationId: g.grantId,
  delegateEmployeeId: g.delegate.employeeId, delegateAuthUserId: g.delegate.authUserId, workerId: g.worker.workerId, employeeId: g.worker.employeeId,
  employeeAuthUserId: g.worker.authUserId, category: g.category, kinds: g.kinds, includePending: g.includePending, validFrom: g.validFrom, validUntil: g.validUntil, reason: g.reason }; }
export function applicationDelegationCommand(category: ApplicationDelegationCategory = "leave"): ApplicationDelegationDecideCommand { return { grantId: id(10), expectedGrantRevision: 1, expectedEvidenceFingerprint: "e".repeat(64),
  decision: { action: "approve", operationId: id(30), requestId: id(20), expectedRevision: 1, reason: "Synthetic review",
    ...(category === "work_arrangement" ? { expectedConflictsFingerprint: "a".repeat(64), confirmConflicts: false } : {}) } }; }
export function applicationDelegationCatalogItem(kind: ApplicationDelegationCatalog): ApplicationDelegationCatalogItem { const g = applicationDelegationGrant(); return kind === "delegates"
  ? { id: g.delegate.employeeId, employeeId: g.delegate.employeeId, employeeAuthUserId: g.delegate.authUserId, name: g.delegate.name, workerNo: null, timeZone: null }
  : { id: g.worker.workerId, employeeId: g.worker.employeeId, employeeAuthUserId: g.worker.authUserId, name: g.worker.name, workerNo: g.worker.workerNo, timeZone: null }; }
export function applicationDelegationSummary(category: ApplicationDelegationCategory = "leave"): ApplicationDelegationSummary { return { requestId: id(20), workerId: id(4), employeeId: id(5), employeeAuthUserId: id(6), workerName: "Synthetic worker",
  category, kind: category === "leave" ? null : "trip", startAt: "2026-10-03T08:00:00.000Z", endAt: "2026-10-03T10:00:00.000Z", timeZone: "UTC", submittedAt: "2026-10-04T12:00:00.000000Z", status: "submitted" }; }
export function applicationDelegationDetail(category: ApplicationDelegationCategory = "leave"): ApplicationDelegationDetail { return { ...applicationDelegationSummary(category), reason: "Synthetic application reason", evidenceFingerprint: "e".repeat(64), conflictsFingerprint: "a".repeat(64), conflicts: [], blocked: false, sealed: false, canApprove: true, canReject: true }; }
export function applicationDelegationWire(q = applicationDelegationQuery(), category: ApplicationDelegationCategory = "leave"): ApplicationDelegationResponse { return q.access === "owner"
  ? { protocol: "application-delegations-v1", siteId: q.siteId, actorId: applicationDelegationOwner, mode: q.mode, timeZone: "UTC", canWrite: q.mode !== "recover",
    items: q.mode === "list" ? [applicationDelegationGrant(category)] : [], catalogItems: q.mode === "catalog" ? [applicationDelegationCatalogItem(q.catalog!)] : [], nextId: null,
    detail: q.mode === "detail" ? applicationDelegationGrant(category) : null, receipt: null, readAt: applicationDelegationReadAt }
  : { protocol: "delegated-applications-v1", siteId: q.siteId, actorId: applicationDelegationAuth, employeeId: applicationDelegationEmployee, mode: q.mode, canWrite: q.mode !== "recover",
    grants: q.mode === "grants" ? [applicationDelegationGrant(category)] : [], items: q.mode === "list" ? [applicationDelegationSummary(category)] : [], nextCursor: null, nextId: null,
    detail: q.mode === "detail" ? applicationDelegationDetail(category) : null, receipt: null, readAt: applicationDelegationReadAt }; }
export function applicationDelegationHttp(q = applicationDelegationQuery(), category: ApplicationDelegationCategory = "leave") { return { ok: true, ...applicationDelegationWire(q, category) }; }
export async function applicationDelegationReceiptHttp(q: ApplicationDelegationQuery, c: ApplicationDelegationCommand, category: ApplicationDelegationCategory = "decision" in c && "expectedConflictsFingerprint" in c.decision ? "work_arrangement" : "leave") {
  const commandFingerprint = await applicationDelegationCommandFingerprint(q.siteId, q.access, c), operationId = applicationDelegationOperation(c), result = applicationDelegationWire(q);
  const recordedAt = "2026-10-06T11:00:00.000000Z";
  if (result.protocol === "application-delegations-v1" && "action" in c) return { ok: true, ...result, items: [], catalogItems: [], nextId: null, detail: null,
    receipt: { operationId, action: c.action, grantId: c.action === "grant" ? c.operationId : c.grantId, revision: c.action === "grant" ? 1 : 2, recordedAt, commandFingerprint } };
  if (result.protocol !== "delegated-applications-v1" || !("decision" in c)) throw Error("fixture_access");
  return { ok: true, ...result, grants: [], items: [], nextCursor: null, nextId: null, detail: null,
    receipt: { operationId, requestId: c.decision.requestId, grantId: c.grantId, category, action: c.decision.action, status: c.decision.action === "approve" ? "approved" : "rejected",
      actorId: result.actorId, recordedAt, commandFingerprint } };
}
