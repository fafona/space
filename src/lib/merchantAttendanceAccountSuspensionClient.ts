import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { ACCOUNT_SUSPENSION_API, ACCOUNT_SUSPENSION_BYTE_LIMIT, ACCOUNT_SUSPENSION_ERRORS, parseAccountSuspensionJson, parseAccountSuspensionQuery,
  parseAccountSuspensionCommand, parseAccountStatusCommand, parseAccountSuspensionResponse, accountSuspensionQueryString,
  accountSuspensionCommandFingerprint, accountStatusCommandFingerprint, accountSuspensionReceiptMatches, accountStatusReceiptMatches,
  type AccountSuspensionCommand, type AccountStatusCommand, type AccountStatusIntent, type AccountSuspensionQuery, type AccountSuspensionResult } from "./merchantAttendanceAccountSuspension";
export type AccountSuspensionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type AccountSuspensionClientOptions = { siteId: string; actorId: string; apiFetch: AttendanceApiFetch; storage: () => AccountSuspensionStorage;
  randomId?: () => string; timeoutMs?: number; isCurrentAuth?: () => boolean };
export type AccountSuspensionPending = { version: 1; siteId: string; actorId: string; command: AccountSuspensionCommand; commandFingerprint: string };
export type AccountStatusPending = { version: 1; siteId: string; actorId: string; command: AccountStatusCommand; commandFingerprint: string };
export type AccountSuspensionClientState<C = AccountSuspensionCommand> = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  result: AccountSuspensionResult | null; pending: { version: 1; siteId: string; actorId: string; command: C; commandFingerprint: string } | null; message: string }>;
export type AccountStatusClientState = AccountSuspensionClientState<AccountStatusCommand>;
const hidden = () => typeof document !== "undefined" && document.hidden;
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
const identity = (s: string) => { if (typeof s !== "string" || s.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s)) throw Error("invalid_identity"); return s; };
function base(siteId: string, patch: Partial<AccountSuspensionQuery> = {}) { return parseAccountSuspensionQuery({ siteId, mode: "list", afterId: null, suspensionId: null, operationId: null, ...patch }); }
export function accountSuspensionPendingKey(siteId: string, actorId: string) { base(siteId); return `faolla:attendance:account-suspension:v1:${siteId}:${identity(actorId)}`; }
export function accountStatusPendingKey(siteId: string, actorId: string) { base(siteId); return `faolla:attendance:account-status:v1:${siteId}:${identity(actorId)}`; }
type Lease = { epoch: number; controller: AbortController };
async function transport(o: AccountSuspensionClientOptions, path: string, method: "GET" | "POST" | "PATCH", body: unknown, signal: AbortSignal) {
  const c = new AbortController(), ms = o.timeoutMs ?? 12000, deadline = performance.now() + ms; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (e: Error) => void;
  const stopped = new Promise<never>((_, r) => { reject = r; });
  const cancel = () => { c.abort(); reject(Error("aborted_or_timeout")); void reader?.cancel().catch(() => {}); };
  const timer = setTimeout(cancel, ms); signal.addEventListener("abort", cancel, { once: true });
  const guard = () => { if (signal.aborted || c.signal.aborted || performance.now() >= deadline || o.isCurrentAuth?.() === false) throw Error("stale_scope"); };
  const run = async () => { guard(); const response = await o.apiFetch(path, { method, headers: { Accept: "application/json", ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }), signal: c.signal, cache: "no-store", redirect: "error" });
    if (signal.aborted || c.signal.aborted || response.redirected || response.ok && response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    guard(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response"); let text = "", n = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
    try { while (true) { const part = await reader.read(); guard(); if (part.done) break; n += part.value.byteLength; if (n > (response.status === 200 ? ACCOUNT_SUSPENSION_BYTE_LIMIT : 4096)) throw Error("too_large"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    guard(); const raw = parseAccountSuspensionJson(text); if (response.status !== 200) { const e = captureBrowserExact(raw, ["ok", "error"]);
      if (e.ok !== false || typeof e.error !== "string" || method !== "PATCH" && (!Object.hasOwn(ACCOUNT_SUSPENSION_ERRORS, e.error) || ACCOUNT_SUSPENSION_ERRORS[e.error] !== response.status)) throw Error("invalid_error"); throw Error(e.error); } return raw; };
  try { return await Promise.race([run(), stopped]); } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}
/** A single stored intent can only be settled by its original authenticated receipt. */
class AccountClient<C extends AccountSuspensionCommand | AccountStatusCommand> {
  readonly storageKey: string; protected readonly o: AccountSuspensionClientOptions;
  protected state: AccountSuspensionClientState<C> = freeze({ phase: "idle", result: null, pending: null, message: "请明确读取，系统不会自动提交。" });
  private epoch = 0; private controller: AbortController | null = null; private raw: string | null = null; protected loaded = false;
  private listeners = new Set<() => void>(); private query: AccountSuspensionQuery | null = null;
  constructor(options: AccountSuspensionClientOptions, private readonly status: boolean) { this.storageKey = (status ? accountStatusPendingKey : accountSuspensionPendingKey)(options.siteId, options.actorId);
    if (typeof options.apiFetch !== "function" || typeof options.storage !== "function" || options.randomId !== undefined && typeof options.randomId !== "function"
      || options.isCurrentAuth !== undefined && typeof options.isCurrentAuth !== "function" || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("invalid_options"); this.o = Object.freeze({ ...options }); }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  protected publish(patch: Partial<AccountSuspensionClientState<C>>) { const next = this.state = freeze({ ...this.state, ...patch }); for (const f of [...this.listeners]) { if (next !== this.state) break; try { f(); } catch { /* A view callback is not authority. */ } } }
  pause = () => { const epoch = ++this.epoch, c = this.controller; this.controller = null; this.query = null; c?.abort(); if (epoch === this.epoch) this.publish({ result: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "资料已隐藏；原编号保留，只能读取原结果。" }); };
  invalidate = this.pause;
  hasLeaveRisk = () => { if (this.controller || this.state.pending) return true; try { return this.o.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin() { if (hidden() || this.o.isCurrentAuth?.() === false) { this.pause(); return null; } if (this.controller) return null; const l = { epoch: ++this.epoch, controller: new AbortController() }; this.controller = l.controller; return l; }
  private guard(l: Lease) { if (l.epoch === this.epoch && (hidden() || this.o.isCurrentAuth?.() === false)) this.pause(); if (l.epoch !== this.epoch || this.controller !== l.controller || l.controller.signal.aborted) throw Error("stale_scope"); }
  private release(l: Lease) { if (l.epoch === this.epoch && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease) { this.guard(l); const s = this.o.storage(); this.guard(l); const raw = s.getItem(this.storageKey); this.guard(l); return { s, raw }; }
  private verify(l: Lease) { const v = this.stored(l); if (v.raw !== this.raw) throw Error("pending_changed"); return v.s; }
  private parseCommand(v: unknown): C { return (this.status ? parseAccountStatusCommand(v) : parseAccountSuspensionCommand(v)) as C; }
  private fingerprint(c: C) { return this.status ? accountStatusCommandFingerprint(this.o.siteId, c as AccountStatusCommand) : accountSuspensionCommandFingerprint(this.o.siteId, c as AccountSuspensionCommand); }
  private failed(l: Lease) { if (l.epoch !== this.epoch) return; if (hidden() || this.o.isCurrentAuth?.() === false) { this.pause(); return; } this.query = null; this.publish({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: this.state.pending ? "结果尚未核实；原编号保留。请只读恢复，查无回执不代表失败，不会重发。" : "无法核验当前资料或待确认存储；旧内容已清除。" }); }
  initialize = async () => { const l = this.begin(); if (!l) return; try { const { raw } = this.stored(l); if (this.state.pending && raw !== this.raw) throw Error("pending_changed");
    let pending: AccountSuspensionClientState<C>["pending"] = null;
    if (raw !== null) { const p = captureBrowserExact(parseAccountSuspensionJson(raw, "request"), ["version", "siteId", "actorId", "command", "commandFingerprint"]), command = this.parseCommand(p.command);
      if (p.version !== 1 || p.siteId !== this.o.siteId || p.actorId !== this.o.actorId) throw Error("pending_identity"); const commandFingerprint = await this.fingerprint(command); this.guard(l); if (p.commandFingerprint !== commandFingerprint) throw Error("pending_hash"); pending = { version: 1, siteId: this.o.siteId, actorId: this.o.actorId, command, commandFingerprint }; }
    if (this.stored(l).raw !== raw) throw Error("pending_changed"); this.raw = raw; this.loaded = true; this.publish({ pending, result: null, phase: pending ? "unconfirmed" : "idle", message: pending ? "发现原编号，需明确读取原结果。" : "请明确读取当前资料。" });
  } catch { this.failed(l); } finally { this.release(l); } };
  private settle(result: AccountSuspensionResult, l: Lease) { const p = this.state.pending; if (!p) return;
    const matches = this.status ? result.statusReceipt && accountStatusReceiptMatches(result.statusReceipt, p.command as AccountStatusCommand, p.commandFingerprint)
      : result.receipt && accountSuspensionReceiptMatches(result.receipt, p.command as AccountSuspensionCommand, p.commandFingerprint);
    if (!(this.status ? result.statusReceipt : result.receipt)) return; if (!matches) throw Error("receipt_mismatch");
    const s = this.verify(l); this.guard(l); s.removeItem(this.storageKey); this.guard(l); if (this.stored(l).raw !== null) throw Error("pending_changed"); this.raw = null; this.publish({ pending: null }); this.guard(l);
  }
  private async readInLease(q: AccountSuspensionQuery, l: Lease) { const raw = await transport(this.o, `${ACCOUNT_SUSPENSION_API}?${accountSuspensionQueryString(q)}`, "GET", null, l.controller.signal); this.guard(l); this.verify(l);
    const result = parseAccountSuspensionResponse(raw, q, this.o.actorId); this.settle(result, l); this.guard(l); this.query = q;
    this.publish({ result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending ? "尚无可匹配回执；编号保留，不能推断失败。" : result.receipt || result.statusReceipt ? "已核实原操作回执；不自动恢复其他考勤权限。" : "仅核验当前暂停依据；申请未逐项核查，其他浏览器未知编号不可观察。" }); }
  protected async get(q: AccountSuspensionQuery) { const l = this.begin(); if (!l) return; try { if (!this.loaded || this.state.pending && !["recover", "recover-status"].includes(q.mode)) return;
    this.verify(l); this.publish({ phase: "loading", result: null, message: "正在读取并核验…" }); this.guard(l); await this.readInLease(q, l);
  } catch { this.failed(l); } finally { this.release(l); } }
  load = async () => { if (!this.status) await this.get(base(this.o.siteId)); };
  next = async () => { const r = this.state.result; if (!this.status && this.query?.mode === "list" && r?.nextAfterId) await this.get(base(this.o.siteId, { afterId: r.nextAfterId })); };
  detail = async (suspensionId: string) => { if (!this.status) await this.get(base(this.o.siteId, { mode: "detail", suspensionId })); };
  recover = async () => { const p = this.state.pending; if (p) await this.get(base(this.o.siteId, { mode: this.status ? "recover-status" : "recover", operationId: p.command.operationId })); };
  protected async write(make: (operationId: string) => C) { if (!this.loaded || this.state.pending) return; const l = this.begin(); if (!l) return;
    try { this.verify(l); const op = (this.o.randomId ?? (() => crypto.randomUUID()))(); this.guard(l); const command = this.parseCommand(make(op));
      this.publish({ result: null, phase: "saving", message: "正在保存本次明确意图…" }); this.guard(l); const commandFingerprint = await this.fingerprint(command); this.guard(l);
      const pending = freeze({ version: 1 as const, siteId: this.o.siteId, actorId: this.o.actorId, command, commandFingerprint }); const raw = JSON.stringify(pending); parseAccountSuspensionJson(raw, "request");
      const s = this.verify(l); this.raw = raw; this.publish({ pending }); this.guard(l); s.setItem(this.storageKey, raw); this.guard(l); this.verify(l);
      this.publish({ message: "原编号已保存，仅提交一次；未知结果只能读回执。" }); this.guard(l); this.verify(l);
      if (this.status) { const value = await transport(this.o, "/api/merchant-enterprise/employees", "PATCH", { siteId: this.o.siteId, ...command }, l.controller.signal); this.guard(l); this.verify(l);
        // The original endpoint keeps its original employee response. It is not a suspension receipt.
        const v = captureBrowserExact(value, ["ok", "employee"]); if (v.ok !== true || !v.employee || typeof v.employee !== "object") throw Error("invalid_employee_response");
        const e = v.employee as Record<string, unknown>, c = command as AccountStatusCommand; if (e.id !== c.employeeId || e.version !== c.version + 1 || e.status !== c.status) throw Error("employee_mismatch");
        await this.readInLease(base(this.o.siteId, { mode: "recover-status", operationId: c.operationId }), l);
      } else { const c = command as AccountSuspensionCommand, q = base(this.o.siteId, { mode: "detail", suspensionId: c.suspensionId });
        const raw = await transport(this.o, ACCOUNT_SUSPENSION_API, "POST", { query: q, command: c }, l.controller.signal); this.guard(l); this.verify(l);
        const result = parseAccountSuspensionResponse(raw, q, this.o.actorId, c); this.settle(result, l); this.guard(l); this.query = q; this.publish({ result, phase: "ready", message: "原恢复操作已核实；PIN与旧委托不会恢复。" }); }
    } catch { this.failed(l); } finally { this.release(l); } }
}
export class AttendanceAccountSuspensionClient extends AccountClient<AccountSuspensionCommand> {
  constructor(options: AccountSuspensionClientOptions) { super(options, false); }
  restore = async (reason: string) => { const d = this.state.result?.detail; if (!d?.canRestore || d.employeeVersion === null || d.suspension.employeeAuthUserId === null) return;
    await this.write(operationId => ({ action: "restore", operationId, suspensionId: d.suspension.suspensionId, expectedGeneration: d.suspension.generation, workerId: d.suspension.workerId,
      expectedWorkerVersion: d.workerVersion, expectedEmployeeVersion: d.employeeVersion!, employeeId: d.suspension.employeeId, employeeAuthUserId: d.suspension.employeeAuthUserId!, reason: reason.trim() })); };
}
export class AttendanceAccountStatusClient extends AccountClient<AccountStatusCommand> {
  constructor(options: AccountSuspensionClientOptions) { super(options, true); }
  submit = async (intent: AccountStatusIntent) => { await this.write(operationId => ({ ...intent, operationId })); };
}
