import { attendanceSelfSite, attendanceSelfUuid, type AttendanceSelfCommand } from "./merchantAttendanceSelf";
import { attendanceMessage, attendancePendingKey, type AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parseSelfScheduleAdoptionBody, parseSelfScheduleAdoptionHttpResult, SELF_SCHEDULE_ADOPTION_ERRORS,
  type SelfScheduleAdoptionHttpResult } from "./merchantAttendanceSelfScheduleAdoption";
import type { SelfScheduleSelection } from "./merchantAttendanceSelfSchedule";
import { selfSchedulePendingKey } from "./merchantAttendanceSelfScheduleClient";

export type SelfScheduleAdoptionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SelfScheduleAdoptionPending = { version: 1; siteId: string; employeeId: string; command: AttendanceSelfCommand; selection: SelfScheduleSelection | null };
export type SelfScheduleAdoptionClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "submitting" | "unconfirmed" | "blocked" | "storage_error";
  result: SelfScheduleAdoptionHttpResult | null; pending: SelfScheduleAdoptionPending | null; message: string }>;
export type SelfScheduleAdoptionClientOptions = { siteId: string; employeeId: string; canClock: boolean; enabled: boolean; apiFetch: AttendanceApiFetch;
  storage: () => SelfScheduleAdoptionStorage; randomId?: () => string; timeoutMs?: number; canStart?: () => boolean };
type Lease = { generation: number; controller: AbortController };
const endpoint = "/api/merchant-enterprise/attendance/self-schedule-adoption";
const hidden = () => typeof document !== "undefined" && document.hidden;
class StorageFailure extends Error {}
class Rejected extends Error {}
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function selfScheduleAdoptionPendingKey(siteId: string, employeeId: string) {
  if (siteId.length !== 8) throw Error("attendance_invalid_request");
  return `faolla:attendance:self-schedule-adoption:v1:${attendanceSelfSite(siteId)}:${attendanceSelfUuid(employeeId)}`;
}
export function parseSelfScheduleAdoptionPending(raw: string, siteId: string, employeeId: string): SelfScheduleAdoptionPending {
  if (new TextEncoder().encode(raw).byteLength > 4096) throw new StorageFailure("pending_too_large");
  const value = captureBrowserExact(parseCaptureBrowserJson(raw), ["version", "siteId", "employeeId", "command", "selection"]);
  if (value.version !== 1 || value.siteId !== siteId || value.employeeId !== employeeId) throw new StorageFailure("pending_identity_changed");
  const body = parseSelfScheduleAdoptionBody({ siteId, command: value.command, selection: value.selection });
  return freeze({ version: 1, siteId, employeeId, command: body.command, selection: body.selection });
}

