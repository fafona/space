import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { SCHEDULE_OVERVIEW_ERRORS, parseScheduleOverviewQuery, parseScheduleOverviewResponse, scheduleOverviewQueryString, type ScheduleOverviewQuery } from "./merchantAttendanceScheduleOverview";
type Options = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number };
type State = { phase: "idle" | "loading" | "ready" | "blocked"; query: ScheduleOverviewQuery | null;
  result: ReturnType<typeof parseScheduleOverviewResponse> | null; page: number; message: string };
const hidden = () => typeof document !== "undefined" && document.hidden;
/** Read-only selected-worker planning view. No drafts, pending commands or storage. */
export class AttendanceScheduleOverviewClient {
  private state: State = { phase: "idle", query: null, result: null, page: 1, message: "请选择人员和日期后明确查询排班总览。" };
  private generation = 0;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly options: Options) { attendanceSelfSite(options.siteId); attendanceSelfUuid(options.ownerId); }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  pause = () => { this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: "idle", query: null, result: null, page: 1, message: "列表已清除，请明确重新查询首页；不会自动读取或更改排班。" }); };
  begin = async (filter: Pick<ScheduleOverviewQuery, "workerIds" | "fromDate" | "throughDate">) => {
    await this.load({ ...filter, siteId: this.options.siteId, revision: null, cursorDate: null, cursorStart: null, cursorId: null }, 1);
  };
  next = async () => {
    const { phase, result, query, page } = this.state;
    if (phase !== "ready" || !result?.nextCursor || !query) return;
    await this.load({ ...query, revision: result.revision, cursorDate: result.nextCursor.workDate,
      cursorStart: result.nextCursor.startAt, cursorId: result.nextCursor.slotId }, page + 1);
  };
  private async load(input: ScheduleOverviewQuery, page: number) {
    if (this.controller || hidden()) return;
    this.pause(); const g = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", message: "正在按当前负责人身份读取已选人员的排班…" });
    try {
      const query = parseScheduleOverviewQuery(input); this.set({ query, page });
      const raw = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/schedule-overview?${scheduleOverviewQueryString(query)}`,
        { method: "GET" }, { signal: controller.signal, timeoutMs: this.options.timeoutMs ?? 12000, maxBytes: 131072, errorStatuses: SCHEDULE_OVERVIEW_ERRORS });
      if (g !== this.generation) return;
      if (hidden()) { this.pause(); return; }
      const result = parseScheduleOverviewResponse(raw, query); if (result.ownerId !== this.options.ownerId) throw Error("attendance_access_denied");
      this.set({ phase: "ready", result, message: result.items.length ? "已读取本页安排；包含已取消班次，不代表实际出勤或工时。"
        : result.nextCursor ? "本页候选晚于所查排班版本，仍有下一页；请继续翻页。" : "本页没有该排班版本的安排，当前查询已到末页；不代表缺勤。" });
    } catch (error) {
      if (g !== this.generation) return;
      const code = error instanceof Error ? error.message : "";
      this.set({ phase: "blocked", result: null, query: null, message: ["attendance_access_denied", "unauthorized", "not_authenticated", "enterprise_management_disabled"].includes(code)
        ? "当前负责人身份或权限不能读取，列表已清除；请核对身份后重新查询首页。"
        : "无法可靠读取排班总览，列表已清除；请重新查询首页，没有更改任何安排。" });
    } finally { if (g === this.generation) this.controller = null; }
  }
}
