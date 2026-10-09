import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { OPERATIONAL_CONSUMER_ACTIVATION_API, OPERATIONAL_CONSUMER_ACTIVATION_ERRORS, OPERATIONAL_CONSUMER_ACTIVATION_RESPONSE_LIMIT,
  parseOperationalConsumerActivationBody, parseOperationalConsumerActivationQuery, parseOperationalConsumerActivationJson, parseOperationalConsumerActivationResponse,
  operationalConsumerActivationCommandFingerprint, operationalConsumerActivationReceiptMatches, operationalConsumerActivationQueryString,
  type OperationalConsumer, type OperationalConsumerActivationQuery, type OperationalConsumerActivationCommand, type OperationalConsumerActivationResult } from "./merchantAttendanceOperationalConsumerActivation";
export type OperationalConsumerActivationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type OperationalConsumerActivationClientOptions = { siteId: string; consumer: OperationalConsumer; actorId: string; enabled: boolean; apiFetch: AttendanceApiFetch; storage: () => OperationalConsumerActivationStorage; isCurrentAuth?: () => boolean; randomId?: () => string; timeoutMs?: number };
export type OperationalConsumerActivationPending = Readonly<{ version: 1; actorId: string; query: Extract<OperationalConsumerActivationQuery, { mode: "current" }>; command: OperationalConsumerActivationCommand; commandFingerprint: string }>;
export type OperationalConsumerActivationClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; query: OperationalConsumerActivationQuery | null; result: OperationalConsumerActivationResult | null; pending: OperationalConsumerActivationPending | null; message: string }>;
type Lease = { generation: number; controller: AbortController; deadline: number; timer: ReturnType<typeof setTimeout>; interrupted: Promise<never> };
const hidden = () => typeof document !== "undefined" && document.hidden;
export function operationalConsumerActivationPendingKey(siteId: string, actorId: string, consumer: OperationalConsumer) { parseOperationalConsumerActivationQuery({ siteId, consumer, mode: "recover", operationId: actorId }); return `faolla:attendance:operational-consumer-activation:v1:${siteId}:${actorId}:${consumer}`; }
export async function parseOperationalConsumerActivationPending(raw: string, expected: { siteId: string; consumer: OperationalConsumer; actorId: string }): Promise<OperationalConsumerActivationPending> {
  const scope = Object.freeze({ siteId: expected.siteId, actorId: expected.actorId, consumer: expected.consumer });
  operationalConsumerActivationPendingKey(scope.siteId, scope.actorId, scope.consumer); const p = captureBrowserExact(parseOperationalConsumerActivationJson(raw, true), ["version", "actorId", "query", "command", "commandFingerprint"]);
  const { query, command } = parseOperationalConsumerActivationBody({ query: p.query, command: p.command }), savedFingerprint = p.commandFingerprint;
  if (p.version !== 1 || p.actorId !== scope.actorId || query.siteId !== scope.siteId || query.consumer !== scope.consumer) throw Error("pending_identity");
  const fingerprint = await operationalConsumerActivationCommandFingerprint(command, scope.actorId); if (savedFingerprint !== fingerprint) throw Error("pending_hash");
  return freeze({ version: 1, actorId: scope.actorId, query, command, commandFingerprint: fingerprint });
}
export class AttendanceOperationalConsumerActivationClient {
  readonly storageKey: string; private readonly o: OperationalConsumerActivationClientOptions;
  private state: OperationalConsumerActivationClientState = freeze({ phase: "idle", query: null, result: null, pending: null, message: "请明确读取启用状态；不会自动请求或启用。" });
  private pending: OperationalConsumerActivationPending | null = null; private raw: string | null = null; private loaded = false; private disposed = false;
  private generation = 0; private controller: AbortController | null = null; private listeners = new Set<() => void>();
  constructor(options: OperationalConsumerActivationClientOptions) {
    this.storageKey = operationalConsumerActivationPendingKey(options.siteId, options.actorId, options.consumer);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function" || options.isCurrentAuth !== undefined && typeof options.isCurrentAuth !== "function" || options.randomId !== undefined && typeof options.randomId !== "function" || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("attendance_invalid_request");
    this.o = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(p: Partial<OperationalConsumerActivationClientState>) { const next = this.state = freeze({ ...this.state, ...p, pending: this.pending }); for (const f of [...this.listeners]) { if (this.state !== next) break; try { f(); } catch { /* Observer is not authority. */ } } }
  private current() { try { return !this.disposed && (this.o.isCurrentAuth?.() ?? true); } catch { return false; } }
  pause = () => { const g = ++this.generation, c = this.controller; this.controller = null; c?.abort(); if (g === this.generation) this.emit({ query: null, result: null, phase: this.pending ? "unconfirmed" : "idle", message: "资料已隐藏，原编号保留；不会自动重发。" }); };
  dispose = () => { this.pause(); this.disposed = true; this.listeners.clear(); };
  hasLeaveRisk = () => { if (!this.current() || this.controller || this.pending) return true; try { return this.o.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(local = false): Lease | null { if (!this.current() || this.controller) return null; if (!local && hidden()) { this.pause(); return null; }
    const controller = new AbortController(), limit = this.o.timeoutMs ?? 12000, interrupted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(Error("aborted_or_timeout")), { once: true })); void interrupted.catch(() => {});
    const l = { generation: ++this.generation, controller, deadline: performance.now() + limit, timer: setTimeout(() => controller.abort(), limit), interrupted }; this.controller = controller; return l; }
  private guard(l: Lease, local = false) { if (l.generation === this.generation && (!this.current() || !local && hidden())) this.pause();
    if (!this.current() || l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted || performance.now() >= l.deadline) throw Error("stale_scope"); }
  private async wait<T>(l: Lease, promise: Promise<T>, local = false) { const value = await Promise.race([promise, l.interrupted]); this.guard(l, local); return value; }
  private release(l: Lease) { clearTimeout(l.timer); if (this.controller === l.controller && this.generation === l.generation) this.controller = null; }
  private stored(l: Lease, local = false) { this.guard(l, local); const storage = this.o.storage(); this.guard(l, local); const raw = storage.getItem(this.storageKey); this.guard(l, local); return { storage, raw }; }
  private verify(l: Lease, local = false) { const x = this.stored(l, local); if (x.raw !== this.raw) throw Error("pending_changed"); return x.storage; }
  private fail(l: Lease, local = false) { if (l.generation !== this.generation) return; if (!this.current() || !local && hidden()) { this.pause(); return; }
    this.emit({ query: null, result: null, phase: this.pending ? "unconfirmed" : "blocked", message: this.pending ? "结果未确认；原编号保留，请只读核对，不会自动重发。" : "无法核验当前身份、状态或存储；未继续提交。" }); }
  initialize = async () => { const l = this.begin(true); if (!l) return; try { const { raw } = this.stored(l, true); if (this.pending && this.raw !== raw) throw Error("pending_changed");
    const p = raw === null ? null : await this.wait(l, parseOperationalConsumerActivationPending(raw, this.o), true); if (this.stored(l, true).raw !== raw) throw Error("pending_changed");
    this.raw = raw; this.pending = p; this.loaded = true; this.emit({ query: null, result: null, phase: p ? "unconfirmed" : "idle", message: p ? "发现原编号，仅显式读取最小回执。" : "请明确读取当前启用状态。" });
  } catch { this.fail(l, true); } finally { this.release(l); } };
  private async transport(l: Lease, query: OperationalConsumerActivationQuery, command: OperationalConsumerActivationCommand | null) {
    this.guard(l); const response = await this.wait(l, this.o.apiFetch(OPERATIONAL_CONSUMER_ACTIVATION_API + (command ? "" : `?${operationalConsumerActivationQueryString(query)}`), { method: command ? "POST" : "GET", signal: l.controller.signal, cache: "no-store", redirect: "error", headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) }, ...(command ? { body: JSON.stringify({ query, command }) } : {}) }).then(r => { try { this.guard(l); } catch (e) { void r.body?.cancel().catch(() => {}); throw e; } return r; }));
    if (response.redirected || response.ok && response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    const reader = response.body?.getReader(); if (!reader) throw Error("empty_body"); const cancel = () => { void reader.cancel().catch(() => {}); }; l.controller.signal.addEventListener("abort", cancel, { once: true });
    let text = "", size = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
    try { while (true) { const c = await this.wait(l, reader.read()); if (c.done) break; size += c.value.byteLength; if (size > (response.status === 200 ? OPERATIONAL_CONSUMER_ACTIVATION_RESPONSE_LIMIT : 4096)) throw Error("too_large"); text += decoder.decode(c.value, { stream: true }); } text += decoder.decode(); }
    finally { cancel(); l.controller.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    const parsed = await this.wait(l, parseOperationalConsumerActivationResponse(parseOperationalConsumerActivationJson(text), query, this.o.actorId, command));
    if (parsed.ok ? response.status !== 200 : OPERATIONAL_CONSUMER_ACTIVATION_ERRORS[parsed.error.code] !== response.status) throw Error("invalid_status"); if (!parsed.ok) throw Error(parsed.error.code); return parsed.data;
  }
  private clear(l: Lease) { const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l); if (this.stored(l).raw !== null) throw Error("pending_not_cleared"); this.pending = null; this.raw = null; }
  private async read(query: OperationalConsumerActivationQuery) { if (!this.loaded || query.mode !== "recover" && this.pending) return; const l = this.begin(); if (!l) return;
    try { this.verify(l); this.emit({ query: null, result: null, phase: "loading", message: "正在只读核对…" }); this.guard(l); const result = await this.transport(l, query, null); this.verify(l);
      if (query.mode === "recover" && this.pending && result.receipt) { if (!operationalConsumerActivationReceiptMatches(result.receipt, this.pending.command, this.o.actorId, this.pending.commandFingerprint)) throw Error("receipt_mismatch"); this.clear(l); }
      this.guard(l); this.emit({ query, result, phase: this.pending ? "unconfirmed" : "ready", message: this.pending ? "查无回执不等于未提交；原编号继续保留。" : query.mode === "recover" ? "原号已核实；不恢复负责人资格或新写上下文。" : "当前状态已读取；请明确确认后操作。" });
    } catch { this.fail(l); } finally { this.release(l); } }
  load = () => this.read({ siteId: this.o.siteId, consumer: this.o.consumer, mode: "current" });
  recover = async () => { if (this.pending) await this.read({ siteId: this.o.siteId, consumer: this.o.consumer, mode: "recover", operationId: this.pending.command.operationId }); };
  submit = async (action: OperationalConsumerActivationCommand["action"], reason: string) => {
    const r = this.state.result; if (!this.loaded || this.pending || this.state.phase !== "ready" || this.state.query?.mode !== "current" || !r || r.receipt || (action === "activate" ? !this.o.enabled || !r.canActivate : !r.canDeactivate)) return;
    const l = this.begin(); if (!l) return;
    try { this.verify(l); const { query, command } = parseOperationalConsumerActivationBody({ query: { siteId: this.o.siteId, consumer: this.o.consumer, mode: "current" }, command: { siteId: this.o.siteId, consumer: this.o.consumer, operationId: (this.o.randomId ?? (() => crypto.randomUUID()))(), action, expectedRevision: r.current?.revision ?? 0, reason } });
      this.emit({ query: null, result: null, phase: "saving", message: "正在保存原意图，仅提交一次…" }); this.guard(l); const fingerprint = await this.wait(l, operationalConsumerActivationCommandFingerprint(command, this.o.actorId));
      const pending: OperationalConsumerActivationPending = freeze({ version: 1, actorId: this.o.actorId, query, command, commandFingerprint: fingerprint }), raw = JSON.stringify(pending); parseOperationalConsumerActivationJson(raw, true);
      const storage = this.verify(l); this.guard(l); storage.setItem(this.storageKey, raw); this.guard(l); this.pending = pending; this.raw = raw; if (this.stored(l).raw !== raw) throw Error("pending_not_saved"); this.emit({ phase: "saving", message: "原编号已保存，正在唯一提交…" }); this.guard(l);
      const result = await this.transport(l, query, command); this.verify(l); if (!result.receipt || !operationalConsumerActivationReceiptMatches(result.receipt, command, this.o.actorId, fingerprint)) throw Error("receipt_mismatch"); this.clear(l);
      this.emit({ query, result, phase: "ready", message: "启用账本回执已核实；下一操作须重新读取当前状态。" });
    } catch { this.fail(l); } finally { this.release(l); }
  };
}


