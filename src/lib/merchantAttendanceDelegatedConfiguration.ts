//205: two scoped configuration commands, not a merchant-wide admin proxy.
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ATTENDANCE_ADMIN_ERRORS, parseAttendanceAdminCommand, type AttendanceAdminCommand, type AttendanceAdminLocation, type AttendanceAdminWorker } from "./merchantAttendanceAdmin";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree, delegatedAuditStamp } from "./merchantAttendanceDelegatedAudit";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze } from "./merchantAttendanceOperationalRuleLedger";
import { parseManagementDelegationScope, type ManagementDelegationScope } from "./merchantAttendanceManagementDelegation";

export const DELEGATED_CONFIGURATION_PROTOCOL = "attendance-delegated-configuration-v1" as const;
export const DELEGATED_CONFIGURATION_API = "/api/merchant-enterprise/attendance/delegated-configuration";
export const DELEGATED_CONFIGURATION_REQUEST_BYTES = 8192;
export const DELEGATED_CONFIGURATION_RESULT_BYTES = 131072;
export type DelegatedConfigurationAction = "worker_save" | "location_save";
export type DelegatedConfigurationCommand = Exclude<AttendanceAdminCommand, { kind: "settings" }>;
export type DelegatedConfigurationScope = Extract<ManagementDelegationScope, { kind: "worker" | "location" }>;
export type DelegatedConfigurationQuery = Readonly<{ siteId: string; grantId: string } & (
  { mode: "context"; operationId: null } | { mode: "recover"; operationId: string })>;
export type DelegatedConfigurationReceipt = Readonly<{ operationId: string; actorId: string; grantId: string; action: DelegatedConfigurationAction;
  referenceId: string; revision: number; commandFingerprint: string; businessFingerprint: string; recordedAt: string }>;
export type DelegatedConfigurationContext = Readonly<{ settingsVersion: number; targetVersion: number | null;
  worker: AttendanceAdminWorker | null; employee: Readonly<{ id: string; displayName: string }> | null; locations: readonly AttendanceAdminLocation[] }>;
type Base = Readonly<{ protocol: typeof DELEGATED_CONFIGURATION_PROTOCOL; siteId: string; actorId: string; readAt: string }>;
export type DelegatedConfigurationResult = Base & Readonly<{ kind: "receipt"; receipt: DelegatedConfigurationReceipt | null }
  | { kind: "context"; grantId: string; action: DelegatedConfigurationAction; scope: DelegatedConfigurationScope; context: DelegatedConfigurationContext }>;
