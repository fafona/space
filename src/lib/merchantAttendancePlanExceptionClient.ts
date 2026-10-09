import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { canClearPlanException } from "./merchantAttendancePlanClearance";
import { canMarkPlanExceptionNotApplicable } from "./merchantAttendancePlanPosthocReview";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { PLAN_EXCEPTION_API, PLAN_EXCEPTION_ERRORS, parsePlanExceptionQuery, parsePlanExceptionCommand,
  parsePlanExceptionResponse, parsePlanExceptionJson, planExceptionQueryString } from "./merchantAttendancePlanExceptions";
import type { PlanExceptionAccess, PlanExceptionCommand, PlanExceptionOutcome, PlanExceptionQuery,
  PlanExceptionResponse } from "./merchantAttendancePlanExceptionContract";

export type PlanExceptionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PlanExceptionPending = Readonly<{ version: 1; actorId: string; employeeId: string; employeeAuthUserId: string;
  query: PlanExceptionQuery; command: PlanExceptionCommand }>;
export type PlanExceptionClientOptions = { siteId: string; access: PlanExceptionAccess; actorId: string; enabled: boolean;
  apiFetch: AttendanceApiFetch; storage: () => PlanExceptionStorage; operationId?: () => string; timeoutMs?: number; clearanceEnabled?: boolean; posthocReviewEnabled?: boolean };
export type PlanExceptionClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  result: PlanExceptionResponse | null; query: PlanExceptionQuery | null; pending: PlanExceptionPending | null; message: string }>;
type Lease = { generation: number; controller: AbortController };
const hidden = () => typeof document !== "undefined" && document.hidden;
class Rejected extends Error {}
class StorageChanged extends Error {}
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export function planExceptionPendingKey(siteId: string, access: PlanExceptionAccess, actorId: string) {
  attendanceSelfSite(siteId); attendanceSelfUuid(actorId); if (access !== "owner" && access !== "self") throw Error("attendance_invalid_request");
  return `faolla:attendance:plan-exceptions:v1:${siteId}:${access}:${actorId}`;
}
async function request(o: PlanExceptionClientOptions, q: PlanExceptionQuery, command: PlanExceptionCommand | null, signal: AbortSignal) {
  const controller = new AbortController(), limit = o.timeoutMs ?? 12000, started = performance.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (e: Error) => void = () => {};
  const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error("aborted_or_timeout")); };
  const deadline = new Promise<never>((_, reject) => { rejectCancel = reject; }), timer = setTimeout(cancel, limit);
  signal.addEventListener("abort", cancel, { once: true });
  const guard = () => { if (signal.aborted || controller.signal.aborted || performance.now() - started >= limit) throw Error("aborted_or_timeout"); };
  const run = async () => {
    guard(); const response = await o.apiFetch(PLAN_EXCEPTION_API + (command ? "" : `?${planExceptionQueryString(q)}`), {
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
      bytes += chunk.value.byteLength; if (bytes > (response.status === 200 ? 1048576 : 4096)) throw Error("response_too_large");
      text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    guard(); const raw = parsePlanExceptionJson(text); guard();
    if (response.status !== 200) {
      const error = captureBrowserExact(raw, ["ok", "error"]);
      if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(PLAN_EXCEPTION_ERRORS, error.error)
        || PLAN_EXCEPTION_ERRORS[error.error] !== response.status) throw Error("invalid_error_envelope");
      throw new Rejected(error.error);
    }
    return raw;
  };
  try { return await Promise.race([run(), deadline]); } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}

/** Case workflow only. It does not own a clock controller, change attendance
 * facts or persist evidence. An unknown command retains its exact original ID. */
