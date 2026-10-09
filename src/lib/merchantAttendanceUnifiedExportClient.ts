import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { parseUnifiedExportCommand, parseUnifiedExportReceipt, unifiedExportFilename, UNIFIED_EXPORT_MAX_BYTES, UNIFIED_EXPORT_ERRORS, type UnifiedExportCommand } from "./merchantAttendanceUnifiedExport";
type State = { phase: "idle" | "loading" | "ready" | "blocked"; message: string; operationId: string | null };
const errors = { ...UNIFIED_EXPORT_ERRORS, unauthorized: 401, employee_password_authentication_required: 403, enterprise_management_disabled: 403, forbidden_origin: 403 };
export class UnifiedExportClient {
  private state: State = { phase: "idle", message: "生成时重新读取含整段申报的工时，可能与上方较早的查询不同。", operationId: null };
  private generation = 0; private controller: AbortController | null = null; private listeners = new Set<() => void>();
  constructor(private readonly options: { selection: Omit<UnifiedExportCommand, "operationId">; actorId: string; apiFetch: AttendanceApiFetch;
    available: () => boolean; deliver: (file: { csv: string; filename: string }) => void; onDenied?: () => void; onStale?: () => void; randomId?: () => string; timeoutMs?: number; now?: () => number }) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(state: State) { this.state = state; this.listeners.forEach(fn => fn()); }
  invalidate = () => { this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: "idle", message: "已取消本页下载，不自动重试；服务器可能已留下来源读取记录。", operationId: null }); };
  download = async (acknowledged: boolean) => {
    if (!acknowledged || this.state.phase === "loading" || !this.options.available()) return;
    this.invalidate(); const g = this.generation, controller = new AbortController(); this.controller = controller;
    const now = this.options.now ?? (() => performance.now()), started = now(); let operationId: string | null = null, sent = false, dispatched = false;
    try {
      const c = parseUnifiedExportCommand({ ...this.options.selection, operationId: (this.options.randomId ?? (() => crypto.randomUUID()))() }); operationId = c.operationId;
      this.set({ phase: "loading", operationId, message: "正在核验导出权限及全部工时来源…" }); sent = true;
      const body = await attendanceManagementRequest(this.options.apiFetch, "/api/merchant-enterprise/attendance/unified-export",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 2 * UNIFIED_EXPORT_MAX_BYTES + 8192, errorStatuses: errors });
      if (g !== this.generation || !this.options.available()) return;
      const keys = ["ok", "moduleEnabled", "receipt", "replayed", "csv", "filename", "viewerEmployeeId", "accessValidUntil"];
      if (Object.keys(body).length !== keys.length || keys.some(k => !Object.hasOwn(body, k)) || typeof body.replayed !== "boolean") throw Error("invalid_response");
      const receipt = parseUnifiedExportReceipt(body.receipt, c);
      if (body.replayed) {
        if ([body.csv, body.filename, body.viewerEmployeeId, body.accessValidUntil].some(v => v !== null)) throw Error("invalid_response");
        this.set({ phase: "blocked", operationId, message: "此编号已有来源读取凭据，不再次返回或下载文件。请先检查下载记录；如仍需要，请明确生成新文件。" }); return;
      }
      if (body.viewerEmployeeId !== (c.query.access === "owner" ? null : this.options.actorId)) throw Error("attendance_access_denied");
      if (body.accessValidUntil !== null) {
        const until = attendanceRecordInstant(body.accessValidUntil);
        if (c.query.access !== "manager" || until !== body.accessValidUntil || Date.parse(until) - Date.parse(receipt.asOf) - 1 <= now() - started) throw Error("attendance_access_denied");
      }
      if (now() - started >= 300000) throw Error("attendance_access_denied");
      if (typeof body.csv !== "string" || !body.csv.startsWith('\ufeff"记录类型","口径",') || !body.csv.endsWith("\r\n")
        || new TextEncoder().encode(body.csv).byteLength > UNIFIED_EXPORT_MAX_BYTES || body.filename !== unifiedExportFilename(c)) throw Error("invalid_response");
      if (g !== this.generation || !this.options.available()) return;
      dispatched = true; this.options.deliver({ csv: body.csv, filename: body.filename as string });
      this.set({ phase: "ready", operationId, message: `已请求浏览器下载含整段申报的 CSV。请在下载记录确认保存；数据截至 UTC：${receipt.asOf}。服务器不留文件副本。` });
    } catch (e) {
      if (g !== this.generation) return;
      const code = e instanceof Error ? e.message : "";
      const denied = ["unauthorized", "attendance_access_denied", "attendance_export_denied", "employee_password_authentication_required", "enterprise_management_disabled", "forbidden_origin", "attendance_worker_changed", "attendance_version_conflict", "attendance_report_zone_changed"].includes(code);
      const stale = ["attendance_report_reconciliation_required", "attendance_report_overlap", "attendance_report_too_large", "attendance_session_invalid_records", "attendance_session_span_too_long"].includes(code);
      const message = dispatched ? "不能确认浏览器是否保存文件，请先检查下载记录；不会自动重复下载。" : denied ? "导出权限或查询范围已变化，请重新读取核对；本次未发起下载。"
        : stale ? "工时来源有冲突或超过上限，未生成可用文件；请重新核对或缩短日期范围。"
          : code === "attendance_not_available" ? "含整段申报的导出尚未开放。" : code === "attendance_rate_limited" ? "生成较频繁，请等待一分钟后手动操作。"
            : sent ? "结果未确认，服务器可能已有来源读取记录。请先检查下载记录，再明确决定是否生成新文件；不会自动重试。" : "参数无效或无法创建操作编号，未发起导出。";
      this.set({ phase: "blocked", operationId, message }); if (denied) this.options.onDenied?.(); else if (stale) this.options.onStale?.();
    } finally { if (g === this.generation) this.controller = null; }
  };
}
