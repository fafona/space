import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import { parseGroupsBody, parseGroupsCommand, parseGroupsQuery, parseGroupsResponse, sameGroupsCommand, groupsQueryString, groupRange, GROUPS_ERRORS,
  type GroupsCommand, type GroupsQuery, type GroupsResponse } from "./merchantAttendanceGroups";
export type GroupsClientOptions = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number };
type Pending = { siteId: string; ownerId: string; query: GroupsQuery; command: GroupsCommand };
type State = { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: GroupsResponse | null; pending: Pending | null; message: string };
const hidden = () => typeof document !== "undefined" && document.hidden;
const definitive = new Set(["attendance_invalid_request", "attendance_version_conflict", "attendance_group_closed", "attendance_group_overlap",
  "attendance_group_inactive", "attendance_group_worker_inactive", "attendance_platform_paused"]);
async function strictGroupsFetch(apiFetch: AttendanceApiFetch, url: string, init?: RequestInit): Promise<Response> {
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

export class AttendanceGroupsClient {
  private state: State = { phase: "idle", result: null, pending: null, message: "尚未读取考勤组。" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private query: GroupsQuery;
  readonly storageKey: string;
  constructor(private readonly options: GroupsClientOptions) {
    const ownerId = attendanceSelfUuid(options.ownerId);
    this.query = { siteId: attendanceSelfSite(options.siteId), view: "groups", groupId: null, workerId: null, onDate: null, assignmentId: null, operationId: null, cursorId: null };
    this.storageKey = "faolla:attendance:groups:v1:" + options.siteId + ":" + ownerId;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  private base(): GroupsQuery {
    return { siteId: this.options.siteId, view: "context", groupId: null, workerId: null, onDate: null, assignmentId: null, operationId: null, cursorId: null };
  }
  private restored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey);
    if (raw === null) return null;
    if (raw.length > 8192) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== "command,ownerId,query,siteId"
      || p.siteId !== this.options.siteId || p.ownerId !== this.options.ownerId) throw Error("invalid_pending");
    const { query, command } = parseGroupsBody({ query: p.query, command: p.command });
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
    this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "归组页面已隐藏；已发送操作不撤销，回来后请查原收据。" });
  };
  initialize = async () => this.initializeQuery({ ...this.base(), view: "groups" });
  groups = async () => { if (!this.state.pending) await this.initialize(); };
  private async initializeQuery(query: GroupsQuery) {
    if (this.controller || hidden()) return;
    try {
      const pending = this.restored();
      this.set({ pending, result: null }); this.query = pending?.query ?? query;
      await this.request(null);
    } catch { this.set({ phase: "blocked", result: null, message: "待确认存储异常；不会覆盖或自动提交，请保留原编号核验。" }); }
  }
  context = async (groupId: string | null, workerId: string | null = null) => {
    if (this.controller || hidden() || this.state.pending) return;
    try { this.query = parseGroupsQuery({ ...this.base(), groupId, workerId }); }
    catch { this.pause(); return; }
    await this.initializeQuery(this.query);
  };
  members = async (input: { groupId: string | null; workerId: string | null; onDate: string | null }) => {
    if (this.controller || hidden() || this.state.pending) return;
    try { this.query = parseGroupsQuery({ ...this.base(), view: "members", ...input }); }
    catch { this.pause(); return; }
    await this.initializeQuery(this.query);
  };
  next = async () => {
    const cursor = this.state.result?.nextCursor;
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !cursor || this.query.view === "context") return;
    this.query = { ...this.query, cursorId: cursor }; await this.request(null);
  };
  detail = async (assignmentId: string) => {
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready") return;
    const result = this.state.result, item = result?.items.find(i => "assignmentId" in i && i.assignmentId === assignmentId);
    const groupId = item?.groupId ?? result?.group?.groupId, workerId = item && "workerId" in item ? item.workerId : result?.worker?.workerId;
    if (!groupId || !workerId) return;
    try { this.query = parseGroupsQuery({ ...this.base(), groupId, workerId, assignmentId }); } catch { return; }
    await this.request(null);
  };
  saveGroup = async (input: { name: string; description: string; active: boolean; reason: string }) => {
    const current = this.state.result?.group;
    await this.write(() => {
      const operationId = this.operationId();
      return { operationId, action: "save_group", reason: input.reason.trim(), groupId: current?.groupId ?? operationId, expectedRevision: current?.revision ?? 0,
        name: input.name.trim(), description: input.description.trim(), active: input.active };
    });
  };
  assign = async (input: { startsOn: string; endsOn: string | null; reason: string }) => {
    const context = this.state.result;
    if (!context?.group?.active || !context.worker?.active) return;
    await this.write(() => ({ operationId: this.operationId(), action: "assign", reason: input.reason.trim(), groupId: context.group!.groupId, workerId: context.worker!.workerId,
      expectedGroupRevision: context.group!.revision, expectedWorkerVersion: context.worker!.version, expectedSettingsVersion: context.settingsVersion,
      timeZone: context.timeZone, startsOn: input.startsOn, endsOn: input.endsOn }));
  };
  end = async (endsOn: string, reason: string) => {
    const detail = this.state.result?.detail;
    if (!detail?.canEnd || detail.revision !== 1 || detail.endsOn !== null) return;
    await this.write(() => {
      groupRange(detail.startsOn, endsOn, detail.timeZone);
      return { operationId: this.operationId(), action: "end", reason: reason.trim(), assignmentId: detail.assignmentId, expectedRevision: 1, endsOn };
    });
  };
  cancel = async (reason: string) => {
    const detail = this.state.result?.detail;
    if (!detail?.canCancel || detail.revision === 3) return;
    await this.write(() => ({ operationId: this.operationId(), action: "cancel", reason: reason.trim(), assignmentId: detail.assignmentId, expectedRevision: detail.revision as 1 | 2 }));
  };
  private operationId() { return (this.options.randomId ?? (() => crypto.randomUUID()))(); }
  private async write(make: () => GroupsCommand) {
    const result = this.state.result;
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !result?.moduleEnabled) return;
    try {
      if (this.restored()) { await this.initialize(); return; }
      const command = parseGroupsCommand(make()), query = this.base();
      if (command.action === "save_group") query.groupId = command.expectedRevision ? command.groupId : null;
      else if (command.action === "assign") { query.groupId = command.groupId; query.workerId = command.workerId; }
      else {
        if (!result.detail) throw Error("detail_required");
        query.groupId = result.detail.groupId; query.workerId = result.detail.workerId; query.assignmentId = command.assignmentId;
      }
      parseGroupsBody({ query, command });
      const pending: Pending = { siteId: this.options.siteId, ownerId: this.options.ownerId, query, command };
      const raw = JSON.stringify(pending); this.options.storage().setItem(this.storageKey, raw);
      if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_error");
      this.set({ pending }); this.query = query; await this.request(command);
    } catch { this.set({ result: null, phase: "blocked", message: "归组内容或待确认存储异常；不会自动提交，请重新读取并核对原编号。" }); }
  }
  retry = async () => {
    if (this.controller || hidden() || !this.state.pending || this.state.phase !== "unconfirmed") return;
    if (await this.request(null) && this.state.pending && this.state.result?.moduleEnabled) await this.request(this.state.pending.command);
  };
  private async request(command: GroupsCommand | null): Promise<boolean> {
    if (hidden()) { this.pause(); return false; }
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ result: null, phase: command ? "saving" : "loading" });
    try {
      this.samePending();
      const query = { ...this.query, operationId: command ? null : this.state.pending?.command.operationId ?? null };
      const raw = await attendanceManagementRequest((url, init) => strictGroupsFetch(this.options.apiFetch, url, init),
        "/api/merchant-enterprise/attendance/groups" + (command ? "" : "?" + groupsQueryString(query)),
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, command }) } : { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs ?? 12000, maxBytes: 131072, errorStatuses: GROUPS_ERRORS });
      if (g !== this.generation) return false;
      if (hidden()) { this.pause(); return false; }
      this.samePending();
      const result = parseGroupsResponse(raw, query, command, this.options.ownerId), pending = this.state.pending;
      if (pending && result.receipt) {
        if (!sameGroupsCommand(pending.command, result.receipt.command)) throw Error("receipt_mismatch");
        this.clear();
      }
      this.set({ result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending
        ? "操作结果待确认；请查原收据，或使用原编号明确重试。"
        : result.receipt ? "归组操作已确认；未改动原打卡、排班、人员权限或工资。" : "已读取考勤组；这些是归组记录，不是已启用的打卡规则。" });
      return true;
    } catch (error) {
      if (g !== this.generation) return false;
      if (hidden()) { this.pause(); return false; }
      if (command && error instanceof AttendanceManagementRejected && definitive.has(error.message)) {
        try { this.clear(); } catch { /* Never erase substituted or uncertain pending storage. */ }
      }
      const code = error instanceof Error ? error.message : "";
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message:
        code === "attendance_group_overlap" ? "此档案在所选日期已有未撤销归组；未新增，请核对结束日期，不要把整段撤销当作调组。"
          : code === "attendance_group_inactive" || code === "attendance_group_worker_inactive" ? "考勤组或档案已停用，不能新增归组；历史仍可按当前权限读取。"
            : code === "attendance_version_conflict" || code === "attendance_group_closed" ? "记录或设置已变化；请重新读取，不会覆盖现有版本。"
              : "无法可靠确认结果，已隐藏归组内容；请核对当前身份及原编号，不会自动重发。" });
      return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
