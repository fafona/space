//209 actual authenticated actor only; no owner substitution. Current grant,
//old evidence/CAS and append-only decision+sidecar are rechecked in one SQL TX.
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree } from "./merchantAttendanceDelegatedAudit";
import { planClearanceSiteEnabled } from "./merchantAttendancePlanClearance.server";
import { planPosthocReviewSiteEnabled } from "./merchantAttendancePlanPosthocReview.server";
import { eventNotificationsEnabled } from "./merchantAttendanceEventNotifications.server";
import * as p from "./merchantAttendanceDelegatedPlanExceptions";
export const DELEGATED_PLAN_EXCEPTIONS_TIMEOUT_MS = 10000;
type Environment = Readonly<Record<string, string | undefined>>;
export function delegatedPlanExceptionsSiteEnabled(site: string, env: Environment = process.env): boolean {
  const raw = env.FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_SITE_IDS;
  if (env.FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_ENABLED !== "1" || !/^[0-9]{8}$/.test(site) || typeof raw !== "string" || raw.length > 575) return false;
  const ids = raw.split(","); return ids.length <= 64 && new Set(ids).size === ids.length && ids.every(s => /^[0-9]{8}$/.test(s)) && ids.includes(site);
}
export type DelegatedPlanExceptionsServiceInput = Readonly<{ query: p.DelegatedPlanExceptionsQuery; command: p.DelegatedPlanExceptionsCommand | null; authUserId: string; allowWrite: boolean }>;
export type DelegatedPlanExceptionsReceiptInput = Readonly<{ query: p.DelegatedPlanExceptionsQuery; authUserId: string }>;
export type DelegatedPlanExceptionsRecoveryInput = DelegatedPlanExceptionsReceiptInput & Readonly<{ expectedCommand: p.DelegatedPlanExceptionsCommand }>;
export type DelegatedPlanExceptionsDependencies = Readonly<{ environment?: () => Environment; timeoutMs?: number }>;
function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
function requestValue<T>(run: () => T): T { try { return run(); } catch { return fail(); } }
function input(raw: unknown, keys: readonly string[]) { return requestValue(() => { assertDelegatedAuditTree(raw, p.DELEGATED_PLAN_EXCEPTIONS_REQUEST_BYTES + 256); return captureBrowserExact(raw, keys); }); }
export function createDelegatedPlanExceptionsService(service: AttendanceSelfRpc | null, deps: DelegatedPlanExceptionsDependencies = {}) {
  const timeout = deps.timeoutMs ?? DELEGATED_PLAN_EXCEPTIONS_TIMEOUT_MS, env = deps.environment ?? (() => process.env);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > DELEGATED_PLAN_EXCEPTIONS_TIMEOUT_MS) fail();
  async function bounded<T>(signal: AbortSignal | undefined, run: (guard: () => void) => Promise<T>): Promise<T> {
    const deadline = performance.now() + timeout; let closed = false, timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
    const guard = () => { if (closed || signal?.aborted || performance.now() >= deadline) fail("attendance_delegated_plan_exceptions_invalid"); };
    try {
      guard(); const interrupted = new Promise<never>((_, reject) => { cancel = () => { closed = true; reject(new MerchantAttendanceError("attendance_delegated_plan_exceptions_invalid")); };
        timer = setTimeout(cancel, timeout); signal?.addEventListener("abort", cancel, { once: true }); });
      const result = await Promise.race([run(guard), interrupted]); guard(); return result;
    } catch (error) { if (error instanceof MerchantAttendanceError && Object.hasOwn(p.DELEGATED_PLAN_EXCEPTIONS_ERRORS, error.code)) throw error; return fail("attendance_delegated_plan_exceptions_invalid"); }
    finally { closed = true; if (timer !== undefined) clearTimeout(timer); if (cancel) signal?.removeEventListener("abort", cancel); }
  }
  async function rpc(q: p.DelegatedPlanExceptionsQuery, actor: string, c: p.DelegatedPlanExceptionsCommand | null, allowed: boolean,
    expected: p.DelegatedPlanExceptionsCommand | null, guard: () => void): Promise<p.DelegatedPlanExceptionsResult> {
    guard(); if (!service) return fail("attendance_delegated_plan_exceptions_invalid"); let result;
    //Recovery never consults current rollout and never captures new messages.
    const environment = q.mode === "recover" ? null : env(); guard();
    try { result = await service.rpc(p.DELEGATED_PLAN_EXCEPTIONS_RPC, { p_query: q, p_auth_user_id: actor, p_command: c, p_allow_write: allowed,
      p_allow_posthoc: environment !== null && planPosthocReviewSiteEnabled(q.siteId, environment),
      p_allow_clearance: environment !== null && planClearanceSiteEnabled(q.siteId, environment),
      p_capture_notifications: c !== null && environment !== null && eventNotificationsEnabled(q.siteId, "capture", environment) }); }
    catch { return fail("attendance_delegated_plan_exceptions_invalid"); } guard();
    if (!result || typeof result !== "object") return fail("attendance_delegated_plan_exceptions_invalid");
    const data = Object.getOwnPropertyDescriptor(result, "data"), error = Object.getOwnPropertyDescriptor(result, "error");
    if (!data || !("value" in data) || !error || !("value" in error)) return fail("attendance_delegated_plan_exceptions_invalid");
    if (error.value !== null) {
      const code = error.value && typeof error.value === "object" ? Object.getOwnPropertyDescriptor(error.value, "message")?.value : null;
      return fail(typeof code === "string" && Object.hasOwn(p.DELEGATED_PLAN_EXCEPTIONS_ERRORS, code) ? code : "attendance_delegated_plan_exceptions_invalid");
    }
    const parsed = await p.parseDelegatedPlanExceptionsResult(data.value, q, actor, expected); guard(); return parsed;
  }
  return Object.freeze({
    execute(raw: DelegatedPlanExceptionsServiceInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const v = input(raw, ["query", "command", "authUserId", "allowWrite"]), q = requestValue(() => p.parseDelegatedPlanExceptionsQuery(v.query)), actor = attendanceSelfUuid(v.authUserId);
      if (typeof v.allowWrite !== "boolean") fail(); const allowed = v.allowWrite, c = v.command === null ? null : requestValue(() => p.parseDelegatedPlanExceptionsCommand(v.command));
      if (c !== null && q.mode !== "context") fail(); if (q.mode === "recover") return rpc(q, actor, null, false, null, guard);
      if (c !== null) {
        const recover: p.DelegatedPlanExceptionsQuery = Object.freeze({ siteId: q.siteId, grantId: q.grantId, mode: "recover", operationId: c.operationId });
        const prior = await rpc(recover, actor, null, false, c, guard);
        if (prior.kind !== "receipt") fail("attendance_delegated_plan_exceptions_invalid");
        if (prior.receipt !== null) {
          if (prior.receipt.reference.workerId !== q.workerId || prior.receipt.reference.slotId !== q.slotId) fail("attendance_operation_conflict"); return prior;
        }
      }
      guard(); if (!allowed || !delegatedPlanExceptionsSiteEnabled(q.siteId, env())) fail("attendance_delegated_plan_exceptions_disabled");
      const current = await rpc(q, actor, null, true, null, guard);
      if (current.kind !== "context") fail("attendance_delegated_plan_exceptions_invalid"); if (c === null) return current;
      p.delegatedPlanExceptionsCommandForContext(current, c); guard();
      if (!delegatedPlanExceptionsSiteEnabled(q.siteId, env())) fail("attendance_delegated_plan_exceptions_disabled");
      return rpc(q, actor, c, true, c, guard);
    }); },
    readReceipt(raw: DelegatedPlanExceptionsReceiptInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const v = input(raw, ["query", "authUserId"]), q = requestValue(() => p.parseDelegatedPlanExceptionsQuery(v.query)), actor = attendanceSelfUuid(v.authUserId);
      if (q.mode !== "recover") fail(); return rpc(q, actor, null, false, null, guard);
    }); },
    recover(raw: DelegatedPlanExceptionsRecoveryInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const v = input(raw, ["query", "authUserId", "expectedCommand"]), q = requestValue(() => p.parseDelegatedPlanExceptionsQuery(v.query)), actor = attendanceSelfUuid(v.authUserId), c = requestValue(() => p.parseDelegatedPlanExceptionsCommand(v.expectedCommand));
      if (q.mode !== "recover" || q.operationId !== c.operationId) fail(); return rpc(q, actor, null, false, c, guard);
    }); },
  });
}
export function executeDelegatedPlanExceptions(input: DelegatedPlanExceptionsServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedPlanExceptionsService(service).execute(input, signal);
}
export function readDelegatedPlanExceptionsReceipt(input: DelegatedPlanExceptionsReceiptInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedPlanExceptionsService(service).readReceipt(input, signal);
}
