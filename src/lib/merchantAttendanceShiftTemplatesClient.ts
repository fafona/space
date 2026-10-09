import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import { parseShiftTemplate, parseShiftTemplateCommand, parseShiftTemplateItem, parseShiftTemplatesResponse,
  sameShiftTemplateCommand, shiftTemplatesQueryString, SHIFT_TEMPLATE_ERRORS,
  type ShiftTemplate, type ShiftTemplateItem, type ShiftTemplateCommand, type ShiftTemplatesQuery } from "./merchantAttendanceShiftTemplates";

type Pending = { ownerId: string; siteId: string; view: "active" | "archived"; command: ShiftTemplateCommand };
type Result = ReturnType<typeof parseShiftTemplatesResponse>;
type Options = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number };
type State = { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: Result | null; pending: Pending | null; message: string };
const hidden = () => typeof document !== "undefined" && document.hidden;
const definitive = new Set(["attendance_invalid_request", "attendance_version_conflict", "attendance_template_archived", "attendance_template_limit", "attendance_platform_paused"]);
// Only this new feature tightens error envelopes; established clients are unchanged.
async function strictTemplateFetch(apiFetch: AttendanceApiFetch, url: string, init?: RequestInit): Promise<Response> {
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
export class AttendanceShiftTemplatesClient {
  private state: State = { phase: "idle", result: null, pending: null, message: "尚未读取模板；保存模板不发布排班。" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private query: ShiftTemplatesQuery;
  readonly storageKey: string;
  constructor(private readonly options: Options) {
    attendanceSelfUuid(options.ownerId);
    this.query = { siteId: attendanceSelfSite(options.siteId), view: "active", cursorId: null, operationId: null };
    this.storageKey = `faolla:attendance:shift-templates:v1:${options.siteId}:${options.ownerId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  private restored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey);
    if (raw === null) return null;
    if (raw.length > 8192) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || Object.keys(p).sort().join() !== "command,ownerId,siteId,view" || p.ownerId !== this.options.ownerId || p.siteId !== this.options.siteId
      || !["active", "archived"].includes(p.view)) throw Error("invalid_pending");
    return { ownerId: p.ownerId, siteId: p.siteId, view: p.view, command: parseShiftTemplateCommand(p.command) };
  }
  private samePending() { if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("pending_changed"); }
  private clear() {
    this.samePending(); this.options.storage().removeItem(this.storageKey);
    if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_error");
    this.set({ pending: null });
  }
  pause = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "模板已隐藏；已发送操作不撤销，回来后请明确查原收据。" });
  };
  initialize = async () => {
    if (this.controller || hidden()) return;
    try {
      const pending = this.restored();
      this.set({ pending, result: null }); this.query = { ...this.query, view: pending?.view ?? this.query.view, cursorId: null, operationId: null };
      await this.request(null);
    } catch { this.set({ phase: "blocked", result: null, message: "待确认存储异常，不会覆盖或自动提交。" }); }
  };
  load = async (view: "active" | "archived" = "active") => {
    if (this.controller || this.state.pending || hidden()) return;
    if (view !== "active" && view !== "archived") return;
    this.query = { ...this.query, view, cursorId: null, operationId: null }; await this.initialize();
  };
  next = async () => {
    if (this.controller || this.state.pending || this.state.phase !== "ready" || !this.state.result?.nextCursor || hidden()) return;
    this.query = { ...this.query, cursorId: this.state.result.nextCursor, operationId: null }; await this.request(null);
  };
  save = async (template: ShiftTemplate, item?: ShiftTemplateItem) => {
    await this.submit(() => {
      const existing = item ? parseShiftTemplateItem(item) : null;
      if (existing?.archived) throw Error("archived");
      const operationId = (this.options.randomId ?? (() => crypto.randomUUID()))();
      return { operationId, templateId: existing?.templateId ?? operationId, expectedRevision: existing?.revision ?? 0, action: "save", template: parseShiftTemplate(template) };
    });
  };
  archive = async (item: ShiftTemplateItem) => {
    await this.submit(() => {
      const existing = parseShiftTemplateItem(item); if (existing.archived) throw Error("archived");
      return { operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(), templateId: existing.templateId,
        expectedRevision: existing.revision, action: "archive", template: null };
    });
  };
  private async submit(make: () => ShiftTemplateCommand) {
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !this.state.result?.moduleEnabled) return;
    try {
      if (this.restored()) { await this.initialize(); return; }
      const command = parseShiftTemplateCommand(make()), pending: Pending = { ownerId: this.options.ownerId, siteId: this.options.siteId, view: this.query.view, command };
      const raw = JSON.stringify(pending); this.options.storage().setItem(this.storageKey, raw);
      if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_error");
      this.set({ pending }); this.query = { ...this.query, cursorId: null, operationId: null }; await this.request(command);
    } catch { this.set({ phase: "blocked", result: null, message: "模板内容或存储无效，未确认保存；请保留原编号并重新读取。" }); }
  }
  retry = async () => {
    if (this.controller || hidden() || !this.state.pending || this.state.phase !== "unconfirmed") return;
    if (await this.request(null) && this.state.pending && this.state.result?.moduleEnabled) await this.request(this.state.pending.command);
  };
  private async request(command: ShiftTemplateCommand | null): Promise<boolean> {
    if (hidden()) { this.pause(); return false; }
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ result: null, phase: command ? "saving" : "loading" });
    try {
      this.samePending();
      const query = { ...this.query, operationId: command ? null : this.state.pending?.command.operationId ?? null };
      if (query.operationId) query.cursorId = null;
      const body = await attendanceManagementRequest((url, init) => strictTemplateFetch(this.options.apiFetch, url, init),
        `/api/merchant-enterprise/attendance/shift-templates${command ? "" : `?${shiftTemplatesQueryString(query)}`}`,
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, command }) } : { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs ?? 12000, maxBytes: 65536, errorStatuses: SHIFT_TEMPLATE_ERRORS });
      if (g !== this.generation) return false;
      if (hidden()) { this.pause(); return false; }
      this.samePending(); const result = parseShiftTemplatesResponse(body, query, command), pending = this.state.pending;
      if (pending && result.receipt) {
        if (!sameShiftTemplateCommand(pending.command, result.receipt.command)) throw Error("receipt_mismatch");
        this.clear();
      }
      this.set({ result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending
        ? "模板操作结果待确认；请查原收据或用原编号明确重试。"
        : result.receipt ? "模板操作已确认；尚未发布任何排班。" : "已读取模板；带入草稿后仍须核对日期、地点和发布预览。" });
      return true;
    } catch (error) {
      if (g !== this.generation) return false;
      if (command && error instanceof AttendanceManagementRejected && definitive.has(error.message)) {
        try { this.clear(); } catch { /* Preserve uncertain or substituted storage. */ }
      }
      const code = error instanceof Error ? error.message : "";
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message:
        code === "attendance_version_conflict" ? "模板已被更新，旧命令未生效；请重新读取后编辑。"
          : code === "attendance_template_limit" ? "有效模板已达100个；请先归档不再使用的模板。"
            : code === "attendance_template_archived" ? "该模板已归档；请重新读取，不会修改已发布安排。"
              : "无法可靠确认结果，已隐藏模板；请重新核对身份及原编号，不会自动重发或发布排班。" });
      return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
