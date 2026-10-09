//208 only. Every RPC uses actual authenticated actor, never the merchant owner.
//SQL owns current 202 authority, settings locks, old CAS/evidence and append-only
//decision/effect + original-operation sidecar atomicity. No list/annul/KDF.
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree } from "./merchantAttendanceDelegatedAudit";
import * as p from "./merchantAttendanceDelegatedRevisions";

export const DELEGATED_REVISIONS_TIMEOUT_MS = 10000;
type Environment = Readonly<Record<string, string | undefined>>;
export function delegatedRevisionsSiteEnabled(site: string, env: Environment = process.env): boolean {
  const raw = env.FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_SITE_IDS;
  if (env.FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_ENABLED !== "1" || !/^[0-9]{8}$/.test(site) || typeof raw !== "string" || raw.length > 575) return false;
  const ids = raw.split(","); return ids.length <= 64 && new Set(ids).size === ids.length && ids.every(s => /^[0-9]{8}$/.test(s)) && ids.includes(site);
}
export type DelegatedRevisionsServiceInput = Readonly<{ query: p.DelegatedRevisionsQuery; command: p.DelegatedRevisionsCommand | null; authUserId: string; allowWrite: boolean }>;
export type DelegatedRevisionsReceiptInput = Readonly<{ query: p.DelegatedRevisionsQuery; authUserId: string }>;
export type DelegatedRevisionsRecoveryInput = DelegatedRevisionsReceiptInput & Readonly<{ expectedCommand: p.DelegatedRevisionsCommand }>;
export type DelegatedRevisionsDependencies = Readonly<{ environment?: () => Environment; timeoutMs?: number }>;
function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
function requestValue<T>(run: () => T): T { try { return run(); } catch { return fail(); } }
function input(raw: unknown, keys: readonly string[]) {
  return requestValue(() => { assertDelegatedAuditTree(raw, p.DELEGATED_REVISIONS_REQUEST_BYTES + 256); return captureBrowserExact(raw, keys); });
}
export function createDelegatedRevisionsService(service: AttendanceSelfRpc | null, deps: DelegatedRevisionsDependencies = {}) {
  const timeout = deps.timeoutMs ?? DELEGATED_REVISIONS_TIMEOUT_MS, env = deps.environment ?? (() => process.env);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > DELEGATED_REVISIONS_TIMEOUT_MS) fail();
  async function bounded<T>(signal: AbortSignal | undefined, run: (guard: () => void) => Promise<T>): Promise<T> {
    const deadline = performance.now() + timeout; let closed = false, timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
    const guard = () => { if (closed || signal?.aborted || performance.now() >= deadline) fail("attendance_delegated_revisions_invalid"); };
    try {
      guard(); const interrupted = new Promise<never>((_, reject) => { cancel = () => { closed = true; reject(new MerchantAttendanceError("attendance_delegated_revisions_invalid")); };
        timer = setTimeout(cancel, timeout); signal?.addEventListener("abort", cancel, { once: true }); });
      const result = await Promise.race([run(guard), interrupted]); guard(); return result;
    } catch (error) {
      if (error instanceof MerchantAttendanceError && Object.hasOwn(p.DELEGATED_REVISIONS_ERRORS, error.code)) throw error;
      return fail("attendance_delegated_revisions_invalid");
    } finally { closed = true; if (timer !== undefined) clearTimeout(timer); if (cancel) signal?.removeEventListener("abort", cancel); }
  }
  async function rpc(q: p.DelegatedRevisionsQuery, actor: string, c: p.DelegatedRevisionsCommand | null, allowed: boolean,
    expected: p.DelegatedRevisionsCommand | null, guard: () => void): Promise<p.DelegatedRevisionsResult> {
    guard(); if (!service) return fail("attendance_delegated_revisions_invalid");
    let result;
    try { result = await service.rpc(p.DELEGATED_REVISIONS_RPC, { p_query: q, p_auth_user_id: actor, p_command: c, p_allow_write: allowed }); }
    catch { return fail("attendance_delegated_revisions_invalid"); } guard();
    if (!result || typeof result !== "object") return fail("attendance_delegated_revisions_invalid");
    const data = Object.getOwnPropertyDescriptor(result, "data"), error = Object.getOwnPropertyDescriptor(result, "error");
    if (!data || !("value" in data) || !error || !("value" in error)) return fail("attendance_delegated_revisions_invalid");
    if (error.value !== null) {
      const code = error.value && typeof error.value === "object" ? Object.getOwnPropertyDescriptor(error.value, "message")?.value : null;
      return fail(typeof code === "string" && Object.hasOwn(p.DELEGATED_REVISIONS_ERRORS, code) ? code : "attendance_delegated_revisions_invalid");
    }
    const parsed = await p.parseDelegatedRevisionsResult(data.value, q, actor, expected); guard(); return parsed;
  }
  return Object.freeze({
    execute(raw: DelegatedRevisionsServiceInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      //Freeze complete caller intent before the first asynchronous operation.
      const v = input(raw, ["query", "command", "authUserId", "allowWrite"]), q = requestValue(() => p.parseDelegatedRevisionsQuery(v.query)), actor = attendanceSelfUuid(v.authUserId);
      if (typeof v.allowWrite !== "boolean") fail(); const allowed = v.allowWrite;
      const c = v.command === null ? null : requestValue(() => p.parseDelegatedRevisionsCommand(v.command));
      if (c !== null && (q.mode !== "context" || q.requestId !== c.requestId)) fail();
      if (q.mode === "recover") return rpc(q, actor, null, false, null, guard);
      if (c !== null) {
        const recover: p.DelegatedRevisionsQuery = Object.freeze({ siteId: q.siteId, grantId: q.grantId, mode: "recover", operationId: c.operationId });
        const prior = await rpc(recover, actor, null, false, c, guard);
        if (prior.kind !== "receipt") fail("attendance_delegated_revisions_invalid"); if (prior.receipt !== null) return prior;
      }
      guard(); if (!allowed || !delegatedRevisionsSiteEnabled(q.siteId, env())) fail("attendance_delegated_revisions_disabled");
      //p_allow_write=true projects old eligibility only; command=NULL guarantees
      //this RPC is a fresh, current-authority read, not a business mutation.
      const current = await rpc(q, actor, null, true, null, guard);
      if (current.kind !== "context") fail("attendance_delegated_revisions_invalid"); if (c === null) return current;
      p.delegatedRevisionsCommandForContext(current, c); guard();
      if (!delegatedRevisionsSiteEnabled(q.siteId, env())) fail("attendance_delegated_revisions_disabled");
      return rpc(q, actor, c, true, c, guard);
    }); },
    readReceipt(raw: DelegatedRevisionsReceiptInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const v = input(raw, ["query", "authUserId"]), q = requestValue(() => p.parseDelegatedRevisionsQuery(v.query)), actor = attendanceSelfUuid(v.authUserId);
      if (q.mode !== "recover") fail(); return rpc(q, actor, null, false, null, guard);
    }); },
    recover(raw: DelegatedRevisionsRecoveryInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const v = input(raw, ["query", "authUserId", "expectedCommand"]), q = requestValue(() => p.parseDelegatedRevisionsQuery(v.query)), actor = attendanceSelfUuid(v.authUserId), c = requestValue(() => p.parseDelegatedRevisionsCommand(v.expectedCommand));
      if (q.mode !== "recover" || q.operationId !== c.operationId) fail(); return rpc(q, actor, null, false, c, guard);
    }); },
  });
}
export function executeDelegatedRevisions(input: DelegatedRevisionsServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedRevisionsService(service).execute(input, signal);
}
export function readDelegatedRevisionsReceipt(input: DelegatedRevisionsReceiptInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedRevisionsService(service).readReceipt(input, signal);
}
