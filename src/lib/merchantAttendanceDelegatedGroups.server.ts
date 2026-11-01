import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import type { GroupsCommand } from "./merchantAttendanceGroups";
import { DELEGATED_GROUPS_ERRORS, parseDelegatedGroupsQuery, parseDelegatedGroupsCommand, parseDelegatedGroupsResult, type DelegatedGroupsQuery } from "./merchantAttendanceDelegatedGroups";

export const DELEGATED_GROUPS_RPC = "faolla_attendance_delegated_groups_v1";
export const DELEGATED_GROUPS_TIMEOUT_MS = 10000;
export function delegatedGroupsSiteEnabled(site: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const raw = env.FAOLLA_ATTENDANCE_DELEGATED_GROUPS_SITE_IDS;
  if (env.FAOLLA_ATTENDANCE_DELEGATED_GROUPS_ENABLED !== "1" || !/^[0-9]{8}$/.test(site) || typeof raw !== "string" || raw.length > 575) return false;
  const ids = raw.split(","); return ids.length <= 64 && new Set(ids).size === ids.length && ids.every(s => /^[0-9]{8}$/.test(s)) && ids.includes(site);
}
export type DelegatedGroupsInput = Readonly<{ query: DelegatedGroupsQuery; command: GroupsCommand | null; authUserId: string; allowWrite: boolean }>;
export type DelegatedGroupsRecoveryInput = Readonly<{ query: Extract<DelegatedGroupsQuery, { mode: "recover" }>; expectedCommand: GroupsCommand; authUserId: string }>;
//HTTP GET returns only an original-actor minimal receipt. The browser retains
//its full command and independently verifies SHA before retiring any intent.
export type DelegatedGroupsReceiptInput = Readonly<{ query: Extract<DelegatedGroupsQuery, { mode: "recover" }>; authUserId: string }>;
export function createDelegatedGroupsService(service: AttendanceSelfRpc | null, deps: Readonly<{ enabled?: (site: string) => boolean; timeoutMs?: number }> = {}) {
  const timeout = deps.timeoutMs ?? DELEGATED_GROUPS_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > DELEGATED_GROUPS_TIMEOUT_MS) throw new MerchantAttendanceError("attendance_invalid_request");
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
  async function rpc(q: DelegatedGroupsQuery, actor: string, c: GroupsCommand | null, allow: boolean, expected: GroupsCommand | null, guard: () => void) {
    guard(); if (!service) throw new MerchantAttendanceError("attendance_unavailable");
    let r; try { r = await service.rpc(DELEGATED_GROUPS_RPC, { p_query: q, p_auth_user_id: actor, p_command: c, p_allow_write: allow }); }
    catch { throw new MerchantAttendanceError("attendance_unavailable"); } guard();
    if (r.error) { const code = r.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(DELEGATED_GROUPS_ERRORS, code) ? code : "attendance_unavailable"); }
    const parsed = await parseDelegatedGroupsResult(r.data, q, actor, expected); guard(); return parsed;
  }
  return Object.freeze({
    readReceipt(raw: DelegatedGroupsReceiptInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const q = parseDelegatedGroupsQuery(raw.query), actor = attendanceSelfUuid(raw.authUserId);
      if (q.mode !== "recover") throw new MerchantAttendanceError("attendance_invalid_request");
      return rpc(q, actor, null, false, null, guard);
    }); },
    execute(raw: DelegatedGroupsInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const q = parseDelegatedGroupsQuery(raw.query), actor = attendanceSelfUuid(raw.authUserId), c = raw.command === null ? null : parseDelegatedGroupsCommand(raw.command), allow = raw.allowWrite;
      if (q.mode !== "context" || typeof allow !== "boolean") throw new MerchantAttendanceError("attendance_invalid_request");
      if (c === null) return rpc(q, actor, null, false, null, guard);
      const recovery = await rpc({ siteId: q.siteId, grantId: q.grantId, mode: "recover", operationId: c.operationId }, actor, null, false, c, guard);
      if (recovery.kind !== "receipt") throw new MerchantAttendanceError("attendance_delegated_groups_invalid");
      if (recovery.receipt !== null) return recovery;
      guard(); if (!allow || !(deps.enabled ?? delegatedGroupsSiteEnabled)(q.siteId)) throw new MerchantAttendanceError("attendance_delegated_groups_disabled");
      return rpc(q, actor, c, true, c, guard);
    }); },
    recover(raw: DelegatedGroupsRecoveryInput, signal?: AbortSignal) { return bounded(signal, async guard => {
      const q = parseDelegatedGroupsQuery(raw.query), actor = attendanceSelfUuid(raw.authUserId), c = parseDelegatedGroupsCommand(raw.expectedCommand);
      if (q.mode !== "recover" || q.operationId !== c.operationId) throw new MerchantAttendanceError("attendance_invalid_request");
      return rpc(q, actor, null, false, c, guard);
    }); },
  });
}
export function executeDelegatedGroups(input: DelegatedGroupsInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedGroupsService(service).execute(input, signal);
}
export function executeDelegatedGroupsRecovery(input: DelegatedGroupsRecoveryInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedGroupsService(service).recover(input, signal);
}
export function readDelegatedGroupsReceipt(input: DelegatedGroupsReceiptInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createDelegatedGroupsService(service).readReceipt(input, signal);
}
