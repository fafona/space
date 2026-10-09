// 200 first-send transport only. The old owner/delegate period slot remains
// the single local writer exclusion; unknown formats are never empty slots.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { periodClosurePendingKey } from "./merchantAttendancePeriodClosureClient";
import { periodDelegatedClosurePendingKey, type PeriodDelegatedClosureScope } from "./merchantAttendancePeriodDelegatedClosureClient";
import { CYCLE_SEND_API, CYCLE_SEND_BODY_LIMIT, cycleSendQueryString, cycleSendCommandFingerprint,
  parseCycleSendBodyJson, parseCycleSendFrame, parseCycleSendCommand, type CycleSendFrame, type CycleSendCommand } from "./merchantAttendanceCycleSend";
import { CYCLE_SEND_RESULT_LIMIT, parseCycleSendResultJson, parseCycleSendResponse, type CycleSendResult } from "./merchantAttendanceCycleSendResult";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type CycleSendStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Owner = Readonly<{ siteId: string; actorId: string; access: "owner"; delegateScope?: never }>;
type Delegate = Readonly<{ siteId: string; actorId: string; access: "delegate"; delegateScope: PeriodDelegatedClosureScope }>;
export type CycleSendPending = Readonly<{ format: 3; kind: "operational_cycle"; actorId: string;
  scope: Readonly<PeriodDelegatedClosureScope> | null; frame: CycleSendFrame; command: CycleSendCommand; commandFingerprint: string }>;
export type CycleSendClientState = Readonly<{ phase: "idle" | "saving" | "recovering" | "unconfirmed" | "blocked";
  pending: CycleSendPending | null; result: CycleSendResult | null; message: string }>;
export type CycleSendClientOptions = (Owner | Delegate) & Readonly<{ apiFetch: AttendanceApiFetch; storage: () => CycleSendStorage;
  isCurrentAuth?: () => boolean; onState?: (state: CycleSendClientState) => void; timeoutMs?: number }>;
type Lease = { generation: number; controller: AbortController; deadline: number };
const scopeKeys = ["siteId", "actorEmployeeId", "expectedAuthUserId", "grantId", "workerId", "targetEmployeeId", "targetAuthUserId", "authorizedFromDate", "authorizedThroughDate"] as const;
const hidden = () => typeof document !== "undefined" && document.hidden;
function unknown(): never { throw new MerchantAttendanceError("attendance_cycle_recovery_required"); }
function scope(raw: unknown): Readonly<PeriodDelegatedClosureScope> {
  const owned = exact(raw, scopeKeys) as PeriodDelegatedClosureScope;
  periodDelegatedClosurePendingKey(owned); return freeze({ ...owned });
}
const sameScope = (a: Readonly<PeriodDelegatedClosureScope>, b: Readonly<PeriodDelegatedClosureScope>) => scopeKeys.every(k => a[k] === b[k]);

