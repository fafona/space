import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import { parseCalendarBody, parseCalendarCommand, parseCalendarQuery, parseCalendarResponse, sameCalendarCommand, calendarQueryString, calendarDateRange, CALENDAR_ERRORS,
  type CalendarCommand, type CalendarKind, type CalendarQuery, type CalendarResponse } from "./merchantAttendanceCalendar";
export type CalendarClientOptions = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number };
type Pending = { siteId: string; ownerId: string; query: CalendarQuery; command: CalendarCommand };
type State = { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: CalendarResponse | null; pending: Pending | null; message: string };
const hidden = () => typeof document !== "undefined" && document.hidden;
const definitive = new Set(["attendance_invalid_request", "attendance_version_conflict", "attendance_calendar_closed", "attendance_calendar_location_inactive", "attendance_platform_paused"]);
async function strictCalendarFetch(apiFetch: AttendanceApiFetch, url: string, init?: RequestInit): Promise<Response> {
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
export class AttendanceCalendarClient {
  private state: State = { phase: "idle", result: null, pending: null, message: "尚未读取节假日／停业日。" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private query: CalendarQuery;
  readonly storageKey: string;
  constructor(private readonly options: CalendarClientOptions) {
    const ownerId = attendanceSelfUuid(options.ownerId);
    this.query = { siteId: attendanceSelfSite(options.siteId), locationId: null, fromDate: null, throughDate: null, entryId: null, operationId: null, beforeAt: null, beforeId: null };
    this.storageKey = "faolla:attendance:calendar:v1:" + options.siteId + ":" + ownerId;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  private restored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey);
    if (raw === null) return null;
    if (raw.length > 8192) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== "command,ownerId,query,siteId"
      || p.siteId !== this.options.siteId || p.ownerId !== this.options.ownerId) throw Error("invalid_pending");
    const { query, command } = parseCalendarBody({ query: p.query, command: p.command });
    if (query.siteId !== this.options.siteId) throw Error("pending_identity");
    return { siteId: p.siteId, ownerId: p.ownerId, query, command };
  }
  private samePending() { if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("pending_changed"); }
  private clear() {
    this.samePending(); this.options.storage().removeItem(this.storageKey);
    if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_error");
    this.set({ pending: null });
  }
  pause = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "日历已隐藏；已发送操作不撤销，回来后请查原收据。" });
  };
  initialize = async () => this.initializeQuery({ ...this.query, locationId: null, fromDate: null, throughDate: null, entryId: null, operationId: null, beforeAt: null, beforeId: null });
  private async initializeQuery(query: CalendarQuery) {
    if (this.controller || hidden()) return;
    try {
      const pending = this.restored();
      this.set({ pending, result: null });
      this.query = pending?.query ?? query;
      await this.request(null);
    } catch { this.set({ phase: "blocked", result: null, message: "待确认存储异常；不会覆盖或自动提交，请保留原编号核验。" }); }
  }
  context = async (locationId: string | null) => {
    if (this.controller || hidden() || this.state.pending) return;
    try { this.query = parseCalendarQuery({ ...this.query, locationId, fromDate: null, throughDate: null, entryId: null, operationId: null, beforeAt: null, beforeId: null }); }
    catch { this.pause(); return; }
    await this.initializeQuery(this.query);
  };
  load = async (input: { fromDate: string; throughDate: string }) => {
    if (this.controller || hidden() || this.state.pending) return;
    try {
      const range = calendarDateRange(input.fromDate, input.throughDate);
      this.query = { ...this.query, fromDate: range.fromDate, throughDate: range.throughDate, entryId: null, operationId: null, beforeAt: null, beforeId: null };
    } catch { this.pause(); return; }
    await this.initializeQuery(this.query);
  };
  next = async () => {
    const cursor = this.state.result?.nextCursor;
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !cursor) return;
    this.query = { ...this.query, entryId: null, operationId: null, beforeAt: cursor.at, beforeId: cursor.id }; await this.request(null);
  };
  detail = async (entryId: string) => {
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready") return;
    try { this.query = { ...this.query, entryId: attendanceSelfUuid(entryId), fromDate: null, throughDate: null, operationId: null, beforeAt: null, beforeId: null }; }
    catch { return; }
    await this.request(null);
  };
  create = async (input: { kind: CalendarKind; title: string; fromDate: string; throughDate: string; reason: string }) => {
    const context = this.state.result;
    if (!context?.canCreate) return;
    await this.write(() => ({ operationId: this.operationId(), action: "create", reason: input.reason.trim(), kind: input.kind, title: input.title.trim(),
      fromDate: input.fromDate, throughDate: input.throughDate, expectedSettingsVersion: context.settingsVersion, timeZone: context.timeZone,
      locationId: context.locationId, expectedLocationVersion: context.locationVersion }));
  };
  cancel = async (reason: string) => {
    const detail = this.state.result?.detail;
    if (!detail?.canCancel || detail.revision !== 1) return;
    await this.write(() => ({ operationId: this.operationId(), action: "cancel", reason: reason.trim(), entryId: detail.entryId, expectedRevision: 1 }));
  };
  private operationId() { return (this.options.randomId ?? (() => crypto.randomUUID()))(); }
  private async write(make: () => CalendarCommand) {
    const result = this.state.result;
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !result?.moduleEnabled) return;
    try {
      if (this.restored()) { await this.initialize(); return; }
      const command = parseCalendarCommand(make()), query = { ...this.query, entryId: command.action === "create" ? null : command.entryId, fromDate: null, throughDate: null, beforeAt: null, beforeId: null, operationId: null };
      parseCalendarBody({ query, command });
      const pending: Pending = { siteId: this.options.siteId, ownerId: this.options.ownerId, query, command };
      const raw = JSON.stringify(pending); this.options.storage().setItem(this.storageKey, raw);
      if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_error");
      this.set({ pending }); this.query = query; await this.request(command);
    } catch { this.set({ result: null, phase: "blocked", message: "日历内容或待确认存储异常；不会自动提交，请重新读取并核对原编号。" }); }
  }
  retry = async () => {
    if (this.controller || hidden() || !this.state.pending || this.state.phase !== "unconfirmed") return;
    // Explicit retry always looks up the original receipt before attempting the identical POST.
    if (await this.request(null) && this.state.pending && this.state.result?.moduleEnabled) await this.request(this.state.pending.command);
  };
  private async request(command: CalendarCommand | null): Promise<boolean> {
    if (hidden()) { this.pause(); return false; }
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ result: null, phase: command ? "saving" : "loading" });
    try {
      this.samePending();
      const query = { ...this.query, operationId: command ? null : this.state.pending?.command.operationId ?? null };
      const suffix = command ? "" : "?" + calendarQueryString(query);
      const raw = await attendanceManagementRequest((url, init) => strictCalendarFetch(this.options.apiFetch, url, init),
        "/api/merchant-enterprise/attendance/calendar" + suffix,
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, command }) } : { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs ?? 12000, maxBytes: 131072, errorStatuses: CALENDAR_ERRORS });
      if (g !== this.generation) return false;
      if (hidden()) { this.pause(); return false; }
      this.samePending();
      const result = parseCalendarResponse(raw, query, command, this.options.ownerId), pending = this.state.pending;
      if (pending && result.receipt) {
        if (!sameCalendarCommand(pending.command, result.receipt.command)) throw Error("receipt_mismatch");
        this.clear();
      }
      this.set({ result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending
        ? "操作结果待确认；请查原收据，或使用原编号明确重试。"
        : result.receipt ? "日历操作已确认；未改动排班、预约、打卡或工资。" : "已读取日历；这些日期只作提示，不限制实际打卡。" });
      return true;
    } catch (error) {
      if (g !== this.generation) return false;
      if (hidden()) { this.pause(); return false; }
      if (command && error instanceof AttendanceManagementRejected && definitive.has(error.message)) {
        try { this.clear(); } catch { /* Keep substituted or uncertain storage untouched. */ }
      }
      const code = error instanceof Error ? error.message : "";
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message:
        code === "attendance_calendar_location_inactive" ? "门店已停用；不能新增日期，历史记录仍可查阅。"
          : code === "attendance_version_conflict" || code === "attendance_calendar_closed" ? "日历或设置已变化；请重新读取，不会覆盖现有记录。"
            : "无法可靠确认结果，已隐藏日历内容；请核对当前身份及原编号，不会自动重发。" });
      return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
