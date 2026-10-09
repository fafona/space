import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { PlanPosthocQuery, PlanPosthocCommand, PlanPosthocReference, PlanPosthocResult } from "./merchantAttendancePlanPosthocContract";
import { parsePlanPosthocQuery, parsePlanPosthocCommand, planPosthocReferenceKey } from "./merchantAttendancePlanPosthoc";
import { PLAN_POSTHOC_API, PLAN_POSTHOC_HTTP_ERRORS, planPosthocQueryString, parsePlanPosthocResponse } from "./merchantAttendancePlanPosthocHttp";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { uuid, same, freeze } from "./merchantAttendancePlanExceptionValidation";
import type { PlanPosthocEvaluationResult } from "./merchantAttendancePlanPosthocEvaluationContract";
import { PLAN_POSTHOC_EVALUATION_API, PLAN_POSTHOC_EVALUATION_HTTP_ERRORS, planPosthocEvaluationQueryString, parsePlanPosthocEvaluationResponse } from "./merchantAttendancePlanPosthocEvaluationHttp";

export type PlanPosthocStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PlanPosthocPending = { version: 1; actorId: string; query: PlanPosthocQuery; command: PlanPosthocCommand };
export type PlanPosthocClientOptions = { siteId: string; workerId: string; slotId: string; actorId: string; enabled: boolean;
  apiFetch: AttendanceApiFetch; storage: () => PlanPosthocStorage; operationId?: () => string; timeoutMs?: number };
export type PlanPosthocClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  result: PlanPosthocResult | null; evaluation: PlanPosthocEvaluationResult | null; pending: PlanPosthocPending | null; canWrite: boolean; message: string }>;
type Lease = { generation: number; controller: AbortController };
const hidden = () => typeof document !== "undefined" && document.hidden;
class Rejected extends Error {}
class StorageChanged extends Error {}
export function planPosthocPendingKey(siteId: string, actorId: string, workerId: string, slotId: string) {
  parsePlanPosthocQuery({ siteId, workerId, slotId, mode: "detail", operationId: null }); uuid(actorId);
  return "faolla:attendance:plan-posthoc:v1:" + [siteId, actorId, workerId, slotId].join(":");
}
async function request(o: PlanPosthocClientOptions, q: PlanPosthocQuery, command: PlanPosthocCommand | null, signal: AbortSignal,
  readRoute?: { api: string; queryString: string; errors: Readonly<Record<string, number>> }) {
  const controller = new AbortController(), limit = o.timeoutMs ?? 12000, started = performance.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (e: Error) => void = () => {};
  const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error("aborted_or_timeout")); };
  const deadline = new Promise<never>((_, reject) => { rejectCancel = reject; }), timer = setTimeout(cancel, limit);
  signal.addEventListener("abort", cancel, { once: true });
  const guard = () => { if (signal.aborted || controller.signal.aborted || performance.now() - started >= limit) throw Error("aborted_or_timeout"); };
  const run = async () => {
    guard(); if (readRoute && command) throw Error("read_only");
    const response = await o.apiFetch((readRoute?.api ?? PLAN_POSTHOC_API) + (command ? "" : `?${readRoute?.queryString ?? planPosthocQueryString(q)}`), {
      method: command ? "POST" : "GET", headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify({ query: q, command }) } : {}), signal: controller.signal, cache: "no-store", redirect: "error",
    });
    if (signal.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
    }
    guard(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try { while (true) { const chunk = await reader.read(); guard(); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > (response.status === 200 ? 3145728 : 4096)) throw Error("response_too_large");
      text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    guard(); const raw = parseCaptureBrowserJson(text); guard();
    if (response.status !== 200) {
      const error = captureBrowserExact(raw, ["ok", "error"]);
      const codes = readRoute?.errors ?? PLAN_POSTHOC_HTTP_ERRORS;
      if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(codes, error.error)
        || codes[error.error] !== response.status) throw Error("invalid_error_envelope");
      throw new Rejected(error.error);
    }
    return raw;
  };
  try { return await Promise.race([run(), deadline]); } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}


/** Isolated owner intent; never persists evidence or resends on mount/focus.
 * Recovery uses the original number. A 404 alone cannot authorize retirement or retry. */
