//207 public NONSECRET contract only. It does not authorize an actor, derive a
//PIN, implement an RPC or prove a SQL postimage. Secret POST inputs have separate
//ephemeral types/parsers and never belong in commands, references or receipts.
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree, delegatedAuditStamp } from "./merchantAttendanceDelegatedAudit";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze } from "./merchantAttendanceOperationalRuleLedger";
import { parseTerminal, terminalSecret, TERMINAL_ERRORS, type AttendanceTerminal } from "./merchantAttendanceTerminal";
import { attendancePin, parsePinStatus, pinWorkerNo, PIN_ERRORS, type PinStatus } from "./merchantAttendancePin";
import { INDEPENDENT_ADMIN_PROTOCOL, INDEPENDENT_MAX_REVISION, parseIndependentAdminResult, parseIndependentCommand,
  type IndependentAdminData, type IndependentCommand } from "./merchantAttendanceIndependent";
import { MANAGEMENT_DELEGATION_ERRORS, parseManagementDelegationScope, type ManagementDelegationScope } from "./merchantAttendanceManagementDelegation";

export const DELEGATED_TERMINALS_PROTOCOL = "attendance-delegated-terminals-v1" as const;
export const DELEGATED_PIN_PROTOCOL = "attendance-delegated-pin-v1" as const;
export const DELEGATED_TERMINALS_API = "/api/merchant-enterprise/attendance/delegated-terminals";
export const DELEGATED_PIN_API = "/api/merchant-enterprise/attendance/delegated-pin";
export const DELEGATED_TERMINALS_RPC = "faolla_attendance_delegated_terminals_v1";
export const DELEGATED_PIN_RPC = "faolla_attendance_delegated_pin_v1";
//Future Node RPC arguments include a private fifth p_material parameter. It is
//NOT a public DTO field. Reads/non-PIN actions must pass null; no caller may
//supply raw PIN/pairSecret or an authority marker as that private material.
export const DELEGATED_CREDENTIALS_REQUEST_BYTES = 8192;
export const DELEGATED_CREDENTIALS_RESULT_BYTES = 262144;
export const DELEGATED_CREDENTIALS_ACTIONS = ["terminal_prepare", "terminal_revoke", "pin_issue", "pin_revoke"] as const;
//Finite browser-safe codes only; never return SQL text or unknown exceptions.
export const DELEGATED_TERMINALS_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  ...MANAGEMENT_DELEGATION_ERRORS, ...Object.fromEntries(Object.entries(TERMINAL_ERRORS).map(([code, value]) => [code, value.status])),
  attendance_delegated_terminals_disabled: 403, attendance_delegated_terminals_invalid: 503,
  attendance_version_conflict: 409, attendance_identity_changed: 409,
});
export const DELEGATED_PIN_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  ...MANAGEMENT_DELEGATION_ERRORS, ...Object.fromEntries(Object.entries(PIN_ERRORS).map(([code, value]) => [code, value.status])),
  attendance_delegated_pin_disabled: 403, attendance_delegated_pin_invalid: 503,
  attendance_independent_changed: 409, attendance_independent_not_found: 404, attendance_independent_bound: 409,
  attendance_independent_invalid: 503, attendance_independent_disabled: 403, attendance_independent_identity_changed: 409,
  attendance_version_conflict: 409, attendance_identity_changed: 409, attendance_worker_not_found: 404, attendance_worker_inactive: 409,
});
export type DelegatedTerminalAction = "terminal_prepare" | "terminal_revoke";
export type DelegatedPinAction = "pin_issue" | "pin_revoke";
export type DelegatedCredentialsAction = DelegatedTerminalAction | DelegatedPinAction;
export type DelegatedTerminalScope = Extract<ManagementDelegationScope, { kind: "terminal" }>;
export type DelegatedPinScope = Extract<ManagementDelegationScope, { kind: "member_pin" | "independent_pin" }>;
export type DelegatedCredentialsQuery = Readonly<{ siteId: string; grantId: string } & (
  { mode: "context"; operationId: null } | { mode: "recover"; operationId: string })>;