export class AttendancePlanExceptionClient {
  readonly storageKey: string;
  private readonly options: PlanExceptionClientOptions;
  private state: PlanExceptionClientState = freeze({ phase: "idle", result: null, query: null, pending: null, message: "请明确读取异常记录或当前排班依据；不会自动提交。" });
  private listeners = new Set<() => void>();
  private generation = 0; private controller: AbortController | null = null;
  private pending: PlanExceptionPending | null = null; private pendingRaw: string | null = null; private initialized = false;
  constructor(options: PlanExceptionClientOptions) {
    this.storageKey = planExceptionPendingKey(options.siteId, options.access, options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.clearanceEnabled !== undefined && typeof options.clearanceEnabled !== "boolean"
      || options.posthocReviewEnabled !== undefined && typeof options.posthocReviewEnabled !== "boolean"
      || options.operationId !== undefined && typeof options.operationId !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("attendance_invalid_request");
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Omit<PlanExceptionClientState, "pending">) {
    const state = this.state = freeze({ ...patch, pending: this.pending });
    for (const listener of [...this.listeners]) { if (state !== this.state) break; try { listener(); } catch { /* Observer errors cannot authorize a write. */ } }
  }
  invalidate = (message = "资料或输入已改变；请明确重新核对。") => {
    const g = ++this.generation, old = this.controller; this.controller = null; old?.abort();
    if (g === this.generation) this.publish({ phase: this.pending ? "unconfirmed" : "idle", result: null, query: null, message });
  };
  pause = () => this.invalidate("资料已隐藏；未提交输入已清除，原待确认编号保留，不自动查询或重发。");
  private begin(): Lease | null {
    if (hidden()) { this.pause(); return null; } if (this.controller) return null;
    const lease = { generation: ++this.generation, controller: new AbortController() }; this.controller = lease.controller; return lease;
  }
  private guard(l: Lease) {
    if (l.generation === this.generation && hidden()) this.pause();
    if (l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted) throw Error("aborted");
  }
  private release(l: Lease) { if (l.generation === this.generation && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease) { this.guard(l); const storage = this.options.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l); return { storage, raw }; }
  private verify(l: Lease) { const s = this.stored(l); if (s.raw !== this.pendingRaw) throw new StorageChanged("pending_changed"); return s.storage; }
  private decode(raw: string): PlanExceptionPending {
    if (new TextEncoder().encode(raw).byteLength > 8192) throw new StorageChanged("invalid_pending");
    const p = captureBrowserExact(parseCaptureBrowserJson(raw), ["version", "actorId", "employeeId", "employeeAuthUserId", "query", "command"]);
    if (p.version !== 1 || p.actorId !== this.options.actorId) throw new StorageChanged("invalid_pending");
    const query = parsePlanExceptionQuery(p.query), command = parsePlanExceptionCommand(query, p.command);
    if (query.siteId !== this.options.siteId || query.access !== this.options.access || !["decide", "note", "ack"].includes(query.mode)) throw new StorageChanged("invalid_pending");
    const employeeId = attendanceSelfUuid(p.employeeId), employeeAuthUserId = attendanceSelfUuid(p.employeeAuthUserId);
    if (query.access === "self" && employeeId !== this.options.actorId || "employeeId" in command && (command.employeeId !== employeeId || command.employeeAuthUserId !== employeeAuthUserId)) throw new StorageChanged("invalid_pending");
    return freeze({ version: 1, actorId: this.options.actorId, employeeId, employeeAuthUserId, query, command });
  }
  initialize = async () => {
    const l = this.begin(); if (!l) return;
    try { const { raw } = this.stored(l); if (this.pending && raw !== this.pendingRaw) throw new StorageChanged("pending_changed");
      const p = raw === null ? null : this.decode(raw); this.guard(l); this.pending = p; this.pendingRaw = raw; this.initialized = true;
      this.publish({ phase: p ? "unconfirmed" : "idle", result: null, query: null, message: p ? "本标签页有待确认原编号，请先明确核对；不会自动重发。" : "请明确读取异常记录或当前排班依据；不会自动提交。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  hasLeaveRisk = () => {
    if (this.pending || this.controller) return true;
    try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; }
  };
  private query(mode: PlanExceptionQuery["mode"], workerId: string | null = null, slotId: string | null = null, operationId: string | null = null,
    cursor: { at: string; id: string } | null = null) {
    return parsePlanExceptionQuery({ siteId: this.options.siteId, access: this.options.access, mode, workerId, slotId, operationId,
      beforeAt: cursor?.at ?? null, beforeId: cursor?.id ?? null });
  }
  private parse(raw: unknown, q: PlanExceptionQuery, command: PlanExceptionCommand | null) {
    const r = parsePlanExceptionResponse(raw, q, this.options.access === "owner" ? { ownerId: this.options.actorId } : { employeeId: this.options.actorId }, command);
    const p = this.pending;
    if (p && (r.detail && (r.detail.worker.employeeId !== p.employeeId || r.detail.worker.employeeAuthUserId !== p.employeeAuthUserId)
      || this.options.access === "self" && r.actorId !== p.employeeAuthUserId)) throw Error("identity_changed");
    return r;
  }
  private found(r: PlanExceptionResponse, p: PlanExceptionPending) {
    const receipt = p.query.mode === "ack" ? r.readReceipt : r.receipt;
    if (!receipt) return false;
    if (receipt.operationId !== p.command.operationId || canonical(receipt.command) !== canonical(p.command) || !r.detail) throw Error("receipt_mismatch");
    return true;
  }
  private clear(l: Lease) {
    const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw new StorageChanged("pending_not_cleared"); this.pending = null; this.pendingRaw = null;
  }
  private failed(error: unknown, l: Lease) {
    if (l.generation !== this.generation) return; if (hidden()) { this.pause(); return; }
    this.publish({ phase: this.pending ? "unconfirmed" : "blocked", result: null, query: null, message: error instanceof StorageChanged
      ? "恢复存储不可用或内容已改变；未覆盖或删除原记录，不能开始新的处理。"
      : error instanceof Rejected && error.message === "attendance_period_sealed"
        ? "相关周期已封存，服务器拒绝本次新处理。请先明确核对原编号；如需继续处理，须由负责人先重开相关周期。原编号保留，不会自动重发。"
      : this.pending ? "本次结果无法可靠确认；原编号保留，请明确核对。权限或服务恢复后也不会自动重发。"
        : "当前资料、身份或权限无法核对；旧资料已清除，请明确重新读取。" });
  }
  private async get(q: PlanExceptionQuery) {
    const l = this.begin(); if (!l) return;
    try {
      if (!this.initialized) throw Error("not_initialized"); this.verify(l);
      if (q.mode !== "recover" && (!this.options.enabled || this.pending)) throw Error("pending_or_disabled");
      this.publish({ phase: "loading", result: null, query: null, message: q.mode === "recover" ? "正在核对原操作编号，不提交新操作…" : "正在重新授权并读取异常资料…" }); this.guard(l);
      const started = performance.now(), raw = await request(this.options, q, null, l.controller.signal); this.guard(l); this.verify(l);
      const result = this.parse(raw, q, q.mode === "recover" ? this.pending?.command ?? null : null); this.guard(l);
      if (performance.now() - started >= (this.options.timeoutMs ?? 12000)) throw Error("timeout");
      if (q.mode === "recover" && this.pending && this.found(result, this.pending)) this.clear(l); this.guard(l);
      this.publish({ phase: this.pending ? "unconfirmed" : "ready", result, query: q, message: this.pending
        ? "未找到可确认的原收据；未查到不等于失败，原编号仍保留。" : this.options.access === "self"
          ? "已读取保存的处理结果；当前依据未重新核查，已读不代表同意。" : "已读取本次资料；处理必须明确提交，旧决定不自动沿用到变化后的依据。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  }
  list = async (workerId: string | null = null) => { try { await this.get(this.query("list", workerId)); } catch { this.invalidate("查询条件无效，请重新选择。"); } };
  next = async () => { const s = this.state; if (s.query?.mode !== "list" || !s.result?.nextCursor) return;
    try { await this.get(this.query("list", s.query.workerId, null, null, s.result.nextCursor)); } catch { this.invalidate(); } };
  detail = async (workerId: string, slotId: string) => { try { await this.get(this.query("detail", workerId, slotId)); } catch { this.invalidate("排班或员工编号无效。"); } };
  recover = async (target?: { workerId: string; slotId: string; operationId: string }) => {
    try { const p = this.pending;
      if (p && target && (target.operationId !== p.command.operationId || target.workerId !== p.query.workerId || target.slotId !== p.query.slotId)) throw Error("pending_mismatch");
      if (!p && (!this.options.enabled || !target)) throw Error("missing_pending");
      await this.get(this.query("recover", p?.query.workerId ?? target!.workerId, p?.query.slotId ?? target!.slotId, p?.command.operationId ?? target!.operationId));
    } catch { this.invalidate("请核对原员工、排班及操作编号；已有待确认时只能查该原号。"); }
  };
  private async settleAttempt(retry: boolean) {
    const p = this.pending;
    if (!p || !this.initialized || retry && !this.options.enabled) return;
    const l = this.begin(); if (!l) return;
    try {
      this.verify(l); const q = this.query("recover", p.query.workerId, p.query.slotId, p.command.operationId);
      this.publish({ phase: "loading", result: null, query: null, message: "先重新授权并查询原编号；此步骤不写入…" }); this.guard(l);
      const started = performance.now(), raw = await request(this.options, q, null, l.controller.signal); this.guard(l); this.verify(l);
      const checked = this.parse(raw, q, p.command); this.guard(l);
      if (performance.now() - started >= (this.options.timeoutMs ?? 12000)) throw Error("timeout");
      if (this.pending !== p) throw Error("pending_changed");
      if (this.found(checked, p)) {
        this.clear(l); this.guard(l); this.publish({ phase: "ready", result: checked, query: q, message: "已找到原操作并核验，未重发。" }); return;
      }
      if (checked.receipt || checked.readReceipt) throw Error("receipt_mismatch");
      // An owner-only null receipt has no employee binding by itself. Never
      // retire/repost an old intent without a current, parsed dual identity.
      if (!checked.detail) throw Error("identity_not_verified");
      if (!retry) {
        this.clear(l); this.guard(l); this.publish({ phase: "idle", result: null, query: null, message: "已明确结束本次本地尝试；查询未发现原收据。重新处理前必须重新读取依据。" }); return;
      }
      if (!checked.moduleEnabled) throw Error("module_paused");
      if ("outcome" in p.command && p.command.outcome === "cleared" && this.options.clearanceEnabled !== true) throw Error("clearance_disabled");
      if ("outcome" in p.command && this.options.posthocReviewEnabled !== true
        && (p.command.outcome === "not_applicable" || checked.detail.current?.protocol === "plan-exception-source-v3")) throw Error("posthoc_review_disabled");
      this.publish({ phase: "saving", result: null, query: null, message: "原号尚未查到，正在按您的明确要求重试完全相同的内容。" }); this.guard(l); this.verify(l); this.guard(l);
      const postStarted = performance.now(), postRaw = await request(this.options, p.query, p.command, l.controller.signal); this.guard(l); this.verify(l);
      const result = this.parse(postRaw, p.query, p.command); if (!this.found(result, p)) throw Error("receipt_missing");
      if (performance.now() - postStarted >= (this.options.timeoutMs ?? 12000)) throw Error("timeout"); this.guard(l); this.clear(l); this.guard(l);
      this.publish({ phase: "ready", result, query: p.query, message: "已核验原编号结果；没有创建新的操作编号。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  }
  retry = () => this.settleAttempt(true);
  endAttempt = () => this.settleAttempt(false);
  private async submit(mode: "decide" | "note" | "ack", values: Record<string, unknown>) {
    const previous = this.state.result, d = previous?.detail;
    if (!this.initialized || !this.options.enabled || this.pending || this.state.phase !== "ready" || !previous?.moduleEnabled || !d) return;
    if (mode === "decide" && (this.options.access !== "owner" || !d.canDecide || !d.current || d.currentValidation !== "checked")
      || mode === "note" && (this.options.access !== "self" || !d.canNote || !d.latestDecision)
      || mode === "ack" && (this.options.access !== "self" || !d.latestDecision || d.latestDecision.readAt !== null)) return;
    const l = this.begin(); if (!l) return;
    try {
      const employeeId = attendanceSelfUuid(d.worker.employeeId), employeeAuthUserId = attendanceSelfUuid(d.worker.employeeAuthUserId);
      const operationId = (this.options.operationId ?? (() => crypto.randomUUID()))(); this.guard(l);
      const q = this.query(mode, d.worker.workerId, d.slotId, operationId);
      const command = parsePlanExceptionCommand(q, { operationId, ...values }); this.guard(l);
      if (mode === "decide" && d.current?.protocol === "plan-exception-source-v3" && this.options.posthocReviewEnabled !== true) throw Error("posthoc_review_disabled");
      if (mode === "decide" && "outcome" in command && (command.outcome === "cleared"
        ? this.options.clearanceEnabled !== true || !canClearPlanException(d)
        : command.outcome === "not_applicable" ? this.options.posthocReviewEnabled !== true || !canMarkPlanExceptionNotApplicable(d)
        : command.outcome !== "follow_up" && (!d.current?.eligible || ![d.current.candidate.late.state, d.current.candidate.early.state].includes("triggered")))) throw Error("not_confirmable");
      this.publish({ phase: "saving", result: null, query: null, message: "正在保存明确处理，原编号先写入本标签页…" }); this.guard(l);
      const storage = this.verify(l); this.guard(l);
      this.pending = freeze({ version: 1, actorId: this.options.actorId, employeeId, employeeAuthUserId, query: q, command }); this.pendingRaw = JSON.stringify(this.pending);
      if (new TextEncoder().encode(this.pendingRaw).byteLength > 8192) throw new StorageChanged("pending_too_large");
      storage.setItem(this.storageKey, this.pendingRaw); this.guard(l); this.verify(l);
      this.publish({ phase: "saving", result: null, query: null, message: "原编号已保存，正在提交一次明确操作…" }); this.guard(l); this.verify(l); this.guard(l);
      const started = performance.now(), raw = await request(this.options, q, command, l.controller.signal); this.guard(l); this.verify(l);
      const result = this.parse(raw, q, command); if (!this.found(result, this.pending)) throw Error("receipt_missing");
      if (performance.now() - started >= (this.options.timeoutMs ?? 12000)) throw Error("timeout"); this.guard(l); this.clear(l); this.guard(l);
      this.publish({ phase: "ready", result, query: q, message: mode === "ack" ? "已保存明确已读；不代表认可处理决定。" : "已核验原操作收据；不修改原始打卡、补正或工资。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  }
  decide = async (outcome: PlanExceptionOutcome, note: string) => {
    const d = this.state.result?.detail; if (!d?.current) return;
    await this.submit("decide", { expectedRevision: d.revision, expectedFingerprint: d.current.fingerprint,
      employeeId: d.worker.employeeId, employeeAuthUserId: d.worker.employeeAuthUserId, outcome, note });
  };
  note = async (note: string) => { const d = this.state.result?.detail; if (!d?.latestDecision) return;
    await this.submit("note", { expectedRevision: d.revision, decisionOperationId: d.latestDecision.operationId, note }); };
  ack = async () => { const d = this.state.result?.detail; if (d?.latestDecision) await this.submit("ack", { decisionOperationId: d.latestDecision.operationId }); };
}
