import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { ATTENDANCE_SELF_CONTEXT_ERRORS, parseAttendanceSelfContext } from "./merchantAttendanceSelfContext";
import {
  SELF_REQUEST_KINDS,
  SELF_REQUEST_STATUSES,
  SELF_REQUESTS_ERRORS,
  parseSelfRequestsQuery,
  parseSelfRequestsResponse,
  selfRequestsQueryString,
  type SelfRequestKind,
  type SelfRequestStatus,
  type SelfRequestsQuery,
} from "./merchantAttendanceSelfRequests";

type KindFilter = "all" | SelfRequestKind;
type StatusFilter = "all" | SelfRequestStatus;
type Result = ReturnType<typeof parseSelfRequestsResponse>;
type State = {
  phase: "idle" | "loading" | "ready" | "blocked";
  query: SelfRequestsQuery | null;
  result: Result | null;
  message: string;
  page: number;
};
type Options = { siteId: string; employeeId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number };
const hidden = () => typeof document !== "undefined" && document.hidden;

/** Standalone read-only history. It never restores, submits, or persists an attendance operation. */
export class AttendanceSelfRequestsClient {
  private state: State = {
    phase: "idle",
    query: null,
    result: null,
    message: "尚未查询本人申请记录；请选择申请类型和状态后明确查询。",
    page: 1,
  };
  private readonly identity: Pick<Options, "siteId" | "employeeId">;
  private generation = 0;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly options: Options) {
    this.identity = { siteId: attendanceSelfSite(options.siteId), employeeId: attendanceSelfUuid(options.employeeId) };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private set(update: Partial<State>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }

  pause = () => {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.set({
      phase: "idle",
      query: null,
      result: null,
      page: 1,
      message: "申请记录已清除；需要时请手动重新查询首页，不会自动重试。",
    });
  };

  begin = async (kind: KindFilter = "all", status: StatusFilter = "all") => {
    await this.load(null, 1, kind, status);
  };

  next = async () => {
    const { query, result, phase, page } = this.state;
    if (phase !== "ready" || !query || !result?.nextCursor) return;
    await this.load({
      ...query,
      asOf: result.asOf,
      cursorAt: result.nextCursor.recordedAt,
      cursorKind: result.nextCursor.kind,
      cursorId: result.nextCursor.requestId,
    }, page + 1);
  };

  private async load(input: SelfRequestsQuery | null, page: number, kind: KindFilter = "all", status: StatusFilter = "all") {
    if (this.controller) return;
    if (hidden()) { this.pause(); return; }
    this.pause();
    const generation = this.generation;
    const controller = new AbortController();
    const started = performance.now();
    this.controller = controller;
    this.set({ phase: "loading", message: "正在按当前本人身份读取申请记录…" });
    try {
      const remaining = () => {
        const value = (this.options.timeoutMs ?? 12000) - (performance.now() - started);
        if (value <= 0) throw Error("timeout");
        return value;
      };
      if (input === null) {
        if (!(kind === "all" || SELF_REQUEST_KINDS.includes(kind))
          || !(status === "all" || SELF_REQUEST_STATUSES.includes(status))) throw Error("attendance_invalid_request");
        const body = await attendanceManagementRequest(
          this.options.apiFetch,
          `/api/merchant-enterprise/attendance/corrections/context?siteId=${this.identity.siteId}`,
          { method: "GET" },
          { signal: controller.signal, timeoutMs: remaining(), maxBytes: 2048, errorStatuses: ATTENDANCE_SELF_CONTEXT_ERRORS },
        );
        if (generation !== this.generation) return;
        if (hidden()) { this.pause(); return; }
        const keys = ["ok", "moduleEnabled", "siteId", "employeeId", "workerId", "locationId"];
        if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key))) throw Error("invalid_response");
        const context = parseAttendanceSelfContext(body, this.identity.siteId);
        if (context.employeeId !== this.identity.employeeId) throw Error("attendance_access_denied");
        input = {
          siteId: this.identity.siteId,
          expectedEmployeeId: context.employeeId,
          expectedWorkerId: context.workerId,
          kind,
          status,
          asOf: null,
          cursorAt: null,
          cursorKind: null,
          cursorId: null,
        };
      }
      const query = parseSelfRequestsQuery(input);
      this.set({ query, page });
      const raw = await attendanceManagementRequest(
        this.options.apiFetch,
        `/api/merchant-enterprise/attendance/self-requests?${selfRequestsQueryString(query)}`,
        { method: "GET" },
        { signal: controller.signal, timeoutMs: remaining(), maxBytes: 131072, errorStatuses: SELF_REQUESTS_ERRORS },
      );
      if (generation !== this.generation) return;
      if (hidden()) { this.pause(); return; }
      const result = parseSelfRequestsResponse(raw, query);
      if (result.employeeId !== this.identity.employeeId || result.workerId !== query.expectedWorkerId) throw Error("attendance_access_denied");
      this.set({
        phase: "ready",
        result,
        message: result.items.length
          ? "已读取本页本人申请摘要；翻页保持同一时间截点，不代表当前待办或当前生效结果。"
          : result.nextCursor
            ? "本页候选没有符合筛选的申请，仍有下一页；不表示全部日期都没有记录。"
            : "本页没有符合筛选的申请，当前查询已到末页。",
      });
    } catch (error) {
      if (generation !== this.generation) return;
      const code = error instanceof Error ? error.message : "";
      this.set({
        phase: "blocked",
        result: null,
        query: null,
        message: code === "attendance_worker_changed"
          ? "当前员工与考勤档案绑定已变化，已清除记录；请返回我的考勤核对身份，不会自动改查其他档案。"
          : ["attendance_access_denied", "unauthorized", "not_authenticated", "employee_password_authentication_required", "enterprise_management_disabled"].includes(code)
            ? "当前身份或权限不能读取本人申请记录，已清除列表；请核对同一员工身份后重新查询。"
            : code === "attendance_not_available"
              ? "本人申请记录入口尚未开放，不影响原有打卡和申请。"
              : "暂时无法可靠读取，已清除列表；请稍后手动重新查询首页，没有提交、撤回或改变任何记录。",
      });
    } finally {
      if (generation === this.generation) this.controller = null;
    }
  }
}
