import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import type { SourcesResponse } from "./merchantAttendanceSources";
import type { ScheduleEntry } from "./merchantAttendanceSchedule";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parsePlanCoverageQuery, parsePlanCoverageResponse, planCoverageQueryString, PLAN_COVERAGE_ERRORS, PLAN_COVERAGE_BYTE_LIMIT, type PlanCoverageResponse } from "./merchantAttendancePlanCoverage";

export type PlanCoverageClientOptions = { source: SourcesResponse; ownerId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number };
export type PlanCoverageClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "blocked"; result: PlanCoverageResponse | null; message: string }>;
export type PlanCoverageAnchor = Readonly<Pick<ScheduleEntry, "id" | "revision" | "locationId" | "locationName" | "timeZone" | "workDate" | "startAt" | "endAt" | "cancelled">>;
type Lease = { generation: number; controller: AbortController };
const endpoint = "/api/merchant-enterprise/attendance/plan-coverage";
const hidden = () => typeof document !== "undefined" && document.hidden;
const invalid = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function frozen<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(frozen); Object.freeze(v); } return v; }
function instant(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(v)) return invalid();
  const ms = v.slice(0, 23) + "Z", n = Date.parse(ms);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== ms || v.length === 27 && !v.endsWith("000Z")) return invalid();
  return ms;
}
function label(v: unknown, max: number): string {
  return typeof v === "string" && !!v && v === v.trim() && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : invalid();
}
function message(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (["attendance_shift_rule_binding_identity_changed", "attendance_access_denied"].includes(code)) return "负责人或员工身份已变化；旧核对已隐藏，请重新读取员工资料。";
  if (code === "attendance_plan_coverage_not_found") return "此排班目前不可读取；没有改用相邻排班或按姓名配对。";
  if (code === "attendance_not_available") return "计划关联核对尚未开放；没有读取或修改已有排班。";
  if (code === "attendance_rate_limited") return "读取过于频繁，请稍后明确重查；不会自动请求。";
  if (["attendance_plan_coverage_too_large", "attendance_shift_check_too_large"].includes(code)) return "关联资料超出单次安全上限，未计算部分覆盖；请交负责人核对原记录。";
  if (code === "attendance_invalid_request") return "请选择本次资料里的排班；没有读取其它员工或未知排班。";
  return "无法可靠核对完整关联集合，旧内容已隐藏；请明确重查，不会自动请求。";
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
        bytes += value.byteLength; if (bytes > (response.status === 200 ? PLAN_COVERAGE_BYTE_LIMIT : 4096)) throw Error("oversized_response");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    current(); const body = parseCaptureBrowserJson(text); current();
    if (response.status !== 200) {
      const error = captureBrowserExact(body, ["ok", "error"]);
      if (error.ok !== false || typeof error.error !== "string" || !Object.hasOwn(PLAN_COVERAGE_ERRORS, error.error)
        || PLAN_COVERAGE_ERRORS[error.error] !== response.status) throw Error("invalid_error_envelope");
      throw Error(error.error);
    }
    return body;
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

// Keep detached authorized plan anchors, not the mutable parent result. A later
// detail may contain new clocks/approvals/cancellation but cannot substitute a plan.
export class AttendancePlanCoverageClient {
  readonly anchors: readonly PlanCoverageAnchor[];
  readonly limited: boolean;
  private readonly scope: Readonly<{ siteId: string; workerId: string; ownerId: string; employeeId: string | null; apiFetch: AttendanceApiFetch; timeoutMs: number }>;
  private state: PlanCoverageClientState = frozen({ phase: "idle", result: null, message: "请选择排班，再明确读取计划关联核对。" });
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(input: PlanCoverageClientOptions) {
    const options = { ...input }, source = options.source, base = source.attendance.base, timeoutMs = options.timeoutMs ?? 12000;
    if (typeof options.apiFetch !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000) invalid();
    const siteId = attendanceSelfSite(source.siteId), workerId = attendanceSelfUuid(source.worker.workerId), ownerId = attendanceSelfUuid(options.ownerId);
    if (source.protocol !== "sources-v1" || source.actorId !== ownerId || source.attendance.access !== "owner" || base.siteId !== siteId || base.workerId !== workerId
      || !("employeeId" in base) || base.employeeId !== source.worker.employeeId || !source.schedule || typeof source.schedule.limited !== "boolean"
      || !Array.isArray(source.schedule.items) || source.schedule.items.length > 100 || source.schedule.limited && source.schedule.items.length) invalid();
    this.limited = source.schedule.limited;
    const employeeId = source.worker.employeeId === null ? null : attendanceSelfUuid(source.worker.employeeId), ids = new Set<string>();
    this.anchors = frozen(source.schedule.items.map(row => {
      const id = attendanceSelfUuid(row.id);
      if (ids.has(id) || row.workerId !== workerId || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.cancelled !== "boolean") invalid(); ids.add(id);
      const startAt = instant(row.startAt), endAt = instant(row.endAt);
      if (endAt <= startAt || Date.parse(endAt) - Date.parse(startAt) > 86400000) invalid();
      return { id, revision: row.revision, locationId: attendanceSelfUuid(row.locationId), locationName: label(row.locationName, 120), timeZone: label(row.timeZone, 100),
        workDate: label(row.workDate, 10), startAt, endAt, cancelled: row.cancelled };
    }));
    this.scope = Object.freeze({ siteId, workerId, ownerId, employeeId, apiFetch: options.apiFetch, timeoutMs });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: PlanCoverageClientState) {
    const snapshot = this.state = frozen(state);
    for (const listener of [...this.listeners]) { if (this.state !== snapshot) break; try { listener(); } catch { /* Observers cannot bypass lease validation. */ } }
  }
  invalidate = (text = "选择或资料已改变，旧核对已隐藏；请明确重新读取。") => {
    const generation = ++this.generation, previous = this.controller; this.controller = null; previous?.abort();
    if (generation === this.generation) this.publish({ phase: "idle", result: null, message: typeof text === "string" ? text : "旧核对已隐藏。" });
  };
  pause = () => this.invalidate("核对已隐藏；返回后不会自动读取。");
  private current(lease: Lease) {
    if (lease.generation === this.generation && hidden()) this.pause();
    return lease.generation === this.generation && this.controller === lease.controller && !lease.controller.signal.aborted;
  }
  read = async (slotId: string) => {
    if (hidden()) { this.pause(); return; }
    const lease = { generation: ++this.generation, controller: new AbortController() }, previous = this.controller;
    this.controller = lease.controller; previous?.abort(); if (!this.current(lease)) return;
    try {
      const anchor = this.anchors.find(row => row.id === slotId) ?? invalid();
      if (this.scope.employeeId === null) throw Error("attendance_shift_rule_binding_identity_changed");
      const query = parsePlanCoverageQuery({ siteId: this.scope.siteId, workerId: this.scope.workerId, slotId });
      this.publish({ phase: "loading", result: null, message: "正在同次读取计划的明确关联集合及最新批准核定…" });
      if (!this.current(lease)) return;
      const started = performance.now();
      const raw = await request(this.scope.apiFetch, `${endpoint}?${planCoverageQueryString(query)}`, lease.controller.signal, this.scope.timeoutMs);
      if (!this.current(lease)) return;
      const result = parsePlanCoverageResponse(raw, query, this.scope.ownerId);
      if (result.worker.employeeId !== this.scope.employeeId || Object.entries(anchor).some(([key, value]) =>
        key !== "cancelled" && result.slot[key as keyof PlanCoverageAnchor] !== value) || anchor.cancelled && !result.slot.cancelled) throw Error("anchor_mismatch");
      if (performance.now() - started >= this.scope.timeoutMs) throw Error("timeout");
      if (!this.current(lease)) return;
      this.publish({ phase: "ready", result, message: "计划关联核对已读取；仅比较明确关联的在班跨度，不判缺勤或工资。" });
    } catch (error) { if (this.current(lease)) this.publish({ phase: "blocked", result: null, message: message(error) }); }
    finally { if (lease.generation === this.generation && this.controller === lease.controller) this.controller = null; }
  };
}
