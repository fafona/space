import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { SourcesResponse } from "./merchantAttendanceSources";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parseShiftCheckQuery, parseShiftCheckResponse, shiftCheckQueryString, SHIFT_CHECK_ERRORS, SHIFT_CHECK_BYTE_LIMIT, type ShiftCheckResponse } from "./merchantAttendanceShiftCheck";

export type ShiftCheckClientOptions = { source: SourcesResponse; ownerId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number };
export type ShiftCheckClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "blocked"; result: ShiftCheckResponse | null; message: string }>;
export type ShiftCheckAnchor = Readonly<{ startEventId: string; original: Readonly<{ startAt: string; endAt: string | null; timeZone: string }>;
  selected: Readonly<{ startAt: string; endAt: string | null; timeZone: string }>; corrected: boolean; correctionOperationId: string | null }>;
type Lease = { generation: number; controller: AbortController };
const endpoint = "/api/merchant-enterprise/attendance/shift-check";
const hidden = () => typeof document !== "undefined" && document.hidden;
const invalid = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function frozen<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(frozen); Object.freeze(v); } return v; }
function instant(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(v) || v.startsWith("0000-")) return invalid();
  const ms = v.slice(0, 23) + "Z", n = Date.parse(ms); if (!Number.isFinite(n) || new Date(n).toISOString() !== ms) return invalid();
  return v.length === 24 ? v.slice(0, -1) + "000Z" : v;
}
function zone(v: unknown): string { if (typeof v !== "string" || !v || v.length > 100 || v !== v.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return invalid(); return v; }
function message(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "attendance_shift_rule_binding_identity_changed" || code === "attendance_access_denied") return "负责人或员工身份已变化；旧核查已隐藏，请重新读取员工资料。";
  if (code === "attendance_shift_rule_binding_not_found") return "此原始开班事件目前不可读取；没有使用补正或漏卡记录替代。";
  if (code === "attendance_not_available") return "独立班次核查尚未开放；未读取或补算当前规则。";
  if (code === "attendance_rate_limited") return "读取过于频繁，请稍后明确重查；不会自动请求。";
  if (code === "attendance_invalid_request") return "请选择本次资料里的原始班次；没有发起其它员工或漏卡记录的读取。";
  return "无法可靠核对完整班次，旧内容已隐藏；请明确重查，不会自动请求。";
}

