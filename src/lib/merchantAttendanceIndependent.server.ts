// 196 server-only coordinator. Routes supply actual Auth/cookie context; SQL
// rechecks owner/device/subject, consumes the shared attempt ordinal and owns all
// atomic facts. A boolean returned by a browser is never authorization.
import { randomBytes, randomUUID } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendancePinPepper } from "./merchantAttendancePin.server";
import { terminalHash } from "./merchantAttendanceTerminal.server";
import { terminalSecret } from "./merchantAttendanceTerminal";
import { captureBrowserExact, captureBrowserUuid } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { deriveIndependentAttendanceIssuePin, checkIndependentPinVerifier, independentAttendanceMaterialCommitment,
  type IndependentPinKdfBinding } from "./merchantAttendanceIndependentPinKdf.server";
import { parseIndependentQuery, parseIndependentOwnerBody, parseIndependentAdminResult, parseIndependentTerminalBody,
  parseIndependentTerminalResult, independentAdminCommandFingerprint, independentAdminReceiptMatches,
  type IndependentQuery, type IndependentCommand, type IndependentAdminResult, type IndependentTerminalBody,
  type IndependentTerminalResult } from "./merchantAttendanceIndependent";

export const INDEPENDENT_RPC_TIMEOUT_MS = 10000;
const ERROR_CODES = new Set([
  "attendance_invalid_request", "attendance_access_denied", "attendance_settings_required", "attendance_platform_paused",
  "attendance_location_denied", "attendance_location_geofence_required", "attendance_worker_not_found", "attendance_worker_inactive",
  "attendance_version_conflict", "attendance_operation_conflict", "attendance_time_reversed", "attendance_rate_limited",
  "attendance_pin_busy", "attendance_pin_unconfigured", "attendance_pin_invalid", "attendance_terminal_denied",
  "attendance_independent_changed", "attendance_independent_invalid", "attendance_independent_not_found",
  "attendance_independent_bound", "attendance_independent_limit", "attendance_independent_binding_blocked",
  "attendance_not_clocked_in", "attendance_already_clocked_in", "attendance_break_required", "attendance_not_on_break",
  "attendance_break_active", "attendance_identity_changed", "attendance_employment_denied", "attendance_unavailable",
  "attendance_employee_invalid", "attendance_independent_disabled", "attendance_independent_identity_changed",
  "attendance_independent_too_large", "attendance_independent_unchanged", "attendance_invalid_transition",
  "attendance_location_verification_required", "attendance_not_employed", "attendance_open_sessions", "attendance_sequence_conflict",
]);
const invalid = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const unavailable = (): never => { throw new MerchantAttendanceError("attendance_independent_invalid"); };
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : invalid();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : invalid();
const int = (v: unknown, min: number): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= 9007199254740990 ? v : invalid();
const hex = (v: unknown, n: number): string => typeof v === "string" && v.length === n && /^[0-9a-f]+$/.test(v) ? v : unavailable();
type Environment = Readonly<Record<string, string | undefined>>;
export function independentAttendanceEnabled(siteId: string, env: Environment = process.env): boolean {
  if (typeof siteId !== "string" || siteId.length !== 8 || !/^[0-9]{8}$/.test(siteId) || env.FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED !== "1") return false;
  const raw = env.FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 575) return false;
  const ids = raw.split(","); return ids.length <= 64 && new Set(ids).size === ids.length && ids.every(id => id.length === 8 && /^[0-9]{8}$/.test(id)) && ids.includes(siteId);
}
export type IndependentAdminServiceInput = Readonly<{ query: IndependentQuery; command: IndependentCommand | null;
  pin: string | null; authUserId: string; allowNew: boolean }>;
/** Trusted route context, NOT part of the browser body. secret is obtained from
 * the existing secure terminal cookie; begin/finish independently verify it. */
