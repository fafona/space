import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite } from "./merchantAttendanceSelf";
import { parseRuleCaptureHistoryQuery, parseRuleCaptureHistoryResponse, ruleCaptureHistoryQueryString, RULE_CAPTURE_HISTORY_ERRORS,
  type RuleCaptureHistoryQuery, type RuleCaptureHistoryItem, type RuleCaptureHistoryResponse } from "./merchantAttendanceRuleCaptureHistory";
import { CAPTURE_BROWSER_ERRORS, captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson, parseCompactRuleCaptureResponse,
  sameCaptureBrowserCommand, type CompactRuleCaptureResponse } from "./merchantAttendanceRuleCapturesBrowser";

export type RuleCaptureHistoryClientOptions = { siteId: string; ownerId: string; workerId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number };
export type RuleCaptureHistoryClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "blocked";
  result: RuleCaptureHistoryResponse | null; detail: CompactRuleCaptureResponse | null; message: string }>;
type Lease = { generation: number; controller: AbortController };
const endpoint = "/api/merchant-enterprise/attendance/rule-capture-history", detailEndpoint = "/api/merchant-enterprise/attendance/rule-captures";
const hidden = () => typeof document !== "undefined" && document.hidden;
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
class Rejected extends Error {}
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "attendance_access_denied" || code.includes("identity_changed")) return "当前负责人或员工双身份已变化，旧历史和详情已隐藏；请重新核对身份。";
  if (code === "attendance_not_available") return "候选留存历史尚未开放；没有执行任何写入。";
  if (code === "attendance_rate_limited") return "读取过于频繁，请稍后明确重读；不会自动请求。";
  return "无法可靠核验留存历史或原收据，旧资料已隐藏；请明确重读，没有执行任何写入。";
}

