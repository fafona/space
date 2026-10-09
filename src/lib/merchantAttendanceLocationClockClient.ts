import type { AttendanceAction } from "./merchantAttendance";
import type { AttendancePosition } from "./merchantAttendanceLocation";
import { acquireAttendancePosition, type AttendanceLocationEnvironment } from "./merchantAttendanceLocationCheckClient";
import { attendanceActionAllowed } from "./merchantAttendanceEntitlement";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { ATTENDANCE_LOCATION_CLOCK_ERRORS, ATTENDANCE_POSITION_FAILURES, parseAttendanceLocationClockIntent,
  parseAttendanceLocationClockResult, type AttendanceLocationClockIntent, type AttendanceLocationClockCommand,
  type AttendanceLocationClockResult, type AttendancePositionFailure } from "./merchantAttendanceLocationClock";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Pending = { version: 1; siteId: string; employeeId: string; intent: AttendanceLocationClockIntent };
type Result = AttendanceLocationClockResult & { moduleEnabled: boolean };
type State = { phase: "idle" | "loading" | "ready" | "locating" | "submitting" | "unconfirmed" | "blocked";
  pending: Pending | null; result: Result | null; confirmed: Result | null; message: string };
const endpoint = "/api/merchant-enterprise/attendance/location-clock";
const identityRejected = (error: unknown) => error instanceof AttendanceManagementRejected &&
  ["attendance_access_denied", "attendance_worker_changed"].includes(error.message);
export function attendanceLocationClockPendingKey(siteId: string, employeeId: string) {
  return `faolla:attendance:location-clock:v1:${attendanceSelfSite(siteId)}:${attendanceSelfUuid(employeeId)}`;
}
export function parseAttendanceLocationClockPending(raw: string, siteId: string, employeeId: string): Pending {
  if (raw.length > 2048) throw Error("pending_invalid");
  const p = JSON.parse(raw) as Pending;
  if (!p || p.version !== 1 || p.siteId !== siteId || p.employeeId !== employeeId || Object.keys(p).sort().join() !== "employeeId,intent,siteId,version") throw Error("pending_invalid");
  return { version: 1, siteId, employeeId, intent: parseAttendanceLocationClockIntent(p.intent, siteId) };
}
/** Not yet mounted in production. Intent-only durable recovery; raw coordinates
 * never enter controller snapshots or storage. No automatic POST or GPS retry. */
