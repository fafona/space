import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import { notificationQueryString, parseNotificationQuery, parseNotificationResponse, NOTIFICATION_ERRORS,
  type NotificationCommand, type NotificationQuery, type NotificationsResponse } from "./merchantAttendanceLeaveNotifications";

export type LeaveNotificationsClientOptions = { siteId: string; employeeId: string; apiFetch: AttendanceApiFetch;
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; timeoutMs?: number };
type Pending = { siteId: string; employeeId: string; actorId: string; workerId: string; notificationId: string };
type State = { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: NotificationsResponse | null; pending: Pending | null; message: string };
const hidden = () => typeof document !== "undefined" && document.hidden;
// Validate the small error envelope before treating any refusal as definitive.
async function strictFetch(apiFetch: AttendanceApiFetch, url: string, init?: RequestInit): Promise<Response> {
  const response = await apiFetch(url, init); if (response.ok) return response;
  if (response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Error("invalid_response");
  const reader = response.body?.getReader(); if (!reader) throw Error("invalid_response");
  const cancel = () => { void reader.cancel().catch(() => {}); }; init?.signal?.addEventListener("abort", cancel, { once: true });
  let text = "", size = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    if (init?.signal?.aborted) throw Error("aborted");
    while (true) { const { done, value } = await reader.read(); if (init?.signal?.aborted) throw Error("aborted"); if (done) break;
      size += value.byteLength; if (size > 4096) throw Error("oversized_error"); text += decoder.decode(value, { stream: true }); }
    text += decoder.decode(); const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join() !== "error,ok"
      || body.ok !== false || typeof body.error !== "string") throw Error("invalid_error_envelope");
    return new Response(text, { status: response.status, headers: response.headers });
  } finally { init?.signal?.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class AttendanceLeaveNotificationsClient {
  private state: State = { phase: "idle", result: null, pending: null, message: "尚未读取请假结果通知。" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private query: NotificationQuery;
  private actorId: string | undefined;
  private workerId: string | null | undefined;
  readonly storageKey: string;
  constructor(private readonly options: LeaveNotificationsClientOptions) {
    attendanceSelfSite(options.siteId); attendanceSelfUuid(options.employeeId);
    this.query = this.base(); this.storageKey = `faolla:attendance:leave-notifications:v1:${options.siteId}:${options.employeeId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  private base(): NotificationQuery { return { siteId: this.options.siteId, expectedEmployeeId: this.options.employeeId, expectedWorkerId: null, notificationId: null, beforeAt: null, beforeId: null }; }
  private restored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey); if (raw === null) return null;
    if (raw.length > 2048) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== "actorId,employeeId,notificationId,siteId,workerId"
      || p.siteId !== this.options.siteId || p.employeeId !== this.options.employeeId) throw Error("invalid_pending");
    return { siteId: attendanceSelfSite(p.siteId), employeeId: attendanceSelfUuid(p.employeeId), actorId: attendanceSelfUuid(p.actorId),
      workerId: attendanceSelfUuid(p.workerId), notificationId: attendanceSelfUuid(p.notificationId) };
  }
  private samePending() { if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("pending_changed"); }
  private clear() {
    this.samePending(); this.options.storage().removeItem(this.storageKey);
    if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_error");
    this.set({ pending: null });
  }
  pause = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: this.state.pending ? "unconfirmed" : "idle", result: null, message: "通知页面已隐藏；回来后先核对待确认的已读状态。" });
  };
  initialize = async () => {
    if (this.controller || hidden()) return;
    try {
      const pending = this.restored();
      this.set({ pending, result: null }); this.query = this.base();
      if (pending) this.query = { ...this.query, expectedWorkerId: pending.workerId, notificationId: pending.notificationId };
      else if (this.workerId) this.query.expectedWorkerId = this.workerId;
      await this.request(null);
    } catch { this.set({ phase: "blocked", result: null, message: "待确认存储异常；不会覆盖原通知编号或自动提交。" }); }
  };
  list = async () => { if (!this.state.pending) await this.initialize(); };
  next = async () => {
    const cursor = this.state.result?.nextCursor;
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !cursor || !this.workerId) return;
    this.query = { ...this.base(), expectedWorkerId: this.workerId, beforeAt: cursor.at, beforeId: cursor.id }; await this.request(null);
  };
  detail = async (notificationId: string) => {
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !this.workerId
      || !this.state.result?.items.some(item => item.notificationId === notificationId)) return;
    this.query = parseNotificationQuery({ ...this.base(), expectedWorkerId: this.workerId, notificationId }); await this.request(null);
  };
  markRead = async () => {
    const result = this.state.result, detail = result?.detail;
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !result?.moduleEnabled || !result.workerId || !detail || detail.readAt !== null) return;
    try {
      if (this.restored()) { await this.initialize(); return; }
      const pending: Pending = { siteId: this.options.siteId, employeeId: this.options.employeeId, actorId: result.actorId, workerId: result.workerId, notificationId: detail.notificationId };
      const raw = JSON.stringify(pending); this.options.storage().setItem(this.storageKey, raw);
      if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_error");
      this.set({ pending }); this.query = { ...this.base(), expectedWorkerId: pending.workerId, notificationId: pending.notificationId };
      await this.request({ action: "mark_read", notificationId: pending.notificationId });
    } catch { this.set({ phase: "blocked", result: null, message: "无法可靠保存待确认通知编号；不会提交，请重新读取。" }); }
  };
  retry = async () => {
    if (this.controller || hidden() || this.state.phase !== "unconfirmed" || !this.state.pending) return;
    if (await this.request(null) && this.state.pending && this.state.result?.moduleEnabled) await this.request({ action: "mark_read", notificationId: this.state.pending.notificationId });
  };
  private async request(command: NotificationCommand | null): Promise<boolean> {
    if (hidden()) { this.pause(); return false; }
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ result: null, phase: command ? "saving" : "loading" });
    try {
      this.samePending();
      const raw = await attendanceManagementRequest((url, init) => strictFetch(this.options.apiFetch, url, init),
        "/api/merchant-enterprise/attendance/leave-notifications" + (command ? "" : "?" + notificationQueryString(this.query)),
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: this.query, command }) } : { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs ?? 12000, maxBytes: 131072, errorStatuses: NOTIFICATION_ERRORS });
      if (g !== this.generation) return false;
      if (hidden()) { this.pause(); return false; }
      this.samePending();
      const pending = this.state.pending, result = parseNotificationResponse(raw, this.query, command, pending?.actorId ?? this.actorId);
      if (this.actorId !== undefined && result.actorId !== this.actorId || this.workerId !== undefined && result.workerId !== this.workerId) throw Error("identity_changed");
      if (pending && (pending.employeeId !== result.employeeId || pending.workerId !== result.workerId || pending.notificationId !== result.detail?.notificationId)) throw Error("pending_identity_changed");
      this.actorId = result.actorId; this.workerId = result.workerId;
      if (pending && result.detail && result.detail.readAt !== null) this.clear();
      this.set({ result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending
        ? "此通知仍未标为已读；如需继续，请明确使用原通知编号重试。"
        : result.detail?.readAt ? "该通知已标为已读；已读不代表同意处理结果。"
          : result.workerId === null ? "当前没有关联考勤档案，暂无可读取通知。" : "已读取请假结果；仅显示通知捕获开启期间的新处理结果。" });
      return true;
    } catch (error) {
      if (g !== this.generation) return false;
      if (hidden()) { this.pause(); return false; }
      const definitive = command && error instanceof AttendanceManagementRejected && ["attendance_platform_paused", "attendance_invalid_request"].includes(error.message);
      if (definitive) { try { this.clear(); } catch { /* Preserve an unknown or replaced record. */ } }
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: this.state.pending
        ? "尚未确认已读结果；原通知编号已保留，请重新读取核对，不会自动重发。"
        : error instanceof AttendanceManagementRejected && error.message === "attendance_platform_paused" ? "平台暂停中，暂不能首次标记已读；仍可读取通知。"
          : "通知读取或身份核验失败，已清除显示内容；请重新读取，必要时关闭后重新登录。" });
      return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
