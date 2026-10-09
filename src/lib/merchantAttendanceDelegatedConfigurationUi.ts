//205 UI-only intent builders. UUID shape is not authority: the real RPC must
//recheck current Auth, grant, generations and every business constraint.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree, delegatedAuditStamp } from "./merchantAttendanceDelegatedAudit";
import { parseManagementDelegationCommand, type ManagementDelegationGrantCommand } from "./merchantAttendanceManagementDelegation";
import { delegatedConfigurationCommandForContext, parseDelegatedConfigurationQuery, parseDelegatedConfigurationResult,
  type DelegatedConfigurationCommand, type DelegatedConfigurationQuery } from "./merchantAttendanceDelegatedConfiguration";

type GrantFields = Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string; create: boolean;
  validFrom: string; validUntil: string; reason: string; acknowledged: boolean }>;
export type ManagementConfigurationGrantDraft = GrantFields & Readonly<
  { delegatedAction: "worker_save"; workerId: string; employeeId: string; employeeAuthUserId: string; locationIds: readonly string[] }
  | { delegatedAction: "location_save"; locationId: string }>;
export type ManagementConfigurationCommandDraft = Readonly<
  { kind: "worker"; workerNo: string; displayName: string; locationId: string; startsOn: string; active: boolean; acknowledged: boolean }
  | { kind: "location"; name: string; timeZone: string; active: boolean; acknowledged: boolean }>;
export type ManagementConfigurationContextQuery = Extract<DelegatedConfigurationQuery, { mode: "context" }>;

function invalid(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function trimmed(value: unknown): string { return typeof value === "string" ? value.trim() : invalid(); }

//Same explicitly-UTC control semantics as managementUtcInput, without importing
//a React component or interpreting datetime-local in the machine's local zone.
export function managementConfigurationUtcInput(raw: unknown): string {
  if (typeof raw !== "string" || raw !== raw.trim()) return invalid();
  let value = raw;
  if (/^20\d\d-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?$/.test(value)) {
    const [base, fraction = ""] = value.split(".");
    value = (base.length === 16 ? base + ":00" : base) + "." + fraction.padEnd(6, "0") + "Z";
  }
  return delegatedAuditStamp(value);
}

export function buildManagementConfigurationGrant(raw: unknown, operationId: string): ManagementDelegationGrantCommand {
  assertDelegatedAuditTree(raw, 8192);
  const action = Object.getOwnPropertyDescriptor(raw, "delegatedAction")?.value;
  if (action !== "worker_save" && action !== "location_save") return invalid();
  const common = ["delegateEmployeeId", "delegateAuthUserId", "delegatedAction", "create", "validFrom", "validUntil", "reason", "acknowledged"];
  const draft = captureBrowserExact(raw, [...common, ...(action === "worker_save" ? ["workerId", "employeeId", "employeeAuthUserId", "locationIds"] : ["locationId"])]);
  if (draft.acknowledged !== true) return invalid();
  if (action === "worker_save" && !Array.isArray(draft.locationIds)) return invalid();
  const scope = action === "worker_save"
    ? { kind: "worker", create: draft.create, workerId: draft.workerId, employeeId: draft.employeeId, employeeAuthUserId: draft.employeeAuthUserId,
      locationIds: [...draft.locationIds as unknown[]].sort() }
    : { kind: "location", create: draft.create, locationId: draft.locationId };
  const command = parseManagementDelegationCommand({ action: "grant", operationId, delegateEmployeeId: draft.delegateEmployeeId,
    delegateAuthUserId: draft.delegateAuthUserId, delegatedAction: action, scope, validFrom: managementConfigurationUtcInput(draft.validFrom),
    validUntil: managementConfigurationUtcInput(draft.validUntil), reason: trimmed(draft.reason) });
  if (command.action !== "grant") return invalid();
  return command;
}

export async function buildManagementConfigurationCommand(rawFreshContext: unknown, rawQuery: ManagementConfigurationContextQuery, actualActor: string,
  rawDraft: unknown, operationId: string): Promise<DelegatedConfigurationCommand> {
  assertDelegatedAuditTree(rawDraft, 8192);
  const kind = Object.getOwnPropertyDescriptor(rawDraft, "kind")?.value;
  if (kind !== "worker" && kind !== "location") return invalid();
  const fields = kind === "worker" ? ["kind", "workerNo", "displayName", "locationId", "startsOn", "active", "acknowledged"]
    : ["kind", "name", "timeZone", "active", "acknowledged"];
  //Capture UI primitives before the strict context parser's asynchronous edge.
  const draft = { ...captureBrowserExact(rawDraft, fields) };
  if (draft.acknowledged !== true) return invalid();
  const changes = kind === "worker" ? { workerNo: trimmed(draft.workerNo), displayName: trimmed(draft.displayName), locationId: draft.locationId,
    startsOn: draft.startsOn, active: draft.active } : { name: trimmed(draft.name), timeZone: draft.timeZone, active: draft.active };
  const query = parseDelegatedConfigurationQuery(rawQuery);
  if (query.mode !== "context") return invalid();
  const result = await parseDelegatedConfigurationResult(rawFreshContext, query, actualActor);
  if (result.kind !== "context") return invalid();
  const scope = result.scope;
  if (kind === "worker" && scope.kind === "worker" && result.action === "worker_save") {
    return delegatedConfigurationCommandForContext(result, { kind, operationId, expectedVersion: result.context.settingsVersion,
      values: { id: scope.workerId, employeeId: scope.employeeId, ...changes } });
  }
  if (kind === "location" && scope.kind === "location" && result.action === "location_save") {
    return delegatedConfigurationCommandForContext(result, { kind, operationId, expectedVersion: result.context.settingsVersion,
      values: { id: scope.locationId, ...changes } });
  }
  return invalid();
}
