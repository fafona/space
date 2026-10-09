import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { LOCATION_SETUP_ERRORS, parseLocationSetupCommand, parseLocationSetupQuery, parseLocationSetupResult, setupReceiptMatches, type LocationSetupCommand, type LocationSetupQuery, type LocationSetupResult } from "./merchantAttendanceLocationSetup";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
type Pending = { ownerId: string; query: LocationSetupQuery; command: LocationSetupCommand };
type Result = LocationSetupResult & { moduleEnabled: boolean };
const endpoint = "/api/merchant-enterprise/attendance/location-setup";
const qs = (q: LocationSetupQuery) => new URLSearchParams({ siteId: q.siteId, locationId: q.locationId, ...(q.operationId ? { operationId: q.operationId } : {}) }).toString();
export class AttendanceLocationSetupClient {
  private state: { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; pending: Pending | null; result: Result | null; message: string } = {
    phase: "idle", pending: null, result: null, message: "先读取当前围栏和通路状态；读取不会修改配置。" };
  private generation = 0; private controller: AbortController | null = null; private paused = false; private listeners = new Set<() => void>();
  readonly storageKey: string;
  constructor(private readonly options: { query: LocationSetupQuery; ownerId: string; apiFetch: AttendanceApiFetch; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number }) {
    parseLocationSetupQuery(`https://local.invalid/?${qs(options.query)}`); attendanceSelfUuid(options.ownerId);
    this.storageKey = `faolla:attendance:location-setup:v1:${options.query.siteId}:${options.ownerId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private stored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey); if (raw === null) return null;
    if (raw.length > 4096) throw Error("invalid_pending"); const p = JSON.parse(raw);
    if (!p || Object.keys(p).sort().join() !== "command,ownerId,query" || p.ownerId !== this.options.ownerId || !p.query || !p.command
      || Object.keys(p.query).sort().join() !== "locationId,operationId,siteId" || p.query.siteId !== this.options.query.siteId || p.query.operationId !== null) throw Error("invalid_pending");
    const query = parseLocationSetupQuery(`https://local.invalid/?${qs(p.query)}`), parsed = parseLocationSetupCommand({ siteId: query.siteId, locationId: query.locationId, ...p.command });
    if (JSON.stringify(parsed.command) !== JSON.stringify(p.command)) throw Error("invalid_pending");
    return { ownerId: p.ownerId, query: parsed.query, command: parsed.command };
  }
  private clear() {
    if (JSON.stringify(this.stored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict");
    this.options.storage().removeItem(this.storageKey); if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_conflict");
    this.set({ pending: null });
  }
  pause = () => { this.paused = true; this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: this.state.pending ? "unconfirmed" : "idle", result: null, message: "已停止等待。已发送的操作可能完成，需核对原编号。" }); };
  initialize = async () => {
    this.generation++; this.controller?.abort(); this.controller = null; this.paused = false;
    try { this.set({ pending: this.stored(), result: null }); } catch { this.set({ phase: "blocked", result: null, message: "本页待确认操作或存储异常，不会覆盖或重发。" }); return; }
    await this.request(null, false);
  };
  submit = async (action: LocationSetupCommand["action"], reason: string) => {
    const r = this.state.result;
    if (this.paused || this.controller || this.state.pending || this.state.phase !== "ready" || !r || r.locationId !== this.options.query.locationId
      || action === "prepare" && !r.canPrepare || action === "enable" && !r.canEnable || action === "pause" && !r.canPause) return;
    try {
      if (this.stored()) { await this.initialize(); return; }
      const parsed = parseLocationSetupCommand({ siteId: r.siteId, locationId: r.locationId, action, operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(),
        expectedSettingsVersion: r.settingsVersion, expectedLocationVersion: r.location.version, expectedChannelVersion: r.channelVersion,
        draftRevision: action === "prepare" ? r.draft?.revision : null, reason });
      const pending = { ownerId: this.options.ownerId, ...parsed }, raw = JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey, raw); if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_write_failed");
      this.set({ pending }); await this.request(parsed.command, true);
    } catch { this.set({ phase: "blocked", result: null, message: "请检查操作说明和本页存储，未确认前不要重复操作。" }); }
  };
  retry = async () => {
    if (this.paused || this.controller || !this.state.pending || this.state.phase !== "unconfirmed") return;
    if (await this.request(null, false) && this.state.pending && this.state.phase === "unconfirmed") {
      const c = this.state.pending.command, r = this.state.result;
      if (c.action === "pause" || c.action === "prepare" && r?.canPrepare || c.action === "enable" && r?.canEnable) await this.request(c, false);
    }
  };
  private async request(command: LocationSetupCommand | null, first: boolean) {
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: command ? "saving" : "loading", result: null });
    try {
      if (JSON.stringify(this.stored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict");
      const query = this.state.pending?.query ?? this.options.query, expected = { ...query, operationId: this.state.pending?.command.operationId ?? null, ownerId: this.options.ownerId };
      const body = await attendanceManagementRequest(this.options.apiFetch, `${endpoint}${command ? "" : `?${qs(expected)}`}`,
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: query.siteId, locationId: query.locationId, ...command }) } : {},
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 24576, errorStatuses: LOCATION_SETUP_ERRORS });
      if (typeof body.moduleEnabled !== "boolean") throw Error("invalid_response");
      const result: Result = { ...parseLocationSetupResult(body, expected), moduleEnabled: body.moduleEnabled };
      if (g !== this.generation || this.paused) return false;
      const pending = this.state.pending, c = pending?.command;
      if (command && !result.receipt || c && result.receipt && !setupReceiptMatches(result.receipt, c)) throw Error("receipt_mismatch");
      // Pause intentionally ignores stale policy/location versions. Only its own
      // monotonic channel version can fence an uncertain pause command.
      const fenced = c && (result.channelVersion > c.expectedChannelVersion || c.action !== "pause" &&
        (result.settingsVersion > c.expectedSettingsVersion || result.location.version > c.expectedLocationVersion || c.action === "prepare" && (result.draft?.revision ?? 0) > c.draftRevision!));
      if (pending && (result.receipt || fenced)) this.clear();
      this.set({ result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending ? "尚未确认原操作，可核对或明确用原编号重试。"
        : query.locationId !== this.options.query.locationId ? "已核对之前地点的操作；请再读取一次当前地点后操作。"
        : result.receipt ? "服务器已确认原操作。当前状态和操作当时的结果分开显示。"
        : fenced ? "未找到原收据，但单调版本已前进，旧命令不能再写入。请核对当前状态。" : "已读取当前设置；尚未替你执行任何修改。" });
      return true;
    } catch (error) {
      if (g !== this.generation || this.paused) return false;
      if (command && first && error instanceof AttendanceManagementRejected) { try { this.clear(); } catch { /* Preserve competing or uncertain operation. */ } }
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: error instanceof AttendanceManagementRejected && error.message === "attendance_setup_open_web_shift"
        ? "存在未结束的普通网页班次，围栏未应用。请先按原方式结束班次，再重新读取；不会自动重发。"
        : "未能确认结果或访问权限，原操作不会自动重发。请重新核对。" }); return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
