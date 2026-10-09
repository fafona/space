import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { parseAttendanceLocationReviewCommand } from "./merchantAttendanceLocationReview";
import { discussionQueryString, parseDiscussionQuery, parseDiscussionCommand, type DiscussionAccess, type DiscussionQuery } from "./merchantAttendanceLocationDiscussion";
export type ExceptionTarget = { step: "review" | "discussion"; eventId: string | null; workerId: string | null };
export type ExceptionActivity = { busy: boolean; pendingId: string | null; receiptId: string | null; eventId: string | null; workerId: string | null; viewReady?: boolean };
export type ExceptionIdentity = { siteId: string; access: DiscussionAccess; actorId: string };
type Store = Pick<Storage, "getItem">;
function identity(i: ExceptionIdentity) { attendanceSelfSite(i.siteId); attendanceSelfUuid(i.actorId); if (i.access !== "owner" && i.access !== "self") throw Error("invalid_access"); }
function target(i: ExceptionIdentity, t: ExceptionTarget) {
  if (!["review", "discussion"].includes(t.step) || i.access === "self" && t.step !== "discussion") throw Error("invalid_step");
  if (t.eventId !== null) attendanceSelfUuid(t.eventId);
  if (i.access === "owner" ? t.workerId !== null : (t.eventId === null) !== (t.workerId === null)) throw Error("invalid_worker");
  if (t.workerId !== null) attendanceSelfUuid(t.workerId); return { step: t.step, eventId: t.eventId, workerId: t.workerId };
}
const object = (v: unknown, keys: string[]) => {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join() !== [...keys].sort().join()) throw Error("invalid_pending");
  return v as Record<string, unknown>;
};
export function exceptionWorkspaceRecovery(storage: Store, i: ExceptionIdentity): ExceptionTarget | null {
  identity(i); const found: ExceptionTarget[] = [];
  if (i.access === "owner") {
    const raw = storage.getItem(`faolla:attendance:location-review:v1:${i.siteId}:${i.actorId}`);
    if (raw !== null) {
      if (raw.length > 4096) throw Error("invalid_pending");
      const p = object(JSON.parse(raw), ["siteId", "ownerId", "command"]);
      if (p.siteId !== i.siteId || p.ownerId !== i.actorId) throw Error("invalid_pending");
      const c = object(p.command, ["eventId", "operationId", "expectedRevision", "outcome", "note"]);
      const { command } = parseAttendanceLocationReviewCommand({ siteId: i.siteId, ...c });
      found.push({ step: "review", eventId: command.eventId, workerId: null });
    }
  }
  const raw = storage.getItem(`faolla:attendance:discussion:v1:${i.siteId}:${i.access}:${i.actorId}`);
  if (raw !== null) {
    if (raw.length > 4096) throw Error("invalid_pending");
    const p = object(JSON.parse(raw), ["actorId", "query", "command"]);
    if (p.actorId !== i.actorId) throw Error("invalid_pending");
    const q = object(p.query, ["siteId", "access", "mode", "eventId", "expectedWorkerId", "operationId"]);
    if (q.siteId !== i.siteId || q.access !== i.access || q.mode !== "detail" || q.operationId !== null) throw Error("invalid_pending");
    const query = parseDiscussionQuery(`https://local.invalid/?${discussionQueryString(q as unknown as DiscussionQuery)}`);
    const c = object(p.command, ["eventId", "operationId", "expectedRevision", "note"]);
    const { command } = parseDiscussionCommand({ siteId: i.siteId, access: i.access, expectedWorkerId: query.expectedWorkerId, ...c });
    if (query.mode !== "detail" || command.eventId !== query.eventId) throw Error("invalid_pending");
    found.push({ step: "discussion", eventId: command.eventId, workerId: query.expectedWorkerId });
  }
  if (found.length > 1) throw Error("conflicting_pending");
  return found[0] ?? null;
}
/** Navigation only; recovered note text is validated but never held in navigation
 * state, copied to another step, or written back to recovery storage. */
