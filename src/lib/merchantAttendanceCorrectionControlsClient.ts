import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { CORRECTION_CONTROL_ERRORS, correctionControlQueryString, correctionControlReceiptMatches, parseCorrectionControlCommand, parseCorrectionControlResult,
  type CorrectionControlCommand, type CorrectionControlResult } from "./merchantAttendanceCorrectionControls";
export type CorrectionControlIntent = { reason: string } & ({ action: "set_policy"; submissionWindowDays: number } |
  { action: "lock_period"; fromDate: string; throughDate: string } | { action: "unlock_period"; periodId: string });
type Pending = { siteId: string; ownerId: string; command: CorrectionControlCommand };
type Result = CorrectionControlResult & { moduleEnabled: boolean };
export const correctionControlsKey = (siteId: string, ownerId: string) => `faolla:attendance:correction-controls:v1:${siteId}:${ownerId}`;
export function parseCorrectionControlsPending(raw: string, siteId: string, ownerId: string): Pending {
  if (raw.length > 8192) throw Error("invalid_pending"); const p = JSON.parse(raw);
  if (!p || Object.keys(p).sort().join() !== "command,ownerId,siteId" || p.siteId !== siteId || p.ownerId !== attendanceSelfUuid(ownerId)) throw Error("invalid_pending");
  const parsed = parseCorrectionControlCommand({ siteId, ...p.command });
  if (parsed.siteId !== siteId) throw Error("invalid_pending"); return { siteId, ownerId, command: parsed.command };
}
const messages: Record<string, string> = {
  attendance_period_overlap: "所选日期与已有锁定范围重叠，请先核对。", attendance_period_future: "只能锁定已经结束的自然日，不能锁定今天或未来日期。",
  attendance_period_not_locked: "该周期当前未锁定，请重新读取。", attendance_period_limit: "已有 200 个锁定范围，不能再添加；请核对管理范围。",
  attendance_local_date_does_not_exist: "该时区不存在所选自然日，请更换日期。", attendance_version_conflict: "配置或规则版本已改变，请核对最新版本后重新编辑。",
  attendance_platform_paused: "平台暂停新配置写入；仍可读取与核对旧操作。", attendance_access_denied: "负责人权限已变化，已隐藏资料。",
  attendance_operation_conflict: "原操作编号与服务器记录冲突，保留编号供核查。",
};
export class AttendanceCorrectionControlsClient {
  private state: { phase: "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: Result | null; pending: Pending | null; message: string } = {
    phase: "loading", result: null, pending: null, message: "正在读取补正规则与锁定配置…" };
  private generation = 0; private controller: AbortController | null = null; private paused = false; private listeners = new Set<() => void>();
  readonly storageKey: string;
  constructor(private readonly options: { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch;
    storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number }) {
    this.storageKey = correctionControlsKey(options.siteId, options.ownerId);
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private restored() { const raw = this.options.storage().getItem(this.storageKey); return raw === null ? null : parseCorrectionControlsPending(raw, this.options.siteId, this.options.ownerId); }
  private samePending() { if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict"); }
  private clear() { this.samePending(); this.options.storage().removeItem(this.storageKey); if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_not_cleared"); this.set({ pending: null }); }
  pause = () => { this.paused = true; this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: "资料已隐藏；已发送操作可能完成，返回时只查询原收据。" }); };
  initialize = async () => {
    this.generation++; this.controller?.abort(); this.controller = null; this.paused = false;
    try { this.set({ result: null, pending: this.restored() }); }
    catch { this.set({ result: null, phase: "blocked", message: "待确认记录或存储异常，不会覆盖、丢弃或自动重发。" }); return; }
    await this.request(null, null, false);
  };
  page = async (beforeRevision: number | null) => { if (!this.paused && !this.controller && !this.state.pending && this.state.phase === "ready") await this.request(null, beforeRevision, false); };
  submit = async (intent: CorrectionControlIntent) => {
    const r = this.state.result;
    if (this.paused || this.controller || this.state.pending || this.state.phase !== "ready" || !r?.moduleEnabled) return;
    try {
      if (this.restored()) { await this.initialize(); return; }
      const command = parseCorrectionControlCommand({ siteId: this.options.siteId, operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(),
        expectedRevision: r.revision, expectedSettingsVersion: r.settingsVersion, ...intent }).command;
      const body = JSON.stringify({ siteId: this.options.siteId, ...command });
      if (new TextEncoder().encode(body).byteLength > 4096) throw Error("attendance_body_too_large");
      const pending = { siteId: this.options.siteId, ownerId: this.options.ownerId, command }, raw = JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey, raw); if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_write_failed");
      this.set({ pending }); await this.request(command, null, true);
    } catch { this.set({ phase: "blocked", result: null, message: "参数或待确认存储异常；请重新读取核对，不会另建操作编号重发。" }); }
  };
  retry = async () => {
    if (this.paused || this.controller || !this.state.pending || this.state.phase !== "unconfirmed") return;
    const ok = await this.request(null, null, false);
    if (ok && this.state.pending && this.state.phase === "unconfirmed" && this.state.result?.moduleEnabled) await this.request(this.state.pending.command, null, false);
  };
  private async request(command: CorrectionControlCommand | null, beforeRevision: number | null, first: boolean) {
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: command ? "saving" : "loading", result: null });
    try {
      this.samePending(); const q = { siteId: this.options.siteId, beforeRevision, operationId: command?.operationId ?? this.state.pending?.command.operationId ?? null };
      const raw = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/correction-controls${command ? "" : `?${correctionControlQueryString(q)}`}`,
        { method: command ? "POST" : "GET", ...(command ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: this.options.siteId, ...command }) } : {}) },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 262144, errorStatuses: CORRECTION_CONTROL_ERRORS });
      if (g !== this.generation || this.paused) return false;
      this.samePending(); const result = { ...parseCorrectionControlResult(raw, q, true), moduleEnabled: raw.moduleEnabled as boolean }, p = this.state.pending;
      if (command && !result.receipt || p && result.receipt && !correctionControlReceiptMatches(p.command, result.receipt)) throw Error("receipt_mismatch");
      if (p && (result.receipt || result.revision > p.command.expectedRevision || result.settingsVersion !== p.command.expectedSettingsVersion)) {
        const saved = !!result.receipt; this.clear(); this.set({ result, phase: "ready", message: saved ? "原操作已确认。显示当前配置；审批／工时生效仍未开放。"
          : "未查到原收据且版本已推进，旧命令已失效；请核对当前配置后重新编辑。" });
      } else this.set({ result, phase: p ? "unconfirmed" : "ready", message: p ? "保存尚未确认。不会自动重发；可查询收据或明确使用原编号重试。" : "新版补正入口已接入期限与锁定检查；配置不代表批准，也不改变实际工时。" });
      return true;
    } catch (e) {
      if (g !== this.generation || this.paused) return false;
      if (command && e instanceof AttendanceManagementRejected && (e.message === "attendance_version_conflict" || first && e.message !== "attendance_operation_conflict")) {
        try { this.clear(); } catch { /* Retain uncertain storage. */ }
      }
      const code = e instanceof Error ? e.message : "";
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: messages[code] ?? "未能确认结果，请重新读取；网络或响应异常不代表操作没有完成。" }); return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
