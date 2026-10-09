//207 additive service only. SQL owns current authority, locks, original facts
//and same-TX sidecars. No owner proxy, client material or reusable verification.
import { createHash, createHmac } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree } from "./merchantAttendanceDelegatedAudit";
import { operationalRuleLedgerEncode } from "./merchantAttendanceOperationalRuleLedger";
import { attendancePinPepper, deriveAttendancePin, withAttendancePinKdf } from "./merchantAttendancePin.server";
import { deriveIndependentAttendanceIssuePin, independentAttendanceMaterialCommitment, type IndependentPinKdfBinding } from "./merchantAttendanceIndependentPinKdf.server";
import * as p from "./merchantAttendanceDelegatedCredentials";

export const DELEGATED_CREDENTIALS_TIMEOUT_MS = 10000;
export const DELEGATED_CREDENTIALS_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...p.DELEGATED_TERMINALS_ERRORS, ...p.DELEGATED_PIN_ERRORS });
type Environment = Readonly<Record<string, string | undefined>>;
function siteEnabled(site: string, family: "TERMINALS" | "PIN", env: Environment): boolean {
  const prefix = "FAOLLA_ATTENDANCE_DELEGATED_" + family, raw = env[prefix + "_SITE_IDS"];
  if (env[prefix + "_ENABLED"] !== "1" || !/^[0-9]{8}$/.test(site) || typeof raw !== "string" || raw.length > 575) return false;
  const ids = raw.split(","); return ids.length <= 64 && new Set(ids).size === ids.length && ids.every(s => /^[0-9]{8}$/.test(s)) && ids.includes(site);
}
export const delegatedTerminalsSiteEnabled = (site: string, env: Environment = process.env) => siteEnabled(site, "TERMINALS", env);
export const delegatedPinSiteEnabled = (site: string, env: Environment = process.env) => siteEnabled(site, "PIN", env);
type Material = Readonly<{ salt: string; verifier: string; commitment: string }>;
type MemberBinding = Readonly<{ siteId: string; workerId: string; employeeId: string }>;
export type DelegatedTerminalServiceInput = Readonly<{ query: p.DelegatedCredentialsQuery; command: p.DelegatedTerminalCommand | null;
  pairSecret: string | null; authUserId: string; allowWrite: boolean }>;
export type DelegatedPinServiceInput = Readonly<{ query: p.DelegatedCredentialsQuery; command: p.DelegatedPinCommand | null;
  pin: string | null; authUserId: string; allowWrite: boolean }>;
