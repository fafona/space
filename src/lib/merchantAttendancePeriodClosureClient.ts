import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parsePeriodClosureQuery, parsePeriodClosureCommand, parsePeriodClosureResponse, periodClosureQueryString, PERIOD_CLOSURE_ERRORS } from "./merchantAttendancePeriodClosure";
import type { PeriodClosureQuery, PeriodClosureCommand, PeriodClosureArtifact, PeriodClosureResult } from "./merchantAttendancePeriodClosure";

export const PERIOD_CLOSURE_CLIENT_API = "/api/merchant-enterprise/attendance/period-closures";
export type PeriodClosureView = PeriodClosureResult & { moduleEnabled: boolean };
type Response = PeriodClosureView;
export type PeriodClosureStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PeriodClosurePending = Readonly<{ format: 1; actorId: string; employeeId: string; employeeAuthUserId: string; query: PeriodClosureQuery; command: PeriodClosureCommand }>;
export type PeriodClosureClientOptions = { siteId: string; access: "owner" | "self"; actorId: string; workerId: string; fromDate: string; throughDate: string;
  enabled: boolean; apiFetch: AttendanceApiFetch; storage: () => PeriodClosureStorage; randomId?: () => string; timeoutMs?: number };
export type PeriodClosureClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  result: Response | null; query: PeriodClosureQuery | null; pending: PeriodClosurePending | null; definitiveRejection: string | null; message: string }>;
type Lease = { generation: number; controller: AbortController };
const hidden = () => typeof document !== "undefined" && document.hidden;
const frozen = <T>(value: T): T => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(frozen); Object.freeze(value); } return value; };
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
class StorageChanged extends Error {}
class Rejected extends Error {}
const definite = new Set(["attendance_version_conflict", "attendance_period_source_changed", "attendance_period_blocked", "attendance_period_sealed", "attendance_period_not_confirmed", "attendance_period_overlap", "attendance_period_limit"]);
export function periodClosurePendingKey(siteId: string, access: "owner" | "self", actorId: string) {
  attendanceSelfSite(siteId); attendanceSelfUuid(actorId); if (access !== "owner" && access !== "self") throw Error("attendance_invalid_request");
  return `faolla:attendance:period-closures:v1:${siteId}:${access}:${actorId}`;
}
export const periodClosureAllowsMutation = (action: PeriodClosureCommand["action"], enabled: boolean, moduleEnabled: boolean) => action === "reopen" || enabled && moduleEnabled;
// Complete but unresolved material can be sent for employee review. Only an
// unfinished civil period forbids send; every blocker still prevents sealing.
export const periodClosureCanSendPreview = (blockers: readonly string[]) => !blockers.includes("period_in_progress") && !blockers.includes("unresolved_outage");
async function transport(options: PeriodClosureClientOptions, query: PeriodClosureQuery, command: PeriodClosureCommand | null, outer: AbortSignal) {
  const controller = new AbortController(), limit = options.timeoutMs ?? 12000, started = performance.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject: (error: Error) => void = () => {};
  const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); reject(Error("timeout_or_abort")); };
  const interrupted = new Promise<never>((_, no) => { reject = no; }), timer = setTimeout(cancel, limit);
  outer.addEventListener("abort", cancel, { once: true });
  const guard = () => { if (outer.aborted || controller.signal.aborted || performance.now() - started >= limit) throw Error("timeout_or_abort"); };
  const run = async () => {
    guard(); const response = await options.apiFetch(PERIOD_CLOSURE_CLIENT_API + (command ? "" : `?${periodClosureQueryString(query)}`), {
      method: command ? "POST" : "GET", headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify({ query, command }) } : {}), signal: controller.signal, redirect: "error", cache: "no-store",
    });
    if (outer.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    guard(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try { while (true) { const part = await reader.read(); guard(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > (response.status === 200 ? 4194304 : 4096)) throw Error("response_too_large"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    guard(); const raw = parseCaptureBrowserJson(text); guard();
    if (response.status !== 200) {
      const error = captureBrowserExact(raw, ["ok", "error"]);
      if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(PERIOD_CLOSURE_ERRORS, error.error) || PERIOD_CLOSURE_ERRORS[error.error] !== response.status) throw Error("invalid_error_envelope");
      throw new Rejected(error.error);
    }
    return raw;
  };
  try { return await Promise.race([run(), interrupted]); } finally { clearTimeout(timer); outer.removeEventListener("abort", cancel); }
}

/** The period controller never owns a clock controller or persists a report. */
export class AttendancePeriodClosureClient {
  readonly storageKey: string;
  private readonly options: PeriodClosureClientOptions;
  private state: PeriodClosureClientState = frozen({ phase: "idle", result: null, query: null, pending: null, definitiveRejection: null, message: "请明确读取周期；打开页面不会自动提交或读取。" });
  private listeners = new Set<() => void>(); private generation = 0; private controller: AbortController | null = null;
  private pending: PeriodClosurePending | null = null; private raw: string | null = null; private initialized = false; private definitiveRejection: string | null = null;
  constructor(options: PeriodClosureClientOptions) {
    this.storageKey = periodClosurePendingKey(options.siteId, options.access, options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.randomId !== undefined && typeof options.randomId !== "function" || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("attendance_invalid_request");
    this.options = Object.freeze({ ...options }); this.query("list");
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: Omit<PeriodClosureClientState, "pending" | "definitiveRejection">) {
    const state = this.state = frozen({ ...value, pending: this.pending, definitiveRejection: this.definitiveRejection });
    for (const listener of [...this.listeners]) { if (this.state !== state) break; try { listener(); } catch { /* Observers cannot authorize writes. */ } }
  }
  invalidate = (message = "旧资料已清除，请明确重新读取。") => { const g = ++this.generation, previous = this.controller; this.controller = null; previous?.abort();
    if (g === this.generation) this.publish({ phase: this.pending ? "unconfirmed" : "idle", result: null, query: null, message }); };
  pause = () => this.invalidate("周期资料已隐藏；待确认编号保留，不自动读取或重发，不阻止正常打卡。");
  hasLeaveRisk = () => { if (this.pending || this.controller) return true; try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(): Lease | null { if (hidden()) { this.pause(); return null; } if (this.controller) return null;
    const l = { generation: ++this.generation, controller: new AbortController() }; this.controller = l.controller; return l; }
  private guard(l: Lease) { if (l.generation === this.generation && hidden()) this.pause();
    if (l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted) throw Error("aborted"); }
  private release(l: Lease) { if (l.generation === this.generation && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease) { this.guard(l); const storage = this.options.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l); return { storage, raw }; }
  private verify(l: Lease) { const value = this.stored(l); if (value.raw !== this.raw) throw new StorageChanged("pending_changed"); return value.storage; }
  private decode(raw: string): PeriodClosurePending {
    if (new TextEncoder().encode(raw).byteLength > 8192) throw new StorageChanged("invalid_pending");
    const p = captureBrowserExact(parseCaptureBrowserJson(raw), ["format", "actorId", "employeeId", "employeeAuthUserId", "query", "command"]);
    if (p.format !== 1 || p.actorId !== this.options.actorId) throw new StorageChanged("invalid_pending");
    const query = parsePeriodClosureQuery(p.query), command = parsePeriodClosureCommand(query, p.command);
    const employeeId = attendanceSelfUuid(p.employeeId), employeeAuthUserId = attendanceSelfUuid(p.employeeAuthUserId);
    if (query.siteId !== this.options.siteId || query.access !== this.options.access || query.mode !== "detail" || query.operationId !== null || query.periodId !== command.periodId
      || this.options.access === "self" && employeeId !== this.options.actorId) throw new StorageChanged("pending_scope");
    return frozen({ format: 1, actorId: this.options.actorId, employeeId, employeeAuthUserId, query, command });
  }
  initialize = async () => { const l = this.begin(); if (!l) return; try { const { raw } = this.stored(l);
    if (this.pending && raw !== this.raw) throw new StorageChanged("pending_changed"); const pending = raw === null ? null : this.decode(raw); this.guard(l);
    this.pending = pending; this.raw = raw; this.initialized = true; this.definitiveRejection = null;
    this.publish({ phase: pending ? "unconfirmed" : "idle", result: null, query: null, message: pending ? "发现本标签页待确认原编号，请明确核对；不会自动重发。" : "请明确读取周期列表或预览完整资料。" });
  } catch (e) { this.failed(e, l); } finally { this.release(l); } };
  private query(mode: PeriodClosureQuery["mode"], periodId: string | null = null, version: number | null = null, operationId: string | null = null) {
    const { siteId, access, workerId, fromDate, throughDate } = this.options;
    return parsePeriodClosureQuery({ siteId, access, workerId, fromDate, throughDate, mode, periodId, operationId, version });
  }
  private async fetch(l: Lease, query: PeriodClosureQuery, command: PeriodClosureCommand | null, expected: PeriodClosureCommand | null = command) {
    this.guard(l); const started = performance.now(), raw = await transport(this.options, query, command, l.controller.signal); this.guard(l); this.verify(l);
    const parsed = parsePeriodClosureResponse(raw, query, this.options.access === "owner" ? { ownerId: this.options.actorId } : { employeeId: this.options.actorId }, expected);
    const result: Response = { ...parsed.data, moduleEnabled: parsed.moduleEnabled };
    this.guard(l); if (performance.now() - started >= (this.options.timeoutMs ?? 12000)) throw Error("timeout");
    const p = this.pending;
    if (p && result.kind === "detail" && (result.period.employeeId !== p.employeeId || result.period.employeeAuthUserId !== p.employeeAuthUserId)) throw Error("identity_changed");
    return result;
  }
  private found(result: Response, p: PeriodClosurePending) {
    if (result.kind !== "detail" || !result.operation) return false;
    if (result.operation.operationId !== p.command.operationId || !same(result.operation.command, p.command)) throw Error("receipt_mismatch"); return true;
  }
  private clear(l: Lease) { const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw new StorageChanged("pending_not_cleared"); this.pending = null; this.raw = null; this.definitiveRejection = null; }
  private failed(error: unknown, l: Lease) { if (l.generation !== this.generation) return; if (hidden()) { this.pause(); return; }
    this.publish({ phase: this.pending ? "unconfirmed" : "blocked", query: null, result: null, message: error instanceof StorageChanged
      ? "恢复存储不可用或内容已变化；未覆盖原编号，暂不能开始新操作。"
      : this.pending ? "操作结果待核验；原编号与内容保留，请明确查询。来源变化、封存冲突或权限错误不会自动重发。"
        : "周期资料、身份或权限无法核对；旧资料已清除，请重新读取。" }); }
  private async get(query: PeriodClosureQuery) { const l = this.begin(); if (!l) return; try {
    if (!this.initialized) throw Error("not_initialized"); this.verify(l);
    if (this.pending && query.mode !== "recover") throw Error("pending");
    if (!this.options.enabled && query.mode === "preview") throw Error("disabled");
    this.publish({ phase: "loading", result: null, query: null, message: "正在重新授权读取指定周期；不会提交新操作…" }); this.guard(l);
    const result = await this.fetch(l, query, null, query.mode === "recover" ? this.pending?.command ?? null : null);
    if (this.pending && query.mode === "recover" && this.found(result, this.pending)) this.clear(l); this.guard(l);
    this.publish({ phase: this.pending ? "unconfirmed" : "ready", result, query, message: this.pending ? "未找到可核验的原操作；未查到不等于失败，原编号仍保留。" : "已读取本次周期资料；核对、争议与封存都须明确操作。" });
  } catch (e) { this.failed(e, l); } finally { this.release(l); } }
  list = async () => { try { await this.get(this.query("list")); } catch { this.invalidate("周期查询条件无效。"); } };
  preview = async (periodId: string | null = null) => { try { await this.get(this.query("preview", periodId)); } catch { this.invalidate("周期预览条件无效。"); } };
  detail = async (periodId: string, version: number | null = null) => { try { await this.get(this.query("detail", periodId, version)); } catch { this.invalidate("周期或版本编号无效。"); } };
  recover = async () => { const p = this.pending; if (!p) return; try { await this.get(parsePeriodClosureQuery({ ...p.query, mode: "recover", version: null, operationId: p.command.operationId })); } catch { this.invalidate("原编号无法核对，仍保留待确认命令。"); } };
  submit = async (action: PeriodClosureCommand["action"], reason: string) => {
    const result = this.state.result;
    if (!this.initialized || this.pending || this.state.phase !== "ready" || !result || !periodClosureAllowsMutation(action, this.options.enabled, result.moduleEnabled)) return;
    const viewed = this.state.query;
    if (!viewed || viewed.workerId !== this.options.workerId || viewed.fromDate !== this.options.fromDate || viewed.throughDate !== this.options.throughDate) return;
    const owner = this.options.access === "owner";
    if (owner ? !["send", "respond", "seal", "reopen"].includes(action) : !["confirm", "dispute"].includes(action)) return;
    const artifact = result.kind === "preview" ? result.preview.artifact : result.kind === "detail" ? result.artifact : null;
    const period = result.kind === "detail" ? result.period : result.kind === "preview" ? result.preview.period : null;
    if (action === "send" ? result.kind !== "preview" || !periodClosureCanSendPreview(result.preview.blockers) : !period) return;
    if (action !== "send" && result.kind === "detail" && result.artifactVersion !== null && result.artifactVersion !== period?.currentVersion) return;
    if ((action === "confirm" || action === "seal") && !artifact) return;
    const l = this.begin(); if (!l) return;
    try {
      const id = () => attendanceSelfUuid((this.options.randomId ?? (() => crypto.randomUUID()))());
      const operationId = id(); this.guard(l); const periodId = period?.periodId ?? this.state.query?.periodId ?? id(); this.guard(l);
      const q = this.query("detail", periodId);
      const command = parsePeriodClosureCommand(q, { action, operationId, periodId, expectedRevision: period?.revision ?? 0, expectedVersion: period?.currentVersion ?? 0,
        expectedFingerprint: ["send", "confirm", "seal"].includes(action) ? artifact?.sourceFingerprint ?? null : null, reason });
      const identity = period ?? artifact?.worker; if (!identity) throw Error("identity_missing");
      const employeeId = attendanceSelfUuid(identity.employeeId), employeeAuthUserId = attendanceSelfUuid(identity.employeeAuthUserId);
      if (!owner && employeeId !== this.options.actorId) throw Error("identity_changed");
      this.publish({ phase: "saving", result: null, query: null, message: "准备明确操作，先保存原编号…" }); this.guard(l);
      const storage = this.verify(l); this.guard(l);
      this.definitiveRejection = null; this.pending = frozen({ format: 1, actorId: this.options.actorId, employeeId, employeeAuthUserId, query: q, command }); this.raw = JSON.stringify(this.pending);
      if (new TextEncoder().encode(this.raw).byteLength > 8192) throw new StorageChanged("pending_too_large");
      storage.setItem(this.storageKey, this.raw); this.guard(l); this.verify(l);
      this.publish({ phase: "saving", result: null, query: null, message: "原编号已保存，正在提交一次明确操作…" }); this.guard(l); this.verify(l);
      const saved = await this.fetch(l, q, command); if (!this.found(saved, this.pending)) throw Error("receipt_missing"); this.clear(l); this.guard(l);
      this.publish({ phase: "ready", result: saved, query: q, message: "已核验原操作收据；保存版本不会自动改变，也不等于工资结算。" });
    } catch (e) {
      if (e instanceof Rejected && definite.has(e.message) && this.pending && l.generation === this.generation && !l.controller.signal.aborted && !hidden()) {
        try { this.verify(l); this.definitiveRejection = e.message; } catch { /* Replaced bytes or lifetime never authorize local retirement. */ }
      }
      this.failed(e, l);
    } finally { this.release(l); }
  };
  endAttempt = async () => { if (!this.pending || !this.definitiveRejection) return; const l = this.begin(); if (!l) return;
    try { this.verify(l); this.clear(l); this.guard(l); this.publish({ phase: "idle", result: null, query: null, message: "已结束这次明确未成功的本地尝试；未撤销任何已保存事实，请重新预览／读取后再明确操作。" }); }
    catch (e) { this.failed(e, l); } finally { this.release(l); } };
  exportVersion = async (periodId: string, version: number, fingerprint: string, deliver: (artifact: PeriodClosureArtifact, signal: AbortSignal, authorized: () => boolean) => void | Promise<void>) => {
    if (this.pending || !this.initialized) return; const l = this.begin(); if (!l) return;
    try { this.verify(l); const q = this.query("export", periodId, version);
      this.publish({ phase: "loading", result: null, query: null, message: "正在独立核验导出权限并读取指定保存版本，不重算当前工时…" }); this.guard(l);
      const r = await this.fetch(l, q, null);
      if (r.kind !== "detail" || r.artifactVersion !== version || !r.artifact || r.artifact.sourceFingerprint !== fingerprint) throw Error("export_version_mismatch");
      this.guard(l); await deliver(r.artifact, l.controller.signal, () => l.generation === this.generation && !l.controller.signal.aborted && !hidden()); this.guard(l);
      this.publish({ phase: "ready", result: r, query: q, message: "已请求浏览器输出指定保存版本；请自行确认下载或打印是否完成，不会自动重试。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
}
