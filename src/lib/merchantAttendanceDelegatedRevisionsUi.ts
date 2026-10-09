//208 UI intent builders only. Fresh SQL independently checks the real grant,
//submitted record, identities, locations and existing decision policy.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree } from "./merchantAttendanceDelegatedAudit";
import { parseManagementDelegationCommand, type ManagementDelegationGrantCommand } from "./merchantAttendanceManagementDelegation";
import { managementConfigurationUtcInput } from "./merchantAttendanceDelegatedConfigurationUi";
import * as r from "./merchantAttendanceDelegatedRevisions";

export type ManagementRevisionsGrantForm = Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string;
  delegatedAction: "revision_approve" | "revision_reject"; workerId: string; employeeId: string; employeeAuthUserId: string;
  locationIds: string; includePending: boolean; validFrom: string; validUntil: string; reason: string; acknowledged: boolean }>;
export type ManagementRevisionsDraft = Readonly<{ reason: string; acknowledged: boolean }>;
export const delegatedRevisionActionLabels = { revision_approve: "批准指定连续修订", revision_reject: "驳回指定连续修订" };
function invalid(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
export function managementRevisionsContextQuery(siteId: string, grantId: string, requestId: string): r.DelegatedRevisionsContextQuery {
  const query = r.parseDelegatedRevisionsQuery({ siteId, grantId, mode: "context", requestId });
  return query.mode === "context" ? query : invalid();
}
export function buildManagementRevisionsGrant(raw: unknown, operationId: string): ManagementDelegationGrantCommand {
  assertDelegatedAuditTree(raw, 8192);
  const d = captureBrowserExact(raw, ["delegateEmployeeId", "delegateAuthUserId", "delegatedAction", "workerId", "employeeId", "employeeAuthUserId",
    "locationIds", "includePending", "validFrom", "validUntil", "reason", "acknowledged"]);
  if (d.acknowledged !== true || (d.delegatedAction !== "revision_approve" && d.delegatedAction !== "revision_reject")
    || typeof d.locationIds !== "string" || typeof d.reason !== "string") return invalid();
  const command = parseManagementDelegationCommand({ action: "grant", operationId, delegateEmployeeId: d.delegateEmployeeId, delegateAuthUserId: d.delegateAuthUserId,
    delegatedAction: d.delegatedAction, scope: { kind: "revision", workerId: d.workerId, employeeId: d.employeeId, employeeAuthUserId: d.employeeAuthUserId,
      locationIds: d.locationIds.trim().split(/[\s,]+/).sort(), includePending: d.includePending },
    validFrom: managementConfigurationUtcInput(d.validFrom), validUntil: managementConfigurationUtcInput(d.validUntil), reason: d.reason.trim() });
  return command.action === "grant" ? command : invalid();
}
export async function buildManagementRevisionsCommand(rawContext: unknown, rawQuery: r.DelegatedRevisionsContextQuery, actualActor: string,
  rawDraft: unknown, operationId: string): Promise<r.DelegatedRevisionsCommand> {
  assertDelegatedAuditTree(rawDraft, 4096);
  const captured = captureBrowserExact(rawDraft, ["reason", "acknowledged"]), reason = typeof captured.reason === "string" ? captured.reason.trim() : invalid(), acknowledged = captured.acknowledged;
  const query = r.parseDelegatedRevisionsQuery(rawQuery); if (query.mode !== "context" || acknowledged !== true) return invalid();
  const result = await r.parseDelegatedRevisionsResult(rawContext, query, actualActor);
  if (result.kind !== "context" || !(result.action === "revision_approve" ? result.context.canApprove : result.context.canReject)) return invalid();
  const review = result.context.review;
  return r.parseDelegatedRevisionsBody({ query, command: { action: result.action === "revision_approve" ? "approve" : "reject", operationId,
    requestId: query.requestId, expectedRevision: review.review.submittedRevision, expectedEvidence: review.evidenceToken,
    expectedBaseOperationId: review.review.base.operationId, reason } }).command;
}
