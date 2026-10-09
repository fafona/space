//209 local intent builders only; formats and checkboxes grant no authority.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree } from "./merchantAttendanceDelegatedAudit";
import { parseManagementDelegationCommand, type ManagementDelegationGrantCommand } from "./merchantAttendanceManagementDelegation";
import { managementConfigurationUtcInput } from "./merchantAttendanceDelegatedConfigurationUi";
import * as p from "./merchantAttendanceDelegatedPlanExceptions";
export type ManagementPlanExceptionsGrantForm = Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string; workerId: string;
  employeeId: string; employeeAuthUserId: string; locationIds: string; includePending: boolean; validFrom: string; validUntil: string; reason: string; acknowledged: boolean }>;
export type ManagementPlanExceptionsDraft = Readonly<{ outcome: string; note: string; acknowledged: boolean }>;
function invalid(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
// React StrictMode replays setup -> cleanup -> setup with the SAME memoized
// clients. Cancel their leases immediately; only terminally retire an instance
// after the replay window when its workspace is still genuinely unmounted.
export function retireManagementPlanExceptionsClients(clients: readonly Readonly<{ pause: () => void; dispose: () => void }>[], isMounted: () => boolean) {
  const retired = [...clients]; retired.forEach(client => client.pause());
  queueMicrotask(() => { let replayed = false; try { replayed = isMounted() === true; } catch { /* A failed lifecycle check cannot retain a terminal instance. */ }
    if (!replayed) retired.forEach(client => client.dispose()); });
}
export function buildManagementPlanExceptionsGrant(raw: unknown, operationId: string): ManagementDelegationGrantCommand {
  assertDelegatedAuditTree(raw, 8192); const d = captureBrowserExact(raw, ["delegateEmployeeId", "delegateAuthUserId", "workerId", "employeeId", "employeeAuthUserId",
    "locationIds", "includePending", "validFrom", "validUntil", "reason", "acknowledged"]);
  if (d.acknowledged !== true || typeof d.locationIds !== "string" || typeof d.reason !== "string") return invalid();
  const command = parseManagementDelegationCommand({ action: "grant", operationId, delegateEmployeeId: d.delegateEmployeeId, delegateAuthUserId: d.delegateAuthUserId,
    delegatedAction: "plan_exception_decide", scope: { kind: "formal_exception", workerId: d.workerId, employeeId: d.employeeId, employeeAuthUserId: d.employeeAuthUserId,
      locationIds: d.locationIds.trim().split(/[\s,]+/).sort(), includePending: d.includePending }, validFrom: managementConfigurationUtcInput(d.validFrom),
    validUntil: managementConfigurationUtcInput(d.validUntil), reason: d.reason.trim() });
  return command.action === "grant" ? command : invalid();
}
export async function buildManagementPlanExceptionsCommand(rawContext: unknown, rawQuery: p.DelegatedPlanExceptionsContextQuery, actualActor: string,
  rawDraft: unknown, operationId: string): Promise<p.DelegatedPlanExceptionsCommand> {
  assertDelegatedAuditTree(rawDraft, 4096); const draft = captureBrowserExact(rawDraft, ["outcome", "note", "acknowledged"]);
  if (draft.acknowledged !== true || typeof draft.note !== "string") return invalid();
  const query = p.parseDelegatedPlanExceptionsQuery(rawQuery); if (query.mode !== "context") return invalid();
  const result = await p.parseDelegatedPlanExceptionsResult(rawContext, query, actualActor); if (result.kind !== "context" || !result.context.review.detail?.current) return invalid();
  const d = result.context.review.detail;
  return p.delegatedPlanExceptionsCommandForContext(result, { operationId, expectedRevision: d.revision, expectedFingerprint: d.current!.fingerprint,
    employeeId: result.scope.employeeId, employeeAuthUserId: result.scope.employeeAuthUserId, outcome: draft.outcome, note: draft.note.trim() });
}
