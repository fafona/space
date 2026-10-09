import { attendanceAdminMessage } from "./merchantAttendanceAdmin";
import { ATTENDANCE_LOCATION_POLICY_ERRORS, parseAttendanceLocationPolicyCommand, parseAttendanceLocationPolicyResult,
  type AttendanceLocationPolicyCommand, type AttendanceLocationPolicyResult, type AttendanceLocationPolicyValues } from "./merchantAttendanceLocationPolicy";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

type Pending = { ownerId: string; siteId: string; locationId: string; command: AttendanceLocationPolicyCommand };
type Result = AttendanceLocationPolicyResult & { moduleEnabled: boolean };
type State = { phase: "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: Result | null; pending: Pending | null; message: string };
export class AttendanceLocationPolicyClient {
  private state: State = { phase: "loading", result: null, pending: null, message: "正在读取定位政策草稿…" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private paused = false;
  readonly storageKey: string;
  constructor(private readonly options: { siteId: string; ownerId: string; locationId: string; apiFetch: AttendanceApiFetch;
    storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number }) {
    this.storageKey = `faolla:attendance:location-policy:v1:${options.siteId}:${options.ownerId}:${options.locationId}`;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private restored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey);
    if (raw === null) return null;
    if (raw.length > 5000) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || Object.keys(p).sort().join() !== "command,locationId,ownerId,siteId" || p.siteId !== this.options.siteId || p.ownerId !== this.options.ownerId || p.locationId !== this.options.locationId
      || !p.command || Object.keys(p.command).sort().join() !== "expectedLocationVersion,expectedRevision,expectedSettingsVersion,operationId,values") throw Error("invalid_pending");
    const parsed = parseAttendanceLocationPolicyCommand({ siteId: p.siteId, locationId: p.locationId, ...p.command });
    return { ...parsed, ownerId: p.ownerId };
  }
  private clear() {
    if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict");
    this.options.storage().removeItem(this.storageKey);
    if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_not_cleared");
    this.set({ pending: null });
  }
  pause = () => {
    this.paused = true; this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: "已停止等待。已发送的保存可能完成，请重新读取核对；这不会撤销服务器记录。" });
  };
  initialize = async () => {
    this.generation++; this.controller?.abort(); this.controller = null; this.paused = false;
    try { this.set({ pending: this.restored(), result: null }); }
    catch { this.set({ phase: "blocked", result: null, message: "待确认草稿或存储异常；不会覆盖、丢弃或自动重发。" }); return; }
    await this.request(null, false);
  };
  submit = async (values: AttendanceLocationPolicyValues, expected: { revision: number; settingsVersion: number; locationVersion: number }) => {
    if (this.paused || this.controller || this.state.pending || this.state.phase !== "ready" || !this.state.result?.moduleEnabled || !this.state.result.location.active) return;
    try {
      if (this.restored()) { await this.initialize(); return; }
      const command = parseAttendanceLocationPolicyCommand({ siteId: this.options.siteId, locationId: this.options.locationId,
        operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(), expectedRevision: expected.revision,
        expectedSettingsVersion: expected.settingsVersion, expectedLocationVersion: expected.locationVersion, values }).command;
      // Same UTF-8 bound as the route, before persisting or sending any write.
      if (new TextEncoder().encode(JSON.stringify({ siteId: this.options.siteId, locationId: this.options.locationId, ...command })).byteLength > 4096) throw Error("attendance_body_too_large");
      const pending = { siteId: this.options.siteId, locationId: this.options.locationId, command, ownerId: this.options.ownerId };
      const raw = JSON.stringify(pending); this.options.storage().setItem(this.storageKey, raw);
      if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_write_failed");
      this.set({ pending }); await this.request(command, true);
    } catch (e) { this.set({ phase: "blocked", result: null, message: `${attendanceAdminMessage(e instanceof Error ? e.message : "")} 请重新读取。` }); }
  };
  retry = async () => {
    if (this.paused || this.controller || !this.state.pending || this.state.phase !== "unconfirmed") return;
    // Explicit retry first checks the original receipt, then may resend the exact
    // original draft. A GET error never triggers a write.
    const checked = await this.request(null, false);
    if (checked && this.state.pending && this.state.phase === "unconfirmed" && this.state.result?.moduleEnabled) await this.request(this.state.pending.command, false);
  };
  private settle(result: Result) {
    const p = this.state.pending;
    if (p && result.receipt && result.receipt.revision !== p.command.expectedRevision + 1) throw Error("receipt_mismatch");
    if (p && (result.receipt || (result.current?.revision ?? 0) > p.command.expectedRevision || result.settingsVersion !== p.command.expectedSettingsVersion || result.location.version !== p.command.expectedLocationVersion)) {
      // The serialized settings/location fence also prevents an uncommitted old
      // request from succeeding after a configuration version change.
      const saved = !!result.receipt; this.clear();
      this.set({ phase: "ready", result, message: saved ? `草稿保存已确认 · 版本 ${result.receipt!.revision}。下方显示当前草稿，未启用定位。` : "原收据未找到且版本已变化，旧请求不能再提交。请核对当前草稿后重新编辑。" });
    } else this.set({ result, phase: p ? "unconfirmed" : "ready", message: p ? "保存结果尚未确认。可查询收据，或明确用原编号重试；不会自动重发。" : "只编辑草稿，不改变实际围栏、打卡开关或员工权限。" });
  }
  private async request(command: AttendanceLocationPolicyCommand | null, first: boolean): Promise<boolean> {
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: command ? "saving" : "loading", result: null });
    try {
      if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict");
      const operationId = command?.operationId ?? this.state.pending?.command.operationId ?? null;
      const q = new URLSearchParams({ siteId: this.options.siteId, locationId: this.options.locationId });
      if (operationId) q.set("operationId", operationId);
      const raw = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/location-policy${command ? "" : `?${q}`}`,
        { method: command ? "POST" : "GET", ...(command ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: this.options.siteId, locationId: this.options.locationId, ...command }) } : {}) },
        { maxBytes: 16384, signal: controller.signal, timeoutMs: this.options.timeoutMs, errorStatuses: ATTENDANCE_LOCATION_POLICY_ERRORS });
      if (g !== this.generation || this.paused) return false;
      const result = { ...parseAttendanceLocationPolicyResult(raw, { siteId: this.options.siteId, locationId: this.options.locationId, operationId }), moduleEnabled: raw.moduleEnabled as boolean };
      if (command && !result.receipt) throw Error("receipt_missing");
      this.settle(result); return true;
    } catch (e) {
      if (g !== this.generation || this.paused) return false;
      if (command && first && e instanceof AttendanceManagementRejected) { try { this.clear(); } catch { /* Preserve uncertain storage. */ } }
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: attendanceAdminMessage(e instanceof Error ? e.message : "") }); return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
