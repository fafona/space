import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { REVISION_HISTORY_STATUSES, type RevisionHistoryStatus } from "./merchantAttendanceRevisionHistory";
import { ATTENDANCE_SELF_CONTEXT_ERRORS, parseAttendanceSelfContext } from "./merchantAttendanceSelfContext";
import { parseSelfRevisionHistoryQuery, parseSelfRevisionHistoryResponse, selfRevisionHistoryQueryString,
  SELF_REVISION_HISTORY_ERRORS, type SelfRevisionHistoryQuery } from "./merchantAttendanceSelfRevisionHistory";

type Result = ReturnType<typeof parseSelfRevisionHistoryResponse>;
type State = { phase: "idle" | "loading" | "ready" | "blocked"; query: SelfRevisionHistoryQuery | null; result: Result | null; message: string; page: number };
type Options = { siteId: string; employeeId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number };
const hidden = () => typeof document !== "undefined" && document.hidden;
/** A separate read-only list: never reads pending commands, submits, or persists. */
export class AttendanceSelfRevisionHistoryClient {
  private state: State = { phase: "idle", query: null, result: null, message: "尚未查询本人跨班次修订记录；请选择状态后明确查询。", page: 1 };
  private readonly identity: Pick<Options, "siteId" | "employeeId">;
  private generation = 0;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly options: Options) {
    this.identity = { siteId: attendanceSelfSite(options.siteId), employeeId: attendanceSelfUuid(options.employeeId) };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  pause = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: "idle", query: null, result: null, page: 1, message: "列表已清除；需要时请手动重新查询首页，不会自动重试。" });
  };
  begin = async (status: RevisionHistoryStatus = "all") => {
    await this.load(null, 1, status);
  };
  next = async () => {
    const { query, result, phase, page } = this.state;
    if (phase !== "ready" || !query || !result?.nextCursor) return;
    await this.load({ ...query, asOf: result.asOf, cursorAt: result.nextCursor.recordedAt, cursorId: result.nextCursor.requestId }, page + 1);
  };
  private async load(input: SelfRevisionHistoryQuery | null, page: number, status: RevisionHistoryStatus = "all") {
    if (this.controller || hidden()) return;
    this.pause(); const generation = this.generation, controller = new AbortController(), started = performance.now(); this.controller = controller;
    this.set({ phase: "loading", message: "正在按当前本人身份读取修订记录…" });
    try {
      const remaining = () => { const value = (this.options.timeoutMs ?? 12000) - (performance.now() - started); if (value <= 0) throw Error("timeout"); return value; };
      if (input === null) {
        if (!REVISION_HISTORY_STATUSES.includes(status)) throw Error("attendance_invalid_request");
        const body = await attendanceManagementRequest(this.options.apiFetch,
          `/api/merchant-enterprise/attendance/corrections/context?siteId=${this.identity.siteId}`, { method: "GET" },
          { signal: controller.signal, timeoutMs: remaining(), maxBytes: 2048, errorStatuses: ATTENDANCE_SELF_CONTEXT_ERRORS });
        if (generation !== this.generation) return;
        if (hidden()) { this.pause(); return; }
        const keys = ["ok", "moduleEnabled", "siteId", "employeeId", "workerId", "locationId"];
        if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key))) throw Error("invalid_response");
        const context = parseAttendanceSelfContext(body, this.identity.siteId);
        if (context.employeeId !== this.identity.employeeId) throw Error("attendance_access_denied");
        input = { siteId: this.identity.siteId, expectedWorkerId: context.workerId, status, asOf: null, cursorAt: null, cursorId: null };
      }
      const query = parseSelfRevisionHistoryQuery(input); this.set({ query, page });
      const raw = await attendanceManagementRequest(this.options.apiFetch,
        `/api/merchant-enterprise/attendance/self-revision-history?${selfRevisionHistoryQueryString(query)}`, { method: "GET" },
        { signal: controller.signal, timeoutMs: remaining(), maxBytes: 131072, errorStatuses: SELF_REVISION_HISTORY_ERRORS });
      if (generation !== this.generation) return;
      if (hidden()) { this.pause(); return; }
      const result = parseSelfRevisionHistoryResponse(raw, query);
      if (result.employeeId !== this.identity.employeeId) throw Error("attendance_access_denied");
      this.set({ phase: "ready", result, message: result.items.length
        ? "已读取本页本人修订摘要；翻页保持同一状态截点，不代表当前待办总数。"
        : result.nextCursor ? "本页候选没有符合所选状态的申请，仍有下一页；不表示全部班次都没有记录。"
          : "本页没有符合所选状态的申请，当前查询已到末页；这里不是全部考勤申请或待确认操作。" });
    } catch (error) {
      if (generation !== this.generation) return;
      const code = error instanceof Error ? error.message : "";
      this.set({ phase: "blocked", result: null, query: null, message: code === "attendance_worker_changed"
        ? "当前员工与考勤档案绑定已变化，已清除记录；请返回我的考勤核对身份，不会自动改查其他档案。"
        : ["attendance_access_denied", "unauthorized", "not_authenticated", "employee_password_authentication_required", "enterprise_management_disabled"].includes(code)
          ? "当前身份或权限不能读取本人修订记录，已清除列表；请核对同一员工身份后重新查询。"
          : code === "attendance_not_available" ? "本人跨班次修订记录入口尚未开放，不影响原有打卡和申请。"
            : "暂时无法可靠读取，已清除列表；请稍后手动重新查询首页，没有提交、撤回或改变任何记录。" });
    } finally { if (generation === this.generation) this.controller = null; }
  }
}
