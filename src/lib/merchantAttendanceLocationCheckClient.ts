import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { ATTENDANCE_LOCATION_CHECK_ERRORS, attendanceLocationVersions, parseAttendanceLocationQuery,
  parseAttendanceLocationPolicy, parseAttendanceLocationCheckResult, parseAttendancePosition,
  type AttendanceLocationTarget, type AttendanceLocationCheckResult } from "./merchantAttendanceLocationCheck";
import type { AttendancePosition } from "./merchantAttendanceLocation";

type OneShotGeolocation = Pick<Geolocation, "getCurrentPosition">;
export type AttendanceLocationEnvironment = {
  isSecureContext: () => boolean; isVisible: () => boolean; geolocation: () => OneShotGeolocation | null;
};
// Access to navigator is lazy, after the explicit user action and server check.
export const attendanceBrowserLocationEnvironment: AttendanceLocationEnvironment = {
  isSecureContext: () => globalThis.isSecureContext === true,
  isVisible: () => typeof document !== "undefined" && document.visibilityState === "visible",
  geolocation: () => typeof navigator === "undefined" ? null : navigator.geolocation ?? null,
};
// getCurrentPosition has no cancel API. Ignore late callbacks after our deadline
// or abort; do not start a second native request until the first callback returns.
// This set stores neither coordinates nor identity and survives panel remounts.
const nativePending = new WeakSet<OneShotGeolocation>();
export function acquireAttendancePosition(geo: OneShotGeolocation, signal: AbortSignal, timeoutMs = 15_000): Promise<AttendancePosition> {
  if (signal.aborted) return Promise.reject(Error("aborted"));
  if (nativePending.has(geo)) return Promise.reject(Error("location_device_pending"));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) return Promise.reject(Error("location_invalid_timeout"));
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error: string | null, position?: AttendancePosition) => {
      if (finished) return; finished = true;
      clearTimeout(timer); signal.removeEventListener("abort", onAbort);
      if (error) reject(Error(error)); else resolve(position!);
    };
    const onAbort = () => finish("aborted");
    const timer = setTimeout(() => finish("location_timeout"), timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    nativePending.add(geo);
    try {
      geo.getCurrentPosition(raw => {
        nativePending.delete(geo);
        if (finished || signal.aborted) return;
        try {
          if (!Number.isSafeInteger(raw.timestamp)) throw Error("bad_time");
          const position = parseAttendancePosition({ latitude: raw.coords.latitude, longitude: raw.coords.longitude,
            accuracyMeters: raw.coords.accuracy, capturedAt: new Date(raw.timestamp).toISOString() });
          finish(null, position);
        } catch { finish("location_invalid_position"); }
      }, error => {
        nativePending.delete(geo);
        finish(error?.code === 1 ? "location_denied" : error?.code === 3 ? "location_timeout" : "location_unavailable");
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: Math.min(10_000, timeoutMs) });
    } catch { nativePending.delete(geo); finish("location_unavailable"); }
  });
}

