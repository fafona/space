import type { RuleCapturesQuery, RuleCapturesCommand } from "./merchantAttendanceRuleCaptures";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite } from "./merchantAttendanceSelf";
import { parseRuleSourcesQuery, parseRuleSourcesResponse, ruleSourcesQueryString, RULE_SOURCES_ERRORS, type RuleSourcesResponse } from "./merchantAttendanceRuleSources";
import { CAPTURE_BROWSER_ERRORS, captureBrowserExact, captureBrowserUuid, parseCaptureBrowserQuery, parseCaptureBrowserCommand,
  parseCaptureBrowserJson, parseCompactRuleCaptureResponse, sameCaptureBrowserCommand, type CompactRuleCaptureResponse } from "./merchantAttendanceRuleCapturesBrowser";

export type RuleCapturesStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type RuleCapturesClientOptions = { siteId: string; ownerId: string; workerId: string; apiFetch: AttendanceApiFetch;
  storage: () => RuleCapturesStorage; timeoutMs?: number; operationId?: () => string };
export type RuleCapturesPending = { query: RuleCapturesQuery; command: RuleCapturesCommand };
export type RuleCapturesClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  source: RuleSourcesResponse | null; result: CompactRuleCaptureResponse | null; pending: RuleCapturesPending | null; recoveryId: string | null; message: string }>;
type Lease = { generation: number; controller: AbortController };
type Slot = { version: 1; siteId: string; ownerId: string; workerId: string; pending: RuleCapturesPending | null; latestId: string | null };
const endpoint = "/api/merchant-enterprise/attendance/rule-captures", sourceEndpoint = "/api/merchant-enterprise/attendance/rule-sources";
const hidden = () => typeof document !== "undefined" && document.hidden;
const definitiveFresh = new Set(["attendance_invalid_request", "attendance_platform_paused", "attendance_rule_capture_incomplete", "attendance_rule_capture_limit", "attendance_rule_capture_worker_inactive"]);
const freshRejectionMessage: Readonly<Record<string, string>> = Object.freeze({
  attendance_invalid_request: "本次未保存：输入内容不合法，请重新核对日期、人员身份与理由后再操作。",
  attendance_platform_paused: "本次未保存：当前保存功能已暂停，请确认开放状态后重新预读。",
  attendance_rule_capture_incomplete: "本次未保存：来源未完整取得，请缩短日期范围并重新核对。",
  attendance_rule_capture_limit: "本次未保存：凭据容量已达到上限，请核对当前限制；不会自动重试。",
  attendance_rule_capture_worker_inactive: "本次未保存：目标员工或考勤档案已停用，请重新核对人员状态。",
});
class Rejected extends Error {}
class StorageChanged extends Error {}
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

