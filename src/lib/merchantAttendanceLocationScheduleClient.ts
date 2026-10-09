import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendancePendingKey, type AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { selfSchedulePendingKey } from "./merchantAttendanceSelfScheduleClient";
import { attendanceLocationClockPendingKey } from "./merchantAttendanceLocationClockClient";
import { acquireAttendancePosition, type AttendanceLocationEnvironment } from "./merchantAttendanceLocationCheckClient";
import { ATTENDANCE_POSITION_FAILURES, parseAttendanceLocationClockIntent, type AttendanceLocationClockIntent,
  type AttendanceLocationClockCommand, type AttendancePositionFailure } from "./merchantAttendanceLocationClock";
import type { AttendancePosition } from "./merchantAttendanceLocation";
import type { SelfScheduleSelection } from "./merchantAttendanceSelfSchedule";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parseLocationScheduleBody, parseLocationScheduleHttpResult, LOCATION_SCHEDULE_ERRORS, LOCATION_SCHEDULE_BYTE_LIMIT,
  type LocationScheduleHttpResult } from "./merchantAttendanceLocationSchedule";

export type LocationScheduleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type LocationSchedulePending = Readonly<{ version: 1; siteId: string; employeeId: string; intent: AttendanceLocationClockIntent; selection: SelfScheduleSelection | null }>;
export type LocationScheduleClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "locating" | "submitting" | "unconfirmed" | "blocked" | "storage_error";
  result: LocationScheduleHttpResult | null; confirmed: LocationScheduleHttpResult | null; pending: LocationSchedulePending | null; message: string }>;
export type LocationScheduleClientOptions = { siteId: string; employeeId: string; workerId: string; canClock: boolean; enabled: boolean;
  apiFetch: AttendanceApiFetch; storage: () => LocationScheduleStorage; environment: AttendanceLocationEnvironment;
  randomId?: () => string; timeoutMs?: number; locationTimeoutMs?: number; canStart?: () => boolean };
