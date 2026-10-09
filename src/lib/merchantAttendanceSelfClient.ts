import type { AttendanceAction, AttendanceEvent } from "@/lib/merchantAttendance";
import { attendanceActionAllowed } from "@/lib/merchantAttendanceEntitlement";
import { ATTENDANCE_SELF_ERROR_STATUS, attendanceSelfSite, attendanceSelfUuid, parseAttendanceSelfCommand,
  parseAttendanceSelfResult, type AttendanceSelfCommand, type AttendanceSelfResult } from "@/lib/merchantAttendanceSelf";

export type AttendanceApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type AttendancePending = { version: 1; siteId: string; employeeId: string; workerId: string; command: AttendanceSelfCommand };
export type AttendanceClientState = {
  phase: "loading" | "ready" | "submitting" | "unconfirmed" | "blocked" | "storage_error";
  result: (AttendanceSelfResult & { moduleEnabled: boolean }) | null;
  pending: AttendancePending | null;
  confirmed: AttendanceEvent | null;
  message: string;
  authorizationEpoch: number;
};

const EXTRA_ERRORS: Readonly<Record<string, number>> = {
  attendance_not_available: 404, unauthorized: 401, employee_password_authentication_required: 403,
  enterprise_management_disabled: 403, forbidden_origin: 403,
};
const READ_AUTHORIZATION_ERRORS: Readonly<Record<string, number>> = {
  unauthorized: 401, attendance_access_denied: 403, employee_password_authentication_required: 403,
  enterprise_management_disabled: 403, forbidden_origin: 403,
};
export function attendanceMessage(code: string): string {
  const messages: Record<string, string> = {
    attendance_not_available: "考勤功能尚未开放，请联系企业负责人。",
    attendance_platform_paused: "平台尚未开放或已暂停新考勤。仍可核对本人记录，并结束已有休息、完成下班。",
    attendance_disabled: "本企业尚未启用考勤，请联系企业负责人。",
    attendance_web_disabled: "本企业尚未启用网页打卡，请使用企业规定的打卡方式。",
    attendance_access_denied: "当前账号没有可用的考勤权限或考勤档案，请联系企业负责人。",
    attendance_location_denied: "考勤地点未启用或已变更，请联系企业负责人核对。",
    attendance_location_verification_required: "此地点需要定位验证，当前网页通路不支持，请使用企业规定的打卡方式。",
    attendance_not_employed: "当前日期不在有效在职区间内，请联系企业负责人。",
    attendance_sequence_conflict: "打卡状态已被另一笔操作更新，请核对当前状态。",
    attendance_worker_changed: "考勤档案已变化，请联系企业负责人核对后再操作。",
    attendance_operational_punch_protocol_required: "此班次需要使用“规则打卡 / 原号核对”入口。若已有待确认编号，请先在原入口核对，不要重复提交。",
    attendance_operation_conflict: "操作编号与原提交不一致，请保留此页面并联系企业负责人核查。",
    attendance_break_must_end: "请先结束休息，再进行下班打卡。",
    attendance_already_clocked_in: "已经上班，请核对当前状态。",
    attendance_not_clocked_in: "当前尚未上班，请核对当前状态。",
    attendance_not_working: "当前不在工作中，请核对当前状态。",
    attendance_not_on_break: "当前不在休息中，请核对当前状态。",
    attendance_time_reversed: "服务器时间需要核查，请联系企业负责人，暂勿重复操作。",
    attendance_rate_limited: "操作较频繁，请稍候再核对，原操作编号仍会保留。",
    unauthorized: "登录已失效，请重新登录同一员工账号后核对打卡结果。",
    employee_password_authentication_required: "请使用员工密码登录后再使用考勤。",
    enterprise_management_disabled: "本企业的企业管理权限已停用，请联系企业负责人。",
  };
  return Object.hasOwn(messages, code) ? messages[code] : "暂时无法确认服务器结果，请稍后核对；不要把网络失败视为打卡成功。";
}