// One deadline covers headers, all streamed fatal-UTF8 body bytes, parsing and
// WebCrypto. Aborting does not cancel digest itself, but cannot publish it late.
async function request<T>(apiFetch: AttendanceApiFetch, url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number,
  limit: number, errors: Readonly<Record<string, number>>, decode: (raw: unknown) => T | Promise<T>): Promise<T> {
  const controller = new AbortController(), until = performance.now() + timeoutMs;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (error: Error) => void = () => {};
  const cancel = (code: string) => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error(code)); };
  const abort = () => cancel("aborted"), deadline = new Promise<never>((_, reject) => { rejectCancel = reject; });
  const timer = setTimeout(() => cancel("timeout"), timeoutMs); signal.addEventListener("abort", abort, { once: true });
  const check = () => { if (signal.aborted || controller.signal.aborted) throw Error("aborted"); if (performance.now() >= until) throw Error("timeout"); };
  const run = async () => {
    check();
    const response = await apiFetch(url, { ...init, cache: "no-store", redirect: "error", signal: controller.signal });
    if (signal.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
    }
    check(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const utf8 = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try {
      while (true) {
        const { value, done } = await reader.read(); check(); if (done) break;
        bytes += value.byteLength; if (bytes > (response.status === 200 ? limit : 4096)) throw Error("oversized_response");
        text += utf8.decode(value, { stream: true });
      }
      text += utf8.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    const raw = parseCaptureBrowserJson(text); check();
    if (response.status !== 200) {
      const error = captureBrowserExact(raw, ["ok", "error"]);
      if (error.ok === false && typeof error.error === "string" && Object.hasOwn(errors, error.error) && errors[error.error] === response.status) throw new Rejected(error.error);
      throw Error("invalid_error_envelope");
    }
    const result = await decode(raw); check(); return result;
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

export class AttendanceRuleCapturesClient {
  private state: RuleCapturesClientState = frozen({ phase: "idle", source: null, result: null, pending: null, recoveryId: null,
    message: "请选择日期后明确预读；不会自动保存或恢复网络请求。" });
  private readonly options: Readonly<Required<RuleCapturesClientOptions>>;
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private loaded = false;
  private pending: RuleCapturesPending | null = null;
  private latestId: string | null = null;
  private rawSlot: string | null = null;
  readonly storageKey: string;
  constructor(options: RuleCapturesClientOptions) {
    const c = { ...options }, timeoutMs = c.timeoutMs === undefined ? 12000 : c.timeoutMs;
    if (typeof c.apiFetch !== "function" || typeof c.storage !== "function" || c.operationId !== undefined && typeof c.operationId !== "function"
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000) throw Error("invalid_options");
    this.options = Object.freeze({ siteId: attendanceSelfSite(c.siteId), ownerId: captureBrowserUuid(c.ownerId), workerId: captureBrowserUuid(c.workerId),
      apiFetch: c.apiFetch, storage: c.storage, timeoutMs, operationId: c.operationId ?? (() => crypto.randomUUID()) });
    this.storageKey = `faolla:attendance:rule-captures:v1:${this.options.siteId}:${this.options.ownerId}:${this.options.workerId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(update: Partial<Omit<RuleCapturesClientState, "pending" | "recoveryId">>) {
    const next = { ...this.state, ...update, pending: this.pending, recoveryId: this.pending?.query.operationId ?? this.latestId };
    if (Object.keys(next).every(key => next[key as keyof typeof next] === this.state[key as keyof RuleCapturesClientState])) return;
    const snapshot = this.state = frozen(next);
    for (const listener of [...this.listeners]) { if (this.state !== snapshot) break; try { listener(); } catch { /* An observer never controls persistence or request authorization. */ } }
  }
  invalidate = (text = "条件已改变，旧来源和凭据已隐藏；请明确重新读取或恢复原编号。") => {
    const generation = ++this.generation, previous = this.controller; this.controller = null; previous?.abort();
    if (generation !== this.generation) return;
    this.publish({ source: null, result: null, phase: this.pending ? "unconfirmed" : "idle", message: typeof text === "string" ? text : "资料已隐藏。" });
  };
  pause = () => this.invalidate("资料已隐藏；已发送操作不撤销。返回后仅明确查询原编号，不自动重发。");
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
    try {
      this.guard(lease); const storage = this.options.storage(); this.guard(lease);
      const raw = storage.getItem(this.storageKey); this.guard(lease);
      if (raw !== null && typeof raw !== "string") throw Error("invalid_storage"); return { storage, raw };
    } catch { throw new StorageChanged("storage_unavailable"); }
  }
  private verify(lease: Lease) { const stored = this.stored(lease); if (stored.raw !== this.rawSlot) throw new StorageChanged("storage_changed"); return stored.storage; }
  private slot(pending: RuleCapturesPending | null, latestId = this.latestId): Slot {
    return { version: 1, siteId: this.options.siteId, ownerId: this.options.ownerId, workerId: this.options.workerId, pending, latestId };
  }
  private decode(raw: string): Slot {
    if (new TextEncoder().encode(raw).byteLength > 8192) throw new StorageChanged("invalid_storage");
    const s = captureBrowserExact(parseCaptureBrowserJson(raw), ["version", "siteId", "ownerId", "workerId", "pending", "latestId"]);
    if (s.version !== 1 || s.siteId !== this.options.siteId || s.ownerId !== this.options.ownerId || s.workerId !== this.options.workerId) throw new StorageChanged("storage_identity");
    const latestId = s.latestId === null ? null : captureBrowserUuid(s.latestId); let pending: RuleCapturesPending | null = null;
    if (s.pending !== null) {
      const p = captureBrowserExact(s.pending, ["query", "command"]), query = parseCaptureBrowserQuery(p.query), command = parseCaptureBrowserCommand(p.command);
      if (query.siteId !== s.siteId || query.workerId !== s.workerId || query.operationId !== command.operationId) throw new StorageChanged("storage_identity");
      pending = frozen({ query, command });
    }
    return this.slot(pending, latestId);
  }
  private load(lease: Lease) {
    const stored = this.stored(lease);
    if (this.loaded || this.pending) { if (stored.raw !== this.rawSlot) throw new StorageChanged("storage_changed"); return; }
    try {
      const slot = stored.raw === null ? this.slot(null, null) : this.decode(stored.raw); this.guard(lease);
      this.pending = slot.pending; this.latestId = slot.latestId; this.rawSlot = stored.raw; this.loaded = true;
    } catch { throw new StorageChanged("storage_invalid"); }
  }
  private persistPending(pending: RuleCapturesPending, lease: Lease) {
    const storage = this.verify(lease), raw = JSON.stringify(this.slot(pending)); this.guard(lease);
    // Keep the proposed original number if setItem writes then throws/pauses.
    this.pending = frozen(pending); this.rawSlot = raw;
    try { storage.setItem(this.storageKey, raw); this.guard(lease); this.verify(lease); }
    catch { throw new StorageChanged("pending_not_persisted"); }
  }
  private settle(lease: Lease, operationId: string | null) {
    const storage = this.verify(lease), nextId = operationId ?? this.latestId, raw = JSON.stringify(this.slot(null, nextId)); this.guard(lease);
    try {
      storage.setItem(this.storageKey, raw); this.guard(lease);
      if (this.stored(lease).raw !== raw) throw Error("storage_changed"); this.guard(lease);
      this.rawSlot = raw; this.pending = null; this.latestId = nextId;
    } catch { throw new StorageChanged("pending_not_settled"); }
  }
  private failed(error: unknown, lease: Lease) {
    if (lease.generation !== this.generation) return; if (hidden()) { this.pause(); return; }
    const code = error instanceof Error ? error.message : "";
    this.publish({ source: null, result: null, phase: error instanceof StorageChanged ? "blocked" : this.pending ? "unconfirmed" : "blocked",
      message: error instanceof StorageChanged ? "待确认存储不可读、已变化或未能安全更新；不会覆盖或继续提交。请保留原编号并核对当前身份与存储。"
        : code === "attendance_access_denied" || code === "attendance_rule_capture_identity_changed" || code === "attendance_personal_rule_identity_changed"
          ? "当前负责人或员工身份已变化；资料已隐藏，原编号保留，不会自动重发。"
          : "未能可靠完成核验；资料已隐藏。请核对原编号后明确恢复，不会自动生成或提交另一编号。" });
  }
  initialize = async () => {
    const lease = this.begin(); if (!lease) return;
    try {
      this.load(lease); this.guard(lease);
      this.publish({ source: null, result: null, phase: this.pending ? "unconfirmed" : "idle", message: this.pending
        ? "发现本会话待确认原编号；请明确查询收据，不会自动请求或重发。" : this.latestId ? "发现本会话最近一次凭据编号；可明确恢复，尚未请求服务器。" : "请选择日期后明确预读；没有自动网络请求。" });
      this.guard(lease);
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  read = async (fromDate: string, throughDate: string) => {
    const lease = this.begin(); if (!lease) return;
    try {
      this.load(lease); this.guard(lease); if (this.pending) return;
      const query = parseRuleSourcesQuery({ siteId: this.options.siteId, workerId: this.options.workerId, fromDate, throughDate });
      this.publish({ source: null, result: null, phase: "loading", message: "正在明确预读当前候选来源；尚未保存凭据。" }); this.guard(lease); this.verify(lease); this.guard(lease);
      const source = await request(this.options.apiFetch, `${sourceEndpoint}?${ruleSourcesQueryString(query)}`, { method: "GET", headers: { Accept: "application/json" } },
        lease.controller.signal, this.options.timeoutMs, 1049600, RULE_SOURCES_ERRORS, raw => parseRuleSourcesResponse(raw, query, this.options.ownerId));
      this.guard(lease); this.verify(lease); this.guard(lease);
      this.publish({ source, result: null, phase: "ready", message: "预读完成。保存时服务器将重新读取当前来源；不代表规则已应用或过去实际生效。" }); this.guard(lease);
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  capture = async (reason: string) => {
    if (hidden()) { this.pause(); return; }
    const source = this.state.source;
    if (this.pending || this.state.phase !== "ready" || !source?.moduleEnabled || !source.worker.active || !source.worker.employeeActive
      || !source.worker.employeeId || !source.worker.employeeAuthUserId || source.assignments.limited || source.rules.limited || source.personal.limited) return;
    const lease = this.begin(); if (!lease) return;
    try {
      this.load(lease); this.guard(lease); if (this.pending) return;
      this.publish({ source: null, result: null, phase: "saving", message: "正在按新编号保存当前来源；尚未确认服务器结果。" }); this.guard(lease); this.verify(lease); this.guard(lease);
      const operationId = this.options.operationId(); this.guard(lease);
      const query = parseCaptureBrowserQuery({ siteId: this.options.siteId, workerId: this.options.workerId, operationId });
      const command = parseCaptureBrowserCommand({ operationId, fromDate: source.fromDate, throughDate: source.throughDate, reason,
        employeeId: source.worker.employeeId, employeeAuthUserId: source.worker.employeeAuthUserId }); this.guard(lease);
      this.persistPending({ query, command }, lease); this.guard(lease); await this.captureRequest(lease, query, command, true);
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  private async captureRequest(lease: Lease, query: RuleCapturesQuery, command: RuleCapturesCommand | null, fresh = false): Promise<CompactRuleCaptureResponse | null> {
    try {
      this.publish({ source: null, result: null, phase: command ? "saving" : "loading", message: command ? "正在提交已保存的原编号与原内容…" : "正在明确查询原编号；不会自动保存…" });
      this.guard(lease); this.verify(lease); this.guard(lease);
      if (command && (!this.pending || this.pending.query.operationId !== query.operationId || !sameCaptureBrowserCommand(command, this.pending.command))) throw Error("pending_mismatch");
      const result = await request(this.options.apiFetch, endpoint + (command ? "" : "?" + new URLSearchParams(query)), command
        ? { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ query, command }) }
        : { method: "GET", headers: { Accept: "application/json" } }, lease.controller.signal, this.options.timeoutMs, 6 * 1048576 + 65536,
      CAPTURE_BROWSER_ERRORS, raw => parseCompactRuleCaptureResponse(raw, query, this.options.ownerId, command));
      this.guard(lease); this.verify(lease); this.guard(lease);
      if (result.receipt) {
        if (this.pending && !sameCaptureBrowserCommand(this.pending.command, result.receipt.command)) throw Error("receipt_mismatch");
        this.settle(lease, query.operationId); this.guard(lease);
      }
      this.publish({ source: null, result, phase: this.pending ? "unconfirmed" : "ready", message: result.receipt
        ? "原始来源凭据已核验；仅固定来源字节，不证明规则已应用或过去实际生效。"
        : this.pending ? "尚未找到原编号收据；待确认内容保留。可明确重试，但不会自动重发。" : "本编号尚无收据；没有执行保存。" });
      this.guard(lease); return result;
    } catch (error) {
      if (fresh && command && error instanceof Rejected && definitiveFresh.has(error.message)) {
        try {
          this.guard(lease); this.settle(lease, null); this.guard(lease);
          this.publish({ source: null, result: null, phase: "blocked", message: freshRejectionMessage[error.message] }); this.guard(lease);
          return null;
        }
        catch (storageError) { this.failed(storageError, lease); return null; }
      }
      this.failed(error, lease); return null;
    }
  }
  recover = async (operationId?: string) => {
    const lease = this.begin(); if (!lease) return;
    try {
      this.load(lease); this.guard(lease);
      const id = captureBrowserUuid(operationId ?? this.pending?.query.operationId ?? this.latestId);
      if (this.pending && id !== this.pending.query.operationId) throw Error("pending_other_operation");
      await this.captureRequest(lease, parseCaptureBrowserQuery({ siteId: this.options.siteId, workerId: this.options.workerId, operationId: id }), null);
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
  retry = async () => {
    const lease = this.begin(); if (!lease) return;
    try {
      this.load(lease); this.guard(lease); const pending = this.pending; if (!pending) return;
      const result = await this.captureRequest(lease, pending.query, null); this.guard(lease);
      // The lease spans both requests. An observer can pause or edit after the
      // unknown GET, preventing the explicit retry's subsequent POST.
      if (!result || result.receipt || !result.moduleEnabled || this.pending !== pending) return;
      this.verify(lease); this.guard(lease); await this.captureRequest(lease, pending.query, pending.command);
    } catch (error) { this.failed(error, lease); } finally { this.release(lease); }
  };
}
