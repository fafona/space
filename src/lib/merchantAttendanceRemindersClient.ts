//201 explicit Auth transport. No timers dispatch reminders, no navigation grants
//authority, and only a matching original-actor GET may clear a pending command.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { ATTENDANCE_REMINDERS_PROTOCOL, ATTENDANCE_REMINDER_RESULT_BYTES, parseAttendanceReminderJson,
  parseAttendanceReminderQuery, parseAttendanceReminderBody, attendanceReminderCommandFingerprint,
  attendanceReminderCommandFingerprintText, type AttendanceReminderBody, type AttendanceReminderQuery,
  type AttendanceReminderCommand, type AttendanceReminderResult } from "./merchantAttendanceReminders";
import { ATTENDANCE_REMINDERS_API, attendanceReminderHttpQueryString, parseAttendanceReminderHttpEnvelope } from "./merchantAttendanceRemindersHttp";

export type ReminderStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ReminderPending = Readonly<{ protocol: typeof ATTENDANCE_REMINDERS_PROTOCOL; format: 1; actorId: string;
  query: AttendanceReminderBody["query"]; command: AttendanceReminderCommand; commandFingerprint: string }>;
export type RemindersClientState = Readonly<{ phase: "idle" | "loading" | "saving" | "recovering" | "ready" | "unconfirmed" | "blocked";
  pending: ReminderPending | null; query: AttendanceReminderQuery | null; result: AttendanceReminderResult | null; message: string }>;
export type RemindersClientOptions = Readonly<{ siteId: string; actorId: string; apiFetch: AttendanceApiFetch;
  storage: () => ReminderStorage; isCurrentAuth?: () => boolean; canWrite?: () => boolean;
  onState?: (state: RemindersClientState) => void; timeoutMs?: number }>;
type Lease = { generation: number; controller: AbortController; deadline: number };
const errorCodes = Object.freeze({ attendance_invalid_request: 400, attendance_reminder_invalid: 503,
  attendance_reminder_changed: 409, attendance_reminder_disabled: 403, attendance_reminder_too_large: 422,
  attendance_access_denied: 403, attendance_settings_required: 409, attendance_operation_conflict: 409, attendance_rate_limited: 429 });
