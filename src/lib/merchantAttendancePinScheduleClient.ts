import type { AttendanceAction } from "./merchantAttendance";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendancePin, pinWorkerNo } from "./merchantAttendancePin";
import { PIN_CLOCK_API, PIN_CLOCK_ERRORS, parsePinClockRequest, parsePinClockResult, pinClockMessage, type PinClockCommand, type PinClockResult } from "./merchantAttendancePinClock";
import { pinClockPendingKey, parsePinClockPending, type PinClockPending } from "./merchantAttendancePinClockClient";
import { captureBrowserExact as exact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { PIN_SCHEDULE_ERRORS, PIN_SCHEDULE_BYTE_LIMIT, parsePinScheduleHttpResult, type PinScheduleHttpResult } from "./merchantAttendancePinSchedule";
import type { SelfScheduleSelection } from "./merchantAttendanceSelfSchedule";

export type PinScheduleDevice = Readonly<{ siteId: string; terminalId: string; label: string }>;
export type PinScheduleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PinSchedulePending = Readonly<{ version: 1; siteId: string; terminalId: string; workerNo: string; command: PinClockCommand; selection: SelfScheduleSelection | null }>;
export type PinScheduleState = Readonly<{ phase: "entry" | "loading" | "ready" | "saving" | "unconfirmed" | "confirmed" | "blocked" | "storage_error";
  canConfirm: boolean;
  device: PinScheduleDevice | null; clock: PinClockResult | null; result: PinScheduleHttpResult | null;
  pending: PinSchedulePending | null; legacyPending: PinClockPending | null; message: string }>;
export type PinScheduleClientOptions = { apiFetch: AttendanceApiFetch; storage: () => PinScheduleStorage; enabled: boolean;
  randomId?: () => string; now?: () => number; timeoutMs?: number; secretMs?: number; resultMs?: number };
type Lease = { generation: number; controller: AbortController };
type Context = { device: PinScheduleDevice; workerNo: string; newKey: string; oldKey: string; newRaw: string | null; oldRaw: string | null };
const endpoint = "/api/merchant-enterprise/attendance/terminal-schedule";
const hidden = () => typeof document !== "undefined" && document.hidden;
class StorageFailure extends Error {}
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function selected(value: unknown): SelfScheduleSelection | null {
  if (value === null) return null; const v = exact(value, ["slotId", "revision"]);
  if (typeof v.revision !== "number" || !Number.isSafeInteger(v.revision) || v.revision < 1 || v.revision > 9007199254740990) throw Error("invalid_selection");
  return { slotId: attendanceSelfUuid(v.slotId), revision: v.revision };
}
export function pinSchedulePendingKey(device: Pick<PinScheduleDevice, "siteId" | "terminalId">, workerNo: string) {
  return `faolla:attendance:pin-schedule:v1:${attendanceSelfSite(device.siteId)}:${attendanceSelfUuid(device.terminalId)}:${encodeURIComponent(pinWorkerNo(workerNo).toLowerCase())}`;
}
export function parsePinSchedulePending(raw: string, device: PinScheduleDevice, workerNo: string): PinSchedulePending {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 4096) throw Error("invalid_pending");
  const v = exact(parseCaptureBrowserJson(raw), ["version", "siteId", "terminalId", "workerNo", "command", "selection"]);
  if (v.version !== 1 || v.siteId !== device.siteId || v.terminalId !== device.terminalId || pinWorkerNo(v.workerNo).toLowerCase() !== workerNo.toLowerCase()) throw Error("pending_identity");
  const command = parsePinClockRequest({ command: v.command, operationId: null }).command;
  if (!command || command.action !== "clock_in") throw Error("invalid_pending");
  return freeze({ version: 1, siteId: device.siteId, terminalId: device.terminalId, workerNo: v.workerNo as string, command, selection: selected(v.selection) });
}
/** Exact-key routing only. Errors deliberately select the fail-closed new flow;
 * no worker names, pending contents or PIN are exposed during local discovery. */
