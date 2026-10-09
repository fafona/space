import type { AttendanceAction } from "./merchantAttendance";
import { attendanceActionAllowed } from "./merchantAttendanceEntitlement";
import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { attendanceSelfSite, attendanceSelfUuid, parseAttendanceSelfCommand } from "./merchantAttendanceSelf";
import { attendanceMessage, type AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { ONSITE_QR_ERRORS, parseOnsiteClockResult, type OnsiteClaims, type OnsiteClockResult, type OnsiteCommand } from "./merchantAttendanceOnsiteQr";
import { decodeOnsiteToken } from "./merchantAttendanceOnsiteQrBrowser";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type OnsiteClockPending = { version: 1; siteId: string; authUserId: string; command: OnsiteCommand };
export type OnsiteCodeMetadata = Pick<OnsiteClaims, "siteId" | "terminalId" | "locationId" | "issuedAtMs" | "expiresAtMs">;
export type OnsiteClockClientState = {
  phase: "loading" | "ready" | "saving" | "unconfirmed" | "confirmed" | "blocked";
  result: OnsiteClockResult | null; pending: OnsiteClockPending | null; code: OnsiteCodeMetadata | null; moduleEnabled: boolean; message: string;
};
const endpoint = "/api/merchant-enterprise/attendance/onsite-clock";
const errors: Readonly<Record<string, number>> = { ...ONSITE_QR_ERRORS, unauthorized: 401, forbidden_origin: 403,
  employee_password_authentication_required: 403, enterprise_management_disabled: 403, attendance_not_available: 404 };
const unknownMessage = "结果尚未确认，原操作编号已保留。请核对收据；不会自动重试或换编号提交。";
function message(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "attendance_qr_expired") return "现场码已过期。请重新扫描当前现场码，并核对原操作后再明确重试。";
  if (code === "attendance_qr_invalid") return "现场码无效、地点不符或设备时间不正确。请核对后重新扫描。";
  if (code === "attendance_qr_used") return "此现场码已用于本人的另一笔操作。请先核对收据，再扫描新码。";
  if (code === "attendance_terminal_denied") return "现场终端已失效，请联系负责人；原操作仍可核对。";
  return attendanceMessage(code);
}
function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("attendance_pending_invalid");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw Error("attendance_pending_invalid");
  return value;
}
function parseCommand(input: unknown, siteId: string): OnsiteCommand {
  const value = exact(input, ["expectedWorkerId", "expectedEmployeeId", "operationId", "locationId", "action", "expectedSequence"]);
  const parsed = parseAttendanceSelfCommand({ siteId, expectedWorkerId: value.expectedWorkerId, operationId: value.operationId,
    locationId: value.locationId, action: value.action, expectedSequence: value.expectedSequence });
  return { ...parsed.command, expectedEmployeeId: attendanceSelfUuid(value.expectedEmployeeId) };
}
export function onsiteClockPendingKey(siteId: string, authUserId: string): string {
  return `faolla:attendance:onsite-clock:v1:${attendanceSelfSite(siteId)}:${attendanceSelfUuid(authUserId)}`;
}
export function parseOnsiteClockPending(raw: string, siteId: string, authUserId: string): OnsiteClockPending {
  if (typeof raw !== "string" || raw.length > 2_048) throw Error("attendance_pending_invalid");
  const value = exact(JSON.parse(raw), ["version", "siteId", "authUserId", "command"]);
  if (value.version !== 1 || value.siteId !== attendanceSelfSite(siteId) || value.authUserId !== attendanceSelfUuid(authUserId)) throw Error("attendance_pending_invalid");
  return { version: 1, siteId, authUserId, command: parseCommand(value.command, siteId) };
}
function samePending(left: OnsiteClockPending, right: OnsiteClockPending): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Intent-only recovery, scoped to the authenticated principal and company.
 * Decoding a QR is only a UX check; the server authenticates it and SQL decides
 * freshness/current authority. No scanned capability is persisted or published
 * through snapshots, and restoring intent can only cause a GET. */
