import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { exact, freeze, safeTree, same, site, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { outageCommandFingerprintText } from "./merchantAttendanceOutage";
import { outageLinksCommandFingerprintText } from "./merchantAttendanceOutageLinks";
import { outageReviewCommandFingerprintText } from "./merchantAttendanceOutageReview";
import { outageRelationsCommandFingerprintText } from "./merchantAttendanceOutageRelations";
import type { OutageCommand, OutageQuery, OutageResult } from "./merchantAttendanceOutageContract";
import type { OutageLinksCommand, OutageLinksQuery, OutageLinksResult } from "./merchantAttendanceOutageLinksContract";
import type { OutageReviewCommand, OutageReviewQuery, OutageReviewResult } from "./merchantAttendanceOutageReviewContract";
import type { OutageRelationsCommand, OutageRelationsQuery, OutageRelationsResult } from "./merchantAttendanceOutageRelationsContract";
import { OUTAGE_SUBJECT_API, OUTAGE_SUBJECT_ERRORS, parseOutageSubjectQuery, parseOutageSubjectResponse, outageSubjectQueryString,
  type OutageSubjectQuery, type OutageSubjectResult } from "./merchantAttendanceOutageSubject";
import { OUTAGE_APIS, OUTAGE_HTTP_ERRORS, OUTAGE_HTTP_BODY_LIMIT, OUTAGE_HTTP_RESPONSE_LIMIT,
  outageHttpQueryString, parseOutageHttpQuery, parseOutageHttpBody, parseOutageHttpResponse,
  type OutageHttpKind, type OutageHttpQueryMap, type OutageHttpCommandMap, type OutageHttpResultMap } from "./merchantAttendanceOutageHttp";

export type OutageClientStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type OutageClientOptions<K extends OutageHttpKind> = { kind: K; siteId: string; access: "owner" | "self"; actorId: string;
  enabled: boolean; apiFetch: AttendanceApiFetch; storage: () => OutageClientStorage; operationId?: () => string; timeoutMs?: number };
export type OutageClientPending<K extends OutageHttpKind> = { version: 1; kind: K; actorId: string; query: OutageHttpQueryMap[K]; command: OutageHttpCommandMap[K] };
export type OutageClientState<K extends OutageHttpKind> = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  query: OutageHttpQueryMap[K] | null; result: OutageHttpResultMap[K] | null; pending: OutageClientPending<K> | null;
  prepared: OutageSubjectResult | null;
  canWrite: boolean; canEndRejectedAttempt: boolean; message: string }>;
type Lease = { generation: number; controller: AbortController; deadline: number; timer: ReturnType<typeof setTimeout> };
class StorageChanged extends Error {}
class Rejected extends Error {}
const hidden = () => typeof document !== "undefined" && document.hidden;
const DEFINITIVE_REJECTIONS = new Set(["attendance_version_conflict", "attendance_outage_changed", "attendance_outage_limit",
  "attendance_outage_links_changed", "attendance_outage_links_blocked", "attendance_outage_links_limit",
  "attendance_outage_review_changed", "attendance_outage_review_blocked", "attendance_outage_review_limit",
  "attendance_outage_relations_changed", "attendance_outage_relations_blocked", "attendance_outage_relations_limit", "attendance_platform_paused"]);

