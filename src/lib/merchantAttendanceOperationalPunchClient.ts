// One durable non-secret intent, four credential-specific temporary transports.
// Credentials are never assigned to client fields, storage or observable state.
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { pinWorkerNo } from "./merchantAttendancePin";
import { operationalRuleLedgerEqual as equal, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { parseOperationalPunchCommand, parseOperationalPunchJson, parseOperationalPunchResponse,
  type OperationalPunchChannel, type OperationalPunchCommand, type OperationalPunchParseInput, type OperationalPunchQuery, type OperationalPunchResult } from "./merchantAttendanceOperationalPunch";

export type OperationalPunchClientScope = Readonly<{ siteId: string; channel: OperationalPunchChannel; authUserId: string | null; terminalId: string | null; workerNo: string | null }>;
export type OperationalPunchClientContext = OperationalPunchParseInput extends infer I ? I extends OperationalPunchParseInput ? Omit<I, "query" | "command" | "write"> : never : never;
export type OperationalPunchTransport = (query: OperationalPunchQuery, command: OperationalPunchCommand | null, signal: AbortSignal) => Promise<Response>;
export type OperationalPunchPending = Readonly<{ version: 1; scope: OperationalPunchClientScope; command: OperationalPunchCommand }>;
export type OperationalPunchClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "submitting" | "unconfirmed" | "blocked" | "storage_error";
  result: OperationalPunchResult | null; pending: OperationalPunchPending | null; canEndRejected: boolean; message: string }>;
export type OperationalPunchStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type OperationalPunchClientOptions = Readonly<{ scope: OperationalPunchClientScope; storage: () => OperationalPunchStorage; isCurrent: () => boolean;
  blockedKeys: () => readonly string[]; errors: Readonly<Record<string, number>>; timeoutMs?: number }>;
type Lease = { generation: number; controller: AbortController };
const END_REJECTED = new Set(["attendance_operational_punch_changed", "attendance_operational_punch_disabled", "attendance_operational_punch_channel_denied", "attendance_operational_punch_location_denied", "attendance_operational_punch_break_type_denied"]);
class StorageFailure extends Error {}
class Rejected extends Error {}
const hidden = () => typeof document !== "undefined" && document.hidden;
function scopeData(raw: OperationalPunchClientScope): OperationalPunchClientScope {
  // The bounded descriptor-safe JSON parser is also used for local caller data.
  const descriptors = Object.getOwnPropertyDescriptors(raw); if (Reflect.ownKeys(raw).some(k => typeof k !== "string" || !("value" in descriptors[k]))) throw Error("scope_invalid");
  const r = exact(raw, ["siteId", "channel", "authUserId", "terminalId", "workerNo"]), siteId = attendanceSelfSite(r.siteId);
  if (!["self", "location", "pin", "onsite"].includes(String(r.channel))) throw Error("scope_invalid");
  const channel = r.channel as OperationalPunchChannel;
  if (channel === "pin") { if (r.authUserId !== null || typeof r.workerNo !== "string") throw Error("scope_invalid"); return freeze({ siteId, channel, authUserId: null, terminalId: attendanceSelfUuid(r.terminalId), workerNo: pinWorkerNo(r.workerNo).toLowerCase() }); }
  if (r.terminalId !== null || r.workerNo !== null) throw Error("scope_invalid");
  return freeze({ siteId, channel, authUserId: attendanceSelfUuid(r.authUserId), terminalId: null, workerNo: null });
}
export function operationalPunchPendingKey(raw: OperationalPunchClientScope): string { const s = scopeData(raw);
  return `faolla:attendance:operational-punch:v1:${s.siteId}:${s.channel}:${s.channel === "pin" ? `${s.terminalId}:${s.workerNo}` : s.authUserId}`; }