export function attendancePendingKey(siteId: string, employeeId: string) {
  return `faolla:attendance:self:v1:${attendanceSelfSite(siteId)}:${attendanceSelfUuid(employeeId)}`;
}
export function parseAttendancePending(raw: string, siteId: string, employeeId: string): AttendancePending {
  if (raw.length > 2048) throw new Error("attendance_pending_invalid");
  const value = JSON.parse(raw) as AttendancePending;
  if (!value || value.version !== 1 || value.siteId !== siteId || value.employeeId !== employeeId
    || Object.keys(value).sort().join(",") !== "command,employeeId,siteId,version,workerId") throw new Error("attendance_pending_invalid");
  const { command } = parseAttendanceSelfCommand({ ...value.command, siteId });
  if (command.expectedWorkerId !== value.workerId) throw new Error("attendance_pending_invalid");
  return { version: 1, siteId, employeeId, workerId: attendanceSelfUuid(value.workerId), command };
}

class AttendanceHttpError extends Error {
  constructor(readonly code: string, readonly definitive: boolean, readonly authorizationReadRejected = false) { super(code); }
}

function attendanceIdentityRejected(error: unknown): error is AttendanceHttpError {
  return error instanceof AttendanceHttpError && error.definitive && [
    "attendance_access_denied", "attendance_worker_changed", "unauthorized",
    "employee_password_authentication_required", "enterprise_management_disabled", "forbidden_origin",
  ].includes(error.code);
}

/** One controller per membership. Persist intent before POST; never auto-submit
 * restored intent. Only a receipt or a strictly newer sequence resolves an
 * uncertain operation. Server time is authoritative; this is not offline clocking. */
