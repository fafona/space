//201 server-only adapters. No system HTTP route, timer registration, cron,
//merchant discovery, automatic retry, or browser-selectable actor domain.
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { captureBrowserExact as exact, captureBrowserUuid } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseAttendanceReminderQuery, parseAttendanceReminderBody, parseAttendanceReminderCommand, parseAttendanceReminderSystemQuery,
  parseAttendanceReminderResult, parseAttendanceReminderSystemResult,
  type AttendanceReminderQuery, type AttendanceReminderCommand, type AttendanceReminderSystemQuery,
  type AttendanceReminderSystemRunQuery, type AttendanceReminderResult } from "./merchantAttendanceReminders";

export const ATTENDANCE_REMINDERS_RPC = "faolla_attendance_reminders_v1";
export const ATTENDANCE_REMINDERS_RUN_RPC = "faolla_attendance_reminders_run_v1";
export const ATTENDANCE_REMINDER_TIMEOUT_MS = 10000;
export const ATTENDANCE_REMINDER_ERRORS = Object.freeze({ attendance_invalid_request: 400, attendance_reminder_invalid: 503,
  attendance_reminder_changed: 409, attendance_reminder_disabled: 403, attendance_reminder_too_large: 422,
  attendance_access_denied: 403, attendance_settings_required: 409, attendance_operation_conflict: 409 } as const);
type Environment = Readonly<Record<string, string | undefined>>;
export type AttendanceReminderServiceDependencies = Readonly<{ environment?: () => Environment; signal?: AbortSignal;
  // Internal deterministic test seam only; production uses a monotonic clock.
  now?: () => number }>;
export type AttendanceReminderServiceInput = Readonly<{ query: AttendanceReminderQuery; command: AttendanceReminderCommand | null; authUserId: string; allowWrite: boolean }>;
export type AttendanceReminderRecoveryInput = Readonly<{ query: Extract<AttendanceReminderQuery, { mode: "recover" }>; authUserId: string; expectedCommand: AttendanceReminderCommand }>;

const invalid = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const unavailable = (): never => { throw new MerchantAttendanceError("attendance_reminder_invalid"); };
const disabled = (): never => { throw new MerchantAttendanceError("attendance_reminder_disabled"); };
const actorUuid = (v: unknown): string => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : invalid();
function enabled(siteId: string, flag: unknown, raw: unknown): boolean {
  if (typeof siteId !== "string" || siteId.length !== 8 || !/^[0-9]{8}$/.test(siteId) || flag !== "1" || typeof raw !== "string" || raw.length > 575) return false;
  const ids = raw.split(","); return ids.length <= 64 && new Set(ids).size === ids.length
    && ids.every(id => id.length === 8 && /^[0-9]{8}$/.test(id)) && ids.includes(siteId);
}
export function attendanceRemindersSiteEnabled(siteId: string, env: Environment = process.env): boolean {
  return enabled(siteId, env.FAOLLA_ATTENDANCE_REMINDERS_ENABLED, env.FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS);
}
export function attendanceRemindersRunnerSiteEnabled(siteId: string, env: Environment = process.env): boolean {
  return attendanceRemindersSiteEnabled(siteId, env) && enabled(siteId, env.FAOLLA_ATTENDANCE_REMINDERS_RUNNER_ENABLED, env.FAOLLA_ATTENDANCE_REMINDERS_RUNNER_SITE_IDS);
}
/** One deadline covers recovery, digest verification and any first writer.
 * Cancellation/timeout cannot undo a writer already dispatched to SQL. Its
 * outcome remains unknown and must be recovered by the same original id. */
