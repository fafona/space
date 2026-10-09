import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { SourcesResponse } from "./merchantAttendanceSources";
import { AttendancePlanCoverageClient, type PlanCoverageAnchor } from "./merchantAttendancePlanCoverageClient";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parsePlanRuleApprovalsQuery, parsePlanRuleApprovalsCommand, parsePlanRuleApprovalsBody, parsePlanRuleApprovalsResponse,
  planRuleApprovalsQueryString, samePlanRuleApprovalsCommand, PLAN_RULE_APPROVALS_ERRORS,
  type PlanRuleApprovalsQuery, type PlanRuleApprovalsCommand, type PlanRuleApprovalsResponse } from "./merchantAttendancePlanRuleApprovals";

export type PlanRuleApprovalsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PlanRuleApprovalsPending = Readonly<{ version: 1; ownerId: string; query: PlanRuleApprovalsQuery; command: PlanRuleApprovalsCommand }>;
export type PlanRuleApprovalsClientOptions = { source: SourcesResponse; ownerId: string; apiFetch: AttendanceApiFetch;
  enabled: boolean; storage: () => PlanRuleApprovalsStorage; operationId?: () => string; timeoutMs?: number };
export type PlanRuleApprovalsClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  result: PlanRuleApprovalsResponse | null; pending: PlanRuleApprovalsPending | null; message: string }>;
type Lease = { generation: number; controller: AbortController };
const endpoint = "/api/merchant-enterprise/attendance/plan-rule-approvals";
const hidden = () => typeof document !== "undefined" && document.hidden;
class Rejected extends Error {}
class StorageChanged extends Error {}
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
// Only an exact, status-matched server error can authorize removing a *new*
// command. Transport, authorization, identity and operation conflicts never do.
const definitive = new Set(["attendance_version_conflict", "attendance_plan_rule_source_conflict", "attendance_plan_rule_blocked",
  "attendance_plan_rule_limit", "attendance_platform_paused"]);

async function request(apiFetch: AttendanceApiFetch, query: PlanRuleApprovalsQuery, command: PlanRuleApprovalsCommand | null, signal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController(), started = performance.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (e: Error) => void = () => {};
  const cancel = (code: string) => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error(code)); };
  const abort = () => cancel("aborted"), deadline = new Promise<never>((_, reject) => { rejectCancel = reject; });
  const timer = setTimeout(() => cancel("timeout"), timeoutMs); signal.addEventListener("abort", abort, { once: true });
  const current = () => { if (signal.aborted || controller.signal.aborted) throw Error("aborted"); if (performance.now() - started >= timeoutMs) throw Error("timeout"); };
  const run = async () => {
    current(); const response = await apiFetch(endpoint + (command ? "" : `?${planRuleApprovalsQueryString(query)}`), {
      method: command ? "POST" : "GET", headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify({ query, command }) } : {}), cache: "no-store", redirect: "error", signal: controller.signal,
    });
    if (signal.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
    }
    current(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try { while (true) { const { done, value } = await reader.read(); current(); if (done) break;
      bytes += value.byteLength; if (bytes > (response.status === 200 ? 65536 : 4096)) throw Error("oversized_response"); text += decoder.decode(value, { stream: true }); }
      text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    current(); const body = parseCaptureBrowserJson(text); current();
    if (response.status !== 200) {
      const error = captureBrowserExact(body, ["ok", "error"]);
      if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(PLAN_RULE_APPROVALS_ERRORS, error.error)
        || PLAN_RULE_APPROVALS_ERRORS[error.error] !== response.status) throw Error("invalid_error_envelope");
      throw new Rejected(error.error);
    }
    return body;
  };
  try { return await Promise.race([run(), deadline]); } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

/** Isolated approval transport. Pending storage contains only the exact small
 * command, never a source/report. There is deliberately no POST retry API. */