export class AttendanceExceptionWorkspace {
  private state: { token: number; target: ExceptionTarget | null; selected: Pick<ExceptionTarget, "eventId" | "workerId">; busy: boolean; pendingId: string | null; dirty: boolean; blocked: boolean;
    requested: ExceptionTarget | "close" | null; message: string } = { token: 0, target: null, selected: { eventId: null, workerId: null }, busy: false, pendingId: null, dirty: false, blocked: false, requested: null, message: "正在检查本页待确认操作。" };
  private listeners = new Set<() => void>(); private sent: string | null = null; private receipt: string | null = null;
  constructor(private readonly i: ExceptionIdentity, private readonly storage: () => Store) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private open(t: ExceptionTarget, recovery = false) {
    this.sent = null; this.receipt = null;
    this.set({ target: target(this.i, t), selected: { eventId: t.eventId, workerId: t.workerId }, token: this.state.token + 1, busy: true, pendingId: null, dirty: false, blocked: false, requested: null,
      message: recovery ? "先核对原记录的原操作；不会自动重发。" : t.step === "review" ? "内部核查意见仅负责人可见，不会自动成为员工可见回复。" : "此页内容向员工公开；不会复制内部备注，也不会自动修改核查结论。" });
  }
  initialize = () => {
    if (this.state.target) return;
    try { identity(this.i); const recovery = exceptionWorkspaceRecovery(this.storage(), this.i);
      this.open(recovery ?? { step: this.i.access === "owner" ? "review" : "discussion", eventId: null, workerId: null }, !!recovery);
    } catch { this.set({ blocked: true, message: "恢复存储不可读或操作冲突。未删除原编号、未发起新的核查或说明。" }); }
  };
  report = (token: number, a: ExceptionActivity) => {
    if (token !== this.state.token || !this.state.target) return;
    if (a.pendingId) this.sent = a.pendingId;
    const saved = !!a.receiptId && !a.pendingId && (this.sent ? this.sent === a.receiptId : this.receipt !== a.receiptId);
    if (a.receiptId) this.receipt = a.receiptId; if (saved) this.sent = null;
    // IDs come from a fully parsed authorized child result, not a note or arbitrary form input.
    const updated = a.eventId ? target(this.i, { ...this.state.target, eventId: a.eventId, workerId: this.i.access === "self" ? a.workerId : null })
      : a.viewReady && !a.busy && !a.pendingId ? { eventId: null, workerId: null } : this.state.selected;
    // Do not mutate initial props when a child finishes reading: that would reinitialize
    // the child, clear its list/form, and possibly select an old event after a new search.
    this.set({ selected: { eventId: updated.eventId, workerId: updated.workerId }, busy: a.busy, pendingId: a.pendingId, ...(saved ? { dirty: false } : {}) });
  };
  edit = () => { if (!this.state.busy && !this.state.pendingId) this.set({ dirty: true, requested: null }); };
  cancel = () => this.set({ requested: null });
  externalLeaveMessage = (): string | null => {
    // Inspect storage at the moment of navigation as well as the child report:
    // a submission can persist its operation before the React effect reports it.
    let recovery: ExceptionTarget | null;
    try { recovery = exceptionWorkspaceRecovery(this.storage(), this.i); }
    catch { return "待确认操作的恢复存储暂不可读或存在冲突。离开不会删除原编号，也不会撤销已发送的操作；未提交文字不会保存。重新进入后请先核对。是否仍要离开？"; }
    if (this.state.pendingId || recovery) return "操作的结果仍待确认。离开不会撤销已发送的操作，也不会删除原编号；请在此标签页重新进入并核对结果，不要重复提交。是否仍要离开？";
    if (this.state.dirty) return "有尚未提交的文字。离开将丢弃这些输入，不会删除已提交的记录。是否仍要离开？";
    if (this.state.busy) return "正在读取考勤资料。离开将停止等待，重新进入时会重新核验权限和结果。是否仍要离开？";
    return null;
  };
  // User-initiated outer navigation only. This does not clear drafts, touch
  // recovery storage or intercept forced authorization changes / sign-out.
  confirmExternalLeave = (confirm: (message: string) => boolean, parentWarning?: string): boolean => {
    const message = this.externalLeaveMessage();
    const combined = parentWarning ? `${parentWarning}\n\n${message ?? "是否仍要离开？"}` : message;
    return combined === null || confirm(combined);
  };
  requiresLeaveWarning = () => {
    if (this.state.dirty || this.state.pendingId || this.state.busy) return true;
    try { return !!exceptionWorkspaceRecovery(this.storage(), this.i); } catch { return true; }
  };
  navigate = (request: ExceptionTarget | "close", discard = false): boolean => {
    if (request !== "close") target(this.i, request);
    if (this.state.busy || this.state.pendingId) { this.set({ requested: null, message: "请先核对当前读取或待确认操作，不能换记录／步骤另起提交。" }); return false; }
    if (this.state.blocked && request === "close") return true;
    let recovery;
    try { recovery = exceptionWorkspaceRecovery(this.storage(), this.i); }
    catch { this.set({ message: "原操作或存储需核对，未切换、未删除。", requested: null }); return false; }
    if (this.state.dirty && !discard) { this.set({ requested: request, message: "有尚未提交的文字，是否放弃这些输入再切换？已发送操作不会删除。" }); return false; }
    if (recovery) { this.open(recovery, true); return false; }
    if (request === "close") return true;
    this.open(request); return false;
  };
}
