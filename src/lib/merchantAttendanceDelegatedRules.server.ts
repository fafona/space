import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { DELEGATED_RULES_ERRORS, parseDelegatedRulesQuery, parseDelegatedRulesCommand, parseDelegatedRulesResult,
  type DelegatedRulesQuery, type DelegatedRulesCommand } from "./merchantAttendanceDelegatedRules";

export const DELEGATED_RULES_RPC = "faolla_attendance_delegated_rules_v1";
export const DELEGATED_RULES_TIMEOUT_MS = 10000;
export function delegatedRulesSiteEnabled(site: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const raw = env.FAOLLA_ATTENDANCE_DELEGATED_RULES_SITE_IDS;
  if (env.FAOLLA_ATTENDANCE_DELEGATED_RULES_ENABLED !== "1" || !/^[0-9]{8}$/.test(site) || typeof raw !== "string" || raw.length > 575) return false;
  const ids = raw.split(","); return ids.length <= 64 && new Set(ids).size === ids.length && ids.every(s => /^[0-9]{8}$/.test(s)) && ids.includes(site);
}
export type DelegatedRulesInput = Readonly<{ query: DelegatedRulesQuery; command: DelegatedRulesCommand | null; authUserId: string; allowWrite: boolean }>;
export type DelegatedRulesRecoveryInput = Readonly<{ query: Extract<DelegatedRulesQuery, { mode: "recover" }>; expectedCommand: DelegatedRulesCommand; authUserId: string }>;
export type DelegatedRulesReceiptInput = Readonly<{ query: Extract<DelegatedRulesQuery, { mode: "recover" }>; authUserId: string }>;
export function createDelegatedRulesService(service: AttendanceSelfRpc | null, deps: Readonly<{ enabled?: (site: string) => boolean; timeoutMs?: number }> = {}) {
  const timeout = deps.timeoutMs ?? DELEGATED_RULES_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > DELEGATED_RULES_TIMEOUT_MS) throw new MerchantAttendanceError("attendance_invalid_request");
  async function bounded<T>(signal: AbortSignal | undefined, run: (guard: () => void) => Promise<T>): Promise<T> {
    const deadline = performance.now() + timeout; let closed = false, timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined;
    const guard = () => { if (closed || signal?.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_delegated_rules_invalid"); };
    try {
      guard(); const cancellation = new Promise<never>((_, reject) => {
        const cancel = () => { closed = true; reject(new MerchantAttendanceError("attendance_delegated_rules_invalid")); };
        timer = setTimeout(cancel, timeout); onAbort = cancel; signal?.addEventListener("abort", cancel, { once: true });
      });
      const result = await Promise.race([run(guard), cancellation]); guard(); return result;
    } finally { closed = true; if (timer !== undefined) clearTimeout(timer); if (onAbort) signal?.removeEventListener("abort", onAbort); }
  }
  async function rpc(q: DelegatedRulesQuery, actor: string, c: DelegatedRulesCommand | null, allow: boolean, expected: DelegatedRulesCommand | null, guard: () => void) {
    guard(); if (!service) throw new MerchantAttendanceError("attendance_delegated_rules_invalid");
    let response;
    try { response = await service.rpc(DELEGATED_RULES_RPC, { p_query: q, p_auth_user_id: actor, p_command: c, p_allow_write: allow }); }
    catch { throw new MerchantAttendanceError("attendance_delegated_rules_invalid"); }
    guard();
    if (response.error) {
      const code = response.error.message ?? "";
      throw new MerchantAttendanceError(Object.hasOwn(DELEGATED_RULES_ERRORS, code) ? code : "attendance_delegated_rules_invalid");
    }
    const result = await parseDelegatedRulesResult(response.data, q, actor, expected); guard(); return result;
  }
  return Object.freeze({
    readReceipt(raw: DelegatedRulesReceiptInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const q = parseDelegatedRulesQuery(raw.query), actor = attendanceSelfUuid(raw.authUserId);
      if (q.mode !== "recover") throw new MerchantAttendanceError("attendance_invalid_request");
      return rpc(q, actor, null, false, null, guard);
    }); },
    execute(raw: DelegatedRulesInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      //Snapshot all caller intent before the first asynchronous read. The grant
      //and real actor remain inputs to SQL; no owner identity is substituted.
      const q = parseDelegatedRulesQuery(raw.query), actor = attendanceSelfUuid(raw.authUserId), c = raw.command === null ? null : parseDelegatedRulesCommand(raw.command), allow = raw.allowWrite;
      if (q.mode === "recover" || typeof allow !== "boolean" || c !== null && q.mode !== "context") throw new MerchantAttendanceError("attendance_invalid_request");
      if (c === null) {
        //The established191 preview requires current write eligibility, even
        //though it does not create an operation. Other scoped reads do not.
        if (q.mode === "preview") {
          guard(); if (!allow || !(deps.enabled ?? delegatedRulesSiteEnabled)(q.siteId)) throw new MerchantAttendanceError("attendance_delegated_rules_disabled");
          guard(); return rpc(q, actor, null, true, null, guard);
        }
        return rpc(q, actor, null, false, null, guard);
      }
      if (c.family === "operational" && c.decision.siteId !== q.siteId) throw new MerchantAttendanceError("attendance_invalid_request");
      const recovery = await rpc({ siteId: q.siteId, grantId: q.grantId, mode: "recover", operationId: c.decision.operationId }, actor, null, false, c, guard);
      if (recovery.kind !== "receipt") throw new MerchantAttendanceError("attendance_delegated_rules_invalid");
      if (recovery.receipt !== null) return recovery;
      guard(); if (!allow || !(deps.enabled ?? delegatedRulesSiteEnabled)(q.siteId)) throw new MerchantAttendanceError("attendance_delegated_rules_disabled");
      guard(); return rpc(q, actor, c, true, c, guard);
    }); },
    recover(raw: DelegatedRulesRecoveryInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const q = parseDelegatedRulesQuery(raw.query), actor = attendanceSelfUuid(raw.authUserId), c = parseDelegatedRulesCommand(raw.expectedCommand);
      if (q.mode !== "recover" || q.operationId !== c.decision.operationId) throw new MerchantAttendanceError("attendance_invalid_request");
      return rpc(q, actor, null, false, c, guard);
    }); },
  });
}
export function executeDelegatedRules(input: DelegatedRulesInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedRulesService(service).execute(input, signal);
}
export function executeDelegatedRulesRecovery(input: DelegatedRulesRecoveryInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedRulesService(service).recover(input, signal);
}
export function readDelegatedRulesReceipt(input: DelegatedRulesReceiptInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedRulesService(service).readReceipt(input, signal);
}
