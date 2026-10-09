import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { ScheduleSlot } from "./merchantAttendanceSchedule";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { SCHEDULE_DELEGATION_API, SCHEDULE_DELEGATION_BYTE_LIMIT, SCHEDULE_DELEGATION_ERRORS, parseScheduleDelegationJson,
  parseScheduleDelegationQuery, parseScheduleDelegationBody, parseScheduleDelegationResponse, scheduleDelegationQueryString,
  scheduleDelegationFingerprint, scheduleDelegationReceiptMatches, scheduleDelegationOperation,
  type ScheduleDelegationAccess, type ScheduleDelegationAction, type ScheduleDelegationCatalog, type ScheduleDelegationCatalogItem,
  type ScheduleDelegationQuery, type ScheduleDelegationCommand, type ScheduleDelegationResult } from "./merchantAttendanceScheduleDelegation";

export type ScheduleDelegationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ScheduleDelegationClientOptions = { siteId: string; access: ScheduleDelegationAccess; actorId: string; apiFetch: AttendanceApiFetch;
  storage: () => ScheduleDelegationStorage; enabled: boolean; randomId?: () => string; timeoutMs?: number; isCurrentAuth?: () => boolean;
  expectedAuthUserId?: string; recoveryOnly?: boolean };
export type ScheduleDelegationPending = { version: 1; anchorId: string; actorId: string; employeeId: string | null;
  query: ScheduleDelegationQuery; command: ScheduleDelegationCommand; commandFingerprint: string };
export type ScheduleDelegationChoices = { delegate: ScheduleDelegationCatalogItem | null; worker: ScheduleDelegationCatalogItem | null; location: ScheduleDelegationCatalogItem | null };
export type ScheduleDelegationClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  query: ScheduleDelegationQuery | null; result: ScheduleDelegationResult | null; pending: ScheduleDelegationPending | null; message: string; choices: ScheduleDelegationChoices }>;
type Lease = { epoch: number; controller: AbortController };
// Only a validated, exact HTTP POST rejection creates this private evidence.
// Generic errors, GET errors, 5xx and operation conflicts never discard intent.
const definitePostRejections = new Set(["attendance_schedule_delegation_changed", "attendance_schedule_delegation_disabled",
  "attendance_version_conflict", "attendance_version_exhausted", "attendance_schedule_overlap", "attendance_schedule_past",
  "attendance_schedule_not_active", "attendance_schedule_worker_invalid", "attendance_schedule_location_changed",
  "attendance_schedule_outside_employment", "attendance_schedule_range_limit", "attendance_account_suspended", "attendance_platform_paused"]);