export type DelegatedCredentialsReceiptInput = Readonly<{ query: p.DelegatedCredentialsQuery; authUserId: string }>;
export type DelegatedTerminalRecoveryInput = DelegatedCredentialsReceiptInput & Readonly<{ expectedCommand: p.DelegatedTerminalCommand }>;
export type DelegatedPinRecoveryInput = DelegatedCredentialsReceiptInput & Readonly<{ expectedCommand: p.DelegatedPinCommand }>;
export type DelegatedCredentialsDependencies = Readonly<{
  environment?: () => Environment; timeoutMs?: number; pepper?: () => string;
  //Test doubles exercise admission and material projection with ZERO scrypt.
  memberVerifier?: (pin: string, salt: string, binding: MemberBinding, key: string) => Promise<string>;
  independentMaterial?: (pin: string, key: string, binding: IndependentPinKdfBinding, operationId: string) => Promise<Material>;
}>;
function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
function requestValue<T>(run: () => T): T { try { return run(); } catch { return fail(); } }
function hex(v: unknown, size: number, invalid: string): string { return typeof v === "string" && new RegExp(`^[0-9a-f]{${size}}$`).test(v) ? v : fail(invalid); }
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function input(raw: unknown, keys: readonly string[]) { return requestValue(() => { assertDelegatedAuditTree(raw, p.DELEGATED_CREDENTIALS_REQUEST_BYTES + 256); return captureBrowserExact(raw, keys); }); }
function recovery(q: p.DelegatedCredentialsQuery, operationId: string): p.DelegatedCredentialsQuery { return Object.freeze({ siteId: q.siteId, grantId: q.grantId, mode: "recover", operationId }); }
function memberValues(q: p.DelegatedCredentialsQuery, actor: string, c: p.DelegatedMemberPinCommand) {
  return [q.siteId, actor, q.grantId, c.operationId, c.workerId, c.employeeId, c.employeeAuthUserId, c.expectedRevision + 1];
}
function memberCommitment(q: p.DelegatedCredentialsQuery, actor: string, c: p.DelegatedMemberPinCommand, salt: string, verifier: string) {
  return sha(operationalRuleLedgerEncode(["attendance-delegated-member-pin-material-v1", ...memberValues(q, actor, c), salt, verifier]));
}
export function createDelegatedCredentialsService(service: AttendanceSelfRpc | null, deps: DelegatedCredentialsDependencies = {}) {
  const timeout = deps.timeoutMs ?? DELEGATED_CREDENTIALS_TIMEOUT_MS, env = deps.environment ?? (() => process.env);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > DELEGATED_CREDENTIALS_TIMEOUT_MS) fail();
  async function bounded<T>(invalid: string, signal: AbortSignal | undefined, run: (guard: () => void) => Promise<T>): Promise<T> {
    const deadline = performance.now() + timeout; let closed = false, timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
    const guard = () => { if (closed || signal?.aborted || performance.now() >= deadline) fail(invalid); };
    try {
      guard(); const interrupted = new Promise<never>((_, reject) => { cancel = () => { closed = true; reject(new MerchantAttendanceError(invalid)); };
        timer = setTimeout(cancel, timeout); signal?.addEventListener("abort", cancel, { once: true }); });
      const result = await Promise.race([run(guard), interrupted]); guard(); return result;
    } catch (error) { if (error instanceof MerchantAttendanceError && Object.hasOwn(DELEGATED_CREDENTIALS_ERRORS, error.code)) throw error; return fail(invalid); }
    finally { closed = true; if (timer !== undefined) clearTimeout(timer); if (cancel) signal?.removeEventListener("abort", cancel); }
  }
  async function rawRpc(name: string, q: p.DelegatedCredentialsQuery, actor: string, c: p.DelegatedCredentialsCommand | null,
    allowed: boolean, material: Material | null, invalid: string, guard: () => void): Promise<unknown> {
    guard(); if (!service) return fail(invalid);
    let result;
    try { result = await service.rpc(name, { p_query: q, p_auth_user_id: actor, p_command: c, p_allow_write: allowed, p_material: material }); }
    catch { return fail(invalid); } guard();
    if (!result || typeof result !== "object") return fail(invalid);
    const data = Object.getOwnPropertyDescriptor(result, "data"), error = Object.getOwnPropertyDescriptor(result, "error");
    if (!data || !("value" in data) || !error || !("value" in error)) return fail(invalid);
    if (error.value !== null) {
      const code = error.value && typeof error.value === "object" ? Object.getOwnPropertyDescriptor(error.value, "message")?.value : null;
      return fail(typeof code === "string" && Object.hasOwn(DELEGATED_CREDENTIALS_ERRORS, code) ? code : invalid);
    } return data.value;
  }
  async function terminalRpc(q: p.DelegatedCredentialsQuery, actor: string, c: p.DelegatedTerminalCommand | null, allowed: boolean,
    expected: p.DelegatedTerminalCommand | null, guard: () => void) {
    const raw = await rawRpc(p.DELEGATED_TERMINALS_RPC, q, actor, c, allowed, null, "attendance_delegated_terminals_invalid", guard);
    const result = await p.parseDelegatedTerminalResult(raw, q, actor, expected); guard(); return result;
  }
  async function pinRpc(q: p.DelegatedCredentialsQuery, actor: string, c: p.DelegatedPinCommand | null, allowed: boolean,
    material: Material | null, expected: p.DelegatedPinCommand | null, guard: () => void) {
    const raw = await rawRpc(p.DELEGATED_PIN_RPC, q, actor, c, allowed, material, "attendance_delegated_pin_invalid", guard);
    const result = await p.parseDelegatedPinResult(raw, q, actor, expected); guard(); return result;
  }
  return Object.freeze({
    executeTerminal(raw: DelegatedTerminalServiceInput, signal?: AbortSignal) { return bounded("attendance_delegated_terminals_invalid", signal, async guard => {
      //All caller intent is detached BEFORE the first await, including secrets.
      const v = input(raw, ["query", "command", "pairSecret", "authUserId", "allowWrite"]), q = requestValue(() => p.parseDelegatedCredentialsQuery(v.query)), actor = attendanceSelfUuid(v.authUserId);
      if (typeof v.allowWrite !== "boolean") fail(); const allowed = v.allowWrite;
      let c: p.DelegatedTerminalCommand | null;
      if (v.command === null) { if (v.pairSecret !== null) fail(); c = null; }
      else if (v.pairSecret === null) c = requestValue(() => p.parseDelegatedTerminalBody({ query: q, command: v.command })).command;
      else { const body = requestValue(() => p.parseDelegatedTerminalPrepareEphemeralBody({ query: q, command: v.command, pairSecret: v.pairSecret })); c = body.command;
        if (sha(body.pairSecret) !== c.pairHash) fail("attendance_operation_conflict"); }
      if (c?.action === "terminal_prepare" && v.pairSecret === null || c !== null && q.mode !== "context") fail();
      if (q.mode === "recover") return terminalRpc(q, actor, null, false, null, guard);
      if (c !== null) { const prior = await terminalRpc(recovery(q, c.operationId), actor, null, false, c, guard);
        if (prior.kind !== "receipt") fail("attendance_delegated_terminals_invalid"); if (prior.receipt !== null) return prior; }
      guard(); if (!allowed || !delegatedTerminalsSiteEnabled(q.siteId, env())) fail("attendance_delegated_terminals_disabled");
      const current = await terminalRpc(q, actor, null, false, null, guard); if (current.kind !== "context") fail("attendance_delegated_terminals_invalid");
      if (c === null) return current; p.delegatedTerminalCommandForContext(current, c);
      guard(); if (!delegatedTerminalsSiteEnabled(q.siteId, env())) fail("attendance_delegated_terminals_disabled");
      return terminalRpc(q, actor, c, true, c, guard);
    }); },
    executePin(raw: DelegatedPinServiceInput, signal?: AbortSignal) { return bounded("attendance_delegated_pin_invalid", signal, async guard => {
      const v = input(raw, ["query", "command", "pin", "authUserId", "allowWrite"]), q = requestValue(() => p.parseDelegatedCredentialsQuery(v.query)), actor = attendanceSelfUuid(v.authUserId);
      if (typeof v.allowWrite !== "boolean") fail(); const allowed = v.allowWrite;
      let c: p.DelegatedPinCommand | null, pin: string | null = null;
      if (v.command === null) { if (v.pin !== null) fail(); c = null; }
      else if (v.pin === null) c = requestValue(() => p.parseDelegatedPinBody({ query: q, command: v.command })).command;
      else { const body = requestValue(() => p.parseDelegatedPinIssueEphemeralBody({ query: q, command: v.command, pin: v.pin })); c = body.command; pin = body.pin; }
      if (c?.action === "pin_issue" && pin === null || c !== null && q.mode !== "context") fail();
      if (q.mode === "recover") return pinRpc(q, actor, null, false, null, null, guard);
      let original: p.DelegatedPinReceipt | null = null;
      if (c !== null) { const prior = await pinRpc(recovery(q, c.operationId), actor, null, false, null, c, guard);
        if (prior.kind !== "receipt") fail("attendance_delegated_pin_invalid"); original = prior.receipt;
        //Issue POST must NOT bypass current admission/KDF/material comparison.
        if (original !== null && c.action !== "pin_issue") return prior; }
      guard(); if (!allowed || !delegatedPinSiteEnabled(q.siteId, env())) fail("attendance_delegated_pin_disabled");
      const current = await pinRpc(q, actor, null, false, null, null, guard); if (current.kind !== "context") fail("attendance_delegated_pin_invalid");
      if (c === null) return current;
      if (original === null) p.delegatedPinCommandForContext(current, c);
      else {
        //Current authority/binding is required, but saved immutable CAS values
        //must not be replaced by today's revisions for an exact issue retry.
        const s = current.scope;
        if (current.action !== c.action || s.kind !== c.kind || s.workerId !== c.workerId) fail("attendance_identity_changed");
        if (c.kind === "member_pin") {
          if (s.kind !== "member_pin" || !("status" in current.context) || s.employeeId !== c.employeeId || s.employeeAuthUserId !== c.employeeAuthUserId
            || current.context.status.workerNo !== c.workerNo || !current.context.status.ready) fail("attendance_identity_changed");
        } else if (s.kind !== "independent_pin" || !("detail" in current.context) || s.subjectId !== c.subjectId || s.generation !== c.expectedGeneration) fail("attendance_identity_changed");
      }
      let material: Material | null = null;
      if (c.action === "pin_issue") {
        guard(); if (!delegatedPinSiteEnabled(q.siteId, env())) fail("attendance_delegated_pin_disabled");
        const key = (deps.pepper ?? attendancePinPepper)(); guard();
        if (c.kind === "member_pin") {
          const salt = createHmac("sha256", key).update(operationalRuleLedgerEncode(["faolla-attendance-delegated-member-pin-salt-v1", ...memberValues(q, actor, c)])).digest("hex").slice(0, 32);
          const binding = Object.freeze({ siteId: q.siteId, workerId: c.workerId, employeeId: c.employeeId });
          const verifier = hex(await withAttendancePinKdf(() => (deps.memberVerifier ?? deriveAttendancePin)(pin!, salt, binding, key)), 64, "attendance_delegated_pin_invalid"); guard();
          material = Object.freeze({ salt, verifier, commitment: memberCommitment(q, actor, c, salt, verifier) });
        } else {
          const binding: IndependentPinKdfBinding = Object.freeze({ siteId: q.siteId, workerId: c.workerId, subjectId: c.subjectId,
            generation: c.expectedGeneration, credentialRevision: c.expectedCredentialRevision + 1 });
          //This helper itself acquires the SAME gate exactly once; do not wrap.
          const m = captureBrowserExact(await (deps.independentMaterial ?? deriveIndependentAttendanceIssuePin)(pin!, key, binding, c.operationId), ["salt", "verifier", "commitment"]); guard();
          material = Object.freeze({ salt: hex(m.salt, 32, "attendance_delegated_pin_invalid"), verifier: hex(m.verifier, 64, "attendance_delegated_pin_invalid"), commitment: hex(m.commitment, 64, "attendance_delegated_pin_invalid") });
          if (material.commitment !== independentAttendanceMaterialCommitment(binding, c.operationId, material.salt, material.verifier)) fail("attendance_delegated_pin_invalid");
        }
      }
      guard(); if (!delegatedPinSiteEnabled(q.siteId, env())) fail("attendance_delegated_pin_disabled");
      return pinRpc(q, actor, c, true, material, c, guard);
    }); },
    readTerminalReceipt(raw: DelegatedCredentialsReceiptInput, signal?: AbortSignal) { return bounded("attendance_delegated_terminals_invalid", signal, async guard => {
      const v = input(raw, ["query", "authUserId"]), q = p.parseDelegatedCredentialsQuery(v.query), actor = attendanceSelfUuid(v.authUserId); if (q.mode !== "recover") fail();
      return terminalRpc(q, actor, null, false, null, guard);
    }); },
    readPinReceipt(raw: DelegatedCredentialsReceiptInput, signal?: AbortSignal) { return bounded("attendance_delegated_pin_invalid", signal, async guard => {
      const v = input(raw, ["query", "authUserId"]), q = p.parseDelegatedCredentialsQuery(v.query), actor = attendanceSelfUuid(v.authUserId); if (q.mode !== "recover") fail();
      return pinRpc(q, actor, null, false, null, null, guard);
    }); },
    recoverTerminal(raw: DelegatedTerminalRecoveryInput, signal?: AbortSignal) { return bounded("attendance_delegated_terminals_invalid", signal, async guard => {
      const v = input(raw, ["query", "authUserId", "expectedCommand"]), q = p.parseDelegatedCredentialsQuery(v.query), actor = attendanceSelfUuid(v.authUserId), c = p.parseDelegatedTerminalCommand(v.expectedCommand);
      if (q.mode !== "recover" || q.operationId !== c.operationId) fail(); return terminalRpc(q, actor, null, false, c, guard);
    }); },
    recoverPin(raw: DelegatedPinRecoveryInput, signal?: AbortSignal) { return bounded("attendance_delegated_pin_invalid", signal, async guard => {
      const v = input(raw, ["query", "authUserId", "expectedCommand"]), q = p.parseDelegatedCredentialsQuery(v.query), actor = attendanceSelfUuid(v.authUserId), c = p.parseDelegatedPinCommand(v.expectedCommand);
      if (q.mode !== "recover" || q.operationId !== c.operationId) fail(); return pinRpc(q, actor, null, false, null, c, guard);
    }); },
  });
}
export function executeDelegatedTerminal(input: DelegatedTerminalServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) { return createDelegatedCredentialsService(service).executeTerminal(input, signal); }
export function executeDelegatedPin(input: DelegatedPinServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) { return createDelegatedCredentialsService(service).executePin(input, signal); }
export function readDelegatedTerminalReceipt(input: DelegatedCredentialsReceiptInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) { return createDelegatedCredentialsService(service).readTerminalReceipt(input, signal); }
export function readDelegatedPinReceipt(input: DelegatedCredentialsReceiptInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) { return createDelegatedCredentialsService(service).readPinReceipt(input, signal); }