export class AttendanceLocationClockClient {
  private state: State = { phase: "idle", pending: null, result: null, confirmed: null, message: "读取状态后才可操作。" };
  private generation = 0;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  readonly storageKey: string;
  constructor(private readonly options: {
    siteId: string; employeeId: string; workerId: string; canClock: boolean; apiFetch: AttendanceApiFetch;
    storage: () => StorageLike; environment: AttendanceLocationEnvironment; randomId?: () => string; timeoutMs?: number; locationTimeoutMs?: number;
  }) {
    this.storageKey = attendanceLocationClockPendingKey(options.siteId, options.employeeId); attendanceSelfUuid(options.workerId);
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const fn of this.listeners) fn(); }
  pause = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: this.state.pending ? "unconfirmed" : "idle", result: null, confirmed: null,
      message: this.state.pending ? "提交可能已到达服务器。已保留操作编号，请重新核对，取消不会撤销已提交打卡。" : "操作已停止，未发起新打卡。" });
  };
  private storageFailure() {
    this.set({ phase: "blocked", result: null, confirmed: null, message: "不能安全读取或保存原操作编号。请恢复会话存储后核对；暂不发起打卡。" });
  }
  private identityFailure() {
    this.set({ phase: "blocked", result: null, confirmed: null,
      message: "当前身份或记录归属无法确认，已停止打卡。如有待确认编号，请保留并联系负责人核验；不要换编号重复提交。" });
  }
  private stored() {
    const raw = this.options.storage().getItem(this.storageKey);
    return raw === null ? null : parseAttendanceLocationClockPending(raw, this.options.siteId, this.options.employeeId);
  }
  private save(p: Pending) {
    const storage = this.options.storage(), previous = this.stored();
    if (previous && previous.intent.operationId !== p.intent.operationId) throw Error("pending_changed");
    const raw = JSON.stringify(p); storage.setItem(this.storageKey, raw);
    if (storage.getItem(this.storageKey) !== raw) throw Error("pending_not_saved");
  }
  private clear() {
    const stored = this.stored();
    if (stored && stored.intent.operationId !== this.state.pending?.intent.operationId) throw Error("pending_changed");
    const storage = this.options.storage(); storage.removeItem(this.storageKey);
    if (storage.getItem(this.storageKey) !== null) throw Error("pending_not_cleared");
  }
  initialize = async () => {
    this.pause();
    try { this.set({ pending: this.stored() }); } catch { this.storageFailure(); return; }
    await this.refresh();
  };
  private async request(command: AttendanceLocationClockCommand | null, operationId: string | null, signal: AbortSignal): Promise<Result> {
    const expectedWorkerId = this.state.pending?.intent.expectedWorkerId ?? this.options.workerId;
    const params = new URLSearchParams({ siteId: this.options.siteId, expectedWorkerId });
    if (operationId) params.set("operationId", operationId);
    const body = await attendanceManagementRequest(this.options.apiFetch, command ? endpoint : `${endpoint}?${params}`, command ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: this.options.siteId, ...command }),
    } : {}, { signal, maxBytes: 32768, timeoutMs: this.options.timeoutMs, errorStatuses: ATTENDANCE_LOCATION_CLOCK_ERRORS });
    const result = parseAttendanceLocationClockResult(body, { siteId: this.options.siteId, expectedWorkerId, operationId, command });
    if (result.employeeId !== this.options.employeeId) throw Error("invalid_response");
    return { ...result, moduleEnabled: body.moduleEnabled as boolean };
  }
  private accept(result: Result) {
    const pending = this.state.pending;
    if (!pending) { this.set({ phase: "ready", result, message: "状态已同步。定位异常会记录为待核查，不代表已审核工时。" }); return; }
    if (result.workerId !== pending.intent.expectedWorkerId) throw Error("attendance_worker_changed");
    if (result.receipt) {
      if (result.receipt.operationId !== pending.intent.operationId || result.receipt.action !== pending.intent.action || result.receipt.locationId !== pending.intent.locationId) throw Error("attendance_operation_conflict");
      if (!result.receiptGate || Object.entries(result.receiptGate.command).some(([key, value]) => pending.intent[key as keyof AttendanceLocationClockIntent] !== value)) throw Error("attendance_operation_conflict");
      try { this.clear(); } catch { this.storageFailure(); return; }
      this.set({ phase: "ready", pending: null, result, confirmed: result,
        message: result.locationResult?.needsReview ? "打卡已记录，定位情况待核查；这不是已审核工时。" : "打卡已由服务器记录，位置报告落在范围内；不代表已审核工时或真实在场证明。" });
      return;
    }
    if (result.state.sequence > pending.intent.expectedSequence || (!pending.intent.safeFinish && result.locationId === pending.intent.locationId && result.noticeGate.revision !== null &&
      result.noticeGate.revision > pending.intent.noticeRevision!)) {
      // Worker monotonic sequence fences all delayed attempts of this intent.
      try { this.clear(); } catch { this.storageFailure(); return; }
      this.set({ phase: "ready", pending: null, result, confirmed: null, message: "未找到此操作的收据；记录序号或告知版本已前进，旧操作已不能写入。请核对后再操作。" });
    } else this.set({ phase: "unconfirmed", result, confirmed: null, message: "尚未查到原操作收据。请核对或明确选择原编号重试；不会自动提交或改用新编号。" });
  }
  refresh = async () => {
    if (this.controller) return;
    const g = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", result: null, confirmed: null, message: "正在核对当前权限和原操作收据…" });
    try {
      const result = await this.request(null, this.state.pending?.intent.operationId ?? null, controller.signal);
      if (g === this.generation) this.accept(result);
    } catch (error) {
      if (g === this.generation) {
        if (identityRejected(error)) this.identityFailure();
        else this.set({ phase: this.state.pending ? "unconfirmed" : "blocked", result: null, confirmed: null, message: "未能核对服务器结果，请检查登录或联系负责人；原操作编号不会被清除。" });
      }
    }
    finally { if (g === this.generation) this.controller = null; }
  };
  // Failure fallback is a separate explicit action; a browser denial never
  // silently submits a locationless punch. Caller must present its meaning.
  submit = async (action: AttendanceAction, failure: AttendancePositionFailure | null = null) => {
    if (this.controller || !this.options.canClock || this.state.phase !== "ready" || this.state.pending) return;
    await this.send(action, failure, false);
  };
  retry = async (failure: AttendancePositionFailure | null = null) => {
    if (this.controller || !this.options.canClock || this.state.phase !== "unconfirmed" || !this.state.pending) return;
    await this.send(this.state.pending.intent.action, this.state.pending.intent.safeFinish ? "not_provided" : failure, true, this.state.pending.intent.safeFinish);
  };
  finish = async () => {
    if (this.controller || !this.options.canClock || this.state.phase !== "ready" || this.state.pending || !this.state.result?.finish) return;
    await this.send(this.state.result.state.status === "break" ? "break_end" : "clock_out", "not_provided", false, true);
  };
  private async send(action: AttendanceAction, failure: AttendancePositionFailure | null, retry: boolean, safeFinish = false) {
    const g = this.generation, controller = new AbortController(); this.controller = controller;
    const finishSequence = safeFinish && !retry ? this.state.result?.state.sequence : null;
    let posted = false;
    const active = () => g === this.generation && !controller.signal.aborted;
    this.set({ phase: "loading", result: null, confirmed: null, message: "提交前核对权限与收据…" });
    try {
      if (failure !== null && !ATTENDANCE_POSITION_FAILURES.includes(failure)) throw Error("invalid_failure");
      if (!this.options.environment.isSecureContext() || !this.options.environment.isVisible()) throw Error("device_unavailable");
      const result = await this.request(null, this.state.pending?.intent.operationId ?? null, controller.signal);
      if (!active()) return;
      if (safeFinish && !retry && result.state.sequence !== finishSequence) throw Error("attendance_sequence_conflict");
      if (retry) {
        this.accept(result);
        if (!this.state.pending || this.state.phase === "blocked") return;
      }
      const allowed = result.state.status === "off" ? ["clock_in"] : result.state.status === "break" ? ["break_end"] : ["break_start", "clock_out"];
      if (!allowed.includes(action)) throw Error("attendance_access_denied");
      const versions = safeFinish ? result.finish : result.policy, locationId = safeFinish ? result.finish?.locationId : result.locationId;
      if (!versions || !locationId || (safeFinish ? !["break_end", "clock_out"].includes(action) :
        !result.channelEnabled || !result.noticeGate.ready || !attendanceActionAllowed(result.moduleEnabled, action))) throw Error("attendance_access_denied");
      if (retry && this.state.pending && (this.state.pending.intent.locationId !== locationId || (!safeFinish &&
        (this.state.pending.intent.noticeRevision !== result.noticeGate.revision ||
        ["settingsVersion", "workerVersion", "locationVersion"].some(key => this.state.pending!.intent[key as keyof AttendanceLocationClockIntent] !== versions[key as keyof typeof versions])))))
        throw Error("attendance_location_policy_changed");
      let position: AttendancePosition | null = null;
      if (!safeFinish && failure === null) {
        if (!this.options.environment.isVisible()) throw Error("device_unavailable");
        const geo = this.options.environment.geolocation(); if (!geo) throw Error("location_unsupported");
        this.set({ phase: "locating", message: "正在获取一次位置。取消或拒绝授权不会自动提交无定位打卡。" });
        position = await acquireAttendancePosition(geo, controller.signal, this.options.locationTimeoutMs);
      }
      if (!active()) return;
      if (!this.options.environment.isVisible()) throw Error("device_unavailable");
      if (!retry) {
        const intent: AttendanceLocationClockIntent = { operationId: attendanceSelfUuid(this.options.randomId?.() ?? crypto.randomUUID()),
          expectedWorkerId: result.workerId, locationId, action, expectedSequence: result.state.sequence,
          settingsVersion: versions.settingsVersion, workerVersion: versions.workerVersion, locationVersion: versions.locationVersion,
          noticeRevision: safeFinish ? null : result.noticeGate.revision, safeFinish };
        if (this.stored()) throw Error("pending_changed");
        const pending: Pending = { version: 1, siteId: this.options.siteId, employeeId: this.options.employeeId, intent };
        this.save(pending); this.set({ pending });
      }
      const pending = this.state.pending; if (!pending) throw Error("pending_invalid");
      this.save(pending);
      this.set({ phase: "submitting", message: "正在提交打卡；定位摘要和打卡记录将一起保存。" });
      posted = true;
      const saved = await this.request({ ...pending.intent, position, positionFailure: failure }, null, controller.signal);
      if (active()) this.accept(saved);
    } catch (error) {
      if (!active()) return;
      // Identity/ownership refusals preserve the original ID for review, even
      // on the first POST. They are not evidence that an old receipt is absent.
      if (identityRejected(error)) { this.identityFailure(); return; }
      if (posted && !retry && error instanceof AttendanceManagementRejected) {
        // Other first explicit transactional refusals prove this new operation
        // did not commit; retry refusals keep any possibly-existing receipt.
        try { this.clear(); this.set({ pending: null }); } catch { this.storageFailure(); return; }
      }
      const code = error instanceof Error ? error.message : "";
      this.set({ phase: this.state.pending ? "unconfirmed" : "blocked", result: null, confirmed: null,
        message: this.state.pending ? "结果仍待确认，原操作编号已保留。请核对收据，不要换编号重复提交。" :
          ["location_denied", "location_timeout", "location_unsupported", "location_unavailable", "location_device_pending"].includes(code)
            ? "未能取得可用位置，尚未发送打卡。请先点击“重新读取／核对收据”，再重试定位或明确选择无定位登记并等待核查。" : "本次操作未完成，请重新读取状态或联系负责人；不会自动重试。" });
    } finally { if (g === this.generation) this.controller = null; }
  }
}
