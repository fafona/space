//202 SOURCE contract: owner-managed, exact action/resource delegation only.
//This file neither authorizes a real actor nor exposes a business executor.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { OPERATIONAL_RULE_KEYS } from "./merchantAttendanceOperationalRules";
import { RULE_KEYS } from "./merchantAttendanceRuleDraft";

export const MANAGEMENT_DELEGATION_PROTOCOL = "attendance-management-delegations-v1" as const;
export const MANAGEMENT_DELEGATION_API = "/api/merchant-enterprise/attendance/management-delegation";
export const MANAGEMENT_DELEGATION_REQUEST_BYTES = 16384;
export const MANAGEMENT_DELEGATION_RESULT_BYTES = 524288;
export const MANAGEMENT_DELEGATION_CAPABILITIES = Object.freeze([
  "attendance.workers.manage", "attendance.groups.manage", "attendance.locations.manage",
  "attendance.rules.draft", "attendance.rules.publish", "attendance.rules.withdraw",
  "attendance.terminals.pair", "attendance.terminals.revoke", "attendance.pin.issue", "attendance.pin.revoke",
  "attendance.correction.revision.review", "attendance.plan_exception.review", "attendance.audit.view", "attendance.audit.export",
] as const);
export type ManagementDelegationCapability = typeof MANAGEMENT_DELEGATION_CAPABILITIES[number];
export const MANAGEMENT_DELEGATION_ACTION_CAPABILITY = Object.freeze({
  worker_save: "attendance.workers.manage", group_save: "attendance.groups.manage", group_assign: "attendance.groups.manage",
  group_end: "attendance.groups.manage", group_cancel: "attendance.groups.manage", location_save: "attendance.locations.manage",
  rule_draft: "attendance.rules.draft", rule_publish: "attendance.rules.publish", rule_withdraw: "attendance.rules.withdraw",
  personal_rule_approve: "attendance.rules.publish", personal_rule_withdraw: "attendance.rules.withdraw",
  operational_rule_draft: "attendance.rules.draft", operational_rule_publish: "attendance.rules.publish", operational_rule_withdraw: "attendance.rules.withdraw",
  terminal_prepare: "attendance.terminals.pair", terminal_revoke: "attendance.terminals.revoke", pin_issue: "attendance.pin.issue", pin_revoke: "attendance.pin.revoke",
  revision_approve: "attendance.correction.revision.review", revision_reject: "attendance.correction.revision.review",
  plan_exception_decide: "attendance.plan_exception.review", audit_view: "attendance.audit.view", audit_export: "attendance.audit.export",
} as const satisfies Record<string, ManagementDelegationCapability>);
export type ManagementDelegationAction = keyof typeof MANAGEMENT_DELEGATION_ACTION_CAPABILITY;
export const MANAGEMENT_DELEGATION_ACTIONS = Object.freeze(Object.keys(MANAGEMENT_DELEGATION_ACTION_CAPABILITY) as ManagementDelegationAction[]);
type WorkerBinding = Readonly<{ workerId: string; employeeId: string; employeeAuthUserId: string }>;
type Locations = Readonly<{ locationIds: readonly string[] }>;
export type ManagementDelegationRuleSubject = Readonly<{ kind: "enterprise" } | { kind: "group"; groupId: string } | ({ kind: "personal" } & WorkerBinding)>;
export type ManagementDelegationScope = Readonly<
  ({ kind: "worker"; create: boolean } & WorkerBinding & Locations)
  | { kind: "group"; groupId: string; create: boolean }
  | ({ kind: "group_worker"; groupId: string; assignmentId: string | null } & WorkerBinding & Locations)
  | { kind: "location"; locationId: string; create: boolean }
  | { kind: "rules"; family: "base" | "personal" | "operational"; subject: ManagementDelegationRuleSubject; allowedRuleKeys: readonly string[]; locationIds: readonly string[] }
  | { kind: "terminal"; terminalId: string; locationId: string; create: boolean }
  | ({ kind: "member_pin" } & WorkerBinding & Locations)
  | ({ kind: "independent_pin"; workerId: string; subjectId: string; generation: number } & Locations)
  | ({ kind: "revision" | "formal_exception"; includePending: boolean } & WorkerBinding & Locations)
  | ({ kind: "audit_worker"; sources: readonly ("config" | "scope" | "management")[] } & WorkerBinding & Locations)
  | { kind: "audit_company"; sources: readonly ("config" | "management")[] }
