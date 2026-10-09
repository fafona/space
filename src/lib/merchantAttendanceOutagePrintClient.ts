import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { OutagePrintDelivery } from "./merchantAttendanceOutagePrintBrowser";
import { buildOutageBlankPrintDocument, buildOutageHandoffPrintDocument } from "./merchantAttendanceOutagePrintDocument";
import { OUTAGE_APIS, OUTAGE_HTTP_ERRORS, OUTAGE_HTTP_RESPONSE_LIMIT, outageHttpQueryString, parseOutageHttpResponse,
  type OutageHttpQueryMap, type OutageHttpResultMap } from "./merchantAttendanceOutageHttp";
import { exact, site, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";

export type OutagePrintClientOptions = {
  siteId: string; actorId: string; access: "owner" | "self"; declarationId: string | null;
  apiFetch: AttendanceApiFetch; available: () => boolean; deliver: (input: OutagePrintDelivery) => Promise<void>;
  now?: () => number; timeoutMs?: number;
};
export type OutagePrintClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "blocked"; message: string }>;
type Lease = { generation: number; controller: AbortController; last: number; deadline: number; deliveryInvoked: boolean; timer?: ReturnType<typeof setTimeout> };
class ReadRejected extends Error {}
const EXPIRED = "outage_print_expired", UNAVAILABLE = "outage_print_unavailable";
const UNCERTAIN_MESSAGE = "浏览器打印结果不确定；请先核对是否已出纸或另存，不会自动重印。取消只能清除临时打印页面，不能收回已打印或另存的资料。";
const hidden = () => typeof document !== "undefined" && document.hidden;

/** An explicit, read-only, short-lived print action. This does not prove that
 * paper was produced, and the two authorized GETs are not an atomic snapshot.
 * The host must invalidate synchronously on Auth/scope/requester/lifetime or
 * visibility changes; available must check that same live scope. No storage,
 * automatic retry, pending discovery or previously displayed DTO is consumed. */