export type IndependentTerminalContext = Readonly<{ siteId: string; terminalId: string; secret: string; allowNew: boolean }>;
type Material = Readonly<{ salt: string; verifier: string; commitment: string }>;
export type IndependentServiceDependencies = Readonly<{
  environment?: () => Environment;
  signal?: AbortSignal;
  issuePin?: (pin: string, binding: IndependentPinKdfBinding, operationId: string) => Promise<Material>;
  checkPin?: (pin: string, salt: string, binding: IndependentPinKdfBinding, verifier: string) => Promise<boolean>;
}>;
// Internal dependency injection is for bounded service tests. Production uses
// the dedicated pepper and exactly the existing single zero-queue scrypt gate.
export function createIndependentAttendanceService(service: AttendanceSelfRpc | null, dependencies: IndependentServiceDependencies = {}) {
  const environment = dependencies.environment ?? (() => process.env);
  const issuePin = dependencies.issuePin ?? ((pin, binding, operationId) => deriveIndependentAttendanceIssuePin(pin, attendancePinPepper(), binding, operationId));
  const checkPin = dependencies.checkPin ?? ((pin, salt, binding, verifier) => checkIndependentPinVerifier(pin, salt, binding, verifier));
  const check = () => { if (dependencies.signal?.aborted) unavailable(); };
  const allow = (siteId: string, trusted: boolean) => trusted && independentAttendanceEnabled(siteId, environment());
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    check(); if (!service) return unavailable(); let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
    try {
      // A timeout is UNKNOWN, never a reason to retry a business write here.
      const interrupted = new Promise<never>((_, reject) => {
        cancel = () => reject(new MerchantAttendanceError("attendance_independent_invalid")); dependencies.signal?.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(() => reject(new MerchantAttendanceError("attendance_independent_invalid")), INDEPENDENT_RPC_TIMEOUT_MS);
      });
      check(); const response = await Promise.race([Promise.resolve(service.rpc(name, args)), interrupted]); check();
      if (!response || typeof response !== "object") return unavailable();
      const data = Object.getOwnPropertyDescriptor(response, "data"), error = Object.getOwnPropertyDescriptor(response, "error");
      if (!data || !("value" in data) || !error || !("value" in error)) return unavailable();
      if (error.value !== null) {
        const code = error.value && typeof error.value === "object" ? Object.getOwnPropertyDescriptor(error.value, "message")?.value : null;
        throw new MerchantAttendanceError(typeof code === "string" && ERROR_CODES.has(code) ? code : "attendance_independent_invalid");
      }
      return data.value;
    } catch (error) {
      if (error instanceof MerchantAttendanceError && ERROR_CODES.has(error.code)) throw error;
      return unavailable();
    } finally { if (timer !== undefined) clearTimeout(timer); if (cancel) dependencies.signal?.removeEventListener("abort", cancel); }
  }
  async function executeAdmin(input: IndependentAdminServiceInput): Promise<IndependentAdminResult> {
    let q: IndependentQuery, command: IndependentCommand | null, pin: string | null, authUserId: string, trusted: boolean;
    try {
      const v = captureBrowserExact(input, ["query", "command", "pin", "authUserId", "allowNew"]); q = parseIndependentQuery(v.query); authUserId = uuid(v.authUserId);
      if (typeof v.allowNew !== "boolean") invalid(); trusted = v.allowNew as boolean;
      if (v.command === null) { if (v.pin !== null) invalid(); command = null; pin = null; }
      else { const parsed = parseIndependentOwnerBody(v.pin === null ? { query: q, command: v.command } : { query: q, command: v.command, pin: v.pin }); command = parsed.command; pin = "pin" in parsed ? parsed.pin : null; }
    } catch { return invalid(); }
    const read = async (query: IndependentQuery, c: IndependentCommand | null = null, material: Material | null = null) => {
      const raw = await rpc("faolla_attendance_independent_admin_v1", { p_site: q.siteId, p_auth: authUserId,
        p_query: query, p_command: c, p_material: material, p_allow_new: allow(q.siteId, trusted) });
      return parseIndependentAdminResult(raw, query, authUserId, c);
    };
    if (!command || command.action !== "issue_pin") return read(q, command);
    const c = command;
    const recovered = await read({ siteId: q.siteId, mode: "recover", subjectId: c.subjectId, operationId: c.operationId });
    const fingerprint = await independentAdminCommandFingerprint(q.siteId, authUserId, c), original = recovered.receipt;
    if (original && !independentAdminReceiptMatches(original, c, authUserId, fingerprint)) throw new MerchantAttendanceError("attendance_operation_conflict");
    // Even an exact saved operation does not grant current-owner authority to
    // spend KDF resources or repeat the issue POST after ownership was removed.
    const current = await read({ siteId: q.siteId, mode: "detail", subjectId: c.subjectId });
    if (current.data.kind !== "detail") return unavailable(); const s = current.data.subject, credential = current.data.credential;
    if (original ? s.workerId !== original.workerId : s.state !== "independent" || s.revision !== c.expectedSubjectRevision
      || s.generation !== c.expectedGeneration || s.workerVersion !== c.expectedWorkerVersion || current.settingsVersion !== c.expectedSettingsVersion || credential.revision !== c.expectedCredentialRevision) throw new MerchantAttendanceError("attendance_independent_changed");
    if (!original && !allow(q.siteId, trusted)) throw new MerchantAttendanceError("attendance_platform_paused");
    const binding: IndependentPinKdfBinding = Object.freeze({ siteId: q.siteId, subjectId: c.subjectId,
      workerId: original?.workerId ?? s.workerId, generation: original?.generation ?? c.expectedGeneration,
      credentialRevision: original?.credentialRevision ?? c.expectedCredentialRevision + 1 });
    let material: Material;
    try {
      check();
      const raw = captureBrowserExact(await issuePin(pin!, binding, c.operationId), ["salt", "verifier", "commitment"]);
      check();
      material = Object.freeze({ salt: hex(raw.salt, 32), verifier: hex(raw.verifier, 64), commitment: hex(raw.commitment, 64) });
      if (material.commitment !== independentAttendanceMaterialCommitment(binding, c.operationId, material.salt, material.verifier)) return unavailable();
    } catch (error) { if (error instanceof MerchantAttendanceError && ERROR_CODES.has(error.code)) throw error; return unavailable(); }
    return read(q, c, material);
  }
  async function executeTerminal(rawBody: IndependentTerminalBody, rawContext: IndependentTerminalContext): Promise<IndependentTerminalResult> {
    let body: IndependentTerminalBody, context: IndependentTerminalContext;
    try {
      body = parseIndependentTerminalBody(rawBody); const v = captureBrowserExact(rawContext, ["siteId", "terminalId", "secret", "allowNew"]);
      if (typeof v.allowNew !== "boolean" || typeof v.secret !== "string" || v.secret.length !== 43) invalid();
      context = Object.freeze({ siteId: site(v.siteId), terminalId: uuid(v.terminalId), secret: terminalSecret(v.secret), allowNew: v.allowNew as boolean });
      if (body.siteId !== context.siteId || body.terminalId !== context.terminalId) invalid();
    } catch { return invalid(); }
    const lease = randomUUID(), common = Object.freeze({ p_site: body.siteId, p_terminal: body.terminalId,
      p_secret_hash: terminalHash(context.secret), p_no: body.workerNo, p_lease: lease });
    let allowed: boolean, binding: IndependentPinKdfBinding, salt: string, verifier: string;
    const begun = await rpc("faolla_attendance_independent_begin_v1", { ...common, p_allow_new: allow(body.siteId, context.allowNew) });
    try {
      const v = captureBrowserExact(begun, ["allowed", "leaseId", "binding", "salt", "verifier"]);
      if (typeof v.allowed !== "boolean") return unavailable(); allowed = v.allowed;
      if (!allowed) {
        if (v.leaseId !== null || v.binding !== null || v.salt !== null || v.verifier !== null) return unavailable();
        binding = Object.freeze({ siteId: body.siteId, workerId: "00000000-0000-4000-8000-000000000001", subjectId: "00000000-0000-4000-8000-000000000002", generation: 0, credentialRevision: 1 });
        salt = randomBytes(16).toString("hex"); verifier = "0".repeat(64);
      } else {
        const b = captureBrowserExact(v.binding, ["siteId", "workerId", "subjectId", "generation", "credentialRevision"]);
        if (v.leaseId !== lease || b.siteId !== body.siteId) return unavailable();
        binding = Object.freeze({ siteId: site(b.siteId), workerId: uuid(b.workerId), subjectId: uuid(b.subjectId), generation: int(b.generation, 0), credentialRevision: int(b.credentialRevision, 1) });
        salt = hex(v.salt, 32); verifier = hex(v.verifier, 64);
      }
    } catch { return unavailable(); }
    let verified: boolean;
    try { check(); const matches = await checkPin(body.pin, salt, binding, verifier); check(); if (typeof matches !== "boolean") return unavailable(); verified = allowed && matches; }
    catch (error) { if (error instanceof MerchantAttendanceError && ERROR_CODES.has(error.code)) throw error; return unavailable(); }
    if (!allowed) throw new MerchantAttendanceError("attendance_pin_invalid");
    const request = body.request;
    if (request.kind !== "state") { const scoped = request.kind === "clock" ? request.command : request;
      // Do not skip finish on a wrong-PIN/wrong-scope attempt: it must still
      // consume the lease and record the same credential failure budget.
      if (scoped.subjectId !== binding.subjectId || scoped.workerId !== binding.workerId) verified = false; }
    // Re-evaluate the pilot gate after KDF, not the stale admission value. SQL
    // also requalifies device/credential/generation/time after taking its locks.
    const raw = await rpc("faolla_attendance_independent_finish_v1", { ...common, p_verified: verified,
      p_request: request, p_allow_new: allow(body.siteId, context.allowNew) });
    if (!verified) throw new MerchantAttendanceError("attendance_pin_invalid");
    if (raw && typeof raw === "object" && Object.hasOwn(raw, "error")) {
      let code: string;
      try { const e = captureBrowserExact(raw, ["error"]); code = typeof e.error === "string" && ERROR_CODES.has(e.error) ? e.error : "attendance_independent_invalid"; }
      catch { return unavailable(); }
      throw new MerchantAttendanceError(code);
    }
    const parsed = await parseIndependentTerminalResult(raw, body);
    if (parsed.data.kind === "state" || parsed.data.kind === "clock") { const s = parsed.data.subject;
      if (s.subjectId !== binding.subjectId || s.workerId !== binding.workerId || s.generation !== binding.generation || s.credentialRevision !== binding.credentialRevision) return unavailable(); }
    return parsed;
  }
  return Object.freeze({ executeAdmin, executeTerminal });
}
export function executeIndependentAdmin(input: IndependentAdminServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createIndependentAttendanceService(service, { signal }).executeAdmin(input);
}
export function executeIndependentTerminal(body: IndependentTerminalBody, context: IndependentTerminalContext, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createIndependentAttendanceService(service, { signal }).executeTerminal(body, context);
}