export const DELEGATED_CONFIGURATION_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  ...Object.fromEntries(Object.entries(ATTENDANCE_ADMIN_ERRORS).map(([code, value]) => [code, value.status])),
  attendance_delegated_configuration_disabled: 403, attendance_delegated_configuration_invalid: 503,
});
function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
const exact = captureBrowserExact, freeze = operationalRuleLedgerFreeze;
function version(v: unknown): number { return typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 9007199254740990 ? v : fail(); }
function text(v: unknown, max: number): string {
  return typeof v === "string" && v.length >= 1 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v) ? v : fail();
}
function action(v: unknown): DelegatedConfigurationAction { return v === "worker_save" || v === "location_save" ? v : fail(); }
export function delegatedConfigurationAction(c: DelegatedConfigurationCommand): DelegatedConfigurationAction { return c.kind === "worker" ? "worker_save" : "location_save"; }
export function parseDelegatedConfigurationQuery(raw: unknown): DelegatedConfigurationQuery {
  assertDelegatedAuditTree(raw, 4096); const q = exact(raw, ["siteId", "grantId", "mode", "operationId"]);
  const siteId = attendanceSelfSite(q.siteId), grantId = attendanceSelfUuid(q.grantId);
  if (q.mode === "context" && q.operationId === null) return freeze({ siteId, grantId, mode: "context", operationId: null });
  if (q.mode === "recover") return freeze({ siteId, grantId, mode: "recover", operationId: attendanceSelfUuid(q.operationId) });
  return fail();
}
export function delegatedConfigurationQueryString(raw: DelegatedConfigurationQuery): string {
  const q = parseDelegatedConfigurationQuery(raw);
  return new URLSearchParams({ siteId: q.siteId, grantId: q.grantId, mode: q.mode, operationId: q.operationId ?? "" }).toString();
}
export function parseDelegatedConfigurationCommand(raw: unknown): DelegatedConfigurationCommand {
  assertDelegatedAuditTree(raw, DELEGATED_CONFIGURATION_REQUEST_BYTES); const c = exact(raw, ["kind", "values", "operationId", "expectedVersion"]);
  if (c.kind !== "worker" && c.kind !== "location") return fail();
  if (version(c.expectedVersion) >= 9007199254740990) return fail();
  const fields = c.kind === "worker" ? ["id", "employeeId", "workerNo", "displayName", "locationId", "active", "startsOn"] : ["id", "name", "timeZone", "active"];
  const values = exact(c.values, fields);
  if (c.kind === "worker") { text(values.workerNo, 40); text(values.displayName, 120); } else text(values.name, 120);
  const parsed = parseAttendanceAdminCommand({ siteId: "99990205", kind: c.kind, values, operationId: c.operationId, expectedVersion: version(c.expectedVersion) }).command;
  if (parsed.kind === "settings") return fail(); return freeze(parsed);
}
export function parseDelegatedConfigurationBody(raw: unknown) {
  assertDelegatedAuditTree(raw, DELEGATED_CONFIGURATION_REQUEST_BYTES); const b = exact(raw, ["query", "command"]), query = parseDelegatedConfigurationQuery(b.query);
  if (query.mode !== "context") return fail(); return freeze({ query, command: parseDelegatedConfigurationCommand(b.command) });
}
export function parseDelegatedConfigurationJson(raw: string, request = true): unknown {
  const limit = request ? DELEGATED_CONFIGURATION_REQUEST_BYTES : DELEGATED_CONFIGURATION_RESULT_BYTES;
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > limit) return fail();
  const parsed = parseCaptureBrowserJson(raw); assertDelegatedAuditTree(parsed, limit); return parsed;
}
export function delegatedConfigurationFingerprintText(rawQuery: DelegatedConfigurationQuery, actualActor: string, rawCommand: DelegatedConfigurationCommand): string {
  const q = parseDelegatedConfigurationQuery(rawQuery), c = parseDelegatedConfigurationCommand(rawCommand);
  if (q.mode === "recover" && q.operationId !== c.operationId) return fail();
  const fields = c.kind === "worker" ? [c.values.id, c.values.employeeId, c.values.workerNo, c.values.displayName, c.values.locationId, c.values.active, c.values.startsOn] : [c.values.id, c.values.name, c.values.timeZone, c.values.active];
  return operationalRuleLedgerEncode(["attendance-delegated-configuration-command-v1", q.siteId, attendanceSelfUuid(actualActor), q.grantId, [c.kind, c.operationId, c.expectedVersion, fields]]);
}
export async function delegatedConfigurationCommandFingerprint(q: DelegatedConfigurationQuery, actor: string, c: DelegatedConfigurationCommand): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(delegatedConfigurationFingerprintText(q, actor, c)));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function location(raw: unknown): AttendanceAdminLocation {
  const v = exact(raw, ["id", "name", "timeZone", "active"]);
  const c = parseDelegatedConfigurationCommand({ kind: "location", operationId: "00000000-0000-4000-8000-000000000001", expectedVersion: 1, values: v });
  return c.kind === "location" ? c.values : fail();
}
function worker(raw: unknown): AttendanceAdminWorker {
  const c = parseDelegatedConfigurationCommand({ kind: "worker", operationId: "00000000-0000-4000-8000-000000000001", expectedVersion: 1, values: raw });
  return c.kind === "worker" ? c.values : fail();
}
function receipt(raw: unknown): DelegatedConfigurationReceipt {
  const r = exact(raw, ["operationId", "actorId", "grantId", "action", "referenceId", "revision", "commandFingerprint", "businessFingerprint", "recordedAt"]);
  if (typeof r.commandFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(r.commandFingerprint) || typeof r.businessFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(r.businessFingerprint)) return fail();
  return { operationId: attendanceSelfUuid(r.operationId), actorId: attendanceSelfUuid(r.actorId), grantId: attendanceSelfUuid(r.grantId), action: action(r.action), referenceId: attendanceSelfUuid(r.referenceId),
    revision: version(r.revision), commandFingerprint: r.commandFingerprint, businessFingerprint: r.businessFingerprint, recordedAt: delegatedAuditStamp(r.recordedAt) };
}
export async function parseDelegatedConfigurationResult(raw: unknown, rawQuery: DelegatedConfigurationQuery, actualActor: string, expected: DelegatedConfigurationCommand | null = null): Promise<DelegatedConfigurationResult> {
  try {
    assertDelegatedAuditTree(raw, DELEGATED_CONFIGURATION_RESULT_BYTES); const q = parseDelegatedConfigurationQuery(rawQuery), actorId = attendanceSelfUuid(actualActor), c = expected === null ? null : parseDelegatedConfigurationCommand(expected);
    if (c && q.mode === "recover" && q.operationId !== c.operationId) return fail();
    const kind = Object.getOwnPropertyDescriptor(raw, "kind")?.value, v = exact(raw, ["protocol", "siteId", "actorId", "readAt", "kind", ...(kind === "receipt" ? ["receipt"] : ["grantId", "action", "scope", "context"])]);
    if (v.protocol !== DELEGATED_CONFIGURATION_PROTOCOL || v.siteId !== q.siteId || v.actorId !== actorId) return fail();
    const base = { protocol: DELEGATED_CONFIGURATION_PROTOCOL, siteId: q.siteId, actorId, readAt: delegatedAuditStamp(v.readAt) };
    if (kind === "receipt") {
      const r = v.receipt === null ? null : receipt(v.receipt);
      if (q.mode !== "recover" && c === null || r && (r.actorId !== actorId || r.grantId !== q.grantId || r.recordedAt > base.readAt || r.operationId !== (c?.operationId ?? q.operationId))) return fail();
      if (r && c && (r.action !== delegatedConfigurationAction(c) || r.referenceId !== c.values.id || r.revision !== c.expectedVersion + 1 || r.commandFingerprint !== await delegatedConfigurationCommandFingerprint(q, actorId, c))) return fail();
      if (q.mode === "context" && r === null) return fail(); return freeze({ ...base, kind: "receipt", receipt: r });
    }
    if (kind !== "context" || q.mode !== "context" || c !== null || v.grantId !== q.grantId) return fail();
    const a = action(v.action), scope = parseManagementDelegationScope(v.scope, a);
    if (scope.kind !== "worker" && scope.kind !== "location") return fail();
    const context = exact(v.context, ["settingsVersion", "targetVersion", "worker", "employee", "locations"]);
    if (!Array.isArray(context.locations) || context.locations.length > 25) return fail();
    const locations = context.locations.map(location), w = context.worker === null ? null : worker(context.worker), e = context.employee === null ? null : exact(context.employee, ["id", "displayName"]);
    const employee = e === null ? null : { id: attendanceSelfUuid(e.id), displayName: text(e.displayName, 120) }, targetVersion = context.targetVersion === null ? null : version(context.targetVersion);
    if (locations.some((l, i) => i > 0 && locations[i - 1].id >= l.id)) return fail();
    if (scope.create !== (targetVersion === null)) return fail();
    if (scope.kind === "worker") {
      if (employee?.id !== scope.employeeId || (w === null) !== scope.create || w && (w.id !== scope.workerId || w.employeeId !== scope.employeeId || !scope.locationIds.includes(w.locationId)) || locations.length !== scope.locationIds.length || locations.some((l, i) => l.id !== scope.locationIds[i])) return fail();
    } else if (w !== null || employee !== null || locations.length !== (scope.create ? 0 : 1) || locations[0] && locations[0].id !== scope.locationId) return fail();
    return freeze({ ...base, kind: "context", grantId: q.grantId, action: a, scope, context: { settingsVersion: version(context.settingsVersion), targetVersion, worker: w, employee, locations } });
  } catch { return fail("attendance_delegated_configuration_invalid"); }
}
export function delegatedConfigurationCommandForContext(result: Extract<DelegatedConfigurationResult, { kind: "context" }>, raw: unknown): DelegatedConfigurationCommand {
  const c = parseDelegatedConfigurationCommand(raw), scope = result.scope;
  if (delegatedConfigurationAction(c) !== result.action || c.expectedVersion !== result.context.settingsVersion) return fail();
  if (c.kind === "worker" ? scope.kind !== "worker" || c.values.id !== scope.workerId || c.values.employeeId !== scope.employeeId || !scope.locationIds.includes(c.values.locationId)
    : scope.kind !== "location" || c.values.id !== scope.locationId) return fail();
  return c;
}