>;
export type ManagementDelegationQuery = Readonly<
  { siteId: string; mode: "list"; afterId: string | null; state: "all" | "granted" | "revoked"; delegatedAction: ManagementDelegationAction | null }
  | { siteId: string; mode: "detail"; grantId: string }
  | { siteId: string; mode: "recover"; operationId: string }
  | { siteId: string; mode: "write" }
>;
export type ManagementDelegationGrantCommand = Readonly<{ action: "grant"; operationId: string; delegateEmployeeId: string; delegateAuthUserId: string;
  delegatedAction: ManagementDelegationAction; scope: ManagementDelegationScope; validFrom: string; validUntil: string; reason: string }>;
export type ManagementDelegationRevokeCommand = Readonly<{ action: "revoke"; operationId: string; grantId: string; expectedRevision: 1; reason: string }>;
export type ManagementDelegationCommand = ManagementDelegationGrantCommand | ManagementDelegationRevokeCommand;
export type ManagementDelegationReceipt = Readonly<{ operationId: string; actorId: string; action: "grant" | "revoke"; grantId: string;
  revision: 1 | 2; commandFingerprint: string; recordedAt: string }>;
export type ManagementDelegationGrant = Readonly<{ grantId: string; revision: 1 | 2; status: "granted" | "revoked"; ownerId: string;
  delegate: Readonly<{ employeeId: string; authUserId: string; generation: number }>; delegatedAction: ManagementDelegationAction;
  capability: ManagementDelegationCapability; scope: ManagementDelegationScope; targetGeneration: number | null;
  validFrom: string; validUntil: string; reason: string; grantedAt: string;
  revocation: Readonly<{ operationId: string; actorId: string; reason: string; recordedAt: string }> | null;
  //Lock-protected current authority observation only, not a business executor.
  authorityCurrent: boolean }>;
type ResultBase = Readonly<{ protocol: typeof MANAGEMENT_DELEGATION_PROTOCOL; siteId: string; actorId: string; readAt: string }>;
export type ManagementDelegationResult = ResultBase & Readonly<
  { kind: "list"; canGrant: boolean; items: readonly ManagementDelegationGrant[]; nextId: string | null }
  | { kind: "detail"; canGrant: boolean; item: ManagementDelegationGrant }
  | { kind: "receipt"; receipt: ManagementDelegationReceipt | null }
>;
export const MANAGEMENT_DELEGATION_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_management_delegation_disabled: 403,
  attendance_management_delegation_invalid: 503, attendance_management_delegation_not_found: 404,
  attendance_management_delegation_scope_invalid: 409, attendance_management_delegation_changed: 409,
  attendance_management_delegation_limit: 422, attendance_operation_conflict: 409,
  attendance_settings_required: 409, attendance_unavailable: 503,
});
const fail = (code = "attendance_invalid_request"): never => { throw new MerchantAttendanceError(code); };
const exact = captureBrowserExact;
const uuid = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const site = (v: unknown): string => typeof v === "string" && /^[0-9]{8}$/.test(v) ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const integer = (v: unknown, minimum = 0): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= minimum && v <= 9007199254740990 ? v : fail();
const label = (v: unknown): string => typeof v === "string" && v === v.trim() && [...v].length >= 1 && [...v].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
const fingerprint = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const stamp = (v: unknown): string => { if (typeof v !== "string" || !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v)) return fail();
  const ms = v.slice(0, 23) + "Z", n = Date.parse(ms); return Number.isFinite(n) && new Date(n).toISOString() === ms ? v : fail(); };
