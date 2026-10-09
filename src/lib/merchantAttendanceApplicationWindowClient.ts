// 194: same legacy family slot, one durable new intent, explicit GET recovery.
// New and old slot formats never migrate or overwrite one another.
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze, operationalRuleLedgerEqual as equal } from "./merchantAttendanceOperationalRuleLedger";
import { correctionPendingKey, parseCorrectionPending } from "./merchantAttendanceCorrectionClient";
import { revisionCycleKey, parseRevisionCyclePending } from "./merchantAttendanceRevisionCycleClient";
import { correctionQueryString, parseCorrectionResult, type CorrectionProposal } from "./merchantAttendanceCorrection";
import { attendanceRevisionQueryString } from "./merchantAttendanceRevision";
import { parseRevisionCycleResponse } from "./merchantAttendanceRevisionCycleResponse";
import { parseMissingBody, parseMissingResult, missingQueryString } from "./merchantAttendanceMissing";
import { APPLICATION_WINDOW_RESPONSE_LIMIT, parseApplicationWindowQuery, parseApplicationWindowCommand, parseApplicationWindowBody, parseApplicationWindowJson,
  applicationWindowQueryString, applicationWindowCommandFingerprint, parseApplicationWindowResponse, applicationWindowErrors,
  type ApplicationWindowQuery, type ApplicationWindowCommand, type ApplicationWindowResult, type ApplicationWindowFamily } from "./merchantAttendanceApplicationWindow";
export type ApplicationWindowPrepareQuery = Extract<ApplicationWindowQuery, { mode: "prepare" }>;
export type ApplicationWindowPending = Readonly<{ protocol: "attendance-application-window-pending-v1"; version: 1; actorId: string; employeeId: string;
  query: ApplicationWindowPrepareQuery; command: ApplicationWindowCommand; commandFingerprint: string }>;
export type ApplicationWindowClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  query: ApplicationWindowQuery | null; result: ApplicationWindowResult | null; pending: Readonly<{ kind: "window" | "legacy"; operationId: string }> | null;
  canEndRejectedAttempt: boolean; message: string }>;
export type ApplicationWindowClientOptions = { query: ApplicationWindowPrepareQuery; employeeId: string; authUserId: string; enabled: boolean;
  apiFetch: AttendanceApiFetch; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; isCurrentAuth: () => boolean; timeoutMs?: number; randomId?: () => string };
