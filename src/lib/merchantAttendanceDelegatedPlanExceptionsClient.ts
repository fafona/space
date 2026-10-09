//209 isolated dispatcher sharing the existing actor operation slot. Older
//dispatchers cannot decode this new domain but always retain its occupied slot.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceManagementPendingKey, type ManagementStorage } from "./merchantAttendanceManagementDelegatedClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import * as p from "./merchantAttendanceDelegatedPlanExceptions";
export type DelegatedPlanExceptionsPending = Readonly<{ protocol: "attendance-management-pending-v1"; version: 1; domain: "plan-exceptions";
  actorId: string; query: p.DelegatedPlanExceptionsContextQuery; command: p.DelegatedPlanExceptionsCommand; commandFingerprint: string }>;
export type DelegatedPlanExceptionsClientState = Readonly<{ phase: "idle" | "loading" | "saving" | "ready" | "unconfirmed" | "blocked";
  pending: DelegatedPlanExceptionsPending | null; result: p.DelegatedPlanExceptionsResult | null; message: string }>;
export type DelegatedPlanExceptionsClientOptions = Readonly<{ siteId: string; actorId: string; apiFetch: AttendanceApiFetch; storage: () => ManagementStorage;
  isCurrentAuth: () => boolean; canWrite: () => boolean; onState?: (state: DelegatedPlanExceptionsClientState) => void; timeoutMs?: number }>;
