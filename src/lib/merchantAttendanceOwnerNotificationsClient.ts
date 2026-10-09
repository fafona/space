import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { OWNER_NOTIFICATIONS_API, OWNER_NOTIFICATIONS_BYTE_LIMIT, OWNER_NOTIFICATIONS_ERRORS,
  parseOwnerNotificationsQuery, parseOwnerNotificationsBody, parseOwnerNotificationsResponse, parseOwnerNotificationsJson, ownerNotificationsQueryString,
  type OwnerNotificationsQuery, type OwnerNotificationsCommand, type OwnerNotificationsResult } from "./merchantAttendanceOwnerNotifications";

export type OwnerNotificationsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type OwnerNotificationsPending = Readonly<{ version: 1; actorId: string; query: OwnerNotificationsQuery; command: OwnerNotificationsCommand }>;
export type OwnerNotificationsClientOptions = { siteId: string; actorId: string; apiFetch: AttendanceApiFetch; storage: () => OwnerNotificationsStorage;
  enabled: boolean; recoveryOnly?: boolean; isCurrentAuth?: () => boolean; randomId?: () => string; timeoutMs?: number };
export type OwnerNotificationsClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  query: OwnerNotificationsQuery | null; result: OwnerNotificationsResult | null; pending: OwnerNotificationsPending | null; message: string }>;
type Lease = { generation: number; controller: AbortController; deadline: number };
const hidden = () => typeof document !== "undefined" && document.hidden;
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function query(siteId: string, patch: Partial<OwnerNotificationsQuery> = {}) {
  return parseOwnerNotificationsQuery({ siteId, mode: "list", notificationId: null, operationId: null, beforeAt: null, beforeId: null, ...patch });
}
export function ownerNotificationsPendingKey(siteId: string, actorId: string) {
  query(siteId); attendanceSelfUuid(actorId); return `faolla:attendance:owner-notifications:v1:${siteId}:${actorId}`;
}
export function parseOwnerNotificationsPending(raw: string, siteId: string, actorId: string): OwnerNotificationsPending {
  if (new TextEncoder().encode(raw).byteLength > 4096) throw Error("invalid_pending");
  const p = captureBrowserExact(parseOwnerNotificationsJson(raw), ["version", "actorId", "query", "command"]);
  const { query: q, command } = parseOwnerNotificationsBody({ query: p.query, command: p.command });
  if (p.version !== 1 || p.actorId !== actorId || q.siteId !== siteId) throw Error("pending_identity");
  attendanceSelfUuid(actorId); return freeze({ version: 1, actorId, query: q, command });
}

/** No note body is stored, and no unknown write is retried. Every transport,
 * body and storage boundary shares one lease; only an exact receipt clears it. */
