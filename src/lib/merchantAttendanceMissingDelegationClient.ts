import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { MISSING_DELEGATION_API, MISSING_DELEGATION_BYTE_LIMIT, MISSING_DELEGATION_ERRORS, parseMissingDelegationJson,
  parseMissingDelegationQuery, parseMissingDelegationBody, parseMissingDelegationResponse, missingDelegationQueryString,
  missingDelegationCommandFingerprint, missingDelegationOperation, missingDelegationReceiptMatches,
  type MissingDelegationAccess, type MissingDelegationQuery, type MissingDelegationCommand, type MissingDelegationResponse,
  type MissingDelegationGrant, type MissingDelegationCatalog, type MissingDelegationCatalogItem } from "./merchantAttendanceMissingDelegation";
export type MissingDelegationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type MissingDelegationClientOptions = { siteId: string; access: MissingDelegationAccess; actorId: string; apiFetch: AttendanceApiFetch;
  enabled: boolean; storage: () => MissingDelegationStorage; randomId?: () => string; timeoutMs?: number };
export type MissingDelegationPending = { version: 1; anchorId: string; actorId: string; employeeId: string | null;
  query: MissingDelegationQuery; command: MissingDelegationCommand; commandFingerprint: string };
export type MissingDelegationChoices = { delegate: MissingDelegationCatalogItem | null; worker: MissingDelegationCatalogItem | null; location: MissingDelegationCatalogItem | null };
export type MissingDelegationClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  result: MissingDelegationResponse | null; query: MissingDelegationQuery | null; pending: MissingDelegationPending | null; choices: MissingDelegationChoices; message: string }>;
type Lease = { generation: number; controller: AbortController };
class StorageFailure extends Error {}
const hidden = () => typeof document !== "undefined" && document.hidden;
const emptyChoices = (): MissingDelegationChoices => ({ delegate: null, worker: null, location: null });
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function uuid(v: unknown): string { if (typeof v !== "string" || v.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) throw Error("invalid_identity"); return v; }
function base(siteId: string, access: MissingDelegationAccess): MissingDelegationQuery { return parseMissingDelegationQuery(access === "owner"
  ? { siteId, access, mode: "list", catalog: null, afterId: null, grantId: null, operationId: null }
  : { siteId, access, mode: "grants", grantId: null, requestId: null, operationId: null, beforeAt: null, beforeId: null, afterId: null }); }
export function missingDelegationPendingKey(siteId: string, access: MissingDelegationAccess, actorId: string) {
  base(siteId, access); uuid(actorId); return `faolla:attendance:missing-delegation:v1:${siteId}:${access}:${actorId}`;
}
async function transport(o: MissingDelegationClientOptions, q: MissingDelegationQuery, command: MissingDelegationCommand | null, signal: AbortSignal) {
  const controller = new AbortController(), limit = o.timeoutMs ?? 12000, until = performance.now() + limit;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectStop!: (e: Error) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectStop = reject; });
  const cancel = () => { controller.abort(); rejectStop(Error("aborted_or_timeout")); void reader?.cancel().catch(() => {}); };
  const timer = setTimeout(cancel, limit); signal.addEventListener("abort", cancel, { once: true });
  const guard = () => { if (signal.aborted || controller.signal.aborted || performance.now() >= until) throw Error("aborted_or_timeout"); };
  const run = async () => {
    guard(); const r = await o.apiFetch(MISSING_DELEGATION_API + (command ? "" : `?${missingDelegationQueryString(q)}`), { method: command ? "POST" : "GET",
      headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) }, ...(command ? { body: JSON.stringify({ query: q, command }) } : {}),
      signal: controller.signal, cache: "no-store", redirect: "error" });
    if (signal.aborted || controller.signal.aborted || r.redirected || r.ok && r.status !== 200 || r.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void r.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    guard(); reader = r.body?.getReader(); if (!reader) throw Error("empty_response"); const decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", size = 0;
    try { while (true) { const c = await reader.read(); guard(); if (c.done) break; size += c.value.byteLength;
      if (size > (r.status === 200 ? MISSING_DELEGATION_BYTE_LIMIT : 4096)) throw Error("too_large"); text += decoder.decode(c.value, { stream: true }); } text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    guard(); const raw = parseMissingDelegationJson(text); guard();
    if (r.status !== 200) { const error = captureBrowserExact(raw, ["ok", "error"]);
      if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(MISSING_DELEGATION_ERRORS, error.error) || MISSING_DELEGATION_ERRORS[error.error] !== r.status) throw Error("invalid_error");
      throw Error(error.error); } return raw;
  };
  try { return await Promise.race([run(), interrupted]); } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}
