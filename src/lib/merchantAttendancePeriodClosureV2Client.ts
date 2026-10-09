import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parsePeriodClosureQuery, parsePeriodClosureCommand, periodClosureSame, type PeriodClosureArtifact, type PeriodClosureQuery, type PeriodClosureCommand } from "./merchantAttendancePeriodClosure";
import { periodClosurePendingKey, periodClosureAllowsMutation, periodClosureCanSendPreview, type PeriodClosureStorage } from "./merchantAttendancePeriodClosureClient";
import { parsePeriodClosureV2Query, parsePeriodClosureV2Command, parsePeriodClosureV2Response, periodClosureV2QueryString, periodClosureV2Message,
  PERIOD_CLOSURE_V2_ERRORS, type PeriodClosureV2Query, type PeriodClosureV2Command, type PeriodClosureV2Result, type PeriodClosureV2Cursor,
  type PeriodClosureV2Summary } from "./merchantAttendancePeriodClosureV2";

export const PERIOD_CLOSURE_V2_CLIENT_API = "/api/merchant-enterprise/attendance/period-closures-v2";
export type PeriodClosureV2View = PeriodClosureV2Result & { moduleEnabled: boolean };
export type PeriodClosureV2Pending = Readonly<{ actorId: string; employeeId: string; employeeAuthUserId: string } & (
  { format: 1; query: PeriodClosureQuery; command: PeriodClosureCommand } | { format: 2; query: PeriodClosureV2Query; command: PeriodClosureV2Command })>;
export type PeriodClosureV2ClientOptions = { siteId: string; access: "owner" | "self"; actorId: string; workerId: string; fromDate: string; throughDate: string;
  enabled: boolean; apiFetch: AttendanceApiFetch; storage: () => PeriodClosureStorage; randomId?: () => string; timeoutMs?: number };
export type PeriodClosureV2Navigation = { workerId: string; fromDate: string; throughDate: string; periodId: string | null };
export type PeriodClosureV2ClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  result: PeriodClosureV2View | null; query: PeriodClosureV2Query | null; pending: PeriodClosureV2Pending | null;
  navigation: PeriodClosureV2Navigation | null; definitiveRejection: string | null; message: string }>;
