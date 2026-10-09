import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { EMPLOYMENT_LIFECYCLE_API, EMPLOYMENT_LIFECYCLE_BYTE_LIMIT, EMPLOYMENT_LIFECYCLE_ERRORS,
  parseEmploymentLifecycleJson, parseEmploymentLifecycleQuery, parseEmploymentLifecycleCommand, parseEmploymentLifecycleResponse,
  employmentLifecycleQueryString, employmentLifecycleCommandFingerprint, employmentLifecycleReceiptMatches,
  type EmploymentLifecycleQuery, type EmploymentLifecycleCommand, type EmploymentLifecycleResult } from "./merchantAttendanceEmploymentLifecycle";

export type EmploymentLifecycleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type EmploymentLifecycleClientOptions = { siteId: string; actorId: string; apiFetch: AttendanceApiFetch; storage: () => EmploymentLifecycleStorage;
  enabled: boolean; randomId?: () => string; timeoutMs?: number; isCurrentAuth?: () => boolean };
export type EmploymentLifecycleClientPending = { version: 1; siteId: string; actorId: string; command: EmploymentLifecycleCommand; commandFingerprint: string };
export type EmploymentLifecycleClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  query: EmploymentLifecycleQuery | null; result: EmploymentLifecycleResult | null; pending: EmploymentLifecycleClientPending | null; message: string }>;
type Lease = { epoch: number; controller: AbortController };
const definitePostRejections = new Set(["attendance_employment_lifecycle_changed", "attendance_employment_lifecycle_blocked", "attendance_employment_lifecycle_disabled",
  "attendance_version_conflict", "attendance_version_exhausted"]);
// Constructed only after validating an actual HTTP error's exact shape/status.
// A transport Error with a matching message is not evidence of a rejected write.
class ConfirmedLifecycleWriteRejection extends Error {}
const hidden = () => typeof document !== "undefined" && document.hidden;
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function identity(v: string) { if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) || v.length !== 36) throw Error("invalid_identity"); return v; }
function query(siteId: string, patch: Partial<EmploymentLifecycleQuery> = {}) { return parseEmploymentLifecycleQuery({ siteId, mode: "list", workerId: null, afterId: null, afterRevision: null, operationId: null, ...patch }); }
export function employmentLifecyclePendingKey(siteId: string, actorId: string) { query(siteId); return `faolla:attendance:employment-lifecycle:v1:${siteId}:${identity(actorId)}`; }

