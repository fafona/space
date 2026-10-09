// One exact non-secret intent, durable before POST. An uncertain write is never
// resubmitted; only its authenticated, matching minimal receipt retires it.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { RETENTION_DISPOSAL_FIELDS } from "./merchantAttendanceRetentionDisposal";
import { DISPOSAL_EXECUTION_API, DISPOSAL_EXECUTION_ERRORS, DISPOSAL_EXECUTION_RESPONSE_LIMIT,
  parseDisposalExecutionQuery, parseDisposalExecutionBody, parseDisposalExecutionJson, parseDisposalExecutionResponse,
  disposalExecutionCommandFingerprint, disposalExecutionReceiptMatches, disposalExecutionQueryString,
  type DisposalExecutionQuery, type DisposalExecutionCommand, type DisposalExecutionResult } from "./merchantAttendanceRetentionDisposalExecution";

export type DisposalExecutionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DisposalExecutionPending = Readonly<{ protocol: "attendance-retention-disposal-pending-v1"; version: 1; actorId: string;
  query: DisposalExecutionQuery; command: DisposalExecutionCommand; commandFingerprint: string }>;
export type DisposalExecutionClientOptions = { siteId: string; authUserId: string; enabled: boolean; apiFetch: AttendanceApiFetch;
  storage: () => DisposalExecutionStorage; isCurrentAuth: () => boolean; timeoutMs?: number; randomId?: () => string };
