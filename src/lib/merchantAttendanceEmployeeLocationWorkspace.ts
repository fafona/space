import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendancePendingKey, type AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceLocationClockPendingKey, parseAttendanceLocationClockPending } from "./merchantAttendanceLocationClockClient";
import { locationSchedulePendingKey, parseLocationSchedulePending } from "./merchantAttendanceLocationScheduleClient";
import { parseNoticeCommand, parseNoticeQuery, noticeQueryString } from "./merchantAttendanceLocationNotice";
import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { ATTENDANCE_SELF_CONTEXT_ERRORS, parseAttendanceSelfContext, type AttendanceSelfContext } from "./merchantAttendanceSelfContext";
import type { LocationWorkspaceActivity } from "./merchantAttendanceLocationWorkspace";

export type EmployeeLocationStep = "clock" | "notice";
type Store = Pick<Storage, "getItem">;
type Target = { step: EmployeeLocationStep; workerId: string; locationId: string | null };
type Recovery = Target & { fingerprint: string };
type Identity = { siteId: string; employeeId: string };
const noticeKey = ({ siteId, employeeId }: Identity) => `faolla:attendance:notice:v1:${siteId}:self:${employeeId}`;
/** Checks only this identity's exact slots. No scanning, deleting or rewriting intent. */
export function hasEmployeeLocationPending(storage: Store, identity: Identity) {
  attendanceSelfSite(identity.siteId); attendanceSelfUuid(identity.employeeId);
  return storage.getItem(attendanceLocationClockPendingKey(identity.siteId, identity.employeeId)) !== null
    || storage.getItem(locationSchedulePendingKey(identity.siteId, identity.employeeId)) !== null || storage.getItem(noticeKey(identity)) !== null;
}
export function employeeLocationRecovery(storage: Store, identity: Identity): Recovery | null {
  const { siteId, employeeId } = identity;
  attendanceSelfSite(siteId); attendanceSelfUuid(employeeId);
  if (storage.getItem(attendancePendingKey(siteId, employeeId)) !== null) throw Error("basic_clock_pending");
  const clock = storage.getItem(attendanceLocationClockPendingKey(siteId, employeeId)), notice = storage.getItem(noticeKey(identity));
  const targets: Recovery[] = [];
  if (clock !== null) {
    const { intent } = parseAttendanceLocationClockPending(clock, siteId, employeeId);
    targets.push({ step: "clock", workerId: intent.expectedWorkerId, locationId: intent.locationId, fingerprint: JSON.stringify(intent) });
  }
  const schedule = storage.getItem(locationSchedulePendingKey(siteId, employeeId));
  if (schedule !== null) {
    const pending = parseLocationSchedulePending(schedule, siteId, employeeId);
    targets.push({ step: "clock", workerId: pending.intent.expectedWorkerId, locationId: pending.intent.locationId,
      fingerprint: JSON.stringify(pending) });
  }
  if (notice !== null) {
    if (notice.length > 4096) throw Error("invalid_pending");
    const p = JSON.parse(notice);
    if (!p || Object.keys(p).sort().join() !== "actorId,command,query" || p.actorId !== employeeId || !p.query || !p.command
      || Object.keys(p.query).sort().join() !== "access,expectedWorkerId,locationId,operationId,siteId"
      || Object.keys(p.command).sort().join() !== "action,expectedRevision,operationId") throw Error("invalid_pending");
    const q = parseNoticeQuery(`https://local.invalid/?${noticeQueryString(p.query)}`);
    if (q.siteId !== siteId || q.access !== "self" || q.operationId !== null) throw Error("invalid_pending");
    const parsed = parseNoticeCommand({ siteId, access: q.access, locationId: q.locationId, expectedWorkerId: q.expectedWorkerId, ...p.command });
    targets.push({ step: "notice", workerId: q.expectedWorkerId!, locationId: q.locationId, fingerprint: JSON.stringify(parsed) });
  }
  // Ambiguous independently-pending channels cannot safely be retried in parallel.
  if (targets.length > 1) throw Error("conflicting_pending_channels");
  return targets[0] ?? null;
}