const hidden = () => typeof document !== "undefined" && document.hidden;
function unknown(): never { throw new MerchantAttendanceError("attendance_reminder_invalid"); }
export function remindersAuthCurrent(check?: () => boolean): boolean { try { return check?.() === true; } catch { return false; } }
export function attendanceReminderPendingKey(siteId: string, actorId: string): string {
  //Use the actual wire validators, not a second permissive identity format.
  attendanceReminderCommandFingerprintText({ siteId, mode: "check", batchId: null, operationId: null, cursor: null }, actorId,
    { action: "run_due", operationId: "00000000-0000-4000-8000-000000000001", cursor: null });
  return `faolla:attendance:reminders:v1:${siteId}:${actorId}`;
}
export class AttendanceRemindersClient {
  readonly storageKey: string;
  private readonly options: RemindersClientOptions;
  private state: RemindersClientState = freeze({ phase: "idle", pending: null, query: null, result: null, message: "请明确读取提醒；不会自动联网。" });
  private generation = 0; private controller: AbortController | null = null; private disposed = false; private notifying = false;
  constructor(options: RemindersClientOptions) {
    this.storageKey = attendanceReminderPendingKey(options.siteId, options.actorId);
    if (typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)
      || [options.isCurrentAuth, options.canWrite, options.onState].some(v => v !== undefined && typeof v !== "function")) unknown();
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  private publish(state: RemindersClientState) {
    this.state = freeze(state); if (this.notifying || this.disposed) return;
    this.notifying = true; try { this.options.onState?.(this.state); } catch { /* Observers are not authority. */ } finally { this.notifying = false; }
  }
  pause = () => { this.generation++; const prior = this.controller; this.controller = null; prior?.abort();
    this.publish({ phase: "idle", pending: null, query: null, result: null, message: "正文已隐藏；本地原操作编号保留，返回后请明确核验。" }); };
  dispose = () => { this.disposed = true; this.pause(); };
  hasLeaveRisk = () => { if (this.controller) return true; try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private guard(l: Lease, write = false) {
    if (this.disposed || l.generation !== this.generation || l.controller !== this.controller || l.controller.signal.aborted) unknown();
    if (hidden() || !remindersAuthCurrent(this.options.isCurrentAuth)) { this.pause(); unknown(); }
    if (performance.now() >= l.deadline) { l.controller.abort(); unknown(); }
    if (write && !remindersAuthCurrent(this.options.canWrite)) unknown();
  }
  private stored(l: Lease, expected?: string | null) {
    this.guard(l); const storage = this.options.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l);
    if (expected !== undefined && raw !== expected) unknown(); return { storage, raw };
  }
  private bound(query: AttendanceReminderQuery): AttendanceReminderQuery {
    const q = parseAttendanceReminderQuery(query); if (q.siteId !== this.options.siteId) unknown(); return q;
  }
  private async decode(raw: string, l: Lease): Promise<ReminderPending> {
    //This format contains only the non-secret immutable command, not batch bodies.
    const v = exact(parseAttendanceReminderJson(raw), ["protocol", "format", "actorId", "query", "command", "commandFingerprint"]);
    if (v.protocol !== ATTENDANCE_REMINDERS_PROTOCOL || v.format !== 1 || v.actorId !== this.options.actorId) unknown();
    const pair = parseAttendanceReminderBody({ query: v.query, command: v.command }); this.bound(pair.query);
    const commandFingerprint = await attendanceReminderCommandFingerprint(pair.query, this.options.actorId, pair.command); this.guard(l);
    if (v.commandFingerprint !== commandFingerprint) unknown();
    return freeze({ protocol: ATTENDANCE_REMINDERS_PROTOCOL, format: 1, actorId: this.options.actorId, ...pair, commandFingerprint });
  }
  private async operation<T>(run: (l: Lease) => Promise<T>): Promise<T> {
    if (this.controller || this.disposed) unknown();
    const controller = new AbortController(), l = { generation: ++this.generation, controller, deadline: performance.now() + (this.options.timeoutMs ?? 12000) };
    this.controller = controller; let reject!: (error: Error) => void;
    const interrupted = new Promise<never>((_, no) => { reject = no; }), abort = () => reject(Error("unconfirmed"));
    controller.signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(() => controller.abort(), Math.max(0, l.deadline - performance.now()));
    try { return await Promise.race([Promise.resolve().then(() => { this.guard(l); return run(l); }), interrupted]); }
    catch {
      if (l.generation === this.generation && !this.disposed) this.publish({ phase: "blocked", pending: hidden() || !remindersAuthCurrent(this.options.isCurrentAuth) ? null : this.state.pending,
        query: null, result: null, message: "暂时无法核实结果；原操作编号保留，请核对原号，不要重发。" });
      return unknown();
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); if (this.controller === controller) this.controller = null; }
  }
  load = () => this.operation(async l => {
    const { raw } = this.stored(l), pending = raw === null ? null : await this.decode(raw, l); this.stored(l, raw);
    this.publish({ phase: pending ? "unconfirmed" : "idle", pending, query: null, result: null,
      message: pending ? "发现本地原操作编号；请明确 GET 核验。" : "本地原号槽为空；尚未联网。" }); this.stored(l, raw); return pending;
  });
  private async transport(query: AttendanceReminderQuery, command: AttendanceReminderCommand | null, body: string | null, l: Lease, rawPending: string | null) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void reader?.cancel().catch(() => {}); }; l.controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      this.stored(l, rawPending); if (body !== null) this.guard(l, true);
      const read = query.mode === "recover" ? { query, expectedCommand: command! } : { query, expectedCommand: null };
      const response = await this.options.apiFetch(ATTENDANCE_REMINDERS_API + (body === null ? "?" + attendanceReminderHttpQueryString(read) : ""), {
        method: body === null ? "GET" : "POST", cache: "no-store", redirect: "error", signal: l.controller.signal,
        headers: body === null ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" }, ...(body === null ? {} : { body }) });
      try { this.stored(l, rawPending); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      if (response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); unknown(); }
      const cap = response.status === 200 && response.ok ? ATTENDANCE_REMINDER_RESULT_BYTES : 4096;
      reader = response.body?.getReader(); if (!reader) unknown(); const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      try { while (true) { const part = await reader.read(); this.stored(l, rawPending); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > cap) unknown(); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
      this.stored(l, rawPending); const raw = parseAttendanceReminderJson(text, "response");
      if (response.status !== 200 || !response.ok) {
        const e = exact(raw, ["ok", "error"]), value = exact(e.error, ["code", "message"]);
        if (e.ok !== false || typeof value.code !== "string" || !Object.hasOwn(errorCodes, value.code)
          || errorCodes[value.code as keyof typeof errorCodes] !== response.status
          || value.message !== (value.code === "attendance_access_denied" ? "当前账号无权查看或处理此提醒。" : "暂时无法核实提醒结果，请保留原操作编号再核对。")) unknown();
        return unknown(); //Do not expose an untrusted server body as UI text.
      }
      const value = (await parseAttendanceReminderHttpEnvelope(raw, query, this.options.actorId, command)).data;
      this.stored(l, rawPending); return value;
    } finally { l.controller.signal.removeEventListener("abort", cancel); }
  }
  read = (rawQuery: Exclude<AttendanceReminderQuery, { mode: "recover" }>) => {
    const query = this.bound(rawQuery); if (query.mode === "recover") unknown();
    return this.operation(async l => {
      this.stored(l, null); this.publish({ phase: "loading", pending: null, query, result: null, message: "正在明确读取当前提醒…" }); this.stored(l, null);
      const result = await this.transport(query, null, null, l, null); this.stored(l, null);
      this.publish({ phase: "ready", pending: null, query, result, message: "提醒已读取；站内跳转仍须原入口重新核权。" }); this.stored(l, null); return result;
    });
  };
  submit = (rawQuery: AttendanceReminderBody["query"], rawCommand: AttendanceReminderCommand) => {
    const pair = parseAttendanceReminderBody({ query: rawQuery, command: rawCommand }); this.bound(pair.query);
    return this.operation(async l => {
      this.guard(l, true); this.stored(l, null);
      const commandFingerprint = await attendanceReminderCommandFingerprint(pair.query, this.options.actorId, pair.command); this.stored(l, null); this.guard(l, true);
      const pending: ReminderPending = freeze({ protocol: ATTENDANCE_REMINDERS_PROTOCOL, format: 1, actorId: this.options.actorId, ...pair, commandFingerprint });
      const raw = JSON.stringify(pending); parseAttendanceReminderJson(raw); const { storage } = this.stored(l, null); storage.setItem(this.storageKey, raw); this.stored(l, raw); this.guard(l, true);
      this.publish({ phase: "saving", pending, query: pair.query, result: null, message: "原操作已保存；仅提交一次，不自动重发。" }); this.stored(l, raw);
      const result = await this.transport(pair.query, pair.command, JSON.stringify(pair), l, raw); this.stored(l, raw);
      this.publish({ phase: "unconfirmed", pending, query: pair.query, result, message: "已收到响应，仍保留原号；请明确 GET 核验。" }); this.stored(l, raw); return result;
    });
  };
  recover = () => this.operation(async l => {
    const { raw } = this.stored(l); if (raw === null) unknown(); const pending = await this.decode(raw, l); this.stored(l, raw);
    const query = parseAttendanceReminderQuery({ siteId: this.options.siteId, mode: "recover", batchId: null, operationId: pending.command.operationId, cursor: null });
    this.publish({ phase: "recovering", pending, query, result: null, message: "仅 GET 核验原操作、原账号及完整摘要…" }); this.stored(l, raw);
    const result = await this.transport(query, pending.command, null, l, raw); this.stored(l, raw);
    if (result.receipt === null || result.receipt.commandFingerprint !== pending.commandFingerprint) unknown();
    const { storage } = this.stored(l, raw); storage.removeItem(this.storageKey); this.stored(l, null);
    this.publish({ phase: "ready", pending: null, query, result, message: "原号 GET 已核验；只清除此条本地原号，不自动打开或处理业务。" }); this.stored(l, null); return result;
  });
}