export class AttendancePlanPosthocClient {
  readonly storageKey: string;
  private readonly options: PlanPosthocClientOptions;
  private state: PlanPosthocClientState = freeze({ phase: "idle", result: null, evaluation: null, pending: null, canWrite: false, message: "请明确读取事后核对依据；不会自动提交。" });
  private listeners = new Set<() => void>();
  private generation = 0; private controller: AbortController | null = null;
  private pending: PlanPosthocPending | null = null; private pendingRaw: string | null = null; private initialized = false;
  constructor(options: PlanPosthocClientOptions) {
    this.storageKey = planPosthocPendingKey(options.siteId, options.actorId, options.workerId, options.slotId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.operationId !== undefined && typeof options.operationId !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("attendance_invalid_request");
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Omit<PlanPosthocClientState, "pending" | "evaluation"> & { evaluation?: PlanPosthocEvaluationResult | null }) {
    const current = this.state = freeze({ evaluation: null, ...patch, pending: this.pending });
    for (const fn of [...this.listeners]) { if (current !== this.state) break; try { fn(); } catch { /* Rendering cannot authorize a write. */ } }
  }
  pause = () => {
    const n = ++this.generation, c = this.controller; this.controller = null; c?.abort();
    if (n === this.generation) this.publish({ phase: this.pending ? "unconfirmed" : "idle", result: null, canWrite: false, message: "当前资料已清除；待确认编号保留，不自动查询或重发。" });
  };
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
  private query(operationId: string | null = null) {
    return parsePlanPosthocQuery({ siteId: this.options.siteId, workerId: this.options.workerId, slotId: this.options.slotId, mode: operationId ? "recover" : "detail", operationId });
  }
  private decode(raw: string): PlanPosthocPending {
    if (new TextEncoder().encode(raw).byteLength > 8192) throw new StorageChanged("invalid_pending");
    const p = captureBrowserExact(parseCaptureBrowserJson(raw), ["version", "actorId", "query", "command"]);
    if (p.version !== 1 || p.actorId !== this.options.actorId) throw new StorageChanged("invalid_pending");
    const query = parsePlanPosthocQuery(p.query), command = parsePlanPosthocCommand(p.command);
    if (!same(query, this.query()) || command.employeeAuthUserId === this.options.actorId) throw new StorageChanged("invalid_pending");
    return freeze({ version: 1, actorId: this.options.actorId, query, command });
  }
  initialize = async () => {
    const l = this.begin(); if (!l) return;
    try {
      const { raw } = this.stored(l);
      if (this.initialized && raw !== this.pendingRaw) throw new StorageChanged("pending_changed");
      const p = raw === null ? null : this.decode(raw); this.guard(l);
      this.pending = p; this.pendingRaw = raw; this.initialized = true;
      this.publish({ phase: p ? "unconfirmed" : "idle", result: null, canWrite: false, message: p ? "发现本排班待确认原编号，请先明确核对；不会自动重发。" : "请明确读取事后核对依据；不会自动提交。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  hasLeaveRisk = () => {
    if (this.pending || this.controller) return true;
    try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; }
  };
  private failed(error: unknown, l: Lease) {
    if (l.generation !== this.generation) return; if (hidden()) { this.pause(); return; }
    this.publish({ phase: this.pending ? "unconfirmed" : "blocked", result: null, canWrite: false, message: error instanceof StorageChanged
      ? "恢复存储不可用或内容已改变，未覆盖或删除原记录；请保留编号核验。"
      : this.pending ? "结果尚无法可靠确认；原编号保留，不能开始另一笔操作。请明确核对。"
        : "当前资料、身份或权限无法核对；已清除旧资料，请重新读取。" });
  }
  private parse(raw: unknown, q: PlanPosthocQuery, command: PlanPosthocCommand | null) {
    const r = parsePlanPosthocResponse(raw, q, this.options.actorId, command), p = this.pending;
    if (p && (r.result.worker.employeeId !== p.command.employeeId || r.result.worker.employeeAuthUserId !== p.command.employeeAuthUserId)) throw Error("identity_changed");
    return r;
  }
  private clear(l: Lease) {
    const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw new StorageChanged("pending_not_cleared"); this.pending = null; this.pendingRaw = null;
  }
  load = async () => {
    const l = this.begin(); if (!l) return;
    try {
      if (!this.initialized || this.pending) throw Error("pending_or_uninitialized"); this.verify(l);
      this.publish({ phase: "loading", result: null, canWrite: false, message: "正在重新核对当前身份、来源版本与历史…" }); this.guard(l);
      const q = this.query(), raw = await request(this.options, q, null, l.controller.signal); this.guard(l); this.verify(l);
      const r = this.parse(raw, q, null); this.guard(l);
      this.publish({ phase: "ready", ...r, message: "当前依据已读取。采用只记录核对依据，不修改打卡、工时或旧异常决定。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  evaluate = async () => {
    const l = this.begin(); if (!l) return;
    try {
      if (!this.initialized || this.pending) throw Error("pending_or_uninitialized"); this.verify(l);
      this.publish({ phase: "loading", result: null, canWrite: false, message: "正在只读核对保存版本、当前来源与请假；不提交结论…" }); this.guard(l);
      const query = { siteId: this.options.siteId, workerId: this.options.workerId, slotId: this.options.slotId };
      const raw = await request(this.options, this.query(), null, l.controller.signal, { api: PLAN_POSTHOC_EVALUATION_API, queryString: planPosthocEvaluationQueryString(query), errors: PLAN_POSTHOC_EVALUATION_HTTP_ERRORS });
      this.guard(l); this.verify(l); const evaluation = parsePlanPosthocEvaluationResponse(raw, query, this.options.actorId); this.guard(l);
      this.publish({ phase: "ready", result: null, evaluation, canWrite: false, message: "已核对保存来源及请假；这是只读预览，尚未写入正式异常结果或周期。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  private async post(l: Lease, p: PlanPosthocPending) {
    this.publish({ phase: "saving", result: null, canWrite: false, message: "正在提交原编号的一次明确操作…" }); this.guard(l); this.verify(l); this.guard(l);
    const raw = await request(this.options, p.query, p.command, l.controller.signal); this.guard(l); this.verify(l);
    const r = this.parse(raw, p.query, p.command); this.guard(l); this.clear(l); this.guard(l);
    this.publish({ phase: "ready", ...r, message: "已核验原操作收据；当前依据须重新读取，不自动生成正式结论。" });
  }
  private async settle(mode: "recover" | "retry" | "end") {
    const p = this.pending; if (!p || !this.initialized || mode === "retry" && !this.options.enabled) return;
    const l = this.begin(); if (!l) return;
    try {
      this.verify(l); this.publish({ phase: "loading", result: null, canWrite: false, message: "正在只读核对原编号；不会换号…" }); this.guard(l);
      const q = this.query(p.command.operationId); let raw: unknown;
      try { raw = await request(this.options, q, null, l.controller.signal); }
      catch (error) {
        this.guard(l); this.verify(l);
        if (!(error instanceof Rejected) || error.message !== "attendance_plan_posthoc_adoption_not_found") throw error;
        if (mode === "recover") throw Error("original_not_found");
        // A fresh authorized detail verifies the original employee/Auth pair.
        // This does not cancel a delayed request that has not reached SQL yet.
        const detailQuery = this.query(), detailRaw = await request(this.options, detailQuery, null, l.controller.signal); this.guard(l); this.verify(l);
        const checked = this.parse(detailRaw, detailQuery, null); this.guard(l);
        if (this.pending !== p) throw Error("pending_changed");
        if (mode === "end") {
          this.clear(l); this.guard(l); this.publish({ phase: "idle", result: null, canWrite: false, message: "已明确停止本地跟踪，不取消已发送请求；旧请求仍可能稍后成功。请重新读取服务器历史后再处理。" }); return;
        }
        if (!checked.canWrite) throw Error("write_disabled");
        await this.post(l, p); return;
      }
      this.guard(l); this.verify(l);
      const found = this.parse(raw, q, p.command); this.guard(l);
      this.clear(l); this.guard(l); this.publish({ phase: "ready", ...found, message: "原编号收据已核验，未重发或新增操作。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  }
  recover = () => this.settle("recover");
  retry = () => this.settle("retry");
  endAttempt = () => this.settle("end");
  private async submit(action: "apply" | "revoke", reason: string, sources: PlanPosthocReference[] = []) {
    const state = this.state, r = state.result;
    if (!this.initialized || !this.options.enabled || !state.canWrite || this.pending || state.phase !== "ready" || !r) return;
    if (action === "apply" ? !r.preview?.eligible || r.revision >= 99 : r.current?.action !== "apply" || r.revision >= 100) return;
    const l = this.begin(); if (!l) return;
    try {
      const command = parsePlanPosthocCommand({ action, reason, operationId: (this.options.operationId ?? (() => crypto.randomUUID()))(),
        expectedRevision: r.revision, expectedFingerprint: action === "apply" ? r.preview!.fingerprint : r.current!.sourceFingerprint,
        employeeId: r.worker.employeeId, employeeAuthUserId: r.worker.employeeAuthUserId, ...(action === "apply" ? { sources } : {}) });
      this.guard(l);
      if (command.action === "apply" && command.sources.some(ref => !r.preview!.candidates.some(c => c.available && planPosthocReferenceKey(c.reference) === planPosthocReferenceKey(ref) && same(c.reference, ref)))) throw Error("source_unavailable");
      const q = this.query(), p: PlanPosthocPending = freeze({ version: 1, actorId: this.options.actorId, query: q, command }), raw = JSON.stringify(p);
      if (new TextEncoder().encode(raw).byteLength > 8192) throw new StorageChanged("pending_too_large");
      // Persist and re-read exact bytes before POST; never replace an existing intent.
      const storage = this.verify(l); this.guard(l);
      // Storage may throw before OR after writing, or synchronously hide the
      // view. Reinitialize from exact persisted bytes; never create a phantom
      // pending command or overwrite a write whose acknowledgement was lost.
      this.initialized = false;
      storage.setItem(this.storageKey, raw); this.guard(l);
      if (this.stored(l).raw !== raw) throw new StorageChanged("pending_not_saved");
      this.pending = p; this.pendingRaw = raw; this.initialized = true;
      await this.post(l, p);
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  }
  apply = ({ sources, reason }: { sources: PlanPosthocReference[]; reason: string }) => this.submit("apply", reason, sources);
  revoke = (reason: string) => this.submit("revoke", reason);
}