export class AttendanceOutagePrintClient {
  private readonly options: Readonly<OutagePrintClientOptions>;
  private state: OutagePrintClientState = Object.freeze({ phase: "idle", message: "请明确确认后生成打印资料；不会修改考勤记录。" });
  private listeners = new Set<() => void>();
  private generation = 0;
  private lease: Lease | null = null;
  constructor(options: OutagePrintClientOptions) {
    site(options.siteId); uuid(options.actorId);
    if (!["owner", "self"].includes(options.access) || typeof options.apiFetch !== "function"
      || typeof options.available !== "function" || typeof options.deliver !== "function"
      || options.now !== undefined && typeof options.now !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("invalid_options");
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(phase: OutagePrintClientState["phase"], message: string) {
    const current = this.state = Object.freeze({ phase, message });
    for (const fn of [...this.listeners]) { if (current !== this.state) break; try { fn(); } catch { /* Observers cannot authorize printing. */ } }
  }
  private owns(l: Lease) { return this.lease === l && this.generation === l.generation; }
  private cancel() {
    const l = this.lease; this.lease = null; const generation = ++this.generation;
    if (l) { clearTimeout(l.timer); l.controller.abort(); }
    return generation;
  }
  invalidate = () => {
    const delivered = this.lease?.deliveryInvoked === true, g = this.cancel();
    if (g === this.generation) this.publish("idle", delivered ? UNCERTAIN_MESSAGE : "打印资料已取消并清除；不会自动重新读取或打印。");
  };
  private clock() { return this.options.now ? this.options.now() : performance.now(); }
  private check(l: Lease) {
    if (!this.owns(l) || l.controller.signal.aborted) throw Error(EXPIRED);
    let available = false;
    try { available = !hidden() && this.options.available() === true; } catch { /* Fail closed. */ }
    if (!this.owns(l) || l.controller.signal.aborted) throw Error(EXPIRED);
    if (!available) { l.controller.abort(); throw Error(UNAVAILABLE); }
    const now = this.clock();
    if (!this.owns(l) || l.controller.signal.aborted) throw Error(EXPIRED);
    if (!Number.isFinite(now) || now < l.last || now >= l.deadline) { l.controller.abort(); throw Error(EXPIRED); }
    l.last = now;
    return l.deadline - now;
  }
  private authorized(l: Lease) { try { this.check(l); return true; } catch { return false; } }
  private async race<T>(l: Lease, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    let stop!: () => void;
    const aborted = new Promise<never>((_, reject) => { stop = () => reject(Error(EXPIRED)); signal.addEventListener("abort", stop, { once: true }); });
    try {
      this.check(l); if (signal.aborted) throw Error(EXPIRED);
      const result = await Promise.race([Promise.resolve().then(() => { this.check(l); if (signal.aborted) throw Error(EXPIRED); return work(); }), aborted]);
      this.check(l); if (signal.aborted) throw Error(EXPIRED); return result;
    } finally { signal.removeEventListener("abort", stop); }
  }
  // Deliberately independent of attendanceManagementRequest: that helper's
  // moduleEnabled envelope is not the exact outage HTTP contract.
  private async read<K extends "outages" | "reviews">(l: Lease, kind: K, query: OutageHttpQueryMap[K]): Promise<OutageHttpResultMap[K]> {
    const request = new AbortController(), abort = () => request.abort();
    const timeout = Math.min(this.options.timeoutMs ?? 12000, this.check(l));
    const timer = setTimeout(abort, timeout);
    l.controller.signal.addEventListener("abort", abort, { once: true });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    request.signal.addEventListener("abort", cancel, { once: true });
    const valid = () => { this.check(l); if (request.signal.aborted) throw Error(EXPIRED); };
    const work = async () => {
      valid();
      const response = await this.options.apiFetch(OUTAGE_APIS[kind] + "?" + outageHttpQueryString(kind, query), {
        method: "GET", headers: { Accept: "application/json" }, signal: request.signal, cache: "no-store", redirect: "error",
      });
      try {
        valid();
        if (response.redirected || response.status >= 200 && response.status < 300 && response.status !== 200
          || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Error(UNAVAILABLE);
        valid();
      } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      reader = response.body?.getReader(); if (!reader) throw Error(UNAVAILABLE);
      const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      while (true) {
        const part = await reader.read(); valid(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > (response.status === 200 ? OUTAGE_HTTP_RESPONSE_LIMIT : 4096)) throw Error(UNAVAILABLE);
        text += decoder.decode(part.value, { stream: true });
      }
      const raw = parseCaptureBrowserJson(text + decoder.decode()); valid();
      if (response.status !== 200) {
        const error = exact(raw, ["ok", "error"]);
        if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(OUTAGE_HTTP_ERRORS, error.error)
          || OUTAGE_HTTP_ERRORS[error.error] !== response.status) throw Error(UNAVAILABLE);
        throw new ReadRejected(error.error);
      }
      const parsed = parseOutageHttpResponse(kind, raw, query, this.options.actorId, null); valid();
      return parsed.result;
    };
    try { return await this.race(l, request.signal, work); }
    finally {
      clearTimeout(timer); l.controller.signal.removeEventListener("abort", abort);
      request.signal.removeEventListener("abort", cancel); request.abort(); cancel();
      try { reader?.releaseLock(); } catch { /* A cancelled reader may still have a pending read. */ }
    }
  }
  print = async (kind: "blank" | "handoff", ack: boolean): Promise<void> => {
    if (this.state.phase === "loading") return;
    const generation = this.cancel(); if (generation !== this.generation) return;
    let l: Lease | null = null;
    try {
      if (ack !== true) { this.publish("blocked", "请先明确确认打印用途与纸面资料保管责任。"); return; }
      if (kind !== "blank" && kind !== "handoff") throw Error(UNAVAILABLE);
      if (kind === "handoff") { if (this.options.access !== "owner") throw Error(UNAVAILABLE); uuid(this.options.declarationId); }
      const now = this.clock();
      if (generation !== this.generation) return;
      if (!Number.isFinite(now)) throw Error(EXPIRED);
      l = { generation, controller: new AbortController(), last: now, deadline: now + 30000, deliveryInvoked: false };
      if (!Number.isFinite(l.deadline)) throw Error(EXPIRED);
      this.lease = l;
      const active = l;
      l.timer = setTimeout(() => {
        if (!this.owns(active)) return;
        active.controller.abort();
        if (this.owns(active)) this.publish("blocked", active.deliveryInvoked ? UNCERTAIN_MESSAGE
          : "打印资料的30秒有效窗口已结束；如仍需要，请明确重新读取。");
      }, 30000);
      this.check(l); this.publish("loading", kind === "blank" ? "正在生成无个人资料的空白备用表…" : "正在重新核验单条声明与当前恢复结果…"); this.check(l);
      let html: string;
      if (kind === "blank") { html = buildOutageBlankPrintDocument(); }
      else {
        const declarationId = uuid(this.options.declarationId);
        const declaration = await this.read(l, "outages", { siteId: this.options.siteId, access: "owner", mode: "declaration", declarationId });
        this.check(l);
        const review = await this.read(l, "reviews", { siteId: this.options.siteId, access: "owner", mode: "detail", declarationId });
        this.check(l); html = buildOutageHandoffPrintDocument(declaration, review);
      }
      this.check(l);
      await this.race(l, l.controller.signal, () => {
        active.deliveryInvoked = true;
        return this.options.deliver({ kind, html, signal: active.controller.signal,
          authorized: () => this.authorized(active), remainingMs: () => this.check(active) });
      });
      this.check(l);
      this.publish("ready", "已请求浏览器打印；系统不能确认是否出纸或另存。临时打印页面将在本次30秒窗口结束时清除；已打印或另存的资料无法收回，不会自动重印。");
      // Keep this SAME deadline/signal alive after delivery: the browser may
      // retain an iframe until afterprint. Never renew the 30-second lease.
    } catch (error) {
      if (generation !== this.generation) return;
      if (l) { clearTimeout(l.timer); l.controller.abort(); }
      if (generation !== this.generation) return;
      const code = error instanceof Error ? error.message : "";
      // Our abort race may settle before the browser adapter's uncertain error.
      // Once delivery began, cancellation/expiry cannot prove it did not print.
      this.publish("blocked", l?.deliveryInvoked || code === "outage_print_uncertain" ? UNCERTAIN_MESSAGE
        : code === EXPIRED ? "打印资料已取消或超时；如仍需要，请明确重新读取。"
          : error instanceof ReadRejected ? "当前身份、权限或服务状态无法完成重新核验；未生成交接打印，请稍后明确重试。"
            : "无法核对当前打印范围或资料；未交付打印，不会自动重试。");
    }
  };
}