export class AttendanceOnsiteClockClient {
  private state: OnsiteClockClientState = { phase: "loading", result: null, pending: null, code: null, moduleEnabled: false, message: "正在核对本人考勤…" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private codeGeneration = 0;
  private disposed = false;
  private busy = false;
  private storageReady = false;
  private controller: AbortController | null = null;
  private codeTimer: ReturnType<typeof setTimeout> | null = null;
  private token: string | null = null;
  private claims: OnsiteClaims | null = null;
  readonly storageKey: string;
  constructor(private readonly options: {
    siteId: string; authUserId: string; apiFetch: AttendanceApiFetch; storage: () => StorageLike; randomId?: () => string; now?: () => number;
  }) { this.storageKey = onsiteClockPendingKey(options.siteId, options.authUserId); }
  getSnapshot = () => this.state;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  private set(update: Partial<OnsiteClockClientState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    for (const callback of this.listeners) callback();
  }
  private active(generation: number): boolean { return !this.disposed && generation === this.generation; }
  private forgetCode() {
    this.codeGeneration++; this.token = null; this.claims = null;
    if (this.codeTimer !== null) clearTimeout(this.codeTimer);
    this.codeTimer = null;
  }
  clearCode = () => { this.forgetCode(); this.set({ code: null }); };
  dispose = () => {
    this.generation++; this.controller?.abort(); this.controller = null; this.busy = false; this.storageReady = false;
    this.forgetCode();
    this.set({ phase: "blocked", result: null, code: null, moduleEnabled: false, message: "页面已离开；未确认操作保留，返回后请重新核对。" });
    this.disposed = true;
  };
  private storageFailure() {
    this.storageReady = false; this.clearCode();
    this.set({ phase: "blocked", result: null, moduleEnabled: false,
      message: "不能安全读取或保存原操作编号。请恢复本标签页存储后重新核对；暂不发送打卡。" });
  }
  private stored(): OnsiteClockPending | null {
    const raw = this.options.storage().getItem(this.storageKey);
    return raw === null ? null : parseOnsiteClockPending(raw, this.options.siteId, this.options.authUserId);
  }
  private restore() {
    const pending = this.stored();
    if (this.state.pending && (!pending || !samePending(this.state.pending, pending))) throw Error("attendance_pending_changed");
    this.storageReady = true; this.set({ pending });
  }
  private saveNew(pending: OnsiteClockPending) {
    const storage = this.options.storage();
    // No await between ownership check, write and readback. Other controllers in
    // this tab cannot replace an existing intent. The UI uses sessionStorage.
    if (storage.getItem(this.storageKey) !== null) throw Error("attendance_pending_changed");
    const raw = JSON.stringify(pending); storage.setItem(this.storageKey, raw);
    if (storage.getItem(this.storageKey) !== raw) throw Error("attendance_pending_write_failed");
    this.set({ pending });
  }
  private assertOwned(pending: OnsiteClockPending) {
    const stored = this.stored();
    if (!stored || !samePending(stored, pending)) throw Error("attendance_pending_changed");
  }
  private clearOwned(pending: OnsiteClockPending) {
    const storage = this.options.storage(), stored = this.stored();
    if (stored && !samePending(stored, pending)) throw Error("attendance_pending_changed");
    if (stored) storage.removeItem(this.storageKey);
    if (storage.getItem(this.storageKey) !== null) throw Error("attendance_pending_clear_failed");
  }
  private currentCode(): OnsiteClaims {
    if (!this.token || !this.claims) throw Error("attendance_qr_invalid");
    const now = this.options.now?.() ?? Date.now(), claims = this.claims;
    if (!Number.isSafeInteger(now) || now < claims.issuedAtMs) throw Error("attendance_qr_invalid");
    if (now >= claims.expiresAtMs) throw Error("attendance_qr_expired");
    const location = this.state.pending?.command.locationId ?? this.state.result?.locationId;
    if (claims.siteId !== this.options.siteId || location && location !== claims.locationId) throw Error("attendance_qr_invalid");
    return claims;
  }
  setCode = (token: string | null): boolean => {
    if (this.disposed || this.busy) return false;
    this.clearCode(); if (token === null) return true;
    try {
      this.claims = decodeOnsiteToken(token); this.token = token;
      const claims = this.currentCode(), version = this.codeGeneration;
      this.codeTimer = setTimeout(() => {
        if (!this.disposed && version === this.codeGeneration) {
          this.clearCode(); this.set({ message: "现场码已过期，请重新扫描。原操作编号不受影响。" });
        }
      }, Math.max(1, claims.expiresAtMs - (this.options.now?.() ?? Date.now())));
      this.set({ code: { siteId: claims.siteId, terminalId: claims.terminalId, locationId: claims.locationId,
        issuedAtMs: claims.issuedAtMs, expiresAtMs: claims.expiresAtMs }, message: "现场码已读取；请明确选择打卡操作。服务端会再次核验。" });
      return true;
    } catch (error) { this.clearCode(); this.set({ message: message(error) }); return false; }
  };
  initialize = async () => {
    this.generation++; this.controller?.abort(); this.controller = null; this.busy = false; this.disposed = false;
    this.clearCode(); this.set({ phase: "loading", result: null, pending: null, moduleEnabled: false, message: "正在核对原操作和本人考勤…" });
    await this.read();
  };
  private async request(command: OnsiteCommand | null, token: string | null, operationId: string | null, signal: AbortSignal) {
    const query = new URLSearchParams({ siteId: this.options.siteId }); if (operationId) query.set("operationId", operationId);
    const body = await attendanceManagementRequest(this.options.apiFetch, command ? endpoint : `${endpoint}?${query}`, command
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: this.options.siteId, token, command }) }
      : { method: "GET" }, { signal, maxBytes: 32_768, errorStatuses: errors });
    return { result: parseOnsiteClockResult(body, { siteId: this.options.siteId, command, operationId }), moduleEnabled: body.moduleEnabled as boolean };
  }
  private accept(response: { result: OnsiteClockResult; moduleEnabled: boolean }) {
    const { result, moduleEnabled } = response, pending = this.state.pending;
    if (pending && (result.workerId !== pending.command.expectedWorkerId || result.employeeId !== pending.command.expectedEmployeeId)) throw Error("attendance_worker_changed");
    if (!pending) {
      const previous = this.state.result;
      if (previous && (result.workerId !== previous.workerId || result.employeeId !== previous.employeeId || result.locationId !== previous.locationId)) this.clearCode();
      this.set({ phase: "ready", result, moduleEnabled, message: "状态已同步。请扫描当前现场码，打卡需本人明确确认。" }); return;
    }
    const receipt = result.receipt, command = pending.command;
    if (receipt && (receipt.operationId !== command.operationId || receipt.action !== command.action || receipt.locationId !== command.locationId
      || receipt.sequence !== command.expectedSequence + 1)) throw Error("attendance_operation_conflict");
    if (receipt || result.state.sequence > command.expectedSequence) {
      try { this.clearOwned(pending); } catch { this.storageFailure(); return; }
      this.clearCode();
      this.set({ phase: receipt ? "confirmed" : "ready", result, moduleEnabled, pending: null,
        message: receipt ? "打卡已由服务器确认。" : "未找到原操作收据，当前状态已被其他操作更新；旧操作已不能写入，请核对后再操作。" }); return;
    }
    if (result.state.sequence < command.expectedSequence) throw Error("attendance_sequence_conflict");
    this.set({ phase: "unconfirmed", result, moduleEnabled, message: unknownMessage });
  }
  private failure(error: unknown) {
    const code = error instanceof Error ? error.message : "";
    this.clearCode();
    this.set({ phase: this.state.pending && errors[code] !== 401 && errors[code] !== 403 ? "unconfirmed" : "blocked",
      result: null, moduleEnabled: false, message: `${message(error)}${this.state.pending ? " 原操作编号仍保留，请核对收据。" : ""}` });
  }
  read = async () => {
    if (this.busy || this.disposed) return;
    try { this.restore(); } catch { this.storageFailure(); return; }
    this.busy = true; const generation = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", message: this.state.pending ? "正在核对原操作收据…" : "正在读取本人考勤…" });
    try {
      const response = await this.request(null, null, this.state.pending?.command.operationId ?? null, controller.signal);
      if (this.active(generation)) this.accept(response);
    } catch (error) { if (this.active(generation)) this.failure(error); }
    finally { if (this.active(generation)) { this.busy = false; this.controller = null; } }
  };
  /** null is ONLY an explicit retry of the persisted command, never a toggle. */
  punch = async (action: AttendanceAction | null) => {
    if (this.busy || this.disposed || !this.storageReady) return;
    const pending = this.state.pending, before = this.state.result;
    if (action === null ? !pending : pending || !before || !["ready", "confirmed"].includes(this.state.phase)) return;
    try { this.currentCode(); } catch (error) { this.clearCode(); this.set({ message: message(error) }); return; }
    const codeVersion = this.codeGeneration;
    this.busy = true; const generation = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", message: "提交前核对当前身份和原操作收据…" });
    try {
      try { this.restore(); } catch { this.storageFailure(); return; }
      // Discovering somebody else's pending intent can only trigger recovery.
      if (!pending && this.state.pending) {
        const response = await this.request(null, null, this.state.pending.command.operationId, controller.signal);
        if (this.active(generation)) this.accept(response); return;
      }
      const response = await this.request(null, null, pending?.command.operationId ?? null, controller.signal);
      if (!this.active(generation)) return;
      this.accept(response);
      if (!this.storageReady || pending && !this.state.pending) return;
      if (codeVersion !== this.codeGeneration) return;
      const claims = this.currentCode(), result = response.result, intendedAction = pending?.command.action ?? action!;
      if (result.workerId !== (pending?.command.expectedWorkerId ?? before?.workerId)
        || result.employeeId !== (pending?.command.expectedEmployeeId ?? before?.employeeId)) throw Error("attendance_worker_changed");
      if (!pending && result.state.sequence !== before?.state.sequence) {
        this.clearCode(); this.set({ message: "打卡状态已变化，请核对最新状态并重新扫描后再操作。" }); return;
      }
      const allowed = result.state.status === "off" ? ["clock_in"] : result.state.status === "break" ? ["break_end"] : ["break_start", "clock_out"];
      if (!allowed.includes(intendedAction)) throw Error("attendance_sequence_conflict");
      if (!attendanceActionAllowed(response.moduleEnabled, intendedAction)) throw Error("attendance_platform_paused");
      if (claims.locationId !== result.locationId) throw Error("attendance_qr_invalid");
      let intent = pending;
      if (!intent) {
        intent = { version: 1, siteId: this.options.siteId, authUserId: this.options.authUserId, command: parseCommand({
          expectedWorkerId: result.workerId, expectedEmployeeId: result.employeeId, operationId: this.options.randomId?.() ?? crypto.randomUUID(),
          locationId: claims.locationId, action: intendedAction, expectedSequence: result.state.sequence,
        }, this.options.siteId) };
        try { this.saveNew(intent); } catch { this.storageFailure(); return; }
      }
      try { this.assertOwned(intent); } catch { this.storageFailure(); return; }
      if (!this.active(generation)) return;
      if (codeVersion !== this.codeGeneration) {
        this.set({ phase: "unconfirmed", message: "现场码已清除，尚未发送此操作。原操作编号已保存，请先核对再重新扫描。" }); return;
      }
      this.currentCode();
      // Readback is complete before the capability is consumed and POST starts.
      const token = this.token!; this.clearCode();
      this.set({ phase: "saving", message: "正在提交，请勿重复操作；以服务器收据为准…" });
      const saved = await this.request(intent.command, token, null, controller.signal);
      if (this.active(generation)) this.accept(saved);
    } catch (error) { if (this.active(generation)) this.failure(error); }
    finally { if (this.active(generation)) { this.busy = false; this.controller = null; } }
  };
}