export class AttendanceSelfClient {
  private state: AttendanceClientState = { phase: "loading", result: null, pending: null, confirmed: null, message: "正在读取考勤状态…", authorizationEpoch: 0 };
  private listeners = new Set<() => void>();
  private generation = 0;
  private busy = false;
  private disposed = false;
  private abort: AbortController | null = null;
  private readonly key: string;
  constructor(private readonly options: {
    siteId: string; employeeId: string; canClock: boolean; apiFetch: AttendanceApiFetch;
    storage: () => StorageLike; randomId?: () => string; timeoutMs?: number;
  }) { this.key = attendancePendingKey(options.siteId, options.employeeId); }
  getSnapshot = () => this.state;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  private set(next: Partial<AttendanceClientState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next }; for (const callback of this.listeners) callback();
  }
  private active(generation: number) { return !this.disposed && this.generation === generation; }
  dispose() { this.disposed = true; this.generation++; this.abort?.abort(); this.busy = false; }

  async initialize() {
    this.disposed = false; this.generation++; this.busy = false;
    this.set({ phase: "loading", result: null, confirmed: null, pending: null, message: "正在读取考勤状态…" });
    try {
      const raw = this.options.storage().getItem(this.key);
      const pending = raw === null ? null : parseAttendancePending(raw, this.options.siteId, this.options.employeeId);
      this.set({ pending });
    } catch { this.storageFailure(); return; }
    await this.refresh();
  }
  private storageFailure() {
    this.set({ phase: "storage_error", message: "无法安全读取或保存待确认操作。请允许浏览器会话存储；若仍异常，请保留此页面并联系企业负责人。暂不发送新打卡。" });
  }
  private rejectIdentity(error: AttendanceHttpError, invalidateRead = false) {
    // A denied read/retry cannot establish whether an earlier command committed.
    // Hide private snapshots and stop POST retries, but retain the exact intent
    // for owner review and a later authorized, read-only receipt check.
    this.set({ phase: "blocked", result: null, confirmed: null,
      message: attendanceMessage(error.code) + (this.state.pending ? " 原操作编号仍会保留，请由企业负责人核验后再核对。" : ""),
      authorizationEpoch: this.state.authorizationEpoch + (invalidateRead ? 1 : 0) });
  }
  private persist(pending: AttendancePending) {
    const raw = JSON.stringify(pending); const storage = this.options.storage();
    storage.setItem(this.key, raw);
    if (storage.getItem(this.key) !== raw) throw new Error("attendance_pending_write_failed");
  }
  private clearPending() {
    const storage = this.options.storage(); const raw = storage.getItem(this.key);
    if (raw !== null && parseAttendancePending(raw, this.options.siteId, this.options.employeeId).command.operationId !== this.state.pending?.command.operationId) {
      throw new Error("attendance_pending_changed");
    }
    storage.removeItem(this.key);
    if (storage.getItem(this.key) !== null) throw new Error("attendance_pending_clear_failed");
  }
  private async request(command: AttendanceSelfCommand | null, operationId: string | null): Promise<AttendanceSelfResult & { moduleEnabled: boolean }> {
    const controller = new AbortController(); this.abort = controller;
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 12000);
    try {
      const params = new URLSearchParams({ siteId: this.options.siteId });
      if (operationId) params.set("operationId", operationId);
      const response = await this.options.apiFetch(`/api/merchant-enterprise/attendance/self${command ? "" : `?${params}`}`, {
        method: command ? "POST" : "GET", cache: "no-store", signal: controller.signal,
        ...(command ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: this.options.siteId, ...command }) } : {}),
      });
      if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) throw new AttendanceHttpError("attendance_unavailable", false);
      const reader = response.body?.getReader(); if (!reader) throw new AttendanceHttpError("attendance_unavailable", false);
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 32768) { await reader.cancel(); throw new AttendanceHttpError("attendance_unavailable", false); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const combined = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
      const payload = JSON.parse(new TextDecoder().decode(combined));
      if (!response.ok || payload?.ok !== true) {
        const code = typeof payload?.error === "string" ? payload.error : "attendance_unavailable";
        const expected = ATTENDANCE_SELF_ERROR_STATUS[code] ?? EXTRA_ERRORS[code];
        // A denied ordinary clock read may still permit leave-history reads.
        // This epoch only invalidates old child snapshots; POST rules stay put.
        const authorizationReadRejected = command === null && !controller.signal.aborted
          && payload && typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload).sort().join() === "error,ok"
          && payload.ok === false && Object.hasOwn(READ_AUTHORIZATION_ERRORS, code) && READ_AUTHORIZATION_ERRORS[code] === response.status;
        throw new AttendanceHttpError(code, payload?.ok === false && expected === response.status && response.status < 500, !!authorizationReadRejected);
      }
      if (typeof payload.moduleEnabled !== "boolean") throw new AttendanceHttpError("attendance_unavailable", false);
      return { ...parseAttendanceSelfResult(payload, { siteId: this.options.siteId, command, operationId }), moduleEnabled: payload.moduleEnabled };
    } finally { clearTimeout(timer); if (this.abort === controller) this.abort = null; }
  }
  private accept(result: AttendanceSelfResult & { moduleEnabled: boolean }) {
    const pending = this.state.pending;
    if (pending && result.workerId !== pending.workerId) {
      this.set({ phase: "blocked", result: null, confirmed: null, message: "考勤档案已变化，原操作尚未核对。请联系企业负责人，不要再次提交。" }); return;
    }
    this.set({ result });
    if (!pending) { this.set({ phase: "ready", message: "状态已与服务器同步。" }); return; }
    if (result.receipt) {
      if (result.receipt.action !== pending.command.action || result.receipt.locationId !== pending.command.locationId) {
        this.set({ phase: "blocked", result: null, confirmed: null, message: "返回的收据与原操作不一致，请保留此页面并联系企业负责人核查。" }); return;
      }
      this.set({ confirmed: result.receipt });
      try { this.clearPending(); } catch { this.storageFailure(); return; }
      this.set({ phase: "ready", pending: null, message: "打卡已由服务器确认。" }); return;
    }
    if (result.state.sequence > pending.command.expectedSequence) {
      // Monotonic revision fence: a delayed command with the old sequence can
      // no longer commit. No receipt means this operation was not recorded.
      try { this.clearPending(); } catch { this.storageFailure(); return; }
      this.set({ phase: "ready", pending: null, message: "未找到此次操作记录，当前状态已被其他操作更新。请核对后再打卡。" }); return;
    }
    this.set({ phase: "unconfirmed", message: "尚未查到这次打卡的确认记录。请核对结果，或用原操作编号重试；暂不能发起新打卡。" });
  }
  async refresh() {
    if (this.busy || this.disposed) return;
    this.busy = true; const generation = this.generation;
    this.set({ phase: "loading", message: this.state.pending ? "正在核对原打卡结果…" : "正在读取考勤状态…" });
    try {
      const result = await this.request(null, this.state.pending?.command.operationId ?? null);
      if (this.active(generation)) this.accept(result);
    } catch (error) {
      if (this.active(generation)) {
        if (attendanceIdentityRejected(error)) this.rejectIdentity(error, error.authorizationReadRejected);
        else this.set({ phase: this.state.pending ? "unconfirmed" : "blocked", result: null,
          confirmed: null, message: attendanceMessage(error instanceof AttendanceHttpError ? error.code : "attendance_unavailable") });
      }
    } finally { if (this.active(generation)) this.busy = false; }
  }
  async submit(action: AttendanceAction) {
    if (this.busy || this.disposed || !this.options.canClock || this.state.phase !== "ready" || this.state.pending || !this.state.result?.locationId) return;
    const { result } = this.state;
    if (!attendanceActionAllowed(result.moduleEnabled, action)) return;
    const allowed = result.state.status === "off" ? ["clock_in"] : result.state.status === "break" ? ["break_end"] : ["break_start", "clock_out"];
    if (!allowed.includes(action)) return;
    try {
      const operationId = attendanceSelfUuid(this.options.randomId?.() ?? crypto.randomUUID());
      const pending: AttendancePending = { version: 1, siteId: this.options.siteId, employeeId: this.options.employeeId, workerId: result.workerId,
        command: { action, operationId, expectedWorkerId: result.workerId, locationId: result.locationId!, expectedSequence: result.state.sequence } };
      // A fresh controller may not erase intent left by another mounted instance.
      if (this.options.storage().getItem(this.key) !== null) { await this.initialize(); return; }
      this.persist(pending); this.set({ pending, confirmed: null });
    } catch { this.storageFailure(); return; }
    await this.send(true);
  }
  async retry() {
    if (this.busy || this.disposed || !this.options.canClock || !this.state.pending || this.state.phase !== "unconfirmed") return;
    // After identity rejection (or remount), only an accepted read may restore
    // the current worker snapshot. A failed refresh must not unlock a POST.
    if (!this.state.result || this.state.result.workerId !== this.state.pending.workerId) return;
    await this.send(false);
  }
  private async send(firstAttempt: boolean) {
    const pending = this.state.pending; if (!pending) return;
    try { this.persist(pending); } catch { this.storageFailure(); return; }
    this.busy = true; const generation = this.generation;
    this.set({ phase: "submitting", message: "正在提交，请勿重复操作…" });
    try {
      const result = await this.request(pending.command, null);
      if (this.active(generation)) this.accept(result);
    } catch (error) {
      if (!this.active(generation)) return;
      if (attendanceIdentityRejected(error)) { this.rejectIdentity(error); return; }
      const message = attendanceMessage(error instanceof AttendanceHttpError ? error.code : "attendance_unavailable");
      // Only the first attempt's explicit rejection proves there was no earlier
      // success. A retry rejection must NOT erase a possibly committed receipt.
      if (firstAttempt && error instanceof AttendanceHttpError && error.definitive) {
        try { this.clearPending(); } catch { this.storageFailure(); return; }
        this.set({ phase: "blocked", pending: null, result: null, message });
      } else this.set({ phase: "unconfirmed", message });
    } finally { if (this.active(generation)) this.busy = false; }
  }
}
