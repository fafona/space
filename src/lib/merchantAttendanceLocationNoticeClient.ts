import { NOTICE_ERRORS, noticeQueryString, parseNoticeQuery, parseNoticeCommand, parseNoticeResult, noticeReceiptMatches, type NoticeCommand, type NoticeQuery, type NoticeResult } from "./merchantAttendanceLocationNotice";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
type Pending = { actorId: string; query: NoticeQuery; command: NoticeCommand };
type Result = NoticeResult & { moduleEnabled: boolean };
export class AttendanceNoticeClient {
  private state: { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: Result | null; pending: Pending | null; message: string } = {
    phase: "idle", result: null, pending: null, message: "读取告知不代表确认收到，也不会请求定位。" };
  private generation = 0; private controller: AbortController | null = null; private paused = false; private listeners = new Set<() => void>();
  readonly storageKey: string;
  constructor(private readonly options: { query: NoticeQuery; actorId: string; apiFetch: AttendanceApiFetch; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number }) {
    this.storageKey = `faolla:attendance:notice:v1:${options.query.siteId}:${options.query.access}:${options.actorId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private restored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey); if (raw === null) return null; if (raw.length > 4096) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || Object.keys(p).sort().join() !== "actorId,command,query" || p.actorId !== this.options.actorId || !p.query || !p.command
      || Object.keys(p.query).sort().join() !== "access,expectedWorkerId,locationId,operationId,siteId") throw Error("invalid_pending");
    const keys = p.command.action === "acknowledge" ? "action,expectedRevision,operationId" : "action,draftRevision,expectedLocationVersion,expectedRevision,expectedSettingsVersion,operationId,reason";
    if (Object.keys(p.command).sort().join() !== keys) throw Error("invalid_pending");
    const query = parseNoticeQuery(`https://local.invalid/?${noticeQueryString(p.query)}`);
    if (query.siteId !== this.options.query.siteId || query.access !== this.options.query.access || query.operationId !== null) throw Error("invalid_pending");
    const { command } = parseNoticeCommand({ siteId: query.siteId, access: query.access, locationId: query.locationId, expectedWorkerId: query.expectedWorkerId, ...p.command });
    return { actorId: p.actorId, query, command };
  }
  private clear() {
    if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict");
    this.options.storage().removeItem(this.storageKey); if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_conflict");
    this.set({ pending: null });
  }
  pause = () => { this.paused = true; this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: this.state.pending ? "unconfirmed" : "idle", result: null, message: "已隐藏资料；已发送操作可能完成，需要重新核对。" }); };
  initialize = async () => {
    this.generation++; this.controller?.abort(); this.controller = null; this.paused = false;
    try { this.set({ pending: this.restored(), result: null }); }
    catch { this.set({ phase: "blocked", result: null, message: "本页待确认操作或存储异常，不会覆盖、删除或重发。" }); return; }
    await this.request(null, false);
  };
  submit = async (action: NoticeCommand["action"], reason = "") => {
    const r = this.state.result;
    if (this.paused || this.controller || this.state.pending || this.state.phase !== "ready" || !r || r.location.id !== this.options.query.locationId
      || action === "publish" && !r.canPublish || action === "withdraw" && !r.canWithdraw || action === "acknowledge" && !r.canAcknowledge) return;
    try {
      if (this.restored()) { await this.initialize(); return; }
      const q = this.options.query, { query, command } = parseNoticeCommand({ siteId: q.siteId, access: q.access, locationId: q.locationId, expectedWorkerId: q.expectedWorkerId,
        action, operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(), expectedRevision: r.current?.revision ?? 0,
        ...(action === "acknowledge" ? {} : { draftRevision: action === "publish" ? r.draft?.revision : null, expectedSettingsVersion: r.settingsVersion, expectedLocationVersion: r.location.version, reason }) });
      const pending = { actorId: this.options.actorId, query, command }, raw = JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey, raw); if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_write_failed");
      this.set({ pending }); await this.request(command, true);
    } catch { this.set({ phase: "blocked", result: null, message: "请检查发布说明或本页存储，不覆盖原操作。" }); }
  };
  retry = async () => {
    if (this.paused || this.controller || this.state.phase !== "unconfirmed" || !this.state.pending) return;
    if (await this.request(null, false) && this.state.pending && this.state.phase === "unconfirmed") {
      const action = this.state.pending.command.action, r = this.state.result;
      if (action === "withdraw" || action === "acknowledge" && r?.canAcknowledge || action === "publish" && r?.canPublish) await this.request(this.state.pending.command, false);
    }
  };
  private async request(command: NoticeCommand | null, first: boolean): Promise<boolean> {
    const g = ++this.generation, controller = new AbortController(); this.controller = controller; this.set({ result: null, phase: command ? "saving" : "loading" });
    try {
      if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict");
      const query = parseNoticeQuery(`https://local.invalid/?${noticeQueryString(this.state.pending?.query ?? this.options.query)}`);
      const expected = { ...query, operationId: this.state.pending?.command.operationId ?? null };
      const body = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/location-notice${command ? "" : `?${noticeQueryString(expected)}`}`,
        { method: command ? "POST" : "GET", ...(command ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: query.siteId, access: query.access, locationId: query.locationId, expectedWorkerId: query.expectedWorkerId, ...command }) } : {}) },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 24576, errorStatuses: NOTICE_ERRORS });
      const result = { ...parseNoticeResult(body, expected), moduleEnabled: body.moduleEnabled as boolean };
      if (query.access === "self" && result.employeeId !== this.options.actorId) throw Error("identity_mismatch");
      if (g !== this.generation || this.paused) return false;
      const pending = this.state.pending;
      if (command && !result.receipt || pending && result.receipt && !noticeReceiptMatches(result.receipt, pending.command)) throw Error("receipt_mismatch");
      const c = pending?.command, newer = c && (result.current?.revision ?? 0) > c.expectedRevision;
      // Only irreversible version advancement proves the old write can no longer
      // succeed. Pause/temporary inactivity alone must retain uncertain intent.
      const fenced = c && (newer || c.action === "publish" && (result.settingsVersion > c.expectedSettingsVersion || result.location.version > c.expectedLocationVersion || (result.draft?.revision ?? 0) > (c.draftRevision ?? 0))
        || c.action === "acknowledge" && result.acknowledgedAt !== null && result.current?.revision === c.expectedRevision);
      if (pending && (result.receipt || fenced)) this.clear();
      const restoredOther = query.locationId !== this.options.query.locationId || query.expectedWorkerId !== this.options.query.expectedWorkerId;
      this.set({ result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending ? "原操作尚未确认；可重新核对或明确使用原编号重试。"
        : restoredOther ? "已核对先前地点的操作。请再读取一次当前地点，不能直接基于旧地点提交。"
        : result.receipt ? "操作已确认。仅处理告知版本，不启用定位或修改打卡。"
        : fenced ? "原编号未找到，但版本已变化或该版本已有确认；原请求不能再写入，请阅读当前版本。" : "已读取当前告知；读取本身不会生成确认记录。" });
      return true;
    } catch (e) {
      if (g !== this.generation || this.paused) return false;
      if (command && first && e instanceof AttendanceManagementRejected) { try { this.clear(); } catch { /* Preserve conflicting storage. */ } }
      this.set({ phase: this.state.pending ? "unconfirmed" : "blocked", result: null, message: "暂时无法确认结果或访问权限，请重新读取。不会自动重发或使用旧身份提交。" }); return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