const action = (v: unknown): ManagementDelegationAction => typeof v === "string" && Object.hasOwn(MANAGEMENT_DELEGATION_ACTION_CAPABILITY, v) ? v as ManagementDelegationAction : fail();
const freeze = <T>(v: T): T => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
function tree(raw: unknown, bytes = MANAGEMENT_DELEGATION_REQUEST_BYTES) {
  let nodes = 0; const seen = new Set<object>();
  const walk = (v: unknown, depth: number): void => {
    if (++nodes > 24000 || depth > 14) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) fail(); return; }
    if (typeof v === "string") { if (v.length > bytes) fail(); for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) { const d = v.charCodeAt(++i); if (!(d >= 0xdc00 && d <= 0xdfff)) fail(); }
      else if (c >= 0xdc00 && c <= 0xdfff) fail(); } return; }
    if (typeof v !== "object" || seen.has(v)) return fail(); seen.add(v);
    const proto = Object.getPrototypeOf(v), descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
    if (Array.isArray(v)) { if (proto !== Array.prototype || v.length > 100 || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = descriptors[String(i)]; if (!d || !d.enumerable || !Object.hasOwn(d, "value")) fail(); walk(d.value, depth + 1); } }
    else { if (proto !== Object.prototype && proto !== null) fail(); for (const k of keys) {
      if (typeof k !== "string" || ["__proto__", "constructor", "prototype"].includes(k)) return fail();
      const d = descriptors[k]; if (!d.enumerable || !Object.hasOwn(d, "value")) fail(); walk(d.value, depth + 1); } }
    seen.delete(v);
  }; walk(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > bytes) fail();
}
const binding = (v: Record<string, unknown>): WorkerBinding => ({ workerId: uuid(v.workerId), employeeId: uuid(v.employeeId), employeeAuthUserId: uuid(v.employeeAuthUserId) });
function ordered<T extends string>(raw: unknown, allowed: readonly T[] | null, minimum: number, maximum: number): readonly T[] {
  if (!Array.isArray(raw) || raw.length < minimum || raw.length > maximum) return fail(); let previous: string | null = null;
  return raw.map(v => { const result = allowed === null ? uuid(v) : typeof v === "string" && allowed.includes(v as T) ? v : fail();
    if (previous !== null && result <= previous) fail(); previous = result; return result as T; });
}
const locations = (v: unknown, minimum = 1) => ordered<string>(v, null, minimum, 25);
function subject(raw: unknown): ManagementDelegationRuleSubject {
  const kind = Object.getOwnPropertyDescriptor(raw, "kind")?.value;
  if (kind === "enterprise") { exact(raw, ["kind"]); return { kind }; }
  if (kind === "group") { const s = exact(raw, ["kind", "groupId"]); return { kind, groupId: uuid(s.groupId) }; }
  if (kind !== "personal") return fail(); return { kind, ...binding(exact(raw, ["kind", "workerId", "employeeId", "employeeAuthUserId"])) };
}
function parseScope(raw: unknown): ManagementDelegationScope {
  const kind = Object.getOwnPropertyDescriptor(raw, "kind")?.value;
  if (kind === "worker") { const s = exact(raw, ["kind", "create", "workerId", "employeeId", "employeeAuthUserId", "locationIds"]);
    return { kind, create: bool(s.create), ...binding(s), locationIds: locations(s.locationIds) }; }
  if (kind === "group") { const s = exact(raw, ["kind", "groupId", "create"]); return { kind, groupId: uuid(s.groupId), create: bool(s.create) }; }
  if (kind === "group_worker") { const s = exact(raw, ["kind", "groupId", "assignmentId", "workerId", "employeeId", "employeeAuthUserId", "locationIds"]);
    return { kind, groupId: uuid(s.groupId), assignmentId: s.assignmentId === null ? null : uuid(s.assignmentId), ...binding(s), locationIds: locations(s.locationIds) }; }
  if (kind === "location") { const s = exact(raw, ["kind", "locationId", "create"]); return { kind, locationId: uuid(s.locationId), create: bool(s.create) }; }
  if (kind === "rules") { const s = exact(raw, ["kind", "family", "subject", "allowedRuleKeys", "locationIds"]);
    if (!["base", "personal", "operational"].includes(String(s.family))) return fail();
    const family = s.family as "base" | "personal" | "operational", sub = subject(s.subject);
    if (family === "base" && sub.kind === "personal" || family === "personal" && sub.kind !== "personal") fail();
    return { kind, family, subject: sub, allowedRuleKeys: ordered(s.allowedRuleKeys, family === "operational" ? OPERATIONAL_RULE_KEYS : RULE_KEYS, 1, family === "operational" ? 8 : 4), locationIds: locations(s.locationIds, 0) }; }
  if (kind === "terminal") { const s = exact(raw, ["kind", "terminalId", "locationId", "create"]);
    return { kind, terminalId: uuid(s.terminalId), locationId: uuid(s.locationId), create: bool(s.create) }; }
  if (kind === "member_pin") { const s = exact(raw, ["kind", "workerId", "employeeId", "employeeAuthUserId", "locationIds"]); return { kind, ...binding(s), locationIds: locations(s.locationIds) }; }
  if (kind === "independent_pin") { const s = exact(raw, ["kind", "workerId", "subjectId", "generation", "locationIds"]);
    return { kind, workerId: uuid(s.workerId), subjectId: uuid(s.subjectId), generation: integer(s.generation, 1), locationIds: locations(s.locationIds) }; }
  if (kind === "revision" || kind === "formal_exception") { const s = exact(raw, ["kind", "workerId", "employeeId", "employeeAuthUserId", "locationIds", "includePending"]);
    return { kind, ...binding(s), locationIds: locations(s.locationIds), includePending: bool(s.includePending) }; }
  if (kind === "audit_worker") { const s = exact(raw, ["kind", "workerId", "employeeId", "employeeAuthUserId", "locationIds", "sources"]);
    return { kind, ...binding(s), locationIds: locations(s.locationIds), sources: ordered(s.sources, ["config", "scope", "management"] as const, 1, 3) }; }
  if (kind === "audit_company") { const s = exact(raw, ["kind", "sources"]); return { kind, sources: ordered(s.sources, ["config", "management"] as const, 1, 2) }; }
  return fail();
}
function scopeMatches(a: ManagementDelegationAction, s: ManagementDelegationScope): boolean {
  if (a === "worker_save") return s.kind === "worker";
  if (a === "group_save") return s.kind === "group";
  if (a === "group_assign" || a === "group_end" || a === "group_cancel") return s.kind === "group_worker" && (a === "group_assign") === (s.assignmentId === null);
  if (a === "location_save") return s.kind === "location";
  if (a.startsWith("operational_rule_")) return s.kind === "rules" && s.family === "operational";
  if (a.startsWith("personal_rule_")) return s.kind === "rules" && s.family === "personal";
  if (a.startsWith("rule_")) return s.kind === "rules" && s.family === "base";
  if (a === "terminal_prepare" || a === "terminal_revoke") return s.kind === "terminal" && s.create === (a === "terminal_prepare");
  if (a === "pin_issue" || a === "pin_revoke") return s.kind === "member_pin" || s.kind === "independent_pin";
  if (a === "revision_approve" || a === "revision_reject") return s.kind === "revision";
  if (a === "plan_exception_decide") return s.kind === "formal_exception";
  return (a === "audit_view" || a === "audit_export") && (s.kind === "audit_worker" || s.kind === "audit_company");
}
export function parseManagementDelegationScope(raw: unknown, delegatedAction: ManagementDelegationAction): ManagementDelegationScope {
  try { tree(raw); const a = action(delegatedAction), s = parseScope(raw); if (!scopeMatches(a, s)) fail(); return freeze(s); } catch { return fail(); }
}
export function managementDelegationTargetBinding(s: ManagementDelegationScope): WorkerBinding | null {
  if ("employeeId" in s) return { workerId: s.workerId, employeeId: s.employeeId, employeeAuthUserId: s.employeeAuthUserId };
  return s.kind === "rules" && s.subject.kind === "personal" ? { workerId: s.subject.workerId, employeeId: s.subject.employeeId, employeeAuthUserId: s.subject.employeeAuthUserId } : null;
}
export function parseManagementDelegationQuery(raw: unknown): ManagementDelegationQuery {
  try { tree(raw); const mode = Object.getOwnPropertyDescriptor(raw, "mode")?.value;
    if (mode === "list") { const q = exact(raw, ["siteId", "mode", "afterId", "state", "delegatedAction"]);
      if (!["all", "granted", "revoked"].includes(String(q.state))) return fail();
      return freeze({ siteId: site(q.siteId), mode, afterId: q.afterId === null ? null : uuid(q.afterId), state: q.state as "all" | "granted" | "revoked", delegatedAction: q.delegatedAction === null ? null : action(q.delegatedAction) }); }
    if (mode === "detail") { const q = exact(raw, ["siteId", "mode", "grantId"]); return freeze({ siteId: site(q.siteId), mode, grantId: uuid(q.grantId) }); }
    if (mode === "recover") { const q = exact(raw, ["siteId", "mode", "operationId"]); return freeze({ siteId: site(q.siteId), mode, operationId: uuid(q.operationId) }); }
    if (mode === "write") { const q = exact(raw, ["siteId", "mode"]); return freeze({ siteId: site(q.siteId), mode }); }
    return fail();
  } catch { return fail(); }
}
export function managementDelegationQueryString(raw: ManagementDelegationQuery): string {
  const query = parseManagementDelegationQuery(raw), parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) parameters.set(key, value === null ? "" : String(value));
  return parameters.toString();
}
export function parseManagementDelegationHttpQuery(input: string | URL): ManagementDelegationQuery {
  try {
    const url = new URL(input), entries = [...url.searchParams.entries()];
    if (url.hash || String(input).includes("#") || entries.some(([key], index) => entries.findIndex(([k]) => k === key) !== index)) fail();
    const raw: Record<string, unknown> = Object.fromEntries(entries);
    for (const key of ["afterId", "delegatedAction"]) if (Object.hasOwn(raw, key) && raw[key] === "") raw[key] = null;
    const query = parseManagementDelegationQuery(raw); if (query.mode === "write") fail(); return query;
  } catch { return fail(); }
}
export function parseManagementDelegationCommand(raw: unknown): ManagementDelegationCommand {
  try { tree(raw); const a = Object.getOwnPropertyDescriptor(raw, "action")?.value;
    if (a === "revoke") { const c = exact(raw, ["action", "operationId", "grantId", "expectedRevision", "reason"]); if (c.expectedRevision !== 1) return fail();
      return freeze({ action: a, operationId: uuid(c.operationId), grantId: uuid(c.grantId), expectedRevision: 1 as const, reason: label(c.reason) }); }
    if (a !== "grant") return fail(); const c = exact(raw, ["action", "operationId", "delegateEmployeeId", "delegateAuthUserId", "delegatedAction", "scope", "validFrom", "validUntil", "reason"]);
    const delegatedAction = action(c.delegatedAction), scope = parseManagementDelegationScope(c.scope, delegatedAction);
    const result: ManagementDelegationGrantCommand = { action: a, operationId: uuid(c.operationId), delegateEmployeeId: uuid(c.delegateEmployeeId), delegateAuthUserId: uuid(c.delegateAuthUserId),
      delegatedAction, scope, validFrom: stamp(c.validFrom), validUntil: stamp(c.validUntil), reason: label(c.reason) };
    const target = managementDelegationTargetBinding(scope);
    if (result.validFrom >= result.validUntil || target && !["audit_view", "audit_export"].includes(delegatedAction)
      && (target.employeeId === result.delegateEmployeeId || target.employeeAuthUserId === result.delegateAuthUserId)) fail();
    return freeze(result);
  } catch { return fail(); }
}
export function parseManagementDelegationBody(raw: unknown) {
  try { tree(raw); const b = exact(raw, ["query", "command"]), query = parseManagementDelegationQuery(b.query), command = parseManagementDelegationCommand(b.command);
    if (query.mode !== "write") fail(); return freeze({ query, command }); } catch { return fail(); }
}
export function parseManagementDelegationJson(raw: string, request = true): unknown {
  try { const maximum = request ? MANAGEMENT_DELEGATION_REQUEST_BYTES : MANAGEMENT_DELEGATION_RESULT_BYTES;
    if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > maximum) fail(); const value = parseCaptureBrowserJson(raw); tree(value, maximum); return value;
  } catch { return fail(request ? "attendance_invalid_request" : "attendance_management_delegation_invalid"); }
}
type Tuple = string | number | boolean | null | readonly Tuple[];
const bindingTuple = (v: WorkerBinding): readonly Tuple[] => [v.workerId, v.employeeId, v.employeeAuthUserId];
function scopeTuple(s: ManagementDelegationScope): readonly Tuple[] {
  if (s.kind === "worker") return [s.kind, s.create, bindingTuple(s), s.locationIds];
  if (s.kind === "group") return [s.kind, s.groupId, s.create];
  if (s.kind === "group_worker") return [s.kind, s.groupId, s.assignmentId, bindingTuple(s), s.locationIds];
  if (s.kind === "location") return [s.kind, s.locationId, s.create];
  if (s.kind === "rules") return [s.kind, s.family, s.subject.kind === "enterprise" ? ["enterprise"] : s.subject.kind === "group" ? ["group", s.subject.groupId] : ["personal", bindingTuple(s.subject)], s.allowedRuleKeys, s.locationIds];
  if (s.kind === "terminal") return [s.kind, s.terminalId, s.locationId, s.create];
  if (s.kind === "member_pin") return [s.kind, bindingTuple(s), s.locationIds];
  if (s.kind === "independent_pin") return [s.kind, s.workerId, s.subjectId, s.generation, s.locationIds];
  if (s.kind === "revision" || s.kind === "formal_exception") return [s.kind, bindingTuple(s), s.locationIds, s.includePending];
  if (s.kind === "audit_worker") return [s.kind, bindingTuple(s), s.locationIds, s.sources];
  if (s.kind === "audit_company") return [s.kind, s.sources];
  return fail();
}
const tupleText = (value: Tuple): string => Array.isArray(value) ? `[${value.map(tupleText).join(", ")}]` : JSON.stringify(value);
export function managementDelegationFingerprintText(siteId: string, actorId: string, raw: ManagementDelegationCommand): string {
  const c = parseManagementDelegationCommand(raw), prefix: Tuple[] = ["attendance-management-delegation-command-v1", site(siteId), uuid(actorId), c.action, c.operationId];
  return tupleText(c.action === "grant" ? [...prefix, c.delegateEmployeeId, c.delegateAuthUserId, c.delegatedAction, scopeTuple(c.scope), c.validFrom, c.validUntil, c.reason]
    : [...prefix, c.grantId, c.expectedRevision, c.reason]);
}
export async function managementDelegationCommandFingerprint(siteId: string, actorId: string, c: ManagementDelegationCommand): Promise<string> {
  const result = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(managementDelegationFingerprintText(siteId, actorId, c)));
  return Array.from(new Uint8Array(result), v => v.toString(16).padStart(2, "0")).join("");
}
export function managementDelegationReceiptMatches(r: ManagementDelegationReceipt, c: ManagementDelegationCommand, actorId: string, fp: string): boolean {
  return r.actorId === actorId && r.operationId === c.operationId && r.action === c.action && r.commandFingerprint === fp
    && r.grantId === (c.action === "grant" ? c.operationId : c.grantId) && r.revision === (c.action === "grant" ? 1 : 2);
}
function grant(raw: unknown, readAt: string): ManagementDelegationGrant {
  const g = exact(raw, ["grantId", "revision", "status", "ownerId", "delegate", "delegatedAction", "capability", "scope", "targetGeneration", "validFrom", "validUntil", "reason", "grantedAt", "revocation", "authorityCurrent"]);
  const d = exact(g.delegate, ["employeeId", "authUserId", "generation"]), delegatedAction = action(g.delegatedAction), scope = parseManagementDelegationScope(g.scope, delegatedAction);
  const target = managementDelegationTargetBinding(scope), delegate = { employeeId: uuid(d.employeeId), authUserId: uuid(d.authUserId), generation: integer(d.generation) };
  const validFrom = stamp(g.validFrom), validUntil = stamp(g.validUntil), grantedAt = stamp(g.grantedAt);
  if (g.capability !== MANAGEMENT_DELEGATION_ACTION_CAPABILITY[delegatedAction] || validFrom >= validUntil || grantedAt > readAt
    || target && !["audit_view", "audit_export"].includes(delegatedAction) && (target.employeeId === delegate.employeeId || target.employeeAuthUserId === delegate.authUserId)
    || (target === null) !== (g.targetGeneration === null)) fail();
  let revocation: ManagementDelegationGrant["revocation"] = null;
  if (g.revocation !== null) { const r = exact(g.revocation, ["operationId", "actorId", "reason", "recordedAt"]);
    revocation = { operationId: uuid(r.operationId), actorId: uuid(r.actorId), reason: label(r.reason), recordedAt: stamp(r.recordedAt) };
    if (revocation.operationId === g.grantId || revocation.recordedAt < grantedAt || revocation.recordedAt > readAt) fail(); }
  const authorityCurrent = bool(g.authorityCurrent);
  if (g.revision !== (revocation ? 2 : 1) || g.status !== (revocation ? "revoked" : "granted") || authorityCurrent && (revocation !== null || readAt < validFrom || readAt >= validUntil)) fail();
  return { grantId: uuid(g.grantId), revision: g.revision as 1 | 2, status: g.status as "granted" | "revoked", ownerId: uuid(g.ownerId), delegate, delegatedAction,
    capability: g.capability as ManagementDelegationCapability, scope, targetGeneration: g.targetGeneration === null ? null : integer(g.targetGeneration), validFrom, validUntil, reason: label(g.reason), grantedAt, revocation, authorityCurrent };
}
export async function parseManagementDelegationResult(raw: unknown, input: ManagementDelegationQuery, actorId: string, command: ManagementDelegationCommand | null = null): Promise<ManagementDelegationResult> {
  try { tree(raw, MANAGEMENT_DELEGATION_RESULT_BYTES); const q = parseManagementDelegationQuery(input), a = uuid(actorId);
    if ((q.mode === "write") !== (command !== null)) fail(); if (command) parseManagementDelegationBody({ query: q, command });
    const kind = Object.getOwnPropertyDescriptor(raw, "kind")?.value, baseKeys = ["protocol", "siteId", "actorId", "readAt", "kind"];
    const v = exact(raw, [...baseKeys, ...(kind === "list" ? ["canGrant", "items", "nextId"] : kind === "detail" ? ["canGrant", "item"] : ["receipt"])]);
    if (v.protocol !== MANAGEMENT_DELEGATION_PROTOCOL || v.siteId !== q.siteId || v.actorId !== a) return fail();
    const base: ResultBase = { protocol: MANAGEMENT_DELEGATION_PROTOCOL, siteId: q.siteId, actorId: a, readAt: stamp(v.readAt) };
    if (q.mode === "list") { if (kind !== "list" || !Array.isArray(v.items) || v.items.length > 25) return fail(); let previous = q.afterId;
      const items = v.items.map(value => { const item = grant(value, base.readAt); if (previous !== null && item.grantId <= previous
        || q.state !== "all" && item.status !== q.state || q.delegatedAction !== null && item.delegatedAction !== q.delegatedAction) fail(); previous = item.grantId; return item; });
      const nextId = v.nextId === null ? null : uuid(v.nextId); if (nextId !== null && (items.length !== 25 || nextId !== previous)) fail();
      return freeze({ ...base, kind, canGrant: bool(v.canGrant), items, nextId }); }
    if (q.mode === "detail") { if (kind !== "detail") return fail(); const item = grant(v.item, base.readAt); if (item.grantId !== q.grantId) fail(); return freeze({ ...base, kind, canGrant: bool(v.canGrant), item }); }
    if (kind !== "receipt") return fail(); let receipt: ManagementDelegationReceipt | null = null;
    if (v.receipt !== null) { const r = exact(v.receipt, ["operationId", "actorId", "action", "grantId", "revision", "commandFingerprint", "recordedAt"]);
      if (r.action !== "grant" && r.action !== "revoke" || r.revision !== (r.action === "grant" ? 1 : 2)) fail();
      receipt = { operationId: uuid(r.operationId), actorId: uuid(r.actorId), action: r.action as "grant" | "revoke", grantId: uuid(r.grantId), revision: r.revision as 1 | 2, commandFingerprint: fingerprint(r.commandFingerprint), recordedAt: stamp(r.recordedAt) };
      if (receipt.actorId !== a || receipt.operationId !== (q.mode === "recover" ? q.operationId : command!.operationId) || receipt.recordedAt > base.readAt
        || receipt.action === "grant" && receipt.grantId !== receipt.operationId || command && !managementDelegationReceiptMatches(receipt, command, a, await managementDelegationCommandFingerprint(q.siteId, a, command))) fail(); }
    if (command && receipt === null) fail(); return freeze({ ...base, kind, receipt });
  } catch { return fail("attendance_management_delegation_invalid"); }
}
