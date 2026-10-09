import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseRuleSourcesQuery, parseRuleSourcesResponse, ruleSourcesQueryString, RULE_SOURCES_ERRORS, type RuleSourcesResponse } from "./merchantAttendanceRuleSources";

export type RuleSourcesClientOptions = { siteId: string; ownerId: string; workerId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number };
export type RuleSourcesClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "blocked"; result: RuleSourcesResponse | null; message: string }>;
type Lease = { generation: number; controller: AbortController };
const endpoint = "/api/merchant-enterprise/attendance/rule-sources";
const hidden = () => typeof document !== "undefined" && document.hidden;
const edited = "条件已改变，旧规则来源已隐藏；请明确重新读取。";
const paused = "规则来源已隐藏；返回后请明确重新读取，不会自动请求。";
class Rejected extends Error {}
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function failureMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "attendance_invalid_request") return "请选择有效起止日期，每次最多 7 个企业当地日期；没有发起写入。";
  if (code === "attendance_access_denied" || code === "attendance_personal_rule_identity_changed") return "当前负责人或员工双重身份已变化，旧规则来源已隐藏；请重新核对身份。";
  if (code === "attendance_rule_sources_too_large") return "本次规则来源超过安全读取上限；请缩短日期后明确重查，不展示截断资料。";
  if (code === "attendance_settings_required") return "请先核对企业考勤设置；旧规则来源已隐藏。";
  if (code === "attendance_not_available") return "三层候选规则预览尚未开放；旧资料已隐藏。";
  if (code === "attendance_rate_limited") return "读取过于频繁，请稍后明确重查；不会自动请求。";
  return "无法可靠读取规则来源，旧内容已隐藏；请稍后明确重查，没有执行任何写入。";
}

// A separate GET-only transport. The same deadline covers both response headers
// and all body chunks, even when an injected fetch ignores AbortSignal.
async function requestJson(apiFetch: AttendanceApiFetch, url: string, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (error: Error) => void = () => {};
  const cancel = (code: string) => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error(code)); };
  const abort = () => cancel("aborted");
  const deadline = new Promise<never>((_, reject) => { rejectCancel = reject; });
  const timer = setTimeout(() => cancel("timeout"), timeoutMs);
  signal.addEventListener("abort", abort, { once: true });
  const run = async () => {
    if (signal.aborted) throw Error("aborted");
    const response = await apiFetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: controller.signal });
    if (controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
    }
    reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw Error("aborted");
        if (done) break;
        bytes += value.byteLength;
        if (bytes > (response.status === 200 ? 1049600 : 4096)) throw Error("oversized_response");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("invalid_response");
    if (response.status !== 200) {
      const error = body as Record<string, unknown>;
      if (Object.keys(error).sort().join() === "error,ok" && error.ok === false && typeof error.error === "string"
        && Object.hasOwn(RULE_SOURCES_ERRORS, error.error) && RULE_SOURCES_ERRORS[error.error] === response.status) throw new Rejected(error.error);
      throw Error("invalid_error_envelope");
    }
    return body;
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

export class AttendanceRuleSourcesClient {
  private state: RuleSourcesClientState = frozen({ phase: "idle", result: null, message: "请选择最多 7 个企业当地日期，再明确读取三层候选规则。" });
  private readonly options: Readonly<Required<RuleSourcesClientOptions>>;
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(options: RuleSourcesClientOptions) {
    const copied = { ...options }, timeoutMs = copied.timeoutMs ?? 12000;
    if (typeof copied.apiFetch !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000) throw new MerchantAttendanceError("attendance_invalid_request");
    this.options = Object.freeze({ siteId: attendanceSelfSite(copied.siteId), ownerId: attendanceSelfUuid(copied.ownerId),
      workerId: attendanceSelfUuid(copied.workerId), apiFetch: copied.apiFetch, timeoutMs });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: RuleSourcesClientState) {
    if (this.state.phase === state.phase && this.state.result === state.result && this.state.message === state.message) return;
    const snapshot = this.state = frozen(state);
    for (const listener of [...this.listeners]) {
      if (this.state !== snapshot) break;
      try { listener(); } catch { /* An observer cannot invalidate the transport's safety checks. */ }
    }
  }
  invalidate = (text = edited) => {
    const generation = ++this.generation, previous = this.controller; this.controller = null;
    previous?.abort();
    // Aborting an injected transport can synchronously start a newer read.
    if (generation !== this.generation) return;
    this.publish({ phase: "idle", result: null, message: typeof text === "string" ? text : edited });
  };
  pause = () => this.invalidate(paused);
  private current(lease: Lease) {
    if (lease.generation === this.generation && hidden()) this.pause();
    return lease.generation === this.generation && this.controller === lease.controller && !lease.controller.signal.aborted;
  }
  read = async (fromDate: string, throughDate: string) => {
    if (hidden()) { this.pause(); return; }
    const lease = { generation: ++this.generation, controller: new AbortController() }, previous = this.controller;
    this.controller = lease.controller; previous?.abort();
    if (!this.current(lease)) return;
    try {
      const query = parseRuleSourcesQuery({ siteId: this.options.siteId, workerId: this.options.workerId, fromDate, throughDate });
      if (!this.current(lease)) return;
      this.publish({ phase: "loading", result: null, message: "正在核验当前负责人和员工身份，并读取限定范围候选规则来源…" });
      if (!this.current(lease)) return;
      const raw = await requestJson(this.options.apiFetch, `${endpoint}?${ruleSourcesQueryString(query)}`, lease.controller.signal, this.options.timeoutMs);
      if (!this.current(lease)) return;
      const result = parseRuleSourcesResponse(raw, query, this.options.ownerId);
      if (!this.current(lease)) return;
      this.publish({ phase: "ready", result, message: "三层候选来源已读取；未应用到考勤，不是历史固定依据或正式异常判定。" });
      if (!this.current(lease)) return;
    } catch (error) {
      if (this.current(lease)) this.publish({ phase: "blocked", result: null, message: failureMessage(error) });
    } finally { if (lease.generation === this.generation && this.controller === lease.controller) this.controller = null; }
  };
}
