// A reminder is only a stale pointer. This self-only GET checks the actual
// current 193 workspace; it neither prepares a write nor opens another worker.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { site, uuid } from "./merchantAttendancePlanExceptionValidation";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { assertAttendanceReminderTree, type AttendanceReminderTarget } from "./merchantAttendanceReminders";
import { attendanceReminderPendingKey } from "./merchantAttendanceRemindersClient";
import type { ReminderNavigationState } from "./merchantAttendanceRemindersNavigation";
import { OPERATIONAL_PUNCH_RESPONSE_LIMIT, parseOperationalPunchJson, parseOperationalPunchResponse } from "./merchantAttendanceOperationalPunch";
import { operationalPunchPendingKey } from "./merchantAttendanceOperationalPunchClient";
import { operationalPunchUiBlockedKeys, operationalPunchUiErrors } from "./merchantAttendanceOperationalPunchUi";

export type ReminderSelfSessionTarget = Extract<AttendanceReminderTarget, { kind: "open_session" }>;
export type ReminderSelfSessionSelection = Readonly<{ siteId: string; authUserId: string; employeeId: string; workerId: string; startEventId: string }>;
export type ReminderSelfNavigationOptions = Readonly<{ siteId: string; actorId: string; employeeId: string; apiFetch: AttendanceApiFetch;
  storage: () => Pick<Storage, "getItem">; isCurrentAuth: () => boolean; onState?: (state: ReminderNavigationState) => void; timeoutMs?: number }>;
function unavailable(): never { throw new MerchantAttendanceError("attendance_reminder_changed"); }
const hidden = () => typeof document !== "undefined" && document.hidden;

export function reminderSelfNavigationPendingKeys(siteId: string, actorId: string, employeeId: string): readonly string[] {
  const scope = { siteId: site(siteId), channel: "self" as const, authUserId: uuid(actorId), terminalId: null, workerNo: null };
  return freeze([...operationalPunchUiBlockedKeys(scope, uuid(employeeId)), operationalPunchPendingKey(scope), attendanceReminderPendingKey(scope.siteId, scope.authUserId)]);
}

export class AttendanceReminderSelfNavigation {
  private readonly options: ReminderSelfNavigationOptions;
  private readonly keys: readonly string[];
  private state: ReminderNavigationState = freeze({ phase: "idle", message: "须重新核对本人当前班次；提醒不会自动打卡。" });
  private controller: AbortController | null = null; private generation = 0; private notifying = false;
  constructor(options: ReminderSelfNavigationOptions) {
    this.keys = reminderSelfNavigationPendingKeys(options.siteId, options.actorId, options.employeeId);
    if (typeof options.apiFetch !== "function" || typeof options.storage !== "function" || typeof options.isCurrentAuth !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) unavailable();
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  private publish(state: ReminderNavigationState) { this.state = freeze(state); if (!this.notifying) { this.notifying = true;
    try { this.options.onState?.(this.state); } catch { /* Observers confer no authority. */ } finally { this.notifying = false; } } }
  pause = () => { ++this.generation; const prior = this.controller; this.controller = null; prior?.abort();
    this.publish({ phase: "idle", message: "本人班次资料已隐藏；请重新核对。" }); };
  hasLeaveRisk = () => this.controller !== null;
  private current() { try { return !hidden() && this.options.isCurrentAuth() === true; } catch { return false; } }
  private noPending() { const storage = this.options.storage(); for (const key of this.keys) {
    if (!this.current() || storage.getItem(key) !== null) unavailable();
  } }
  freshSession = async (raw: AttendanceReminderTarget): Promise<ReminderSelfSessionSelection> => {
    assertAttendanceReminderTree(raw, "request"); const r = exact(raw, ["kind", "workerId", "startEventId"]);
    if (r.kind !== "open_session") unavailable();
    const target: ReminderSelfSessionTarget = freeze({ kind: "open_session", workerId: uuid(r.workerId), startEventId: uuid(r.startEventId) });
    if (this.controller || !this.current()) unavailable();
    const controller = new AbortController(), generation = ++this.generation, deadline = performance.now() + (this.options.timeoutMs ?? 12000);
    this.controller = controller;
    const guard = () => { if (!this.current() || this.controller !== controller || controller.signal.aborted || generation !== this.generation || performance.now() >= deadline) unavailable();
      this.noPending(); if (!this.current() || this.controller !== controller || controller.signal.aborted || generation !== this.generation || performance.now() >= deadline) unavailable(); };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (error: Error) => void;
    const interrupted = new Promise<never>((_, no) => { reject = no; }), abort = () => { void reader?.cancel().catch(() => {}); reject(Error("cancelled")); };
    controller.signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - performance.now()));
    try {
      return await Promise.race([Promise.resolve().then(async () => {
        guard(); this.publish({ phase: "loading", message: "正在核对本人当前未结束班次；未提交打卡或标记已读。" }); guard();
        const query = new URLSearchParams({ siteId: this.options.siteId, mode: "prepare" });
        const response = await this.options.apiFetch(`/api/merchant-enterprise/attendance/operational-punch-self?${query}`, {
          method: "GET", cache: "no-store", redirect: "error", signal: controller.signal, headers: { Accept: "application/json" } });
        try { guard(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
        if (response.status !== 200 || !response.ok || response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
          void response.body?.cancel().catch(() => {}); unavailable(); }
        reader = response.body?.getReader(); if (!reader) unavailable(); let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
        try { while (true) { const part = await reader.read(); guard(); if (part.done) break; bytes += part.value.byteLength;
          if (bytes > OPERATIONAL_PUNCH_RESPONSE_LIMIT) unavailable(); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
        finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
        const parsed = await parseOperationalPunchResponse(parseOperationalPunchJson(text), {
          siteId: this.options.siteId, channel: "self", authUserId: this.options.actorId, query: { mode: "prepare" }, command: null, write: false,
        }, operationalPunchUiErrors("self")); guard();
        if (!parsed.ok) unavailable(); const result = parsed.data, session = result.session;
        if (result.channel !== "self" || !session || result.clock.state.status === "off" || result.operation !== null
          || result.clock.workerId !== target.workerId || session.workerId !== target.workerId || session.startEventId !== target.startEventId
          || session.employeeId !== this.options.employeeId || session.employeeAuthUserId !== this.options.actorId) unavailable();
        const selection = freeze({ siteId: this.options.siteId, authUserId: this.options.actorId, employeeId: this.options.employeeId,
          workerId: target.workerId, startEventId: target.startEventId });
        this.publish({ phase: "ready", message: "本人当前班次已核对；进入原工作区后仍须明确读取和确认，不会自动打卡。" }); guard(); return selection;
      }), interrupted]);
    } catch { if (generation === this.generation) this.publish({ phase: "blocked", message: "无法确认这是本人当前未结束班次；未跳转、未打卡、未标记已读。" }); return unavailable(); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); if (this.controller === controller) this.controller = null; }
  };
}
