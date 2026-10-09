import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import { parseLeaveBody, parseLeaveCommand, parseLeaveResponse, sameLeaveCommand, leaveQueryString, LEAVE_ERRORS,
  type LeaveCommand, type LeaveDecision, type LeaveQuery, type LeaveResponse } from "./merchantAttendanceLeave";
export type LeaveClientOptions = { siteId: string; apiFetch: AttendanceApiFetch; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number } &
  ({ access: "self"; employeeId: string } | { access: "owner"; actorId: string });
type Pending = { siteId: string; access: "self" | "owner"; actorId: string; employeeId: string | null; command: LeaveCommand };
type State = { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: LeaveResponse | null; pending: Pending | null; message: string };
const hidden = () => typeof document !== "undefined" && document.hidden;
const definitive = new Set(["attendance_invalid_request", "attendance_version_conflict", "attendance_leave_closed", "attendance_leave_overlap", "attendance_leave_outside_employment", "attendance_platform_paused"]);
async function strictLeaveFetch(apiFetch: AttendanceApiFetch, url: string, init?: RequestInit): Promise<Response> {
  const response = await apiFetch(url, init);
  if (response.ok) return response;
  if (response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Error("invalid_response");
  const reader = response.body?.getReader(); if (!reader) throw Error("invalid_response");
  const cancel = () => { void reader.cancel().catch(() => {}); };
  init?.signal?.addEventListener("abort", cancel, { once: true });
  let text = "", size = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    if (init?.signal?.aborted) throw Error("aborted");
    while (true) {
      const { done, value } = await reader.read();
      if (init?.signal?.aborted) throw Error("aborted");
      if (done) break;
      size += value.byteLength; if (size > 4096) throw Error("oversized_error");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join() !== "error,ok"
      || body.ok !== false || typeof body.error !== "string") throw Error("invalid_error_envelope");
    return new Response(text, { status: response.status, headers: response.headers });
  } finally {
    init?.signal?.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

export class AttendanceLeaveClient {
  private state: State = { phase: "idle", result: null, pending: null, message: "尚未读取请假申请。" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private query: LeaveQuery;
  readonly storageKey: string;
  constructor(private readonly options: LeaveClientOptions) {
    const anchor = attendanceSelfUuid(options.access === "self" ? options.employeeId : options.actorId);
    this.query = { siteId: attendanceSelfSite(options.siteId), access: options.access, requestId: null, operationId: null, beforeAt: null, beforeId: null };
    this.storageKey = `faolla:attendance:leave:v1:${options.siteId}:${options.access}:${anchor}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  private restored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey);
    if (raw === null) return null;
    if (raw.length > 8192) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== "access,actorId,command,employeeId,siteId"
      || p.siteId !== this.options.siteId || p.access !== this.options.access) throw Error("invalid_pending");
    attendanceSelfUuid(p.actorId);
    if (this.options.access === "self" ? p.employeeId !== this.options.employeeId : p.employeeId !== null || p.actorId !== this.options.actorId) throw Error("pending_identity");
    const command = parseLeaveCommand(p.command);
    parseLeaveBody({ query: { ...this.query, beforeAt: null, beforeId: null, operationId: null, requestId: command.action === "submit" ? null : command.requestId }, command });
    return { siteId: p.siteId, access: p.access, actorId: p.actorId, employeeId: p.employeeId, command };
  }
  private samePending() { if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("pending_changed"); }
  private clear() {
    this.samePending(); this.options.storage().removeItem(this.storageKey);
    if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_error");
    this.set({ pending: null });
  }
  pause = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "请假申请已隐藏；已发送操作不撤销，回来后请查原收据。" });
  };
  initialize = async () => {
    if (this.controller || hidden()) return;
    try {
      const pending = this.restored();
      this.set({ pending, result: null });
      if (pending) this.query = { ...this.query, beforeAt: null, beforeId: null, requestId: pending.command.action === "submit" ? null : pending.command.requestId, operationId: null };
      await this.request(null);
    } catch { this.set({ phase: "blocked", result: null, message: "待确认存储异常；不会覆盖或自动提交，请保留原编号核验。" }); }
  };
  load = async () => {
    if (this.controller || hidden() || this.state.pending) return;
    this.query = { ...this.query, requestId: null, operationId: null, beforeAt: null, beforeId: null }; await this.initialize();
  };
  next = async () => {
    const cursor = this.state.result?.nextCursor;
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !cursor) return;
    this.query = { ...this.query, requestId: null, operationId: null, beforeAt: cursor.at, beforeId: cursor.id }; await this.request(null);
  };
  detail = async (requestId: string) => {
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready") return;
    try { this.query = { ...this.query, requestId: attendanceSelfUuid(requestId), operationId: null, beforeAt: null, beforeId: null }; }
    catch { return; }
    await this.request(null);
  };
  submit = async (input: { reason: string; startAt: string; endAt: string }) => {
    const context = this.state.result;
    if (this.options.access !== "self" || !context?.canSubmit || !context.workerId) return;
    await this.write(() => ({ operationId: this.operationId(), action: "submit", reason: input.reason.trim(), expectedWorkerId: context.workerId!,
      expectedSettingsVersion: context.settingsVersion, timeZone: context.timeZone, startAt: input.startAt, endAt: input.endAt }));
  };
  decide = async (action: LeaveDecision, reason: string) => {
    const detail = this.state.result?.detail;
    if (!detail) return;
    const allowed = action === "withdraw" ? this.options.access === "self" && detail.canWithdraw
      : this.options.access === "owner" && (action === "approve" ? detail.canApprove : action === "reject" ? detail.canReject : action === "cancel" && detail.canCancel);
    if (!allowed) return;
    await this.write(() => ({ operationId: this.operationId(), action, reason: reason.trim(), requestId: detail.requestId, expectedRevision: detail.revision }));
  };
  private operationId() { return (this.options.randomId ?? (() => crypto.randomUUID()))(); }
  private async write(make: () => LeaveCommand) {
    const result = this.state.result;
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !result?.moduleEnabled) return;
    try {
      if (this.restored()) { await this.initialize(); return; }
      const command = parseLeaveCommand(make()), query = { ...this.query, requestId: command.action === "submit" ? null : command.requestId, beforeAt: null, beforeId: null, operationId: null };
      parseLeaveBody({ query, command });
      const pending: Pending = { siteId: this.options.siteId, access: this.options.access, actorId: result.actorId, employeeId: result.employeeId, command };
      const raw = JSON.stringify(pending); this.options.storage().setItem(this.storageKey, raw);
      if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_error");
      this.set({ pending }); this.query = query; await this.request(command);
    } catch { this.set({ result: null, phase: "blocked", message: "请假内容或待确认存储异常；不会自动提交，请重新读取并核对原编号。" }); }
  }
  retry = async () => {
    if (this.controller || hidden() || !this.state.pending || this.state.phase !== "unconfirmed") return;
    // A deliberate retry always looks up the old receipt first; it never allocates a new operation.
    if (await this.request(null) && this.state.pending && this.state.result?.moduleEnabled) await this.request(this.state.pending.command);
  };
  private async request(command: LeaveCommand | null): Promise<boolean> {
    if (hidden()) { this.pause(); return false; }
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ result: null, phase: command ? "saving" : "loading" });
    try {
      this.samePending();
      const query = { ...this.query, operationId: command ? null : this.state.pending?.command.operationId ?? null };
      if (query.operationId) { query.beforeAt = null; query.beforeId = null; }
      const raw = await attendanceManagementRequest((url, init) => strictLeaveFetch(this.options.apiFetch, url, init),
        `/api/merchant-enterprise/attendance/leave${command ? "" : `?${leaveQueryString(query)}`}`,
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, command }) } : { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs ?? 12000, maxBytes: 131072, errorStatuses: LEAVE_ERRORS });
      if (g !== this.generation) return false;
      if (hidden()) { this.pause(); return false; }
      this.samePending();
      const expectedActorId = this.state.pending?.actorId ?? (this.options.access === "owner" ? this.options.actorId : undefined);
      const result = parseLeaveResponse(raw, query, command, expectedActorId), pending = this.state.pending;
      if (this.options.access === "self" && result.employeeId !== this.options.employeeId) throw Error("employee_changed");
      if (pending && (pending.employeeId !== result.employeeId || pending.actorId !== result.actorId)) throw Error("actor_changed");
      if (pending && result.receipt) {
        if (!sameLeaveCommand(pending.command, result.receipt.command)) throw Error("receipt_mismatch");
        this.clear();
      }
      this.set({ result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending
        ? "操作结果待确认；请查原收据，或使用原编号明确重试。"
        : result.receipt ? "请假操作已确认；未改动打卡、工资或假期余额。" : "已读取请假记录；批准只记录请假时段，不限制实际打卡。" });
      return true;
    } catch (error) {
      if (g !== this.generation) return false;
      if (command && error instanceof AttendanceManagementRejected && definitive.has(error.message)) {
        try { this.clear(); } catch { /* Keep substituted/uncertain storage untouched. */ }
      }
      const code = error instanceof Error ? error.message : "";
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message:
        code === "attendance_leave_overlap" ? "此时段与已批准请假重叠，未批准；请重新读取核对。"
          : code === "attendance_leave_outside_employment" ? "请假时段未完整覆盖在任职期内，未保存；请联系负责人核验。"
            : code === "attendance_version_conflict" || code === "attendance_leave_closed" ? "申请或设置已变化；请重新读取，不会覆盖现有记录。"
              : "无法可靠确认结果，已隐藏请假内容；请核对当前身份及原编号，不会自动重发。" });
      return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}

