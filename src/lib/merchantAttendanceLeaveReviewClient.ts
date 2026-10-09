import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { leaveReviewQueryString, parseLeaveReviewResponse, LEAVE_REVIEW_ERRORS, type LeaveReviewQuery, type LeaveReviewResponse } from "./merchantAttendanceLeaveReview";

type Options = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; timeoutMs?: number };
type State = { phase: "idle" | "loading" | "ready" | "blocked"; result: LeaveReviewResponse | null; message: string };
const hidden = () => typeof document !== "undefined" && document.hidden;
async function strictFetch(apiFetch: AttendanceApiFetch, url: string, init?: RequestInit): Promise<Response> {
  const response = await apiFetch(url, init); if (response.ok) return response;
  if (response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Error("invalid_response");
  const reader = response.body?.getReader(); if (!reader) throw Error("invalid_response");
  const cancel = () => { void reader.cancel().catch(() => {}); }; init?.signal?.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true }); let size = 0, text = "";
  try {
    if (init?.signal?.aborted) throw Error("aborted");
    while (true) { const { done, value } = await reader.read(); if (init?.signal?.aborted) throw Error("aborted"); if (done) break;
      size += value.byteLength; if (size > 4096) throw Error("oversized_error"); text += decoder.decode(value, { stream: true }); }
    text += decoder.decode(); const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join() !== "error,ok"
      || body.ok !== false || typeof body.error !== "string") throw Error("invalid_error_envelope");
    return new Response(text, { status: response.status, headers: response.headers });
  } finally { init?.signal?.removeEventListener("abort", cancel); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Read-only discovery; the existing leave client is the only decision writer.
export class AttendanceLeaveReviewClient {
  private state: State = { phase: "idle", result: null, message: "尚未查询待审批请假。" };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(private readonly options: Options) { attendanceSelfSite(options.siteId); attendanceSelfUuid(options.ownerId); }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  pause = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: "idle", result: null, message: "待审查询已关闭；重新查询会重新核验当前权限与申请状态。" });
  };
  load = async () => {
    if (this.controller || hidden()) return;
    await this.request({ siteId: this.options.siteId, afterAt: null, afterId: null });
  };
  next = async () => {
    const cursor = this.state.result?.nextCursor;
    if (this.controller || hidden() || this.state.phase !== "ready" || !cursor) return;
    await this.request({ siteId: this.options.siteId, afterAt: cursor.at, afterId: cursor.id });
  };
  private async request(query: LeaveReviewQuery) {
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", result: null, message: "正在核对本批候选中的待审批申请…" });
    try {
      const raw = await attendanceManagementRequest((url, init) => strictFetch(this.options.apiFetch, url, init),
        "/api/merchant-enterprise/attendance/leave-review?" + leaveReviewQueryString(query), { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs ?? 12000, maxBytes: 131072, errorStatuses: LEAVE_REVIEW_ERRORS });
      if (g !== this.generation) return;
      if (hidden()) { this.pause(); return; }
      const result = parseLeaveReviewResponse(raw, query, this.options.ownerId);
      this.set({ phase: "ready", result, message: result.items.length ? "已读取本批待审线索；作出决定前仍需查看最新详情。"
        : result.nextCursor ? "本批未发现待审批申请，仍可继续查询。" : "本批未发现待审批申请，已到本次查询末尾。" });
    } catch {
      if (g !== this.generation) return;
      if (hidden()) { this.pause(); return; }
      this.set({ phase: "blocked", result: null, message: "待审读取或身份核验失败；已清除旧结果，请明确重新读取。" });
    } finally { if (g === this.generation) this.controller = null; }
  }
}