export function pinScheduleOwnsInput(enabled: boolean, device: PinScheduleDevice, workerNo: string, storage: () => PinScheduleStorage): boolean {
  if (enabled) return true;
  try { return storage().getItem(pinSchedulePendingKey(device, pinWorkerNo(workerNo.trim()))) !== null; } catch { return true; }
}
async function transport(api: AttendanceApiFetch, url: string, body: unknown, signal: AbortSignal, timeout: number) {
  const controller = new AbortController(), end = performance.now() + timeout;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (e: Error) => void = () => {};
  const cancellation = new Promise<never>((_, reject) => { rejectCancel = reject; });
  const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error("aborted_or_timeout")); };
  const timer = setTimeout(cancel, timeout); signal.addEventListener("abort", cancel, { once: true });
  const check = () => { if (signal.aborted || controller.signal.aborted || performance.now() >= end) throw Error("aborted_or_timeout"); };
  const run = async () => {
    check(); const response = await api(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal, cache: "no-store", redirect: "error" });
    check(); if (response.redirected || response.ok && response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", bytes = 0;
    try { while (true) { const { done, value } = await reader.read(); check(); if (done) break;
      bytes += value.byteLength; if (bytes > (response.status === 200 ? PIN_SCHEDULE_BYTE_LIMIT : 4096)) throw Error("oversized_response"); text += decoder.decode(value, { stream: true }); }
      text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    check(); const raw = parseCaptureBrowserJson(text); check();
    if (response.status !== 200) { const e = exact(raw, ["ok", "error"]), errors = { ...PIN_CLOCK_ERRORS, ...PIN_SCHEDULE_ERRORS };
      if (e.ok === false && typeof e.error === "string" && Object.hasOwn(errors, e.error) && errors[e.error] === response.status) throw Error(e.error);
      throw Error("invalid_error_response"); }
    return { raw, check };
  };
  try { return await Promise.race([run(), cancellation]); } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}

/** One PIN owner, one bounded confirmation window. The new opt-in flow may use
 * the original endpoint for non-clock-in actions/legacy recovery, but never
 * downgrades a new pending clock-in to the original writer. No PIN/lease stored. */
