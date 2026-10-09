import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { OWNER_BACKLOG_ERRORS, parseOwnerBacklogQuery, parseOwnerBacklogResponse, ownerBacklogQueryString,
  type OwnerBacklogQuery } from "./merchantAttendanceOwnerBacklog";

type Result = ReturnType<typeof parseOwnerBacklogResponse>;
type State = { phase: "idle" | "loading" | "ready" | "blocked"; query: OwnerBacklogQuery | null; result: Result | null; message: string; page: number };
type Options = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number };
const hidden = () => typeof document !== "undefined" && document.hidden;
/** Readonly discovery, independent of every approval client's drafts and pending operations. */
export class AttendanceOwnerBacklogClient {
  private state: State = { phase: "idle", query: null, result: null, page: 1, message: "尚未查询负责人待审积压；请选择类型后明确查询。" };
  private readonly identity: Pick<Options, "siteId" | "ownerId">;
  private generation = 0;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly options: Options) {
    this.identity = { siteId: attendanceSelfSite(options.siteId), ownerId: attendanceSelfUuid(options.ownerId) };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  pause = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: "idle", query: null, result: null, page: 1, message: "列表已清除；需要时请手动重新查询首页，不会自动重试。" });
  };
  begin = async (kind: OwnerBacklogQuery["kind"] = "all") => {
    await this.load({ siteId: this.identity.siteId, kind, asOf: null, cursorAt: null, cursorKind: null, cursorId: null }, 1);
  };
  next = async () => {
    const { phase, query, result, page } = this.state;
    if (phase !== "ready" || !query || !result?.nextCursor) return;
    await this.load({ ...query, asOf: result.asOf, cursorAt: result.nextCursor.recordedAt,
      cursorKind: result.nextCursor.kind, cursorId: result.nextCursor.requestId }, page + 1);
  };
  private async load(input: OwnerBacklogQuery, page: number) {
    if (this.controller || hidden()) return;
    this.pause(); const generation = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", message: "正在按当前负责人身份读取待审积压…" });
    try {
      const query = parseOwnerBacklogQuery(input); this.set({ query, page });
      const raw = await attendanceManagementRequest(this.options.apiFetch,
        `/api/merchant-enterprise/attendance/owner-backlog?${ownerBacklogQueryString(query)}`, { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs ?? 12000, maxBytes: 131072, errorStatuses: OWNER_BACKLOG_ERRORS });
      if (generation !== this.generation) return;
      if (hidden()) { this.pause(); return; }
      const result = parseOwnerBacklogResponse(raw, query);
      if (result.ownerId !== this.identity.ownerId) throw Error("attendance_access_denied");
      this.set({ phase: "ready", result, message: result.items.length
        ? "已读取本页待审摘要；按提交时间最旧优先，不代表当前可以审批。"
        : result.nextCursor ? "本页候选没有匹配的待审申请，仍有下一页；不表示全部时间都没有积压。"
          : "本页没有匹配的待审申请，当前查询已到末页；不代表没有出勤或其他待确认操作。" });
    } catch (error) {
      if (generation !== this.generation) return;
      const code = error instanceof Error ? error.message : "";
      this.set({ phase: "blocked", result: null, query: null, message:
        ["attendance_access_denied", "unauthorized", "not_authenticated", "enterprise_management_disabled"].includes(code)
          ? "当前身份或负责人权限不能读取待审积压，已清除列表；请核对同一负责人身份后重新查询。"
          : code === "attendance_not_available" ? "负责人待审积压入口尚未开放，不影响原有申请和审批。"
            : "暂时无法可靠读取，已清除列表；请稍后手动重新查询首页，没有提交或改变任何审批。" });
    } finally { if (generation === this.generation) this.controller = null; }
  }
}
