import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { EVENT_NOTIFICATIONS_API, EVENT_NOTIFICATIONS_BYTE_LIMIT, EVENT_NOTIFICATIONS_ERRORS, eventNotificationsUuid,
  parseEventNotificationsJson, parseEventNotificationsQuery, parseEventNotificationsResponse, eventNotificationsQueryString,
  type EventNotificationsQuery, type EventNotificationsCommand, type EventNotificationsResult } from "./merchantAttendanceEventNotifications";

export type EventNotificationsClientOptions = { siteId: string; employeeId: string; apiFetch: AttendanceApiFetch;
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; enabled: boolean; expectedAuthUserId?: string; isCurrentAuth?: () => boolean; timeoutMs?: number };
export type EventNotificationsPending = { version: 1; siteId: string; employeeId: string; actorId: string; workerId: string; notificationId: string };
export type EventNotificationsClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  query: EventNotificationsQuery | null; result: EventNotificationsResult | null; pending: EventNotificationsPending | null; message: string }>;
type Lease = { epoch: number; controller: AbortController };
const hidden = () => typeof document !== "undefined" && document.hidden;
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function base(siteId: string, employeeId: string, patch: Partial<EventNotificationsQuery> = {}) { return parseEventNotificationsQuery({ siteId, expectedEmployeeId: employeeId, expectedWorkerId: null, notificationId: null, beforeAt: null, beforeId: null, ...patch }); }
export function eventNotificationsPendingKey(siteId: string, employeeId: string) { base(siteId, employeeId); return `faolla:attendance:event-notifications:v1:${siteId}:${employeeId}`; }
async function transport(o: EventNotificationsClientOptions, q: EventNotificationsQuery, command: EventNotificationsCommand | null, signal: AbortSignal) {
  const controller = new AbortController(), ms = o.timeoutMs ?? 12000, deadline = performance.now() + ms;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (error: Error) => void;
  const stopped = new Promise<never>((_, r) => { reject = r; });
  const cancel = () => { controller.abort(); reject(Error("aborted_or_timeout")); void reader?.cancel().catch(() => {}); };
  const timer = setTimeout(cancel, ms); signal.addEventListener("abort", cancel, { once: true });
  const guard = () => { if (signal.aborted || controller.signal.aborted || performance.now() >= deadline || o.isCurrentAuth?.() === false) throw Error("stale_scope"); };
  const run = async () => {
    guard(); const response = await o.apiFetch(command ? EVENT_NOTIFICATIONS_API : `${EVENT_NOTIFICATIONS_API}?${eventNotificationsQueryString(q)}`, {
      method: command ? "POST" : "GET", headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify({ query: q, command }) } : {}), signal: controller.signal, cache: "no-store", redirect: "error" });
    if (signal.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
    guard(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response"); let text = "", bytes = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try { while (true) { const part = await reader.read(); guard(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > (response.status === 200 ? EVENT_NOTIFICATIONS_BYTE_LIMIT : 4096)) throw Error("too_large"); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
    finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    guard(); const raw = parseEventNotificationsJson(text);
    if (response.status !== 200) { const e = captureBrowserExact(raw, ["ok", "error"]);
      if (e.ok !== false || typeof e.error !== "string" || !Object.hasOwn(EVENT_NOTIFICATIONS_ERRORS, e.error) || EVENT_NOTIFICATIONS_ERRORS[e.error] !== response.status) throw Error("invalid_error"); throw Error(e.error); }
    return raw;
  };
  try { return await Promise.race([run(), stopped]); } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}

