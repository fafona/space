// 195: one common site/actual-Auth slot. Neither close, hide nor a rejected POST
// retires an uncertain operation. Recovery is explicit GET, never another POST.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { ADMINISTRATIVE_CLOSURE_API, ADMINISTRATIVE_CLOSURE_ERRORS, ADMINISTRATIVE_CLOSURE_RESPONSE_LIMIT,
  parseAdministrativeClosureBody, parseAdministrativeClosureQuery, parseAdministrativeClosureJson, parseAdministrativeClosureResponse,
  administrativeClosureCommandFingerprint, administrativeClosureReceiptMatches, administrativeClosureQueryString,
  type AdministrativeClosureQuery, type AdministrativeClosureCommand, type AdministrativeClosureResult, type AdministrativeClosureAccess } from "./merchantAttendanceAdministrativeClosure";

export type AdministrativeClosureStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type AdministrativeClosurePending = Readonly<{ protocol: "attendance-administrative-closure-pending-v1"; version: 1; actorId: string;
  query: AdministrativeClosureQuery; command: AdministrativeClosureCommand; commandFingerprint: string }>;
export type AdministrativeClosureClientOptions = { siteId: string; access: AdministrativeClosureAccess; authUserId: string; enabled: boolean;
  apiFetch: AttendanceApiFetch; storage: () => AdministrativeClosureStorage; isCurrentAuth: () => boolean; timeoutMs?: number; randomId?: () => string };