type State = { phase: "idle" | "authorizing" | "locating" | "checking" | "ready" | "blocked"; result: AttendanceLocationCheckResult | null; message: string };
const endpoint = "/api/merchant-enterprise/attendance/location-check";
export class AttendanceLocationCheckClient {
  private state: State = { phase: "idle", result: null, message: "点击后才获取一次位置；范围检查不会提交打卡。" };
  private generation = 0;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  private readonly target: AttendanceLocationTarget;
  constructor(private readonly options: AttendanceLocationTarget & {
    employeeId: string; apiFetch: AttendanceApiFetch; environment: AttendanceLocationEnvironment; timeoutMs?: number; locationTimeoutMs?: number;
  }) {
    attendanceSelfUuid(options.employeeId);
    this.target = parseAttendanceLocationQuery(`https://local.invalid/?${new URLSearchParams({ siteId: options.siteId, expectedWorkerId: options.expectedWorkerId, expectedLocationId: options.expectedLocationId })}`);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  invalidate = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ phase: "idle", result: null, message: "已清空范围检查。再次点击才会重新获取位置；未提交打卡。" });
  };
  private async request(url: string, init: RequestInit, signal: AbortSignal) {
    const body = await attendanceManagementRequest(this.options.apiFetch, url, init, { signal, timeoutMs: this.options.timeoutMs,
      maxBytes: 8192, errorStatuses: ATTENDANCE_LOCATION_CHECK_ERRORS });
    if (body.moduleEnabled !== true) throw Error("attendance_platform_paused");
    const policy = parseAttendanceLocationPolicy(body, this.target);
    if (policy.employeeId !== this.options.employeeId) throw Error("invalid_response");
    return body;
  }
  run = async () => {
    if (this.controller) return;
    this.invalidate(); const generation = this.generation, controller = new AbortController(); this.controller = controller;
    const current = () => generation === this.generation && !controller.signal.aborted;
    try {
      const env = this.options.environment;
      if (!env.isSecureContext()) throw Error("location_insecure");
      if (!env.isVisible()) throw Error("location_hidden");
      this.set({ phase: "authorizing", message: "先核验员工、地点和范围检查权限…" });
      const policy = parseAttendanceLocationPolicy(await this.request(`${endpoint}?${new URLSearchParams(this.target)}`, {}, controller.signal), this.target);
      if (!current()) return;
      if (!env.isVisible()) throw Error("location_hidden");
      const geo = env.geolocation(); if (!geo) throw Error("location_unsupported");
      this.set({ phase: "locating", message: "正在请求一次位置（最多等待 15 秒）。取消后不会使用迟到结果。" });
      const position = await acquireAttendancePosition(geo, controller.signal, this.options.locationTimeoutMs);
      if (!current()) return;
      if (!env.isVisible()) throw Error("location_hidden");
      this.set({ phase: "checking", message: "正在重新核验权限和地点配置、计算范围…" });
      const body = await this.request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...this.target, ...attendanceLocationVersions(policy), position }) }, controller.signal);
      if (!current()) return;
      if (!env.isVisible()) throw Error("location_hidden");
      const result = parseAttendanceLocationCheckResult(body, this.target);
      if (Object.entries(attendanceLocationVersions(policy)).some(([key, value]) => result[key as keyof typeof policy] !== value)) throw Error("attendance_location_policy_changed");
      this.set({ phase: "ready", result, message: locationResultMessage(result) });
    } catch (error) {
      if (current()) this.set({ phase: "blocked", result: null, message: locationCheckMessage(error) });
    } finally { if (generation === this.generation) this.controller = null; }
  };
}
function locationResultMessage(result: AttendanceLocationCheckResult) {
  const reason = result.reason === "inside" ? "本次报告的位置及精度落在范围内，但不能证明本人在场。" : result.reason === "outside" ? "本次报告的位置在范围外，需要人工核实，不据此判定缺勤。" : result.reason === "uncertain" ? "定位误差覆盖范围边界，无法确定是否在现场。" : result.reason === "stale" ? "位置已过期，请重新检查。" : "设备报告的定位时间超前，请核对手机时间后重试。";
  return `${reason} 未提交打卡。`;
}
function locationCheckMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    location_denied: "定位权限未获准。可联系负责人使用其他已开放的方式或登记实际工作情况，不据此判定缺勤。",
    location_timeout: "定位等待已超时，未提交位置或打卡。可手动重试或联系负责人。",
    location_device_pending: "上一次系统定位请求尚未结束，请先处理浏览器的权限提示，稍后再试。",
    location_unavailable: "设备暂时无法确定位置，未提交打卡。可换到信号较好的地方或联系负责人。",
    location_unsupported: "此浏览器不支持定位。请在支持定位的浏览器中重新登录，或联系负责人使用其他方式。",
    location_insecure: "请从 HTTPS 安全入口使用定位；未获取位置或提交打卡。",
    location_hidden: "页面已隐藏，检查已停止；返回后需要手动重新检查。",
    location_invalid_position: "设备返回的位置或时间无法使用，未提交打卡。",
    attendance_not_available: "定位范围检查尚未开放，不会请求设备位置。",
    attendance_location_check_disabled: "企业尚未启用定位范围检查，不会请求设备位置。",
    attendance_location_not_configured: "当前地点未配置定位范围，不会请求设备位置。",
    attendance_location_policy_changed: "员工或地点规则已变化，请重新检查；本次没有提交打卡。",
    attendance_platform_paused: "平台已暂停此通路，不会继续检查位置或提交打卡。",
    attendance_worker_changed: "考勤人员绑定已变化，请联系负责人核对。",
    attendance_rate_limited: "检查过于频繁，请稍后手动重试。",
  };
  return Object.hasOwn(messages, code) ? messages[code] : "无法完成权限或范围检查；未确认定位，也未提交打卡。请重新登录或联系负责人。";
}