// A single deadline covers headers, streamed fatal UTF-8, strict JSON and the
// protocol parser. No old endpoint fallback, redirect, polling or auto-POST.
async function request(apiFetch: AttendanceApiFetch, url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number,
  decode: (raw: unknown) => SelfScheduleAdoptionHttpResult) {
  const controller = new AbortController(), until = performance.now() + timeoutMs;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (e: Error) => void = () => {};
  const cancel = (code: string) => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error(code)); };
  const abort = () => cancel("aborted"), deadline = new Promise<never>((_, reject) => { rejectCancel = reject; });
  const timer = setTimeout(() => cancel("timeout"), timeoutMs); signal.addEventListener("abort", abort, { once: true });
  const check = () => { if (signal.aborted || controller.signal.aborted) throw Error("aborted"); if (performance.now() >= until) throw Error("timeout"); };
  const run = async () => {
    check(); const response = await apiFetch(url, { ...init, cache: "no-store", redirect: "error", signal: controller.signal });
    if (signal.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
    }
    check(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const utf8 = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try {
      while (true) { const { done, value } = await reader.read(); check(); if (done) break;
        bytes += value.byteLength; if (bytes > (response.status === 200 ? 65536 : 4096)) throw Error("oversized_response");
        text += utf8.decode(value, { stream: true }); }
      text += utf8.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    const raw = parseCaptureBrowserJson(text); check();
    if (response.status !== 200) {
      const error = captureBrowserExact(raw, ["ok", "error"]);
      if (error.ok === false && typeof error.error === "string" && Object.hasOwn(SELF_SCHEDULE_ADOPTION_ERRORS, error.error)
        && SELF_SCHEDULE_ADOPTION_ERRORS[error.error] === response.status && response.status < 500) throw new Rejected(error.error);
      throw Error("invalid_error_response");
    }
    const result = decode(raw); check(); return result;
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

/** Additive171 intent only. Old137 pending stays with its original client and
 * endpoint; a new saved receipt requires actual association AND adoption. */
export class AttendanceSelfScheduleAdoptionClient {
  private readonly options: Readonly<Required<SelfScheduleAdoptionClientOptions>>;
  readonly storageKey: string;
  private state: SelfScheduleAdoptionClientState = freeze({ phase: "loading", result: null, pending: null, message: "正在检查核准选班上班的恢复编号…" });
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private loaded = false;
  private raw: string | null = null;
  private pending: SelfScheduleAdoptionPending | null = null;
  constructor(input: SelfScheduleAdoptionClientOptions) {
    const c = { ...input }, timeoutMs = c.timeoutMs ?? 12000;
    if (typeof c.enabled !== "boolean" || typeof c.canClock !== "boolean" || typeof c.apiFetch !== "function" || typeof c.storage !== "function"
      || c.randomId !== undefined && typeof c.randomId !== "function" || c.canStart !== undefined && typeof c.canStart !== "function"
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000) throw Error("invalid_options");
    this.storageKey = selfScheduleAdoptionPendingKey(c.siteId, c.employeeId);
    this.options = Object.freeze({ ...c, siteId: attendanceSelfSite(c.siteId), employeeId: attendanceSelfUuid(c.employeeId), timeoutMs,
      randomId: c.randomId ?? (() => crypto.randomUUID()), canStart: c.canStart ?? (() => true) });
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(update: Partial<SelfScheduleAdoptionClientState>) {
    const snapshot = this.state = freeze({ ...this.state, ...update, pending: this.pending });
    for (const fn of [...this.listeners]) { if (snapshot !== this.state) break; try { fn(); } catch { /* Observers cannot authorize a request. */ } }
  }
  pause = () => {
    const generation = ++this.generation, previous = this.controller; this.controller = null; previous?.abort();
    if (generation === this.generation) this.publish({ result: null, phase: this.state.phase === "storage_error" ? "storage_error" : this.pending ? "unconfirmed" : "idle",
      message: "核准选班资料已隐藏；原编号保留，返回后只读核对，不自动重发。" });
  };
  private begin(): Lease | null {
    if (hidden()) { this.pause(); return null; } if (this.controller) return null;
    const lease = { generation: ++this.generation, controller: new AbortController() }; this.controller = lease.controller; return lease;
  }
  private guard(lease: Lease) {
    if (lease.generation === this.generation && hidden()) this.pause();
    if (lease.generation !== this.generation || this.controller !== lease.controller || lease.controller.signal.aborted) throw Error("aborted");
  }
  private release(lease: Lease) { if (lease.generation === this.generation && this.controller === lease.controller) this.controller = null; }
  private stored(lease: Lease) {
    try { this.guard(lease); const storage = this.options.storage(); this.guard(lease); const raw = storage.getItem(this.storageKey); this.guard(lease);
      if (raw !== null && typeof raw !== "string") throw Error("invalid_storage"); return { storage, raw };
    } catch { throw new StorageFailure("storage_unavailable"); }
  }
  private load(lease: Lease) {
    const { raw } = this.stored(lease);
    if (this.loaded) { if (raw !== this.raw) throw new StorageFailure("storage_changed"); return; }
    try { const pending = raw === null ? null : parseSelfScheduleAdoptionPending(raw, this.options.siteId, this.options.employeeId); this.guard(lease);
      this.raw = raw; this.pending = pending; this.loaded = true;
    } catch { throw new StorageFailure("invalid_pending"); }
  }
  private verify(lease: Lease) { const stored = this.stored(lease); if (stored.raw !== this.raw) throw new StorageFailure("storage_changed"); return stored.storage; }
  private allowPost(lease: Lease) {
    const storage = this.verify(lease); this.guard(lease);
    const { siteId, employeeId } = this.options;
    for (const key of [attendancePendingKey(siteId, employeeId), selfSchedulePendingKey(siteId, employeeId),
      `faolla:attendance:location-clock:v1:${siteId}:${employeeId}`, `faolla:attendance:location-schedule:v1:${siteId}:${employeeId}`,
      `faolla:attendance:notice:v1:${siteId}:self:${employeeId}`]) {
      const raw = storage.getItem(key); this.guard(lease); if (raw !== null) throw Error("other_channel_pending");
    }
    const allowed = this.options.canStart(); this.guard(lease);
    if (!allowed || !this.options.enabled || !this.options.canClock) throw Error("other_channel_pending");
  }
  private settle(lease: Lease) {
    const storage = this.verify(lease); this.guard(lease);
    try { storage.removeItem(this.storageKey); this.guard(lease); if (this.stored(lease).raw !== null) throw Error("storage_changed");
      this.raw = null; this.pending = null;
    } catch { throw new StorageFailure("pending_not_cleared"); }
  }
  private failed(error: unknown, lease: Lease) {
    if (lease.generation !== this.generation) return; if (hidden()) { this.pause(); return; }
    this.publish({ result: null, phase: error instanceof StorageFailure ? "storage_error" : this.pending ? "unconfirmed" : "blocked",
      message: error instanceof StorageFailure ? "选班恢复存储不可用或已被改变；暂不发送任何新打卡，请保留原编号核对。"
        : error instanceof Rejected ? attendanceMessage(error.message) + (this.pending ? " 原选班编号仍保留，请只读核对。" : "")
          : "未能可靠核对核准选班上班结果；请重新核对，不能把失败当作未打卡或转用旧入口重发。" });
  }
  initialize = async () => {
    const lease = this.begin(); if (!lease) return;
    try { this.load(lease); this.guard(lease); this.publish({ result: null, phase: this.pending ? "unconfirmed" : "idle",
      message: this.pending ? "发现待确认核准选班上班编号；先只读核对，不自动提交。" : "请选择本次排班，或明确选择不关联排班。" });
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  // Synchronous, fail-closed interlock for the old panel's other actions. It
  // also notices another mounted controller/storage change before that action.
  blocksOtherActions = () => {
    const generation = this.generation;
    try { if (hidden() || !this.loaded || this.pending || this.controller || this.state.phase === "storage_error") return true;
      const raw = this.options.storage().getItem(this.storageKey);
      return generation !== this.generation || hidden() || raw !== null;
    } catch { return true; }
  };
  private async fetch(lease: Lease, command: AttendanceSelfCommand | null, selection: SelfScheduleSelection | null = null, recoveryOperationId: string | null = null) {
    const operationId = command ? null : this.pending?.command.operationId ?? recoveryOperationId;
    const query = new URLSearchParams({ siteId: this.options.siteId }); if (operationId) query.set("operationId", operationId);
    this.guard(lease);
    return request(this.options.apiFetch, command ? endpoint : `${endpoint}?${query}`, command ? {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: this.options.siteId, command, selection }),
    } : { method: "GET", headers: { Accept: "application/json" } }, lease.controller.signal, this.options.timeoutMs,
    raw => parseSelfScheduleAdoptionHttpResult(raw, { siteId: this.options.siteId, expectedEmployeeId: this.options.employeeId, command, operationId,
      ...(command || this.pending ? { selection: command ? selection : this.pending!.selection } : {}) }));
  }
  private accept(result: SelfScheduleAdoptionHttpResult, lease: Lease) {
    this.guard(lease); this.verify(lease);
    const pending = this.pending;
    if (pending) {
      if (result.clock.workerId !== pending.command.expectedWorkerId) throw Error("worker_changed");
      if (result.clock.receipt) {
        const receipt = result.clock.receipt;
        if (receipt.action !== "clock_in" || receipt.locationId !== pending.command.locationId || receipt.operationId !== pending.command.operationId
          || receipt.sequence !== pending.command.expectedSequence + 1) throw Error("receipt_mismatch");
        if (!result.association || !result.adoption || result.adoption.employeeId !== this.options.employeeId
          || JSON.stringify(result.association.selection) !== JSON.stringify(pending.selection)) throw Error("selection_or_adoption_mismatch");
        this.settle(lease);
      } else if (result.clock.state.sequence > pending.command.expectedSequence) this.settle(lease);
      else if (result.clock.state.sequence < pending.command.expectedSequence) throw Error("sequence_mismatch");
    }
    this.guard(lease); this.publish({ result, phase: this.pending ? "unconfirmed" : "ready", message: this.pending
      ? "暂未查到原号收据；这不证明未提交。保留原选择，只能核对或明确原号重试。"
      : result.clock.receipt ? "上班记录已核对；关联结果不代表出勤正常、迟到早退或工资结论。" : "已核对当前状态；没有自动选择或提交排班。" });
  }
  refresh = async (requestedOperationId?: string) => {
    const lease = this.begin(); if (!lease) return;
    try { this.load(lease);
      const operationId = requestedOperationId === undefined ? null : attendanceSelfUuid(requestedOperationId);
      if (this.pending && operationId !== null && operationId !== this.pending.command.operationId) throw Error("pending_operation_mismatch");
      if (!this.options.enabled && !this.pending && operationId === null) return;
      this.publish({ phase: "loading", result: null, message: "正在核对本人排班与原上班编号…" }); this.guard(lease);
      const result = await this.fetch(lease, null, null, operationId); this.guard(lease);
      if (operationId && result.clock.receipt && result.clock.receipt.action !== "clock_in") throw Error("not_clock_in");
      this.accept(result, lease);
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  submit = async (selection: SelfScheduleSelection | null) => {
    if (this.state.phase !== "ready" || this.pending || !this.state.result?.moduleEnabled || !this.state.result.selectionEnabled) return;
    const result = this.state.result, lease = this.begin(); if (!lease) return;
    try {
      this.load(lease); this.allowPost(lease);
      if (result.clock.state.status !== "off" || !result.clock.locationId || this.pending) return;
      const operationId = attendanceSelfUuid(this.options.randomId()); this.guard(lease);
      const body = parseSelfScheduleAdoptionBody({ siteId: this.options.siteId, selection, command: { action: "clock_in", operationId,
        expectedWorkerId: result.clock.workerId, locationId: result.clock.locationId, expectedSequence: result.clock.state.sequence } });
      if (body.selection && !result.choices.entries.some(slot => slot.id === body.selection!.slotId && slot.revision === body.selection!.revision)) throw Error("selection_not_listed");
      const pending: SelfScheduleAdoptionPending = freeze({ version: 1, siteId: this.options.siteId, employeeId: this.options.employeeId, command: body.command, selection: body.selection });
      const storage = this.verify(lease), raw = JSON.stringify(pending); this.guard(lease);
      this.pending = pending; this.raw = raw;
      try { storage.setItem(this.storageKey, raw); this.guard(lease); this.verify(lease); } catch { throw new StorageFailure("pending_not_saved"); }
      this.publish({ phase: "submitting", result: null, message: "正在提交本次明确选择；请勿另起打卡。" }); this.guard(lease); this.allowPost(lease);
      await this.post(lease);
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  private async post(lease: Lease) {
    const pending = this.pending; if (!pending) return;
    // A business refusal is not an alternate endpoint instruction. Keep the
    // exact operation after every unsuccessful POST; only authenticated receipt
    // or a later authoritative sequence can settle this new intent.
    const result = await this.fetch(lease, pending.command, pending.selection);
    this.guard(lease); this.accept(result, lease);
  }
  retry = async () => {
    if (!this.pending || !this.options.enabled || !this.options.canClock) return;
    const lease = this.begin(); if (!lease) return;
    try {
      this.load(lease); this.allowPost(lease); const pending = this.pending;
      this.publish({ phase: "loading", result: null, message: "先只读核对原编号，未确认前不重发…" }); this.guard(lease);
      const result = await this.fetch(lease, null); this.guard(lease); this.accept(result, lease); this.guard(lease);
      if (this.pending !== pending || !this.pending || !result.moduleEnabled || !result.selectionEnabled || result.clock.state.sequence !== pending.command.expectedSequence) return;
      this.allowPost(lease); this.publish({ phase: "submitting", result: null, message: "正在使用原编号和原选择明确重试…" }); this.guard(lease); this.allowPost(lease);
      await this.post(lease);
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
}
