import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { WORK_ARRANGEMENT_API, WORK_ARRANGEMENT_ERRORS, WORK_ARRANGEMENT_BYTE_LIMIT, parseWorkArrangementJson,
  parseWorkArrangementQuery, parseWorkArrangementBody, parseWorkArrangementCommand, parseWorkArrangementResponse,
  sameWorkArrangementCommand, workArrangementQueryString, type WorkArrangementAccess, type WorkArrangementQuery,
  type WorkArrangementCommand, type WorkArrangementResponse, type WorkArrangementPreviewInput, type WorkArrangementDecision } from "./merchantAttendanceWorkArrangement";

export type WorkArrangementStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type WorkArrangementClientOptions = { siteId: string; access: WorkArrangementAccess; actorId: string; apiFetch: AttendanceApiFetch;
  enabled: boolean; storage: () => WorkArrangementStorage; randomId?: () => string; timeoutMs?: number };
export type WorkArrangementPending = { version: 1; anchorId: string; actorId: string; employeeId: string | null; query: WorkArrangementQuery; command: WorkArrangementCommand };
export type WorkArrangementClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  result: WorkArrangementResponse | null; query: WorkArrangementQuery | null; pending: WorkArrangementPending | null; message: string }>;
type Lease = { generation: number; controller: AbortController };
const hidden = () => typeof document !== "undefined" && document.hidden;
class StorageChanged extends Error {}
class Rejected extends Error {}
// These exact, status-matched SQL business errors abort the entire new command.
// Authorization, identity, operation conflicts and unknown transport failures are
// deliberately excluded. GET recovery never uses this retirement path.
const DEFINITIVE_WRITE_REJECTIONS = new Set(["attendance_version_conflict", "attendance_work_arrangement_closed", "attendance_work_arrangement_outside_window",
  "attendance_work_arrangement_outside_employment", "attendance_work_arrangement_conflicts_changed", "attendance_work_arrangement_conflict_confirmation_required",
  "attendance_period_sealed", "attendance_platform_paused"]);
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function uuid(v: unknown): string { if (typeof v !== "string" || v.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) throw Error("invalid_identity"); return v; }
export function workArrangementPendingKey(siteId: string, access: WorkArrangementAccess, actorId: string): string {
  parseWorkArrangementQuery({ siteId, access, requestId: null, operationId: null, beforeAt: null, beforeId: null, preview: null }); uuid(actorId);
  return `faolla:attendance:work-arrangements:v1:${siteId}:${access}:${actorId}`;
}
async function request(o: WorkArrangementClientOptions, q: WorkArrangementQuery, command: WorkArrangementCommand | null, signal: AbortSignal) {
  const controller = new AbortController(), limit = o.timeoutMs ?? 12000, started = performance.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (error: Error) => void = () => {};
  const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error("aborted_or_timeout")); };
  const deadline = new Promise<never>((_, reject) => { rejectCancel = reject; }), timer = setTimeout(cancel, limit);
  signal.addEventListener("abort", cancel, { once: true });
  const guard = () => { if (signal.aborted || controller.signal.aborted || performance.now() - started >= limit) throw Error("aborted_or_timeout"); };
  const run = async () => {
    guard(); const response = await o.apiFetch(WORK_ARRANGEMENT_API + (command ? "" : `?${workArrangementQueryString(q)}`), {
      method: command ? "POST" : "GET", headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify({ query: q, command }) } : {}), signal: controller.signal, cache: "no-store", redirect: "error",
    });
    if (signal.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    guard(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try { while (true) { const chunk = await reader.read(); guard(); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > (response.status === 200 ? WORK_ARRANGEMENT_BYTE_LIMIT : 4096)) throw Error("response_too_large");
      text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    guard(); const raw = parseWorkArrangementJson(text); guard();
    if (response.status !== 200) {
      const e = captureBrowserExact(raw, ["ok", "error"]); if (e.ok !== false || typeof e.error !== "string"
        || !Object.hasOwn(WORK_ARRANGEMENT_ERRORS, e.error) || WORK_ARRANGEMENT_ERRORS[e.error] !== response.status) throw Error("invalid_error_envelope");
      throw new Rejected(e.error);
    }
    return raw;
  };
  try { return await Promise.race([run(), deadline]); } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}

/** An independent request controller. Unknown writes are only recovered by GET;
 * it never resubmits, switches endpoints, stores credentials or rewrites facts. */
export class AttendanceWorkArrangementClient {
  readonly storageKey: string;
  private readonly options: WorkArrangementClientOptions;
  private state: WorkArrangementClientState = freeze({ phase: "idle", result: null, query: null, pending: null, message: "请明确读取工作安排；不会自动提交。" });
  private listeners = new Set<() => void>();
  private generation = 0; private controller: AbortController | null = null; private initialized = false;
  private pending: WorkArrangementPending | null = null; private pendingRaw: string | null = null;
  constructor(options: WorkArrangementClientOptions) {
    this.storageKey = workArrangementPendingKey(options.siteId, options.access, options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.randomId !== undefined && typeof options.randomId !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("attendance_invalid_request");
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Omit<WorkArrangementClientState, "pending">) {
    const state = this.state = freeze({ ...patch, pending: this.pending });
    for (const fn of [...this.listeners]) { if (state !== this.state) break; try { fn(); } catch { /* Observer code does not authorize writes. */ } }
  }
  invalidate = (message = "输入或身份已变化；请重新读取并核对。") => {
    const g = ++this.generation, previous = this.controller; this.controller = null; previous?.abort();
    if (g === this.generation) this.publish({ phase: this.pending ? "unconfirmed" : "idle", result: null, query: null, message });
  };
  pause = () => this.invalidate("工作安排已隐藏；待确认原编号保留，不自动读取或重发。");
  hasLeaveRisk = () => { if (this.pending || this.controller) return true;
    try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(): Lease | null {
    if (hidden()) { this.pause(); return null; } if (this.controller) return null;
    const l = { generation: ++this.generation, controller: new AbortController() }; this.controller = l.controller; return l;
  }
  private guard(l: Lease) {
    if (l.generation === this.generation && hidden()) this.pause();
    if (l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted) throw Error("aborted");
  }
  private release(l: Lease) { if (l.generation === this.generation && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease) { this.guard(l); const storage = this.options.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l); return { storage, raw }; }
  private verify(l: Lease) { const s = this.stored(l); if (s.raw !== this.pendingRaw) throw new StorageChanged("pending_changed"); return s.storage; }
  private decode(raw: string): WorkArrangementPending {
    const p = captureBrowserExact(parseWorkArrangementJson(raw, "request"), ["version", "anchorId", "actorId", "employeeId", "query", "command"]);
    if (p.version !== 1 || p.anchorId !== this.options.actorId) throw new StorageChanged("invalid_pending");
    const { query, command } = parseWorkArrangementBody({ query: p.query, command: p.command }), actorId = uuid(p.actorId), employeeId = p.employeeId === null ? null : uuid(p.employeeId);
    if (query.siteId !== this.options.siteId || query.access !== this.options.access
      || (query.access === "self" ? employeeId !== this.options.actorId : employeeId !== null || actorId !== this.options.actorId)) throw new StorageChanged("pending_identity");
    return freeze({ version: 1, anchorId: this.options.actorId, actorId, employeeId, query, command });
  }
  initialize = async () => {
    const l = this.begin(); if (!l) return;
    try { const { raw } = this.stored(l); if (this.pending && raw !== this.pendingRaw) throw new StorageChanged("pending_changed");
      this.pending = raw === null ? null : this.decode(raw); this.pendingRaw = raw; this.initialized = true; this.guard(l);
      this.publish({ phase: this.pending ? "unconfirmed" : "idle", result: null, query: null, message: this.pending
        ? "本标签页保存了待确认原编号，请先读取原收据；不会重发。" : "请明确读取工作安排；不会自动提交。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  private query(patch: Partial<WorkArrangementQuery> = {}): WorkArrangementQuery {
    return parseWorkArrangementQuery({ siteId: this.options.siteId, access: this.options.access, requestId: null, operationId: null, beforeAt: null, beforeId: null, preview: null, ...patch });
  }
  private parse(raw: unknown, q: WorkArrangementQuery, command: WorkArrangementCommand | null) {
    const identity = this.options.access === "owner" ? { ownerId: this.options.actorId } : { employeeId: this.options.actorId };
    const result = parseWorkArrangementResponse(raw, q, command, { ...identity, ...(this.pending ? { authUserId: this.pending.actorId } : {}) });
    if (this.pending && result.employeeId !== this.pending.employeeId) throw Error("identity_changed"); return result;
  }
  private clear(l: Lease) {
    const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw new StorageChanged("pending_not_cleared"); this.pending = null; this.pendingRaw = null;
  }
  private failed(error: unknown, l: Lease) {
    if (l.generation !== this.generation) return; if (hidden()) { this.pause(); return; }
    this.publish({ phase: this.pending ? "unconfirmed" : "blocked", result: null, query: null, message: error instanceof StorageChanged
      ? "待确认存储不可用或已改变；不会覆盖或删除原编号，请先核对。"
      : this.pending ? "操作结果尚未确认，原编号保留；请读取原收据，不会自动重发。"
        : "未能读取当前工作安排；旧资料已清除，请核对权限及内容后重新读取。" });
  }
  private async get(q: WorkArrangementQuery) {
    const l = this.begin(); if (!l) return;
    try {
      if (!this.initialized || !q.operationId && (!this.options.enabled || this.pending)) return;
      this.verify(l); this.publish({ phase: "loading", result: null, query: null, message: q.operationId ? "正在核对原收据，不重发…" : "正在授权并读取工作安排…" }); this.guard(l);
      const raw = await request(this.options, q, null, l.controller.signal); this.guard(l); this.verify(l);
      const result = this.parse(raw, q, q.operationId ? this.pending?.command ?? null : null); this.guard(l);
      if (q.operationId && this.pending && result.receipt) {
        if (!sameWorkArrangementCommand(this.pending.command, result.receipt.command)) throw Error("receipt_mismatch"); this.clear(l); }
      this.guard(l); this.publish({ phase: this.pending ? "unconfirmed" : "ready", result, query: q, message: this.pending
        ? "暂未找到原收据，不代表操作失败；保留原编号，不会自动重发。"
        : result.receipt ? "原操作已确认；此收据不代表当前冲突、期限或封存已重新核对。" : "已读取工作安排；批准不证明实际出勤，也不改变工时或工资。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  }
  load = async () => { await this.get(this.query()); };
  list = this.load;
  next = async () => { const c = this.state.result?.nextCursor; if (c) await this.get(this.query({ beforeAt: c.at, beforeId: c.id })); };
  detail = async (requestId: string) => { try { await this.get(this.query({ requestId })); } catch { this.invalidate("申请编号无效。"); } };
  preview = async (input: WorkArrangementPreviewInput) => { try { await this.get(this.query({ preview: input })); } catch { this.invalidate("预览区间无效。"); } };
  recover = async () => { const p = this.pending; if (p) await this.get(this.query({ requestId: p.query.requestId, operationId: p.command.operationId })); };
  private async write(make: (operationId: string) => WorkArrangementCommand) {
    const context = this.state.result;
    if (!this.initialized || !this.options.enabled || this.pending || this.state.phase !== "ready" || !context?.moduleEnabled) return;
    const l = this.begin(); if (!l) return; let sent: WorkArrangementPending | null = null;
    try {
      this.verify(l); const operationId = (this.options.randomId ?? (() => crypto.randomUUID()))(); this.guard(l);
      const command = parseWorkArrangementCommand(make(operationId)), query = this.query({ requestId: "requestId" in command ? command.requestId : null });
      parseWorkArrangementBody({ query, command }); this.guard(l);
      this.publish({ phase: "saving", result: null, query: null, message: "正在保存原操作编号，随后只提交一次…" }); this.guard(l);
      const storage = this.verify(l); this.pending = freeze({ version: 1, anchorId: this.options.actorId, actorId: context.actorId, employeeId: context.employeeId, query, command });
      this.pendingRaw = JSON.stringify(this.pending); parseWorkArrangementJson(this.pendingRaw, "request"); this.guard(l);
      storage.setItem(this.storageKey, this.pendingRaw); this.guard(l); this.verify(l);
      this.publish({ phase: "saving", result: null, query: null, message: "原编号已保存，正在提交一次明确操作…" }); this.guard(l); this.verify(l); this.guard(l);
      sent = this.pending; const raw = await request(this.options, query, command, l.controller.signal); this.guard(l); this.verify(l);
      const result = this.parse(raw, query, command); if (!result.receipt || !sameWorkArrangementCommand(command, result.receipt.command)) throw Error("receipt_missing");
      this.guard(l); this.clear(l); this.guard(l); this.publish({ phase: "ready", result, query, message: "操作收据已确认；只记录安排，不修改打卡、实际工时或工资。" });
    } catch (e) {
      if (sent && e instanceof Rejected && DEFINITIVE_WRITE_REJECTIONS.has(e.message)) {
        try { this.guard(l); if (this.pending !== sent) throw new StorageChanged("pending_changed"); this.verify(l); this.clear(l); this.guard(l);
          this.publish({ phase: "blocked", result: null, query: null, message: "服务器明确拒绝并回滚本次新操作；原尝试已结束。请重新读取当前条件后再编辑，不会自动重发。" }); return;
        } catch (error) { this.failed(error, l); return; }
      }
      this.failed(e, l);
    } finally { this.release(l); }
  }
  submit = async (input: { reason: string }) => {
    const r = this.state.result, p = r?.preview;
    if (this.options.access !== "self" || !r?.canSubmit || !p?.canSubmit || !r.workerId) return;
    await this.write(operationId => ({ operationId, action: "submit", reason: input.reason.trim(), expectedWorkerId: r.workerId!,
      expectedSettingsVersion: r.settingsVersion, expectedPolicyRevision: r.policy.revision, kind: p.kind, timeZone: p.timeZone, startAt: p.startAt, endAt: p.endAt }));
  };
  decide = async (action: WorkArrangementDecision, reason: string, confirmConflicts = false) => {
    const d = this.state.result?.detail; if (!d) return;
    const allowed = action === "withdraw" ? this.options.access === "self" && d.canWithdraw
      : this.options.access === "owner" && (action === "approve" ? d.canApprove : action === "reject" ? d.canReject : action === "cancel" && d.canCancel);
    if (!allowed || action === "approve" && d.conflicts.length > 0 && !confirmConflicts) return;
    await this.write(operationId => ({ action, operationId, requestId: d.requestId, expectedRevision: d.revision, reason: reason.trim(),
      ...(action === "approve" ? { expectedConflictsFingerprint: d.conflictsFingerprint, confirmConflicts } : {}) } as WorkArrangementCommand));
  };
  setPolicy = async (retrospectiveDays: number, reason: string) => {
    const r = this.state.result; if (this.options.access !== "owner" || !r) return;
    await this.write(operationId => ({ operationId, action: "set_policy", expectedRevision: r.policy.revision, retrospectiveDays, reason: reason.trim() }));
  };
}
