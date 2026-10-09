import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { parseSourcesQuery, parseSourcesResponse, sourcesQueryString, SOURCES_ERRORS, type SourcesResponse } from "./merchantAttendanceSources";

type State = { phase: "idle" | "loading" | "ready" | "blocked"; result: SourcesResponse | null; message: string };
function message(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (["attendance_access_denied", "authentication_required", "enterprise_management_disabled", "forbidden_origin"].includes(code)) return "当前身份无权读取此员工资料，旧内容已隐藏。请核对负责人身份。";
  if (["attendance_sources_too_large", "attendance_report_too_large"].includes(code)) return "本次资料超过安全读取上限。请缩短日期后重新查询，不会展示不完整的工时。";
  if (["attendance_report_reconciliation_required", "attendance_report_overlap", "attendance_session_invalid_records", "attendance_session_span_too_long"].includes(code)) return "实际打卡或核定来源需要先核对，当前不能形成可靠资料集；这不等于缺勤或零工时。";
  if (code === "attendance_invalid_request") return "请选择有效的起止日期，每次最多 7 个当地日期。";
  if (code === "attendance_settings_required") return "请先保存企业考勤设置。";
  if (code === "attendance_not_available") return "资料核查尚未开放。";
  return "无法可靠读取完整资料，旧内容已隐藏。请稍后明确重试；没有执行任何写入。";
}

export class AttendanceSourcesClient {
  private state: State = { phase: "idle", result: null, message: "请选择最多 7 个当地日期，再明确读取。" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(private readonly options: { siteId: string; ownerId: string; workerId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number }) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: State) { this.state = state; for (const listener of this.listeners) listener(); }
  invalidate = (text = "条件已改变，旧资料已隐藏；请明确重新读取。") => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: "idle", result: null, message: text });
  };
  pause = () => this.invalidate("资料已隐藏；返回后请明确重新读取。");
  read = async (fromDate: string, throughDate: string) => {
    this.invalidate(); const generation = this.generation;
    try {
      const query = parseSourcesQuery({ siteId: this.options.siteId, workerId: this.options.workerId, fromDate, throughDate });
      const controller = new AbortController(); this.controller = controller;
      this.set({ phase: "loading", result: null, message: "正在核验当前负责人身份并读取该员工的限定范围来源…" });
      const raw = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/sources?${sourcesQueryString(query)}`, { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs ?? 12000, maxBytes: 1049600, errorStatuses: SOURCES_ERRORS });
      if (generation !== this.generation || controller.signal.aborted) return;
      const result = parseSourcesResponse(raw, query, this.options.ownerId);
      this.set({ phase: "ready", result, message: "当前来源已读取；仅用于核对，不作迟到、缺勤、工资或历史封账结论。" });
    } catch (error) {
      if (generation === this.generation) this.set({ phase: "blocked", result: null, message: message(error) });
    } finally { if (generation === this.generation) this.controller = null; }
  };
}
