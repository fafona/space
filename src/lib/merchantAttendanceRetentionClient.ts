import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { exact, freeze, same, site, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { RETENTION_API, RETENTION_BODY_LIMIT, RETENTION_ERRORS, RETENTION_RESULT_LIMIT,
  parseRetentionCommand, parseRetentionQuery, parseRetentionResponse, retentionCommandFingerprintText,
  retentionQueryString, retentionReceiptMatches, retentionWriteQuery,
  type RetentionCommand, type RetentionQuery, type RetentionResult } from "./merchantAttendanceRetention";

export type RetentionClientStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type RetentionClientOptions = { siteId: string; actorId: string; enabled: boolean; apiFetch: AttendanceApiFetch;
  storage: () => RetentionClientStorage; timeoutMs?: number };
export type RetentionClientPending = { version: 1; actorId: string; query: RetentionQuery; command: RetentionCommand };
export type RetentionClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  query: RetentionQuery | null; result: RetentionResult | null; pending: RetentionClientPending | null;
  canWrite: boolean; canEndRejectedAttempt: boolean; message: string }>;
type Lease = { generation: number; controller: AbortController; deadline: number; timer: ReturnType<typeof setTimeout> };
class StorageChanged extends Error {}
class Rejected extends Error {}
const hidden = () => typeof document !== "undefined" && document.hidden;
// Only a correctly shaped, status-matched response to THIS new POST establishes
// a rejected attempt. A GET error, missing receipt, timeout or 503 never does.
const DEFINITIVE_REJECTIONS = new Set(["attendance_retention_changed", "attendance_retention_unchanged",
  "attendance_retention_disabled", "attendance_retention_not_found", "attendance_retention_too_large", "attendance_operation_conflict"]);

export function retentionClientPendingKey(siteId: string, actorId: string): string {
  return `faolla:attendance:retention-client:v1:${site(siteId)}:owner:${uuid(actorId)}`;
}

/** A fresh command must use the CAS and source displayed by this instance's
 * explicit current read. Preview/history/receipt snapshots never authorize it. */
export function retentionClientCommandMatchesRead(result: RetentionResult, query: RetentionQuery, command: RetentionCommand): boolean {
  if (!result.canWrite || result.receipt || result.siteId !== command.siteId || !same(query, retentionWriteQuery(command))) return false;
  if (command.action === "set_policy") {
    return query.mode === "policies" && result.data.kind === "policies"
      && result.data.items.some(p => p.category === command.category && p.revision === command.expectedRevision);
  }
  return query.mode === "record" && result.data.kind === "record" && result.data.item.category === command.category
    && result.data.item.recordId === command.recordId && result.data.item.preservation.revision === command.expectedRevision
    && result.data.item.sourceFingerprint === command.expectedSourceFingerprint;
}

/** Metadata-only client: no deletion, background reads, polling or automatic
 * POST/replay. initialize() reads local storage only. The host must synchronously
 * pause on visibility/lifetime changes and dispose before changing actor/site.
 * A hidden->visible cycle or Auth change cannot be inferred from a fetch alone. */
export class AttendanceRetentionClient {
  readonly storageKey: string;
  private readonly options: RetentionClientOptions;
  private state: RetentionClientState = freeze({ phase: "idle", query: null, result: null, pending: null,
    canWrite: false, canEndRejectedAttempt: false, message: "请明确读取资料保留设置；不会自动提交或删除资料。" });
  private listeners = new Set<() => void>();
  private generation = 0;
  private lease: Lease | null = null;
  private initialized = false;
  private disposed = false;
  private pending: RetentionClientPending | null = null;
  private pendingRaw: string | null = null;
  private rejected: RetentionClientPending | null = null;