/** Recovery never writes. A second POST requires a separate explicit markRead. */
export class AttendanceEventNotificationsClient {
  readonly storageKey: string; private readonly o: EventNotificationsClientOptions;
  private state: EventNotificationsClientState = freeze({ phase: "idle", query: null, result: null, pending: null, message: "请明确读取考勤消息；查看不代表已读或同意。" });
  private epoch = 0; private controller: AbortController | null = null; private loaded = false; private raw: string | null = null;
  private actorId: string | undefined; private workerId: string | null | undefined; private listeners = new Set<() => void>();
  constructor(options: EventNotificationsClientOptions) {
    this.storageKey = eventNotificationsPendingKey(options.siteId, options.employeeId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.isCurrentAuth !== undefined && typeof options.isCurrentAuth !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("invalid_options");
    if (options.expectedAuthUserId !== undefined) eventNotificationsUuid(options.expectedAuthUserId); this.o = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<EventNotificationsClientState>) { const next = this.state = freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) { if (this.state !== next) break; try { listener(); } catch { /* Observers cannot authorize requests. */ } } }
  pause = () => { const epoch = ++this.epoch, previous = this.controller; this.controller = null; this.loaded = false; previous?.abort();
    if (epoch === this.epoch) this.publish({ result: null, query: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "资料已隐藏，待确认原消息编号保留；重新核验身份后读取。" }); };
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
    this.publish({ result: null, query: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: this.state.pending
      ? "已读结果尚未核实；原消息编号保留。恢复只读取，不自动再次提交。" : "读取或身份核验失败，资料已隐藏；待确认存储不会被覆盖。" }); }
  private q(patch: Partial<EventNotificationsQuery> = {}) { return base(this.o.siteId, this.o.employeeId, patch); }
  initialize = async () => { const l = this.begin(); if (!l) return;
    try { const { raw } = this.stored(l); if (this.state.pending && raw !== this.raw) throw Error("pending_changed"); let pending: EventNotificationsPending | null = null;
      if (raw !== null) { const p = captureBrowserExact(parseEventNotificationsJson(raw, "request"), ["version", "siteId", "employeeId", "actorId", "workerId", "notificationId"]);
        if (p.version !== 1 || p.siteId !== this.o.siteId || p.employeeId !== this.o.employeeId) throw Error("pending_scope");
        pending = { version: 1, siteId: this.o.siteId, employeeId: this.o.employeeId, actorId: eventNotificationsUuid(p.actorId), workerId: eventNotificationsUuid(p.workerId), notificationId: eventNotificationsUuid(p.notificationId) };
        if (this.o.expectedAuthUserId !== undefined && pending.actorId !== this.o.expectedAuthUserId || this.actorId !== undefined && pending.actorId !== this.actorId
          || this.workerId !== undefined && pending.workerId !== this.workerId) throw Error("pending_identity"); }
      if (this.stored(l).raw !== raw) throw Error("pending_changed"); this.raw = raw; this.loaded = true;
      this.publish({ pending, query: null, result: null, phase: pending ? "unconfirmed" : "idle", message: pending ? "发现待确认原消息；请明确读取已读结果，不自动重发。" : "请明确读取新捕获的考勤消息。" });
    } catch { this.loaded = false; this.failed(l); } finally { this.release(l); }
  };
  private parse(raw: unknown, q: EventNotificationsQuery, c: EventNotificationsCommand | null) {
    const result = parseEventNotificationsResponse(raw, q, this.o.expectedAuthUserId ?? this.state.pending?.actorId ?? this.actorId, c);
    if (this.actorId !== undefined && result.actorId !== this.actorId || this.workerId !== undefined && result.workerId !== this.workerId) throw Error("identity_changed");
    const p = this.state.pending; if (p && (result.actorId !== p.actorId || result.workerId !== p.workerId || result.employeeId !== p.employeeId || result.detail?.notificationId !== p.notificationId)) throw Error("pending_identity");
    this.actorId = result.actorId; this.workerId = result.workerId; return result;
  }
  private settle(result: EventNotificationsResult, l: Lease) { const p = this.state.pending; if (!p || result.detail?.readAt == null) return;
    if (result.detail.notificationId !== p.notificationId || result.actorId !== p.actorId || result.workerId !== p.workerId || result.employeeId !== p.employeeId) throw Error("receipt_mismatch");
    const storage = this.verify(l); storage.removeItem(this.storageKey); this.guard(l); if (this.stored(l).raw !== null) throw Error("pending_changed"); this.raw = null; this.publish({ pending: null }); this.guard(l);
  }
  private async get(q: EventNotificationsQuery, recovery = false) { const l = this.begin(); if (!l) return;
    try { if (!this.loaded || (!recovery && (!this.o.enabled || this.state.pending)) || recovery && !this.state.pending) return; this.verify(l);
      this.publish({ phase: "loading", result: null, query: null, message: "正在核验本人消息…" }); this.guard(l);
      const raw = await transport(this.o, q, null, l.controller.signal); this.guard(l); this.verify(l); const result = this.parse(raw, q, null); this.settle(result, l); this.guard(l);
      this.publish({ result, query: q, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending ? "原消息仍未显示已读；不会自动提交，可明确选择再次标读。"
        : result.detail?.readAt ? "已核实此消息已读；不代表同意、业务确认或当前批准有效。" : "这是当时的处理结果；当前事项状态未重新核查。" });
    } catch { this.failed(l); } finally { this.release(l); }
  }
  load = async () => { await this.get(this.q({ expectedWorkerId: this.workerId ?? null })); };
  list = this.load;
  next = async () => { const r = this.state.result; if (this.state.phase === "ready" && r?.nextCursor && r.workerId) await this.get(this.q({ expectedWorkerId: r.workerId, beforeAt: r.nextCursor.at, beforeId: r.nextCursor.id })); };
  detail = async (notificationId: string) => { const r = this.state.result; if (this.state.phase === "ready" && r?.workerId && r.items.some(item => item.notificationId === notificationId)) await this.get(this.q({ expectedWorkerId: r.workerId, notificationId })); };
  recover = async () => { const p = this.state.pending; if (p) await this.get(this.q({ expectedWorkerId: p.workerId, notificationId: p.notificationId }), true); };
  markRead = async () => {
    const result = this.state.result, detail = result?.detail, original = this.state.pending;
    if (!this.loaded || !this.o.enabled || !["ready", "unconfirmed"].includes(this.state.phase) || !result?.canMarkRead || !result.workerId || !detail || detail.readAt !== null
      || original && (detail.notificationId !== original.notificationId || result.actorId !== original.actorId || result.workerId !== original.workerId)) return;
    const l = this.begin(); if (!l) return;
    try { this.verify(l); const pending = original ?? freeze({ version: 1 as const, siteId: this.o.siteId, employeeId: this.o.employeeId, actorId: result.actorId, workerId: result.workerId, notificationId: detail.notificationId });
      const q = this.q({ expectedWorkerId: pending.workerId, notificationId: pending.notificationId }), command: EventNotificationsCommand = { action: "mark_read", notificationId: pending.notificationId };
      this.publish({ phase: "saving", result: null, query: null, message: "正在固定明确标读意图…" }); this.guard(l);
      if (!original) { const raw = JSON.stringify(pending), storage = this.verify(l); storage.setItem(this.storageKey, raw); this.guard(l);
        if (this.stored(l).raw !== raw) throw Error("pending_changed"); this.raw = raw; this.publish({ pending }); this.guard(l); }
      this.verify(l); const raw = await transport(this.o, q, command, l.controller.signal); this.guard(l); this.verify(l); const response = this.parse(raw, q, command); this.settle(response, l); this.guard(l);
      this.publish({ result: response, query: q, phase: "ready", message: "已核实此消息已读；不代表同意或其他业务确认。" });
    } catch { this.failed(l); } finally { this.release(l); }
  };
}