export type DisposalExecutionClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  query: DisposalExecutionQuery | null; result: DisposalExecutionResult | null; pending: DisposalExecutionPending | null; message: string }>;
type Lease = { generation: number; controller: AbortController; deadline: number; timer: ReturnType<typeof setTimeout>; interrupted: Promise<never> };
class StorageFailure extends Error {}
const hidden = () => typeof document !== "undefined" && document.hidden;
export function disposalExecutionPendingKey(siteId: string, actorId: string): string {
  parseDisposalExecutionQuery({ siteId, mode: "recover", eventId: null, operationId: actorId });
  return `faolla:attendance:retention-disposal:v1:${siteId}:${actorId}`;
}
export async function parseDisposalExecutionPending(raw: string, expected: { siteId: string; authUserId: string }): Promise<DisposalExecutionPending> {
  disposalExecutionPendingKey(expected.siteId, expected.authUserId);
  const p = captureBrowserExact(parseDisposalExecutionJson(raw, "request"), ["protocol", "version", "actorId", "query", "command", "commandFingerprint"]);
  const { query, command } = parseDisposalExecutionBody({ query: p.query, command: p.command });
  if (p.protocol !== "attendance-retention-disposal-pending-v1" || p.version !== 1 || p.actorId !== expected.authUserId || query.siteId !== expected.siteId) throw new StorageFailure("pending_identity");
  const commandFingerprint = await disposalExecutionCommandFingerprint(query.siteId, expected.authUserId, command);
  if (p.commandFingerprint !== commandFingerprint) throw new StorageFailure("pending_hash");
  return freeze({ protocol: "attendance-retention-disposal-pending-v1", version: 1, actorId: expected.authUserId, query, command, commandFingerprint });
}
export class AttendanceRetentionDisposalExecutionClient {
  readonly storageKey: string;
  private readonly o: DisposalExecutionClientOptions;
  private state: DisposalExecutionClientState = freeze({ phase: "idle", query: null, result: null, pending: null, message: "仅本地合成资料；请明确读取单条处置预览。" });
  private pending: DisposalExecutionPending | null = null; private raw: string | null = null;
  private loaded = false; private disposed = false; private generation = 0; private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(options: DisposalExecutionClientOptions) {
    this.storageKey = disposalExecutionPendingKey(options.siteId, options.authUserId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function" || typeof options.isCurrentAuth !== "function"
      || options.randomId !== undefined && typeof options.randomId !== "function" || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("attendance_invalid_request");
    this.o = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(value: Partial<DisposalExecutionClientState>) { const next = this.state = freeze({ ...this.state, ...value, pending: this.pending });
    for (const listener of [...this.listeners]) { if (next !== this.state) break; try { listener(); } catch { /* Observers cannot authorize transport. */ } } }
  private current() { try { return !this.disposed && this.o.isCurrentAuth(); } catch { return false; } }
  pause = () => { const generation = ++this.generation, controller = this.controller; this.controller = null; controller?.abort();
    if (generation === this.generation) this.emit({ query: null, result: null, phase: this.pending ? "unconfirmed" : "idle", message: "资料已隐藏；原编号保留，不会重发处置。" }); };
  dispose = () => { this.pause(); this.disposed = true; this.listeners.clear(); };
  hasLeaveRisk = () => { if (!this.current() || this.controller || this.pending) return true;
    try { const s = this.o.storage(); if (!this.current()) return true; return s.getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(local = false): Lease | null {
    if (!this.current() || this.controller) return null; if (!local && hidden()) { this.pause(); return null; }
    const controller = new AbortController(), limit = this.o.timeoutMs ?? 12000;
    const interrupted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(Error("aborted_or_timeout")), { once: true })); void interrupted.catch(() => {});
    const l = { generation: ++this.generation, controller, deadline: performance.now() + limit, timer: setTimeout(() => controller.abort(), limit), interrupted }; this.controller = controller; return l;
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
    this.emit({ query: null, result: null, phase: this.pending ? "unconfirmed" : "blocked", message: error instanceof StorageFailure ? "原编号存储已变化或不可用；不会覆盖或删除，请核验原编号。"
      : this.pending ? "结果尚未核实；保留原编号，仅可明确读取最小回执。" : "无法核实当前处置条件，请重新明确读取。" });
  }
  initialize = async () => { const l = this.begin(true); if (!l) return;
    try { const { raw } = this.stored(l, true); if (this.pending && raw !== this.raw) throw new StorageFailure("pending_changed");
      const pending = raw === null ? null : await this.wait(l, parseDisposalExecutionPending(raw, this.o), true);
      if (this.stored(l, true).raw !== raw) throw new StorageFailure("pending_changed"); this.raw = raw; this.pending = pending; this.loaded = true;
      this.emit({ query: null, result: null, phase: pending ? "unconfirmed" : "idle", message: pending ? "发现待确认原编号；请明确读取原号回执。" : "请明确读取单条处置预览；批准不会自动执行。" });
    } catch (e) { this.loaded = false; this.fail(l, e, true); } finally { this.release(l); }
  };
  private async transport(l: Lease, query: DisposalExecutionQuery, command: DisposalExecutionCommand | null) {
    this.guard(l);
    const response = await this.wait(l, this.o.apiFetch(DISPOSAL_EXECUTION_API + (command ? "" : `?${disposalExecutionQueryString(query)}`), {
      method: command ? "POST" : "GET", signal: l.controller.signal, cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) }, ...(command ? { body: JSON.stringify({ query, command }) } : {}),
    }).then(r => { try { this.guard(l); } catch (e) { void r.body?.cancel().catch(() => {}); throw e; } return r; }));
    if (response.redirected || response.ok && response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    const reader = response.body?.getReader(); if (!reader) throw Error("missing_body");
    const cancel = () => { void reader.cancel().catch(() => {}); }; l.controller.signal.addEventListener("abort", cancel, { once: true });
    let text = "", bytes = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
    try { while (true) { const part = await this.wait(l, reader.read()); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > (response.status === 200 ? DISPOSAL_EXECUTION_RESPONSE_LIMIT : 4096)) throw Error("response_too_large"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    finally { cancel(); l.controller.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    const parsed = await this.wait(l, parseDisposalExecutionResponse(parseDisposalExecutionJson(text), query, this.o.authUserId, command));
    if (parsed.ok ? response.status !== 200 : DISPOSAL_EXECUTION_ERRORS[parsed.error.code] !== response.status) throw Error("status_mismatch");
    if (!parsed.ok) throw Error(parsed.error.code); return parsed.data;
  }
  private clear(l: Lease) { const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw new StorageFailure("pending_not_cleared"); this.raw = null; this.pending = null; }
  preview = async (eventId: string) => { const query = parseDisposalExecutionQuery({ siteId: this.o.siteId, mode: "preview", eventId, operationId: null });
    if (!this.loaded || this.pending) return; await this.get(query); };
  private async get(query: DisposalExecutionQuery) {
    const l = this.begin(); if (!l) return;
    try { this.verify(l); this.emit({ query: null, result: null, phase: "loading", message: "正在明确读取单条处置资料…" }); this.guard(l);
      const result = await this.transport(l, query, null); this.guard(l); this.verify(l);
      if (query.mode === "recover" && this.pending && result.data.kind === "receipt" && result.data.receipt) {
        if (!disposalExecutionReceiptMatches(result.data.receipt, this.o.siteId, this.o.authUserId, this.pending.command, this.pending.commandFingerprint)) throw Error("receipt_mismatch"); this.clear(l);
      }
      this.emit({ query, result, phase: this.pending ? "unconfirmed" : "ready", message: this.pending ? "查无回执不代表未写入；原编号继续保留。"
        : result.data.kind === "receipt" ? "原号回执已核实；下一操作请明确重新读取。" : "已读取；仅候选不等于已批准或已处置。" });
    } catch (e) { this.fail(l, e); } finally { this.release(l); }
  }
  recover = async () => { if (!this.loaded || !this.pending) return; await this.get({ siteId: this.o.siteId, mode: "recover", eventId: null, operationId: this.pending.command.operationId }); };
  submit = async (rawCommand: DisposalExecutionCommand) => {
    const q = this.state.query, d = this.state.result?.data;
    if (!this.loaded || !this.o.enabled || this.pending || this.state.phase !== "ready" || q?.mode !== "preview" || d?.kind !== "preview" || d.preview.candidateState !== "candidate") return;
    const { query, command } = parseDisposalExecutionBody({ query: q, command: rawCommand }), p = d.preview;
    if (command.action === "approve" && (command.previewAt !== p.asOf || command.expectedSourceFingerprint !== p.sourceFingerprint || command.expectedPolicyFingerprint !== p.policyFingerprint
      || command.expectedDependencyFingerprint !== p.dependencyFingerprint || command.expectedHoldFingerprint !== p.holdFingerprint || command.expectedPreviewFingerprint !== p.previewFingerprint)) return;
    const l = this.begin(); if (!l) return;
    try { this.verify(l); this.emit({ query: null, result: null, phase: "saving", message: "正在保存完整原意图；只提交一次…" }); this.guard(l);
      const commandFingerprint = await this.wait(l, disposalExecutionCommandFingerprint(query.siteId, this.o.authUserId, command));
      const pending: DisposalExecutionPending = freeze({ protocol: "attendance-retention-disposal-pending-v1", version: 1, actorId: this.o.authUserId, query, command, commandFingerprint });
      const raw = JSON.stringify(pending); parseDisposalExecutionJson(raw, "request"); const storage = this.verify(l); this.guard(l); storage.setItem(this.storageKey, raw); this.guard(l); this.raw = raw; this.pending = pending;
      if (this.stored(l).raw !== raw) throw new StorageFailure("pending_not_saved"); this.emit({ message: "原意图已保存；断开后只能明确核验原编号。" }); this.guard(l); this.verify(l);
      const saved = await this.transport(l, query, command); this.guard(l); this.verify(l);
      if (saved.data.kind !== "receipt" || !saved.data.receipt || !disposalExecutionReceiptMatches(saved.data.receipt, this.o.siteId, this.o.authUserId, command, commandFingerprint)) throw Error("receipt_mismatch");
      this.clear(l); this.emit({ query, result: saved, phase: "ready", message: command.action === "approve" ? "批准回执已核实；尚未执行，执行前请重新读取。" : "执行回执已核实；原始打卡和归档不变。" });
    } catch (e) { this.fail(l, e); } finally { this.release(l); }
  };
  approve = (reason: string) => { const d = this.state.result?.data; if (d?.kind !== "preview") return Promise.resolve(); const p = d.preview;
    return this.submit({ action: "approve", operationId: (this.o.randomId ?? (() => crypto.randomUUID()))(), eventId: p.eventId, fields: RETENTION_DISPOSAL_FIELDS,
      previewAt: p.asOf, expectedSourceFingerprint: p.sourceFingerprint, expectedPolicyFingerprint: p.policyFingerprint, expectedDependencyFingerprint: p.dependencyFingerprint,
      expectedHoldFingerprint: p.holdFingerprint, expectedPreviewFingerprint: p.previewFingerprint, reason }); };
  execute = (approvalOperationId: string) => { const d = this.state.result?.data; return d?.kind === "preview" ? this.submit({ action: "execute",
    operationId: (this.o.randomId ?? (() => crypto.randomUUID()))(), eventId: d.preview.eventId, approvalOperationId }) : Promise.resolve(); };
}