type Lease = { generation: number; controller: AbortController; deadline: number; timer: ReturnType<typeof setTimeout>; interrupted: Promise<never> };
class StorageFailure extends Error {}
class RejectedPost extends Error {}
const API = "/api/merchant-enterprise/attendance/application-window", DEFINITE = new Set(["attendance_application_window_changed", "attendance_application_window_disabled", "attendance_application_window_expired"]);
const hidden = () => typeof document !== "undefined" && document.hidden;
const sameFamilySlot = (a: ApplicationWindowFamily, b: ApplicationWindowFamily) => a === b || a.startsWith("missing") && b.startsWith("missing");
function identity(id: string) { if (typeof id !== "string" || id.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw Error("invalid_identity"); }
export function applicationWindowPendingKey(siteId: string, family: ApplicationWindowFamily, employeeId: string) {
  identity(employeeId); parseApplicationWindowQuery({ siteId, family, mode: "recover", operationId: employeeId });
  return family === "correction" ? correctionPendingKey(siteId, employeeId) : family === "correction_revision" ? revisionCycleKey(siteId, employeeId) : `faolla:attendance:missing:v1:${siteId}:self:${employeeId}`;
}
/** Host fence for an existing family client while a real Auth/requester scope
 * changes. Successful old transport/storage semantics are otherwise unchanged. */
export function applicationWindowLegacyPorts(apiFetch: AttendanceApiFetch, storage: ApplicationWindowClientOptions["storage"], isCurrent: () => boolean) {
  const check = () => { if (isCurrent() !== true) throw Error("stale_scope"); };
  return { apiFetch: (async (path, init) => { check(); const response = await apiFetch(path, init);
    try { check(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; } return response;
  }) as AttendanceApiFetch,
  storage: () => { check(); const store = storage(); check(); return {
    getItem: (key: string) => { check(); const result = store.getItem(key); check(); return result; },
    setItem: (key: string, value: string) => { check(); store.setItem(key, value); check(); },
    removeItem: (key: string) => { check(); store.removeItem(key); check(); },
  }; } };
}
export async function parseApplicationWindowPending(text: string, expected: { siteId: string; family: ApplicationWindowFamily; employeeId: string; authUserId: string }): Promise<ApplicationWindowPending> {
  identity(expected.employeeId); identity(expected.authUserId); const p = exact(parseApplicationWindowJson(text, "request"), ["protocol", "version", "actorId", "employeeId", "query", "command", "commandFingerprint"]);
  const { query, command } = parseApplicationWindowBody({ query: p.query, command: p.command });
  if (query.mode !== "prepare" || p.protocol !== "attendance-application-window-pending-v1" || p.version !== 1 || p.actorId !== expected.authUserId || p.employeeId !== expected.employeeId
    || query.siteId !== expected.siteId || !sameFamilySlot(query.family, expected.family)) throw new StorageFailure("pending_scope");
  const commandFingerprint = await applicationWindowCommandFingerprint(query, command, expected.authUserId); if (p.commandFingerprint !== commandFingerprint) throw new StorageFailure("pending_hash");
  return freeze({ protocol: "attendance-application-window-pending-v1", version: 1, actorId: expected.authUserId, employeeId: expected.employeeId, query, command, commandFingerprint });
}
/** Explicit local discovery only. Three known slots, no enumeration or HTTP; a
 * saved query grants neither current write authority nor a successful receipt. */
export async function discoverApplicationWindowPendings(o: { siteId: string; employeeId: string; authUserId: string;
  storage: () => Pick<Storage, "getItem">; isCurrentAuth: () => boolean; timeoutMs?: number }): Promise<readonly Readonly<{ query: ApplicationWindowPrepareQuery; operationId: string }>[]> {
  identity(o.employeeId); identity(o.authUserId); const duration = o.timeoutMs ?? 12000;
  if (!Number.isInteger(duration) || duration < 1 || duration > 12000) throw new StorageFailure("deadline_invalid");
  const deadline = performance.now() + duration; let live = true;
  const check = () => { if (!live || performance.now() >= deadline || hidden() || o.isCurrentAuth() !== true) throw new StorageFailure("scope_changed"); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { live = false; reject(new StorageFailure("deadline")); }, duration); });
  try { check(); const result = await Promise.race([timeout, (async () => {
    const found: { query: ApplicationWindowPrepareQuery; operationId: string }[] = [];
    for (const family of ["correction", "correction_revision", "missing"] as const) {
      check(); const key = applicationWindowPendingKey(o.siteId, family, o.employeeId), store = o.storage(); check(); const raw = store.getItem(key); check();
      if (raw === null) continue; const parsed = parseApplicationWindowJson(raw, "request");
      if (!parsed || typeof parsed !== "object" || (parsed as Record<string, unknown>).protocol !== "attendance-application-window-pending-v1") continue;
      const p = await parseApplicationWindowPending(raw, { ...o, family }); check(); if (store.getItem(key) !== raw) throw new StorageFailure("storage_changed"); check();
      found.push({ query: p.query, operationId: p.command.command.operationId });
    }
    return freeze(found);
  })()]); check(); return result; } finally { live = false; clearTimeout(timer); }
}
export class AttendanceApplicationWindowClient {
  readonly storageKey: string; private readonly o: ApplicationWindowClientOptions;
  private state: ApplicationWindowClientState = freeze({ phase: "idle", query: null, result: null, pending: null, canEndRejectedAttempt: false, message: "请显式读取申请窗口；不会自动请求或提交。" });
  private raw: string | null = null; private pending: ApplicationWindowPending | null = null; private legacyOperation: string | null = null; private loaded = false;
  private generation = 0; private controller: AbortController | null = null; private disposed = false; private listeners = new Set<() => void>(); private rejectedRaw: string | null = null;
  constructor(options: ApplicationWindowClientOptions) {
    const query = parseApplicationWindowQuery(options.query); if (query.mode !== "prepare") throw Error("invalid_query"); identity(options.employeeId); identity(options.authUserId);
    if (typeof options.enabled !== "boolean" || typeof options.isCurrentAuth !== "function" || typeof options.storage !== "function" || typeof options.apiFetch !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("invalid_options");
    this.o = Object.freeze({ ...options, query }); this.storageKey = applicationWindowPendingKey(query.siteId, query.family, options.employeeId);
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private current() { try { return !this.disposed && this.o.isCurrentAuth() === true; } catch { return false; } }
  private emit(patch: Partial<ApplicationWindowClientState>) { const state = this.state = freeze({ ...this.state, ...patch, pending: this.pending ? { kind: "window", operationId: this.pending.command.command.operationId } : this.legacyOperation ? { kind: "legacy", operationId: this.legacyOperation } : null,
    canEndRejectedAttempt: !!this.rejectedRaw && this.rejectedRaw === this.raw && !!this.pending && !this.controller && this.current() && !hidden() });
    for (const fn of [...this.listeners]) { if (this.state !== state) break; try { fn(); } catch { /* Observers do not grant writes. */ } } }
  pause = () => { ++this.generation; const c = this.controller; this.controller = null; c?.abort(); this.rejectedRaw = null; this.emit({ phase: this.raw ? "unconfirmed" : "idle", query: null, result: null, message: "资料与未提交草稿已隐藏；待确认原编号保留。" }); };
  invalidate = this.pause;
  dispose = () => { this.pause(); this.disposed = true; this.listeners.clear(); };
  hasLeaveRisk = () => { if (!this.current() || this.controller || this.raw) return true; try { return this.o.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(local = false): Lease | null { if (!this.current() || this.controller) return null; if (!local && hidden()) { this.pause(); return null; }
    const controller = new AbortController(), duration = this.o.timeoutMs ?? 12000, interrupted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(Error("aborted_or_timeout")), { once: true })); void interrupted.catch(() => {});
    const l = { generation: ++this.generation, controller, deadline: performance.now() + duration, timer: setTimeout(() => controller.abort(), duration), interrupted }; this.controller = controller; return l; }
  private guard(l: Lease, local = false) { if (l.generation === this.generation && (!this.current() || !local && hidden())) this.pause();
    if (!this.current() || l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted || performance.now() >= l.deadline) throw Error("stale_scope"); }
  private async wait<T>(l: Lease, promise: Promise<T>, local = false) { const r = await Promise.race([promise, l.interrupted]); this.guard(l, local); return r; }
  private release(l: Lease) { clearTimeout(l.timer); if (this.controller === l.controller && l.generation === this.generation) { this.controller = null; this.emit({}); } }
  private stored(l: Lease, local = false) { this.guard(l, local); const store = this.o.storage(); this.guard(l, local); const raw = store.getItem(this.storageKey); this.guard(l, local); if (raw !== null && typeof raw !== "string") throw new StorageFailure("storage_invalid"); return { store, raw }; }
  private verify(l: Lease, local = false) { const s = this.stored(l, local); if (s.raw !== this.raw) throw new StorageFailure("storage_changed"); return s.store; }
  private legacy(text: string) {
    const value = parseApplicationWindowJson(text, "request");
    if (this.o.query.family === "correction") return parseCorrectionPending(JSON.stringify(value), this.o.query.siteId, this.o.employeeId).command.operationId;
    if (this.o.query.family === "correction_revision") return parseRevisionCyclePending(JSON.stringify(value), this.o.query.siteId, this.o.employeeId).command.operationId;
    const p = exact(value, ["actorId", "query", "command"]), body = parseMissingBody({ query: p.query, command: p.command });
    if (p.actorId !== this.o.employeeId || body.query.siteId !== this.o.query.siteId || body.query.access !== "self") throw new StorageFailure("legacy_identity"); return body.command.operationId;
  }
  initialize = async () => { this.rejectedRaw = null; const l = this.begin(true); if (!l) return;
    try { const { raw } = this.stored(l, true); if (this.loaded && this.raw !== raw) throw new StorageFailure("storage_changed"); let pending: ApplicationWindowPending | null = null, legacyOperation: string | null = null;
      if (raw !== null) { const r = parseApplicationWindowJson(raw, "request") as Record<string, unknown>;
        if (r?.protocol === "attendance-application-window-pending-v1") pending = await this.wait(l, parseApplicationWindowPending(raw, { siteId: this.o.query.siteId, family: this.o.query.family, employeeId: this.o.employeeId, authUserId: this.o.authUserId }), true);
        else legacyOperation = this.legacy(raw); }
      if (this.stored(l, true).raw !== raw) throw new StorageFailure("storage_changed"); this.raw = raw; this.pending = pending; this.legacyOperation = legacyOperation; this.loaded = true;
      this.emit({ query: null, result: null, phase: raw ? "unconfirmed" : "idle", message: raw ? "同一原槽存在待确认编号；请先显式GET核对，不能另建申请。" : "请显式读取当前申请窗口。" });
    } catch (e) { this.failed(e, l, true); } finally { this.release(l); } };
  private failed(e: unknown, l: Lease, local = false, keepRejection = false) { if (l.generation !== this.generation) return; if (!keepRejection) this.rejectedRaw = null;
    if (!this.current() || !local && hidden()) { this.pause(); return; }
    this.emit({ query: null, result: null, phase: this.raw ? "unconfirmed" : "blocked", message: e instanceof StorageFailure ? "原槽已变化或不可用，停止新写；不会覆盖、删除其他编号。"
      : this.rejectedRaw ? "本次提交已明确拒绝，原编号仍保留；可以明确结束本次尝试后手动重读。" : this.raw ? "结果尚未可靠确认，保留完整原编号；不会自动重发。" : "未能完整核实申请窗口，请重新读取。" }); }
  private async transport(l: Lease, path: string, command: unknown | null, errors: Readonly<Record<string, number>>): Promise<unknown> {
    this.guard(l); const response = await this.wait(l, this.o.apiFetch(path, { method: command === null ? "GET" : "POST", signal: l.controller.signal, cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", ...(command === null ? {} : { "Content-Type": "application/json" }) }, ...(command === null ? {} : { body: JSON.stringify(command) }) }).then(r => { try { this.guard(l); } catch (e) { void r.body?.cancel().catch(() => {}); throw e; } return r; }));
    if (response.redirected || response.ok && response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    const reader = response.body?.getReader(); if (!reader) throw Error("empty_response"); const cancel = () => { void reader.cancel().catch(() => {}); }; l.controller.signal.addEventListener("abort", cancel, { once: true });
    let text = "", size = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
    try { while (true) { const chunk = await this.wait(l, reader.read()); if (chunk.done) break; size += chunk.value.byteLength; if (size > (response.status === 200 ? APPLICATION_WINDOW_RESPONSE_LIMIT : 4096)) throw Error("too_large"); text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); }
    finally { cancel(); l.controller.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    const raw = parseApplicationWindowJson(text); if (response.status !== 200) { const error = exact(raw, ["ok", "error"]);
      if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(errors, error.error) || errors[error.error] !== response.status) throw Error("invalid_error");
      if (command !== null && DEFINITE.has(error.error)) throw new RejectedPost(error.error); throw Error(error.error); } return raw;
  }
  private clear(l: Lease) { const store = this.verify(l); this.guard(l); store.removeItem(this.storageKey); this.guard(l); if (this.stored(l).raw !== null) throw new StorageFailure("storage_not_cleared"); this.raw = null; this.pending = null; this.legacyOperation = null; this.rejectedRaw = null; }
  private sameTarget(q: ApplicationWindowPrepareQuery) { const first = this.o.query; return q.siteId === first.siteId && q.workerId === first.workerId && q.family === first.family
    && (q.family === "correction" ? first.family === "correction" && q.startEventId === first.startEventId : q.family === "correction_revision" ? first.family === "correction_revision" && q.baseRequestId === first.baseRequestId
      : (first.family === "missing" || first.family === "missing_revision") && q.fromDate === first.fromDate && q.throughDate === first.throughDate && q.supersedesRequestId === first.supersedesRequestId); }
  private async read(q: ApplicationWindowQuery) { if (!this.loaded || this.raw || q.mode === "prepare" && !this.o.enabled) return; const l = this.begin(); if (!l) return; this.rejectedRaw = null;
    try { this.verify(l); this.emit({ query: null, result: null, phase: "loading", message: "正在读取申请与期限依据，不会提交…" }); this.guard(l);
      const raw = await this.transport(l, API + "?" + applicationWindowQueryString(q), null, applicationWindowErrors(q.family));
      const result = await this.wait(l, parseApplicationWindowResponse(raw, { query: q, command: null, authUserId: this.o.authUserId })); this.verify(l);
      if (result.application?.employeeId !== this.o.employeeId || result.window && result.window.employeeId !== this.o.employeeId) throw Error("identity_changed");
      this.emit({ query: q, result, phase: "ready", message: "已读取固定期限；提交仍需原业务全部校验，不代表批准。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); } }
  prepare = async (raw: ApplicationWindowPrepareQuery = this.o.query) => { const q = parseApplicationWindowQuery(raw); if (q.mode !== "prepare" || !this.sameTarget(q)) return; await this.read(q); };
  detail = (requestId: string) => this.read(parseApplicationWindowQuery({ siteId: this.o.query.siteId, family: this.o.query.family, mode: "detail", workerId: this.o.query.workerId, requestId }));
  submit = async (proposal: CorrectionProposal, reason: string) => { if (!this.loaded || this.raw || !this.o.enabled) return; const l = this.begin(); if (!l) return; this.rejectedRaw = null;
    try { this.verify(l); const r = this.state.result, q = this.state.query; if (!r?.canSubmit || r.mode !== "prepare" || !r.window || q?.mode !== "prepare" || !this.sameTarget(q) || r.application?.employeeId !== this.o.employeeId) throw Error("fresh_required");
      const a = r.application, operationId = (this.o.randomId ?? (() => crypto.randomUUID()))(); let old: unknown;
      if (q.family === "correction" && "basis" in a && "rules" in a && a.mode === "prepare") old = { action: "submit", operationId, expectedRevision: a.revision, expectedPolicyRevision: a.rules?.policy?.revision, reason, startEventId: q.startEventId, expectedLastEventId: a.basis.events.at(-1)?.id, proposal };
      else if (q.family === "correction_revision" && "current" in a) old = { action: "submit", operationId, expectedRevision: a.revision, expectedPolicyRevision: a.currentRules.policy?.revision,
        expectedBaseOperationId: a.current.lineage.rootOperationId, expectedEffectiveOperationId: a.current.operationId, proposal, reason };
      else if ((q.family === "missing" || q.family === "missing_revision") && "settingsVersion" in a) old = { action: q.family === "missing" ? "submit" : "revise", operationId, reason, expectedWorkerId: a.workerId,
        expectedSettingsVersion: a.settingsVersion, expectedPolicyRevision: a.policyRevision, locationId: a.locationId, timeZone: a.timeZone, proposal,
        ...(q.family === "missing_revision" ? { supersedesRequestId: q.supersedesRequestId, expectedApprovalOperationId: a.detail?.lineage?.currentApprovalOperationId } : {}) };
      else throw Error("family_changed");
      const command = parseApplicationWindowCommand({ command: old, expectedWindowFingerprint: r.window.windowFingerprint }, q), commandFingerprint = await this.wait(l, applicationWindowCommandFingerprint(q, command, this.o.authUserId));
      const pending: ApplicationWindowPending = freeze({ protocol: "attendance-application-window-pending-v1", version: 1, actorId: this.o.authUserId, employeeId: this.o.employeeId, query: q, command, commandFingerprint });
      const raw = JSON.stringify(pending); await this.wait(l, parseApplicationWindowPending(raw, { siteId: q.siteId, family: q.family, employeeId: this.o.employeeId, authUserId: this.o.authUserId }));
      const store = this.verify(l); this.guard(l);
      store.setItem(this.storageKey, raw); this.guard(l);
      if (this.stored(l).raw !== raw) throw new StorageFailure("storage_changed");
      this.raw = raw; this.pending = pending; this.emit({ query: null, result: null, phase: "saving", message: "完整原意图已保存，正在提交；结果不明时只核对原号。" }); this.guard(l); this.verify(l);
      const body = await this.transport(l, API, { query: q, command }, applicationWindowErrors(q.family));
      const result = await this.wait(l, parseApplicationWindowResponse(body, { query: q, command, authUserId: this.o.authUserId })); this.verify(l); this.match(result); this.clear(l);
      this.emit({ query: null, result, phase: "ready", message: "原号申请已确认；不代表审批通过。下一次申请必须显式重读。" });
    } catch (e) { if (e instanceof RejectedPost) { try { this.guard(l); this.verify(l); this.rejectedRaw = this.pending ? this.raw : null; } catch { this.rejectedRaw = null; } } this.failed(e, l, false, e instanceof RejectedPost); } finally { this.release(l); } };
  private match(result: ApplicationWindowResult) { const p = this.pending, r = result.receipt; if (!p || !r || r.actorId !== p.actorId || r.employeeAuthUserId !== p.actorId || r.employeeId !== p.employeeId || r.workerId !== p.query.workerId
    || r.family !== p.query.family || r.operationId !== p.command.command.operationId || r.requestId !== r.operationId || r.commandFingerprint !== p.commandFingerprint || r.windowFingerprint !== p.command.expectedWindowFingerprint) throw Error("receipt_mismatch"); }
  recover = async () => { if (!this.loaded || !this.raw) return; const l = this.begin(); if (!l) return; this.rejectedRaw = null;
    try { this.verify(l); this.emit({ query: null, result: null, phase: "loading", message: "只GET核对原编号；不会重新提交。" }); this.guard(l);
      if (this.pending) { const p = this.pending, q: ApplicationWindowQuery = { siteId: p.query.siteId, family: p.query.family, mode: "recover", operationId: p.command.command.operationId };
        const raw = await this.transport(l, API + "?" + applicationWindowQueryString(q), null, applicationWindowErrors(q.family)), result = await this.wait(l, parseApplicationWindowResponse(raw, { query: q, command: null, authUserId: this.o.authUserId })); this.verify(l);
        if (result.receipt) { this.match(result); this.clear(l); } this.emit({ query: q, result, phase: this.raw ? "unconfirmed" : "ready", message: this.raw ? "尚无匹配回执，不证明失败；原号保留。" : "原号已确认；回执不授予新写资格。" });
      } else { await this.recoverLegacy(l); this.emit({ query: null, result: null, phase: this.raw ? "unconfirmed" : "idle", message: this.raw ? "原协议尚无匹配收据，继续保留旧编号。" : "旧原号已确认；请显式读取新窗口。" }); }
    } catch (e) { this.failed(e, l); } finally { this.release(l); } };
  private async recoverLegacy(l: Lease) {
    const text = this.raw!; this.legacy(text); const family = this.o.query.family;
    if (family === "correction") { const p = parseCorrectionPending(text, this.o.query.siteId, this.o.employeeId), q = { ...p.query, operationId: p.command.operationId };
      const raw = await this.transport(l, "/api/merchant-enterprise/attendance/corrections?" + correctionQueryString(q), null, applicationWindowErrors(family));
      if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).ok !== true) throw Error("invalid_response"); const r = parseCorrectionResult(raw, q, true, true); this.verify(l);
      if (r.employeeId !== this.o.employeeId || r.mode !== "detail") throw Error("identity_changed"); if (!r.receipt) return; const c = p.command;
      if (r.receipt.revision !== c.expectedRevision + 1 || r.receipt.action !== c.action || c.action === "submit" && (r.reason !== c.reason || r.item.startEventId !== c.startEventId
        || r.basis.events.at(-1)?.id !== c.expectedLastEventId || !equal(r.proposal, c.proposal) || r.rules?.policy?.revision !== c.expectedPolicyRevision) || c.action === "withdraw" && r.withdrawal?.reason !== c.reason) throw Error("receipt_mismatch");
    } else if (family === "correction_revision") { const p = parseRevisionCyclePending(text, this.o.query.siteId, this.o.employeeId), q = { ...p.query, operationId: p.command.operationId };
      const raw = await this.transport(l, "/api/merchant-enterprise/attendance/revision-requests?" + attendanceRevisionQueryString(q), null, applicationWindowErrors(family));
      const r = parseRevisionCycleResponse(raw, q); this.verify(l); if (r.employeeId !== this.o.employeeId) throw Error("identity_changed"); if (!r.receipt) return; if (!equal(r.receipt.command, p.command)) throw Error("receipt_mismatch");
    } else { const value = exact(parseApplicationWindowJson(text, "request"), ["actorId", "query", "command"]), p = parseMissingBody({ query: value.query, command: value.command }), q = { ...p.query, operationId: p.command.operationId };
      const raw = await this.transport(l, "/api/merchant-enterprise/attendance/missing?" + missingQueryString(q), null, applicationWindowErrors(family));
      if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).ok !== true) throw Error("invalid_response"); const r = parseMissingResult(raw, q); this.verify(l);
      if (r.employeeId !== this.o.employeeId) throw Error("identity_changed"); if (!r.receipt) return; if (!equal(r.receipt.command, p.command)) throw Error("receipt_mismatch"); }
    this.clear(l);
  }
  endRejectedAttempt = async () => { if (!this.pending || !this.rejectedRaw || this.rejectedRaw !== this.raw) return; const l = this.begin(); if (!l) return;
    try { this.verify(l); if (this.rejectedRaw !== this.raw) throw Error("rejection_lost"); this.clear(l); this.emit({ query: null, result: null, phase: "idle", message: "已明确结束本次零提交拒绝尝试；没有自动重读或重发。" }); }
    catch (e) { this.failed(e, l); } finally { this.release(l); } };
}
