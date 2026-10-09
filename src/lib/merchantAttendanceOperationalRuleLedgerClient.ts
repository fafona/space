// 240: explicit reads, one durable POST, original-actor receipt-only recovery.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { OPERATIONAL_RULE_LEDGER_API, OPERATIONAL_RULE_LEDGER_ERRORS, OPERATIONAL_RULE_LEDGER_RESPONSE_LIMIT, parseOperationalRuleLedgerJson,
  parseOperationalRuleLedgerBody, parseOperationalRuleLedgerQuery, parseOperationalRuleLedgerScope, parseOperationalRuleLedgerResponse,
  operationalRuleLedgerCommandFingerprint, operationalRuleLedgerReceiptMatches, operationalRuleLedgerQueryString, operationalRuleLedgerEqual,
  operationalRuleLedgerFreeze as freeze, type OperationalRules, type OperationalRuleLedgerScope, type OperationalRuleLedgerPersonalScope,
  type OperationalRuleLedgerQuery, type OperationalRuleLedgerCommand, type OperationalRuleLedgerResult, type OperationalRuleLedgerSaveDraftItem } from "./merchantAttendanceOperationalRuleLedger";
export type OperationalRuleLedgerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type OperationalRuleLedgerClientOptions = { siteId: string; actorId: string; scope: OperationalRuleLedgerScope; enabled: boolean; apiFetch: AttendanceApiFetch;
  storage: () => OperationalRuleLedgerStorage; isCurrentAuth?: () => boolean; randomId?: () => string; timeoutMs?: number };
export type OperationalRuleLedgerPending = Readonly<{ version: 1; actorId: string; query: Extract<OperationalRuleLedgerQuery, { mode: "detail" }>;
  command: OperationalRuleLedgerCommand; commandFingerprint: string }>;
export type OperationalRuleLedgerClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  query: OperationalRuleLedgerQuery | null; result: OperationalRuleLedgerResult | null; pending: OperationalRuleLedgerPending | null; canEndRejectedAttempt: boolean; message: string }>;
type Lease = { generation: number; controller: AbortController; deadline: number; timer: ReturnType<typeof setTimeout>; interrupted: Promise<never> };
class StorageFailure extends Error {}
// Only transport creates this, after exact JSON, safe message and HTTP status
// verification for this single POST. Error text thrown by apiFetch is not proof.
class RejectedPost extends Error {}
const definiteRejections = new Set(["attendance_operational_rule_changed", "attendance_operational_rule_disabled", "attendance_operational_rule_not_found",
  "attendance_operational_rule_future_required", "attendance_operational_rule_overlap"]);