async function request(apiFetch: AttendanceApiFetch, url: string, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController(), started = performance.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (e: Error) => void = () => {};
  const cancel = (code: string) => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error(code)); };
  const abort = () => cancel("aborted"), deadline = new Promise<never>((_, reject) => { rejectCancel = reject; });
  const timer = setTimeout(() => cancel("timeout"), timeoutMs); signal.addEventListener("abort", abort, { once: true });
  const current = () => { if (signal.aborted || controller.signal.aborted) throw Error("aborted"); if (performance.now() - started >= timeoutMs) throw Error("timeout"); };
  const run = async () => {
    current(); const response = await apiFetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: controller.signal });
    if (signal.aborted || controller.signal.aborted || response.redirected || response.ok && response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
    }
    current(); reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try {
      while (true) {
        const { done, value } = await reader.read(); current(); if (done) break;
        bytes += value.byteLength; if (bytes > (response.status === 200 ? SHIFT_CHECK_BYTE_LIMIT : 4096)) throw Error("oversized_response");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    current(); const body = parseCaptureBrowserJson(text); current();
    if (response.status !== 200) {
      const error = captureBrowserExact(body, ["ok", "error"]);
      if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(SHIFT_CHECK_ERRORS, error.error)
        || SHIFT_CHECK_ERRORS[error.error] !== response.status) throw Error("invalid_error_envelope");
      throw Error(error.error);
    }
    return body;
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

// Retain only detached original-event anchors, not a mutable source reference or
// a browser archive. This client never fetches on construction, polls or writes.
export class AttendanceShiftCheckClient {
  readonly anchors: readonly ShiftCheckAnchor[];
  private readonly scope: Readonly<{ siteId: string; workerId: string; ownerId: string; employeeId: string | null; apiFetch: AttendanceApiFetch; timeoutMs: number }>;
  private state: ShiftCheckClientState = frozen({ phase: "idle", result: null, message: "请选择原始班次，再明确读取班次核查。" });
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(input: ShiftCheckClientOptions) {
    const options = { ...input }, source = options.source, base = source.attendance.base, timeoutMs = options.timeoutMs ?? 12000;
    if (typeof options.apiFetch !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000) invalid();
    const siteId = attendanceSelfSite(source.siteId), workerId = attendanceSelfUuid(source.worker.workerId), ownerId = attendanceSelfUuid(options.ownerId);
    if (source.protocol !== "sources-v1" || source.actorId !== ownerId || source.attendance.access !== "owner" || base.siteId !== siteId || base.workerId !== workerId
      || !("employeeId" in base) || base.employeeId !== source.worker.employeeId || !Array.isArray(base.rows) || base.rows.length > 100) invalid();
    const employeeId = source.worker.employeeId === null ? null : attendanceSelfUuid(source.worker.employeeId), ids = new Set<string>();
    this.anchors = frozen(source.attendance.base.rows.map(row => {
      const startEventId = attendanceSelfUuid(row.startEventId); if (ids.has(startEventId)) invalid(); ids.add(startEventId);
      const span = (value: typeof row.original) => ({ startAt: instant(value.startAt), endAt: value.endAt === null ? null : instant(value.endAt), timeZone: zone(value.timeZone) });
      return { startEventId, original: span(row.original), selected: span(row.selected), corrected: row.correction !== null,
        correctionOperationId: row.correction === null ? null : attendanceSelfUuid(row.correction.operationId) };
    }));
    this.scope = Object.freeze({ siteId, workerId, ownerId, employeeId, apiFetch: options.apiFetch, timeoutMs });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: ShiftCheckClientState) {
    const snapshot = this.state = frozen(state);
    for (const listener of [...this.listeners]) { if (this.state !== snapshot) break; try { listener(); } catch { /* Observers cannot bypass lease validation. */ } }
  }
  invalidate = (text = "选择或资料已改变，旧核查已隐藏；请明确重新读取。") => {
    const generation = ++this.generation, previous = this.controller; this.controller = null; previous?.abort();
    if (generation === this.generation) this.publish({ phase: "idle", result: null, message: typeof text === "string" ? text : "旧核查已隐藏。" });
  };
  pause = () => this.invalidate("核查已隐藏；返回后不会自动读取。");
  private current(lease: Lease) {
    if (lease.generation === this.generation && hidden()) this.pause();
    return lease.generation === this.generation && this.controller === lease.controller && !lease.controller.signal.aborted;
  }
  read = async (startEventId: string) => {
    if (hidden()) { this.pause(); return; }
    const lease = { generation: ++this.generation, controller: new AbortController() }, previous = this.controller;
    this.controller = lease.controller; previous?.abort(); if (!this.current(lease)) return;
    try {
      const anchor = this.anchors.find(row => row.startEventId === startEventId) ?? invalid();
      if (this.scope.employeeId === null) throw Error("attendance_shift_rule_binding_identity_changed");
      const query = parseShiftCheckQuery({ siteId: this.scope.siteId, workerId: this.scope.workerId, startEventId });
      this.publish({ phase: "loading", result: null, message: "正在由服务器同次读取完整班次、原依据及最新核定…" });
      if (!this.current(lease)) return;
      const started = performance.now();
      const raw = await request(this.scope.apiFetch, `${endpoint}?${shiftCheckQueryString(query)}`, lease.controller.signal, this.scope.timeoutMs);
      if (!this.current(lease)) return;
      const result = parseShiftCheckResponse(raw, query, this.scope.ownerId);
      if (result.rule.worker.employeeId !== this.scope.employeeId || result.rule.event.employeeId !== this.scope.employeeId
        || result.rule.event.occurredAt !== anchor.original.startAt || result.rule.event.timeZone !== anchor.original.timeZone) throw Error("anchor_mismatch");
      if (performance.now() - started >= this.scope.timeoutMs) throw Error("timeout");
      if (!this.current(lease)) return;
      this.publish({ phase: "ready", result, message: "班次独立核查已读取；仅作两类参考提示，不作迟到、早退或工资判定。" });
    } catch (error) { if (this.current(lease)) this.publish({ phase: "blocked", result: null, message: message(error) }); }
    finally { if (lease.generation === this.generation && this.controller === lease.controller) this.controller = null; }
  };
}