export type AdministrativeClosureClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  query: AdministrativeClosureQuery | null; result: AdministrativeClosureResult | null; pending: AdministrativeClosurePending | null; message: string }>;
type Lease = { generation: number; controller: AbortController; deadline: number; timer: ReturnType<typeof setTimeout>; interrupted: Promise<never> };
class StorageFailure extends Error {}
const hidden = () => typeof document !== "undefined" && document.hidden;
export function administrativeClosurePendingKey(siteId: string, authUserId: string): string {
  parseAdministrativeClosureQuery({ siteId, access: "self", mode: "recover", operationId: authUserId });
  return `faolla:attendance:administrative-closure:v1:${siteId}:${authUserId}`;
}
export async function parseAdministrativeClosurePending(raw: string, expected: { siteId: string; authUserId: string }): Promise<AdministrativeClosurePending> {
  administrativeClosurePendingKey(expected.siteId, expected.authUserId);
  const p = captureBrowserExact(parseAdministrativeClosureJson(raw, true), ["protocol", "version", "actorId", "query", "command", "commandFingerprint"]);
  const { query, command } = parseAdministrativeClosureBody({ query: p.query, command: p.command });
  if (p.protocol !== "attendance-administrative-closure-pending-v1" || p.version !== 1 || p.actorId !== expected.authUserId || query.siteId !== expected.siteId) throw new StorageFailure("pending_identity");
  const commandFingerprint = await administrativeClosureCommandFingerprint(query.siteId, expected.authUserId, query.access, command);
  if (p.commandFingerprint !== commandFingerprint) throw new StorageFailure("pending_hash");
  return freeze({ protocol: "attendance-administrative-closure-pending-v1", version: 1, actorId: expected.authUserId, query, command, commandFingerprint });
}
export class AttendanceAdministrativeClosureClient {
  readonly storageKey: string;
  private readonly o: AdministrativeClosureClientOptions;
  private state: AdministrativeClosureClientState = freeze({ phase: "idle", query: null, result: null, pending: null, message: "请明确读取；不会自动请求或行政结案。" });
  private pending: AdministrativeClosurePending | null = null; private raw: string | null = null;
  private loaded = false; private disposed = false; private generation = 0; private controller: AbortController | null = null;
  private listeners = new Set<() => void>(); private disputes = new Map<string, string>();
  constructor(options: AdministrativeClosureClientOptions) {
    this.storageKey = administrativeClosurePendingKey(options.siteId, options.authUserId);
    parseAdministrativeClosureQuery({ siteId: options.siteId, access: options.access, mode: "list", afterId: null });
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function" || typeof options.isCurrentAuth !== "function"
      || options.randomId !== undefined && typeof options.randomId !== "function" || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("attendance_invalid_request");
    this.o = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(value: Partial<AdministrativeClosureClientState>) { const next = this.state = freeze({ ...this.state, ...value, pending: this.pending });
    for (const listener of [...this.listeners]) { if (next !== this.state) break; try { listener(); } catch { /* Observers cannot authorize transport. */ } } }
  private current() { try { return !this.disposed && this.o.isCurrentAuth(); } catch { return false; } }
  pause = () => { const generation = ++this.generation, controller = this.controller; this.controller = null; this.disputes.clear(); controller?.abort();
    if (generation === this.generation) this.emit({ query: null, result: null, phase: this.pending ? "unconfirmed" : "idle", message: "资料已隐藏；未确认原编号保留，不会重发。" }); };
  dispose = () => { this.pause(); this.disposed = true; this.listeners.clear(); };
  hasLeaveRisk = () => { if (!this.current() || this.controller || this.pending) return true; try { const storage = this.o.storage(); if (!this.current()) return true; return storage.getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(local = false): Lease | null {
    if (!this.current() || this.controller) return null; if (!local && hidden()) { this.pause(); return null; }
    const controller = new AbortController(), limit = this.o.timeoutMs ?? 12000;
    const interrupted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(Error("aborted_or_timeout")), { once: true })); void interrupted.catch(() => {});
    const lease = { generation: ++this.generation, controller, deadline: performance.now() + limit, timer: setTimeout(() => controller.abort(), limit), interrupted }; this.controller = controller; return lease;
  }
  private guard(l: Lease, local = false) {
    if (l.generation === this.generation && (!this.current() || !local && hidden())) this.pause();
    if (!this.current() || l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted || performance.now() >= l.deadline) throw Error("stale_scope");
  }
  private async wait<T>(l: Lease, promise: Promise<T>, local = false) { const value = await Promise.race([promise, l.interrupted]); this.guard(l, local); return value; }
  private release(l: Lease) { clearTimeout(l.timer); if (l.generation === this.generation && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease, local = false) { this.guard(l, local); const storage = this.o.storage(); this.guard(l, local); const raw = storage.getItem(this.storageKey); this.guard(l, local); return { storage, raw }; }
  private verify(l: Lease, local = false) { const saved = this.stored(l, local); if (saved.raw !== this.raw) throw new StorageFailure("pending_changed"); return saved.storage; }
  private fail(l: Lease, error: unknown, local = false) {
    if (l.generation !== this.generation) return; if (!this.current() || !local && hidden()) { this.pause(); return; }
    this.disputes.clear(); this.emit({ query: null, result: null, phase: this.pending ? "unconfirmed" : "blocked", message: error instanceof StorageFailure ? "原编号存储已变化或不可用；不会覆盖或删除，请核验原编号。"
      : this.pending ? "结果尚未核实；保留原编号，仅可明确读取最小回执。" : "无法核实当前资料，请重新明确读取。" });
  }
  initialize = async () => { const l = this.begin(true); if (!l) return;
    try { const { raw } = this.stored(l, true); if (this.pending && raw !== this.raw) throw new StorageFailure("pending_changed");
      const pending = raw === null ? null : await this.wait(l, parseAdministrativeClosurePending(raw, this.o), true);
      if (this.stored(l, true).raw !== raw) throw new StorageFailure("pending_changed");
      this.raw = raw; this.pending = pending; this.loaded = true; this.disputes.clear(); this.emit({ query: null, result: null, phase: pending ? "unconfirmed" : "idle", message: pending ? "发现待确认原编号；请明确读取原号回执。" : "请明确读取行政记录或当前候选资料。" });
    } catch (e) { this.loaded = false; this.fail(l, e, true); } finally { this.release(l); }
  };
  private async transport(l: Lease, query: AdministrativeClosureQuery, command: AdministrativeClosureCommand | null) {
    this.guard(l);
    const response = await this.wait(l, this.o.apiFetch(ADMINISTRATIVE_CLOSURE_API + (command ? "" : `?${administrativeClosureQueryString(query)}`), {
      method: command ? "POST" : "GET", signal: l.controller.signal, cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) }, ...(command ? { body: JSON.stringify({ query, command }) } : {}),
    }).then(r => { try { this.guard(l); } catch (e) { void r.body?.cancel().catch(() => {}); throw e; } return r; }));
    if (response.redirected || response.ok && response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    const reader = response.body?.getReader(); if (!reader) throw Error("missing_body");
    const cancel = () => { void reader.cancel().catch(() => {}); }; l.controller.signal.addEventListener("abort", cancel, { once: true });
    let text = "", bytes = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
    try { while (true) { const part = await this.wait(l, reader.read()); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > (response.status === 200 ? ADMINISTRATIVE_CLOSURE_RESPONSE_LIMIT : 4096)) throw Error("response_too_large"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    finally { cancel(); l.controller.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    const parsed = await this.wait(l, parseAdministrativeClosureResponse(parseAdministrativeClosureJson(text), query, this.o.authUserId, command));
    if (parsed.ok ? response.status !== 200 : ADMINISTRATIVE_CLOSURE_ERRORS[parsed.error.code] !== response.status) throw Error("status_mismatch");
    if (!parsed.ok) throw Error(parsed.error.code); return parsed.data;
  }
  private clear(l: Lease) { const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw new StorageFailure("pending_not_cleared"); this.raw = null; this.pending = null; }
  load = async (rawQuery: AdministrativeClosureQuery) => {
    const query = parseAdministrativeClosureQuery(rawQuery);
    if (!this.loaded || query.siteId !== this.o.siteId || query.access !== this.o.access || query.mode === "recover" || this.pending) return;
    await this.get(query);
  };
  private async get(query: AdministrativeClosureQuery) {
    const l = this.begin(); if (!l) return;
    try { this.verify(l); this.emit({ query: null, result: null, phase: "loading", message: "正在明确读取当前范围…" }); this.guard(l);
      const result = await this.transport(l, query, null); this.guard(l); this.verify(l);
      if (query.mode === "recover" && this.pending && result.data.kind === "receipt" && result.data.receipt) {
        if (!administrativeClosureReceiptMatches(result.data.receipt, this.pending.command, this.o.authUserId, this.pending.commandFingerprint)) throw Error("receipt_mismatch"); this.clear(l);
      }
      const d = result.data;
      if (d.kind === "detail" && d.detail.currentEntry?.action === "self_dispute") this.disputes.set(d.detail.currentEntry.operationId, d.detail.currentEntry.startEventId);
      if (d.kind === "history") for (const e of d.items) if (e.action === "self_dispute") this.disputes.set(e.operationId, e.startEventId);
      // Only the current bounded page is retained, never an unbounded cache.
      if (this.disputes.size > 25) { const last = [...this.disputes].slice(-25); this.disputes = new Map(last); }
      this.emit({ query, result, phase: this.pending ? "unconfirmed" : "ready", message: this.pending ? "查无回执不代表未写入；原编号继续保留。" : d.kind === "receipt" ? "原号回执已核实；不恢复写入上下文，请明确重读。" : "已读取；行政记录不改原始打卡，也不推算工资。" });
    } catch (e) { this.fail(l, e); } finally { this.release(l); }
  }
  workers = () => this.o.access === "owner" ? this.load({ siteId: this.o.siteId, access: "owner", mode: "workers", afterId: null }) : Promise.resolve();
  list = () => this.load({ siteId: this.o.siteId, access: this.o.access, mode: "list", afterId: null });
  candidate = (workerId: string) => this.o.access === "owner" ? this.load({ siteId: this.o.siteId, access: "owner", mode: "candidate", workerId }) : Promise.resolve();
  detail = (startEventId: string) => this.load({ siteId: this.o.siteId, access: this.o.access, mode: "detail", startEventId });
  history = (startEventId: string) => this.load({ siteId: this.o.siteId, access: this.o.access, mode: "history", startEventId, beforeRevision: null });
  nextPage = async () => { const q = this.state.query, d = this.state.result?.data;
    if (q?.mode === "history" && d?.kind === "history" && d.nextBeforeRevision !== null) await this.load({ ...q, beforeRevision: d.nextBeforeRevision });
    else if ((q?.mode === "workers" && d?.kind === "workers" || q?.mode === "list" && d?.kind === "list") && d.nextAfterId) await this.load({ ...q, afterId: d.nextAfterId });
  };
  recover = async () => { if (!this.loaded || !this.pending) return; await this.get({ siteId: this.o.siteId, access: this.pending.query.access, mode: "recover", operationId: this.pending.command.operationId }); };
  submit = async (rawCommand: AdministrativeClosureCommand) => {
    const q = this.state.query, result = this.state.result, d = result?.data;
    if (!this.loaded || this.pending || this.state.phase !== "ready" || !q || q.access !== this.o.access || !result || result.access !== this.o.access || d?.kind !== "candidate" && d?.kind !== "detail") return;
    const { query, command } = parseAdministrativeClosureBody({ query: q, command: rawCommand }), detail = d.detail;
    if (!detail.frame || !detail.context || command.startEventId !== detail.frame.startEventId || command.expectedRevision !== (detail.summary?.revision ?? 0)) return;
    if (command.action === "close" || command.action === "record_unknown") {
      if (!this.o.enabled || d.kind !== "candidate" || command.workerId !== detail.frame.workerId || command.expectedSourceFingerprint !== detail.context.sourceFingerprint
        || !(command.action === "close" ? detail.capabilities.canClose : detail.capabilities.canRecordUnknown)
        || command.action === "close" && (command.verifiedEndAt < detail.frame.tailOccurredAt || command.verifiedEndAt > result.readAt)) return;
    } else if (command.action === "self_dispute") {
      if (d.kind !== "detail" || !detail.capabilities.canDispute || detail.frame.employeeAuthUserId !== this.o.authUserId || command.expectedClosedOperationId !== (detail.summary?.closedOperationId ?? null)) return;
    } else if (d.kind !== "detail" || !detail.capabilities.canRespond || this.disputes.get(command.disputeOperationId) !== command.startEventId) return;
    const l = this.begin(); if (!l) return;
    try { this.verify(l); this.emit({ query: null, result: null, phase: "saving", message: "正在安全保存原意图；只提交一次…" }); this.guard(l);
      const commandFingerprint = await this.wait(l, administrativeClosureCommandFingerprint(query.siteId, this.o.authUserId, query.access, command));
      const pending: AdministrativeClosurePending = freeze({ protocol: "attendance-administrative-closure-pending-v1", version: 1, actorId: this.o.authUserId, query, command, commandFingerprint });
      const raw = JSON.stringify(pending); parseAdministrativeClosureJson(raw, true);
      const storage = this.verify(l); this.guard(l); storage.setItem(this.storageKey, raw); this.guard(l); this.raw = raw; this.pending = pending;
      if (this.stored(l).raw !== raw) throw new StorageFailure("pending_not_saved");
      this.emit({ message: "原意图已保存；断开后只能明确核验原编号。" }); this.guard(l); this.verify(l);
      const saved = await this.transport(l, query, command); this.guard(l); this.verify(l);
      if (saved.data.kind !== "receipt" || !saved.data.receipt || !administrativeClosureReceiptMatches(saved.data.receipt, command, this.o.authUserId, commandFingerprint)) throw Error("receipt_mismatch");
      this.clear(l); this.disputes.clear(); this.emit({ query, result: saved, phase: "ready", message: "最小回执已核实；下一操作前须明确重读。" });
    } catch (e) { this.fail(l, e); } finally { this.release(l); }
  };
  private nextId() { return (this.o.randomId ?? (() => crypto.randomUUID()))(); }
  recordUnknown = (reason: string) => this.closeOrUnknown(null, reason);
  close = (verifiedEndAt: string, reason: string) => this.closeOrUnknown(verifiedEndAt, reason);
  private closeOrUnknown(verifiedEndAt: string | null, reason: string) { const d = this.state.result?.data;
    if (d?.kind !== "candidate" || !d.detail.frame || !d.detail.context) return Promise.resolve();
    const base = { operationId: this.nextId(), startEventId: d.detail.frame.startEventId, expectedRevision: d.detail.summary?.revision ?? 0, reason, workerId: d.detail.frame.workerId, expectedSourceFingerprint: d.detail.context.sourceFingerprint };
    return this.submit(verifiedEndAt === null ? { ...base, action: "record_unknown", verifiedEndAt: null } : { ...base, action: "close", verifiedEndAt });
  }
  dispute = (reason: string) => { const d = this.state.result?.data;
    return d?.kind === "detail" && d.detail.summary ? this.submit({ operationId: this.nextId(), action: "self_dispute", startEventId: d.detail.summary.startEventId,
      expectedRevision: d.detail.summary.revision, expectedClosedOperationId: d.detail.summary.closedOperationId, reason }) : Promise.resolve(); };
  respond = (disputeOperationId: string, reason: string) => { const d = this.state.result?.data;
    return d?.kind === "detail" && d.detail.summary ? this.submit({ operationId: this.nextId(), action: "owner_respond", startEventId: d.detail.summary.startEventId,
      expectedRevision: d.detail.summary.revision, disputeOperationId, reason }) : Promise.resolve(); };
}