export function parseOperationalPunchPending(text: string, scope: OperationalPunchClientScope): OperationalPunchPending {
  const r = exact(parseOperationalPunchJson(text, "request"), ["version", "scope", "command"]), s = scopeData(r.scope as OperationalPunchClientScope);
  if (r.version !== 1 || !equal(s, scopeData(scope))) throw new StorageFailure("pending_scope_changed");
  return freeze({ version: 1, scope: s, command: parseOperationalPunchCommand(r.command, s.channel, s.siteId) });
}
function clientInput(scope: OperationalPunchClientScope, context: OperationalPunchClientContext, query: OperationalPunchQuery, command: OperationalPunchCommand | null, write: boolean): OperationalPunchParseInput {
  // Own the small, non-secret context before the request yields. Full strict
  // context validation still happens in the response parser before accepting it.
  const r = exact(context, ["siteId", "channel", "authUserId", ...(scope.channel === "location" ? ["expectedWorkerId"] : scope.channel === "pin" ? ["terminalId", "workerNo", "expectedWorkerId", "expectedEmployeeId"] : [])]);
  if (r.siteId !== scope.siteId || r.channel !== scope.channel || r.authUserId !== scope.authUserId || scope.channel === "pin" && (r.terminalId !== scope.terminalId || typeof r.workerNo !== "string" || pinWorkerNo(r.workerNo).toLowerCase() !== scope.workerNo)) throw Error("identity_changed");
  const result = { ...r, query, command, write } as OperationalPunchParseInput;
  if (scope.channel === "location" || scope.channel === "pin") {
    const worker = r.expectedWorkerId; if (worker !== null) attendanceSelfUuid(worker);
    if (command && worker !== command.clock.expectedWorkerId) throw Error("identity_changed");
  }
  if (scope.channel === "pin") { if (r.expectedEmployeeId !== null) attendanceSelfUuid(r.expectedEmployeeId);
    if (r.expectedWorkerId === null && query.mode !== "prepare" || command && "expectedEmployeeId" in command.clock && r.expectedEmployeeId !== command.clock.expectedEmployeeId) throw Error("identity_changed"); }
  return freeze(result);
}
async function request(transport: OperationalPunchTransport, query: OperationalPunchQuery, command: OperationalPunchCommand | null,
  input: OperationalPunchParseInput, signal: AbortSignal, timeoutMs: number, errors: Readonly<Record<string, number>>): Promise<OperationalPunchResult> {
  const controller = new AbortController(), until = performance.now() + timeoutMs; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectDeadline: (e: Error) => void = () => {}; const expired = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const cancel = (message: string) => { controller.abort(); void reader?.cancel().catch(() => {}); rejectDeadline(Error(message)); };
  const abort = () => cancel("aborted"), timer = setTimeout(() => cancel("timeout"), timeoutMs); signal.addEventListener("abort", abort, { once: true });
  const check = () => { if (signal.aborted || controller.signal.aborted) throw Error("aborted"); if (performance.now() >= until) throw Error("timeout"); };
  const run = async () => {
    check(); const response = await transport(query, command, controller.signal);
    try { check(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
    if (response.redirected || response.ok && response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let size = 0, text = "";
    try { while (true) { const { value, done } = await reader.read(); check(); if (done) break; size += value.byteLength;
      if (size > (response.status === 200 ? 262144 : 4096)) throw Error("oversized_response"); text += decoder.decode(value, { stream: true }); } text += decoder.decode(); }
    finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    check(); const result = await parseOperationalPunchResponse(parseOperationalPunchJson(text), input, errors); check();
    if (!result.ok) { if (errors[result.error.code] !== response.status || response.status === 200) throw Error("invalid_error_response"); throw new Rejected(result.error.code); }
    if (response.status !== 200) throw Error("invalid_status"); return result.data;
  };
  try { return await Promise.race([run(), expired]); } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
export class AttendanceOperationalPunchClient {
  readonly storageKey: string; private readonly options: Required<OperationalPunchClientOptions>;
  private state: OperationalPunchClientState = freeze({ phase: "idle", result: null, pending: null, canEndRejected: false, message: "请先核对当前规则与打卡状态。" });
  private pending: OperationalPunchPending | null = null; private raw: string | null = null; private loaded = false; private generation = 0;
  private controller: AbortController | null = null; private prepared = false; private rejectedRaw: string | null = null; private listeners = new Set<() => void>();
  constructor(input: OperationalPunchClientOptions) {
    const timeoutMs = input.timeoutMs ?? 12000, scope = scopeData(input.scope); if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000 || typeof input.storage !== "function" || typeof input.isCurrent !== "function" || typeof input.blockedKeys !== "function") throw Error("invalid_options");
    this.options = Object.freeze({ ...input, scope, errors: Object.freeze({ ...input.errors }), timeoutMs }); this.storageKey = operationalPunchPendingKey(scope);
  }
  getSnapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private publish(patch: Partial<OperationalPunchClientState>) { const s = this.state = freeze({ ...this.state, ...patch, pending: this.pending, canEndRejected: this.rejectedRaw !== null && this.rejectedRaw === this.raw });
    for (const f of [...this.listeners]) { if (s !== this.state) break; try { f(); } catch { /* Observers cannot authorize writes. */ } } }
  pause = () => { const old = this.controller; this.controller = null; ++this.generation; old?.abort(); this.prepared = false; this.rejectedRaw = null;
    this.publish({ result: null, phase: this.pending ? "unconfirmed" : "idle", message: "当前资料已隐藏；待确认编号保留，返回后需重新核对。" }); };
  dispose = this.pause;
  private current() { try { return !hidden() && this.options.isCurrent() === true; } catch { return false; } }
  private begin(): Lease | null { if (!this.current()) { this.pause(); return null; } if (this.controller) return null; const lease = { generation: ++this.generation, controller: new AbortController() }; this.controller = lease.controller; return lease; }
  private guard(l: Lease) { if (!this.current() || l.generation !== this.generation || l.controller !== this.controller || l.controller.signal.aborted) throw Error("aborted"); }
  private release(l: Lease) { if (l.generation === this.generation && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease) { try { this.guard(l); const storage = this.options.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l);
    if (raw !== null && typeof raw !== "string") throw Error("invalid_storage"); return { storage, raw }; } catch { throw new StorageFailure("storage_unavailable"); } }
  private load(l: Lease) { const { raw } = this.stored(l); if (this.loaded) { if (raw !== this.raw) throw new StorageFailure("storage_changed"); return; }
    try { const pending = raw === null ? null : parseOperationalPunchPending(raw, this.options.scope); this.guard(l); this.raw = raw; this.pending = pending; this.loaded = true; } catch { throw new StorageFailure("invalid_pending"); } }
  private verify(l: Lease) { const s = this.stored(l); if (s.raw !== this.raw) throw new StorageFailure("storage_changed"); return s.storage; }
  private others(l: Lease) { const storage = this.verify(l), keys = this.options.blockedKeys(); this.guard(l);
    if (!Array.isArray(keys) || keys.length > 32 || keys.some(k => typeof k !== "string" || k === this.storageKey)) throw Error("invalid_interlock");
    for (const key of keys) { const raw = storage.getItem(key); this.guard(l); if (raw !== null) throw Error("other_pending"); } }
  private clearPending(l: Lease) { const storage = this.verify(l); this.guard(l); try { storage.removeItem(this.storageKey); this.guard(l); if (this.stored(l).raw !== null) throw Error("storage_changed"); this.pending = null; this.raw = null; this.rejectedRaw = null; } catch { throw new StorageFailure("pending_not_cleared"); } }
  private failed(e: unknown, l: Lease) { if (l.generation !== this.generation) return; if (!this.current()) { this.pause(); return; }
    this.prepared = false; this.publish({ result: null, phase: e instanceof StorageFailure ? "storage_error" : this.pending ? "unconfirmed" : "blocked",
      message: e instanceof StorageFailure ? "恢复存储不可用或已改变；未覆盖原编号，暂停新打卡。" : e instanceof Rejected ? `本次请求被拒绝（${e.message}）。${this.pending ? "原编号保留，先核对结果。" : "请重新读取状态。"}` : "结果尚未可靠确认，请保留原编号；不会自动重发打卡。" }); }
  initialize = async () => { const l = this.begin(); if (!l) return; this.prepared = false; this.rejectedRaw = null; try { this.load(l); this.publish({ phase: this.pending ? "unconfirmed" : "idle", result: null, message: this.pending ? "发现待确认编号，请先按原号核对。" : "请先读取本次规则和状态，再明确选择动作。" }); } catch (e) { this.failed(e, l); } finally { this.release(l); } };
  blocksOtherActions = () => { try { return !this.current() || !this.loaded || !!this.controller || !!this.pending || this.state.phase === "storage_error" || this.options.storage().getItem(this.storageKey) !== this.raw; } catch { return true; } };
  prepare = async (context: OperationalPunchClientContext, transport: OperationalPunchTransport) => {
    const l = this.begin(); if (!l) return; this.prepared = false; this.rejectedRaw = null;
    try { this.load(l); if (this.pending) throw Error("pending_exists"); this.others(l);
      const query: OperationalPunchQuery = { mode: "prepare" }, input = clientInput(this.options.scope, context, query, null, false);
      this.publish({ phase: "loading", result: null, message: "正在读取本人规则和打卡状态，不会产生打卡…" }); this.guard(l);
      const result = await request(transport, query, null, input, l.controller.signal, this.options.timeoutMs, this.options.errors); this.guard(l); this.verify(l); this.others(l);
      this.prepared = true; this.publish({ phase: "ready", result, message: "请选择本次动作；没有自动选班或打卡。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  private checkCommand(command: OperationalPunchCommand) {
    const r = this.state.result, c = command.clock, ch = command.choice;
    if (!this.prepared || !r || r.operation || c.expectedWorkerId !== r.clock.workerId || c.expectedSequence !== r.clock.state.sequence) throw Error("stale_preparation");
    if ("expectedEmployeeId" in c && (r.channel === "self" || c.expectedEmployeeId !== r.clock.employeeId)) throw Error("identity_changed");
    if (ch.kind === "start") {
      if (!r.canStart || !r.policy || c.locationId !== r.policy.locationId || ch.expectedPolicyFingerprint !== r.policy.policyFingerprint) throw Error("start_denied");
      if (ch.selection && !r.choices?.entries.some(s => s.id === ch.selection!.slotId && s.revision === ch.selection!.revision)) throw Error("selection_not_listed");
      if (ch.selection && (r.policy.fields.shiftSource.state === "disabled" || r.policy.fields.shiftSource.value === "unplanned")) throw Error("selection_denied");
    } else if (ch.kind === "break") {
      if (!r.canBreak || !r.session || ch.startEventId !== r.session.startEventId || ch.expectedSessionFingerprint !== r.session.sessionFingerprint) throw Error("break_denied");
      const f = r.session.fields.breakTypes; if (f.state === "value" && f.value!.selection === "explicit" ? ch.breakType === null || !f.value!.allowed.includes(ch.breakType) : ch.breakType !== null) throw Error("break_type_required");
    } else if (ch.kind === "legacy_break") { if (!r.canBreak || r.session) throw Error("legacy_break_denied"); }
    else if (!r.canFinish) throw Error("finish_denied");
    if (ch.kind !== "start" && c.locationId !== (r.channel === "location" && c.action !== "break_start" ? r.clock.finish?.locationId ?? r.clock.locationId : r.clock.locationId)) throw Error("location_changed");
  }
  submit = async (rawCommand: OperationalPunchCommand, context: OperationalPunchClientContext, transport: OperationalPunchTransport) => {
    const l = this.begin(); if (!l) return;
    try { this.load(l); this.others(l); if (this.pending) throw Error("pending_exists"); const command = parseOperationalPunchCommand(rawCommand, this.options.scope.channel, this.options.scope.siteId); this.checkCommand(command);
      const query: OperationalPunchQuery = { mode: "recover", operationId: command.clock.operationId }, input = clientInput(this.options.scope, context, query, command, true);
      const pending = parseOperationalPunchPending(JSON.stringify({ version: 1, scope: this.options.scope, command }), this.options.scope), raw = JSON.stringify(pending), storage = this.verify(l);
      this.guard(l); this.pending = pending; this.raw = raw; this.prepared = false; this.rejectedRaw = null;
      try { storage.setItem(this.storageKey, raw); this.guard(l); this.verify(l); } catch { throw new StorageFailure("pending_not_saved"); }
      await this.write(l, query, command, input, transport);
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  private async write(l: Lease, query: OperationalPunchQuery, command: OperationalPunchCommand, input: OperationalPunchParseInput, transport: OperationalPunchTransport) {
    this.others(l); this.publish({ phase: "submitting", result: null, message: "正在提交已保存的完整意图，请等待原号核对…" }); this.guard(l); this.others(l);
    try { const result = await request(transport, query, command, input, l.controller.signal, this.options.timeoutMs, this.options.errors);
      this.guard(l); this.verify(l); if (!result.operation) throw Error("receipt_missing"); this.clearPending(l);
      this.publish({ phase: "ready", result, message: "原号记录已确认。下一次动作前请重新读取当前状态。" });
    } catch (e) { this.guard(l); this.verify(l); if (e instanceof Rejected && END_REJECTED.has(e.message)) this.rejectedRaw = this.raw; throw e; }
  }
  recover = async (context: OperationalPunchClientContext, transport: OperationalPunchTransport) => {
    const l = this.begin(); if (!l) return; this.prepared = false; this.rejectedRaw = null;
    try { this.load(l); const command = this.pending?.command; if (!command) throw Error("pending_missing");
      const query: OperationalPunchQuery = { mode: "recover", operationId: command.clock.operationId }, input = clientInput(this.options.scope, context, query, command, false);
      this.publish({ phase: "loading", result: null, message: "正在核对原操作编号；不会重发打卡。" }); this.guard(l);
      const result = await request(transport, query, null, input, l.controller.signal, this.options.timeoutMs, this.options.errors); this.guard(l); this.verify(l);
      // A higher sequence, null receipt, or old-protocol receipt never proves
      // that this complete operational command was accepted or not submitted.
      if (result.operation) this.clearPending(l);
      this.publish({ phase: this.pending ? "unconfirmed" : "ready", result, message: this.pending ? "尚无匹配的完整原号回执；编号保留，请负责人核验。" : "原号记录已确认；不会自动继续下一动作。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  retry = async (context: OperationalPunchClientContext, transport: OperationalPunchTransport) => {
    const l = this.begin(); if (!l) return; this.prepared = false; this.rejectedRaw = null;
    try { this.load(l); this.others(l); const command = this.pending?.command; if (!command) throw Error("pending_missing"); const query: OperationalPunchQuery = { mode: "recover", operationId: command.clock.operationId };
      await this.write(l, query, command, clientInput(this.options.scope, context, query, command, true), transport);
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  endRejected = async () => { const l = this.begin(); if (!l) return;
    try { this.load(l); this.verify(l); if (!this.pending || this.rejectedRaw === null || this.rejectedRaw !== this.raw) throw Error("not_confirmed_rejected"); this.clearPending(l); this.prepared = false;
      this.publish({ phase: "idle", result: null, message: "已结束本次明确被拒绝的意图；请重新读取规则，不会改写旧记录。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
}