export class AttendancePinScheduleClient {
  private readonly options: Required<PinScheduleClientOptions>;
  private state: PinScheduleState = freeze({ phase: "entry", canConfirm: false, device: null, clock: null, result: null, pending: null, legacyPending: null, message: "请输入本人工号和 PIN，验证后才读取本人排班。" });
  private listeners = new Set<() => void>(); private generation = 0; private controller: AbortController | null = null;
  private context: Context | null = null; private pending: PinSchedulePending | null = null; private legacy: PinClockPending | null = null;
  private secret = ""; private secretUntil = 0; private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(input: PinScheduleClientOptions) {
    const timeoutMs = input.timeoutMs ?? 12000, secretMs = input.secretMs ?? 30000, resultMs = input.resultMs ?? 15000;
    if (typeof input.enabled !== "boolean" || typeof input.apiFetch !== "function" || typeof input.storage !== "function"
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000 || !Number.isInteger(secretMs) || secretMs < 1 || secretMs > 30000 || !Number.isInteger(resultMs) || resultMs < 1 || resultMs > 15000) throw Error("invalid_options");
    this.options = Object.freeze({ ...input, timeoutMs, secretMs, resultMs, now: input.now ?? Date.now, randomId: input.randomId ?? (() => crypto.randomUUID()) });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<PinScheduleState>) {
    const state = this.state = freeze({ ...this.state, ...patch, pending: this.pending, legacyPending: this.legacy, canConfirm: !!this.secret });
    for (const f of [...this.listeners]) { if (state !== this.state) break; try { f(); } catch { /* Observers do not authorize requests. */ } }
  }
  private forget() { this.secret = ""; this.secretUntil = 0; if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  clear = () => {
    const g = ++this.generation, c = this.controller; this.controller = null; c?.abort(); this.forget(); this.context = null; this.pending = null; this.legacy = null;
    if (g === this.generation) this.publish({ phase: "entry", device: null, clock: null, result: null, message: "资料和 PIN 已清除；原编号仍在本标签页，需本人重新验证。" });
  };
  pause = this.clear;
  dispose = this.clear;
  private begin(): Lease | null { if (hidden()) { this.clear(); return null; } if (this.controller) return null;
    const lease = { generation: ++this.generation, controller: new AbortController() }; this.controller = lease.controller; return lease; }
  private guard(l: Lease) { if (l.generation === this.generation && hidden()) this.clear();
    if (l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted) throw Error("aborted"); }
  private release(l: Lease) { if (l.generation === this.generation && l.controller === this.controller) this.controller = null; }
  private store(l: Lease) { try { this.guard(l); const s = this.options.storage(); this.guard(l); return s; } catch { throw new StorageFailure("storage_unavailable"); } }
  private get(l: Lease, key: string) { try { const s = this.store(l), raw = s.getItem(key); this.guard(l); if (raw !== null && (typeof raw !== "string" || raw.length > 4096)) throw Error("invalid_storage"); return raw; } catch { throw new StorageFailure("storage_unavailable"); } }
  private load(l: Lease, device: PinScheduleDevice, workerNo: string) {
    const d = freeze({ siteId: attendanceSelfSite(device.siteId), terminalId: attendanceSelfUuid(device.terminalId), label: String(device.label) });
    const context: Context = { device: d, workerNo, newKey: pinSchedulePendingKey(d, workerNo), oldKey: pinClockPendingKey(d, workerNo), newRaw: null, oldRaw: null };
    try { context.newRaw = this.get(l, context.newKey); context.oldRaw = this.get(l, context.oldKey);
      const pending = context.newRaw === null ? null : parsePinSchedulePending(context.newRaw, d, workerNo);
      const legacy = context.oldRaw === null ? null : parsePinClockPending(context.oldRaw, d, workerNo);
      this.guard(l); this.context = context; this.pending = pending; this.legacy = legacy;
    } catch { throw new StorageFailure("invalid_pending"); }
  }
  private verify(l: Lease) { const x = this.context; if (!x || this.get(l, x.newKey) !== x.newRaw || this.get(l, x.oldKey) !== x.oldRaw) throw new StorageFailure("storage_changed"); return x; }
  private settle(l: Lease, kind: "new" | "old") {
    try { const x = this.verify(l), key = kind === "new" ? x.newKey : x.oldKey, s = this.store(l);
      this.guard(l); s.removeItem(key); this.guard(l); if (this.get(l, key) !== null) throw Error("clear_failed");
      if (kind === "new") { x.newRaw = null; this.pending = null; } else { x.oldRaw = null; this.legacy = null; }
    } catch { throw new StorageFailure("pending_not_cleared"); }
  }
  private async request(l: Lease, kind: "new" | "old", pin: string, command: PinClockCommand | null, selection: SelfScheduleSelection | null = null) {
    const x = this.verify(l), pending = kind === "new" ? this.pending : this.legacy;
    const operationId = command ? null : pending?.command.operationId ?? null;
    this.guard(l); const { raw, check } = await transport(this.options.apiFetch, kind === "new" ? endpoint : PIN_CLOCK_API,
      { workerNo: x.workerNo, pin, command, operationId, ...(kind === "new" ? { selection: command ? selection : null } : {}) }, l.controller.signal, this.options.timeoutMs);
    this.guard(l); const expected = command ?? pending?.command;
    if (kind === "new") {
      const r = parsePinScheduleHttpResult(raw, { ...x.device, workerNo: x.workerNo, command, operationId, selection: command ? selection : null,
        ...(expected ? { expectedWorkerId: expected.expectedWorkerId, expectedEmployeeId: expected.expectedEmployeeId } : {}),
        ...(this.pending && !command ? { expectedSelection: this.pending.selection } : {}) }); check(); this.guard(l); return { clock: r.clock, result: r };
    }
    const o = exact(raw, ["ok", "moduleEnabled", "siteId", "terminalId", "workerNo", "workerName", "employeeId", "workerId", "locationId", "state", "receipt", "replayed", "canStart", "canFinish", "blockReason"]);
    if (o.ok !== true || typeof o.moduleEnabled !== "boolean") throw Error("invalid_response");
    const { ok: _ok, moduleEnabled, ...body } = o; void _ok;
    const r = parsePinClockResult(body, { ...x.device, workerNo: x.workerNo, command, operationId });
    if (!moduleEnabled && r.canStart) throw Error("invalid_response"); check(); this.guard(l); return { clock: r, result: null };
  }
  private reconcile(l: Lease, kind: "new" | "old", clock: PinClockResult, result: PinScheduleHttpResult | null) {
    this.verify(l); const p = kind === "new" ? this.pending : this.legacy; if (!p) return;
    const c = p.command;
    if (clock.workerId !== c.expectedWorkerId || clock.employeeId !== c.expectedEmployeeId) throw Error("attendance_worker_changed");
    if (clock.receipt) {
      if (clock.receipt.operationId !== c.operationId || clock.receipt.action !== c.action || clock.receipt.locationId !== c.locationId || clock.receipt.sequence !== c.expectedSequence + 1
        || kind === "new" && (!result?.association || !result.adoption)) throw Error("attendance_operation_conflict");
      this.settle(l, kind);
    } else if (clock.state.sequence > c.expectedSequence) this.settle(l, kind);
    else if (clock.state.sequence < c.expectedSequence) throw Error("attendance_operation_conflict");
  }
  private fail(error: unknown, l: Lease) {
    if (l.generation !== this.generation) return; if (hidden()) { this.clear(); return; } this.forget();
    this.publish({ phase: error instanceof StorageFailure ? "storage_error" : this.pending || this.legacy ? "unconfirmed" : "blocked", result: null, clock: null,
      message: error instanceof StorageFailure ? "待确认存储不可用或已变化，未覆盖原号。请保留标签页并重新核对，不改走旧上班。"
        : `${pinClockMessage(error)} 请重新输入本人 PIN 核对；不会自动重试，原编号和原选择保留。` });
  }
  read = async (workerNo: string, pin: string, device: PinScheduleDevice) => {
    const l = this.begin(); if (!l) return; this.forget(); this.context = null; this.pending = null; this.legacy = null;
    try { workerNo = pinWorkerNo(workerNo.trim()); attendancePin(pin); this.load(l, device, workerNo);
      const kind = this.pending || !this.legacy && this.options.enabled ? "new" : "old";
      if (!this.options.enabled && !this.pending && !this.legacy) throw Error("attendance_not_available");
      this.publish({ phase: "loading", device: this.context!.device, result: null, clock: null, message: "正在验证本人 PIN 并读取排班／原编号，不会产生打卡…" }); this.guard(l);
      const { clock, result } = await this.request(l, kind, pin, null); this.reconcile(l, kind, clock, result); this.guard(l);
      // A recovery read never silently becomes a new clock-in. Dual pending
      // requires another explicit authenticated read; do not issue a second KDF.
      const blocked = !!this.pending && !!this.legacy || kind === "new" && !!this.legacy || kind === "old" && !!this.pending;
      if (!blocked && (kind === "old" || this.options.enabled && (clock.state.status !== "off" || result?.selectionEnabled))) {
        const now = this.options.now(); this.guard(l); if (!Number.isSafeInteger(now)) throw Error("invalid_time");
        this.secret = pin; this.secretUntil = now + this.options.secretMs; this.timer = setTimeout(() => this.clear(), this.options.secretMs);
      }
      this.publish({ phase: this.pending || this.legacy ? "unconfirmed" : "ready", clock, result,
        message: blocked ? "另有原编号尚待核对。请重新输入本人 PIN 分别读取，两号核清前禁止新动作。" : this.pending || this.legacy
          ? "原编号尚未查到，不证明未提交。原选择固定；可明确重试，PIN 过期后须重新验证。"
          : !this.options.enabled ? "已核对原编号；选班入口当前关闭，不会改走旧上班。下次操作需重新验证。"
          : "已验证本人；请在 30 秒内明确选择一个动作。排班候选不是到场证明。" });
    } catch (e) { this.fail(e, l); } finally { pin = ""; this.release(l); }
  };
  private persist(l: Lease, kind: "new" | "old", command: PinClockCommand, selection: SelfScheduleSelection | null) {
    try { const x = this.verify(l); if (this.pending || this.legacy) throw Error("pending_exists");
      const p = { version: 1 as const, siteId: x.device.siteId, terminalId: x.device.terminalId, workerNo: x.workerNo, command };
      const value = kind === "new" ? parsePinSchedulePending(JSON.stringify({ ...p, selection }), x.device, x.workerNo) : parsePinClockPending(JSON.stringify(p), x.device, x.workerNo);
      const raw = JSON.stringify(value), key = kind === "new" ? x.newKey : x.oldKey, s = this.store(l);
      this.guard(l); s.setItem(key, raw); this.guard(l); if (this.get(l, key) !== raw) throw Error("persist_failed");
      if (kind === "new") { x.newRaw = raw; this.pending = value as PinSchedulePending; } else { x.oldRaw = raw; this.legacy = value; }
    } catch { throw new StorageFailure("pending_not_saved"); }
  }
  private async act(action: AttendanceAction | null, selection: SelfScheduleSelection | null) {
    if (!["ready", "unconfirmed"].includes(this.state.phase) || !this.state.clock || !this.secret) return;
    const l = this.begin(); if (!l) return; let pin = "";
    try { this.verify(l); const clock = this.state.clock, result = this.state.result;
      if (this.pending && this.legacy) throw Error("other_pending");
      const existing = this.pending ?? this.legacy, kind = this.pending || !existing && action === "clock_in" ? "new" : "old";
      if (kind === "new" && (!this.options.enabled || !result?.selectionEnabled || !result.moduleEnabled)) throw Error("attendance_not_available");
      const now = this.options.now(); this.guard(l); if (!this.secret || !Number.isSafeInteger(now) || now >= this.secretUntil || now < this.secretUntil - this.options.secretMs) throw Error("pin_expired");
      let command: PinClockCommand;
      if (existing) { if (action !== null) throw Error("attendance_operation_conflict"); command = existing.command; selection = this.pending?.selection ?? null; }
      else {
        const allowed = clock.state.status === "off" ? ["clock_in"] : clock.state.status === "break" ? ["break_end"] : ["break_start", "clock_out"];
        if (!action || !allowed.includes(action) || (["clock_in", "break_start"].includes(action) ? !clock.canStart : !clock.canFinish)) throw Error("action_denied");
        if (action === "clock_in") { selection = selected(selection); if (!result || !clock.locationId) throw Error("choices_unavailable");
          if (selection && !result.choices.entries.some(s => s.id === selection!.slotId && s.revision === selection!.revision)) throw Error("selection_not_listed"); }
        const operationId = attendanceSelfUuid(this.options.randomId()); this.guard(l);
        command = { expectedWorkerId: clock.workerId, expectedEmployeeId: clock.employeeId, operationId, locationId: clock.locationId!, expectedSequence: clock.state.sequence, action };
        this.persist(l, kind, command, selection);
      }
      this.guard(l); pin = this.secret; this.forget();
      this.publish({ phase: "saving", clock: null, result: null, message: "正在重新验证 PIN 并提交明确动作；请等待原号收据…" }); this.guard(l);
      const response = await this.request(l, kind, pin, command, selection); if (!response.clock.receipt) throw Error("receipt_missing");
      this.reconcile(l, kind, response.clock, response.result); this.guard(l);
      this.publish({ phase: "confirmed", clock: response.clock, result: response.result, message: "原号打卡收据已确认；不会自动继续下一动作。" }); this.guard(l);
      this.timer = setTimeout(() => this.clear(), this.options.resultMs);
    } catch (e) { this.fail(e, l); } finally { pin = ""; this.release(l); }
  }
  submit = (selection: SelfScheduleSelection | null) => this.act("clock_in", selection);
  punch = (action: Exclude<AttendanceAction, "clock_in">) => this.act(action, null);
  retry = () => this.act(null, null);
}
