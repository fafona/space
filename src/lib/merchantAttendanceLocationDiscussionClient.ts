import { DISCUSSION_ERRORS, discussionQueryString, parseDiscussionQuery, parseDiscussionCommand, parseDiscussionResult,
  type DiscussionAccess, type DiscussionQuery, type DiscussionCommand, type DiscussionResult } from "./merchantAttendanceLocationDiscussion";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
type ListQuery = Extract<DiscussionQuery, { mode: "list" }>;
type DetailQuery = Extract<DiscussionQuery, { mode: "detail" }>;
type Result = DiscussionResult & { moduleEnabled: boolean };
type Pending = { actorId: string; query: DetailQuery; command: DiscussionCommand };
type State = { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; list: Extract<Result, { mode: "list" }> | null;
  detail: Extract<Result, { mode: "detail" }> | null; query: DiscussionQuery | null; pending: Pending | null; message: string };
export class AttendanceDiscussionClient {
  private state: State = { phase: "idle", list: null, detail: null, query: null, pending: null, message: "选择日期查询；不会自动请求定位。" };
  private generation = 0; private controller: AbortController | null = null; private paused = false; private listeners = new Set<() => void>();
  readonly storageKey: string;
  constructor(private readonly options: { siteId: string; access: DiscussionAccess; actorId: string; apiFetch: AttendanceApiFetch;
    storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number }) {
    this.storageKey = `faolla:attendance:discussion:v1:${options.siteId}:${options.access}:${options.actorId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private readStored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey); if (raw === null) return null;
    if (raw.length > 4096) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || Object.keys(p).sort().join() !== "actorId,command,query" || p.actorId !== this.options.actorId || !p.query
      || Object.keys(p.query).sort().join() !== "access,eventId,expectedWorkerId,mode,operationId,siteId" || !p.command
      || Object.keys(p.command).sort().join() !== "eventId,expectedRevision,note,operationId") throw Error("invalid_pending");
    const q = parseDiscussionQuery(`https://local.invalid/?${discussionQueryString(p.query)}`);
    if (q.siteId !== this.options.siteId || q.access !== this.options.access || q.mode !== "detail" || q.operationId !== null) throw Error("invalid_pending");
    const { command } = parseDiscussionCommand({ siteId: q.siteId, access: q.access, expectedWorkerId: q.expectedWorkerId, ...p.command });
    if (command.eventId !== q.eventId) throw Error("invalid_pending");
    return { actorId: p.actorId, query: q, command };
  }
  private clear() {
    if (JSON.stringify(this.readStored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict");
    this.options.storage().removeItem(this.storageKey); if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_conflict");
    this.set({ pending: null });
  }
  pause = () => { this.paused = true; this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ list: null, detail: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "已隐藏资料；停止等待不代表撤销已发送的说明。" }); };
  initialize = async (target?: { eventId: string; expectedWorkerId: string | null }) => {
    this.generation++; this.controller?.abort(); this.controller = null; this.paused = false;
    try {
      const pending = this.readStored();
      const selected = target ? parseDiscussionQuery(`https://local.invalid/?${discussionQueryString({ siteId: this.options.siteId, access: this.options.access, mode: "detail", operationId: null, eventId: target.eventId, expectedWorkerId: target.expectedWorkerId })}`) : this.state.query;
      // This is only a detail GET hint. RPC and result parser still bind actor, worker and event.
      this.set({ pending, query: pending?.query ?? selected, list: null, detail: null, phase: "idle" });
    }
    catch { this.set({ phase: "blocked", list: null, detail: null, message: "待确认记录或存储异常，不覆盖原操作。" }); return; }
    if (this.state.query?.mode === "detail") await this.run(this.state.query, null, false);
  };
  load = async (q: ListQuery) => { if (this.controller || this.state.pending) return; this.paused = false; await this.run(q, null, false); };
  next = async () => {
    const { list, query, phase } = this.state; if (phase === "ready" && list?.nextCursor && query?.mode === "list") await this.load({ ...query,
      expectedWorkerId: list.workerId, asOf: list.asOf, cursorAt: list.nextCursor.occurredAt, cursorId: list.nextCursor.id });
  };
  select = async (eventId: string) => {
    if (this.controller || this.state.pending || this.state.phase !== "ready" || !this.state.list?.items.some(x => x.eventId === eventId)) return;
    await this.run({ siteId: this.options.siteId, access: this.options.access, mode: "detail", expectedWorkerId: this.state.list.workerId, eventId, operationId: null }, null, false);
  };
  submit = async (note: string) => {
    if (this.paused || this.controller || this.state.pending || this.state.phase !== "ready" || !this.state.detail?.canPost || this.state.query?.mode !== "detail") return;
    try {
      if (this.readStored()) { await this.initialize(); return; }
      const query = this.state.query, { command } = parseDiscussionCommand({ siteId: query.siteId, access: query.access, expectedWorkerId: query.expectedWorkerId,
        eventId: query.eventId, operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(), expectedRevision: this.state.detail.item.revision, note });
      const pending = { actorId: this.options.actorId, query, command }, raw = JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey, raw); if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_write_failed");
      this.set({ pending }); await this.run(query, command, true);
    } catch { this.set({ phase: "blocked", list: null, detail: null, message: "请检查说明或本页存储；不会覆盖待确认操作。" }); }
  };
  retry = async () => {
    if (this.paused || this.controller || this.state.phase !== "unconfirmed" || !this.state.pending) return;
    if (await this.run(this.state.pending.query, null, false) && this.state.pending && this.state.phase === "unconfirmed") await this.run(this.state.pending.query, this.state.pending.command, false);
  };
  private async run(input: DiscussionQuery, command: DiscussionCommand | null, first: boolean): Promise<boolean> {
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ list: null, detail: null, phase: command ? "saving" : "loading" });
    try {
      if (JSON.stringify(this.readStored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict");
      const query = parseDiscussionQuery(`https://local.invalid/?${discussionQueryString(input)}`);
      if (query.siteId !== this.options.siteId || query.access !== this.options.access) throw Error("identity_mismatch");
      this.set({ query });
      const expected: DiscussionQuery = query.mode === "detail" ? { ...query, operationId: this.state.pending?.command.operationId ?? null } : query;
      const body = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/location-discussion${command ? "" : `?${discussionQueryString(expected)}`}`,
        { method: command ? "POST" : "GET", ...(command ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: query.siteId, access: query.access, expectedWorkerId: query.expectedWorkerId, ...command }) } : {}) },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 65536, errorStatuses: DISCUSSION_ERRORS });
      const result = { ...parseDiscussionResult(body, expected), moduleEnabled: body.moduleEnabled as boolean };
      if (this.options.access === "self" && result.employeeId !== this.options.actorId) throw Error("identity_mismatch");
      if (g !== this.generation || this.paused) return false;
      if (result.mode === "list") this.set({ phase: "ready", list: result, query: { ...query, expectedWorkerId: result.workerId },
        message: `本批检查 ${result.scanned} 条打卡，匹配 ${result.items.length} 条异常。${result.nextCursor ? "仍有下一批，空批不等于没有异常。" : "已到查询末尾。"}` });
      else {
        const pending = this.state.pending;
        if (command && !result.receipt || pending && result.receipt && (result.receipt.note !== pending.command.note || result.receipt.revision !== pending.command.expectedRevision + 1)) throw Error("receipt_mismatch");
        const fenced = !!pending && !result.receipt && result.item.revision > pending.command.expectedRevision;
        if (pending && (result.receipt || fenced)) this.clear();
        this.set({ detail: result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending ? "尚未确认，可核对原编号或明确重试。" : fenced
          ? "已有新说明，原操作未写入且已失效；请阅读新内容，再提交。" : result.receipt ? "已确认保存。不会修改打卡或内部核查结论；请刷新列表。" : "只显示明确向员工公开的说明与回复，不显示内部备注。" });
      }
      return true;
    } catch (e) {
      if (g !== this.generation || this.paused) return false;
      if (command && first && e instanceof AttendanceManagementRejected) { try { this.clear(); } catch { /* Never remove another intent. */ } }
      this.set({ list: null, detail: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: e instanceof Error && e.message === "attendance_worker_changed"
        ? "考勤档案绑定已变更，停止读取旧档案；未确认操作仍保留。" : "暂时无法确认结果或访问权限。请重新读取；不会自动重复提交。" }); return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