type Lease = { generation: number; controller: AbortController };
const hidden = () => typeof document !== "undefined" && document.hidden;
const freeze = <T>(v: T): T => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
class StorageChanged extends Error {}
class Rejected extends Error {}
// Protocol upgrades, auth failures and unknown replies never authorize retiring an intent.
const definite = new Set(["attendance_version_conflict", "attendance_period_source_changed", "attendance_period_blocked", "attendance_period_sealed", "attendance_period_not_confirmed", "attendance_period_overlap", "attendance_period_limit", "attendance_period_storage_limit"]);
export const periodClosureV2PendingKey = periodClosurePendingKey;
async function transport(options: PeriodClosureV2ClientOptions, q: PeriodClosureV2Query, c: PeriodClosureV2Command | null, outer: AbortSignal) {
  const controller = new AbortController(), started = performance.now(), limit = options.timeoutMs ?? 12000;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject: (error: Error) => void = () => {};
  const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); reject(Error("timeout_or_abort")); };
  const interrupted = new Promise<never>((_, no) => { reject = no; }), timer = setTimeout(cancel, limit);
  outer.addEventListener("abort", cancel, { once: true });
  const guard = () => { if (outer.aborted || controller.signal.aborted || performance.now() - started >= limit) throw Error("timeout_or_abort"); };
  const run = async () => {
    guard(); const response = await options.apiFetch(PERIOD_CLOSURE_V2_CLIENT_API + (c ? "" : "?" + periodClosureV2QueryString(q)), {
      method: c ? "POST" : "GET", headers: { Accept: "application/json", ...(c ? { "Content-Type": "application/json" } : {}) },
      ...(c ? { body: JSON.stringify({ query: q, command: c }) } : {}), signal: controller.signal, redirect: "error", cache: "no-store" });
    if (outer.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    guard(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try { while (true) { const part = await reader.read(); guard(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > (response.status === 200 ? 4194304 : 4096)) throw Error("response_too_large"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    guard(); const raw = parseCaptureBrowserJson(text); guard();
    if (response.status !== 200) { const error = captureBrowserExact(raw, ["ok", "error"]);
      if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(PERIOD_CLOSURE_V2_ERRORS, error.error) || PERIOD_CLOSURE_V2_ERRORS[error.error] !== response.status) throw Error("invalid_error_envelope");
      throw new Rejected(error.error); }
    return raw;
  };
  try { return await Promise.race([run(), interrupted]); } finally { clearTimeout(timer); outer.removeEventListener("abort", cancel); }
}

/** One scoped intent slot across v1/v2. Neither reports nor cursor pages are persisted. */
export class AttendancePeriodClosureV2Client {
  readonly storageKey: string;
  private readonly options: PeriodClosureV2ClientOptions;
  private state: PeriodClosureV2ClientState = freeze({ phase: "idle", result: null, query: null, pending: null, navigation: null, definitiveRejection: null, message: "请明确读取周期；不会自动读取或提交。" });
  private listeners = new Set<() => void>(); private generation = 0; private controller: AbortController | null = null;
  private pending: PeriodClosureV2Pending | null = null; private raw: string | null = null; private initialized = false;
  private definitiveRejection: string | null = null; private navigation: PeriodClosureV2Navigation | null = null;
  constructor(options: PeriodClosureV2ClientOptions) {
    attendanceSelfSite(options.siteId); attendanceSelfUuid(options.actorId); this.storageKey = periodClosureV2PendingKey(options.siteId, options.access, options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.randomId !== undefined && typeof options.randomId !== "function" || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("attendance_invalid_request");
    this.options = Object.freeze({ ...options }); this.query("list");
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: Pick<PeriodClosureV2ClientState, "phase" | "result" | "query" | "message">) {
    const state = this.state = freeze({ ...value, pending: this.pending, navigation: this.navigation, definitiveRejection: this.definitiveRejection });
    for (const listener of [...this.listeners]) { if (this.state !== state) break; try { listener(); } catch { /* Observers grant no authority. */ } }
  }
  invalidate = (message = "旧资料已清除，请明确重新读取。") => {
    const g = ++this.generation, old = this.controller; this.controller = null; this.navigation = null; old?.abort();
    if (g === this.generation) this.publish({ phase: this.pending ? "unconfirmed" : "idle", result: null, query: null, message });
  };
  pause = () => this.invalidate("周期资料已隐藏；原编号保留，不自动读取或重发。");
  hasLeaveRisk = () => { if (this.pending || this.controller) return true; try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(): Lease | null { if (hidden()) { this.pause(); return null; } if (this.controller) return null;
    const l = { generation: ++this.generation, controller: new AbortController() }; this.controller = l.controller; return l; }
  private guard(l: Lease) { if (l.generation === this.generation && hidden()) this.pause();
    if (l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted) throw Error("aborted"); }
  private release(l: Lease) { if (l.generation === this.generation && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease) { this.guard(l); const storage = this.options.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l); return { storage, raw }; }
  private verify(l: Lease) { const v = this.stored(l); if (v.raw !== this.raw) throw new StorageChanged("pending_changed"); return v.storage; }
  private decode(raw: string): PeriodClosureV2Pending {
    if (new TextEncoder().encode(raw).byteLength > 8192) throw new StorageChanged("invalid_pending");
    const p = captureBrowserExact(parseCaptureBrowserJson(raw), ["format", "actorId", "employeeId", "employeeAuthUserId", "query", "command"]);
    if (p.actorId !== this.options.actorId || p.format !== 1 && p.format !== 2) throw new StorageChanged("invalid_pending");
    const employeeId = attendanceSelfUuid(p.employeeId), employeeAuthUserId = attendanceSelfUuid(p.employeeAuthUserId);
    const common = { actorId: this.options.actorId, employeeId, employeeAuthUserId };
    let pending: PeriodClosureV2Pending;
    if (p.format === 1) { const query = parsePeriodClosureQuery(p.query); pending = { ...common, format: 1, query, command: parsePeriodClosureCommand(query, p.command) }; }
    else { const query = parsePeriodClosureV2Query(p.query); pending = { ...common, format: 2, query, command: parsePeriodClosureV2Command(query, p.command) }; }
    if (pending.query.siteId !== this.options.siteId || pending.query.access !== this.options.access || pending.query.mode !== "detail" || pending.query.operationId !== null
      || pending.query.periodId !== pending.command.periodId || this.options.access === "self" && employeeId !== this.options.actorId) throw new StorageChanged("pending_scope");
    return freeze(pending);
  }
  initialize = async () => { const l = this.begin(); if (!l) return; try {
    const { raw } = this.stored(l); if (this.pending && raw !== this.raw) throw new StorageChanged("pending_changed");
    const pending = raw === null ? null : this.decode(raw); this.guard(l); this.pending = pending; this.raw = raw; this.initialized = true; this.navigation = null; this.definitiveRejection = null;
    this.publish({ phase: pending ? "unconfirmed" : "idle", result: null, query: null, message: pending ? "发现原待确认编号，请明确核对；不转换或重发原命令。" : "请明确读取周期列表或预览完整资料。" });
  } catch (e) { this.failed(e, l); } finally { this.release(l); } };
  private query(mode: PeriodClosureV2Query["mode"], periodId: string | null = null, version: number | null = null, cursor: PeriodClosureV2Cursor | null = null, selected = true): PeriodClosureV2Query {
    const { siteId, access, workerId, fromDate, throughDate } = this.options;
    const scope = selected && periodId !== null && this.navigation?.periodId === periodId ? this.navigation : { workerId, fromDate, throughDate };
    return parsePeriodClosureV2Query({ siteId, access, ...scope, mode, periodId, operationId: null, version, cursor });
  }
  private async fetch(l: Lease, q: PeriodClosureV2Query, c: PeriodClosureV2Command | null, expected: PeriodClosureV2Command | null = c) {
    this.guard(l); const started = performance.now(), raw = await transport(this.options, q, c, l.controller.signal); this.guard(l); this.verify(l);
    const parsed = parsePeriodClosureV2Response(raw, q, this.options.access === "owner" ? { ownerId: this.options.actorId } : { employeeId: this.options.actorId }, expected);
    const result: PeriodClosureV2View = { ...parsed.data, moduleEnabled: parsed.moduleEnabled }; this.guard(l);
    if (performance.now() - started >= (this.options.timeoutMs ?? 12000)) throw Error("timeout");
    const p = this.pending;
    if (p && result.kind === "detail" && (result.period.employeeId !== p.employeeId || result.period.employeeAuthUserId !== p.employeeAuthUserId
      || result.actorId !== (p.query.access === "self" ? p.employeeAuthUserId : p.actorId))) throw Error("identity_changed");
    return result;
  }
  private found(result: PeriodClosureV2View, p: PeriodClosureV2Pending) {
    if (result.kind !== "detail" || !result.operation) return false;
    if (result.operation.operationId !== p.command.operationId || !periodClosureSame(result.operation.command, p.command)) throw Error("receipt_mismatch"); return true;
  }
  private clear(l: Lease) { const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw new StorageChanged("pending_not_cleared"); this.pending = null; this.raw = null; this.definitiveRejection = null; }
  private failed(error: unknown, l: Lease) {
    if (l.generation !== this.generation) return; if (hidden()) { this.pause(); return; } this.navigation = null;
    this.publish({ phase: this.pending ? "unconfirmed" : "blocked", query: null, result: null, message: error instanceof StorageChanged
      ? "恢复存储不可用或内容已变化；未覆盖原编号，暂不能开始新操作。"
      : this.pending ? `${error instanceof Rejected ? periodClosureV2Message(error.message) + " " : ""}操作结果待核验；原编号与内容保留，不自动重发。`
        : error instanceof Rejected ? periodClosureV2Message(error.message) : "周期资料、身份或权限无法核对；旧资料已清除，请重新读取。" });
  }
  private async get(q: PeriodClosureV2Query, navigation = false) {
    const l = this.begin(); if (!l) return; try {
      if (!this.initialized) throw Error("not_initialized"); this.verify(l);
      if (this.pending && q.mode !== "recover" || !this.options.enabled && q.mode === "preview") throw Error("unavailable");
      this.publish({ phase: "loading", result: null, query: null, message: "正在重新授权读取本页；不自动提交或加载其他页…" }); this.guard(l);
      const result = await this.fetch(l, q, null, q.mode === "recover" ? this.pending?.command ?? null : null);
      if (this.pending && q.mode === "recover" && this.found(result, this.pending)) this.clear(l); this.guard(l);
      if (q.mode === "recover" || q.mode === "list") this.navigation = null;
      else if (navigation) this.navigation = { workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate, periodId: q.periodId };
      this.publish({ phase: this.pending ? "unconfirmed" : "ready", result, query: q, message: q.mode === "recover" ? "已核对原号回执；须明确重新读取目标周期才可继续操作。" : "已读取本页；翻页、核对和封存均须明确操作。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  }
  list = async (cursor: PeriodClosureV2Cursor | null = null) => { try { await this.get(this.query("list", null, null, cursor, false)); } catch { this.invalidate("周期列表查询条件无效。"); } };
  preview = async (periodId: string | null = null) => { try { await this.get(this.query("preview", periodId), true); } catch { this.invalidate("周期预览条件无效。"); } };
  detail = async (periodId: string, version: number | null = null) => { try { await this.get(this.query("detail", periodId, version), true); } catch { this.invalidate("周期或版本编号无效。"); } };
  selectPeriod = async (item: PeriodClosureV2Summary) => {
    const state = this.state, result = state.result;
    if (this.pending || state.phase !== "ready" || result?.kind !== "list" || !result.items.some(x => periodClosureSame(x, item))) return;
    const q = this.query("detail", item.periodId);
    await this.get(parsePeriodClosureV2Query({ ...q, fromDate: item.fromDate, throughDate: item.throughDate }), true);
  };
  history = async (periodId: string, cursor: PeriodClosureV2Cursor | null = null) => { try { await this.get(this.query("history", periodId, null, cursor)); } catch { this.invalidate("周期历史游标无效。"); } };
  versions = async (periodId: string, cursor: PeriodClosureV2Cursor | null = null) => { try { await this.get(this.query("versions", periodId, null, cursor)); } catch { this.invalidate("周期版本游标无效。"); } };
  recover = async () => { const p = this.pending; if (!p) return; try {
    await this.get(parsePeriodClosureV2Query({ ...p.query, cursor: null, mode: "recover", version: null, operationId: p.command.operationId }));
  } catch { this.invalidate("原编号无法核对，原内容仍保留。"); } };
  private navigates(q: PeriodClosureV2Query) { const n = this.navigation; return n !== null && q.workerId === this.options.workerId
    && q.workerId === n.workerId && q.fromDate === n.fromDate && q.throughDate === n.throughDate && q.periodId === n.periodId; }
  submit = async (action: PeriodClosureV2Command["action"], reason: string) => {
    const result = this.state.result, viewed = this.state.query;
    if (!this.initialized || this.pending || this.state.phase !== "ready" || !result || !viewed || !this.navigates(viewed)
      || !periodClosureAllowsMutation(action, this.options.enabled, result.moduleEnabled)) return;
    const owner = this.options.access === "owner"; if (owner ? !["send", "respond", "seal", "reopen"].includes(action) : !["confirm", "dispute"].includes(action)) return;
    const artifact = result.kind === "preview" ? result.preview.artifact : result.kind === "detail" ? result.artifact : null;
    const period = result.kind === "detail" ? result.period : result.kind === "preview" ? result.preview.period : null;
    if (action === "send" ? viewed.mode !== "preview" || result.kind !== "preview" || !periodClosureCanSendPreview(result.preview.blockers)
      : viewed.mode !== "detail" || viewed.version !== null || result.kind !== "detail" || result.operation !== null || !period || result.artifactVersion !== period.currentVersion) return;
    if ((action === "confirm" || action === "seal") && (!artifact || result.kind !== "detail" || result.sourceChanged !== false)) return;
    const l = this.begin(); if (!l) return;
    try {
      const id = () => attendanceSelfUuid((this.options.randomId ?? (() => crypto.randomUUID()))());
      const operationId = id(); this.guard(l); const periodId = period?.periodId ?? viewed.periodId ?? id(); this.guard(l);
      const q = parsePeriodClosureV2Query({ ...viewed, mode: "detail", periodId, version: null, cursor: null, operationId: null });
      const command = parsePeriodClosureV2Command(q, { action, operationId, periodId, expectedRevision: period?.revision ?? 0, expectedVersion: period?.currentVersion ?? 0,
        expectedFingerprint: ["send", "confirm", "seal"].includes(action) ? artifact?.sourceFingerprint ?? null : null, reason });
      const identity = period ?? artifact?.worker; if (!identity) throw Error("identity_missing");
      const employeeId = attendanceSelfUuid(identity.employeeId), employeeAuthUserId = attendanceSelfUuid(identity.employeeAuthUserId);
      if (!owner && employeeId !== this.options.actorId) throw Error("identity_changed");
      this.publish({ phase: "saving", result: null, query: null, message: "先保存原操作编号，再提交一次明确操作…" }); this.guard(l);
      const storage = this.verify(l); this.guard(l); this.definitiveRejection = null;
      this.pending = freeze({ format: 2, actorId: this.options.actorId, employeeId, employeeAuthUserId, query: q, command }); this.raw = JSON.stringify(this.pending);
      if (new TextEncoder().encode(this.raw).byteLength > 8192) throw new StorageChanged("pending_too_large");
      storage.setItem(this.storageKey, this.raw); this.guard(l); this.verify(l);
      this.publish({ phase: "saving", result: null, query: null, message: "原编号已保存，正在提交…" }); this.guard(l); this.verify(l);
      const saved = await this.fetch(l, q, command); if (!this.found(saved, this.pending)) throw Error("receipt_missing"); this.clear(l); this.guard(l);
      this.navigation = { workerId: q.workerId, fromDate: q.fromDate, throughDate: q.throughDate, periodId: q.periodId };
      this.publish({ phase: "ready", result: saved, query: q, message: "已核验原收据；须明确重新读取当前周期后才能继续操作。" });
    } catch (e) {
      if (e instanceof Rejected && definite.has(e.message) && this.pending && l.generation === this.generation && !l.controller.signal.aborted && !hidden()) {
        try { this.verify(l); this.definitiveRejection = e.message; } catch { /* Replaced bytes never authorize retirement. */ }
      }
      this.failed(e, l);
    } finally { this.release(l); }
  };
  endAttempt = async () => { if (!this.pending || !this.definitiveRejection) return; const l = this.begin(); if (!l) return; try {
    this.verify(l); this.clear(l); this.guard(l); this.navigation = null;
    this.publish({ phase: "idle", result: null, query: null, message: "已结束服务器明确拒绝的本地尝试，未撤销任何事实；请重新读取。" });
  } catch (e) { this.failed(e, l); } finally { this.release(l); } };
  exportVersion = async (periodId: string, version: number, fingerprint: string, deliver: (artifact: PeriodClosureArtifact, signal: AbortSignal, authorized: () => boolean) => void | Promise<void>) => {
    const viewed = this.state.query, current = this.state.result;
    if (this.pending || !this.initialized || !viewed || !this.navigates(viewed) || current?.kind !== "detail" || viewed.mode !== "detail"
      || current.period.periodId !== periodId || current.artifactVersion !== version || current.artifact?.sourceFingerprint !== fingerprint) return;
    const l = this.begin(); if (!l) return; try {
      this.verify(l); const q = this.query("export", periodId, version);
      this.publish({ phase: "loading", result: null, query: null, message: "正在独立核验导出权限，只读取这一份固定版本…" }); this.guard(l);
      const r = await this.fetch(l, q, null);
      if (r.kind !== "detail" || r.artifactVersion !== version || !r.artifact || r.artifact.sourceFingerprint !== fingerprint) throw Error("export_version_mismatch");
      this.guard(l); await deliver(r.artifact, l.controller.signal, () => l.generation === this.generation && !l.controller.signal.aborted && !hidden()); this.guard(l);
      this.publish({ phase: "ready", result: r, query: q, message: "已请求输出这一固定版本，请自行核对是否下载或打印成功；不自动重试。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
}