type RejectedAttempt = Readonly<{ siteId: string; actorId: string; generation: number; pending: OperationalRuleLedgerPending; raw: string }>;
const hidden = () => typeof document !== "undefined" && document.hidden;
function identity(siteId: string, actorId: string) { parseOperationalRuleLedgerQuery({ siteId, mode: "recover", operationId: actorId }); }
export function operationalRuleLedgerPendingKey(siteId: string, actorId: string) { identity(siteId, actorId); return `faolla:attendance:operational-rule-ledger:v1:${siteId}:${actorId}`; }
export async function parseOperationalRuleLedgerPending(raw: string, expected: { siteId: string; actorId: string }): Promise<OperationalRuleLedgerPending> {
  identity(expected.siteId, expected.actorId); const p = captureBrowserExact(parseOperationalRuleLedgerJson(raw, "request"), ["version", "actorId", "query", "command", "commandFingerprint"]);
  const { query, command } = parseOperationalRuleLedgerBody({ query: p.query, command: p.command });
  if (p.version !== 1 || p.actorId !== expected.actorId || query.siteId !== expected.siteId) throw new StorageFailure("pending_identity");
  const commandFingerprint = await operationalRuleLedgerCommandFingerprint(command, expected.actorId); if (p.commandFingerprint !== commandFingerprint) throw new StorageFailure("pending_hash");
  return freeze({ version: 1, actorId: expected.actorId, query, command, commandFingerprint });
}
export class AttendanceOperationalRuleLedgerClient {
  readonly storageKey: string; private readonly o: OperationalRuleLedgerClientOptions;
  private state: OperationalRuleLedgerClientState = freeze({ phase: "idle", query: null, result: null, pending: null, canEndRejectedAttempt: false, message: "请明确读取配置台账；不会自动请求或发布。" });
  private pending: OperationalRuleLedgerPending | null = null; private raw: string | null = null; private loaded = false; private disposed = false;
  private generation = 0; private controller: AbortController | null = null; private listeners = new Set<() => void>(); private previewDraft: OperationalRuleLedgerSaveDraftItem | null = null;
  private rejectedAttempt: RejectedAttempt | null = null;
  constructor(options: OperationalRuleLedgerClientOptions) { this.storageKey = operationalRuleLedgerPendingKey(options.siteId, options.actorId); const scope = parseOperationalRuleLedgerScope(options.scope);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function" || options.isCurrentAuth !== undefined && typeof options.isCurrentAuth !== "function"
      || options.randomId !== undefined && typeof options.randomId !== "function" || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("attendance_invalid_request");
    this.o = Object.freeze({ ...options, scope }); }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(p: Partial<OperationalRuleLedgerClientState>) { const next = this.state = freeze({ ...this.state, ...p, pending: this.pending,
    canEndRejectedAttempt: !!this.rejectedAttempt && this.rejectedAttempt.generation === this.generation && this.rejectedAttempt.pending === this.pending && !this.controller && this.current() && !hidden() });
    for (const f of [...this.listeners]) { if (this.state !== next) break; try { f(); } catch { /* Observers are not authority. */ } } }
  private current() { try { return !this.disposed && (this.o.isCurrentAuth?.() ?? true); } catch { return false; } }
  pause = () => { const g = ++this.generation, c = this.controller; this.controller = null; this.previewDraft = null; this.rejectedAttempt = null; c?.abort(); if (g === this.generation) this.emit({ result: null, query: null, phase: this.pending ? "unconfirmed" : "idle", message: "资料已隐藏；未确认原编号保留，不会重发。" }); };
  invalidate = this.pause;
  dispose = () => { this.pause(); this.disposed = true; this.listeners.clear(); };
  hasLeaveRisk = () => { if (!this.current() || this.controller || this.pending) return true; try { return this.o.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(local = false): Lease | null { if (!this.current() || this.controller) return null; if (!local && hidden()) { this.pause(); return null; }
    const controller = new AbortController(), limit = this.o.timeoutMs ?? 12000;
    const interrupted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(Error("aborted_or_timeout")), { once: true })); void interrupted.catch(() => {});
    const lease = { generation: ++this.generation, controller, deadline: performance.now() + limit, timer: setTimeout(() => controller.abort(), limit), interrupted }; this.controller = controller; return lease; }
  private guard(l: Lease, local = false) { if (l.generation === this.generation && (!this.current() || !local && hidden())) this.pause();
    if (!this.current() || l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted || performance.now() >= l.deadline) throw Error("stale_scope"); }
  private async wait<T>(l: Lease, promise: Promise<T>, local = false) { const value = await Promise.race([promise, l.interrupted]); this.guard(l, local); return value; }
  private release(l: Lease) { clearTimeout(l.timer); if (this.controller === l.controller && this.generation === l.generation) { this.controller = null;
    if (this.rejectedAttempt) this.emit({ message: "本次提交已明确拒绝且未写入；可明确结束此尝试，再手动重读。原编号尚未清除。" }); } }
  private stored(l: Lease, local = false) { this.guard(l, local); const storage = this.o.storage(); this.guard(l, local); const raw = storage.getItem(this.storageKey); this.guard(l, local); return { storage, raw }; }
  private verify(l: Lease, local = false) { const x = this.stored(l, local); if (x.raw !== this.raw) throw new StorageFailure("pending_changed"); return x.storage; }
  private fail(e: unknown, l: Lease, local = false, preserveRejection = false) { if (l.generation !== this.generation) return; if (!preserveRejection) this.rejectedAttempt = null; if (!this.current() || !local && hidden()) { this.pause(); return; } this.previewDraft = null;
    this.emit({ result: null, query: null, phase: this.pending ? "unconfirmed" : "blocked", message: e instanceof StorageFailure ? "原编号存储不可用或已变化；不会覆盖、删除或继续新写。" : this.pending ? "结果未确认；请显式读取原号最小回执，不会自动重发。" : "无法核实当前台账，请重新读取并核对范围。" }); }
  initialize = async () => { this.rejectedAttempt = null; this.emit({}); const l = this.begin(true); if (!l) return; try { const { raw } = this.stored(l, true); if (this.pending && this.raw !== raw) throw new StorageFailure("pending_changed");
      const pending = raw === null ? null : await this.wait(l, parseOperationalRuleLedgerPending(raw, this.o), true); if (this.stored(l, true).raw !== raw) throw new StorageFailure("pending_changed");
      this.raw = raw; this.pending = pending; this.loaded = true; this.previewDraft = null; this.emit({ result: null, query: null, phase: pending ? "unconfirmed" : "idle", message: pending ? "发现待确认原编号；只能显式读取最小回执。" : "请明确读取当前台账。" });
    } catch (e) { this.fail(e, l, true); } finally { this.release(l); } };
  private detailQuery(): Extract<OperationalRuleLedgerQuery, { mode: "detail" }> { return { siteId: this.o.siteId, mode: "detail", scope: this.o.scope }; }
  private async transport(l: Lease, q: OperationalRuleLedgerQuery, command: OperationalRuleLedgerCommand | null) {
    this.rejectedAttempt = null; this.guard(l); const r = await this.wait(l, this.o.apiFetch(OPERATIONAL_RULE_LEDGER_API + (command ? "" : `?${operationalRuleLedgerQueryString(q)}`), { method: command ? "POST" : "GET", signal: l.controller.signal,
      headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) }, ...(command ? { body: JSON.stringify({ query: q, command }) } : {}), cache: "no-store", redirect: "error" }).then(response => {
        try { this.guard(l); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; } return response; }));
    if (r.redirected || r.ok && r.status !== 200 || r.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void r.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    const reader = r.body?.getReader(); if (!reader) throw Error("empty_body"); const cancel = () => { void reader.cancel().catch(() => {}); }; l.controller.signal.addEventListener("abort", cancel, { once: true });
    let text = "", size = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
    try { while (true) { const c = await this.wait(l, reader.read()); if (c.done) break; size += c.value.byteLength; if (size > (r.status === 200 ? OPERATIONAL_RULE_LEDGER_RESPONSE_LIMIT : 4096)) throw Error("too_large"); text += decoder.decode(c.value, { stream: true }); } text += decoder.decode(); }
    finally { cancel(); l.controller.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    this.guard(l); const raw = parseOperationalRuleLedgerJson(text); const response = await this.wait(l, parseOperationalRuleLedgerResponse(raw, q, this.o.actorId, command));
    if (response.ok ? r.status !== 200 : OPERATIONAL_RULE_LEDGER_ERRORS[response.error.code] !== r.status) throw Error("invalid_status");
    if (!response.ok) { this.guard(l); if (command && definiteRejections.has(response.error.code)) throw new RejectedPost(response.error.code); throw Error(response.error.code); } return response.data;
  }
  private clear(l: Lease) { const s = this.verify(l); this.guard(l); s.removeItem(this.storageKey); this.guard(l); if (this.stored(l).raw !== null) throw new StorageFailure("pending_not_cleared"); this.pending = null; this.raw = null; }
  private async get(q: OperationalRuleLedgerQuery, draft: OperationalRuleLedgerSaveDraftItem | null = null) { if (!this.loaded || q.mode !== "recover" && this.pending || q.mode === "preview" && !this.o.enabled) return; const l = this.begin(); if (!l) return;
    try { this.verify(l); this.previewDraft = null; this.emit({ result: null, query: null, phase: "loading", message: q.mode === "recover" ? "正在核对原号回执…" : "正在读取固定范围…" }); this.guard(l);
      const result = await this.transport(l, q, null); this.guard(l); this.verify(l);
      if (q.mode === "preview") { const p = result.data; if (!draft || p.kind !== "preview" || p.sourceDraftRevision !== draft.revision || p.rulesFingerprint !== draft.rulesFingerprint || p.referenceFingerprint !== draft.referenceFingerprint || !operationalRuleLedgerEqual(p.context, draft.context) || !operationalRuleLedgerEqual(p.references, draft.references)) throw Error("preview_changed"); this.previewDraft = draft; }
      if (q.mode === "recover" && this.pending && result.receipt) { if (!operationalRuleLedgerReceiptMatches(result.receipt, this.pending.command, this.o.actorId, this.pending.commandFingerprint)) throw Error("receipt_mismatch"); this.clear(l); }
      this.guard(l); this.emit({ result, query: q, phase: this.pending ? "unconfirmed" : "ready", message: this.pending ? "查无回执不等于失败；原编号继续保留。" : result.data.kind === "receipt" ? "原号已核实；最小回执不恢复写入上下文。" : "已读取；规则核准不代表运行时已采用或已授权。" });
    } catch (e) { this.fail(e, l); } finally { this.release(l); } }
  load = () => this.get(this.detailQuery());
  history = () => this.get({ ...this.detailQuery(), mode: "history", cursor: null });
  nextHistory = async () => { const d = this.state.result?.data; if (this.state.query?.mode === "history" && d?.kind === "history" && d.nextCursor) await this.get({ ...this.state.query, cursor: d.nextCursor }); };
  catalog = (catalog: "workers" | "routes" | "saved_personal", cursor: string | OperationalRuleLedgerPersonalScope | null = null) => this.get(parseOperationalRuleLedgerQuery(catalog === "saved_personal" ? { siteId: this.o.siteId, mode: "catalog", catalog, afterScope: cursor } : { siteId: this.o.siteId, mode: "catalog", catalog, afterId: cursor }));
  nextCatalog = async () => { const d = this.state.result?.data; if (d?.kind !== "catalog") return; if (d.catalog === "saved_personal") { if (d.nextScope) await this.catalog(d.catalog, d.nextScope); } else if (d.nextId) await this.catalog(d.catalog, d.nextId); };
  preview = async (dates: { effectiveOn: string; endsOn: string | null }) => { const d = this.freshDetail(); if (!this.o.enabled || !d?.draft || !this.state.result?.canWrite) return;
    await this.get(parseOperationalRuleLedgerQuery({ ...this.detailQuery(), mode: "preview", sourceDraftRevision: d.draft.revision, ...dates }), d.draft); };
  recover = async () => { if (this.pending) await this.get({ siteId: this.o.siteId, mode: "recover", operationId: this.pending.command.operationId }); };
  private freshDetail() { const d = this.state.result?.data; return this.state.phase === "ready" && this.state.query?.mode === "detail" && d?.kind === "detail" && operationalRuleLedgerEqual(d.scope, this.o.scope) ? d : null; }
  private async write(make: (operationId: string) => OperationalRuleLedgerCommand, safe = false) { if (!this.loaded || this.pending || this.state.phase !== "ready" || !safe && (!this.o.enabled || !this.state.result?.canWrite)) return; const l = this.begin(); if (!l) return;
    try { this.verify(l); const query = this.detailQuery(), { command } = parseOperationalRuleLedgerBody({ query, command: make((this.o.randomId ?? (() => crypto.randomUUID()))()) }); this.previewDraft = null;
      this.emit({ result: null, query: null, phase: "saving", message: "正在保存原意图，仅提交一次…" }); this.guard(l); const commandFingerprint = await this.wait(l, operationalRuleLedgerCommandFingerprint(command, this.o.actorId));
      const pending: OperationalRuleLedgerPending = freeze({ version: 1, actorId: this.o.actorId, query, command, commandFingerprint }), raw = JSON.stringify(pending); parseOperationalRuleLedgerJson(raw, "request");
      const storage = this.verify(l); this.guard(l); storage.setItem(this.storageKey, raw); this.guard(l); this.raw = raw; this.pending = pending; if (this.stored(l).raw !== raw) throw new StorageFailure("pending_not_saved");
      this.emit({ phase: "saving", message: "原意图已保存，正在唯一提交；断开后只读取原号。" }); this.guard(l); const result = await this.transport(l, query, command); this.guard(l); this.verify(l);
      if (!result.receipt || !operationalRuleLedgerReceiptMatches(result.receipt, command, this.o.actorId, commandFingerprint)) throw Error("receipt_mismatch"); this.clear(l); this.emit({ result, query, phase: "ready", message: "操作回执已核实；新操作必须重新读取当前台账。" });
    } catch (e) { let proven = false; if (e instanceof RejectedPost) { try { this.guard(l); this.verify(l); const pending = this.pending;
        if (!pending || this.raw === null || pending.actorId !== this.o.actorId || pending.query.siteId !== this.o.siteId || pending.command.siteId !== this.o.siteId) throw Error("rejection_scope");
        this.rejectedAttempt = freeze({ siteId: this.o.siteId, actorId: this.o.actorId, generation: l.generation, pending, raw: this.raw }); proven = true;
      } catch { this.rejectedAttempt = null; } }
      this.fail(e, l, false, proven); } finally { this.release(l); } }
  endRejectedAttempt = (): boolean => { const proof = this.rejectedAttempt;
    if (!proof || this.controller || !this.current() || hidden() || proof.generation !== this.generation || proof.siteId !== this.o.siteId || proof.actorId !== this.o.actorId
      || proof.pending !== this.pending || proof.raw !== this.raw) { if (proof && (!this.current() || hidden())) this.pause(); return false; }
    const l = this.begin(); if (!l) return false; this.rejectedAttempt = null;
    try { const saved = this.stored(l); if (saved.raw !== proof.raw || this.raw !== proof.raw || this.pending !== proof.pending) throw new StorageFailure("pending_changed");
      this.clear(l); this.previewDraft = null; this.emit({ phase: "idle", result: null, query: null, message: "已明确结束本次被拒绝的本地尝试；未产生新提交，请手动重读当前台账。" }); return true;
    } catch (e) { this.fail(e, l); return false; } finally { this.release(l); } };
  saveDraft = async (rules: OperationalRules, reason: string) => { const d = this.freshDetail(); if (!d?.context) return; await this.write(operationId => ({ siteId: this.o.siteId, scope: this.o.scope, action: "save_draft", operationId, expectedRevision: d.revision, expectedContext: d.context!, rules, reason })); };
  publishRules = async (reason: string) => { const d = this.state.result?.data, draft = this.previewDraft; if (this.state.query?.mode !== "preview" || d?.kind !== "preview" || !draft || draft.revision !== d.sourceDraftRevision || draft.rulesFingerprint !== d.rulesFingerprint) return;
    await this.write(operationId => ({ siteId: this.o.siteId, scope: this.o.scope, action: "publish", operationId, expectedRevision: d.revision, sourceDraftRevision: d.sourceDraftRevision, effectiveOn: d.effectiveOn, endsOn: d.endsOn, previewFingerprint: d.previewFingerprint, reason })); };
  withdraw = async (publishedRevision: number, reason: string) => { const d = this.freshDetail(); if (!d?.canWithdraw || !d.nextPublication || d.nextPublication.revision !== publishedRevision) return;
    await this.write(operationId => ({ siteId: this.o.siteId, scope: this.o.scope, action: "withdraw", operationId, expectedRevision: d.revision, publishedRevision, reason }), true); };
  publish = this.publishRules;
}
