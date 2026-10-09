import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { COVERAGE_ERRORS, coverageQueryString, parseCoverageResult, type CoverageQuery, type CoverageResult } from "./merchantAttendanceNoticeCoverage";

type State = { phase: "idle" | "loading" | "ready" | "blocked"; result: (CoverageResult & { moduleEnabled: boolean }) | null; message: string };
type Options = { siteId: string; locationId: string; ownerId: string; apiFetch: AttendanceApiFetch };
const initial: State = { phase: "idle", result: null, message: "尚未查询确认情况；读取不会发布告知或代员工确认。" };
const hidden = () => typeof document !== "undefined" && document.hidden;

/** Explicit, read-only pages. Results are live observations, never an accumulated snapshot. */
export class AttendanceNoticeCoverageClient {
  private state: State = initial;
  private readonly first: CoverageQuery;
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(private readonly options: Options) {
    attendanceSelfUuid(options.ownerId);
    this.first = { siteId: attendanceSelfSite(options.siteId), locationId: attendanceSelfUuid(options.locationId),
      expectedNoticeRevision: null, expectedSettingsVersion: null, expectedLocationVersion: null, cursorWorkerId: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: State) { this.state = state; for (const listener of this.listeners) listener(); }
  invalidate = (message = "已清除确认情况；需要时请手动重新查询首页。") => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: "idle", result: null, message });
  };
  loadFirst = async () => { await this.load({ ...this.first }); };
  loadNext = async () => {
    const result = this.state.result;
    if (!result?.nextCursor || this.state.phase !== "ready") return;
    await this.load({ ...this.first, expectedNoticeRevision: result.notice?.revision ?? 0,
      expectedSettingsVersion: result.settingsVersion, expectedLocationVersion: result.location.version, cursorWorkerId: result.nextCursor });
  };
  private async load(query: CoverageQuery) {
    if (this.controller || hidden()) return;
    this.invalidate(); const generation = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", result: null, message: "正在按当前负责人权限读取本页确认情况…" });
    try {
      const body = await attendanceManagementRequest(this.options.apiFetch,
        `/api/merchant-enterprise/attendance/location-notice-coverage?${coverageQueryString(query)}`, { method: "GET" },
        { signal: controller.signal, maxBytes: 65536, errorStatuses: COVERAGE_ERRORS });
      if (generation !== this.generation) return;
      if (hidden()) { this.invalidate(); return; }
      const { ok, moduleEnabled, ...raw } = body;
      if (ok !== true || typeof moduleEnabled !== "boolean") throw Error("invalid_response");
      const result = parseCoverageResult(raw, query);
      this.set({ phase: "ready", result: { ...result, moduleEnabled }, message: "已读取本页；人数为本次读取的实时统计，各页不是固定历史快照。" });
    } catch (error) {
      if (generation !== this.generation) return;
      const code = error instanceof Error ? error.message : "";
      this.set({ phase: "blocked", result: null, message: code === "attendance_version_conflict"
        ? "告知或配置版本已变化，已清除旧名单；请手动重新查询首页。"
        : ["attendance_access_denied", "unauthorized", "not_authenticated", "enterprise_management_disabled", "forbidden_origin"].includes(code)
          ? "当前身份或权限不能查看确认情况，已清除名单；请核对负责人身份后重新查询。"
          : code === "attendance_not_available" ? "确认情况入口尚未开放；不会影响现有告知和打卡。"
            : "未能读取确认情况，已清除名单；请稍后手动重新查询首页，不能据此判断员工是否确认。" });
    } finally { if (generation === this.generation) this.controller = null; }
  }
}
