import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import { parseScheduleBody, parseScheduleQuery, parseScheduleResult, scheduleQueryString, scheduleMessage, SCHEDULE_ERRORS,
  type ScheduleCommand, type ScheduleQuery, type ScheduleResult } from "./merchantAttendanceSchedule";
type Pending = { actorId: string; query: ScheduleQuery; command: ScheduleCommand };
export type ScheduleIntent = { reason: string } & ({ action: "publish"; locationId: string; timeZone: string; slots: [string, string][] } | { action: "cancel"; slotId: string });
export class AttendanceScheduleClient {
  private state: { phase: "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; query: ScheduleQuery; result: ScheduleResult | null; pending: Pending | null; message: string };
  private generation = 0; private controller: AbortController | null = null; private paused = false; private listeners = new Set<() => void>();
  readonly storageKey: string;
  constructor(private readonly options: { query: ScheduleQuery; actorId: string; apiFetch: AttendanceApiFetch;
    storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number }) {
    this.storageKey = `faolla:attendance:schedule:v1:${options.query.siteId}:${options.actorId}`;
    this.state = { phase: "loading", query: options.query, result: null, pending: null, message: "正在读取排班…" };
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private restore(): Pending | null {
    if (this.options.query.access === "self") return null;
    const raw = this.options.storage().getItem(this.storageKey); if (raw === null) return null;
    if (raw.length > 8192) throw Error("invalid_pending"); const p = JSON.parse(raw);
    if (!p || Object.keys(p).sort().join() !== "actorId,command,query" || p.actorId !== this.options.actorId) throw Error("invalid_pending");
    const body = parseScheduleBody({ query: p.query, command: p.command }); if (body.query.siteId !== this.options.query.siteId) throw Error("invalid_pending");
    return { actorId: p.actorId, ...body };
  }
  private samePending() { if (JSON.stringify(this.restore()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict"); }
  private clear() { this.samePending(); this.options.storage().removeItem(this.storageKey); if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_error"); this.set({ pending: null }); }
  pause = () => { this.paused = true; this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: "资料已隐藏，回来后重新核对；已发送操作不会因离开撤销。" }); };
  initialize = async () => {
    this.generation++; this.controller?.abort(); this.controller = null; this.paused = false;
    try { const pending = this.restore(); this.set({ pending, result: null, query: pending?.query ?? this.state.query }); }
    catch { this.set({ phase: "blocked", result: null, message: "待确认存储异常，已停止写入，不会覆盖或自动重发。" }); return; }
    await this.request(null, false);
  };
  load = async (query: ScheduleQuery) => {
    if (this.paused || this.controller || this.state.pending) return;
    if (query.siteId !== this.options.query.siteId || query.access !== this.options.query.access || query.operationId !== null) return;
    try { this.set({ query: parseScheduleQuery(`https://local.invalid/?${scheduleQueryString(query)}`) }); await this.request(null, false); }
    catch { this.set({ result: null, phase: "blocked", message: "请选择不超过 31 天的有效日期范围。" }); }
  };
  submit = async (intent: ScheduleIntent) => {
    const r = this.state.result;
    if (this.paused || this.controller || this.state.pending || this.state.phase !== "ready" || !r?.moduleEnabled || this.state.query.access !== "owner") return;
    try {
      if (this.restore()) { await this.initialize(); return; }
      const body = parseScheduleBody({ query: this.state.query, command: { operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(),
        expectedRevision: r.revision, expectedSettingsVersion: r.settingsVersion, ...intent } });
      if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 4096) throw Error("too_large");
      const pending = { actorId: this.options.actorId, ...body }, raw = JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey, raw); if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_error");
      this.set({ pending }); await this.request(body.command, true);
    } catch { this.set({ phase: "blocked", result: null, message: "内容或本地存储异常，未确认保存；请核对日期、重叠、每批 32 段上限及待确认编号。" }); }
  };
  retry = async () => {
    if (this.paused || this.controller || !this.state.pending || this.state.phase !== "unconfirmed") return;
    if (await this.request(null, false) && this.state.pending && this.state.result?.moduleEnabled) await this.request(this.state.pending.command, false);
  };
  private async request(command: ScheduleCommand | null, first: boolean) {
    const generation = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ result: null, phase: command ? "saving" : "loading" });
    try {
      this.samePending(); const query = { ...this.state.query, operationId: command?.operationId ?? this.state.pending?.command.operationId ?? null };
      const raw = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/schedule${command ? "" : `?${scheduleQueryString(query)}`}`,
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: this.state.query, command }) } : {},
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 262144, errorStatuses: SCHEDULE_ERRORS });
      if (generation !== this.generation || this.paused) return false;
      this.samePending(); const result = parseScheduleResult(raw, query), pending = this.state.pending;
      if (command && !result.receipt || pending && result.receipt && JSON.stringify(pending.command) !== JSON.stringify(result.receipt.command)) throw Error("receipt_mismatch");
      if (pending && (result.receipt || result.revision > pending.command.expectedRevision || result.settingsVersion !== pending.command.expectedSettingsVersion)) {
        const saved = !!result.receipt; this.clear(); this.set({ result, phase: "ready", message: saved ? "排班操作已确认。安排不等于实际打卡或已确认工时。" : "旧操作未查到收据且版本已改变，旧命令已失效；请重新核对后编辑。" });
      } else this.set({ result, phase: pending ? "unconfirmed" : "ready", message: pending ? "结果待确认，请查询原收据或明确使用原编号重试。" : "已读取计划安排；无排班不自动判缺勤，不会自动生成打卡。" });
      return true;
    } catch (error) {
      if (generation !== this.generation || this.paused) return false;
      if (command && error instanceof AttendanceManagementRejected && (error.message === "attendance_version_conflict" || first && error.message !== "attendance_operation_conflict")) {
        try { this.clear(); } catch { /* Retain uncertain receipt. */ }
      }
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: scheduleMessage(error instanceof Error ? error.message : "") }); return false;
    } finally { if (generation === this.generation) this.controller = null; }
  }
}
