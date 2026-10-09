import { CORRECTION_REVIEW_ERRORS, correctionReviewQueryString, parseCorrectionReviewQuery, parseCorrectionReviewResult,
  type CorrectionReviewQuery, type CorrectionReviewResult } from "./merchantAttendanceCorrectionReview";
import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
type ListQuery = Extract<CorrectionReviewQuery, { mode: "list" }>;
export function correctionReviewDateQuery(siteId: string, fromDate: string, throughDate: string, zone: string, status: ListQuery["status"], workerId: string | null): ListQuery {
  const start = attendanceDayUtcRange(fromDate, zone), end = attendanceDayUtcRange(throughDate, zone);
  if (Date.parse(throughDate) - Date.parse(fromDate) >= 30 * 86400000) throw Error("attendance_invalid_request");
  const query = parseCorrectionReviewQuery(`https://local.invalid/?${correctionReviewQueryString({ siteId, mode: "list", fromAt: start.startAt, toAt: end.endAt,
    workerId, status, asOf: null, cursorAt: null, cursorId: null })}`);
  if (query.mode !== "list") throw Error("attendance_invalid_request"); return query;
}
export class AttendanceCorrectionReviewClient {
  private state: { phase: "idle" | "loading" | "ready" | "blocked"; query: CorrectionReviewQuery | null;
    result: (CorrectionReviewResult & { moduleEnabled: boolean }) | null; message: string } = {
    phase: "idle", query: null, result: null, message: "按申请提交日期查询；不会审批或修改任何记录。",
  };
  private generation = 0; private controller: AbortController | null = null; private listeners = new Set<() => void>();
  private listQuery: ListQuery | null = null;
  constructor(private readonly options: { siteId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number }) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  invalidate = (clearQuery = false) => { this.generation++; this.controller?.abort(); this.controller = null;
    if (clearQuery) this.listQuery = null;
    this.set({ result: null, ...(clearQuery ? { query: null } : {}), phase: "idle", message: "资料已隐藏；重新查询时再次核验负责人权限。" }); };
  refresh = async () => { if (this.state.query) await this.load(this.state.query); };
  first = async () => { if (this.listQuery) await this.load({ ...this.listQuery, asOf: null, cursorAt: null, cursorId: null }); };
  next = async () => { const r = this.state.result, q = this.state.query;
    if (this.state.phase === "ready" && r?.mode === "list" && q?.mode === "list" && r.nextCursor) await this.load({ ...q, asOf: r.asOf, cursorAt: r.nextCursor.recordedAt, cursorId: r.nextCursor.requestId }); };
  detail = async (requestId: string) => { const r = this.state.result;
    if (this.state.phase === "ready" && r?.mode === "list" && r.items.some(i => i.requestId === requestId)) await this.load({ siteId: this.options.siteId, mode: "detail", requestId }); };
  load = async (input: CorrectionReviewQuery) => {
    this.invalidate(); const g = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", query: null });
    try {
      const q = parseCorrectionReviewQuery(`https://local.invalid/?${correctionReviewQueryString(input)}`);
      if (q.siteId !== this.options.siteId) throw Error("attendance_access_denied");
      this.set({ query: q }); if (q.mode === "list") this.listQuery = q;
      const body = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/correction-reviews?${correctionReviewQueryString(q)}`,
        { method: "GET" }, { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 262144, errorStatuses: CORRECTION_REVIEW_ERRORS });
      const result = { ...parseCorrectionReviewResult(body, q, true, true), moduleEnabled: body.moduleEnabled as boolean };
      if (g !== this.generation) return;
      this.set({ phase: "ready", result, message: result.mode === "list" ? `本批扫描 ${result.scanned} 份，匹配 ${result.items.length} 份。${result.nextCursor ? "还有下一批，空匹配不等于查询结束。" : "已到本次范围末尾。"}`
        : "已读取当前核对资料。所有结论仅供预核对，不是审批结果或可复用的批准凭证。" });
    } catch (e) {
      if (g !== this.generation) return;
      if (!this.state.query) this.listQuery = null;
      const code = e instanceof Error ? e.message : "";
      this.set({ phase: "blocked", result: null, message: code === "attendance_access_denied" ? "当前账号不是此企业的有效负责人，或权限已变化；已清除结果。"
        : code === "attendance_correction_not_found" ? "此企业未找到该申请，请重新查询，不会切换到其他企业。"
          : code === "attendance_not_available" ? "负责人补正核对尚未开放。" : "无法完成核对，请检查日期／权限后手动重试；没有批准、驳回或修改任何打卡。" });
    } finally { if (g === this.generation) this.controller = null; }
  };
}