type Lease = Readonly<{ generation: number; controller: AbortController; deadline: number }>;
function fail(): never { throw Error("attendance_management_unconfirmed"); }
const hidden = () => typeof document !== "undefined" && document.hidden;
const yes = (check: () => boolean) => { try { return check() === true; } catch { return false; } };
export class AttendanceDelegatedPlanExceptionsClient {
  readonly storageKey: string; private readonly options: DelegatedPlanExceptionsClientOptions;
  private generation = 0; private controller: AbortController | null = null; private disposed = false; private publishing = false;
  private state: DelegatedPlanExceptionsClientState = freeze({ phase: "idle", pending: null, result: null, message: "请明确读取；初始化不会联网。" });
  constructor(options: DelegatedPlanExceptionsClientOptions) {
    this.storageKey = attendanceManagementPendingKey(options.siteId, options.actorId);
    if ([options.apiFetch, options.storage, options.isCurrentAuth, options.canWrite].some(value => typeof value !== "function")
      || options.onState !== undefined && typeof options.onState !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) fail();
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  private publish(state: DelegatedPlanExceptionsClientState) { this.state = freeze(state); if (this.disposed || this.publishing) return;
    this.publishing = true; try { this.options.onState?.(this.state); } catch { /* Observers do not authorize transport. */ } finally { this.publishing = false; } }
  pause = () => { this.generation++; const prior = this.controller; this.controller = null; prior?.abort();
    this.publish({ phase: "idle", pending: null, result: null, message: "正文已清除；原编号保留，请返回后明确核验。" }); };
  dispose = () => { this.disposed = true; this.pause(); };
  hasLeaveRisk = () => { if (this.controller) return true; try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private guard(lease: Lease, fresh = false) {
    if (this.disposed || lease.generation !== this.generation || lease.controller !== this.controller || lease.controller.signal.aborted) fail();
    if (hidden() || !yes(this.options.isCurrentAuth)) { this.pause(); fail(); }
    if (performance.now() >= lease.deadline) { lease.controller.abort(); fail(); }
    if (fresh && !yes(this.options.canWrite)) fail();
  }
  private stored(lease: Lease, expected?: string | null) {
    this.guard(lease); const storage = this.options.storage(); this.guard(lease); const raw = storage.getItem(this.storageKey); this.guard(lease);
    if (expected !== undefined && raw !== expected) fail(); return { storage, raw };
  }
  private async operation<T>(run: (lease: Lease) => Promise<T>): Promise<T> {
    if (this.controller || this.disposed) fail(); const controller = new AbortController();
    const lease = { generation: ++this.generation, controller, deadline: performance.now() + (this.options.timeoutMs ?? 12000) }; this.controller = controller;
    let reject!: (error: Error) => void; const interrupted = new Promise<never>((_, no) => { reject = no; }), abort = () => reject(Error("cancelled_or_timed_out"));
    controller.signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(() => controller.abort(), Math.max(0, lease.deadline - performance.now()));
    try { return await Promise.race([Promise.resolve().then(() => { this.guard(lease); return run(lease); }), interrupted]); }
    catch { if (!this.disposed && lease.generation === this.generation) {
      if (hidden() || !yes(this.options.isCurrentAuth)) this.pause();
      else this.publish({ phase: "blocked", pending: this.state.pending, result: null, message: "结果尚未核实；保留原编号，只读核验，不要重发。" });
    } return fail(); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); if (this.controller === controller) this.controller = null; }
  }
  private async decode(raw: string, lease: Lease): Promise<DelegatedPlanExceptionsPending> {
    const v = exact(p.parseDelegatedPlanExceptionsJson(raw, false), ["protocol", "version", "domain", "actorId", "query", "command", "commandFingerprint"]);
    if (new TextEncoder().encode(raw).byteLength > p.DELEGATED_PLAN_EXCEPTIONS_REQUEST_BYTES + 1024
      || v.protocol !== "attendance-management-pending-v1" || v.version !== 1 || v.domain !== "plan-exceptions" || v.actorId !== this.options.actorId) fail();
    const pair = p.parseDelegatedPlanExceptionsBody({ query: v.query, command: v.command }), commandFingerprint = await p.delegatedPlanExceptionsCommandFingerprint(pair.query, this.options.actorId, pair.command);
    this.guard(lease); if (pair.query.siteId !== this.options.siteId || commandFingerprint !== v.commandFingerprint) fail();
    return freeze({ protocol: "attendance-management-pending-v1", version: 1, domain: "plan-exceptions", actorId: this.options.actorId, ...pair, commandFingerprint });
  }
  initialize = () => this.operation(async lease => {
    const { raw } = this.stored(lease), pending = raw === null ? null : await this.decode(raw, lease); this.stored(lease, raw);
    this.publish({ phase: pending ? "unconfirmed" : "idle", pending, result: null, message: pending ? "发现原编号，请明确 GET 核验。" : "原编号槽为空；尚未联网。" }); this.stored(lease, raw); return pending;
  });
  private async transport(lease: Lease, query: p.DelegatedPlanExceptionsQuery, command: p.DelegatedPlanExceptionsCommand | null,
    expected: p.DelegatedPlanExceptionsCommand | null = command) {
    this.guard(lease); const response = await this.options.apiFetch(p.DELEGATED_PLAN_EXCEPTIONS_API + (command ? "" : "?" + p.delegatedPlanExceptionsQueryString(query)),
      { method: command ? "POST" : "GET", cache: "no-store", redirect: "error", signal: lease.controller.signal,
        headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) }, ...(command ? { body: JSON.stringify({ query, command }) } : {}) });
    try { this.guard(lease); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
    if (response.redirected || response.ok && response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); fail();
    }
    const maximum = response.status === 200 ? p.DELEGATED_PLAN_EXCEPTIONS_RESULT_BYTES : 4096, reader = response.body?.getReader(); if (!reader) fail();
    let text = "", bytes = 0; const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }), cancel = () => { void reader.cancel().catch(() => {}); };
    lease.controller.signal.addEventListener("abort", cancel, { once: true });
    try { while (true) { const part = await reader.read(); this.guard(lease); if (part.done) break; bytes += part.value.byteLength; if (bytes > maximum) fail(); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    finally { cancel(); lease.controller.signal.removeEventListener("abort", cancel); try { reader.releaseLock(); } catch { /* Do not mask cancellation. */ } }
    const raw = p.parseDelegatedPlanExceptionsJson(text, false);
    if (response.status !== 200) { const e = exact(raw, ["ok", "error"]), error = exact(e.error, ["code", "message"]), errors: Readonly<Record<string, number>> = { ...p.DELEGATED_PLAN_EXCEPTIONS_ERRORS, attendance_rate_limited: 429 };
      if (e.ok !== false || typeof error.code !== "string" || errors[error.code] !== response.status || typeof error.message !== "string" || error.message.length > 512) fail(); return fail(); }
    const v = exact(raw, ["ok", "data"]); if (v.ok !== true) fail();
    const result = await p.parseDelegatedPlanExceptionsResult(v.data, query, this.options.actorId, expected); this.guard(lease); return result;
  }
  readContext = (raw: p.DelegatedPlanExceptionsContextQuery) => {
    const query = p.parseDelegatedPlanExceptionsQuery(raw); if (query.siteId !== this.options.siteId || query.mode !== "context") fail();
    return this.operation(async lease => { this.stored(lease, null); this.guard(lease, true);
      this.publish({ phase: "loading", pending: null, result: null, message: "正在明确读取此授权的唯一人员／排班。" }); this.stored(lease, null);
      const result = await this.transport(lease, query, null); this.stored(lease, null);
      this.publish({ phase: "ready", pending: null, result, message: "当前资料已核对；提交事务仍会重新验证。" }); this.stored(lease, null); return result;
    });
  };
  submit = (rawQuery: p.DelegatedPlanExceptionsContextQuery, rawCommand: p.DelegatedPlanExceptionsCommand) => {
    const pair = p.parseDelegatedPlanExceptionsBody({ query: rawQuery, command: rawCommand }); if (pair.query.siteId !== this.options.siteId) fail();
    return this.operation(async lease => { this.guard(lease, true); this.stored(lease, null);
      const commandFingerprint = await p.delegatedPlanExceptionsCommandFingerprint(pair.query, this.options.actorId, pair.command); this.guard(lease, true);
      const pending: DelegatedPlanExceptionsPending = freeze({ protocol: "attendance-management-pending-v1", version: 1, domain: "plan-exceptions", actorId: this.options.actorId, ...pair, commandFingerprint }), raw = JSON.stringify(pending);
      if (new TextEncoder().encode(raw).byteLength > p.DELEGATED_PLAN_EXCEPTIONS_REQUEST_BYTES + 1024) fail();
      const { storage } = this.stored(lease, null); this.guard(lease, true); storage.setItem(this.storageKey, raw); this.guard(lease); this.stored(lease, raw);
      this.publish({ phase: "saving", pending, result: null, message: "完整原意图已保存；本次只提交一次。" }); this.guard(lease, true); this.stored(lease, raw);
      const result = await this.transport(lease, pair.query, pair.command); this.stored(lease, raw); if (!this.matches(result, pending)) fail();
      this.publish({ phase: "unconfirmed", pending, result, message: "已收到回执；请明确 GET 核验原编号，不能重复提交。" }); this.stored(lease, raw); return result;
    });
  };
  private matches(result: p.DelegatedPlanExceptionsResult, pending: DelegatedPlanExceptionsPending) {
    return result.kind === "receipt" && result.receipt !== null && result.receipt.actorId === this.options.actorId
      && result.receipt.operationId === pending.command.operationId && result.receipt.grantId === pending.query.grantId
      && result.receipt.reference.workerId === pending.query.workerId && result.receipt.reference.slotId === pending.query.slotId
      && result.receipt.commandFingerprint === pending.commandFingerprint;
  }
  recover = () => this.operation(async lease => {
    const { raw } = this.stored(lease); if (raw === null) fail(); const pending = await this.decode(raw, lease); this.stored(lease, raw);
    const query: p.DelegatedPlanExceptionsQuery = { siteId: pending.query.siteId, grantId: pending.query.grantId, mode: "recover", operationId: pending.command.operationId };
    this.publish({ phase: "loading", pending, result: null, message: "仅 GET 核验原编号；不重发，不重新读取正文。" }); this.stored(lease, raw);
    const result = await this.transport(lease, query, null, pending.command); const { storage } = this.stored(lease, raw);
    if (result.kind !== "receipt") fail(); if (result.receipt === null) {
      this.publish({ phase: "unconfirmed", pending, result, message: "查无回执不代表未写入；原编号继续保留。" }); this.stored(lease, raw); return result;
    }
    if (!this.matches(result, pending)) fail(); this.guard(lease); storage.removeItem(this.storageKey); this.guard(lease); this.stored(lease, null);
    this.publish({ phase: "ready", pending: null, result, message: "原编号及完整意图已核实；如需正文请重新明确读取。" }); this.stored(lease, null); return result;
  });
}