/** No automatic requests or POST retries; the durable intent is only settled
 * against an identity-bound, scalar-tuple-fingerprinted original receipt. */
export class AttendanceMissingDelegationClient {
  readonly storageKey: string; private readonly o: MissingDelegationClientOptions;
  private state: MissingDelegationClientState = freeze({ phase: "idle", result: null, query: null, pending: null, choices: emptyChoices(), message: "请明确读取漏卡审批委托；不会自动提交。" });
  private listeners = new Set<() => void>(); private generation = 0; private controller: AbortController | null = null; private loaded = false;
  private pending: MissingDelegationPending | null = null; private raw: string | null = null; private selectedGrant: MissingDelegationGrant | null = null;
  constructor(options: MissingDelegationClientOptions) { this.storageKey = missingDelegationPendingKey(options.siteId, options.access, options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.randomId !== undefined && typeof options.randomId !== "function" || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("attendance_invalid_request");
    this.o = Object.freeze({ ...options }); }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<MissingDelegationClientState>) { const next = this.state = freeze({ ...this.state, ...patch, pending: this.pending });
    for (const f of [...this.listeners]) { if (next !== this.state) break; try { f(); } catch { /* Observers confer no authority. */ } } }
  pause = () => { const generation = ++this.generation, c = this.controller; this.controller = null; this.selectedGrant = null; c?.abort();
    if (generation === this.generation) this.publish({ phase: this.pending ? "unconfirmed" : "idle", result: null, query: null, choices: emptyChoices(), message: "资料已隐藏，原编号保留；不会自动重发。" }); };
  invalidate = this.pause;
  hasLeaveRisk = () => { if (this.controller || this.pending) return true; try { return this.o.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(): Lease | null { if (hidden()) { this.pause(); return null; } if (this.controller) return null; const l = { generation: ++this.generation, controller: new AbortController() }; this.controller = l.controller; return l; }
  private guard(l: Lease) { if (l.generation === this.generation && hidden()) this.pause(); if (l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted) throw Error("stale_scope"); }
  private release(l: Lease) { if (l.generation === this.generation && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease) { this.guard(l); const storage = this.o.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l); return { storage, raw }; }
  private verify(l: Lease) { const v = this.stored(l); if (v.raw !== this.raw) throw new StorageFailure("pending_changed"); return v.storage; }
  private failed(e: unknown, l: Lease) { if (l.generation !== this.generation) return; if (hidden()) { this.pause(); return; } this.selectedGrant = null;
    this.publish({ result: null, query: null, choices: emptyChoices(), phase: this.pending ? "unconfirmed" : "blocked", message: e instanceof StorageFailure
      ? "待确认存储不可用或已改变；保留原编号，不覆盖或新发操作。" : this.pending ? "结果仍未确认；请只读取原编号，不会自动重发或恢复审批权限。" : "无法读取当前授权资料，旧内容已清除；请重新核对权限和范围。" }); }
  private async decode(raw: string): Promise<MissingDelegationPending> { const p = captureBrowserExact(parseMissingDelegationJson(raw, "request"), ["version", "anchorId", "actorId", "employeeId", "query", "command", "commandFingerprint"]);
    const { query, command } = parseMissingDelegationBody({ query: p.query, command: p.command }), actorId = uuid(p.actorId), employeeId = p.employeeId === null ? null : uuid(p.employeeId);
    if (p.version !== 1 || p.anchorId !== this.o.actorId || query.siteId !== this.o.siteId || query.access !== this.o.access
      || (query.access === "owner" ? employeeId !== null || actorId !== this.o.actorId : employeeId !== this.o.actorId)) throw new StorageFailure("pending_identity");
    const commandFingerprint = await missingDelegationCommandFingerprint(query.siteId, query.access, command);
    if (p.commandFingerprint !== commandFingerprint) throw new StorageFailure("pending_hash"); return freeze({ version: 1, anchorId: this.o.actorId, actorId, employeeId, query, command, commandFingerprint }); }
  initialize = async () => { const l = this.begin(); if (!l) return;
    try { const { raw } = this.stored(l); if (this.pending && raw !== this.raw) throw new StorageFailure("pending_changed"); const pending = raw === null ? null : await this.decode(raw); this.guard(l);
      if (this.stored(l).raw !== raw) throw new StorageFailure("pending_changed"); this.raw = raw; this.pending = pending; this.loaded = true; this.selectedGrant = null;
      this.publish({ phase: pending ? "unconfirmed" : "idle", result: null, query: null, choices: emptyChoices(), message: pending ? "发现原操作待确认，请读取最小回执；不会重发。" : "请明确读取当前授权范围。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); } };
  private query(patch: Record<string, unknown> = {}) { return parseMissingDelegationQuery({ ...base(this.o.siteId, this.o.access), ...patch }); }
  private parse(raw: unknown, q: MissingDelegationQuery, command: MissingDelegationCommand | null) {
    return parseMissingDelegationResponse(raw, q, { ...(this.o.access === "owner" ? { ownerId: this.o.actorId } : { employeeId: this.o.actorId }),
      ...(this.pending ? { authUserId: this.pending.actorId } : {}) }, command); }
  private clear(l: Lease) { const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw new StorageFailure("pending_not_cleared"); this.pending = null; this.raw = null; }
  private async get(q: MissingDelegationQuery, preserveChoices = false) { const l = this.begin(); if (!l) return;
    try { if (!this.loaded || q.mode !== "recover" && (!this.o.enabled || this.pending)) return; this.verify(l);
      this.publish({ phase: "loading", result: null, query: null, ...(preserveChoices ? {} : { choices: emptyChoices() }), message: q.mode === "recover" ? "正在读取原编号最小回执…" : "正在核验当前授权范围…" }); this.guard(l);
      const raw = await transport(this.o, q, null, l.controller.signal); this.guard(l); this.verify(l); const result = this.parse(raw, q, null); this.guard(l);
      if (q.access === "delegate" && ["list", "detail"].includes(q.mode)) { const g = this.selectedGrant;
        if (!g || g.grantId !== q.grantId || result.protocol !== "delegated-missing-v1") throw Error("grant_changed");
        for (const item of [...result.items, ...(result.detail ? [result.detail] : [])]) if (item.workerId !== g.worker.workerId || item.employeeId !== g.worker.employeeId
          || item.employeeAuthUserId !== g.worker.authUserId || item.locationId !== g.location.locationId) throw Error("scope_mismatch"); }
      if (q.mode === "recover" && this.pending && result.receipt) { if (!missingDelegationReceiptMatches(result.receipt, this.pending.command, this.pending.commandFingerprint)) throw Error("receipt_mismatch"); this.clear(l); }
      this.guard(l); this.publish({ result, query: q, phase: this.pending ? "unconfirmed" : "ready", message: this.pending ? "暂未核实原结果，编号保留；查无回执不等于失败。"
        : result.receipt ? "原操作结果已核实；此最小回执不恢复审批权限，也不重新显示申请正文。" : "已读取当前授权资料；预览不能代替提交时的授权和来源核验。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); } }
  load = async () => { this.selectedGrant = null; await this.get(this.query()); };
  catalog = async (kind: MissingDelegationCatalog) => { if (this.o.access === "owner") await this.get(this.query({ mode: "catalog", catalog: kind }), true); };
  next = async () => { const q = this.state.query, r = this.state.result; if (!q || !r) return;
    if (r.nextId) await this.get(parseMissingDelegationQuery({ ...q, afterId: r.nextId }), q.mode === "catalog");
    else if (q.access === "delegate" && r.protocol === "delegated-missing-v1" && r.nextCursor) await this.get(parseMissingDelegationQuery({ ...q, beforeAt: r.nextCursor.at, beforeId: r.nextCursor.id })); };
  private select(kind: MissingDelegationCatalog, key: keyof MissingDelegationChoices, value: MissingDelegationCatalogItem) {
    if (hidden() || this.controller || this.pending || this.state.phase !== "ready" || this.state.query?.access !== "owner" || this.state.query.catalog !== kind || this.state.result?.protocol !== "missing-delegations-v1") return;
    const actual = this.state.result.catalogItems.find(x => x.id === value.id && JSON.stringify(x) === JSON.stringify(value)); if (!actual) return;
    this.publish({ choices: { ...this.state.choices, [key]: actual } }); }
  selectDelegate = (v: MissingDelegationCatalogItem) => this.select("delegates", "delegate", v);
  selectWorker = (v: MissingDelegationCatalogItem) => this.select("workers", "worker", v);
  selectLocation = (v: MissingDelegationCatalogItem) => this.select("locations", "location", v);
  detailGrant = async (grantId: string) => { const r = this.state.result; if (this.o.access !== "owner" || r?.protocol !== "missing-delegations-v1" || !r.items.some(g => g.grantId === grantId)) return; await this.get(this.query({ mode: "detail", grantId })); };
  requests = async (grantId: string) => { const r = this.state.result; if (r?.protocol !== "delegated-missing-v1" || this.pending || this.controller) return;
    const selected = r.grants.find(g => g.grantId === grantId && g.usable); if (!selected) return; this.selectedGrant = selected; await this.get(this.query({ mode: "list", grantId })); };
  detailRequest = async (grantId: string, requestId: string) => { const r = this.state.result; if (r?.protocol !== "delegated-missing-v1" || this.state.query?.grantId !== grantId
    || this.selectedGrant?.grantId !== grantId || !r.items.some(x => x.requestId === requestId)) return; await this.get(this.query({ mode: "detail", grantId, requestId })); };
  recover = async () => { if (this.pending) await this.get(this.query({ mode: "recover", operationId: missingDelegationOperation(this.pending.command) })); };
  private async write(q: MissingDelegationQuery, make: (operationId: string) => MissingDelegationCommand, safeRevoke = false) {
    const context = this.state.result; if (!this.loaded || this.pending || this.state.phase !== "ready" || !context || !safeRevoke && (!this.o.enabled || !context.canWrite)) return;
    const l = this.begin(); if (!l) return;
    try { this.verify(l); const operationId = (this.o.randomId ?? (() => crypto.randomUUID()))(); this.guard(l);
      const { command } = parseMissingDelegationBody({ query: q, command: make(operationId) });
      this.publish({ result: null, query: null, choices: emptyChoices(), phase: "saving", message: "正在固定原命令指纹，仅提交一次…" }); this.guard(l);
      const commandFingerprint = await missingDelegationCommandFingerprint(q.siteId, q.access, command); this.guard(l);
      const storage = this.verify(l); this.pending = freeze({ version: 1, anchorId: this.o.actorId, actorId: context.actorId,
        employeeId: context.protocol === "delegated-missing-v1" ? context.employeeId : null, query: q, command, commandFingerprint }); this.raw = JSON.stringify(this.pending);
      parseMissingDelegationJson(this.raw, "request"); storage.setItem(this.storageKey, this.raw); this.guard(l); this.verify(l);
      this.publish({ phase: "saving", message: "原编号已保存，正在提交一次明确操作…" }); this.guard(l); this.verify(l);
      const raw = await transport(this.o, q, command, l.controller.signal); this.guard(l); this.verify(l); const result = this.parse(raw, q, command); this.guard(l);
      if (!result.receipt || !missingDelegationReceiptMatches(result.receipt, command, commandFingerprint)) throw Error("receipt_mismatch"); this.clear(l); this.guard(l); this.selectedGrant = null;
      this.publish({ result, query: q, phase: "ready", message: "原操作结果已核实；未恢复其他审批权限。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  }
  grant = async (input: { validFrom: string; validUntil: string; reason: string }) => { const c = this.state.choices;
    if (this.o.access !== "owner" || !c.delegate || !c.worker || !c.location) return;
    await this.write(this.query(), operationId => ({ action: "grant", operationId, delegateEmployeeId: c.delegate!.employeeId!, delegateAuthUserId: c.delegate!.employeeAuthUserId!,
      workerId: c.worker!.id, employeeId: c.worker!.employeeId!, employeeAuthUserId: c.worker!.employeeAuthUserId!, locationId: c.location!.id, ...input, reason: input.reason.trim() })); };
  revoke = async (grantId: string, reason: string) => { const r = this.state.result;
    if (this.o.access !== "owner" || r?.protocol !== "missing-delegations-v1" || !(r.detail?.grantId === grantId && r.detail.revision === 1
      || r.receipt?.action === "grant" && r.receipt.grantId === grantId && r.receipt.revision === 1)) return;
    await this.write(this.query({ mode: "detail", grantId }), operationId => ({ action: "revoke", operationId, grantId, expectedRevision: 1, reason: reason.trim() }), true); };
  decide = async (action: "approve" | "reject", reason: string) => { const r = this.state.result, q = this.state.query, g = this.selectedGrant;
    if (r?.protocol !== "delegated-missing-v1" || !r.detail || q?.access !== "delegate" || q.mode !== "detail" || !g || g.grantId !== q.grantId
      || !(action === "approve" ? r.detail.canApprove : r.detail.canReject)) return; const d = r.detail;
    await this.write(this.query({ mode: "decide", grantId: g.grantId, requestId: d.requestId }), operationId => ({ grantId: g.grantId, expectedGrantRevision: 1,
      decision: { action, operationId, requestId: d.requestId, expectedRevision: 1, evidenceToken: d.evidenceToken, reason: reason.trim() } })); };
}