export class AttendancePlanRuleApprovalsClient {
  readonly anchors: readonly PlanCoverageAnchor[];
  readonly limited: boolean;
  readonly storageKey: string;
  private readonly options: Omit<PlanRuleApprovalsClientOptions, "source">;
  private readonly scope: { siteId: string; workerId: string; employeeId: string | null };
  private state: PlanRuleApprovalsClientState = freeze({ phase: "idle", result: null, pending: null, message: "请选择排班并明确预览；不会自动核准。" });
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private pending: PlanRuleApprovalsPending | null = null;
  private pendingRaw: string | null = null;
  private initialized = false;
  constructor(input: PlanRuleApprovalsClientOptions) {
    // Reuse only the existing inert, detached plan-anchor validation. Its read
    // method is never called, and no whole SourcesResponse is retained.
    const anchors = new AttendancePlanCoverageClient(input);
    if (typeof input.enabled !== "boolean" || typeof input.storage !== "function" || input.operationId !== undefined && typeof input.operationId !== "function") throw Error("attendance_invalid_request");
    this.anchors = anchors.anchors; this.limited = anchors.limited;
    const { source, ...options } = input; this.options = Object.freeze(options);
    this.scope = Object.freeze({ siteId: source.siteId, workerId: source.worker.workerId, employeeId: source.worker.employeeId });
    this.storageKey = `faolla:attendance:plan-rule-approvals:v1:${this.scope.siteId}:${options.ownerId}:${this.scope.workerId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(update: Omit<PlanRuleApprovalsClientState, "pending">) {
    const snapshot = this.state = freeze({ ...update, pending: this.pending });
    for (const listener of [...this.listeners]) { if (this.state !== snapshot) break; try { listener(); } catch { /* Observers cannot bypass the lease. */ } }
  }
  invalidate = (text = "选择、理由或资料已改变；请重新明确预览后再核准。") => {
    const generation = ++this.generation, previous = this.controller; this.controller = null; previous?.abort();
    if (generation === this.generation) this.publish({ phase: this.pending ? "unconfirmed" : "idle", result: null, message: text });
  };
  pause = () => this.invalidate("资料已隐藏；已发送操作不撤销，原编号保留。返回后不会自动查询或提交。");
  private begin(): Lease | null {
    if (hidden()) { this.pause(); return null; } if (this.controller) return null;
    const lease = { generation: ++this.generation, controller: new AbortController() }; this.controller = lease.controller; return lease;
  }
  private guard(lease: Lease) {
    if (lease.generation === this.generation && hidden()) this.pause();
    if (lease.generation !== this.generation || this.controller !== lease.controller || lease.controller.signal.aborted) throw Error("aborted");
  }
  private release(lease: Lease) { if (lease.generation === this.generation && this.controller === lease.controller) this.controller = null; }
  private stored(lease: Lease) {
    this.guard(lease); const storage = this.options.storage(); this.guard(lease); const raw = storage.getItem(this.storageKey); this.guard(lease); return { storage, raw };
  }
  private verify(lease: Lease) { const stored = this.stored(lease); if (stored.raw !== this.pendingRaw) throw new StorageChanged("pending_changed"); return stored.storage; }
  private decode(raw: string): PlanRuleApprovalsPending {
    if (new TextEncoder().encode(raw).byteLength > 8192) throw new StorageChanged("invalid_pending");
    const p = captureBrowserExact(parseCaptureBrowserJson(raw), ["version", "ownerId", "query", "command"]);
    if (p.version !== 1 || p.ownerId !== this.options.ownerId) throw new StorageChanged("pending_identity");
    const { query, command } = parsePlanRuleApprovalsBody({ query: p.query, command: p.command });
    if (query.siteId !== this.scope.siteId || query.workerId !== this.scope.workerId) throw new StorageChanged("pending_identity");
    return freeze({ version: 1, ownerId: this.options.ownerId, query, command });
  }
  initialize = async () => {
    const lease = this.begin(); if (!lease) return;
    try {
      const { raw } = this.stored(lease); if (this.pending && raw !== this.pendingRaw) throw new StorageChanged("pending_changed");
      const pending = raw === null ? null : this.decode(raw); this.guard(lease);
      this.pending = pending; this.pendingRaw = raw; this.initialized = true;
      if (pending && pending.command.employeeId !== this.scope.employeeId) throw Error("identity_changed");
      this.publish({ phase: pending ? "unconfirmed" : "idle", result: null, message: pending
        ? "本标签页有待核验原编号。只能明确查询恢复；不会自动重发，服务关闭时可能暂不可读取。" : "请选择排班并明确预览；不会自动核准。" });
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  private query(slotId: string, mode: PlanRuleApprovalsQuery["mode"], operationId: string | null = null) {
    return parsePlanRuleApprovalsQuery({ siteId: this.scope.siteId, workerId: this.scope.workerId, slotId, mode, operationId });
  }
  private bind(result: PlanRuleApprovalsResponse, query: PlanRuleApprovalsQuery, recovering: boolean) {
    if (result.worker.employeeId !== this.scope.employeeId) throw Error("identity_changed");
    const anchor = this.anchors.find(a => a.id === query.slotId);
    if (!recovering && !anchor) throw Error("anchor_missing");
    if (anchor && (Object.entries(anchor).some(([key, value]) => key !== "cancelled" && result.slot[key as keyof PlanCoverageAnchor] !== value)
      || anchor.cancelled && !result.slot.cancelled)) throw Error("anchor_mismatch");
    if (this.pending && (result.worker.employeeId !== this.pending.command.employeeId || result.worker.employeeAuthUserId !== this.pending.command.employeeAuthUserId)) throw Error("identity_changed");
  }
  private clear(lease: Lease) {
    const storage = this.verify(lease); this.guard(lease); storage.removeItem(this.storageKey); this.guard(lease);
    if (this.stored(lease).raw !== null) throw new StorageChanged("pending_not_cleared"); this.guard(lease);
    this.pending = null; this.pendingRaw = null;
  }
  private failed(error: unknown, lease: Lease) {
    if (lease.generation !== this.generation) return; if (hidden()) { this.pause(); return; }
    const code = error instanceof Error ? error.message : "";
    this.publish({ phase: this.pending ? "unconfirmed" : "blocked", result: null, message: error instanceof StorageChanged
      ? "待核验记录已改变或无法安全保存；不会覆盖记录或继续核准。请保留原编号并核对当前标签页存储。"
      : this.pending ? "无法可靠确认原操作；保留原编号，只能明确查询，不会重发。权限、身份或服务状态恢复后也需再次核验。"
        : definitive.has(code) ? "服务器明确拒绝本次新核准，未保存；请重新读取预览并核对变化。"
          : "无法可靠读取或核准，旧资料已隐藏；请核对权限、员工身份及当前排班后明确重查。" });
  }
  private async get(query: PlanRuleApprovalsQuery) {
    const lease = this.begin(); if (!lease) return;
    try {
      if (!this.initialized) throw Error("not_initialized"); this.verify(lease);
      const recovering = query.mode === "recover";
      if (!recovering && (!this.options.enabled || this.pending || !this.anchors.some(a => a.id === query.slotId))) throw Error("invalid_selection");
      if (this.scope.employeeId === null) throw Error("identity_changed");
      this.publish({ phase: "loading", result: null, message: recovering ? "正在按原编号核对已保存核准；不会提交。" : "正在读取当前排班与规则来源…" }); this.guard(lease);
      const started = performance.now(), raw = await request(this.options.apiFetch, query, null, lease.controller.signal, this.options.timeoutMs ?? 12000);
      this.guard(lease); this.verify(lease);
      const result = parsePlanRuleApprovalsResponse(raw, query, this.options.ownerId, recovering ? this.pending?.command ?? null : null);
      this.bind(result, query, recovering); if (performance.now() - started >= (this.options.timeoutMs ?? 12000)) throw Error("timeout"); this.guard(lease);
      if (recovering && this.pending && result.approval) {
        if (!samePlanRuleApprovalsCommand(result.approval.command, this.pending.command)) throw Error("receipt_mismatch"); this.clear(lease); this.guard(lease);
      }
      this.publish({ phase: this.pending ? "unconfirmed" : "ready", result, message: this.pending
        ? "未找到可确认的原核准收据；原编号仍保留，不重发、不开始新核准。" : query.mode === "preview" ? "本次仅预览，尚未核准。" : result.approval ? "已读取保存的核准依据；不是完整出勤或工资结论。" : "尚未找到对应核准记录；不代表规则为零或已停用。" });
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  }
  preview = async (slotId: string) => { try { await this.get(this.query(slotId, "preview")); } catch { this.invalidate("请选择有效排班，再明确预览。"); } };
  read = async (slotId: string) => { try { await this.get(this.query(slotId, "read")); } catch { this.invalidate("请选择有效排班，再读取已核准规则。"); } };
  recover = async (operationId?: string, slotId?: string) => {
    try {
      if (this.pending && (operationId !== undefined && operationId !== this.pending.command.operationId || slotId !== undefined && slotId !== this.pending.query.slotId)) throw Error("pending_mismatch");
      const op = this.pending?.command.operationId ?? operationId, slot = this.pending?.query.slotId ?? slotId;
      if (!op || !slot || !this.pending && (!this.options.enabled || !this.anchors.some(a => a.id === slot))) throw Error("invalid_selection");
      await this.get(this.query(slot, "recover", op));
    } catch { this.invalidate("请核对原编号与排班；已有待核验操作时只能读取该原编号。"); }
  };
  approve = async (reason: string) => {
    const previous = this.state.result;
    if (!this.options.enabled || !this.initialized || this.pending || this.state.phase !== "ready" || !previous?.moduleEnabled
      || !previous.preview?.eligible || !previous.preview.fingerprint || !previous.preview.source
      || !previous.worker.active || !previous.worker.employeeActive || !previous.worker.employeeId || !previous.worker.employeeAuthUserId) return;
    const lease = this.begin(); if (!lease) return;
    let submitted = false;
    try {
      const operationId = (this.options.operationId ?? (() => crypto.randomUUID()))(), query = this.query(previous.slot.id, "approve", operationId);
      const command = parsePlanRuleApprovalsCommand({ operationId, expectedRevision: previous.revision, expectedFingerprint: previous.preview.fingerprint,
        employeeId: previous.worker.employeeId, employeeAuthUserId: previous.worker.employeeAuthUserId, reason });
      parsePlanRuleApprovalsBody({ query, command }); this.bind(previous, query, false); this.guard(lease);
      this.publish({ phase: "saving", result: null, message: "正在核准本排班规则；结果未确认前请保留原编号。" }); this.guard(lease);
      const storage = this.verify(lease); this.guard(lease);
      this.pending = freeze({ version: 1, ownerId: this.options.ownerId, query, command }); this.pendingRaw = JSON.stringify(this.pending);
      storage.setItem(this.storageKey, this.pendingRaw); this.guard(lease); this.verify(lease); this.guard(lease);
      // A storage/subscription callback may invalidate the context. Never send
      // the POST after that boundary, and never replay this command elsewhere.
      this.publish({ phase: "saving", result: null, message: "原编号已保存，正在提交一次核准请求。" }); this.guard(lease); this.verify(lease); this.guard(lease);
      submitted = true; const started = performance.now(), raw = await request(this.options.apiFetch, query, command, lease.controller.signal, this.options.timeoutMs ?? 12000);
      this.guard(lease); this.verify(lease);
      const result = parsePlanRuleApprovalsResponse(raw, query, this.options.ownerId, command); this.bind(result, query, false);
      if (!result.approval || !samePlanRuleApprovalsCommand(result.approval.command, command)) throw Error("receipt_mismatch");
      if (performance.now() - started >= (this.options.timeoutMs ?? 12000)) throw Error("timeout"); this.guard(lease); this.clear(lease); this.guard(lease);
      this.publish({ phase: "ready", result, message: "已核验保存的排班规则核准；不会改写打卡、工时或工资。" });
    } catch (error) {
      if (lease.generation === this.generation && !hidden() && submitted && error instanceof Rejected && definitive.has(error.message)) {
        try { this.clear(lease); this.guard(lease); } catch (storageError) { this.failed(storageError, lease); return; }
      }
      this.failed(error, lease);
    } finally { this.release(lease); }
  };
}
