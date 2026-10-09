import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { parseUnifiedQuery, parseUnifiedResponse, unifiedQueryString, unifiedMessage, UNIFIED_REPORT_ERRORS, type UnifiedQuery } from "./merchantAttendanceUnifiedTimesheet";
const errors: Readonly<Record<string, number>> = { ...UNIFIED_REPORT_ERRORS, unauthorized: 401, employee_password_authentication_required: 403, enterprise_management_disabled: 403, forbidden_origin: 403 };
export class UnifiedTimesheetClient {
  private state: { phase: "idle" | "loading" | "ready" | "blocked"; result: ReturnType<typeof parseUnifiedResponse> | null; message: string } = { phase: "idle", result: null, message: "请明确查询含整段漏卡的工时。" };
  private generation = 0; private controller: AbortController | null = null; private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly options: { query: UnifiedQuery; actorId: string; apiFetch: AttendanceApiFetch; onDenied?: () => void; timeoutMs?: number; monotonicNow?: () => number; displayMs?: number }) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private now() { return this.options.monotonicNow?.() ?? performance.now(); }
  invalidate = () => { this.generation++; this.controller?.abort(); this.controller = null; if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.set({ phase: "idle", result: null, message: "资料已清除，请重新查询；不会自动延长授权。" }); };
  load = async (query: UnifiedQuery) => {
    this.invalidate(); const g = this.generation, controller = new AbortController(), started = this.now(); this.controller = controller;
    this.set({ phase: "loading", message: "正在核对原始记录、最新补正与已批准整段申报…" });
    try {
      const q = parseUnifiedQuery(`https://local.invalid/?${unifiedQueryString(query)}`);
      const sameTarget = (a: UnifiedQuery) => unifiedQueryString({ ...a, fromDate: "2000-01-01", throughDate: "2000-01-01" });
      if (sameTarget(q) !== sameTarget(parseUnifiedQuery(`https://local.invalid/?${unifiedQueryString(this.options.query)}`))) throw Error("attendance_access_denied");
      const raw = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/unified-timesheet?${unifiedQueryString(q)}`, {},
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 2097152, errorStatuses: errors });
      if (g !== this.generation) return;
      const result = parseUnifiedResponse(raw, q, this.options.actorId), base = result.base;
      const expires = "accessValidUntil" in base ? base.accessValidUntil : null;
      const deadline = started + Math.min(this.options.displayMs ?? 300000, expires === null ? Infinity : Date.parse(expires) - Date.parse(base.asOf) - 1);
      if (deadline <= this.now()) throw Error("attendance_access_denied");
      const check = () => { const remaining = deadline - this.now(); if (remaining <= 0) { this.invalidate(); this.set({ phase: "blocked", message: "资料显示时限或授权已到期，请重新查询。" }); }
        else this.timer = setTimeout(check, Math.min(remaining, 2147483647)); };
      this.timer = setTimeout(check, Math.min(deadline - this.now(), 2147483647));
      this.set({ result, phase: "ready", message: "已核对完整可见来源；整段申报单独列示并计入本页合计。" });
    } catch (e) { if (g === this.generation) {
      const code = e instanceof Error ? e.message : "";
      this.set({ result: null, phase: "blocked", message: unifiedMessage(code) });
      if ([401, 403].includes(errors[code]) || code === "attendance_worker_changed") this.options.onDenied?.();
    } }
    finally { if (g === this.generation) this.controller = null; }
  };
}
