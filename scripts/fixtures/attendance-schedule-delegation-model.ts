import { scheduleDelegationFingerprint, scheduleDelegationOperation, type ScheduleDelegationQuery, type ScheduleDelegationCommand,
  type ScheduleDelegationGrant, type ScheduleDelegationGrantCommand, type ScheduleDelegationResult, type ScheduleDelegationCatalogItem,
  type ScheduleDelegationCatalog, type ScheduleDelegationDecisionCommand } from "../../src/lib/merchantAttendanceScheduleDelegation";

/** Pure model fixture, not a database/authentication or historical-publication proof. */
export const scheduleDelegationId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const id = scheduleDelegationId;
export const scheduleDelegationTime = "2026-10-06T12:00:00.123456Z";
export function scheduleDelegationQuery(access: ScheduleDelegationQuery["access"] = "delegate", mode: ScheduleDelegationQuery["mode"] = access === "owner" ? "list" : "grants"): ScheduleDelegationQuery {
  return { siteId: "98400198", access, mode, catalog: mode === "catalog" ? "delegates" : null, grantId: ["detail", "schedule"].includes(mode) ? id(10) : null,
    afterId: null, fromDate: mode === "schedule" ? "2026-10-07" : null, throughDate: mode === "schedule" ? "2026-10-08" : null, operationId: mode === "recover" ? id(30) : null };
}
export function scheduleDelegationGrant(): ScheduleDelegationGrant { return { grantId: id(10), revision: 1, status: "granted",
  delegate: { employeeId: id(2), authUserId: id(3), name: "主管" }, worker: { workerId: id(4), employeeId: id(5), authUserId: id(6), name: "员工", workerNo: "001" },
  location: { id: id(7), name: "工作地点", timeZone: "UTC" }, actions: ["publish", "cancel"], includeExistingFuture: true,
  validFrom: "2026-10-01T00:00:00.000000Z", validUntil: "2026-11-01T00:00:00.000000Z", grantedBy: id(1), grantedAt: scheduleDelegationTime,
  reason: "明确排班范围", revocation: null, usableActions: ["publish", "cancel"] }; }
export function scheduleDelegationGrantCommand(): ScheduleDelegationGrantCommand { return { action: "grant", operationId: id(30), delegateEmployeeId: id(2), delegateAuthUserId: id(3), workerId: id(4),
  employeeId: id(5), employeeAuthUserId: id(6), locationId: id(7), actions: ["publish", "cancel"], includeExistingFuture: true,
  validFrom: "2026-10-01T00:00:00.000000Z", validUntil: "2026-11-01T00:00:00.000000Z", reason: "明确  范围" }; }
export function scheduleDelegationCommand(action: "publish" | "cancel" = "publish"): ScheduleDelegationDecisionCommand {
  const base = { operationId: id(30), expectedRevision: 1, expectedSettingsVersion: 1, reason: "明确  排班" };
  return { expectedGrantRevision: 1, decision: action === "publish" ? { ...base, action, locationId: id(7), timeZone: "UTC", slots: [["2026-10-07T09:00:00.000Z", "2026-10-07T17:00:00.000Z"]] }
    : { ...base, action, slotId: id(20) } };
}
export function scheduleDelegationCatalog(kind: ScheduleDelegationCatalog): ScheduleDelegationCatalogItem[] {
  return kind === "delegates" ? [{ id: id(2), name: "主管", employeeId: id(2), employeeAuthUserId: id(3), workerNo: null, timeZone: null }]
    : kind === "workers" ? [{ id: id(4), name: "员工", employeeId: id(5), employeeAuthUserId: id(6), workerNo: "001", timeZone: null }]
      : [{ id: id(7), name: "工作地点", employeeId: null, employeeAuthUserId: null, workerNo: null, timeZone: "UTC" }];
}
export function scheduleDelegationWire(q = scheduleDelegationQuery()): ScheduleDelegationResult { const g = scheduleDelegationGrant();
  return { protocol: "schedule-delegation-v1", siteId: q.siteId, access: q.access, actorId: q.access === "owner" ? id(1) : id(3), employeeId: q.access === "owner" ? null : id(2), mode: q.mode,
    canWrite: q.mode !== "recover", grants: ["list", "grants"].includes(q.mode) ? [g] : [], catalogItems: q.mode === "catalog" ? scheduleDelegationCatalog(q.catalog!) : [], nextAfterId: null,
    detail: q.mode === "detail" ? g : null, schedule: q.mode === "schedule" ? { grant: g, revision: 1, settingsVersion: 1, timeZone: "UTC", workerVersion: 1, locationVersion: 1, readAt: scheduleDelegationTime,
      rangeLimited: false, entries: [{ slotId: id(20), revision: 1, workerId: id(4), locationId: id(7), timeZone: "UTC", workDate: "2026-10-07", startAt: "2026-10-07T09:00:00.000Z", endAt: "2026-10-07T17:00:00.000Z",
        publishedAt: scheduleDelegationTime, publishedBy: id(1), cancelled: false, cancelledAt: null, cancelledBy: null, canCancel: true }] } : null,
    receipt: null, readAt: scheduleDelegationTime };
}
export async function scheduleDelegationReceiptHttp(q: ScheduleDelegationQuery, c: ScheduleDelegationCommand, recoverQuery?: ScheduleDelegationQuery) {
  const r = scheduleDelegationWire(recoverQuery ?? q), action = "decision" in c ? c.decision.action : c.action;
  return { ok: true, ...r, canWrite: false, grants: [], catalogItems: [], nextAfterId: null, detail: null, schedule: null,
    receipt: { operationId: scheduleDelegationOperation(c), action, grantId: "decision" in c ? q.grantId! : c.action === "grant" ? c.operationId : c.grantId,
      grantRevision: action === "revoke" ? 2 as const : 1 as const, scheduleRevision: "decision" in c ? c.decision.expectedRevision + 1 : null,
      actorId: r.actorId, recordedAt: scheduleDelegationTime, commandFingerprint: await scheduleDelegationFingerprint(q, c) } };
}
