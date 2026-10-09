import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { parseTimesheetExportCommand, parseTimesheetExportReceipt, timesheetExportFilename,
  TIMESHEET_EXPORT_MAX_BYTES, TIMESHEET_EXPORT_ERRORS, type TimesheetExportCommand } from "./merchantAttendanceTimesheetExport";
import { parseUnifiedExportReceipt, unifiedExportFilename, UNIFIED_EXPORT_ERRORS } from "./merchantAttendanceUnifiedExport";
import { buildAttendancePrintDocument } from "./merchantAttendancePrintDocument";

export type AttendancePrintKind = "timesheet" | "unified";
export type AttendancePrintDelivery = {
  kind: AttendancePrintKind; html: string; filename: string; signal: AbortSignal;
  authorized: () => boolean; remainingMs: () => number;
};
type State = { phase: "idle" | "loading" | "ready" | "blocked"; message: string; operationId: string | null };
const errors = { ...TIMESHEET_EXPORT_ERRORS, ...UNIFIED_EXPORT_ERRORS,
  unauthorized: 401, employee_password_authentication_required: 403, enterprise_management_disabled: 403, forbidden_origin: 403 };

// Separate from CSV delivery: the lease must remain valid after HTML generation
// and iframe loading. Existing export clients/routes and their writers are unchanged.
export class AttendancePrintClient {
  private state: State = { phase: "idle", message: "打印前重新核验导出权限及工时来源；不是已封账报表或工资表。", operationId: null };
  private generation = 0;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly options: {
    kind: AttendancePrintKind; selection: Omit<TimesheetExportCommand, "operationId">; actorId: string; apiFetch: AttendanceApiFetch;
    available: () => boolean; deliver: (document: AttendancePrintDelivery) => Promise<void>;
    onDenied?: () => void; onStale?: () => void; randomId?: () => string; timeoutMs?: number; now?: () => number;
    buildDocument?: typeof buildAttendancePrintDocument;
  }) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(state: State) { this.state = state; this.listeners.forEach(fn => fn()); }
  invalidate = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: "idle", operationId: null, message: "已取消本页打印并清理临时资料；不自动重试，服务器可能已有来源读取记录。" });
  };
  print = async (acknowledged: boolean) => {
    if (!acknowledged || this.state.phase === "loading" || !this.options.available()) return;
    this.invalidate();
    const generation = this.generation, controller = new AbortController(); this.controller = controller;
    const now = this.options.now ?? (() => performance.now()), started = now();
    let deadline = started + 300000, operationId: string | null = null, sent = false, handedToBrowser = false;
    const current = () => generation === this.generation && !controller.signal.aborted && this.options.available();
    const authorized = () => { const instant = now(); return current() && Number.isFinite(instant) && instant >= started && instant < deadline; };
    try {
      if (this.options.kind !== "timesheet" && this.options.kind !== "unified") throw Error("attendance_invalid_request");
      const command = parseTimesheetExportCommand({ ...this.options.selection, operationId: (this.options.randomId ?? (() => crypto.randomUUID()))() });
      operationId = command.operationId;
      this.set({ phase: "loading", operationId, message: "正在重新核验导出权限并准备打印明细…" });
      sent = true;
      const body = await attendanceManagementRequest(this.options.apiFetch,
        `/api/merchant-enterprise/attendance/${this.options.kind === "unified" ? "unified-export" : "timesheet-export"}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 2 * TIMESHEET_EXPORT_MAX_BYTES + 8192, errorStatuses: errors });
      if (!current()) return;
      const keys = ["ok", "moduleEnabled", "receipt", "replayed", "csv", "filename", "viewerEmployeeId", "accessValidUntil"];
      if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key)) || typeof body.replayed !== "boolean") throw Error("invalid_response");
      const receipt = this.options.kind === "unified" ? parseUnifiedExportReceipt(body.receipt, command) : parseTimesheetExportReceipt(body.receipt, command);
      if (body.replayed) {
        if ([body.csv, body.filename, body.viewerEmployeeId, body.accessValidUntil].some(value => value !== null)) throw Error("invalid_response");
        this.set({ phase: "blocked", operationId, message: "此编号已有来源读取凭据，本次没有再次返回明细或打印。需要时请明确重新核验；不会自动重试。" });
        return;
      }
      if (body.viewerEmployeeId !== (command.query.access === "owner" ? null : this.options.actorId)) throw Error("attendance_access_denied");
      if (body.accessValidUntil !== null) {
        const until = attendanceRecordInstant(body.accessValidUntil);
        if (command.query.access !== "manager" || until !== body.accessValidUntil) throw Error("attendance_access_denied");
        deadline = Math.min(deadline, started + Date.parse(until) - Date.parse(receipt.asOf) - 1);
      }
      const filename = this.options.kind === "unified" ? unifiedExportFilename(command) : timesheetExportFilename(command);
      if (body.filename !== filename || typeof body.csv !== "string" || !body.csv.startsWith('\ufeff"记录类型","口径",')
        || !body.csv.endsWith("\r\n") || new TextEncoder().encode(body.csv).byteLength > TIMESHEET_EXPORT_MAX_BYTES) throw Error("invalid_response");
      if (!authorized()) throw Error("attendance_print_expired");
      const html = (this.options.buildDocument ?? buildAttendancePrintDocument)({ csv: body.csv, filename }, this.options.kind, receipt);
      if (!current()) return;
      if (!authorized()) throw Error("attendance_print_expired");
      await this.options.deliver({ html, filename, kind: this.options.kind, signal: controller.signal, authorized,
        remainingMs: () => Math.max(0, deadline - now()) });
      handedToBrowser = true;
      if (current()) this.set({ phase: "ready", operationId, message: "已请求浏览器打开打印对话框；可按浏览器支持选择打印或另存为 PDF。无法确认是否出纸或保存，请自行核对；不会自动重打。" });
    } catch (error) {
      if (!current()) return;
      const code = error instanceof Error ? error.message : "";
      const denied = ["unauthorized", "attendance_access_denied", "attendance_export_denied", "employee_password_authentication_required", "enterprise_management_disabled",
        "forbidden_origin", "attendance_worker_changed", "attendance_version_conflict", "attendance_report_zone_changed"].includes(code);
      const stale = ["attendance_report_reconciliation_required", "attendance_report_overlap", "attendance_report_too_large", "attendance_session_invalid_records", "attendance_session_span_too_long"].includes(code);
      const message = denied ? "当前导出权限、身份或范围已变化，本次未发起打印。请重新读取并核对授权。"
        : code === "attendance_print_expired" ? "打印准备超时或授权时限已到，已清理临时资料。请明确重新核验，不会自动重试。"
          : code === "attendance_print_unavailable" ? "当前浏览器无法打开此打印对话框。请在支持打印的浏览器中重新登录、核验后操作；不会改为打印整个后台。"
            : code === "attendance_print_uncertain" ? "无法确认浏览器是否打开或完成打印，请先核对打印队列／保存记录；不会自动重打。"
              : stale ? "工时来源冲突或超过打印上限，未生成截断明细。请重新核对或缩短日期范围。"
                : code === "attendance_rate_limited" ? "生成较频繁，请等待一分钟后手动操作。"
                  : code === "attendance_not_available" ? "工时报表导出尚未开放，不能通过打印绕过。"
                    : sent ? "未能确认打印准备结果，未确认的来源读取可能已留下审计记录。请核对后再明确操作；不会自动重试。"
                      : "打印参数无效，未发送请求。";
      this.set({ phase: "blocked", operationId, message });
      if (denied) this.options.onDenied?.(); else if (stale) this.options.onStale?.();
    } finally {
      // Keep the signal alive for an asynchronously open browser dialog, so a
      // later hide/unmount can still remove the bounded temporary iframe.
      if (generation === this.generation && !handedToBrowser) { controller.abort(); this.controller = null; }
    }
  };
}