export type DelegatedCredentialsContextQuery = Extract<DelegatedCredentialsQuery, { mode: "context" }>;
type TerminalBase = Readonly<{ operationId: string; terminalId: string; locationId: string; reason: string }>;
export type DelegatedTerminalCommand = TerminalBase & Readonly<
  { action: "terminal_prepare"; label: string; pairHash: string } | { action: "terminal_revoke" }>;
type PinBase = Readonly<{ action: DelegatedPinAction; operationId: string; workerId: string; reason: string }>;
export type DelegatedMemberPinCommand = PinBase & Readonly<{ kind: "member_pin"; employeeId: string; employeeAuthUserId: string;
  workerNo: string; expectedRevision: number }>;
export type DelegatedIndependentPinCommand = PinBase & Readonly<{ kind: "independent_pin"; subjectId: string;
  expectedSubjectRevision: number; expectedGeneration: number; expectedWorkerVersion: number;
  expectedSettingsVersion: number; expectedCredentialRevision: number }>;
export type DelegatedPinCommand = DelegatedMemberPinCommand | DelegatedIndependentPinCommand;
export type DelegatedCredentialsCommand = DelegatedTerminalCommand | DelegatedPinCommand;
export type DelegatedTerminalBody = Readonly<{ query: DelegatedCredentialsContextQuery; command: DelegatedTerminalCommand }>;
export type DelegatedPinBody = Readonly<{ query: DelegatedCredentialsContextQuery; command: DelegatedPinCommand }>;
/** Ephemeral only: future Node must derive and verify pairHash from this secret.
 * Never serialize this shape into a durable pending slot, receipt or log. */
export type DelegatedTerminalPrepareEphemeralBody = Readonly<{ query: DelegatedCredentialsContextQuery;
  command: Extract<DelegatedTerminalCommand, { action: "terminal_prepare" }>; pairSecret: string }>;
/** Ephemeral only; future Node authenticates and checks the exact grant before
 * using the existing shared KDF. This type makes no KDF/material proof claim. */
export type DelegatedPinIssueEphemeralBody = Readonly<{ query: DelegatedCredentialsContextQuery;
  command: DelegatedPinCommand & { action: "pin_issue" }; pin: string }>;

//104 audit is keyed by (site,terminal,action), not a revision or row ordinal.
export type DelegatedTerminalReference = Readonly<{ kind: "terminal"; terminalId: string; locationId: string; auditAction: "create" | "revoke" }>;
export type DelegatedMemberPinReference = Readonly<{ kind: "member_pin"; workerId: string; employeeId: string;
  employeeAuthUserId: string; revision: number }>;
export type DelegatedIndependentPinReference = Readonly<{ kind: "independent_pin"; workerId: string; subjectId: string;
  subjectRevision: number; generation: number; workerVersion: number; credentialRevision: number }>;
export type DelegatedPinReference = DelegatedMemberPinReference | DelegatedIndependentPinReference;
type Receipt<A, R> = Readonly<{ operationId: string; actorId: string; grantId: string; action: A; reference: R;
  commandFingerprint: string; businessFingerprint: string; recordedAt: string }>;
export type DelegatedTerminalReceipt = Receipt<DelegatedTerminalAction, DelegatedTerminalReference>;
export type DelegatedPinReceipt = Receipt<DelegatedPinAction, DelegatedPinReference>;
export type DelegatedTerminalContext = Readonly<{ terminal: AttendanceTerminal | null;
  location: Readonly<{ locationId: string; name: string; timeZone: string; version: number; active: boolean }> }>;
export type DelegatedMemberPinContext = Readonly<{ status: PinStatus; employeeAuthUserId: string }>;
export type DelegatedIndependentPinContext = Readonly<{ settingsVersion: number;
  detail: Extract<IndependentAdminData, { kind: "detail" }> }>;
type Base<P> = Readonly<{ protocol: P; siteId: string; actorId: string; readAt: string }>;
export type DelegatedTerminalContextResult = Base<typeof DELEGATED_TERMINALS_PROTOCOL> & Readonly<{ kind: "context";
  grantId: string; action: DelegatedTerminalAction; scope: DelegatedTerminalScope; context: DelegatedTerminalContext }>;