type Lease = { generation: number; controller: AbortController };
const endpoint = "/api/merchant-enterprise/attendance/location-schedule";
const hidden = () => typeof document !== "undefined" && document.hidden;
class StorageFailure extends Error {}
class Rejected extends Error {}
const definitive = new Set(["attendance_sequence_conflict", "attendance_location_policy_changed", "attendance_notice_required", "attendance_platform_paused",
  "attendance_location_clock_disabled", "attendance_location_denied", "attendance_not_employed", "attendance_already_clocked_in", "attendance_time_reversed"]);
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function selection(raw: unknown): SelfScheduleSelection | null {
  if (raw === null) return null; const s = captureBrowserExact(raw, ["slotId", "revision"]);
  if (!Number.isSafeInteger(s.revision) || Number(s.revision) < 1 || Number(s.revision) > 9007199254740990 || Object.is(s.revision, -0)) throw Error("invalid_selection");
  return { slotId: attendanceSelfUuid(s.slotId), revision: s.revision as number };
}
export function locationSchedulePendingKey(siteId: string, employeeId: string) {
  if (siteId.length !== 8) throw Error("attendance_invalid_request");
  return `faolla:attendance:location-schedule:v1:${attendanceSelfSite(siteId)}:${attendanceSelfUuid(employeeId)}`;
}
export function parseLocationSchedulePending(raw: string, siteId: string, employeeId: string): LocationSchedulePending {
  if (new TextEncoder().encode(raw).byteLength > 4096) throw new StorageFailure("invalid_pending");
  const p = captureBrowserExact(parseCaptureBrowserJson(raw), ["version", "siteId", "employeeId", "intent", "selection"]);
  if (p.version !== 1 || p.siteId !== siteId || p.employeeId !== employeeId) throw new StorageFailure("pending_identity");
  const intent = parseAttendanceLocationClockIntent(p.intent, siteId);
  if (intent.action !== "clock_in" || intent.safeFinish) throw new StorageFailure("invalid_pending");
  return freeze({ version: 1, siteId, employeeId, intent, selection: selection(p.selection) });
}
async function transport(apiFetch: AttendanceApiFetch, url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number,
  decode: (raw: unknown) => LocationScheduleHttpResult) {
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
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try { while (true) { const { done, value } = await reader.read(); check(); if (done) break;
      bytes += value.byteLength; if (bytes > (response.status === 200 ? LOCATION_SCHEDULE_BYTE_LIMIT : 4096)) throw Error("oversized_response"); text += decoder.decode(value, { stream: true }); }
      text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    check(); const raw = parseCaptureBrowserJson(text); check();
    if (response.status !== 200) {
      const e = captureBrowserExact(raw, ["ok", "error"]);
      if (e.ok === false && typeof e.error === "string" && Object.hasOwn(LOCATION_SCHEDULE_ERRORS, e.error) && LOCATION_SCHEDULE_ERRORS[e.error] === response.status)
        throw new Rejected(e.error);
      throw Error("invalid_error_response");
    }
    const result = decode(raw); check(); return result;
  };
  try { return await Promise.race([run(), deadline]); } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

/** New clock-in only. Original location actions/pending keep their original
 * endpoint; this class never stores coordinates or falls back to that endpoint. */
export class AttendanceLocationScheduleClient {
  readonly storageKey: string;
  private readonly options: Readonly<Required<LocationScheduleClientOptions>>;
  private state: LocationScheduleClientState = freeze({ phase: "loading", result: null, confirmed: null, pending: null, message: "正在检查定位选班恢复编号…" });
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private loaded = false;
  private raw: string | null = null;
  private pending: LocationSchedulePending | null = null;
  constructor(input: LocationScheduleClientOptions) {
    const c = { ...input }, timeoutMs = c.timeoutMs ?? 12000, locationTimeoutMs = c.locationTimeoutMs ?? 15000;
    if (typeof c.canClock !== "boolean" || typeof c.enabled !== "boolean" || typeof c.apiFetch !== "function" || typeof c.storage !== "function"
      || c.randomId !== undefined && typeof c.randomId !== "function" || c.canStart !== undefined && typeof c.canStart !== "function"
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000 || !Number.isInteger(locationTimeoutMs) || locationTimeoutMs < 1 || locationTimeoutMs > 15000
      || !c.environment || [c.environment.isSecureContext, c.environment.isVisible, c.environment.geolocation].some(f => typeof f !== "function")) throw Error("invalid_options");
    this.storageKey = locationSchedulePendingKey(c.siteId, c.employeeId);
    this.options = Object.freeze({ ...c, siteId: attendanceSelfSite(c.siteId), employeeId: attendanceSelfUuid(c.employeeId), workerId: attendanceSelfUuid(c.workerId),
      environment: Object.freeze({ ...c.environment }), timeoutMs, locationTimeoutMs, randomId: c.randomId ?? (() => crypto.randomUUID()), canStart: c.canStart ?? (() => true) });
  }
  getSnapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private publish(update: Partial<LocationScheduleClientState>) {
    const snapshot = this.state = freeze({ ...this.state, ...update, pending: this.pending });
    for (const f of [...this.listeners]) { if (snapshot !== this.state) break; try { f(); } catch { /* An observer does not authorize a request. */ } }
  }
  pause = () => {
    const generation = ++this.generation, previous = this.controller; this.controller = null; previous?.abort();
    if (generation === this.generation) this.publish({ result: null, confirmed: null, phase: this.state.phase === "storage_error" ? "storage_error" : this.pending ? "unconfirmed" : "idle",
      message: "定位选班资料已隐藏；已发送操作不撤销，原编号和选择保留。返回后明确核对，不自动定位或提交。" });
  };
  private begin(): Lease | null {
    if (hidden() || !this.options.environment.isVisible()) { this.pause(); return null; } if (this.controller) return null;
    const lease = { generation: ++this.generation, controller: new AbortController() }; this.controller = lease.controller; return lease;
  }
  private guard(lease: Lease) {
    if (lease.generation === this.generation && (hidden() || !this.options.environment.isVisible())) this.pause();
    if (lease.generation !== this.generation || this.controller !== lease.controller || lease.controller.signal.aborted) throw Error("aborted");
  }
  private release(lease: Lease) { if (lease.generation === this.generation && this.controller === lease.controller) this.controller = null; }
  private stored(lease: Lease) {
    try { this.guard(lease); const storage = this.options.storage(); this.guard(lease); const raw = storage.getItem(this.storageKey); this.guard(lease);
      if (raw !== null && typeof raw !== "string") throw Error("invalid_storage"); return { storage, raw };
    } catch { throw new StorageFailure("storage_unavailable"); }
  }
  private load(lease: Lease) {
    const { raw } = this.stored(lease); if (this.loaded) { if (this.raw !== raw) throw new StorageFailure("storage_changed"); return; }
    try { const pending = raw === null ? null : parseLocationSchedulePending(raw, this.options.siteId, this.options.employeeId); this.guard(lease);
      this.pending = pending; this.raw = raw; this.loaded = true;
    } catch { throw new StorageFailure("invalid_pending"); }
  }
  private verify(lease: Lease) { const s = this.stored(lease); if (s.raw !== this.raw) throw new StorageFailure("storage_changed"); return s.storage; }
  private allowPost(lease: Lease) {
    const storage = this.verify(lease), { siteId, employeeId } = this.options;
    for (const key of [attendancePendingKey(siteId, employeeId), selfSchedulePendingKey(siteId, employeeId), attendanceLocationClockPendingKey(siteId, employeeId),
      `faolla:attendance:self-schedule-adoption:v1:${siteId}:${employeeId}`,
      `faolla:attendance:notice:v1:${siteId}:self:${employeeId}`]) { this.guard(lease); const value = storage.getItem(key); this.guard(lease); if (value !== null) throw Error("other_channel_pending"); }
    const allowed = this.options.canStart(); this.guard(lease);
    if (!allowed || !this.options.enabled || !this.options.canClock || !this.options.environment.isSecureContext()) throw Error("start_not_allowed"); this.guard(lease);
  }
  blocksOtherActions = () => {
    const generation = this.generation;
    try { if (hidden() || !this.options.environment.isVisible() || !this.loaded || this.pending || this.controller || this.state.phase === "storage_error") return true;
      const raw = this.options.storage().getItem(this.storageKey); return generation !== this.generation || hidden() || raw !== null;
    } catch { return true; }
  };
  private settle(lease: Lease) {
    try { const storage = this.verify(lease); this.guard(lease); storage.removeItem(this.storageKey); this.guard(lease);
      if (this.stored(lease).raw !== null) throw Error("not_cleared"); this.raw = null; this.pending = null;
    } catch { throw new StorageFailure("pending_not_cleared"); }
  }
  private failed(error: unknown, lease: Lease) {
    if (lease.generation !== this.generation) return; if (hidden() || !this.options.environment.isVisible()) { this.pause(); return; }
    const code = error instanceof Error ? error.message : "";
    this.publish({ result: null, confirmed: null, phase: error instanceof StorageFailure ? "storage_error" : this.pending ? "unconfirmed" : "blocked",
      message: error instanceof StorageFailure ? "恢复存储不可用或已变化；未覆盖原号。请保留此标签页并核对，不另起打卡。"
        : this.pending ? "结果仍待确认，原编号与原选择保留。请先只读核对，不换排班或改走旧上班接口。"
          : ["location_denied", "location_timeout", "location_unsupported", "location_unavailable", "location_device_pending"].includes(code)
            ? "未取得可用位置，尚未提交。请重新核对后重试定位，或明确选择无定位登记并等待核查。"
            : "身份、状态、告知或候选已变化，尚未可靠确认本次操作；请重新核对，不自动定位或提交。" });
  }
  initialize = async () => {
    const lease = this.begin(); if (!lease) return;
    try { this.load(lease); this.guard(lease); this.publish({ result: null, confirmed: null, phase: this.pending ? "unconfirmed" : "idle",
      message: this.pending ? "发现原定位选班编号，请明确只读核对；不会自动重发或改变原选择。" : "先明确读取本人排班，再选择一个计划或不关联；读取不会请求位置。" });
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  private fetch(lease: Lease, command: AttendanceLocationClockCommand | null, selected: SelfScheduleSelection | null = null, requestedOperationId: string | null = null) {
    const operationId = command ? null : this.pending?.intent.operationId ?? requestedOperationId;
    const expectedWorkerId = this.pending?.intent.expectedWorkerId ?? this.options.workerId;
    const query = new URLSearchParams({ siteId: this.options.siteId, expectedWorkerId }); if (operationId) query.set("operationId", operationId);
    this.guard(lease);
    return transport(this.options.apiFetch, command ? endpoint : `${endpoint}?${query}`, command ? {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: this.options.siteId, command, selection: selected }),
    } : { method: "GET", headers: { Accept: "application/json" } }, lease.controller.signal, this.options.timeoutMs,
    raw => parseLocationScheduleHttpResult(raw, { siteId: this.options.siteId, expectedWorkerId, employeeId: this.options.employeeId, operationId, command,
      ...(command || this.pending ? { selection: command ? selected : this.pending!.selection } : {}) }));
  }
  private accept(result: LocationScheduleHttpResult, lease: Lease) {
    this.guard(lease); this.verify(lease); const c = result.clock, p = this.pending;
    if (c.workerId !== (p?.intent.expectedWorkerId ?? this.options.workerId) || c.employeeId !== this.options.employeeId) throw Error("identity_changed");
    if (p) {
      if (c.receipt) {
        if (c.receipt.action !== "clock_in" || c.receipt.operationId !== p.intent.operationId || c.receipt.locationId !== p.intent.locationId || c.receipt.sequence !== p.intent.expectedSequence + 1
          || !c.receiptGate || Object.entries(c.receiptGate.command).some(([key, value]) => p.intent[key as keyof AttendanceLocationClockIntent] !== value)
          || result.association && JSON.stringify(result.association.selection) !== JSON.stringify(p.selection)) throw Error("receipt_mismatch");
        this.settle(lease);
      } else if (c.state.sequence > p.intent.expectedSequence || c.locationId === p.intent.locationId && c.noticeGate.revision !== null && c.noticeGate.revision > p.intent.noticeRevision!) this.settle(lease);
      else if (c.state.sequence < p.intent.expectedSequence) throw Error("sequence_mismatch");
    }
    this.guard(lease); this.publish({ result, confirmed: c.receipt ? result : null, phase: this.pending ? "unconfirmed" : "ready", message: this.pending
      ? "未查到原号收据，这不证明未提交。保留原选择，可继续只读核对，或明确原号重试。"
      : c.receipt ? "定位上班收据已核验；排班关联与核准引用分别显示，不代表出勤正常或工资结论。" : "已核对本人状态与排班；没有自动选班或请求位置。" });
  }
  refresh = async (requestedOperationId?: string) => {
    const lease = this.begin(); if (!lease) return;
    try { this.load(lease); const op = requestedOperationId === undefined ? null : attendanceSelfUuid(requestedOperationId);
      if (this.pending && op !== null && op !== this.pending.intent.operationId) throw Error("pending_mismatch");
      if (!this.options.enabled && !this.pending && op === null) return;
      this.publish({ phase: "loading", result: null, confirmed: null, message: "正在只读核对本人定位排班与原号…" }); this.guard(lease);
      const result = await this.fetch(lease, null, null, op); this.guard(lease); this.accept(result, lease);
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  submit = async (selected: SelfScheduleSelection | null, failure: AttendancePositionFailure | null = null) => {
    if (this.pending || this.state.phase !== "ready" || !this.state.result) return;
    await this.send(selected, failure, false);
  };
  retry = async (failure: AttendancePositionFailure | null = null) => {
    if (!this.pending || !this.options.enabled || !this.options.canClock) return;
    await this.send(this.pending.selection, failure, true);
  };
  private async send(rawSelection: SelfScheduleSelection | null, failure: AttendancePositionFailure | null, retry: boolean) {
    const previous = this.state.result, lease = this.begin(); if (!lease) return;
    let posted = false;
    try {
      this.load(lease); this.allowPost(lease); const chosen = selection(rawSelection), originalPending = this.pending;
      if (failure !== null && !ATTENDANCE_POSITION_FAILURES.includes(failure)) throw Error("invalid_failure");
      if (retry ? !originalPending : !!originalPending || !previous) throw Error("invalid_pending");
      if (!retry && chosen && !previous!.choices.entries.some(s => s.id === chosen.slotId && s.revision === chosen.revision)) throw Error("selection_not_listed");
      this.publish({ phase: "loading", result: null, confirmed: null, message: "提交前核对权限、告知、原号和原选择…" }); this.guard(lease); this.allowPost(lease);
      const current = await this.fetch(lease, null); this.guard(lease); this.accept(current, lease); this.guard(lease);
      if (retry && this.pending !== originalPending) return;
      const c = current.clock, policy = c.policy;
      if (!current.moduleEnabled || !current.selectionEnabled || !c.channelEnabled || !c.noticeGate.ready || !policy || !c.locationId || c.state.status !== "off") throw Error("start_not_allowed");
      if (retry) {
        if (c.locationId !== originalPending!.intent.locationId || c.state.sequence !== originalPending!.intent.expectedSequence || c.noticeGate.revision !== originalPending!.intent.noticeRevision
          || ["settingsVersion", "workerVersion", "locationVersion"].some(k => policy[k as keyof typeof policy] !== originalPending!.intent[k as keyof AttendanceLocationClockIntent])) throw Error("context_changed");
      } else {
        const earlier = previous!.clock;
        if (c.workerId !== earlier.workerId || c.employeeId !== earlier.employeeId || c.locationId !== earlier.locationId || c.state.sequence !== earlier.state.sequence
          || c.noticeGate.revision !== earlier.noticeGate.revision || ["settingsVersion", "workerVersion", "locationVersion"].some(k => policy[k as keyof typeof policy] !== earlier.policy?.[k as keyof typeof policy])
          || chosen && !current.choices.entries.some(s => s.id === chosen.slotId && s.revision === chosen.revision)) throw Error("context_changed");
      }
      this.allowPost(lease);
      let position: AttendancePosition | null = null;
      if (failure === null) {
        const geo = this.options.environment.geolocation(); this.guard(lease); if (!geo) throw Error("location_unsupported");
        this.publish({ phase: "locating", result: null, confirmed: null, message: "正在请求一次位置；拒绝或取消不会自动改成无定位打卡。" }); this.guard(lease); this.allowPost(lease);
        position = await acquireAttendancePosition(geo, lease.controller.signal, this.options.locationTimeoutMs); this.guard(lease);
      }
      this.allowPost(lease);
      if (!retry) {
        const intent = parseAttendanceLocationClockIntent({ action: "clock_in", operationId: attendanceSelfUuid(this.options.randomId()), expectedWorkerId: c.workerId,
          locationId: c.locationId, expectedSequence: c.state.sequence, settingsVersion: policy.settingsVersion, workerVersion: policy.workerVersion, locationVersion: policy.locationVersion,
          noticeRevision: c.noticeGate.revision, safeFinish: false }, this.options.siteId); this.guard(lease);
        const storage = this.verify(lease); this.guard(lease);
        this.pending = freeze({ version: 1, siteId: this.options.siteId, employeeId: this.options.employeeId, intent, selection: chosen }); this.raw = JSON.stringify(this.pending);
        try { storage.setItem(this.storageKey, this.raw); this.guard(lease); this.verify(lease); } catch { throw new StorageFailure("pending_not_saved"); }
      }
      const p = this.pending; if (!p) throw Error("pending_missing");
      const command = { ...p.intent, position, positionFailure: failure };
      parseLocationScheduleBody({ siteId: this.options.siteId, command, selection: p.selection }); this.guard(lease);
      this.publish({ phase: "submitting", result: null, confirmed: null, message: "正在提交原编号、原选择及本次定位；等待服务器原子收据。" }); this.guard(lease); this.allowPost(lease);
      posted = true; const result = await this.fetch(lease, command, p.selection); this.guard(lease); this.accept(result, lease);
    } catch (error) {
      if (lease.generation !== this.generation) return;
      if (posted && !retry && error instanceof Rejected && definitive.has(error.message)) {
        try { this.guard(lease); this.settle(lease); } catch (failure) { this.failed(failure, lease); return; }
      }
      this.failed(error, lease);
    } finally { this.release(lease); }
  }
}
