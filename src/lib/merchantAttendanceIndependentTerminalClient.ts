//196 paired-device client. PIN is confined to one explicit transient request;
// durable storage contains only the original nonsecret command and SHA.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { freeze } from "./merchantAttendancePlanExceptionValidation";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendancePin, pinWorkerNo } from "./merchantAttendancePin";
import { TERMINAL_DEVICE_API, parseTerminalDevice } from "./merchantAttendanceTerminal";
import { INDEPENDENT_BODY_LIMIT, INDEPENDENT_RESPONSE_LIMIT, independentClockCommandFingerprint, independentClockCommandText,
  parseIndependentClockCommand, parseIndependentJson, parseIndependentTerminalBody, parseIndependentTerminalResult,
  type IndependentAction, type IndependentClockCommand, type IndependentTerminalBody, type IndependentTerminalRequest,
  type IndependentTerminalResult } from "./merchantAttendanceIndependent";

export const INDEPENDENT_TERMINAL_API = "/api/merchant-enterprise/attendance/independent-terminal";
const prefix = "faolla:attendance:independent-terminal:v1:";
export type IndependentTerminalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;
export type IndependentTerminalDevice = Readonly<{ siteId: string; terminalId: string; label: string; moduleEnabled: boolean }>;
export type IndependentTerminalPending = Readonly<{ version: 1; siteId: string; terminalId: string; workerNo: string;
  command: IndependentClockCommand; fingerprint: string }>;
export type IndependentTerminalClientState = Readonly<{ phase: "entry" | "loading" | "ready" | "saving" | "unconfirmed" | "confirmed" | "blocked";
  device: IndependentTerminalDevice | null; result: IndependentTerminalResult | null; pending: IndependentTerminalPending | null; message: string }>;
type Options = Readonly<{ apiFetch: AttendanceApiFetch; storage: () => IndependentTerminalStorage; randomId?: () => string;
  isCurrent?: () => boolean; timeoutMs?: number; resultMs?: number; allowNew?: boolean }>;
