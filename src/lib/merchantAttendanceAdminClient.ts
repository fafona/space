import { ATTENDANCE_ADMIN_ERRORS, attendanceAdminMessage, parseAttendanceAdminCommand, parseAttendanceAdminResult, type AttendanceAdminChange, type AttendanceAdminCommand, type AttendanceAdminResult, type AttendanceAdminView } from "@/lib/merchantAttendanceAdmin";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Pending = { ownerId: string; siteId: string; command: AttendanceAdminCommand };
type AdminResponse = AttendanceAdminResult & { moduleEnabled: boolean };
type State = { phase: "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: AdminResponse | null; pending: Pending | null; message: string; authorizationEpoch: number };
const READ_AUTHORIZATION_ERRORS: Readonly<Record<string, number>> = {
  unauthorized: 401, attendance_access_denied: 403, employee_password_authentication_required: 403,
  enterprise_management_disabled: 403, forbidden_origin: 403,
};
export class AttendanceAdminClient {
  private state: State = { phase: "loading", result: null, pending: null, message: "正在读取考勤配置…", authorizationEpoch: 0 };
  private listeners = new Set<() => void>();
  private generation = 0;
  private busy = false;
  private disposed = false;
  private query: { view: AttendanceAdminView; cursor: string | null; search: string } = { view: "settings", cursor: null, search: "" };
  readonly storageKey: string;
  constructor(private readonly options: { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; storage: () => StorageLike; randomId?: () => string; timeoutMs?: number }) {
    this.storageKey = `faolla:attendance:config:v1:${options.siteId}:${options.ownerId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const fn of this.listeners) fn(); }
  private current(g: number) { return !this.disposed && g === this.generation; }
  dispose = () => { this.disposed = true; this.generation++; this.busy = false; };
  private restored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey);
    if (raw === null) return null;
    if (raw.length > 4096) throw Error("invalid_pending");
    const value = JSON.parse(raw) as Pending;
    if (!value || Object.keys(value).sort().join() !== "command,ownerId,siteId" || value.ownerId !== this.options.ownerId || value.siteId !== this.options.siteId) throw Error("invalid_pending");
    if (!value.command || Object.keys(value.command).sort().join() !== "expectedVersion,kind,operationId,values") throw Error("invalid_pending");
    const { command } = parseAttendanceAdminCommand({ siteId: value.siteId, ...value.command });
    return { ownerId: value.ownerId, siteId: value.siteId, command };
  }
  initialize = async () => {
    this.disposed = false; this.generation++; this.busy = false;
    try { this.set({ pending: this.restored(), result: null }); }
    catch { this.set({ phase: "blocked", result: null, message: "无法读取本标签页的待确认操作；请恢复浏览器存储后重新读取，不会自动丢弃或重提。" }); return; }
    await this.load();
  };
  private clear() {
    this.options.storage().removeItem(this.storageKey);
    if (this.options.storage().getItem(this.storageKey) !== null) throw Error("pending_not_cleared");
    this.set({ pending: null });
  }
  private settle(result: AdminResponse) {
    const p = this.state.pending;
    if (!p) { this.set({ phase: "ready", result, message: "配置已读取。修改后需要点击保存。" }); return; }
    const receipt = result.receipt;
    if (receipt) {
      if (receipt.version !== p.command.expectedVersion + 1 || receipt.kind !== p.command.kind || receipt.targetId !== (p.command.kind === "settings" ? null : p.command.values.id)) throw Error("receipt_mismatch");
      this.clear(); this.set({ phase: "ready", result, message: `保存已确认 · 配置版本 ${receipt.version}。` });
    } else if (result.version > p.command.expectedVersion) {
      this.clear(); this.set({ phase: "ready", result, message: "未找到原操作，配置已有更新，旧版本操作不能再提交。请核对当前配置后重新编辑。" });
    } else this.set({ phase: "unconfirmed", result, message: "尚未找到保存收据。请核对结果或用原操作编号重试，不要重复新建。" });
  }
  load = async (view = this.query.view, cursor: string | null = this.query.cursor, search = this.query.search) => {
    if (this.busy || this.disposed) return;
    this.busy = true; const g = ++this.generation;
    this.query = { view, cursor, search };
    this.set({ phase: "loading" });
    try {
      const result = await this.request(null);
      if (this.current(g)) this.settle(result);
    } catch (e) {
      if (this.current(g)) this.set({ phase: this.state.pending ? "unconfirmed" : "blocked", result: null, message: attendanceAdminMessage(e instanceof Error ? e.message : ""),
        authorizationEpoch: this.state.authorizationEpoch + (e instanceof AdminReadAuthorizationRejected ? 1 : 0) });
    } finally { if (this.current(g)) this.busy = false; }
  };
  submit = async (change: AttendanceAdminChange, expectedVersion: number) => {
    if (this.busy || this.disposed || this.state.pending || this.state.phase !== "ready" || !this.state.result?.moduleEnabled) return;
    let command: AttendanceAdminCommand;
    try {
      command = parseAttendanceAdminCommand({ siteId: this.options.siteId, ...change, expectedVersion, operationId: (this.options.randomId ?? (() => crypto.randomUUID()))() }).command;
    } catch (e) {
      this.set({ message: attendanceAdminMessage(e instanceof Error ? e.message : "attendance_invalid_request") }); return;
    }
    try {
      if (this.restored()) { await this.initialize(); return; }
      const pending = { siteId: this.options.siteId, ownerId: this.options.ownerId, command };
      const raw = JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey, raw);
      if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_write_failed");
      this.set({ pending });
    } catch {
      this.set({ phase: "blocked", message: "内容或浏览器存储校验失败，尚未发送保存请求。请检查内容并重新读取。" }); return;
    }
    return await this.write(true);
  };
  retry = async () => { if (this.state.phase === "unconfirmed") await this.write(false); };
  private async write(first: boolean) {
    if (this.busy || this.disposed || !this.state.pending) return;
    this.busy = true; const g = ++this.generation;
    this.set({ phase: "saving", message: "正在保存，等待服务器确认…" });
    try {
      const result = await this.request(this.state.pending.command);
      if (this.current(g)) {
        if (!result.receipt) throw Error("receipt_missing");
        const previousResult = this.state.result;
        this.settle(result);
        // A POST returns only settings + receipt. Refresh the current bounded
        // list after confirmation, keeping the user on their management tab.
        if (!this.state.pending && this.query.view !== "settings") {
          const message = this.state.message;
          this.set({ phase: "loading", result: previousResult });
          try {
            const list = await this.request(null);
            if (this.current(g)) this.set({ result: list, phase: "ready", message });
          } catch (e) {
            if (this.current(g)) this.set({ result: null, phase: "blocked", message: `${message} 列表未能刷新，请重新读取；不需要重复保存。`,
              authorizationEpoch: this.state.authorizationEpoch + (e instanceof AdminReadAuthorizationRejected ? 1 : 0) });
          }
        }
        return this.current(g) && !this.state.pending;
      }
    } catch (e) {
      if (this.current(g)) {
        if (first && e instanceof AdminRejected) {
          try { this.clear(); } catch { /* Keep pending when storage cleanup fails. */ }
        }
        this.set({ phase: this.state.pending ? "unconfirmed" : "blocked", result: null, message: attendanceAdminMessage(e instanceof Error ? e.message : "") });
      }
    } finally { if (this.current(g)) this.busy = false; }
  }
  private async request(command: AttendanceAdminCommand | null): Promise<AdminResponse> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error("timeout")); }, this.options.timeoutMs ?? 12000); });
    const run = async () => {
      const params = new URLSearchParams({ siteId: this.options.siteId, view: this.query.view, search: this.query.search });
      if (this.query.cursor) params.set("cursor", this.query.cursor);
      const operationId = this.state.pending?.command.operationId ?? null;
      if (operationId) params.set("operationId", operationId);
      const response = await this.options.apiFetch(`/api/merchant-enterprise/attendance/admin${command ? "" : `?${params}`}`, {
        method: command ? "POST" : "GET", cache: "no-store", signal: controller.signal,
        ...(command ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: this.options.siteId, ...command }) } : {}),
      });
      if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw Error("invalid_response");
      const reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
      let text = "", bytes = 0; const decoder = new TextDecoder();
      try { while (true) { const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 32768) { await reader.cancel(); throw Error("oversized_response"); } text += decoder.decode(value, { stream: true });
      } } finally { reader.releaseLock(); }
      const body = JSON.parse(text + decoder.decode());
      if (!response.ok || body.ok !== true) {
        // Signal an obsolete child view, not a permanent ban on independent
        // child reads. Keep this separate from POST rejection/pending rules.
        if (command === null && !controller.signal.aborted && body && typeof body === "object" && !Array.isArray(body)
          && Object.keys(body).sort().join() === "error,ok" && body.ok === false && typeof body.error === "string"
          && Object.hasOwn(READ_AUTHORIZATION_ERRORS, body.error) && READ_AUTHORIZATION_ERRORS[body.error] === response.status)
          throw new AdminReadAuthorizationRejected(body.error);
        if (typeof body.error === "string" && Object.hasOwn(ATTENDANCE_ADMIN_ERRORS, body.error) && ATTENDANCE_ADMIN_ERRORS[body.error].status === response.status) throw new AdminRejected(body.error);
        throw Error("attendance_unavailable");
      }
      if (typeof body.moduleEnabled !== "boolean") throw Error("invalid_response");
      return { ...parseAttendanceAdminResult(body, { siteId: this.options.siteId, view: command ? "settings" : this.query.view, operationId }), moduleEnabled: body.moduleEnabled };
    };
    try { return await Promise.race([run(), deadline]); } finally { clearTimeout(timer); }
  }
}
class AdminRejected extends Error {}
class AdminReadAuthorizationRejected extends Error {}