export class AttendanceOwnerNotificationsClient {
  readonly storageKey: string;
  private readonly options: OwnerNotificationsClientOptions;
  private state: OwnerNotificationsClientState = freeze({ phase: "idle", query: null, result: null, pending: null, message: "请明确读取负责人收件；不会自动标为已读。" });
  private listeners = new Set<() => void>();
  private generation = 0; private controller: AbortController | null = null; private initialized = false; private raw: string | null = null;
  constructor(options: OwnerNotificationsClientOptions) {
    this.storageKey = ownerNotificationsPendingKey(options.siteId, options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.storage !== "function"
      || options.recoveryOnly !== undefined && typeof options.recoveryOnly !== "boolean"
      || options.isCurrentAuth !== undefined && typeof options.isCurrentAuth !== "function"
      || options.randomId !== undefined && typeof options.randomId !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("invalid_options");
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<OwnerNotificationsClientState>) {
    const next = this.state = freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) { if (this.state !== next) break; try { listener(); } catch { /* Observers grant no authority. */ } }
  }
  pause = () => { const generation = ++this.generation, previous = this.controller; this.controller = null; this.initialized = false; previous?.abort();
    if (generation === this.generation) this.publish({ query: null, result: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "资料已隐藏；原编号保留，请明确只读核对。" }); };
  invalidate = this.pause;
  hasLeaveRisk = () => { if (this.controller || this.state.pending) return true; try { return this.options.storage().getItem(this.storageKey) !== null; } catch { return true; } };
  private begin(): Lease | null {
    if (hidden() || this.options.isCurrentAuth?.() === false) { this.pause(); return null; }
    if (this.controller) return null;
    const lease = { generation: ++this.generation, controller: new AbortController(), deadline: performance.now() + (this.options.timeoutMs ?? 12000) };
    this.controller = lease.controller; return lease;
  }
  private guard(l: Lease) {
    if (l.generation === this.generation && (hidden() || this.options.isCurrentAuth?.() === false)) this.pause();
    if (performance.now() >= l.deadline) l.controller.abort();
    if (this.generation !== l.generation || this.controller !== l.controller || l.controller.signal.aborted) throw Error("stale_scope");
  }
  private release(l: Lease) { if (l.generation === this.generation && this.controller === l.controller) this.controller = null; }
  private stored(l: Lease) { this.guard(l); const storage = this.options.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l); return { storage, raw }; }
  private verify(l: Lease) { const value = this.stored(l); if (value.raw !== this.raw) throw Error("pending_changed"); return value.storage; }
  private failed(l: Lease) {
    if (l.generation !== this.generation) return;
    if (hidden() || this.options.isCurrentAuth?.() === false) { this.pause(); return; }
    this.publish({ result: null, query: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: this.state.pending
      ? "标读结果尚未核实，原编号保留；只读取原回执，不重复提交。查无不等于失败。"
      : "无法核验当前收件权限或本地原编号；未显示消息，请重新核验。" });
  }
  initialize = async () => {
    const l = this.begin(); if (!l) return;
    try { const { raw } = this.stored(l); if (this.state.pending && raw !== this.raw) throw Error("pending_changed");
      const pending = raw === null ? null : parseOwnerNotificationsPending(raw, this.options.siteId, this.options.actorId);
      if (this.stored(l).raw !== raw) throw Error("pending_changed"); this.raw = raw; this.initialized = true;
      this.publish({ pending, result: null, query: null, phase: pending ? "unconfirmed" : "idle", message: pending
        ? "发现待确认标读原编号；请明确只读核对，不会自动重发。" : "请明确读取收件；查看原事项与标为已读是独立操作。" });
    } catch { this.failed(l); } finally { this.release(l); }
  };
  private async request(q: OwnerNotificationsQuery, command: OwnerNotificationsCommand | null, l: Lease) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (e: Error) => void;
    const stopped = new Promise<never>((_, fail) => { reject = fail; });
    const abort = () => { reject(Error("aborted_or_timeout")); void reader?.cancel().catch(() => {}); };
    const timer = setTimeout(() => { l.controller.abort(); abort(); }, Math.max(0, l.deadline - performance.now()));
    l.controller.signal.addEventListener("abort", abort, { once: true });
    const run = async () => {
      this.guard(l); this.verify(l);
      const response = await this.options.apiFetch(OWNER_NOTIFICATIONS_API + (command ? "" : `?${ownerNotificationsQueryString(q)}`), {
        method: command ? "POST" : "GET", headers: { Accept: "application/json", ...(command ? { "Content-Type": "application/json" } : {}) },
        ...(command ? { body: JSON.stringify({ query: q, command }) } : {}), signal: l.controller.signal, cache: "no-store", redirect: "error" });
      if (l.controller.signal.aborted || response.redirected || response.ok && response.status !== 200
        || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") { void response.body?.cancel().catch(() => {}); throw Error("invalid_response"); }
      this.guard(l); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
      const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      try { while (true) { const part = await reader.read(); this.guard(l); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > (response.status === 200 ? OWNER_NOTIFICATIONS_BYTE_LIMIT : 4096)) throw Error("response_too_large");
        text += decoder.decode(part.value, { stream: true }); } text += decoder.decode();
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
      this.guard(l); this.verify(l); const raw = parseOwnerNotificationsJson(text);
      if (response.status !== 200) { const e = captureBrowserExact(raw, ["ok", "error"]);
        if (e.ok !== false || typeof e.error !== "string" || !Object.hasOwn(OWNER_NOTIFICATIONS_ERRORS, e.error) || OWNER_NOTIFICATIONS_ERRORS[e.error] !== response.status) throw Error("invalid_error"); throw Error(e.error); }
      return parseOwnerNotificationsResponse(raw, q, this.options.actorId, command);
    };
    try { return await Promise.race([run(), stopped]); } finally { clearTimeout(timer); l.controller.signal.removeEventListener("abort", abort); }
  }
  private settle(result: OwnerNotificationsResult, l: Lease) {
    const pending = this.state.pending, receipt = result.kind === "receipt" ? result.receipt : null;
    if (!pending || !receipt) return;
    if (receipt.operationId !== pending.command.operationId || receipt.notificationId !== pending.command.notificationId || receipt.actorId !== pending.actorId) throw Error("receipt_mismatch");
    const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
    if (this.stored(l).raw !== null) throw Error("pending_changed"); this.raw = null; this.publish({ pending: null }); this.guard(l);
  }
  private get = async (q: OwnerNotificationsQuery) => {
    const l = this.begin(); if (!l) return;
    try { if (!this.initialized || q.mode !== "recover" && (this.state.pending || !this.options.enabled || this.options.recoveryOnly)) return;
      this.verify(l); this.publish({ phase: "loading", query: null, result: null, message: "正在核验当前权限与原记录…" }); this.guard(l);
      const result = await this.request(q, null, l); this.guard(l); this.verify(l); this.settle(result, l); this.guard(l);
      this.publish({ result, query: q, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending
        ? "尚无匹配回执；原编号保留，不能推断失败。" : result.kind === "receipt"
          ? "已核实标读最小回执；这不恢复收件正文或原事项权限。" : "已读取收件；打开原事项仍须重新核验，未自动标读。" });
    } catch { this.failed(l); } finally { this.release(l); }
  };
  load = async () => { await this.get(query(this.options.siteId)); };
  next = async () => { const result = this.state.result; if (result?.kind === "list" && result.nextCursor) await this.get(query(this.options.siteId, { beforeAt: result.nextCursor.at, beforeId: result.nextCursor.id })); };
  detail = async (notificationId: string) => {
    const result = this.state.result;
    if (result?.kind === "list" && result.items.some(item => item.notificationId === notificationId) || result?.kind === "detail" && result.item.notificationId === notificationId)
      await this.get(query(this.options.siteId, { mode: "detail", notificationId }));
  };
  recover = async () => { const pending = this.state.pending; if (pending) await this.get(query(this.options.siteId, { mode: "recover", notificationId: pending.command.notificationId, operationId: pending.command.operationId })); };
  markRead = async () => {
    const snapshot = this.state, result = snapshot.result, q = snapshot.query;
    if (!this.initialized || !this.options.enabled || this.options.recoveryOnly || snapshot.pending || snapshot.phase !== "ready" || !q || q.mode !== "detail" || result?.kind !== "detail" || !result.canMarkRead) return;
    const l = this.begin(); if (!l) return;
    try { this.verify(l);
      const { command } = parseOwnerNotificationsBody({ query: q, command: { action: "mark_read", operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(), notificationId: result.item.notificationId } });
      this.guard(l); const pending: OwnerNotificationsPending = freeze({ version: 1, actorId: this.options.actorId, query: q, command }), raw = JSON.stringify(pending);
      parseOwnerNotificationsPending(raw, this.options.siteId, this.options.actorId);
      this.publish({ phase: "saving", query: null, result: null, message: "正在固定本次标读意图…" }); this.guard(l);
      const storage = this.verify(l); storage.setItem(this.storageKey, raw); this.guard(l);
      if (this.stored(l).raw !== raw) throw Error("pending_changed"); this.raw = raw;
      this.publish({ pending, message: "原编号已保存，只提交一次标读；未知结果仅只读恢复。" }); this.guard(l); this.verify(l);
      const saved = await this.request(q, command, l); this.guard(l); this.verify(l); this.settle(saved, l); this.guard(l);
      this.publish({ result: saved, query: q, phase: "ready", message: "已核实标读回执。已读不是处理、同意或周期确认。" });
    } catch { this.failed(l); } finally { this.release(l); }
  };
}
