import { ATTENDANCE_LOCATION_REVIEW_ERRORS, attendanceLocationReviewQueryString, parseAttendanceLocationReviewCommand, parseAttendanceLocationReviewQuery, parseAttendanceLocationReviewResult,
  type AttendanceLocationReviewCommand, type AttendanceLocationReviewQuery, type AttendanceLocationReviewResult, type AttendanceReviewOutcome } from "./merchantAttendanceLocationReview";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";

type ListQuery = Extract<AttendanceLocationReviewQuery, { mode: "list" }>;
type ListResult = Extract<AttendanceLocationReviewResult, { mode: "list" }> & { moduleEnabled: boolean };
type DetailResult = Extract<AttendanceLocationReviewResult, { mode: "detail" }> & { moduleEnabled: boolean };
type ClientOptions = { siteId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number };
async function request(options: ClientOptions, query: AttendanceLocationReviewQuery, command: AttendanceLocationReviewCommand | null, signal: AbortSignal) {
  const body = await attendanceManagementRequest(options.apiFetch, `/api/merchant-enterprise/attendance/location-reviews${command ? "" : `?${attendanceLocationReviewQueryString(query)}`}`,
    { method: command ? "POST" : "GET", ...(command ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: options.siteId, ...command }) } : {}) },
    { signal, maxBytes: 65536, timeoutMs: options.timeoutMs, errorStatuses: ATTENDANCE_LOCATION_REVIEW_ERRORS });
  return { ...parseAttendanceLocationReviewResult(body, command ? { siteId: options.siteId, mode: "detail", eventId: command.eventId, operationId: command.operationId } : query), moduleEnabled: body.moduleEnabled as boolean };
}
export function attendanceReviewMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "attendance_access_denied") return "当前负责人权限无效，请重新登录核验；不会保留旧详情。";
  if (code === "attendance_review_not_found") return "未找到本企业可核查的定位异常；不显示其他企业或普通打卡记录。";
  if (code === "attendance_version_conflict") return "该异常已有新的核查记录，请重新读取后再处理。";
  if (code === "attendance_invalid_request") return "请检查日期、核查结论和理由；已在待核查状态的记录不能重复重新打开。";
  if (code === "attendance_rate_limited") return "操作较频繁，请稍后手动重试。";
  return "暂时无法确认结果，请重新读取；不自动重复提交核查。";
}
export class AttendanceLocationReviewListClient {
  private state: { phase: "idle" | "loading" | "ready" | "blocked"; query: ListQuery | null; result: ListResult | null; message: string } = {
    phase: "idle", query: null, result: null, message: "选择日期后查询定位异常。" };
  private generation = 0; private controller: AbortController | null = null; private listeners = new Set<() => void>();
  constructor(private readonly options: ClientOptions) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  invalidate = () => { this.generation++; this.controller?.abort(); this.controller = null; this.set({ phase: "idle", result: null, message: "返回后请重新查询，重新核验负责人权限。" }); };
  load = async (input: ListQuery) => {
    this.invalidate(); const g = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", query: null });
    try {
      const query = parseAttendanceLocationReviewQuery(`https://local.invalid/?${attendanceLocationReviewQueryString(input)}`);
      if (query.mode !== "list" || query.siteId !== this.options.siteId) throw Error("attendance_invalid_request");
      this.set({ query }); const result = await request(this.options, query, null, controller.signal);
      if (result.mode !== "list") throw Error("invalid_response");
      if (g === this.generation) this.set({ phase: "ready", result, message: `本批检查 ${result.scanned} 条打卡，匹配 ${result.items.length} 条定位异常。${result.nextCursor ? "仍有下一批，空结果不代表整个日期范围没有异常。" : "已到本次查询末尾。"}` });
    } catch (error) { if (g === this.generation) this.set({ phase: "blocked", result: null, message: attendanceReviewMessage(error) }); }
    finally { if (g === this.generation) this.controller = null; }
  };
  next = async () => { const { phase, query, result } = this.state; if (phase === "ready" && query && result?.nextCursor) await this.load({ ...query, asOf: result.asOf, cursorAt: result.nextCursor.occurredAt, cursorId: result.nextCursor.id }); };
  refresh = async () => { if (this.state.query) await this.load({ ...this.state.query, asOf: null, cursorAt: null, cursorId: null }); };
}