  constructor(options: RetentionClientOptions) {
    this.storageKey = retentionClientPendingKey(options.siteId, options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.storage !== "function" || typeof options.apiFetch !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("invalid_options");
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    if (!this.disposed) this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  private publish(patch: Omit<RetentionClientState, "pending" | "canEndRejectedAttempt">) {
    const current = this.state = freeze({ ...patch, pending: this.pending,
      canEndRejectedAttempt: this.pending !== null && this.rejected === this.pending });
    for (const fn of [...this.listeners]) {
      if (current !== this.state || this.disposed) break;
      try { fn(); } catch { /* Observers do not authorize side effects. */ }
    }
  }
  pause = () => {
    const generation = ++this.generation, lease = this.lease; this.lease = null; this.rejected = null;
    if (lease) { clearTimeout(lease.timer); lease.controller.abort(); }
    if (generation === this.generation) this.publish({ phase: this.pending ? "unconfirmed" : "idle", query: null, result: null,
      canWrite: false, message: "已清除显示；待确认原编号保留，不自动重发。" });
  };
  invalidate = this.pause;
  dispose = () => { if (this.disposed) return; this.disposed = true; this.pause(); this.listeners.clear(); };
  hasLeaveRisk = () => {
    if (this.pending || this.lease) return true;
    try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; }
  };
  private begin(): Lease | null {
    if (this.disposed) return null;
    if (hidden()) { this.pause(); return null; }
    if (this.lease) return null;
    const controller = new AbortController(), timeout = this.options.timeoutMs ?? 12000;
    const lease = { generation: ++this.generation, controller, deadline: performance.now() + timeout,
      timer: setTimeout(() => controller.abort(), timeout) };
    this.lease = lease; return lease;
  }
  private guard(lease: Lease) {
    if (lease.generation === this.generation && hidden()) this.pause();
    if (this.disposed || this.lease !== lease || lease.generation !== this.generation
      || lease.controller.signal.aborted || performance.now() >= lease.deadline) throw Error("aborted_or_timeout");
  }
  private release(lease: Lease) { clearTimeout(lease.timer); if (this.lease === lease) this.lease = null; }
  private async race<T>(lease: Lease, work: () => Promise<T>): Promise<T> {
    let stop!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      stop = () => reject(Error("aborted_or_timeout")); lease.controller.signal.addEventListener("abort", stop, { once: true });
    });
    try {
      this.guard(lease);
      const result = await Promise.race([Promise.resolve().then(() => { this.guard(lease); return work(); }), aborted]);
      this.guard(lease); return result;
    } finally { lease.controller.signal.removeEventListener("abort", stop); }
  }
  private stored(lease: Lease) {
    this.guard(lease); const storage = this.options.storage(); this.guard(lease);
    const raw = storage.getItem(this.storageKey); this.guard(lease); return { storage, raw };
  }
  private verify(lease: Lease) {
    const saved = this.stored(lease); if (saved.raw !== this.pendingRaw) throw new StorageChanged("changed_pending"); return saved.storage;
  }
  private query(raw: RetentionQuery) {
    const query = parseRetentionQuery(raw); if (query.siteId !== this.options.siteId) throw Error("wrong_scope"); return query;
  }
  private decode(raw: string): RetentionClientPending {
    if (new TextEncoder().encode(raw).byteLength > RETENTION_BODY_LIMIT + 1024) throw new StorageChanged("oversized_pending");
    const pending = exact(parseCaptureBrowserJson(raw), ["version", "actorId", "query", "command"]);
    if (pending.version !== 1 || pending.actorId !== this.options.actorId) throw new StorageChanged("wrong_pending_identity");
    const query = this.query(pending.query as RetentionQuery), command = parseRetentionCommand(pending.command);
    if (!same(query, retentionWriteQuery(command))) throw new StorageChanged("wrong_pending_command");
    return freeze({ version: 1, actorId: this.options.actorId, query, command });
  }
  initialize = async () => {
    const lease = this.begin(); if (!lease) return;
    try {
      const { raw } = this.stored(lease);
      if (this.initialized && raw !== this.pendingRaw) throw new StorageChanged("changed_pending");
      const pending = raw === null ? null : this.decode(raw); this.guard(lease);
      this.pending = pending; this.pendingRaw = raw; this.initialized = true; this.rejected = null;
      this.publish({ phase: pending ? "unconfirmed" : "idle", query: null, result: null, canWrite: false,
        message: pending ? "发现待确认原编号，请明确读取原回执；不会自动重发。" : "请明确读取资料保留设置；不会自动提交或删除资料。" });
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  private failed(error: unknown, lease: Lease) {
    if (this.disposed || lease.generation !== this.generation) return;
    if (hidden()) { this.pause(); return; }
    this.publish({ phase: this.pending ? "unconfirmed" : "blocked", query: null, result: null, canWrite: false,
      message: error instanceof StorageChanged ? "恢复存储不可用或已改变；未覆盖或删除原记录，请保留编号核验。"
        : this.pending ? this.rejected === this.pending ? "服务器明确拒绝本次提交；原编号保留，可明确结束此次被拒尝试。"
          : "结果尚未确认，保留原编号；请读取原回执，不会自动重发。"
          : "无法核对当前资料、身份或权限；旧显示已清除，请重新读取。" });
  }
  private async request(lease: Lease, query: RetentionQuery, command: RetentionCommand | null) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    lease.controller.signal.addEventListener("abort", cancel, { once: true });
    const run = async () => {
      this.guard(lease); this.verify(lease);
      const response = await this.options.apiFetch(RETENTION_API + (command ? "" : "?" + retentionQueryString(query)), {
        method: command ? "POST" : "GET", headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) },
        ...(command ? { body: JSON.stringify({ query, command }) } : {}), signal: lease.controller.signal, cache: "no-store", redirect: "error",
      });
      if (lease.controller.signal.aborted || response.redirected || response.ok && response.status !== 200
        || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
      }
      try { this.guard(lease); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
      const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      while (true) {
        const part = await reader.read(); this.guard(lease); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > (response.status === 200 ? RETENTION_RESULT_LIMIT : 4096)) throw Error("response_too_large");
        text += decoder.decode(part.value, { stream: true });
      }
      const raw = parseCaptureBrowserJson(text + decoder.decode()); this.guard(lease);
      if (response.status !== 200) {
        const error = exact(raw, ["ok", "error"]);
        if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(RETENTION_ERRORS, error.error)
          || RETENTION_ERRORS[error.error] !== response.status) throw Error("invalid_error");
        throw new Rejected(error.error);
      }
      return parseRetentionResponse(raw, query, this.options.actorId, command);
    };
    try { return await this.race(lease, run); }
    finally {
      lease.controller.signal.removeEventListener("abort", cancel); cancel();
      try { reader?.releaseLock(); } catch { /* Pending reads are cancelled without an unbounded wait. */ }
    }
  }
  private clear(lease: Lease) {
    const storage = this.verify(lease); this.guard(lease); storage.removeItem(this.storageKey); this.guard(lease);
    if (this.stored(lease).raw !== null) throw new StorageChanged("pending_not_cleared");
    this.pending = null; this.pendingRaw = null; this.rejected = null;
  }
  private async verifyReceipt(lease: Lease, pending: RetentionClientPending, result: RetentionResult) {
    if (!result.receipt || result.siteId !== pending.command.siteId || result.actorId !== pending.actorId
      || result.receipt.actorId !== pending.actorId) throw Error("wrong_receipt_identity");
    const digest = await this.race(lease, () => globalThis.crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(retentionCommandFingerprintText(pending.command))));
    const fingerprint = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
    this.guard(lease); this.verify(lease);
    if (this.pending !== pending || !retentionReceiptMatches(result.receipt, pending.command, fingerprint)) throw Error("wrong_receipt");
  }
  load = async (rawQuery: RetentionQuery) => {
    const lease = this.begin(); if (!lease) return;
    try {
      if (!this.initialized) throw Error("uninitialized"); this.verify(lease); const query = this.query(rawQuery);
      if (this.pending && query.mode !== "recover") throw Error("pending_requires_recovery"); this.rejected = null;
      this.publish({ phase: "loading", query: null, result: null, canWrite: false, message: "正在重新授权并读取资料保留信息…" }); this.guard(lease);
      const response = await this.request(lease, query, null); this.guard(lease); this.verify(lease);
      // Independent operation lookup never retires any local pending command.
      this.publish({ phase: this.pending ? "unconfirmed" : "ready", query, result: response.result,
        canWrite: !this.pending && this.options.enabled && response.canWrite && response.result.canWrite,
        message: query.mode === "recover" ? "已读取所选原编号；无回执不代表失败，结束待确认必须核验本地完整原命令。"
          : "资料已读取；期限仅供预览，保留与解除均只登记元数据，不删除原资料。" });
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  recover = async () => {
    const pending = this.pending; if (!pending || !this.initialized) return;
    const lease = this.begin(); if (!lease) return;
    try {
      this.verify(lease); this.rejected = null;
      const query = this.query({ siteId: this.options.siteId, mode: "recover", operationId: pending.command.operationId });
      this.publish({ phase: "loading", query: null, result: null, canWrite: false, message: "正在按原编号读取回执，不重新提交…" }); this.guard(lease);
      const response = await this.request(lease, query, null); this.guard(lease); this.verify(lease);
      await this.verifyReceipt(lease, pending, response.result); this.guard(lease); this.clear(lease); this.guard(lease);
      this.publish({ phase: "ready", query, result: response.result, canWrite: false,
        message: "原编号、身份及完整命令摘要已核验；未重发，请重新读取当前状态。" });
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  submit = async (rawCommand: RetentionCommand) => {
    const state = this.state;
    if (!this.initialized || this.pending || !this.options.enabled || state.phase !== "ready" || !state.canWrite || !state.query || !state.result) return;
    const lease = this.begin(); if (!lease) return; let sent: RetentionClientPending | null = null;
    try {
      this.verify(lease); const command = parseRetentionCommand(rawCommand), query = this.query(retentionWriteQuery(command));
      if (!retentionClientCommandMatchesRead(state.result, state.query, command)) throw Error("stale_or_wrong_read");
      const pending: RetentionClientPending = freeze({ version: 1, actorId: this.options.actorId, query, command });
      const raw = JSON.stringify(pending); this.decode(raw); this.guard(lease);
      this.publish({ phase: "saving", query: null, result: null, canWrite: false, message: "先保存原编号，再提交一次明确的元数据操作…" }); this.guard(lease);
      const storage = this.verify(lease); this.initialized = false; storage.setItem(this.storageKey, raw); this.guard(lease);
      if (this.stored(lease).raw !== raw) throw new StorageChanged("pending_not_saved");
      this.pending = pending; this.pendingRaw = raw; this.initialized = true; this.rejected = null;
      this.publish({ phase: "saving", query: null, result: null, canWrite: false, message: "原编号已保存，正在提交一次；不删除资料…" });
      this.guard(lease); this.verify(lease); this.guard(lease);
      sent = pending; const response = await this.request(lease, query, command); this.guard(lease); this.verify(lease);
      await this.verifyReceipt(lease, pending, response.result); this.guard(lease); this.clear(lease); this.guard(lease);
      this.publish({ phase: "ready", query, result: response.result, canWrite: false,
        message: "操作回执已核验；只更新保留元数据，请重新读取当前状态后继续。" });
    } catch (error) {
      if (sent && error instanceof Rejected && DEFINITIVE_REJECTIONS.has(error.message)) {
        try { this.guard(lease); this.verify(lease); if (this.pending === sent) this.rejected = sent; } catch { /* Late or foreign errors cannot retire an intent. */ }
      }
      this.failed(error, lease);
    } finally { this.release(lease); }
  };
  endRejectedAttempt = async () => {
    const pending = this.pending; if (!pending || this.rejected !== pending || !this.initialized) return;
    const lease = this.begin(); if (!lease) return;
    try {
      this.verify(lease); this.clear(lease); this.guard(lease);
      this.publish({ phase: "idle", query: null, result: null, canWrite: false,
        message: "已明确结束此次被服务器拒绝的尝试；请重新读取，不自动重发。" });
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
}
