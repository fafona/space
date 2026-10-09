import { parseDiscussionCommand, parseDiscussionQuery, type DiscussionAccess, type DiscussionCommand, type DiscussionEntry, type DiscussionItem, type DiscussionQuery } from "../../src/lib/merchantAttendanceLocationDiscussion";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
import type { AttendanceReviewState } from "../../src/lib/merchantAttendanceLocationReview";
export const discussionId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const discussionSite = "99990001", discussionEmployee = discussionId(1), discussionOwner = discussionId(2), discussionWorker = discussionId(3), discussionEvent = discussionId(4);
export const discussionListQuery = (access: DiscussionAccess = "self"): Extract<DiscussionQuery, { mode: "list" }> => ({ siteId: discussionSite, access, mode: "list", expectedWorkerId: null,
  fromAt: "2026-09-01T00:00:00.000000Z", toAt: "2026-10-01T00:00:00.000000Z", asOf: null, cursorAt: null, cursorId: null });
export const discussionDetailQuery = (access: DiscussionAccess = "self", operationId: string | null = null): Extract<DiscussionQuery, { mode: "detail" }> => ({ siteId: discussionSite, access, mode: "detail", expectedWorkerId: access === "self" ? discussionWorker : null, eventId: discussionEvent, operationId });
// Synthetic transport, not an auth/RPC substitute. SQL permissions have native tests.
export function createDiscussionFixture(options: { reviewState?: () => AttendanceReviewState } = {}) {
  let mode = "normal", canPost = true, enabled = true;
  const calls: { url: string; method: string; body?: string }[] = [], history: DiscussionEntry[] = [];
  const receipts = new Map<string, { entry: DiscussionEntry; command: DiscussionCommand; author: DiscussionAccess }>();
  const item = (): DiscussionItem => ({ eventId: discussionEvent, workerId: discussionWorker, workerName: "合成员工", action: "clock_in", occurredAt: "2026-09-28T10:00:00.000001Z",
    reason: "denied", reviewState: options.reviewState?.() ?? "reviewed", revision: history.length, lastAuthor: history.at(-1)?.author ?? null });
  const base = (access: DiscussionAccess) => ({ ok: true, siteId: discussionSite, access, employeeId: access === "self" ? discussionEmployee : null,
    workerId: access === "self" ? discussionWorker : null, canPost: access === "owner" || canPost, moduleEnabled: enabled, asOf: "2026-09-30T12:00:00.000000Z" });
  const detail = (access: DiscussionAccess = "self", operationId: string | null = null) => {
    const r = operationId ? receipts.get(operationId) : null;
    return { ...base(access), mode: "detail" as const, item: item(), history: history.slice(-20).reverse(), historyTruncated: history.length > 20,
      receipt: r && r.author === access ? { ...r.entry, operationId } : null };
  };
  const reply = (body: unknown, status = 200) => Response.json(body, { status });
  const apiFetch: AttendanceApiFetch = async (url, init = {}) => {
    const method = init.method ?? "GET"; calls.push({ url, method, body: init.body as string | undefined });
    const wait = () => new Promise<Response>(() => {});
    if (mode === "timeout" || mode === "post_timeout" && method === "POST") return wait();
    if (mode === "offline" || mode === "unsent" && method === "POST") throw Error("network");
    if (mode === "denied") return reply({ ok: false, error: "attendance_access_denied" }, 403);
    if (mode === "rebound") return reply({ ok: false, error: "attendance_worker_changed" }, 409);
    if (method === "POST") {
      if (mode === "reject") return reply({ ok: false, error: "attendance_access_denied" }, 403);
      const p = parseDiscussionCommand(JSON.parse(String(init.body))), previous = receipts.get(p.command.operationId);
      if (previous && (previous.author !== p.access || JSON.stringify(previous.command) !== JSON.stringify(p.command))) return reply({ ok: false, error: "attendance_operation_conflict" }, 409);
      if (!previous) {
        if (!canPost && p.access === "self") return reply({ ok: false, error: "attendance_access_denied" }, 403);
        if (p.command.expectedRevision !== history.length) return reply({ ok: false, error: "attendance_version_conflict" }, 409);
        const entry = { revision: history.length + 1, author: p.access, note: p.command.note, recordedAt: `2026-09-30T11:00:00.${String(history.length + 1).padStart(6, "0")}Z` };
        history.push(entry); receipts.set(p.command.operationId, { entry, command: p.command, author: p.access });
      }
      if (mode === "lost") throw Error("response_lost");
      return reply(detail(p.access, p.command.operationId));
    }
    const q = parseDiscussionQuery(new URL(url, "https://local.invalid").href);
    const result = q.mode === "detail" ? detail(q.access, q.operationId) : { ...base(q.access), mode: "list", asOf: q.asOf ?? base(q.access).asOf,
      items: mode === "empty_page" && !q.cursorId ? [] : [item()], scanned: mode === "empty_page" && !q.cursorId ? 50 : 1,
      nextCursor: mode === "empty_page" && !q.cursorId ? { occurredAt: "2026-09-28T11:00:00.000001Z", id: discussionId(50) } : null };
    if (mode === "wrong_actor") result.employeeId = discussionId(999);
    if (mode === "wrong_site") result.siteId = "99990002";
    return reply(result);
  };
  return { apiFetch, calls, history, detail, mode: (v: string) => { mode = v; }, canPost: (v: boolean) => { canPost = v; }, enabled: (v: boolean) => { enabled = v; }, writes: () => receipts.size };
}