class ConfirmedScheduleWriteRejection extends Error {}
const hidden = () => typeof document !== "undefined" && document.hidden;
const choices = (): ScheduleDelegationChoices => ({ delegate: null, worker: null, location: null });
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function identity(v: unknown): string { if (typeof v !== "string" || v.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)) throw Error("invalid_identity"); return v; }
function query(siteId: string, access: ScheduleDelegationAccess, patch: Partial<ScheduleDelegationQuery> = {}) {
  return parseScheduleDelegationQuery({ siteId, access, mode: access === "owner" ? "list" : "grants", catalog: null, grantId: null, afterId: null, fromDate: null, throughDate: null, operationId: null, ...patch });
}
export function scheduleDelegationPendingKey(siteId: string, access: ScheduleDelegationAccess, actorId: string) { query(siteId, access); return `faolla:attendance:schedule-delegation:v1:${siteId}:${access}:${identity(actorId)}`; }
async function transport(o: ScheduleDelegationClientOptions, q: ScheduleDelegationQuery, command: ScheduleDelegationCommand | null, signal: AbortSignal) {
  const controller = new AbortController(), ms = o.timeoutMs ?? 12000, deadline = performance.now() + ms;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (error: Error) => void;
  const stopped = new Promise<never>((_, r) => { reject = r; });
  const cancel = () => { controller.abort(); reject(Error("aborted_or_timeout")); void reader?.cancel().catch(() => {}); };
  const timer = setTimeout(cancel, ms); signal.addEventListener("abort", cancel, { once: true });
  const guard = () => { if (signal.aborted || controller.signal.aborted || performance.now() >= deadline || o.isCurrentAuth?.() === false) throw Error("stale_scope"); };
  const run = async () => {
    guard(); const response = await o.apiFetch(command ? SCHEDULE_DELEGATION_API : `${SCHEDULE_DELEGATION_API}?${scheduleDelegationQueryString(q)}`, {
      method: command ? "POST" : "GET", headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify({ query: q, command }) } : {}), signal: controller.signal, cache: "no-store", redirect: "error" });
    if (signal.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    guard(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response"); let text = "", bytes = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try { while (true) { const part = await reader.read(); guard(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > (response.status === 200 ? SCHEDULE_DELEGATION_BYTE_LIMIT : 4096)) throw Error("too_large"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    guard(); const raw = parseScheduleDelegationJson(text);
    if (response.status !== 200) { const e = captureBrowserExact(raw, ["ok", "error"]);
      if (e.ok !== false || typeof e.error !== "string" || !Object.hasOwn(SCHEDULE_DELEGATION_ERRORS, e.error) || SCHEDULE_DELEGATION_ERRORS[e.error] !== response.status) throw Error("invalid_error");
      if (command && definitePostRejections.has(e.error)) throw new ConfirmedScheduleWriteRejection(e.error); throw Error(e.error); }
    return raw;
  };
  try { return await Promise.race([run(), stopped]); } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}

