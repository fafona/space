import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import { parseRulesBody, parseRulesCommand, parseRulesQuery, parseRulesResponse, rulesQueryString, sameRulesCommand, RULES_ERRORS,
  type RulesCommand, type RulesQuery, type RulesResponse } from "./merchantAttendanceRules";
import type { AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";

export type RulesClientOptions = { siteId: string; ownerId: string; groupId: string | null; apiFetch: AttendanceApiFetch;
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number };
type Pending = { siteId: string; ownerId: string; groupId: string | null; query: RulesQuery; command: RulesCommand };
type State = { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; result: RulesResponse | null; pending: Pending | null; message: string };
const hidden = () => typeof document !== "undefined" && document.hidden;
const definitive = new Set(["attendance_invalid_request", "attendance_version_conflict", "attendance_rule_draft_required", "attendance_rule_future_required",
  "attendance_rule_order_conflict", "attendance_rule_already_withdrawn", "attendance_rule_group_inactive", "attendance_platform_paused"]);

async function strictRulesFetch(apiFetch: AttendanceApiFetch, url: string, init?: RequestInit): Promise<Response> {
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
    text += decoder.decode(); const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join() !== "error,ok"
      || body.ok !== false || typeof body.error !== "string") throw Error("invalid_error_envelope");
    return new Response(text, { status: response.status, headers: response.headers });
  } finally {
    init?.signal?.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

export class AttendanceRulesClient {
  private state: State = { phase: "idle", result: null, pending: null, message: "尚未读取规则版本；不自动应用考勤规则。" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private query: RulesQuery;
  readonly storageKey: string;
  constructor(private readonly options: RulesClientOptions) {
    attendanceSelfSite(options.siteId); attendanceSelfUuid(options.ownerId);
    if (options.groupId !== null) attendanceSelfUuid(options.groupId);
    this.query = this.base();
    this.storageKey = `faolla:attendance:rules:v1:${options.siteId}:${options.ownerId}:${options.groupId ?? "enterprise"}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  private base(): RulesQuery { return { siteId: this.options.siteId, groupId: this.options.groupId, operationId: null, beforeRevision: null }; }
  private restored(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey); if (raw === null) return null;
    if (raw.length > 8192) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== "command,groupId,ownerId,query,siteId"
      || p.siteId !== this.options.siteId || p.ownerId !== this.options.ownerId || p.groupId !== this.options.groupId) throw Error("invalid_pending");
    const { query, command } = parseRulesBody({ query: p.query, command: p.command });
    if (query.siteId !== this.options.siteId || query.groupId !== this.options.groupId) throw Error("pending_identity");
    return { siteId: p.siteId, ownerId: p.ownerId, groupId: p.groupId, query, command };
  }
  private samePending() { if (JSON.stringify(this.restored()) !== JSON.stringify(this.state.pending)) throw Error("pending_changed"); }
  private clear() {
    this.samePending(); this.options.storage().removeItem(this.storageKey);
    if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_error");
    this.set({ pending: null });
  }
  pause = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "页面已隐藏；已发送操作不撤销。返回后仅查询原编号，不自动重发。" });
  };
  initialize = async () => {
    if (this.controller || hidden()) return;
    try {
      const pending = this.restored();
      if (this.state.pending && JSON.stringify(pending) !== JSON.stringify(this.state.pending)) throw Error("pending_changed");
      this.set({ pending, result: null }); this.query = pending?.query ?? this.base(); await this.request(null);
    } catch { this.set({ phase: "blocked", result: null, message: "待确认存储不可读或已变化；不会覆盖或提交，请保留原编号核验。" }); }
  };
  refresh = async () => this.initialize();
  next = async () => {
    const cursor = this.state.result?.nextBeforeRevision;
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || cursor == null) return;
    this.query = parseRulesQuery({ ...this.base(), beforeRevision: cursor }); await this.request(null);
  };
  saveDraft = async (input: { rules: AttendanceRuleDraft; reason: string }) => this.write(result => ({
    operationId: this.operationId(), action: "save_draft", expectedRevision: result.revision, reason: input.reason.trim(), rules: input.rules,
    expectedSettingsVersion: result.settingsVersion, expectedGroupRevision: result.group?.revision ?? null, timeZone: result.timeZone,
  }));
  publish = async (effectiveOn: string, reason: string) => this.write(result => {
    const draft = result.draft;
    if (!draft || draft.settingsVersion !== result.settingsVersion || draft.groupRevision !== (result.group?.revision ?? null) || draft.timeZone !== result.timeZone) throw Error("stale_draft");
    return { operationId: this.operationId(), action: "publish", expectedRevision: result.revision, reason: reason.trim(), effectiveOn,
      expectedSettingsVersion: result.settingsVersion, expectedGroupRevision: result.group?.revision ?? null, timeZone: result.timeZone };
  });
  withdraw = async (publishedRevision: number, reason: string) => this.write(result => {
    if (!result.items.some(item => item.action === "publish" && item.revision === publishedRevision && item.withdrawnByRevision === null)) throw Error("publication_required");
    return { operationId: this.operationId(), action: "withdraw", expectedRevision: result.revision, publishedRevision, reason: reason.trim() };
  });
  private operationId() { return (this.options.randomId ?? (() => crypto.randomUUID()))(); }
  private async write(make: (result: RulesResponse) => RulesCommand) {
    const result = this.state.result;
    if (this.controller || hidden() || this.state.pending || this.state.phase !== "ready" || !result?.moduleEnabled) return;
    try {
      if (this.restored()) { await this.initialize(); return; }
      const command = parseRulesCommand(make(result)), query = this.base();
      if (command.action !== "withdraw" && result.group?.active === false) throw Error("inactive_group");
      parseRulesBody({ query, command });
      const pending: Pending = { siteId: this.options.siteId, ownerId: this.options.ownerId, groupId: this.options.groupId, query, command };
      const raw = JSON.stringify(pending); this.options.storage().setItem(this.storageKey, raw);
      if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_error");
      this.set({ pending }); this.query = query; await this.request(command);
    } catch {
      this.set({ result: null, phase: "blocked", message: "草稿、当前版本或待确认存储未通过校验；未发起新提交。请重新读取，核对已保存草稿和原编号。" });
    }
  }
  retry = async () => {
    if (this.controller || hidden() || !this.state.pending || this.state.phase !== "unconfirmed") return;
    if (await this.request(null) && this.state.pending && this.state.result?.moduleEnabled) await this.request(this.state.pending.command);
  };
  private async request(command: RulesCommand | null): Promise<boolean> {
    if (hidden()) { this.pause(); return false; }
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ result: null, phase: command ? "saving" : "loading" });
    try {
      this.samePending();
      const query = { ...this.query, operationId: command ? null : this.state.pending?.command.operationId ?? null };
      const raw = await attendanceManagementRequest((url, init) => strictRulesFetch(this.options.apiFetch, url, init),
        "/api/merchant-enterprise/attendance/rules" + (command ? "" : "?" + rulesQueryString(query)),
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, command }) } : { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs ?? 12000, maxBytes: 131072, errorStatuses: RULES_ERRORS });
      if (g !== this.generation) return false;
      if (hidden()) { this.pause(); return false; }
      this.samePending();
      const result = parseRulesResponse(raw, query, command, this.options.ownerId), pending = this.state.pending;
      if (pending && result.receipt) {
        if (!sameRulesCommand(pending.command, result.receipt.command)) throw Error("receipt_mismatch");
        this.clear();
      }
      this.set({ result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending
        ? "尚未找到原操作收据；新写入已阻止。可查询原编号，或明确按原内容重试。"
        : result.receipt ? "操作收据已确认；仅更新规则版本记录，没有应用到打卡、工时、异常或工资。" : "已读取本层规则版本记录；不代表已应用到实际考勤。" });
      return true;
    } catch (error) {
      if (g !== this.generation) return false;
      if (hidden()) { this.pause(); return false; }
      if (command && error instanceof AttendanceManagementRejected && definitive.has(error.message)) {
        try { this.clear(); } catch { /* Preserve substituted or uncertain storage. */ }
      }
      const code = error instanceof Error ? error.message : "";
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message:
        code === "attendance_version_conflict" ? "设置、考勤组或规则版本已变化；请重新读取，不覆盖旧版本。"
          : code === "attendance_rule_future_required" || code === "attendance_rule_order_conflict" ? "拟生效日期必须是企业时区的未来日期，且晚于已有未撤回版本；请重新读取核对。"
            : code === "attendance_rule_group_inactive" ? "考勤组已停用；不能保存或发布新草稿，历史及尚未生效版本的撤回需重新核对。"
              : "无法可靠确认结果，已隐藏规则资料；请核对当前身份与原编号，不会自动重发。" });
      return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