type Pending = { siteId: string; ownerId: string; command: AttendanceLocationReviewCommand };
export class AttendanceLocationReviewCaseClient {
  private state: { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; eventId: string | null; result: DetailResult | null; pending: Pending | null; message: string } = {
    phase: "idle", eventId: null, result: null, pending: null, message: "点击异常查看详情。" };
  private generation = 0; private controller: AbortController | null = null; private paused = false; private listeners = new Set<() => void>();
  readonly storageKey: string;
  constructor(private readonly options: ClientOptions & { ownerId: string; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string }) {
    this.storageKey = `faolla:attendance:location-review:v1:${options.siteId}:${options.ownerId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private restored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey); if (raw === null) return null;
    if (raw.length > 4096) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || Object.keys(p).sort().join() !== "command,ownerId,siteId" || p.ownerId !== this.options.ownerId || p.siteId !== this.options.siteId
      || !p.command || Object.keys(p.command).sort().join() !== "eventId,expectedRevision,note,operationId,outcome") throw Error("invalid_pending");
    const { command } = parseAttendanceLocationReviewCommand({ siteId: p.siteId, ...p.command });
    return { siteId: p.siteId, ownerId: p.ownerId, command };
  }
  private clear() {
    if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict");
    this.options.storage().removeItem(this.storageKey);
    if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_not_cleared");
    this.set({ pending: null });
  }
  pause = () => { this.paused = true; this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "已停止等待，不代表撤销已发送的核查记录。请重新读取确认。" }); };
  initialize = async () => {
    this.generation++; this.controller?.abort(); this.controller = null; this.paused = false;
    try { const pending = this.restored(); this.set({ pending, result: null, eventId: pending?.command.eventId ?? this.state.eventId, phase: "idle" }); }
    catch { this.set({ phase: "blocked", result: null, message: "待确认记录或存储异常，不会覆盖或丢弃原操作。" }); return; }
    if (this.state.eventId) await this.readOrWrite(null, false);
  };
  select = async (eventId: string) => {
    if (this.controller || this.state.pending) return;
    // An explicit selection starts a new authorized read after a hidden/failed
    // list cleared the old view; it never resumes or resends a pending write.
    try { attendanceSelfUuid(eventId); this.paused = false; this.set({ eventId, result: null }); await this.readOrWrite(null, false); }
    catch (e) { this.set({ result: null, phase: "blocked", message: attendanceReviewMessage(e) }); }
  };
  submit = async (selected: AttendanceReviewOutcome, note: string, expectedRevision: number) => {
    if (this.paused || this.controller || this.state.pending || this.state.phase !== "ready" || !this.state.result || !this.state.eventId) return;
    try {
      if (this.restored()) { await this.initialize(); return; }
      const { command } = parseAttendanceLocationReviewCommand({ siteId: this.options.siteId, eventId: this.state.eventId, operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(), expectedRevision, outcome: selected, note });
      if (selected === "reopen" && this.state.result.item.reviewState === "pending") throw Error("attendance_invalid_request");
      const pending = { siteId: this.options.siteId, ownerId: this.options.ownerId, command }, raw = JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey, raw); if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_write_failed");
      this.set({ pending }); await this.readOrWrite(command, true);
    } catch (e) { this.set({ phase: "blocked", result: null, message: attendanceReviewMessage(e) }); }
  };
  retry = async () => {
    if (this.paused || this.controller || !this.state.pending || this.state.phase !== "unconfirmed") return;
    if (await this.readOrWrite(null, false) && this.state.pending && this.state.phase === "unconfirmed") await this.readOrWrite(this.state.pending.command, false);
  };
  private async readOrWrite(command: AttendanceLocationReviewCommand | null, first: boolean): Promise<boolean> {
    const eventId = this.state.eventId; if (!eventId) return false;
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: command ? "saving" : "loading", result: null });
    try {
      if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict");
      const result = await request(this.options, { siteId: this.options.siteId, mode: "detail", eventId, operationId: this.state.pending?.command.operationId ?? null }, command, controller.signal);
      if (g !== this.generation || this.paused) return false;
      if (result.mode !== "detail" || command && !result.receipt) throw Error("invalid_response");
      const pending = this.state.pending;
      if (pending && result.receipt && (result.receipt.revision !== pending.command.expectedRevision + 1 || result.receipt.outcome !== pending.command.outcome || result.receipt.note !== pending.command.note)) throw Error("receipt_mismatch");
      const confirmed = !!pending && !!result.receipt;
      if (pending && (result.receipt || result.item.reviewRevision > pending.command.expectedRevision)) this.clear();
      this.set({ phase: this.state.pending ? "unconfirmed" : "ready", result, message: this.state.pending ? "原核查结果尚未确认，可查询收据或用原编号明确重试。"
        : confirmed ? `已确认核查版本 ${result.receipt!.revision}。原始打卡未修改；请刷新列表查看新状态。` : "已读取当前核查详情。仅记录核查意见，不批准工资或改写打卡。" });
      return true;
    } catch (e) {
      if (g !== this.generation || this.paused) return false;
      if (command && first && e instanceof AttendanceManagementRejected) { try { this.clear(); } catch { /* Preserve storage conflict. */ } }
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: attendanceReviewMessage(e) }); return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