export function outageClientPendingKey(kind: OutageHttpKind, siteId: string, access: "owner" | "self", actorId: string) {
  if (!Object.hasOwn(OUTAGE_APIS, kind) || !["owner", "self"].includes(access)) throw Error("invalid_scope");
  return `faolla:attendance:outage-client:v1:${kind}:${site(siteId)}:${access}:${uuid(actorId)}`;
}
function fingerprintText<K extends OutageHttpKind>(kind: K, q: OutageHttpQueryMap[K], c: OutageHttpCommandMap[K]) {
  if (kind === "outages") return outageCommandFingerprintText(q as OutageQuery, c as OutageCommand);
  if (kind === "links") return outageLinksCommandFingerprintText(q as OutageLinksQuery, c as OutageLinksCommand);
  if (kind === "relations") return outageRelationsCommandFingerprintText(q as OutageRelationsQuery, c as OutageRelationsCommand);
  return outageReviewCommandFingerprintText(q as OutageReviewQuery, c as OutageReviewCommand);
}
// The server remains authoritative. These checks pin the user's command to the
// same displayed read; historical declaration versions are NEVER used as current CAS.
export function outageClientCommandMatchesRead<K extends OutageHttpKind>(kind: K, result: OutageHttpResultMap[K],
  readQuery: OutageHttpQueryMap[K], q: OutageHttpQueryMap[K], c: OutageHttpCommandMap[K]) {
  if (!result.canWrite || result.receipt || readQuery.siteId !== q.siteId || readQuery.access !== q.access) return false;
  if (kind === "outages") {
    const command = c as OutageCommand;
    if (command.action === "create_incident") return readQuery.access === "owner" && readQuery.mode === "incidents";
    // Historical incident/declaration reads do not contain current subject CAS.
    return false;
  }
  if (!("declarationId" in readQuery) || !("declarationId" in q) || readQuery.declarationId !== q.declarationId) return false;
  if (kind === "relations") {
    const r = result as OutageRelationsResult, command = c as OutageRelationsCommand;
    if (readQuery.mode !== "detail" || q.mode !== "detail" || !("relatedDeclarationId" in readQuery) || !("relatedDeclarationId" in q)
      || readQuery.relatedDeclarationId !== q.relatedDeclarationId || command.expectedRevision !== r.revision || q.access !== "owner") return false;
    return command.action === "apply" ? r.preview?.eligible === true && command.expectedFingerprint === r.preview.fingerprint
      : r.current?.action === "apply" && command.expectedFingerprint === r.current.fingerprint;
  }
  if (kind === "links") {
    const r = result as OutageLinksResult, command = c as OutageLinksCommand;
    if (command.expectedRevision !== r.revision) return false;
    return command.action === "apply" ? readQuery.mode === "preview" && r.preview?.eligible === true
      && command.expectedFingerprint === r.preview.fingerprint && same(command.sources, (readQuery as Extract<OutageLinksQuery, { mode: "preview" }>).sources)
      : r.current?.action === "apply" && command.expectedFingerprint === r.current.fingerprint;
  }
  const r = result as OutageReviewResult, command = c as OutageReviewCommand;
  if (readQuery.mode !== "detail" || command.expectedRevision !== r.revision || command.expectedResultVersion !== r.resultVersion) return false;
  if (command.action === "propose") return r.status?.canPropose === true && command.expectedFingerprint === r.status.basisFingerprint;
  if (!r.proposal || command.expectedFingerprint !== r.proposal.resultFingerprint) return false;
  if (command.action === "confirm") return r.status?.canConfirm === true;
  if (command.action === "resolve") return r.status?.canResolve === true;
  return command.action === "dispute" || r.current?.action === "resolve";
}

/** Isolated pending intent, no polling, automatic writes or cross-kind fallbacks.
 * Declaration drafts require this instance's explicit prepare() read of the
 * current subject; historical versions and caller-provided snapshots cannot authorize them.
 * A host must synchronously pause/dispose on Auth, merchant, access, visibility
 * or mount-lifetime changes, before rendering another scope. The fixed actorId
 * and hidden() checks do not independently observe a later Auth transition or
 * a hidden->visible cycle between awaits. Pending storage must remain scoped. */
