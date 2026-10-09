import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { EVENT_CHANNEL_ERRORS, parseEventChannelsQuery, parseEventChannelsResult, type EventChannelsQuery, type EventChannelsResult } from "./merchantAttendanceEventChannels";

type State = { phase: "idle" | "loading" | "ready" | "blocked"; result: EventChannelsResult | null; message: string };
const initial: State = { phase: "idle", result: null, message: "尚未核对详细打卡通路；不会根据原始 web 字段猜测是否扫码。" };
type Options = { query: EventChannelsQuery; apiFetch: AttendanceApiFetch; employeeId?: string;
  now?: () => number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout };
/** Read-only, explicit batch requests; no storage, polling, or write retries. */
export class AttendanceEventChannelsClient {
  private state: State = initial;
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly query: EventChannelsQuery;
  constructor(private readonly options: Options) { this.query = parseEventChannelsQuery(options.query); }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: State) { this.state = state; for (const listener of this.listeners) listener(); }
  private now = () => (this.options.now ?? (() => performance.now()))();
  invalidate = (message = initial.message) => {
    this.generation++; this.controller?.abort(); this.controller = null;
    if (this.timer !== null) (this.options.clearTimer ?? clearTimeout)(this.timer); this.timer = null;
    this.set({ phase: "idle", result: null, message });
  };
  load = async () => {
    if (this.controller || typeof document !== "undefined" && document.hidden) return;
    this.invalidate(); const version = this.generation, controller = new AbortController(), start = this.now();
    this.controller = controller; this.set({ phase: "loading", result: null, message: "正在按当前权限批量核对原始打卡通路…" });
    try {
      const body = await attendanceManagementRequest(this.options.apiFetch, "/api/merchant-enterprise/attendance/event-channels", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.query),
      }, { signal: controller.signal, maxBytes: 65536, errorStatuses: EVENT_CHANNEL_ERRORS });
      if (version !== this.generation) return;
      if (body.ok !== true || typeof body.moduleEnabled !== "boolean") throw Error("invalid_response");
      const { ok, moduleEnabled, ...raw } = body; void ok; void moduleEnabled;
      const result = parseEventChannelsResult(raw, this.query);
      if (this.options.employeeId && result.viewerEmployeeId !== this.options.employeeId) throw Error("attendance_access_denied");
      const elapsed = this.now() - start;
      const ttl = Math.min(30000, result.accessValidUntil ? Date.parse(result.accessValidUntil) - Date.parse(result.asOf) : 30000) - elapsed;
      if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(ttl) || ttl <= 0) throw Error("attendance_access_denied");
      this.timer = (this.options.setTimer ?? setTimeout)(() => {
        if (version === this.generation) this.invalidate("详细通路显示已到期；需要时重新核对，不会自动请求。");
      }, ttl);
      this.set({ phase: "ready", result, message: "本批原始打卡通路已核对；不改变工时或审批结果。" });
    } catch (error) {
      if (version !== this.generation) return;
      const code = error instanceof Error ? error.message : "";
      this.set({ phase: "blocked", result: null, message: ["attendance_access_denied", "not_authenticated", "forbidden"].includes(code)
        ? "当前权限不能查看本批打卡通路，已清除结果。请核对本人身份及授权范围。"
        : code === "attendance_not_available" ? "详细打卡通路入口尚未开放；不影响原始记录或工时核对。"
        : "未能核对详细通路；不能据此判断为普通网页打卡。需要时手动重试。" });
    } finally { if (version === this.generation) this.controller = null; }
  };
}