// One total deadline covers headers, fatal-UTF8 bytes, decoding and detail SHA.
// Even transports or digest implementations which ignore abort cannot publish late.
async function read<T>(apiFetch: AttendanceApiFetch, url: string, signal: AbortSignal, timeoutMs: number, limit: number,
  errors: Readonly<Record<string, number>>, decode: (raw: unknown) => T | Promise<T>): Promise<T> {
  const controller = new AbortController(), until = performance.now() + timeoutMs;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (error: Error) => void = () => {};
  const cancel = (code: string) => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error(code)); };
  const abort = () => cancel("aborted"), deadline = new Promise<never>((_, reject) => { rejectCancel = reject; });
  const timer = setTimeout(() => cancel("timeout"), timeoutMs); signal.addEventListener("abort", abort, { once: true });
  const check = () => { if (signal.aborted || controller.signal.aborted) throw Error("aborted"); if (performance.now() >= until) throw Error("timeout"); };
  const run = async () => {
    check();
    const response = await apiFetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: controller.signal });
    if (signal.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
    }
    check(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const utf8 = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try {
      while (true) {
        const { done, value } = await reader.read(); check(); if (done) break;
        bytes += value.byteLength; if (bytes > (response.status === 200 ? limit : 4096)) throw Error("oversized_response");
        text += utf8.decode(value, { stream: true });
      }
      text += utf8.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    const raw = parseCaptureBrowserJson(text); check();
    if (response.status !== 200) {
      const error = captureBrowserExact(raw, ["ok", "error"]);
      if (error.ok === false && typeof error.error === "string" && Object.hasOwn(errors, error.error) && errors[error.error] === response.status) throw new Rejected(error.error);
      throw Error("invalid_error_envelope");
    }
    const result = await decode(raw); check(); return result;
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

// History is metadata, not proof of source integrity. Only an explicitly fetched,
// SHA-verified original receipt may become detail, and every row field must match.
export function matchRuleCaptureHistoryDetail(item: RuleCaptureHistoryItem, detail: CompactRuleCaptureResponse): boolean {
  const receipt = detail.receipt;
  if (!receipt || !sameCaptureBrowserCommand(item.command, receipt.command)) return false;
  return (["operationId", "sourceId", "actorId", "observedAt", "recordedAt", "sourceReadAt", "sourceSha256", "sourceBytes", "applied", "historicalApplicationProven"] as const)
    .every(key => item[key] === receipt[key]);
}

export class AttendanceRuleCaptureHistoryClient {
  private state: RuleCaptureHistoryClientState = freeze({ phase: "idle", result: null, detail: null, message: "请明确读取历史首页；不会自动读取列表或原收据。" });
  private readonly options: Readonly<Required<RuleCaptureHistoryClientOptions>>;
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(options: RuleCaptureHistoryClientOptions) {
    const copied = { ...options }, timeoutMs = copied.timeoutMs === undefined ? 12000 : copied.timeoutMs;
    if (typeof copied.apiFetch !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000) throw Error("invalid_options");
    this.options = Object.freeze({ siteId: attendanceSelfSite(copied.siteId), ownerId: captureBrowserUuid(copied.ownerId), workerId: captureBrowserUuid(copied.workerId), apiFetch: copied.apiFetch, timeoutMs });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: RuleCaptureHistoryClientState) {
    if (Object.keys(next).every(key => next[key as keyof RuleCaptureHistoryClientState] === this.state[key as keyof RuleCaptureHistoryClientState])) return;
    const snapshot = this.state = freeze(next);
    for (const listener of [...this.listeners]) { if (this.state !== snapshot) break; try { listener(); } catch { /* No observer controls authorization or continuation. */ } }
  }
  invalidate = (message = "读取条件已变化，旧历史和原收据已隐藏；请明确重读。") => {
    const generation = ++this.generation, previous = this.controller; this.controller = null; previous?.abort();
    if (generation !== this.generation) return;
    this.publish({ phase: "idle", result: null, detail: null, message: typeof message === "string" ? message : "旧资料已隐藏。" });
  };
  pause = () => this.invalidate("历史和原收据已隐藏；返回后需明确读取，不会自动请求。");
  private current(lease: Lease) {
    if (lease.generation === this.generation && hidden()) this.pause();
    return lease.generation === this.generation && this.controller === lease.controller && !lease.controller.signal.aborted;
  }
  private begin(): Lease | null {
    if (hidden()) { this.pause(); return null; }
    const lease = { generation: ++this.generation, controller: new AbortController() }, previous = this.controller;
    this.controller = lease.controller; previous?.abort(); return this.current(lease) ? lease : null;
  }
  private release(lease: Lease) { if (lease.generation === this.generation && this.controller === lease.controller) this.controller = null; }
  private async page(query: RuleCaptureHistoryQuery) {
    const lease = this.begin(); if (!lease) return;
    try {
      const checked = parseRuleCaptureHistoryQuery(query); if (!this.current(lease)) return;
      this.publish({ phase: "loading", result: null, detail: null, message: "正在核验当前负责人和员工身份，并读取一页留存元数据…" }); if (!this.current(lease)) return;
      const result = await read(this.options.apiFetch, `${endpoint}?${ruleCaptureHistoryQueryString(checked)}`, lease.controller.signal, this.options.timeoutMs, 65536 + 1024,
        RULE_CAPTURE_HISTORY_ERRORS, raw => parseRuleCaptureHistoryResponse(raw, checked, this.options.ownerId));
      if (!this.current(lease)) return;
      this.publish({ phase: "ready", result, detail: null, message: "本页留存元数据已读取；原收据必须逐条明确读取并核验，候选仍未应用。" });
    } catch (error) { if (this.current(lease)) this.publish({ phase: "blocked", result: null, detail: null, message: failure(error) }); }
    finally { this.release(lease); }
  }
  firstread = async () => this.page({ siteId: this.options.siteId, workerId: this.options.workerId, asOf: null, beforeAt: null, beforeId: null, expectedEmployeeId: null, expectedEmployeeAuthUserId: null });
  next = async () => {
    const current = this.state.result;
    if (this.state.phase !== "ready" || !current?.nextCursor) return;
    await this.page({ siteId: this.options.siteId, workerId: this.options.workerId, ...current.nextCursor });
  };
  select = async (operationId: string) => {
    const page = this.state.result, item = page?.items.find(entry => entry.operationId === operationId);
    if (this.state.phase !== "ready") return;
    const lease = this.begin(); if (!lease) return;
    try {
      if (!page || !item || captureBrowserUuid(operationId) !== operationId) throw Error("not_on_current_page");
      this.publish({ phase: "loading", result: page, detail: null, message: "正在按本页原编号读取收据并核验来源摘要…" }); if (!this.current(lease)) return;
      const query = { siteId: this.options.siteId, workerId: this.options.workerId, operationId };
      const detail = await read(this.options.apiFetch, `${detailEndpoint}?${new URLSearchParams(query)}`, lease.controller.signal, this.options.timeoutMs, 6 * 1048576 + 65536,
        CAPTURE_BROWSER_ERRORS, async raw => {
          const decoded = await parseCompactRuleCaptureResponse(raw, query, this.options.ownerId, item.command);
          if (!matchRuleCaptureHistoryDetail(item, decoded)) throw Error("history_receipt_mismatch"); return decoded;
        });
      if (!this.current(lease)) return;
      this.publish({ phase: "ready", result: page, detail, message: "本页原收据及来源摘要已核验，所有留存元数据一致；仍不证明规则已应用。" });
    } catch (error) { if (this.current(lease)) this.publish({ phase: "blocked", result: null, detail: null, message: failure(error) }); }
    finally { this.release(lease); }
  };
}
