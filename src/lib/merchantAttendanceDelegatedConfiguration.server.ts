import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { DELEGATED_CONFIGURATION_ERRORS, parseDelegatedConfigurationQuery, parseDelegatedConfigurationCommand, parseDelegatedConfigurationResult, type DelegatedConfigurationQuery, type DelegatedConfigurationCommand } from "./merchantAttendanceDelegatedConfiguration";

export const DELEGATED_CONFIGURATION_RPC = "faolla_attendance_delegated_config_v1";
export const DELEGATED_CONFIGURATION_TIMEOUT_MS = 10000;
export function delegatedConfigurationSiteEnabled(site: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const raw = env.FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_SITE_IDS;
  if (env.FAOLLA_ATTENDANCE_DELEGATED_CONFIGURATION_ENABLED !== "1" || !/^[0-9]{8}$/.test(site) || typeof raw !== "string" || raw.length > 575) return false;
  const ids = raw.split(","); return ids.length <= 64 && new Set(ids).size === ids.length && ids.every(s => /^[0-9]{8}$/.test(s)) && ids.includes(site);
}
export type DelegatedConfigurationInput = Readonly<{ query: DelegatedConfigurationQuery; command: DelegatedConfigurationCommand | null; authUserId: string; allowWrite: boolean }>;
export type DelegatedConfigurationRecoveryInput = Readonly<{ query: Extract<DelegatedConfigurationQuery, { mode: "recover" }>; expectedCommand: DelegatedConfigurationCommand; authUserId: string }>;
//HTTP GET returns only an original-actor minimal receipt. The browser retains
//its full command and independently verifies SHA before retiring any intent.
export type DelegatedConfigurationReceiptInput = Readonly<{ query: Extract<DelegatedConfigurationQuery, { mode: "recover" }>; authUserId: string }>;
export function createDelegatedConfigurationService(service: AttendanceSelfRpc | null, deps: Readonly<{ enabled?: (site: string) => boolean; timeoutMs?: number }> = {}) {
  const timeout = deps.timeoutMs ?? DELEGATED_CONFIGURATION_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > DELEGATED_CONFIGURATION_TIMEOUT_MS) throw new MerchantAttendanceError("attendance_invalid_request");
  async function bounded<T>(signal: AbortSignal | undefined, run: (guard: () => void) => Promise<T>): Promise<T> {
    const started = performance.now(); let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined;
    const guard = () => { if (signal?.aborted || performance.now() - started >= timeout) throw new MerchantAttendanceError("attendance_unavailable"); };
    try {
      guard(); const cancellation = new Promise<never>((_, reject) => {
        const cancel = () => reject(new MerchantAttendanceError("attendance_unavailable"));
        timer = setTimeout(cancel, timeout); onAbort = cancel; signal?.addEventListener("abort", cancel, { once: true });
      });
      return await Promise.race([run(guard), cancellation]);
    } finally { if (timer !== undefined) clearTimeout(timer); if (onAbort) signal?.removeEventListener("abort", onAbort); }
  }
  async function rpc(q: DelegatedConfigurationQuery, actor: string, c: DelegatedConfigurationCommand | null, allow: boolean, expected: DelegatedConfigurationCommand | null, guard: () => void) {
    guard(); if (!service) throw new MerchantAttendanceError("attendance_unavailable");
    let r; try { r = await service.rpc(DELEGATED_CONFIGURATION_RPC, { p_query: q, p_auth_user_id: actor, p_command: c, p_allow_write: allow }); }
    catch { throw new MerchantAttendanceError("attendance_unavailable"); } guard();
    if (r.error) { const code = r.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(DELEGATED_CONFIGURATION_ERRORS, code) ? code : "attendance_unavailable"); }
    const parsed = await parseDelegatedConfigurationResult(r.data, q, actor, expected); guard(); return parsed;
  }
  return Object.freeze({
    readReceipt(raw: DelegatedConfigurationReceiptInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const q = parseDelegatedConfigurationQuery(raw.query), actor = attendanceSelfUuid(raw.authUserId);
      if (q.mode !== "recover") throw new MerchantAttendanceError("attendance_invalid_request");
      return rpc(q, actor, null, false, null, guard);
    }); },
    execute(raw: DelegatedConfigurationInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const q = parseDelegatedConfigurationQuery(raw.query), actor = attendanceSelfUuid(raw.authUserId), c = raw.command === null ? null : parseDelegatedConfigurationCommand(raw.command), allow = raw.allowWrite;
      if (q.mode !== "context" || typeof allow !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
      if (c === null) return rpc(q, actor, null, false, null, guard);
      const recovery = await rpc({ siteId: q.siteId, grantId: q.grantId, mode: "recover", operationId: c.operationId }, actor, null, false, c, guard);
      if (recovery.kind !== "receipt") throw new MerchantAttendanceError("attendance_delegated_configuration_invalid");
      if (recovery.receipt !== null) return recovery;
      guard(); if (!allow || !(deps.enabled ?? delegatedConfigurationSiteEnabled)(q.siteId)) throw new MerchantAttendanceError("attendance_delegated_configuration_disabled");
      return rpc(q, actor, c, true, c, guard);
    }); },
    recover(raw: DelegatedConfigurationRecoveryInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const q = parseDelegatedConfigurationQuery(raw.query), actor = attendanceSelfUuid(raw.authUserId), c = parseDelegatedConfigurationCommand(raw.expectedCommand);
      if (q.mode !== "recover" || q.operationId !== c.operationId) throw new MerchantAttendanceError("attendance_invalid_request");
      return rpc(q, actor, null, false, c, guard);
    }); },
  });
}
export function executeDelegatedConfiguration(input: DelegatedConfigurationInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedConfigurationService(service).execute(input, signal);
}
export function executeDelegatedConfigurationRecovery(input: DelegatedConfigurationRecoveryInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedConfigurationService(service).recover(input, signal);
}
export function readDelegatedConfigurationReceipt(input: DelegatedConfigurationReceiptInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedConfigurationService(service).readReceipt(input, signal);
}
