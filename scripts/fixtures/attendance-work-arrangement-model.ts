import type { WorkArrangementAccess, WorkArrangementCommand, WorkArrangementDetail, WorkArrangementItem, WorkArrangementQuery,
  WorkArrangementResult, WorkArrangementResponse, WorkArrangementPreviewInput } from "../../src/lib/merchantAttendanceWorkArrangement";
export const workArrangementId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const workArrangementOwner = workArrangementId(1), workArrangementEmployee = workArrangementId(2), workArrangementAuth = workArrangementId(3), workArrangementWorker = workArrangementId(4);
export const workArrangementSpan = (): WorkArrangementPreviewInput => ({ kind: "trip", timeZone: "Europe/Madrid", startAt: "2026-10-05T07:00:00.000Z", endAt: "2026-10-05T15:00:00.000Z" });
export const workArrangementQuery = (access: WorkArrangementAccess = "self"): WorkArrangementQuery => ({ siteId: "99990001", access, requestId: null, operationId: null, beforeAt: null, beforeId: null, preview: null });
export const workArrangementCommand = (): WorkArrangementCommand => ({ action: "submit", operationId: workArrangementId(10), reason: "Synthetic trip",
  expectedWorkerId: workArrangementWorker, expectedSettingsVersion: 1, expectedPolicyRevision: 0, ...workArrangementSpan() });
export const workArrangementItem = (): WorkArrangementItem => ({ ...workArrangementSpan(), requestId: workArrangementId(10), workerId: workArrangementWorker,
  employeeId: workArrangementEmployee, employeeAuthUserId: workArrangementAuth, workerName: "Synthetic <worker>", submittedAt: "2026-10-04T09:00:00.000001Z",
  policyRevision: 0, retrospectiveDays: 30, revision: 1, status: "submitted" });
export const workArrangementDetail = (access: WorkArrangementAccess = "self"): WorkArrangementDetail => ({ ...workArrangementItem(), reason: "Synthetic trip",
  history: [{ operationId: workArrangementId(10), revision: 1, action: "submit", actorId: workArrangementAuth, reason: "Synthetic trip", recordedAt: workArrangementItem().submittedAt,
    command: workArrangementCommand() }], conflicts: [], conflictsFingerprint: "a".repeat(64), sealed: false, issues: [],
  canWithdraw: access === "self", canApprove: access === "owner", canReject: access === "owner", canCancel: false });
export const workArrangementResult = (access: WorkArrangementAccess = "self"): WorkArrangementResult => ({ protocol: "work-arrangement-v1", siteId: "99990001", access,
  actorId: access === "self" ? workArrangementAuth : workArrangementOwner, employeeId: access === "self" ? workArrangementEmployee : null,
  workerId: access === "self" ? workArrangementWorker : null, timeZone: "Europe/Madrid", settingsVersion: 1, canSubmit: access === "self",
  policy: { operationId: null, revision: 0, retrospectiveDays: 30, actorId: null, recordedAt: null }, items: [], nextCursor: null,
  detail: null, receipt: null, preview: null, readAt: "2026-10-06T12:00:00.000001Z" });
export function workArrangementHttp(access: WorkArrangementAccess = "self", moduleEnabled = true): WorkArrangementResponse & { ok: true } {
  return { ok: true, ...workArrangementResult(access), moduleEnabled };
}
export function workArrangementPreviewHttp() {
  const r = workArrangementHttp(); r.preview = { ...workArrangementSpan(), conflicts: [], conflictsFingerprint: "a".repeat(64), sealed: false, issues: [], canSubmit: true }; return r;
}
export function workArrangementReceiptHttp(command = workArrangementCommand(), detail = true) {
  const r = workArrangementHttp(command.action === "submit" || command.action === "withdraw" ? "self" : "owner");
  if (command.action === "set_policy") {
    r.policy = { operationId: command.operationId, revision: command.expectedRevision + 1, retrospectiveDays: command.retrospectiveDays, actorId: workArrangementOwner, recordedAt: r.readAt };
    r.receipt = { command, item: null, policy: { ...r.policy } }; return r;
  }
  const d = workArrangementDetail(r.access);
  if (command.action === "submit") { d.requestId = command.operationId; d.history[0].operationId = command.operationId; d.history[0].command = command; d.history[0].reason = command.reason; d.reason = command.reason;
    d.kind = command.kind; d.startAt = command.startAt; d.endAt = command.endAt; d.timeZone = command.timeZone; d.policyRevision = command.expectedPolicyRevision; }
  else { d.revision = command.expectedRevision + 1; d.status = command.action === "approve" ? "approved" : command.action === "withdraw" ? "withdrawn" : command.action === "reject" ? "rejected" : "cancelled";
    d.history.push({ operationId: command.operationId, revision: d.revision, action: command.action, actorId: r.actorId, reason: command.reason, recordedAt: r.readAt, command });
    d.canWithdraw = false; d.canApprove = false; d.canReject = false; d.canCancel = command.action === "approve" && r.access === "owner"; }
  r.detail = detail ? d : null;
  const item = { ...workArrangementItem(), requestId: d.requestId, kind: d.kind, startAt: d.startAt, endAt: d.endAt, timeZone: d.timeZone,
    revision: d.revision, status: d.status, policyRevision: d.policyRevision };
  r.receipt = { command, item, policy: null }; return r;
}