function unknown(): never { throw Error("attendance_independent_recovery_required"); }
export function independentTerminalPendingKey(d: Pick<IndependentTerminalDevice, "siteId" | "terminalId">, no: string) {
  return `${prefix}${attendanceSelfSite(d.siteId)}:${attendanceSelfUuid(d.terminalId)}:${encodeURIComponent(pinWorkerNo(no).toLowerCase())}`;
}
export class AttendanceIndependentTerminalClient {
  private state: IndependentTerminalClientState = { phase: "entry", device: null, result: null, pending: null, message: "请先检查此浏览器的真实终端配对状态。" };
  private readonly options: Options;
  private listeners = new Set<() => void>();
  private generation = 0; private busy = false; private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(options: Options) {
    if (typeof options.apiFetch !== "function" || typeof options.storage !== "function" || options.isCurrent !== undefined && typeof options.isCurrent !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)
      || options.resultMs !== undefined && (!Number.isInteger(options.resultMs) || options.resultMs < 1 || options.resultMs > 15000)
      || options.allowNew !== undefined && typeof options.allowNew !== "boolean") unknown();
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private set(p: Partial<IndependentTerminalClientState>) { this.state = freeze({ ...this.state, ...p }); this.listeners.forEach(f => f()); }
  private forgetTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  clear = () => { this.generation++; this.controller?.abort(); this.controller = null; this.forgetTimer();
    this.set({ phase: "entry", result: null, pending: null, message: "资料已隐藏；请重新输入本人工号和 PIN。原待确认编号仍保留。" }); };
  pause = () => { this.clear(); this.set({ device: null }); };
  dispose = () => { this.pause(); this.listeners.clear(); };
  private guard(g: number) { if (g !== this.generation || typeof document !== "undefined" && document.hidden || this.options.isCurrent?.() === false) unknown(); }
  private shown() { this.forgetTimer(); this.timer = setTimeout(() => this.clear(), this.options.resultMs ?? 15000); }
  private stored(g: number, d: IndependentTerminalDevice, no: string, expected?: string | null) {
    this.guard(g); const storage = this.options.storage(); this.guard(g); const key = independentTerminalPendingKey(d, no), raw = storage.getItem(key); this.guard(g);
    if (expected !== undefined && raw !== expected) unknown(); return { storage, key, raw };
  }
  private async decode(raw: string, d: IndependentTerminalDevice, no: string, g: number): Promise<IndependentTerminalPending> {
    if (new TextEncoder().encode(raw).byteLength > INDEPENDENT_BODY_LIMIT) unknown();
    const v = exact(parseIndependentJson(raw), ["version", "siteId", "terminalId", "workerNo", "command", "fingerprint"]);
    if (v.version !== 1 || v.siteId !== d.siteId || v.terminalId !== d.terminalId || pinWorkerNo(v.workerNo).toLowerCase() !== no.toLowerCase()) unknown();
    const command = parseIndependentClockCommand(v.command), fingerprint = await independentClockCommandFingerprint(d.siteId, d.terminalId, command); this.guard(g);
    if (v.fingerprint !== fingerprint) unknown(); return freeze({ version: 1, siteId: d.siteId, terminalId: d.terminalId, workerNo: v.workerNo as string, command, fingerprint });
  }
  private async pending(d: IndependentTerminalDevice, no: string, g: number) {
    const { raw } = this.stored(g, d, no); const pending = raw === null ? null : await this.decode(raw, d, no, g); this.stored(g, d, no, raw); return { pending, raw };
  }
  /** Local only, with no secret and no implicit original-operation request. */
  async load(no: string) {
    if (this.busy || !this.state.device) unknown(); this.busy = true; const g = this.generation;
    try { return (await this.pending(this.state.device, pinWorkerNo(no), g)).pending; } finally { this.busy = false; }
  }
  private async wire<T>(url: string, body: string | null, g: number, check: () => void, parse: (value: unknown) => T | Promise<T>, max = INDEPENDENT_RESPONSE_LIMIT): Promise<T> {
    const controller = new AbortController(); this.controller = controller;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectDeadline: (e: Error) => void = () => {};
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const abort = () => { void reader?.cancel().catch(() => {}); rejectDeadline(Error("unknown_result")); };
    controller.signal.addEventListener("abort", abort, { once: true });
    const limit = this.options.timeoutMs ?? 12000, start = performance.now(), timer = setTimeout(() => controller.abort(), limit);
    const guard = () => { this.guard(g); if (controller.signal.aborted || performance.now() - start >= limit) unknown(); check(); };
    const run = async () => {
      guard(); const response = await this.options.apiFetch(url, { method: body === null ? "GET" : "POST", cache: "no-store", credentials: "same-origin", redirect: "error",
        signal: controller.signal, headers: body === null ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" }, ...(body === null ? {} : { body }) });
      try { guard(); } catch (e) { void response.body?.cancel().catch(() => {}); throw e; }
      if (!response.ok || response.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        void response.body?.cancel().catch(() => {}); unknown(); }
      reader = response.body?.getReader(); if (!reader) unknown(); let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
      try { while (true) { const chunk = await reader.read(); guard(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > max) unknown(); text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
      guard(); const value = await parse(parseIndependentJson(text)); guard(); return value;
    };
    try { return await Promise.race([run(), deadline]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); if (this.controller === controller) this.controller = null; }
  }
  /** Existing GET/cookie pairing path only. Never accepts URL/device secrets. */
  initialize = async () => {
    if (this.busy) unknown(); this.pause(); this.busy = true; const g = this.generation; this.set({ phase: "loading", message: "正在核对已配对终端…" });
    try { const device = await this.wire(TERMINAL_DEVICE_API, null, g, () => {}, raw => {
      const v = exact(raw, ["ok", "paired", "moduleEnabled", "siteId", "terminal", "attendanceEnabled", "clockEnabled"]);
      if (v.ok !== true || v.paired !== true || typeof v.moduleEnabled !== "boolean") unknown();
      const d = parseTerminalDevice({ siteId: v.siteId, terminal: v.terminal, attendanceEnabled: v.attendanceEnabled, clockEnabled: v.clockEnabled });
      return freeze({ siteId: d.siteId, terminalId: d.terminal.id, label: d.terminal.label, moduleEnabled: v.moduleEnabled as boolean });
    }, 8192); this.guard(g); this.set({ phase: "entry", device, message: "终端已配对。每次读取、打卡或核对都需重新输入本人 PIN。" }); }
    catch { if (g === this.generation) this.set({ phase: "blocked", device: null, result: null, pending: null, message: "此浏览器未配对或终端验证未就绪。请先到原终端配对入口核对，不会自动配对。" }); }
    finally { this.busy = false; }
  };
  private request(d: IndependentTerminalDevice, no: string, pin: string, request: IndependentTerminalRequest, g: number, expected: string | null) {
    const input: IndependentTerminalBody = parseIndependentTerminalBody({ siteId: d.siteId, terminalId: d.terminalId, workerNo: no, pin, request }), body = JSON.stringify(input);
    if (new TextEncoder().encode(body).byteLength > INDEPENDENT_BODY_LIMIT) unknown();
    return this.wire(INDEPENDENT_TERMINAL_API, body, g, () => { this.stored(g, d, no, expected); }, async raw => {
      const v = exact(raw, ["ok", "data"]); if (v.ok !== true) unknown(); return parseIndependentTerminalResult(v.data, input); });
  }
  read = async (no: string, pin: string) => {
    if (this.busy || !this.state.device) unknown(); const d = this.state.device; no = pinWorkerNo(no); attendancePin(pin); this.busy = true; const g = this.generation; this.forgetTimer();
    try { const { pending } = await this.pending(d, no, g);
      if (pending) { this.set({ phase: "unconfirmed", result: null, pending, message: "有原待确认编号。请另行点击“只读核对原编号”，不会重新打卡。" }); this.shown(); return; }
      this.set({ phase: "loading", result: null, pending: null, message: "正在验证本人 PIN 并读取状态…" });
      const result = await this.request(d, no, pin, { kind: "state" }, g, null); this.guard(g);
      this.set({ phase: "ready", result, message: "状态已读取。选择动作前请重新输入 PIN，并明确确认；不自动打卡。" }); this.shown();
    } catch (e) { if (g === this.generation) this.set({ phase: "blocked", result: null, message: "无法确认本人状态，请检查 PIN、设备与授权后手动重新读取。" }); throw e; }
    finally { pin = ""; this.busy = false; }
  };
  punch = async (action: IndependentAction, pin: string, breakPaid: boolean | null = null) => {
    if (this.busy || !this.state.device || this.state.phase !== "ready" || this.state.result?.data.kind !== "state") unknown();
    const d = this.state.device, r = this.state.result.data, s = r.subject, no = s.workerNo;
    attendancePin(pin); const allowed = r.head.status === "off" ? ["clock_in"] : r.head.status === "break" ? ["break_end"] : ["break_start", "clock_out"];
    if (!allowed.includes(action) || (action === "clock_in" || action === "break_start") && (this.options.allowNew !== true || !d.moduleEnabled)) unknown();
    const command = parseIndependentClockCommand({ operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(), subjectId: s.subjectId, workerId: s.workerId,
      generation: s.generation, credentialId: s.credentialId, credentialRevision: s.credentialRevision, expectedWorkerVersion: s.workerVersion,
      expectedSettingsVersion: s.settingsVersion, locationId: s.locationId, expectedLocationVersion: s.locationVersion, expectedSequence: r.head.sequence, action, breakPaid });
    this.busy = true; this.forgetTimer(); const g = this.generation; let staged = false;
    try { this.stored(g, d, no, null); const fingerprint = await independentClockCommandFingerprint(d.siteId, d.terminalId, command); this.guard(g);
      const pending: IndependentTerminalPending = freeze({ version: 1, siteId: d.siteId, terminalId: d.terminalId, workerNo: no, command, fingerprint }), raw = JSON.stringify(pending);
      const { storage, key } = this.stored(g, d, no, null); if (!Number.isInteger(storage.length) || storage.length < 0 || storage.length > 4096) unknown(); let count = 0;
      for (let i = 0; i < storage.length; i++) { this.guard(g); if (storage.key(i)?.startsWith(prefix)) count++; } if (count >= 64) unknown();
      this.stored(g, d, no, null); storage.setItem(key, raw); this.stored(g, d, no, raw); staged = true;
      this.set({ phase: "saving", result: null, pending, message: "正在提交一次明确打卡；原编号已保留。" });
      const result = await this.request(d, no, pin, { kind: "clock", command }, g, raw); this.guard(g); this.stored(g, d, no, raw);
      this.set({ phase: "unconfirmed", result, pending, message: "已收到打卡回执；请重新输入 PIN 并只读核对原编号，核对完成前不发起下一次打卡。" }); this.shown();
    } catch (e) { if (g === this.generation) this.set({ phase: staged ? "unconfirmed" : "blocked", result: null,
      message: staged ? "结果尚未确认。保留原编号并重新输入 PIN，只读核对；不要重复打卡。" : "待确认存储未能完整写入，尚未发送打卡请求。请先核对会话存储。" }); throw e; }
    finally { pin = ""; this.busy = false; }
  };
  /** Explicit PIN-bearing POST, but request.kind=recover is read-only. Only a
   * receipt matching full staged bytes + original SHA can clear pending. */
  recover = async (no: string, pin: string) => {
    if (this.busy || !this.state.device) unknown(); const d = this.state.device; no = pinWorkerNo(no); attendancePin(pin); this.busy = true; this.forgetTimer(); const g = this.generation;
    try { const { pending: p, raw } = await this.pending(d, no, g); if (!p || raw === null) unknown();
      this.set({ phase: "loading", result: null, pending: p, message: "正在重新验证 PIN，只读核对原编号；不会新增打卡。" });
      const result = await this.request(d, p.workerNo, pin, { kind: "recover", subjectId: p.command.subjectId, workerId: p.command.workerId,
        operationId: p.command.operationId, commandFingerprint: p.fingerprint }, g, raw); this.guard(g);
      if (result.data.kind !== "receipt" || !result.data.receipt || result.data.receipt.commandFingerprint !== p.fingerprint
        || independentClockCommandText(d.siteId, d.terminalId, result.data.receipt.command) !== independentClockCommandText(d.siteId, d.terminalId, p.command)) unknown();
      const { storage, key } = this.stored(g, d, p.workerNo, raw); storage.removeItem(key); this.stored(g, d, p.workerNo, null);
      this.set({ phase: "confirmed", result, pending: null, message: "原打卡已核对确认，没有新增打卡。下一次操作请重新读取状态。" }); this.shown(); return result;
    } catch (e) { if (g === this.generation) this.set({ phase: "unconfirmed", result: null, message: "尚未找到完全匹配的原回执；编号继续保留。不会认定未提交，也不会自动重试。" }); throw e; }
    finally { pin = ""; this.busy = false; }
  };
  personal = async (no: string, pin: string, fromDate: string, throughDate: string, cursor: string | null = null) => {
    if (this.busy || !this.state.device || !this.state.result || this.state.phase !== "ready") unknown();
    const data = this.state.result.data;
    if (data.kind !== "state" && data.kind !== "personal") unknown();
    const d = this.state.device, subject = data.kind === "state" ? data.subject : data.report; no = pinWorkerNo(no); attendancePin(pin); if (no !== subject.workerNo) unknown();
    if (data.kind === "state" ? cursor !== null : cursor === null || cursor !== data.report.nextCursor || fromDate !== data.report.fromDate || throughDate !== data.report.throughDate) unknown();
    const request: IndependentTerminalRequest = { kind: "personal", subjectId: subject.subjectId, workerId: subject.workerId, fromDate, throughDate, cursor };
    //Validate the complete range before any request or asynchronous boundary.
    parseIndependentTerminalBody({ siteId: d.siteId, terminalId: d.terminalId, workerNo: no, pin, request });
    this.busy = true; this.forgetTimer(); const g = this.generation;
    try { this.stored(g, d, no, null); this.set({ phase: "loading", result: null, message: "正在重新验证 PIN 并读取本人原始明细当前页…" });
      const result = await this.request(d, no, pin, request, g, null); this.guard(g); this.set({ phase: "ready", result, pending: null, message: "仅当前页原始事实，尚未规则评估，不是工资表或正式周期。下一页需要再次验证 PIN。" }); this.shown(); return result;
    } catch (e) { if (g === this.generation) this.set({ phase: "blocked", result: null, message: "未能确认本人原始明细。请重新验证身份后手动查询。" }); throw e; }
    finally { pin = ""; this.busy = false; }
  };
}