export class AttendanceOutageClient<K extends OutageHttpKind> {
  readonly storageKey: string;
  private readonly options: OutageClientOptions<K>;
  private state: OutageClientState<K> = freeze({ phase: "idle", query: null, result: null, prepared: null, pending: null, canWrite: false, canEndRejectedAttempt: false, message: "请明确读取故障资料；不会自动提交。" });
  private listeners = new Set<() => void>();
  private generation = 0; private lease: Lease | null = null; private initialized = false;
  private pending: OutageClientPending<K> | null = null; private pendingRaw: string | null = null; private rejected: OutageClientPending<K> | null = null;
  constructor(options: OutageClientOptions<K>) {
    this.storageKey = outageClientPendingKey(options.kind, options.siteId, options.access, options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.storage !== "function" || typeof options.apiFetch !== "function"
      || options.operationId !== undefined && typeof options.operationId !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("invalid_options");
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Omit<OutageClientState<K>, "pending" | "canEndRejectedAttempt" | "prepared"> & { prepared?: OutageSubjectResult | null }) {
    const current = this.state = freeze({ prepared: null, ...patch, pending: this.pending, canEndRejectedAttempt: this.pending !== null && this.rejected === this.pending });
    for (const fn of [...this.listeners]) { if (current !== this.state) break; try { fn(); } catch { /* Observers never authorize a write. */ } }
  }
  pause = () => {
    const g = ++this.generation, l = this.lease; this.lease = null; this.rejected = null;
    if (l) { clearTimeout(l.timer); l.controller.abort(); }
    if (g === this.generation) this.publish({ phase: this.pending ? "unconfirmed" : "idle", query: null, result: null, canWrite: false, message: "资料已清除；待确认原编号保留，不自动重发。" });
  };
  invalidate = this.pause;
  hasLeaveRisk = () => { if (this.pending || this.lease) return true; try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(): Lease | null {
    if (hidden()) { this.pause(); return null; } if (this.lease) return null;
    const controller = new AbortController(), timeout = this.options.timeoutMs ?? 12000;
    const l = { generation: ++this.generation, controller, deadline: performance.now() + timeout, timer: setTimeout(() => controller.abort(), timeout) };
    this.lease = l; return l;
  }
  private guard(l: Lease) {
    if (l.generation === this.generation && hidden()) this.pause();
    if (this.lease !== l || l.generation !== this.generation || l.controller.signal.aborted || performance.now() >= l.deadline) throw Error("aborted_or_timeout");
  }
  private release(l: Lease) { clearTimeout(l.timer); if (this.lease === l) this.lease = null; }
  private async race<T>(l: Lease, work: () => Promise<T>): Promise<T> {
    let stop!: () => void;
    const aborted = new Promise<never>((_, reject) => { stop = () => reject(Error("aborted_or_timeout")); l.controller.signal.addEventListener("abort", stop, { once: true }); });
    try { this.guard(l); const r = await Promise.race([Promise.resolve().then(() => { this.guard(l); return work(); }), aborted]); this.guard(l); return r; }
    finally { l.controller.signal.removeEventListener("abort", stop); }
  }
  private stored(l: Lease) { this.guard(l); const storage = this.options.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l); return { storage, raw }; }
  private verify(l: Lease) { const s = this.stored(l); if (s.raw !== this.pendingRaw) throw new StorageChanged("changed_pending"); return s.storage; }
  private scope(q: OutageHttpQueryMap[K]) { if (q.siteId !== this.options.siteId || q.access !== this.options.access) throw Error("wrong_scope"); return q; }
  private query(raw: OutageHttpQueryMap[K]) {
    return this.scope(parseOutageHttpQuery(this.options.kind, "https://local.invalid" + OUTAGE_APIS[this.options.kind] + "?" + outageHttpQueryString(this.options.kind, raw)));
  }
  private decode(raw: string): OutageClientPending<K> {
    if (new TextEncoder().encode(raw).byteLength > OUTAGE_HTTP_BODY_LIMIT + 1024) throw new StorageChanged("oversized_pending");
    const p = exact(parseCaptureBrowserJson(raw), ["version", "kind", "actorId", "query", "command"]);
    if (p.version !== 1 || p.kind !== this.options.kind || p.actorId !== this.options.actorId) throw new StorageChanged("wrong_pending_identity");
    const body = parseOutageHttpBody(this.options.kind, { query: p.query, command: p.command }, this.options.actorId); this.scope(body.query);
    return freeze({ version: 1, kind: this.options.kind, actorId: this.options.actorId, ...body });
  }
  initialize = async () => {
    const l = this.begin(); if (!l) return;
    try {
      const { raw } = this.stored(l); if (this.initialized && raw !== this.pendingRaw) throw new StorageChanged("changed_pending");
      const pending = raw === null ? null : this.decode(raw); this.guard(l);
      this.pending = pending; this.pendingRaw = raw; this.initialized = true; this.rejected = null;
      this.publish({ phase: pending ? "unconfirmed" : "idle", query: null, result: null, canWrite: false, message: pending ? "发现待确认原编号，请明确核对原回执；不会自动重发。" : "请明确读取故障资料；不会自动提交。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  private failed(error: unknown, l: Lease) {
    if (l.generation !== this.generation) return; if (hidden()) { this.pause(); return; }
    this.publish({ phase: this.pending ? "unconfirmed" : "blocked", query: null, result: null, canWrite: false, message: error instanceof StorageChanged
      ? "恢复存储不可用或已改变，未覆盖或删除原记录；请保留编号核验。" : this.pending
        ? this.rejected === this.pending ? "服务器明确拒绝本次提交；原编号保留，可明确结束此次被拒尝试。" : "结果尚未确认，保留原编号；请读取原回执，不会自动重发。"
        : "无法核对当前资料、身份或权限；旧显示已清除，请重新读取。" });
  }
  private async wire<T>(l: Lease, url: string, body: unknown | null, parse: (raw: unknown) => T,
    errors: Readonly<Record<string, number>> = OUTAGE_HTTP_ERRORS) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    l.controller.signal.addEventListener("abort", cancel, { once: true });
    const run = async () => {
      this.guard(l);
      const r = await this.options.apiFetch(url, {
        method: body ? "POST" : "GET", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: l.controller.signal, cache: "no-store", redirect: "error",
      });
      if (l.controller.signal.aborted || r.redirected || r.ok && r.status !== 200 || r.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        void r.body?.cancel().catch(() => {}); throw Error("invalid_response");
      }
      try { this.guard(l); } catch (error) { void r.body?.cancel().catch(() => {}); throw error; }
      reader = r.body?.getReader(); if (!reader) throw Error("empty_response");
      const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      while (true) { const part = await reader.read(); this.guard(l); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > (r.status === 200 ? OUTAGE_HTTP_RESPONSE_LIMIT : 4096)) throw Error("response_too_large"); text += decoder.decode(part.value, { stream: true }); }
      const raw = parseCaptureBrowserJson(text + decoder.decode()); this.guard(l);
      if (r.status !== 200) {
        const e = exact(raw, ["ok", "error"]); if (e.ok !== false || typeof e.error !== "string" || !Object.hasOwn(errors, e.error) || errors[e.error] !== r.status) throw Error("invalid_error");
        throw new Rejected(e.error);
      }
      return parse(raw);
    };
    try { return await this.race(l, run); }
    finally { l.controller.signal.removeEventListener("abort", cancel); cancel(); try { reader?.releaseLock(); } catch { /* cancelled pending read */ } }
  }
  private request(l: Lease, q: OutageHttpQueryMap[K], c: OutageHttpCommandMap[K] | null) {
    return this.wire(l, OUTAGE_APIS[this.options.kind] + (c ? "" : "?" + outageHttpQueryString(this.options.kind, q)), c ? { query: q, command: c } : null,
      raw => parseOutageHttpResponse(this.options.kind, raw, q, this.options.actorId, c));
  }
  prepare = async (rawQuery: OutageSubjectQuery) => {
    const l = this.begin(); if (!l) return;
    try {
      if (this.options.kind !== "outages" || !this.initialized || this.pending) throw Error("unavailable_preparation");
      this.verify(l); const q = parseOutageSubjectQuery(rawQuery);
      if (q.siteId !== this.options.siteId || q.access !== this.options.access) throw Error("wrong_scope");
      this.publish({ phase: "loading", query: null, result: null, canWrite: false, message: "正在核验已知故障与当前人员身份及版本…" }); this.guard(l);
      const response = await this.wire(l, OUTAGE_SUBJECT_API + "?" + outageSubjectQueryString(q), null,
        raw => parseOutageSubjectResponse(raw, q, this.options.actorId), { ...OUTAGE_HTTP_ERRORS, ...OUTAGE_SUBJECT_ERRORS });
      this.guard(l); this.verify(l);
      this.publish({ phase: "ready", query: null, result: null, prepared: response.result, canWrite: response.canWrite && response.result.canWrite,
        message: "已读取当前声明依据；提交时服务器仍会重新核验，不补造打卡或工时。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  private clear(l: Lease) {
    const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw new StorageChanged("pending_not_cleared"); this.pending = null; this.pendingRaw = null; this.rejected = null;
  }
  private async receipt(l: Lease, p: OutageClientPending<K>, r: OutageHttpResultMap[K]) {
    const receipt = r.receipt; if (!receipt || receipt.operationId !== p.command.operationId) throw Error("missing_receipt");
    if (this.options.kind === "outages") {
      const c = p.command as OutageCommand, saved = (r as OutageResult).receipt!;
      if (saved.action !== c.action || saved.incidentId !== c.incidentId || saved.recordId !== (c.action === "declare" ? c.declarationId : c.incidentId)) throw Error("wrong_receipt_fields");
    } else if (this.options.kind === "links") {
      const c = p.command as OutageLinksCommand, saved = (r as OutageLinksResult).receipt!.entry;
      if (saved.action !== c.action || saved.revision !== c.expectedRevision + 1 || saved.reason !== c.reason || saved.fingerprint !== c.expectedFingerprint
        || !same(saved.sources, c.action === "apply" ? c.sources : [])) throw Error("wrong_receipt_fields");
    } else if (this.options.kind === "relations") {
      const c = p.command as OutageRelationsCommand, saved = (r as OutageRelationsResult).receipt!.entry;
      if (saved.action !== c.action || saved.revision !== c.expectedRevision + 1 || saved.reason !== c.reason || saved.fingerprint !== c.expectedFingerprint
        || c.action === "apply" && saved.kind !== c.kind) throw Error("wrong_receipt_fields");
    } else {
      const c = p.command as OutageReviewCommand, saved = (r as OutageReviewResult).receipt!.entry;
      if (saved.action !== c.action || saved.revision !== c.expectedRevision + 1 || saved.resultVersion !== c.expectedResultVersion + (c.action === "propose" ? 1 : 0)
        || saved.reason !== c.reason || saved.resultFingerprint !== c.expectedFingerprint) throw Error("wrong_receipt_fields");
    }
    const text = fingerprintText(this.options.kind, p.query, p.command);
    const digest = await this.race(l, () => globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
    const wanted = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
    this.guard(l); this.verify(l); if (this.pending !== p || wanted !== receipt.commandFingerprint) throw Error("wrong_receipt");
  }
  load = async (rawQuery: OutageHttpQueryMap[K]) => {
    const l = this.begin(); if (!l) return;
    try {
      if (!this.initialized || this.pending) throw Error("pending_or_uninitialized"); this.verify(l); const q = this.query(rawQuery);
      if (q.mode === "recover") throw Error("use_pending_recovery"); this.rejected = null;
      this.publish({ phase: "loading", query: null, result: null, canWrite: false, message: "正在重新授权并读取故障资料…" }); this.guard(l);
      const response = await this.request(l, q, null); this.guard(l); this.verify(l);
      this.publish({ phase: "ready", query: q, ...response, message: "资料已读取；登记和核对不等同于补打卡，也不增加工时。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  recover = async () => {
    const p = this.pending; if (!p || !this.initialized) return; const l = this.begin(); if (!l) return;
    try {
      this.verify(l); this.rejected = null;
      const raw = { siteId: p.query.siteId, access: p.query.access, mode: "recover", operationId: p.command.operationId,
        ...("declarationId" in p.query && this.options.kind !== "outages" ? { declarationId: p.query.declarationId } : {}),
        ...("relatedDeclarationId" in p.query && this.options.kind === "relations" ? { relatedDeclarationId: p.query.relatedDeclarationId } : {}) };
      const q = this.query(raw as OutageHttpQueryMap[K]);
      this.publish({ phase: "loading", query: null, result: null, canWrite: false, message: "正在按原编号读取回执；不重新提交…" }); this.guard(l);
      // Existing pure parsers intentionally forbid recover-query + write-command.
      const response = await this.request(l, q, null); this.guard(l); this.verify(l);
      await this.receipt(l, p, response.result); this.guard(l); this.clear(l); this.guard(l);
      this.publish({ phase: "ready", query: q, ...response, message: "原编号与完整命令摘要已核验；未重发，当前状态须重新读取。" });
    } catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
  submit = async (rawQuery: OutageHttpQueryMap[K], draft: unknown) => {
    const state = this.state;
    if (!this.initialized || this.pending || !this.options.enabled || state.phase !== "ready" || !state.canWrite || !state.prepared && (!state.result || !state.query)) return;
    const l = this.begin(); if (!l) return; let sent: OutageClientPending<K> | null = null;
    try {
      this.verify(l); safeTree(draft, OUTAGE_HTTP_BODY_LIMIT);
      if (!draft || typeof draft !== "object" || Array.isArray(draft) || Object.hasOwn(draft, "operationId")) throw Error("draft_must_not_supply_operation_id");
      const operationId = (this.options.operationId ?? (() => crypto.randomUUID()))(); this.guard(l);
      const body = parseOutageHttpBody(this.options.kind, { query: rawQuery, command: { ...draft, operationId } }, this.options.actorId); this.scope(body.query);
      if (this.options.kind === "outages" && body.command.action === "declare") {
        const p = state.prepared, c = body.command as Extract<OutageCommand, { action: "declare" }>;
        if (!p?.canWrite || p.incident.id !== c.incidentId || !same(
          [p.subject.workerId, p.subject.employeeId, p.subject.employeeAuthUserId, p.subject.workerVersion, p.subject.employeeVersion, p.subject.generation],
          [c.workerId, c.employeeId, c.employeeAuthUserId, c.expectedWorkerVersion, c.expectedEmployeeVersion, c.expectedGeneration])) throw Error("stale_or_wrong_subject");
      } else if (!state.result || !state.query || !outageClientCommandMatchesRead(this.options.kind, state.result, state.query, body.query, body.command)) throw Error("stale_or_wrong_read");
      const pending: OutageClientPending<K> = freeze({ version: 1, kind: this.options.kind, actorId: this.options.actorId, ...body });
      const raw = JSON.stringify(pending); this.decode(raw); this.guard(l);
      this.publish({ phase: "saving", query: null, result: null, canWrite: false, message: "先保存原编号，再提交一次明确操作…" }); this.guard(l);
      const storage = this.verify(l); this.initialized = false; storage.setItem(this.storageKey, raw); this.guard(l);
      if (this.stored(l).raw !== raw) throw new StorageChanged("pending_not_saved");
      this.pending = pending; this.pendingRaw = raw; this.initialized = true; this.rejected = null;
      this.publish({ phase: "saving", query: null, result: null, canWrite: false, message: "原编号已保存，正在提交一次…" }); this.guard(l); this.verify(l); this.guard(l);
      sent = pending; const response = await this.request(l, body.query, body.command); this.guard(l); this.verify(l);
      await this.receipt(l, pending, response.result); this.guard(l); this.clear(l); this.guard(l);
      this.publish({ phase: "ready", query: body.query, ...response, message: "操作回执已核验；请重新读取当前状态后继续下一步。" });
    } catch (e) {
      if (sent && e instanceof Rejected && DEFINITIVE_REJECTIONS.has(e.message)) {
        try { this.guard(l); this.verify(l); if (this.pending === sent) this.rejected = sent; } catch { /* No late rejection can retire an intent. */ }
      }
      this.failed(e, l);
    } finally { this.release(l); }
  };
  endRejectedAttempt = async () => {
    const p = this.pending; if (!p || this.rejected !== p || !this.initialized) return; const l = this.begin(); if (!l) return;
    try { this.verify(l); this.clear(l); this.guard(l); this.publish({ phase: "idle", query: null, result: null, canWrite: false, message: "已明确结束这次被服务器拒绝的尝试；请重新读取，不自动重发。" }); }
    catch (e) { this.failed(e, l); } finally { this.release(l); }
  };
}