/** One explicit write per durable intent. Recovery is exclusively an original-id GET. */
export class AttendanceScheduleDelegationClient {
  readonly storageKey: string; private readonly o: ScheduleDelegationClientOptions;
  private state: ScheduleDelegationClientState = freeze({ phase: "idle", query: null, result: null, pending: null, choices: choices(), message: "请明确读取主管排班授权；不会自动提交。" });
  private epoch = 0; private controller: AbortController | null = null; private loaded = false; private raw: string | null = null;
  private listeners = new Set<() => void>();
  constructor(options: ScheduleDelegationClientOptions) {
    this.storageKey = scheduleDelegationPendingKey(options.siteId, options.access, options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.randomId !== undefined && typeof options.randomId !== "function" || options.isCurrentAuth !== undefined && typeof options.isCurrentAuth !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)
      || options.recoveryOnly !== undefined && typeof options.recoveryOnly !== "boolean" || options.recoveryOnly && !options.expectedAuthUserId) throw Error("invalid_options");
    if (options.expectedAuthUserId !== undefined) identity(options.expectedAuthUserId); this.o = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publishState(patch: Partial<ScheduleDelegationClientState>) { const next = this.state = freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) { if (this.state !== next) break; try { listener(); } catch { /* Observers cannot authorize requests. */ } } }
  pause = () => { const epoch = ++this.epoch, previous = this.controller; this.controller = null; this.loaded = false; previous?.abort();
    if (epoch === this.epoch) this.publishState({ result: null, query: null, choices: choices(), phase: this.state.pending ? "unconfirmed" : "idle", message: "资料已清除，原编号保留；重新核验身份后只读恢复。" }); };
  invalidate = this.pause;
  hasLeaveRisk = () => { if (this.controller || this.state.pending) return true; try { return this.o.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(): Lease | null { if (hidden() || this.o.isCurrentAuth?.() === false) { this.pause(); return null; } if (this.controller) return null;
    const l = { epoch: ++this.epoch, controller: new AbortController() }; this.controller = l.controller; return l; }
  private guard(l: Lease) { if (l.epoch === this.epoch && (hidden() || this.o.isCurrentAuth?.() === false)) this.pause();
    if (l.epoch !== this.epoch || this.controller !== l.controller || l.controller.signal.aborted) throw Error("stale_scope"); }
  private release(l: Lease) { if (l.epoch === this.epoch && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease) { this.guard(l); const storage = this.o.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l); return { storage, raw }; }
  private verify(l: Lease) { const value = this.stored(l); if (value.raw !== this.raw) throw Error("pending_changed"); return value.storage; }
  private failed(l: Lease) { if (l.epoch !== this.epoch) return; if (hidden() || this.o.isCurrentAuth?.() === false) { this.pause(); return; }
    this.publishState({ result: null, query: null, choices: choices(), phase: this.state.pending ? "unconfirmed" : "blocked", message: this.state.pending
      ? "排班操作尚未核实；原编号保留，只读取原回执，不重新提交。查无回执不等于失败。" : "无法核验当前授权或本地待确认编号；资料已隐藏，请重新核验。" }); }
  private q = (patch: Partial<ScheduleDelegationQuery> = {}) => query(this.o.siteId, this.o.access, patch);
  initialize = async () => {
    const l = this.begin(); if (!l) return; try { const { raw } = this.stored(l); if (this.state.pending && raw !== this.raw) throw Error("pending_changed");
      let pending: ScheduleDelegationPending | null = null;
      if (raw !== null) { const p = captureBrowserExact(parseScheduleDelegationJson(raw, "request"), ["version", "anchorId", "actorId", "employeeId", "query", "command", "commandFingerprint"]);
        const { query: q, command } = parseScheduleDelegationBody({ query: p.query, command: p.command }), actorId = identity(p.actorId), employeeId = p.employeeId === null ? null : identity(p.employeeId);
        if (p.version !== 1 || p.anchorId !== this.o.actorId || q.siteId !== this.o.siteId || q.access !== this.o.access || this.o.expectedAuthUserId !== undefined && actorId !== this.o.expectedAuthUserId
          || (q.access === "owner" ? employeeId !== null || actorId !== this.o.actorId : employeeId !== this.o.actorId)) throw Error("pending_identity");
        const commandFingerprint = await scheduleDelegationFingerprint(q, command); this.guard(l); if (p.commandFingerprint !== commandFingerprint) throw Error("pending_fingerprint");
        pending = { version: 1, anchorId: this.o.actorId, actorId, employeeId, query: q, command, commandFingerprint }; }
      if (this.stored(l).raw !== raw) throw Error("pending_changed"); this.raw = raw; this.loaded = true;
      this.publishState({ pending, result: null, query: null, choices: choices(), phase: pending ? "unconfirmed" : "idle", message: pending ? "发现原编号，请明确只读核对结果；不自动重发。" : "请明确读取当前授权范围。" });
    } catch { this.failed(l); } finally { this.release(l); }
  };
  private parse(raw: unknown, q: ScheduleDelegationQuery, command: ScheduleDelegationCommand | null) { return parseScheduleDelegationResponse(raw, q, {
    ...(this.o.access === "owner" ? { ownerId: this.o.actorId } : { employeeId: this.o.actorId }),
    ...(this.o.expectedAuthUserId ? { authUserId: this.o.expectedAuthUserId } : this.state.pending ? { authUserId: this.state.pending.actorId } : {}) }, command); }
  private clear(l: Lease) { const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw Error("pending_changed"); this.raw = null; this.publishState({ pending: null }); this.guard(l); }
  private settle(result: ScheduleDelegationResult, l: Lease) { const p = this.state.pending, r = result.receipt; if (!p || !r) return;
    if (r.actorId !== p.actorId || !scheduleDelegationReceiptMatches(r, p.query, p.command, p.commandFingerprint)) throw Error("receipt_mismatch"); this.clear(l); }
  private rejected(attempt: ScheduleDelegationPending | null, l: Lease) { this.guard(l); if (!attempt || this.state.pending !== attempt) throw Error("pending_changed"); this.clear(l);
    this.publishState({ result: null, query: null, choices: choices(), phase: "blocked", message: "服务端明确拒绝，本次没有写入；本次标记已解除。请重新读取依据后，以新编号明确操作。" }); }
  private get = async (q: ScheduleDelegationQuery, keepChoices = false) => {
    const l = this.begin(); if (!l) return; try {
      if (!this.loaded || q.mode !== "recover" && (this.state.pending || this.o.recoveryOnly || this.o.access === "delegate" && !this.o.enabled)) return; this.verify(l);
      this.publishState({ phase: "loading", query: null, result: null, ...(keepChoices ? {} : { choices: choices() }), message: "正在核验当前范围…" }); this.guard(l);
      const raw = await transport(this.o, q, null, l.controller.signal); this.guard(l); this.verify(l); const result = this.parse(raw, q, null); this.settle(result, l); this.guard(l);
      this.publishState({ result, query: q, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending ? "尚无匹配回执；编号保留，不能推断失败。"
        : result.receipt ? "已核实原操作最小回执；这不恢复当前排班权限。" : "已读取授权范围；新操作仍由服务器重新核验。排班不是实际出勤或工时。" });
    } catch { this.failed(l); } finally { this.release(l); }
  };
  load = async () => { await this.get(this.q()); };
  catalog = async (kind: ScheduleDelegationCatalog) => { if (this.o.access === "owner") await this.get(this.q({ mode: "catalog", catalog: kind }), true); };
  next = async () => { const q = this.state.query, r = this.state.result; if (q && r?.nextAfterId) await this.get(parseScheduleDelegationQuery({ ...q, afterId: r.nextAfterId }), q.mode === "catalog"); };
  private select(kind: ScheduleDelegationCatalog, key: keyof ScheduleDelegationChoices, value: ScheduleDelegationCatalogItem) {
    if (hidden() || this.o.isCurrentAuth?.() === false) { this.pause(); return; }
    if (this.controller || this.state.pending || this.state.phase !== "ready" || this.state.query?.access !== "owner" || this.state.query.catalog !== kind) return;
    const actual = this.state.result?.catalogItems.find(x => x.id === value.id && JSON.stringify(x) === JSON.stringify(value)); if (actual) this.publishState({ choices: { ...this.state.choices, [key]: actual } }); }
  selectDelegate = (v: ScheduleDelegationCatalogItem) => this.select("delegates", "delegate", v);
  selectWorker = (v: ScheduleDelegationCatalogItem) => this.select("workers", "worker", v);
  selectLocation = (v: ScheduleDelegationCatalogItem) => this.select("locations", "location", v);
  detailGrant = async (grantId: string) => { const r = this.state.result; if (this.o.access === "owner" && (r?.grants.some(g => g.grantId === grantId) || r?.receipt?.grantId === grantId || r?.detail?.grantId === grantId)) await this.get(this.q({ mode: "detail", grantId })); };
  schedule = async (grantId: string, fromDate: string, throughDate: string) => { const r = this.state.result; if (this.o.access === "delegate" && (r?.grants.some(g => g.grantId === grantId) || r?.schedule?.grant.grantId === grantId)) await this.get(this.q({ mode: "schedule", grantId, fromDate, throughDate })); };
  recover = async () => { const p = this.state.pending; if (p) await this.get(this.q({ mode: "recover", operationId: scheduleDelegationOperation(p.command) })); };
  private async write(q: ScheduleDelegationQuery, make: (operationId: string) => ScheduleDelegationCommand, safeRevoke = false) {
    const context = this.state.result; if (!this.loaded || this.o.recoveryOnly || this.state.pending || this.state.phase !== "ready" || !context || !safeRevoke && (!this.o.enabled || !context.canWrite)) return;
    const l = this.begin(); if (!l) return; let attempt: ScheduleDelegationPending | null = null;
    try { this.verify(l); const operationId = (this.o.randomId ?? (() => crypto.randomUUID()))(); this.guard(l);
      const { command } = parseScheduleDelegationBody({ query: q, command: make(operationId) });
      this.publishState({ phase: "saving", result: null, query: null, choices: choices(), message: "正在固定本次意图…" }); this.guard(l);
      const commandFingerprint = await scheduleDelegationFingerprint(q, command); this.guard(l);
      const pending: ScheduleDelegationPending = freeze({ version: 1, anchorId: this.o.actorId, actorId: context.actorId, employeeId: context.employeeId, query: q, command, commandFingerprint });
      const raw = JSON.stringify(pending); parseScheduleDelegationJson(raw, "request"); const storage = this.verify(l);
      // Do not announce an in-memory intent before its durable write. A storage
      // callback may pause this lease or throw after writing: in either case no
      // POST occurs and initialize can discover the exact saved bytes afresh.
      storage.setItem(this.storageKey, raw); this.guard(l);
      if (this.stored(l).raw !== raw) throw Error("pending_changed");
      attempt = pending; this.raw = raw; this.publishState({ pending }); this.guard(l); this.verify(l);
      this.publishState({ message: "原编号已保存，只提交这一次；未知结果仅只读恢复。" }); this.guard(l); this.verify(l);
      const response = await transport(this.o, q, command, l.controller.signal); this.guard(l); this.verify(l); const result = this.parse(response, q, command); this.settle(result, l); this.guard(l);
      this.publishState({ result, query: q, phase: "ready", message: "已核实本次操作回执；排班不等于实际出勤或核定工时。" });
    } catch (error) { if (error instanceof ConfirmedScheduleWriteRejection) { try { this.rejected(attempt, l); } catch { this.failed(l); } } else this.failed(l); }
    finally { this.release(l); }
  }
  grant = async (input: { actions: ScheduleDelegationAction[]; includeExistingFuture: boolean; validFrom: string; validUntil: string; reason: string }) => {
    const c = this.state.choices; if (this.o.access !== "owner" || !c.delegate || !c.worker || !c.location) return;
    await this.write(this.q(), operationId => ({ action: "grant", operationId, delegateEmployeeId: c.delegate!.employeeId!, delegateAuthUserId: c.delegate!.employeeAuthUserId!,
      workerId: c.worker!.id, employeeId: c.worker!.employeeId!, employeeAuthUserId: c.worker!.employeeAuthUserId!, locationId: c.location!.id, ...input, reason: input.reason.trim() })); };
  revoke = async (grantId: string, reason: string) => { const r = this.state.result;
    if (this.o.access !== "owner" || !(r?.detail?.grantId === grantId && r.detail.revision === 1 || r?.receipt?.action === "grant" && r.receipt.grantId === grantId)) return;
    await this.write(this.q({ mode: "detail", grantId }), operationId => ({ action: "revoke", operationId, grantId, expectedRevision: 1, reason: reason.trim() }), true); };
  publish = async (input: { slots: ScheduleSlot[]; reason: string }) => { const s = this.state.result?.schedule, q = this.state.query;
    if (this.o.access !== "delegate" || q?.mode !== "schedule" || !s || s.rangeLimited || !s.grant.usableActions.includes("publish")) return;
    await this.write(q, operationId => ({ expectedGrantRevision: 1, decision: { action: "publish", operationId, expectedRevision: s.revision, expectedSettingsVersion: s.settingsVersion,
      reason: input.reason.trim(), locationId: s.grant.location.id, timeZone: s.timeZone, slots: input.slots } })); };
  cancel = async (slotId: string, reason: string) => { const s = this.state.result?.schedule, q = this.state.query;
    if (this.o.access !== "delegate" || q?.mode !== "schedule" || !s || s.rangeLimited || !s.grant.usableActions.includes("cancel") || !s.entries.some(e => e.slotId === slotId && e.canCancel)) return;
    await this.write(q, operationId => ({ expectedGrantRevision: 1, decision: { action: "cancel", operationId, expectedRevision: s.revision, expectedSettingsVersion: s.settingsVersion, reason: reason.trim(), slotId } })); };
}