async function bounded<T>(dependencies: AttendanceReminderServiceDependencies, action: (guard: () => void) => Promise<T>): Promise<T> {
  const now = dependencies.now ?? (() => performance.now()), signal = dependencies.signal;
  let interrupted = false, timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
  let previous: number;
  try { previous = now(); } catch { return unavailable(); }
  if (!Number.isFinite(previous) || previous < 0) return unavailable(); const deadline = previous + ATTENDANCE_REMINDER_TIMEOUT_MS;
  const guard = () => {
    let value: number; try { value = now(); } catch { return unavailable(); }
    if (interrupted || signal?.aborted || !Number.isFinite(value) || value < previous || value >= deadline) return unavailable(); previous = value;
  };
  try {
    guard(); const stopped = new Promise<never>((_, reject) => {
      cancel = () => { interrupted = true; reject(new MerchantAttendanceError("attendance_reminder_invalid")); };
      signal?.addEventListener("abort", cancel, { once: true }); timer = setTimeout(cancel, ATTENDANCE_REMINDER_TIMEOUT_MS);
    });
    // Start parsing synchronously so mutable caller input is detached before
    // this adapter's first async boundary (including a delayed RPC).
    guard(); const value = await Promise.race([action(guard), stopped]); guard(); return value;
  } catch (error) {
    if (error instanceof MerchantAttendanceError && Object.hasOwn(ATTENDANCE_REMINDER_ERRORS, error.code)) throw error;
    return unavailable();
  } finally { if (timer !== undefined) clearTimeout(timer); if (cancel) signal?.removeEventListener("abort", cancel); }
}
async function rpc(service: AttendanceSelfRpc | null, name: string, args: Record<string, unknown>, guard: () => void): Promise<unknown> {
  guard(); if (!service) return unavailable(); let response;
  try { response = await service.rpc(name, args); } catch { return unavailable(); } guard();
  if (!response || typeof response !== "object") return unavailable();
  const data = Object.getOwnPropertyDescriptor(response, "data"), error = Object.getOwnPropertyDescriptor(response, "error");
  if (!data || !("value" in data) || !data.enumerable || !error || !("value" in error) || !error.enumerable) return unavailable();
  if (error.value !== null) {
    const code = error.value && typeof error.value === "object" ? Object.getOwnPropertyDescriptor(error.value, "message")?.value : null;
    throw new MerchantAttendanceError(typeof code === "string" && Object.hasOwn(ATTENDANCE_REMINDER_ERRORS, code) ? code : "attendance_reminder_invalid");
  }
  return data.value;
}
function authInput(raw: AttendanceReminderServiceInput) {
  try {
    const v = exact(raw, ["query", "command", "authUserId", "allowWrite"]), query = parseAttendanceReminderQuery(v.query), authUserId = actorUuid(v.authUserId);
    if (typeof v.allowWrite !== "boolean") return invalid();
    const command = v.command === null ? null : parseAttendanceReminderBody({ query, command: v.command }).command;
    // A pending-intent recovery uses the separate SHA-bound method below.
    if (query.mode === "recover") return invalid(); return { query, command, authUserId, allowWrite: v.allowWrite };
  } catch { return invalid(); }
}
function recoveryInput(raw: AttendanceReminderRecoveryInput) {
  try {
    const v = exact(raw, ["query", "authUserId", "expectedCommand"]), query = parseAttendanceReminderQuery(v.query), authUserId = actorUuid(v.authUserId), command = parseAttendanceReminderCommand(v.expectedCommand);
    if (query.mode !== "recover" || query.operationId !== command.operationId) return invalid(); return { query, authUserId, command };
  } catch { return invalid(); }
}
export function createAttendanceRemindersService(service: AttendanceSelfRpc | null, dependencies: AttendanceReminderServiceDependencies = {}) {
  const environment = dependencies.environment ?? (() => process.env);
  async function recover(query: Extract<AttendanceReminderQuery, { mode: "recover" }>, authUserId: string, command: AttendanceReminderCommand, guard: () => void) {
    // Strict input snapshots already detached the original command. The result
    // projector hashes it only when a receipt exists, never today's source.
    guard();
    const raw = await rpc(service, ATTENDANCE_REMINDERS_RPC, { p_query: query, p_auth_user_id: authUserId, p_command: null, p_allow_write: false }, guard);
    const parsed = await parseAttendanceReminderResult(raw, query, authUserId, command); guard(); return parsed;
  }
  return Object.freeze({
    execute(input: AttendanceReminderServiceInput): Promise<AttendanceReminderResult> {
      return bounded(dependencies, async guard => {
        const { query, command, authUserId, allowWrite } = authInput(input); guard();
        if (command !== null) {
          const q: Extract<AttendanceReminderQuery, { mode: "recover" }> = { siteId: query.siteId, mode: "recover", batchId: null, operationId: command.operationId, cursor: null };
          const original = await recover(q, authUserId, command, guard); guard(); if (original.receipt !== null) return original;
          // Do not call fresh SQL with allow=false: that intentionally records a
          // disabled run. The default-off Node boundary must create zero facts.
          if (!allowWrite || !attendanceRemindersSiteEnabled(query.siteId, environment())) return disabled(); guard();
        }
        const raw = await rpc(service, ATTENDANCE_REMINDERS_RPC, { p_query: query, p_auth_user_id: authUserId, p_command: command, p_allow_write: command !== null }, guard);
        const parsed = await parseAttendanceReminderResult(raw, query, authUserId, command); guard(); return parsed;
      });
    },
    recover(input: AttendanceReminderRecoveryInput): Promise<AttendanceReminderResult> {
      return bounded(dependencies, async guard => { const { query, command, authUserId } = recoveryInput(input); guard(); return recover(query, authUserId, command, guard); });
    },
  });
}
/** The only system domain adapter. Trusted server code supplies one exact site
 * per call from configuration; no merchant enumeration or caller actor field. */