export type DelegatedPinContextResult = Base<typeof DELEGATED_PIN_PROTOCOL> & Readonly<{ kind: "context";
  grantId: string; action: DelegatedPinAction; scope: DelegatedPinScope;
  context: DelegatedMemberPinContext | DelegatedIndependentPinContext }>;
export type DelegatedTerminalResult = DelegatedTerminalContextResult | (Base<typeof DELEGATED_TERMINALS_PROTOCOL>
  & Readonly<{ kind: "receipt"; receipt: DelegatedTerminalReceipt | null }>);
export type DelegatedPinResult = DelegatedPinContextResult | (Base<typeof DELEGATED_PIN_PROTOCOL>
  & Readonly<{ kind: "receipt"; receipt: DelegatedPinReceipt | null }>);

function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
const exact = captureBrowserExact, freeze = operationalRuleLedgerFreeze;
//106 status parser accepts revisions below999999999. A fresh command must also
//leave room for the real +1 receipt, rather than claiming an unparseable result.
const MEMBER_MAX_REVISION = 999999998;
function int(v: unknown, min = 0, max = INDEPENDENT_MAX_REVISION): number {
  return typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
}
function bool(v: unknown): boolean { return typeof v === "boolean" ? v : fail(); }
function text(v: unknown, max: number): string {
  return typeof v === "string" && v === v.trim() && [...v].length >= 1 && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail();
}
function hash(v: unknown): string { return typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail(); }
function terminalAction(v: unknown): DelegatedTerminalAction { return v === "terminal_prepare" || v === "terminal_revoke" ? v : fail(); }
function pinAction(v: unknown): DelegatedPinAction { return v === "pin_issue" || v === "pin_revoke" ? v : fail(); }
function snapshot(raw: unknown, maximum: number): unknown {
  assertDelegatedAuditTree(raw, maximum); return parseCaptureBrowserJson(JSON.stringify(raw));
}
export function parseDelegatedCredentialsJson(raw: string, request = true): unknown {
  const maximum = request ? DELEGATED_CREDENTIALS_REQUEST_BYTES : DELEGATED_CREDENTIALS_RESULT_BYTES;
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > maximum) return fail();
  const value = parseCaptureBrowserJson(raw); assertDelegatedAuditTree(value, maximum); return value;
}
export function parseDelegatedCredentialsQuery(raw: unknown): DelegatedCredentialsQuery {
  const q = exact(snapshot(raw, 4096), ["siteId", "grantId", "mode", "operationId"]);
  const siteId = attendanceSelfSite(q.siteId), grantId = attendanceSelfUuid(q.grantId);
  if (q.mode === "context" && q.operationId === null) return freeze({ siteId, grantId, mode: "context", operationId: null });
  if (q.mode === "recover") return freeze({ siteId, grantId, mode: "recover", operationId: attendanceSelfUuid(q.operationId) }); return fail();
}
export function delegatedCredentialsQueryString(raw: DelegatedCredentialsQuery): string {
  const q = parseDelegatedCredentialsQuery(raw);
  return new URLSearchParams({ siteId: q.siteId, grantId: q.grantId, mode: q.mode, operationId: q.operationId ?? "" }).toString();
}
export function parseDelegatedTerminalCommand(raw: unknown): DelegatedTerminalCommand {
  const detached = snapshot(raw, DELEGATED_CREDENTIALS_REQUEST_BYTES), a = Object.getOwnPropertyDescriptor(detached, "action")?.value;
  const c = exact(detached, ["action", "operationId", "terminalId", "locationId", "reason", ...(a === "terminal_prepare" ? ["label", "pairHash"] : [])]);
  const common = { operationId: attendanceSelfUuid(c.operationId), terminalId: attendanceSelfUuid(c.terminalId), locationId: attendanceSelfUuid(c.locationId), reason: text(c.reason, 500) };
  return freeze(terminalAction(c.action) === "terminal_prepare" ? { ...common, action: "terminal_prepare", label: text(c.label, 80), pairHash: hash(c.pairHash) }
    : { ...common, action: "terminal_revoke" });
}
function independentPinOriginal(raw: DelegatedIndependentPinCommand): Extract<IndependentCommand, { action: "issue_pin" | "revoke_pin" }> {
  //Strict shape validation happens in the public parser; this is the exact
  //196 nonsecret command projection, not owner impersonation or an RPC call.
  const c = raw, old = parseIndependentCommand({ action: c.action === "pin_issue" ? "issue_pin" : "revoke_pin", operationId: c.operationId,
    subjectId: c.subjectId, expectedSubjectRevision: c.expectedSubjectRevision, expectedGeneration: c.expectedGeneration,
    expectedWorkerVersion: c.expectedWorkerVersion, expectedSettingsVersion: c.expectedSettingsVersion,
    expectedCredentialRevision: c.expectedCredentialRevision, reason: c.reason });
  if (old.action !== "issue_pin" && old.action !== "revoke_pin") return fail(); return old;
}
export function parseDelegatedPinCommand(raw: unknown): DelegatedPinCommand {
  const detached = snapshot(raw, DELEGATED_CREDENTIALS_REQUEST_BYTES), kind = Object.getOwnPropertyDescriptor(detached, "kind")?.value;
  const c = exact(detached, ["kind", "action", "operationId", "workerId", "reason", ...(kind === "member_pin"
    ? ["employeeId", "employeeAuthUserId", "workerNo", "expectedRevision"]
    : ["subjectId", "expectedSubjectRevision", "expectedGeneration", "expectedWorkerVersion", "expectedSettingsVersion", "expectedCredentialRevision"])]);
  const common = { action: pinAction(c.action), operationId: attendanceSelfUuid(c.operationId), workerId: attendanceSelfUuid(c.workerId), reason: text(c.reason, 500) };
  if (kind === "member_pin") return freeze({ ...common, kind, employeeId: attendanceSelfUuid(c.employeeId), employeeAuthUserId: attendanceSelfUuid(c.employeeAuthUserId),
    workerNo: pinWorkerNo(c.workerNo), expectedRevision: int(c.expectedRevision, common.action === "pin_revoke" ? 1 : 0, MEMBER_MAX_REVISION - 1) });
  if (kind !== "independent_pin") return fail();
  const parsed: DelegatedIndependentPinCommand = { ...common, kind, subjectId: attendanceSelfUuid(c.subjectId), expectedSubjectRevision: int(c.expectedSubjectRevision, 1, INDEPENDENT_MAX_REVISION - 1),
    expectedGeneration: int(c.expectedGeneration, 0, INDEPENDENT_MAX_REVISION - (common.action === "pin_revoke" ? 1 : 0)),
    expectedWorkerVersion: int(c.expectedWorkerVersion, 1, INDEPENDENT_MAX_REVISION - 1), expectedSettingsVersion: int(c.expectedSettingsVersion, 1),
    expectedCredentialRevision: int(c.expectedCredentialRevision, common.action === "pin_revoke" ? 1 : 0, INDEPENDENT_MAX_REVISION - 1) };
  independentPinOriginal(parsed); return freeze(parsed);
}
function contextQuery(raw: unknown): DelegatedCredentialsContextQuery {
  const q = parseDelegatedCredentialsQuery(raw); return q.mode === "context" ? q : fail();
}
export function parseDelegatedTerminalBody(raw: unknown): DelegatedTerminalBody {
  const b = exact(snapshot(raw, DELEGATED_CREDENTIALS_REQUEST_BYTES), ["query", "command"]);
  return freeze({ query: contextQuery(b.query), command: parseDelegatedTerminalCommand(b.command) });
}
export function parseDelegatedPinBody(raw: unknown): DelegatedPinBody {
  const b = exact(snapshot(raw, DELEGATED_CREDENTIALS_REQUEST_BYTES), ["query", "command"]);
  return freeze({ query: contextQuery(b.query), command: parseDelegatedPinCommand(b.command) });
}
export function parseDelegatedTerminalPrepareEphemeralBody(raw: unknown): DelegatedTerminalPrepareEphemeralBody {
  const b = exact(snapshot(raw, DELEGATED_CREDENTIALS_REQUEST_BYTES), ["query", "command", "pairSecret"]);
  const body = parseDelegatedTerminalBody({ query: b.query, command: b.command }); if (body.command.action !== "terminal_prepare") return fail();
  return freeze({ query: body.query, command: body.command, pairSecret: terminalSecret(b.pairSecret) });
}
export function parseDelegatedPinIssueEphemeralBody(raw: unknown): DelegatedPinIssueEphemeralBody {
  const b = exact(snapshot(raw, DELEGATED_CREDENTIALS_REQUEST_BYTES), ["query", "command", "pin"]);
  const body = parseDelegatedPinBody({ query: b.query, command: b.command }); if (body.command.action !== "pin_issue") return fail();
  return freeze({ query: body.query, command: { ...body.command, action: "pin_issue" }, pin: attendancePin(b.pin) });
}
function commandTuple(c: DelegatedCredentialsCommand): (string | number)[] {
  if (c.action === "terminal_prepare") return [c.action, c.operationId, c.terminalId, c.locationId, c.label, c.pairHash, c.reason];
  if (c.action === "terminal_revoke") return [c.action, c.operationId, c.terminalId, c.locationId, c.reason];
  if (c.kind === "member_pin") return [c.kind, c.action, c.operationId, c.workerId, c.employeeId, c.employeeAuthUserId, c.workerNo, c.expectedRevision, c.reason];
  return [c.kind, c.action, c.operationId, c.workerId, c.subjectId, c.expectedSubjectRevision, c.expectedGeneration,
    c.expectedWorkerVersion, c.expectedSettingsVersion, c.expectedCredentialRevision, c.reason];
}
function fingerprintText(rawQuery: DelegatedCredentialsQuery, actor: string, c: DelegatedCredentialsCommand, protocol: string): string {
  const q = parseDelegatedCredentialsQuery(rawQuery); if (q.mode === "recover" && q.operationId !== c.operationId) return fail();
  return operationalRuleLedgerEncode([protocol + "-command", q.siteId, attendanceSelfUuid(actor), q.grantId, commandTuple(c)]);
}
export function delegatedTerminalFingerprintText(q: DelegatedCredentialsQuery, actor: string, c: DelegatedTerminalCommand): string {
  return fingerprintText(q, actor, parseDelegatedTerminalCommand(c), DELEGATED_TERMINALS_PROTOCOL);
}
export function delegatedPinFingerprintText(q: DelegatedCredentialsQuery, actor: string, c: DelegatedPinCommand): string {
  return fingerprintText(q, actor, parseDelegatedPinCommand(c), DELEGATED_PIN_PROTOCOL);
}
async function digest(textValue: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(textValue)); return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
}
export const delegatedTerminalCommandFingerprint = (q: DelegatedCredentialsQuery, actor: string, c: DelegatedTerminalCommand) => digest(delegatedTerminalFingerprintText(q, actor, c));
export const delegatedPinCommandFingerprint = (q: DelegatedCredentialsQuery, actor: string, c: DelegatedPinCommand) => digest(delegatedPinFingerprintText(q, actor, c));
function reference(raw: unknown, action: DelegatedCredentialsAction): DelegatedTerminalReference | DelegatedPinReference {
  if (action === "terminal_prepare" || action === "terminal_revoke") {
    const r = exact(raw, ["kind", "terminalId", "locationId", "auditAction"]);
    const auditAction = action === "terminal_prepare" ? "create" : "revoke";
    if (r.kind !== "terminal" || r.auditAction !== auditAction) return fail();
    return { kind: "terminal", terminalId: attendanceSelfUuid(r.terminalId), locationId: attendanceSelfUuid(r.locationId), auditAction };
  }
  const kind = Object.getOwnPropertyDescriptor(raw, "kind")?.value;
  if (kind === "member_pin") {
    const r = exact(raw, ["kind", "workerId", "employeeId", "employeeAuthUserId", "revision"]);
    return { kind, workerId: attendanceSelfUuid(r.workerId), employeeId: attendanceSelfUuid(r.employeeId), employeeAuthUserId: attendanceSelfUuid(r.employeeAuthUserId), revision: int(r.revision, 1, MEMBER_MAX_REVISION) };
  }
  const r = exact(raw, ["kind", "workerId", "subjectId", "subjectRevision", "generation", "workerVersion", "credentialRevision"]);
  if (kind !== "independent_pin") return fail();
  return { kind, workerId: attendanceSelfUuid(r.workerId), subjectId: attendanceSelfUuid(r.subjectId), subjectRevision: int(r.subjectRevision, 2),
    generation: int(r.generation, action === "pin_revoke" ? 1 : 0), workerVersion: int(r.workerVersion, 2), credentialRevision: int(r.credentialRevision, 1) };
}
function referenceMatches(r: DelegatedTerminalReference | DelegatedPinReference, c: DelegatedCredentialsCommand): boolean {
  if (c.action === "terminal_prepare" || c.action === "terminal_revoke") return r.kind === "terminal" && r.terminalId === c.terminalId && r.locationId === c.locationId && r.auditAction === (c.action === "terminal_prepare" ? "create" : "revoke");
  if (c.kind === "member_pin") return r.kind === c.kind && r.workerId === c.workerId && r.employeeId === c.employeeId && r.employeeAuthUserId === c.employeeAuthUserId && r.revision === c.expectedRevision + 1;
  return r.kind === c.kind && r.workerId === c.workerId && r.subjectId === c.subjectId && r.subjectRevision === c.expectedSubjectRevision + 1
    && r.generation === c.expectedGeneration + (c.action === "pin_revoke" ? 1 : 0) && r.workerVersion === c.expectedWorkerVersion + 1 && r.credentialRevision === c.expectedCredentialRevision + 1;
}
export async function parseDelegatedTerminalResult(raw: unknown, rawQuery: DelegatedCredentialsQuery, actualActor: string,
  expected: DelegatedTerminalCommand | null = null): Promise<DelegatedTerminalResult> {
  try {
    const input = snapshot(raw, DELEGATED_CREDENTIALS_RESULT_BYTES), q = parseDelegatedCredentialsQuery(rawQuery), actorId = attendanceSelfUuid(actualActor), c = expected === null ? null : parseDelegatedTerminalCommand(expected);
    const kind = Object.getOwnPropertyDescriptor(input, "kind")?.value;
    const v = exact(input, ["protocol", "siteId", "actorId", "readAt", "kind", ...(kind === "receipt" ? ["receipt"] : ["grantId", "action", "scope", "context"])]);
    if (v.protocol !== DELEGATED_TERMINALS_PROTOCOL || v.siteId !== q.siteId || v.actorId !== actorId || c && q.mode === "recover" && q.operationId !== c.operationId) return fail();
    const base: Base<typeof DELEGATED_TERMINALS_PROTOCOL> = { protocol: DELEGATED_TERMINALS_PROTOCOL, siteId: q.siteId, actorId, readAt: delegatedAuditStamp(v.readAt) };
    if (kind === "receipt") {
      const r = v.receipt === null ? null : exact(v.receipt, ["operationId", "actorId", "grantId", "action", "reference", "commandFingerprint", "businessFingerprint", "recordedAt"]);
      let receipt: DelegatedTerminalReceipt | null = null;
      if (r !== null) {
        const action = terminalAction(r.action), ref = reference(r.reference, action); if (ref.kind !== "terminal") return fail();
        receipt = { operationId: attendanceSelfUuid(r.operationId), actorId: attendanceSelfUuid(r.actorId), grantId: attendanceSelfUuid(r.grantId), action, reference: ref,
          commandFingerprint: hash(r.commandFingerprint), businessFingerprint: hash(r.businessFingerprint), recordedAt: delegatedAuditStamp(r.recordedAt) };
        if (receipt.actorId !== actorId || receipt.grantId !== q.grantId || receipt.operationId !== (c?.operationId ?? q.operationId) || receipt.recordedAt > base.readAt
          || c && (receipt.action !== c.action || !referenceMatches(ref, c) || receipt.commandFingerprint !== await delegatedTerminalCommandFingerprint(q, actorId, c))) return fail();
      }
      if (q.mode === "context" && (c === null || receipt === null)) return fail(); return freeze({ ...base, kind, receipt });
    }
    if (kind !== "context" || q.mode !== "context" || c !== null || v.grantId !== q.grantId) return fail();
    const action = terminalAction(v.action), scope = parseManagementDelegationScope(v.scope, action); if (scope.kind !== "terminal") return fail();
    const ctx = exact(v.context, ["terminal", "location"]), loc = exact(ctx.location, ["locationId", "name", "timeZone", "version", "active"]);
    const location = { locationId: attendanceSelfUuid(loc.locationId), name: text(loc.name, 120), timeZone: attendanceTimeZone(text(loc.timeZone, 100)), version: int(loc.version, 1), active: bool(loc.active) };
    const terminal = ctx.terminal === null ? null : parseTerminal(ctx.terminal);
    if (location.locationId !== scope.locationId || scope.create !== (terminal === null) || terminal && (terminal.id !== scope.terminalId || terminal.locationId !== scope.locationId
      || terminal.createdAt > base.readAt || terminal.pairedAt !== null && terminal.pairedAt > base.readAt || terminal.revokedAt !== null && terminal.revokedAt > base.readAt)) return fail();
    return freeze({ ...base, kind, grantId: q.grantId, action, scope, context: { terminal, location } });
  } catch { return fail("attendance_delegated_terminals_invalid"); }
}
export async function parseDelegatedPinResult(raw: unknown, rawQuery: DelegatedCredentialsQuery, actualActor: string,
  expected: DelegatedPinCommand | null = null): Promise<DelegatedPinResult> {
  try {
    const input = snapshot(raw, DELEGATED_CREDENTIALS_RESULT_BYTES), q = parseDelegatedCredentialsQuery(rawQuery), actorId = attendanceSelfUuid(actualActor), c = expected === null ? null : parseDelegatedPinCommand(expected);
    const kind = Object.getOwnPropertyDescriptor(input, "kind")?.value;
    const v = exact(input, ["protocol", "siteId", "actorId", "readAt", "kind", ...(kind === "receipt" ? ["receipt"] : ["grantId", "action", "scope", "context"])]);
    if (v.protocol !== DELEGATED_PIN_PROTOCOL || v.siteId !== q.siteId || v.actorId !== actorId || c && q.mode === "recover" && q.operationId !== c.operationId) return fail();
    const base: Base<typeof DELEGATED_PIN_PROTOCOL> = { protocol: DELEGATED_PIN_PROTOCOL, siteId: q.siteId, actorId, readAt: delegatedAuditStamp(v.readAt) };
    if (kind === "receipt") {
      const r = v.receipt === null ? null : exact(v.receipt, ["operationId", "actorId", "grantId", "action", "reference", "commandFingerprint", "businessFingerprint", "recordedAt"]);
      let receipt: DelegatedPinReceipt | null = null;
      if (r !== null) {
        const action = pinAction(r.action), ref = reference(r.reference, action); if (ref.kind === "terminal") return fail();
        receipt = { operationId: attendanceSelfUuid(r.operationId), actorId: attendanceSelfUuid(r.actorId), grantId: attendanceSelfUuid(r.grantId), action, reference: ref,
          commandFingerprint: hash(r.commandFingerprint), businessFingerprint: hash(r.businessFingerprint), recordedAt: delegatedAuditStamp(r.recordedAt) };
        if (receipt.actorId !== actorId || receipt.grantId !== q.grantId || receipt.operationId !== (c?.operationId ?? q.operationId) || receipt.recordedAt > base.readAt
          || c && (receipt.action !== c.action || !referenceMatches(ref, c) || receipt.commandFingerprint !== await delegatedPinCommandFingerprint(q, actorId, c))) return fail();
      }
      if (q.mode === "context" && (c === null || receipt === null)) return fail(); return freeze({ ...base, kind, receipt });
    }
    if (kind !== "context" || q.mode !== "context" || c !== null || v.grantId !== q.grantId) return fail();
    const action = pinAction(v.action), scope = parseManagementDelegationScope(v.scope, action);
    if (scope.kind === "member_pin") {
      const ctx = exact(v.context, ["status", "employeeAuthUserId"]), employeeAuthUserId = attendanceSelfUuid(ctx.employeeAuthUserId), rawStatus = exact(ctx.status,
        ["siteId", "workerId", "employeeId", "workerNo", "workerName", "ready", "revision", "enabled", "bindingCurrent", "changedAt", "receipt"]);
      const status = parsePinStatus(rawStatus, { siteId: q.siteId, workerNo: pinWorkerNo(rawStatus.workerNo), operationId: null });
      if (status.receipt !== null || status.workerId !== scope.workerId || status.employeeId !== scope.employeeId || employeeAuthUserId !== scope.employeeAuthUserId
        || status.changedAt !== null && status.changedAt > base.readAt) return fail();
      return freeze({ ...base, kind, grantId: q.grantId, action, scope, context: { status, employeeAuthUserId } });
    }
    if (scope.kind !== "independent_pin") return fail();
    const ctx = exact(v.context, ["settingsVersion", "detail"]), settingsVersion = int(ctx.settingsVersion, 1);
    //Pure parser reuse. Supplying the actual delegate as actor here does not
    //call the old owner RPC or substitute an owner identity.
    const parsed = await parseIndependentAdminResult({ protocol: INDEPENDENT_ADMIN_PROTOCOL, siteId: q.siteId, actorId, readAt: base.readAt,
      settingsVersion, data: ctx.detail, receipt: null }, { siteId: q.siteId, mode: "detail", subjectId: scope.subjectId }, actorId);
    if (parsed.data.kind !== "detail" || parsed.data.binding !== null || parsed.data.subject.state !== "independent" || parsed.data.subject.workerId !== scope.workerId
      || parsed.data.subject.generation !== scope.generation || !scope.locationIds.includes(parsed.data.subject.locationId)) return fail();
    return freeze({ ...base, kind, grantId: q.grantId, action, scope, context: { settingsVersion, detail: parsed.data } });
  } catch { return fail("attendance_delegated_pin_invalid"); }
}
export function delegatedTerminalCommandForContext(result: DelegatedTerminalContextResult, raw: unknown): DelegatedTerminalCommand {
  const c = parseDelegatedTerminalCommand(raw), s = result.scope;
  if (c.action !== result.action || c.terminalId !== s.terminalId || c.locationId !== s.locationId || s.create !== (c.action === "terminal_prepare")) return fail(); return c;
}
export function delegatedPinCommandForContext(result: DelegatedPinContextResult, raw: unknown): DelegatedPinCommand {
  const c = parseDelegatedPinCommand(raw), s = result.scope;
  if (c.action !== result.action || c.workerId !== s.workerId) return fail();
  if (c.kind === "member_pin") {
    if (s.kind !== c.kind || !("status" in result.context) || c.employeeId !== s.employeeId || c.employeeAuthUserId !== s.employeeAuthUserId
      || c.workerNo !== result.context.status.workerNo || c.expectedRevision !== result.context.status.revision
      || c.action === "pin_issue" && !result.context.status.ready || c.action === "pin_revoke" && result.context.status.revision === 0) return fail();
  } else {
    if (s.kind !== c.kind || !("detail" in result.context)) return fail(); const { subject, credential } = result.context.detail;
    if (c.subjectId !== s.subjectId || c.expectedGeneration !== s.generation || c.expectedSubjectRevision !== subject.revision
      || c.expectedWorkerVersion !== subject.workerVersion || c.expectedSettingsVersion !== result.context.settingsVersion
      || c.expectedCredentialRevision !== credential.revision || c.action === "pin_revoke" && !credential.enabled) return fail();
  }
  return c;
}