async function transport(o: EmploymentLifecycleClientOptions, q: EmploymentLifecycleQuery, command: EmploymentLifecycleCommand | null, signal: AbortSignal) {
  const controller = new AbortController(), ms = o.timeoutMs ?? 12000, deadline = performance.now() + ms;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (error: Error) => void;
  const stopped = new Promise<never>((_, r) => { reject = r; });
  const cancel = () => { controller.abort(); reject(Error("aborted_or_timeout")); void reader?.cancel().catch(() => {}); };
  const timer = setTimeout(cancel, ms); signal.addEventListener("abort", cancel, { once: true });
  const guard = () => { if (signal.aborted || controller.signal.aborted || performance.now() >= deadline || o.isCurrentAuth?.() === false) throw Error("stale_scope"); };
  const run = async () => {
    guard(); const response = await o.apiFetch(command ? EMPLOYMENT_LIFECYCLE_API : `${EMPLOYMENT_LIFECYCLE_API}?${employmentLifecycleQueryString(q)}`, {
      method: command ? "POST" : "GET", headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify({ query: q, command }) } : {}), signal: controller.signal, cache: "no-store", redirect: "error" });
    if (signal.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    guard(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    let text = "", bytes = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
    try { while (true) { const part = await reader.read(); guard(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > (response.status === 200 ? EMPLOYMENT_LIFECYCLE_BYTE_LIMIT : 4096)) throw Error("too_large"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    guard(); const raw = parseEmploymentLifecycleJson(text);
    if (response.status !== 200) { const e = captureBrowserExact(raw, ["ok", "error"]);
      if (e.ok !== false || typeof e.error !== "string" || !Object.hasOwn(EMPLOYMENT_LIFECYCLE_ERRORS, e.error) || EMPLOYMENT_LIFECYCLE_ERRORS[e.error] !== response.status) throw Error("invalid_error");
      if (command && definitePostRejections.has(e.error)) throw new ConfirmedLifecycleWriteRejection(e.error); throw Error(e.error); }
    return raw;
  };
  try { return await Promise.race([run(), stopped]); } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}

/** Owner-only intent controller. Unknown writes are never retried or discarded. */
export class AttendanceEmploymentLifecycleClient {
  readonly storageKey: string; private readonly o: EmploymentLifecycleClientOptions;
  private state: EmploymentLifecycleClientState = freeze({ phase: "idle", query: null, result: null, pending: null, message: "请明确读取任职依据，不自动提交或变更其他权限。" });
  private epoch = 0; private controller: AbortController | null = null; private loaded = false; private raw: string | null = null;
  private listeners = new Set<() => void>();
  constructor(options: EmploymentLifecycleClientOptions) {
    this.storageKey = employmentLifecyclePendingKey(options.siteId, options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.randomId !== undefined && typeof options.randomId !== "function" || options.isCurrentAuth !== undefined && typeof options.isCurrentAuth !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("invalid_options");
    this.o = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<EmploymentLifecycleClientState>) { const next = this.state = freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) { if (this.state !== next) break; try { listener(); } catch { /* Subscribers cannot grant write authority. */ } } }
  pause = () => { const epoch = ++this.epoch, previous = this.controller; this.controller = null; this.loaded = false; previous?.abort();
    if (epoch === this.epoch) this.publish({ result: null, query: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "资料已清除；原编号保留，重新核验身份后可只读核对。" }); };
  invalidate = this.pause;
  hasLeaveRisk = () => { if (this.controller || this.state.pending) return true; try { return this.o.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(): Lease | null { if (hidden() || this.o.isCurrentAuth?.() === false) { this.pause(); return null; } if (this.controller) return null;
    const l = { epoch: ++this.epoch, controller: new AbortController() }; this.controller = l.controller; return l; }
  private guard(l: Lease) { if (l.epoch === this.epoch && (hidden() || this.o.isCurrentAuth?.() === false)) this.pause();
    if (l.epoch !== this.epoch || this.controller !== l.controller || l.controller.signal.aborted) throw Error("stale_scope"); }
  private release(l: Lease) { if (l.epoch === this.epoch && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease) { this.guard(l); const storage = this.o.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l); return { storage, raw }; }
  private verify(l: Lease) { const value = this.stored(l); if (value.raw !== this.raw) throw Error("pending_changed"); return value.storage; }
  private failed(l: Lease) { if (l.epoch !== this.epoch) return; if (hidden() || this.o.isCurrentAuth?.() === false) { this.pause(); return; }
    this.publish({ result: null, query: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: this.state.pending
      ? "本次任职结果尚未核实；原编号保留，只能读取原结果。查无回执不等于失败，不会重新提交。"
      : "无法核验当前任职资料或本地待确认编号；旧内容已清除，请重新读取。不要清除未知编号。" }); }
  initialize = async () => {
    const l = this.begin(); if (!l) return; try {
      const { raw } = this.stored(l); if (this.state.pending && raw !== this.raw) throw Error("pending_changed");
      let pending: EmploymentLifecycleClientPending | null = null;
      if (raw !== null) { const p = captureBrowserExact(parseEmploymentLifecycleJson(raw, "request"), ["version", "siteId", "actorId", "command", "commandFingerprint"]);
        if (p.version !== 1 || p.siteId !== this.o.siteId || p.actorId !== this.o.actorId) throw Error("pending_identity");
        const command = parseEmploymentLifecycleCommand(p.command), commandFingerprint = await employmentLifecycleCommandFingerprint(this.o.siteId, command); this.guard(l);
        if (p.commandFingerprint !== commandFingerprint) throw Error("pending_fingerprint"); pending = { version: 1, siteId: this.o.siteId, actorId: this.o.actorId, command, commandFingerprint };
      }
      if (this.stored(l).raw !== raw) throw Error("pending_changed"); this.raw = raw; this.loaded = true;
      this.publish({ pending, result: null, query: null, phase: pending ? "unconfirmed" : "idle", message: pending ? "发现任职原编号，请明确读取原结果；不自动重发。" : "请明确读取人员或任职历史；新操作需核验后确认。" });
    } catch { this.failed(l); } finally { this.release(l); }
  };
  private settle(result: EmploymentLifecycleResult, l: Lease) { const pending = this.state.pending, receipt = result.receipt; if (!pending || !receipt) return;
    if (!employmentLifecycleReceiptMatches(receipt, pending.command, pending.commandFingerprint)) throw Error("receipt_mismatch");
    const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw Error("pending_changed"); this.raw = null; this.publish({ pending: null }); this.guard(l);
  }
  private rejected(pending: EmploymentLifecycleClientPending | null, l: Lease) {
    this.guard(l); if (!pending || this.state.pending !== pending) throw Error("pending_changed");
    const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw Error("pending_changed"); this.raw = null;
    this.publish({ pending: null, result: null, query: null, phase: "blocked", message: "服务端已明确拒绝，本次没有写入；本次待确认标记已解除。请重新读取当前依据，再以新编号明确办理。" });
  }
  private get = async (q: EmploymentLifecycleQuery) => {
    const l = this.begin(); if (!l) return; try {
      if (!this.loaded || this.state.pending && q.mode !== "recover") return; this.verify(l);
      this.publish({ phase: "loading", query: null, result: null, message: "正在读取并核验任职依据…" }); this.guard(l);
      const raw = await transport(this.o, q, null, l.controller.signal); this.guard(l); this.verify(l);
      const result = parseEmploymentLifecycleResponse(raw, q, this.o.actorId); this.settle(result, l); this.guard(l);
      this.publish({ result, query: q, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending ? "尚无匹配回执；原编号保留，不能推断操作失败。"
        : result.receipt ? "已核实原任职操作；这是保存回执，不代表当前已经恢复账号或考勤。" : "已读取当前依据；提交前服务器会重新核验当天、版本与阻断。" });
    } catch { this.failed(l); } finally { this.release(l); }
  };
  load = async (workerId: string | null = null) => { await this.get(query(this.o.siteId, workerId ? { mode: "detail", workerId } : {})); };
  next = async () => { const q = this.state.query, r = this.state.result; if (q?.mode === "list" && r?.nextAfterId) await this.get(query(this.o.siteId, { afterId: r.nextAfterId })); };
  history = async (workerId: string, afterRevision: number | null = null) => { await this.get(query(this.o.siteId, { mode: "history", workerId, afterRevision })); };
  nextHistory = async () => { const q = this.state.query, r = this.state.result; if (q?.mode === "history" && q.workerId && r?.nextAfterRevision) await this.history(q.workerId, r.nextAfterRevision); };
  recover = async () => { const pending = this.state.pending; if (pending) await this.get(query(this.o.siteId, { mode: "recover", operationId: pending.command.operationId })); };
  submit = async (action: EmploymentLifecycleCommand["action"], reason: string) => {
    const d = this.state.result?.detail;
    if (!this.o.enabled || !this.loaded || this.state.pending || !d || this.state.query?.mode !== "detail" || !(action === "close" ? d.canClose : action === "rejoin" && d.canRejoin)
      || !d.suspension?.paused || !d.worker.employeeId || !d.worker.employeeAuthUserId || d.worker.employeeVersion === null) return;
    const period = d.periods.at(-1); if (!period) return;
    const l = this.begin(); if (!l) return; let attempt: EmploymentLifecycleClientPending | null = null; try {
      this.verify(l); const operationId = (this.o.randomId ?? (() => crypto.randomUUID()))(); this.guard(l);
      const command = parseEmploymentLifecycleCommand({ action, operationId, workerId: d.worker.id, employeeId: d.worker.employeeId, employeeAuthUserId: d.worker.employeeAuthUserId,
        expectedWorkerVersion: d.worker.version, expectedEmployeeVersion: d.worker.employeeVersion, expectedSettingsVersion: d.settingsVersion, expectedRevision: d.revision,
        expectedPeriodId: period.id, suspensionId: d.suspension.id, expectedGeneration: d.suspension.generation, expectedDate: d.today, reason: reason.trim() });
      this.publish({ phase: "saving", query: null, result: null, message: "正在保存本次明确任职意图…" }); this.guard(l);
      const commandFingerprint = await employmentLifecycleCommandFingerprint(this.o.siteId, command); this.guard(l);
      const pending: EmploymentLifecycleClientPending = freeze({ version: 1, siteId: this.o.siteId, actorId: this.o.actorId, command, commandFingerprint }), raw = JSON.stringify(pending);
      attempt = pending;
      parseEmploymentLifecycleJson(raw, "request"); const storage = this.verify(l); this.raw = raw; this.publish({ pending }); this.guard(l);
      storage.setItem(this.storageKey, raw); this.guard(l); this.verify(l);
      this.publish({ message: "原编号已保存；只提交这一次，未知结果仅核对原编号。" }); this.guard(l); this.verify(l);
      const q = query(this.o.siteId, { mode: "detail", workerId: command.workerId }), response = await transport(this.o, q, command, l.controller.signal); this.guard(l); this.verify(l);
      const result = parseEmploymentLifecycleResponse(response, q, this.o.actorId, command); this.settle(result, l); this.guard(l);
      this.publish({ result, query: q, phase: "ready", message: action === "close" ? "已确认任职结束；仍保留暂停，未改变历史记录或其他权限。" : "已确认新增任职期；账号、考勤、PIN、委托仍须分别明确处理。" });
    } catch (error) {
      if (error instanceof ConfirmedLifecycleWriteRejection) { try { this.rejected(attempt, l); } catch { this.failed(l); } }
      else this.failed(l);
    } finally { this.release(l); }
  };
}