export function createAttendanceReminderSystemRunner(service: AttendanceSelfRpc | null, dependencies: AttendanceReminderServiceDependencies = {}) {
  const environment = dependencies.environment ?? (() => process.env);
  async function recover(query: Extract<AttendanceReminderSystemQuery, { mode: "recover" }>, originalRun: AttendanceReminderSystemRunQuery, guard: () => void) {
    if (originalRun.siteId !== query.siteId || originalRun.operationId !== query.operationId) return invalid();
    const raw = await rpc(service, ATTENDANCE_REMINDERS_RUN_RPC, { p_query: query, p_allow_run: false }, guard);
    const parsed = await parseAttendanceReminderSystemResult(raw, query, originalRun); guard(); return parsed;
  }
  return Object.freeze({
    run(rawQuery: AttendanceReminderSystemRunQuery): Promise<AttendanceReminderResult> {
      return bounded(dependencies, async guard => {
        const query = parseAttendanceReminderSystemQuery(rawQuery); if (query.mode !== "run") return invalid(); guard();
        const original = await recover({ siteId: query.siteId, mode: "recover", operationId: query.operationId, cursor: null }, query, guard);
        guard(); if (original.receipt !== null) return original;
        if (!attendanceRemindersRunnerSiteEnabled(query.siteId, environment())) return disabled(); guard();
        const raw = await rpc(service, ATTENDANCE_REMINDERS_RUN_RPC, { p_query: query, p_allow_run: true }, guard);
        const parsed = await parseAttendanceReminderSystemResult(raw, query); guard(); return parsed;
      });
    },
    recover(rawQuery: Extract<AttendanceReminderSystemQuery, { mode: "recover" }>, rawOriginalRun: AttendanceReminderSystemRunQuery): Promise<AttendanceReminderResult> {
      return bounded(dependencies, async guard => {
        const query = parseAttendanceReminderSystemQuery(rawQuery), originalRun = parseAttendanceReminderSystemQuery(rawOriginalRun);
        if (query.mode !== "recover" || originalRun.mode !== "run") return invalid(); guard(); return recover(query, originalRun, guard);
      });
    },
  });
}
export function executeAttendanceReminders(input: AttendanceReminderServiceInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createAttendanceRemindersService(service, { signal }).execute(input);
}
export function executeAttendanceReminderRecovery(input: AttendanceReminderRecoveryInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createAttendanceRemindersService(service, { signal }).recover(input);
}
export function executeAttendanceReminderSystemRun(query: AttendanceReminderSystemRunQuery, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createAttendanceReminderSystemRunner(service, { signal }).run(query);
}
export function executeAttendanceReminderSystemRecovery(query: Extract<AttendanceReminderSystemQuery, { mode: "recover" }>, originalRun: AttendanceReminderSystemRunQuery,
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient(), signal?: AbortSignal) {
  return createAttendanceReminderSystemRunner(service, { signal }).recover(query, originalRun);
}