export class AttendanceCycleSendClient {
  readonly storageKey: string;
  private readonly options: CycleSendClientOptions;
  private state: CycleSendClientState = freeze({ phase: "idle", pending: null, result: null, message: "请明确读取本地原号；不会自动联网。" });
  private generation = 0; private controller: AbortController | null = null; private disposed = false; private notifying = false;
  constructor(raw: CycleSendClientOptions) {
    if (typeof raw.apiFetch !== "function" || typeof raw.storage !== "function" || raw.isCurrentAuth !== undefined && typeof raw.isCurrentAuth !== "function"
      || raw.onState !== undefined && typeof raw.onState !== "function" || raw.timeoutMs !== undefined && (!Number.isInteger(raw.timeoutMs) || raw.timeoutMs < 1 || raw.timeoutMs > 12000)) unknown();
    if (raw.access === "owner") {
      if (raw.delegateScope !== undefined) unknown(); this.storageKey = periodClosurePendingKey(raw.siteId, "owner", raw.actorId);
      this.options = Object.freeze({ ...raw });
    } else if (raw.access === "delegate") {
      const s = scope(raw.delegateScope); if (s.siteId !== raw.siteId || s.expectedAuthUserId !== raw.actorId) unknown();
      this.storageKey = periodDelegatedClosurePendingKey(s); this.options = Object.freeze({ ...raw, delegateScope: s });
    } else unknown();
  }
  getSnapshot = () => this.state;
  private publish(patch: CycleSendClientState) {
    this.state = freeze(patch); if (this.notifying || this.disposed) return;
    this.notifying = true; try { this.options.onState?.(this.state); } catch { /* Observers confer no authority. */ } finally { this.notifying = false; }
  }
  pause = () => {
    this.generation++; const previous = this.controller; this.controller = null; previous?.abort();
    this.publish({ phase: "idle", pending: null, result: null, message: "正文已隐藏；原槽保留，返回后请显式读取本地状态。" });
  };
  dispose = () => { this.disposed = true; this.pause(); };
  hasLeaveRisk = () => { if (this.controller) return true; try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private currentAuth() { try { return this.options.isCurrentAuth?.() === true; } catch { return false; } }
  private guard(l: Lease) {
    if (this.disposed || l.generation !== this.generation || l.controller !== this.controller || l.controller.signal.aborted) unknown();
    if (hidden() || !this.currentAuth()) { this.pause(); unknown(); }
    if (performance.now() >= l.deadline) { l.controller.abort(); unknown(); }
  }
  private stored(l: Lease, expected?: string | null) {
    this.guard(l); const storage = this.options.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l);
    if (expected !== undefined && raw !== expected) unknown(); return { storage, raw };
  }
  private bound(raw: unknown): CycleSendFrame {
    const frame = parseCycleSendFrame(raw), o = this.options;
    if (frame.siteId !== o.siteId || frame.access !== o.access) unknown();
    if (o.access === "delegate" && (frame.grantId !== o.delegateScope.grantId || frame.workerId !== o.delegateScope.workerId
      || frame.fromDate < o.delegateScope.authorizedFromDate || frame.throughDate > o.delegateScope.authorizedThroughDate)) unknown();
    return frame;
  }
  private async decode(raw: string, l: Lease): Promise<CycleSendPending> {
    if (new TextEncoder().encode(raw).byteLength > CYCLE_SEND_RESULT_LIMIT) unknown();
    const v = exact(parseCycleSendResultJson(raw), ["format", "kind", "actorId", "scope", "frame", "command", "commandFingerprint"]);
    if (v.format !== 3 || v.kind !== "operational_cycle" || v.actorId !== this.options.actorId) unknown();
    const savedScope = v.scope === null ? null : scope(v.scope), o = this.options;
    if (o.access === "owner" ? savedScope !== null : !savedScope || !sameScope(savedScope, o.delegateScope)) unknown();
    const frame = this.bound(v.frame), command = parseCycleSendCommand(v.command, frame);
    const commandFingerprint = await cycleSendCommandFingerprint(frame, command, o.actorId); this.guard(l);
    if (v.commandFingerprint !== commandFingerprint) unknown();
    return freeze({ format: 3, kind: "operational_cycle", actorId: o.actorId, scope: savedScope, frame, command, commandFingerprint });
  }
  private async operation<T>(run: (l: Lease) => Promise<T>): Promise<T> {
    if (this.controller || this.disposed) unknown();
    const controller = new AbortController(), l: Lease = { generation: ++this.generation, controller, deadline: performance.now() + (this.options.timeoutMs ?? 12000) };
    this.controller = controller; let reject!: (error: Error) => void;
    const interrupted = new Promise<never>((_, no) => { reject = no; }), abort = () => reject(Error("unknown_result"));
    controller.signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(() => controller.abort(), Math.max(0, l.deadline - performance.now()));
    try { return await Promise.race([Promise.resolve().then(() => { this.guard(l); return run(l); }), interrupted]); }
    catch {
      if (l.generation === this.generation && !this.disposed) {
        const concealed = hidden() || !this.currentAuth();
        this.publish({ phase: "blocked", pending: concealed ? null : this.state.pending, result: null,
          message: "原槽或结果尚未核实，内容保留；不覆盖、不重发，也不把查无回执当作失败。" });
      }
      return unknown();
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener("abort", abort);
      if (this.controller === controller) this.controller = null;
    }
  }
  load = () => this.operation(async l => {
    const { raw } = this.stored(l), pending = raw === null ? null : await this.decode(raw, l); this.stored(l, raw);
    this.publish({ phase: pending ? "unconfirmed" : "idle", pending, result: null,
      message: pending ? "发现周期首次送审原号；只能显式 GET 核验。" : "原槽为空；未联网、未提交。" }); this.guard(l); this.stored(l, raw); return pending;
  });
  private async transport(p: CycleSendPending, body: string | null, l: Lease, rawPending: string) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void reader?.cancel().catch(() => {}); }; l.controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      this.stored(l, rawPending);
      const query = { ...p.frame, mode: "recover" as const, operationId: p.command.operationId, commandFingerprint: p.commandFingerprint };
      const response = await this.options.apiFetch(CYCLE_SEND_API + (body === null ? "?" + cycleSendQueryString(query) : ""), {
        method: body === null ? "GET" : "POST", cache: "no-store", redirect: "error", signal: l.controller.signal,
        headers: body === null ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" }, ...(body === null ? {} : { body }) });
      try { this.stored(l, rawPending); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      if (response.status !== 200 || !response.ok || response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        void response.body?.cancel().catch(() => {}); unknown();
      }
      reader = response.body?.getReader(); if (!reader) unknown(); const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      try { while (true) { const part = await reader.read(); this.stored(l, rawPending); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > CYCLE_SEND_RESULT_LIMIT) unknown(); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
      this.stored(l, rawPending); const json = parseCycleSendResultJson(text);
      const responseValue = await parseCycleSendResponse(json, p.frame, p.actorId, p.command.operationId, p.commandFingerprint, body === null ? null : p.command);
      this.stored(l, rawPending); return { json, value: responseValue.data };
    } finally { l.controller.signal.removeEventListener("abort", cancel); }
  }
  submit = async (rawFrame: CycleSendFrame, rawCommand: CycleSendCommand) => {
    // Own the entire caller DTO before operation() schedules its first task.
    const frame = this.bound(rawFrame), pair = parseCycleSendBodyJson(JSON.stringify({ frame, command: parseCycleSendCommand(rawCommand, frame) }));
    return this.operation(async l => {
    this.stored(l, null);
    const commandFingerprint = await cycleSendCommandFingerprint(pair.frame, pair.command, this.options.actorId); this.stored(l, null);
    const p: CycleSendPending = freeze({ format: 3, kind: "operational_cycle", actorId: this.options.actorId,
      scope: this.options.access === "owner" ? null : this.options.delegateScope, frame: pair.frame, command: pair.command, commandFingerprint });
    const raw = JSON.stringify(p), body = JSON.stringify(pair); if (new TextEncoder().encode(raw).byteLength > CYCLE_SEND_RESULT_LIMIT || new TextEncoder().encode(body).byteLength > CYCLE_SEND_BODY_LIMIT) unknown();
    const { storage } = this.stored(l, null); storage.setItem(this.storageKey, raw); this.stored(l, raw);
    this.publish({ phase: "saving", pending: p, result: null, message: "原号已占用既有周期槽；只提交一次。" }); this.stored(l, raw);
    const { value } = await this.transport(p, body, l, raw); this.stored(l, raw);
    this.publish({ phase: "unconfirmed", pending: p, result: value, message: "已收到响应但仍保留原号；须显式 GET 核验后再读取当前周期。" }); this.stored(l, raw); return value;
    });
  };
  recover = () => this.operation(async l => {
    const { raw } = this.stored(l); if (raw === null) unknown(); const p = await this.decode(raw, l); this.stored(l, raw);
    this.publish({ phase: "recovering", pending: p, result: null, message: "只 GET 核验原范围、原操作和完整摘要；不会重发 POST。" }); this.stored(l, raw);
    const { json, value } = await this.transport(p, null, l, raw); this.stored(l, raw);
    if (value.receipt === null) unknown();
    const verified = await parseCycleSendResponse(json, p.frame, p.actorId, p.command.operationId, p.commandFingerprint, p.command); this.stored(l, raw);
    if (verified.data.receipt === null || verified.data.data.kind !== "linked" || verified.data.receipt.commandFingerprint !== p.commandFingerprint) unknown();
    const { storage } = this.stored(l, raw); storage.removeItem(this.storageKey); this.stored(l, null);
    this.publish({ phase: "idle", pending: null, result: verified.data, message: "原号 GET 回执已完整核验；请明确重新读取当前周期，回执不授予新操作权限。" }); this.guard(l); this.stored(l, null); return verified.data;
  });
}
