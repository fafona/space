// Synthetic protocol examples only. No real Auth, source collection or SQL.
import { ADMINISTRATIVE_CLOSURE_PROTOCOL, ADMINISTRATIVE_CLOSURE_BOUNDARY_PROTOCOL, administrativeClosureCommandFingerprint,
  type AdministrativeClosureCommand, type AdministrativeClosureQuery, type AdministrativeClosureData, type AdministrativeClosureResult,
  type AdministrativeClosureDetail, type AdministrativeClosureFrame, type AdministrativeClosureContext, type AdministrativeClosureEntry } from "./merchantAttendanceAdministrativeClosure";
export const closureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const closureSite = "99990001", closureOwner = closureId(1), closureSelf = closureId(2);
export const closureAt = "2026-10-08T12:00:00.123456Z", closureEnd = "2026-10-08T11:00:00.000001Z";
export function closureFrame(): AdministrativeClosureFrame { return { workerId: closureId(3), employeeId: closureId(4), employeeAuthUserId: closureSelf,
  employmentPeriodId: closureId(5), startEventId: closureId(6), startSequence: 1, startAt: "2026-10-08T08:00:00.000001Z", suspensionId: closureId(7), generation: 1,
  tailEventId: closureId(6), tailSequence: 1, tailAction: "clock_in", tailOccurredAt: "2026-10-08T08:00:00.000001Z", timeZone: "Europe/Madrid" }; }
export const closureContext = (): AdministrativeClosureContext => ({ workerVersion: 2, employeeVersion: 1, settingsVersion: 3, employmentRevision: 1, sourceFingerprint: "a".repeat(64) });
export const closureQuery = (): Extract<AdministrativeClosureQuery, { mode: "candidate" }> => ({ siteId: closureSite, access: "owner", mode: "candidate", workerId: closureId(3) });
export const closureCommand = (): Extract<AdministrativeClosureCommand, { action: "close" }> => ({ operationId: closureId(100), startEventId: closureId(6), expectedRevision: 0, action: "close", reason: "Synthetic verified administrative end",
  workerId: closureId(3), expectedSourceFingerprint: "a".repeat(64), verifiedEndAt: closureEnd });
export const closureNoCaps = () => ({ canRecordUnknown: false, canClose: false, canDispute: false, canRespond: false });
export const closureCandidate = (): AdministrativeClosureDetail => ({ summary: null, frame: closureFrame(), context: closureContext(), evidenceOperationId: null, currentEntry: null, closure: null,
  capabilities: { ...closureNoCaps(), canClose: true, canRecordUnknown: true }, blockers: [] });
export function closureResult(data: AdministrativeClosureData, q: AdministrativeClosureQuery = closureQuery(), actor = q.access === "owner" ? closureOwner : closureSelf): AdministrativeClosureResult {
  return { protocol: ADMINISTRATIVE_CLOSURE_PROTOCOL, siteId: q.siteId, access: q.access, actorId: actor, readAt: closureAt, data };
}
export async function closureReceiptResult(command: AdministrativeClosureCommand = closureCommand(), q: AdministrativeClosureQuery = closureQuery(), actor = q.access === "owner" ? closureOwner : closureSelf) {
  const commandFingerprint = await administrativeClosureCommandFingerprint(q.siteId, actor, q.access, command);
  return closureResult({ kind: "receipt", receipt: { operationId: command.operationId, startEventId: command.startEventId, revision: command.expectedRevision + 1, action: command.action, actorId: actor, recordedAt: closureAt, commandFingerprint } }, q, actor);
}
export async function closureSavedDetail(access: "owner" | "self" = "owner", disputed = false) {
  const c = closureCommand(), receipt = (await closureReceiptResult(c)).data; if (receipt.kind !== "receipt" || !receipt.receipt || c.action !== "close") throw Error("fixture");
  const entry: AdministrativeClosureEntry = { ...receipt.receipt, actorAccess: "owner", reason: c.reason, verifiedEndAt: c.verifiedEndAt, disputeOperationId: null, frame: closureFrame(), context: closureContext() };
  const summary = { startEventId: c.startEventId, identity: { workerId: closureId(3), employeeId: closureId(4), employeeAuthUserId: closureSelf }, employmentPeriodId: closureId(5), state: "closed" as const,
    revision: 1, verifiedEndAt: c.verifiedEndAt, closedOperationId: c.operationId, hasDispute: disputed, updatedAt: closureAt };
  const detail: AdministrativeClosureDetail = { summary, frame: closureFrame(), context: closureContext(), evidenceOperationId: c.operationId, currentEntry: entry,
    closure: { ...closureFrame(), protocol: ADMINISTRATIVE_CLOSURE_BOUNDARY_PROTOCOL, siteId: closureSite, operationId: c.operationId, revision: 1, verifiedEndAt: c.verifiedEndAt, recordedAt: closureAt, sourceFingerprint: closureContext().sourceFingerprint },
    capabilities: { ...closureNoCaps(), canDispute: access === "self", canRespond: access === "owner" && disputed }, blockers: [] };
  if (disputed) { const cmd: AdministrativeClosureCommand = { action: "self_dispute", operationId: closureId(101), startEventId: c.startEventId, expectedRevision: 1, expectedClosedOperationId: c.operationId, reason: "Synthetic employee disagreement" };
    const fp = await administrativeClosureCommandFingerprint(closureSite, closureSelf, "self", cmd);
    return { ...detail, summary: { ...summary, revision: 2 }, currentEntry: { operationId: cmd.operationId, startEventId: cmd.startEventId, revision: 2, action: "self_dispute" as const, actorAccess: "self" as const,
      actorId: closureSelf, reason: cmd.reason, verifiedEndAt: null, disputeOperationId: null, frame: null, context: null, recordedAt: closureAt, commandFingerprint: fp } };
  }
  return detail;
}