/** Read-only orchestration. Children own explicit writes and their durable receipts. */
export class AttendanceEmployeeLocationWorkspace {
  private state: { phase: "idle" | "loading" | "ready" | "blocked"; token: number; target: Target | null; context: AttendanceSelfContext | null;
    childBusy: boolean; pendingId: string | null; message: string } = {
    phase: "idle", token: 0, target: null, context: null, childBusy: false, pendingId: null, message: "正在读取本人考勤身份。不会请求定位或提交打卡。",
  };
  private generation = 0; private controller: AbortController | null = null; private listeners = new Set<() => void>();
  constructor(private readonly options: Identity & { apiFetch: AttendanceApiFetch; storage: () => Store; timeoutMs?: number }) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(value: Partial<typeof this.state>) { this.state = { ...this.state, ...value }; this.listeners.forEach(fn => fn()); }
  dispose = () => { this.generation++; this.controller?.abort(); this.controller = null; };
  report = (token: number, activity: LocationWorkspaceActivity) => {
    if (token !== this.state.token || !this.state.target) return;
    this.set({ childBusy: activity.busy, pendingId: activity.pendingId });
  };
  requiresLeaveWarning = () => {
    if (this.state.pendingId || this.state.childBusy) return true;
    try { return !!employeeLocationRecovery(this.options.storage(), this.options); } catch { return true; }
  };
  initialize = async () => {
    if (this.controller || this.state.target) return;
    await this.load("clock");
  };
  navigate = async (step: EmployeeLocationStep | "close"): Promise<boolean> => {
    if (this.state.phase === "loading" || this.state.childBusy || this.state.pendingId) {
      this.set({ message: "请先完成当前读取，或在原页面核对待确认操作，不能另起一笔打卡。" }); return false;
    }
    try {
      const recovery = employeeLocationRecovery(this.options.storage(), this.options);
      if (recovery && this.state.target) { this.set({ message: "原操作仍在本页存储中，请先核对结果；不会删除或覆盖。" }); return false; }
      if (step === "close") return true;
    } catch {
      // Return to the basic screen for an unresolved basic punch, without changing any slot.
      if (step === "close" && !this.state.target) return true;
      this.set({ message: "本页恢复存储不可用或有冲突，请保留原操作，不发起新打卡。" }); return false;
    }
    await this.load(step); return false;
  };
  private async load(step: EmployeeLocationStep) {
    this.dispose(); const generation = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", target: null, context: null, childBusy: false, pendingId: null, token: this.state.token + 1 });
    try {
      const before = employeeLocationRecovery(this.options.storage(), this.options);
      const body = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/self-context?siteId=${attendanceSelfSite(this.options.siteId)}`,
        { method: "GET" }, { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 2048, errorStatuses: ATTENDANCE_SELF_CONTEXT_ERRORS });
      const context = parseAttendanceSelfContext(body, this.options.siteId);
      if (context.employeeId !== this.options.employeeId) throw Error("employee_changed");
      const recovery = employeeLocationRecovery(this.options.storage(), this.options);
      if (JSON.stringify(before) !== JSON.stringify(recovery)) throw Error("pending_changed");
      if (recovery && recovery.workerId !== context.workerId) throw Error("worker_changed");
      if (generation !== this.generation) return;
      const target = recovery ?? { step, workerId: context.workerId, locationId: context.locationId };
      this.set({ phase: "ready", context, target, childBusy: target.step === "clock" || target.locationId !== null,
        message: recovery ? "先核对原操作，不会自动重试。" : "查看告知、确认收到和定位打卡是独立操作；切换页面不会自动提交或请求位置。" });
    } catch {
      if (generation === this.generation) this.set({ phase: "blocked", target: null, context: null, childBusy: false,
        message: "无法核对当前员工身份、考勤权限或恢复存储。原操作未改动；请重新读取或返回，不会使用旧身份继续。" });
    } finally { if (generation === this.generation) this.controller = null; }
  }
}
