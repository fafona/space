import { attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { ONSITE_QR_ERRORS, ONSITE_QR_LIFETIME_MS } from "./merchantAttendanceOnsiteQr";
import { buildOnsiteScanUrl, decodeOnsiteToken } from "./merchantAttendanceOnsiteQrBrowser";
import { terminalRecoveryUrlFromOrigin } from "./merchantAttendanceTerminalRecovery";

export const ONSITE_DISPLAY_API = "/api/merchant-enterprise/attendance/onsite-code";
const REFRESH_MS = 30_000, WINDOW_MS = 60_000, BUTTON_DELAY_MS = 5_000, DEADLINE_MS = 10_000;
type Timer = ReturnType<typeof setTimeout>;
export type OnsiteDisplayCode = {
  image: string; siteId: string; terminalId: string; locationId: string; moduleEnabled: boolean;
  issuedAtMs: number; expiresAtMs: number;
};
export type OnsiteDisplayState = {
  phase: "idle" | "loading" | "ready" | "paused" | "error";
  code: OnsiteDisplayCode | null; remainingSeconds: number; retryAfterSeconds: number; canRefresh: boolean; message: string;
};
const INITIAL: OnsiteDisplayState = { phase: "idle", code: null, remainingSeconds: 0, retryAfterSeconds: 0,
  canRefresh: false, message: "正在准备门店现场码…" };
type Options = {
  scanOrigin: string | null;
  request?: (signal: AbortSignal) => Promise<unknown>;
  render?: (url: string) => Promise<string>;
  wallNow?: () => number;
  monotonicNow?: () => number;
  setTimer?: (fn: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

/** Local PNG only: no remote QR service, analytics, download or durable cache. */
export async function createOnsiteDisplayQr(url: string): Promise<string> {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toDataURL(url, { width: 512, margin: 4, errorCorrectionLevel: "M", color: { dark: "#0f172a", light: "#ffffff" } });
}

export function parseOnsiteDisplayIssue(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("attendance_qr_invalid");
  const value = raw as Record<string, unknown>;
  const keys = ["ok", "moduleEnabled", "siteId", "terminalId", "locationId", "issuedAtMs", "expiresAtMs", "token"];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || value.ok !== true || typeof value.moduleEnabled !== "boolean" || typeof value.token !== "string") throw Error("attendance_qr_invalid");
  const claims = decodeOnsiteToken(value.token);
  if (value.siteId !== claims.siteId || value.terminalId !== claims.terminalId || value.locationId !== claims.locationId
    || value.issuedAtMs !== claims.issuedAtMs || value.expiresAtMs !== claims.expiresAtMs) throw Error("attendance_qr_invalid");
  return { siteId: claims.siteId, terminalId: claims.terminalId, locationId: claims.locationId,
    issuedAtMs: claims.issuedAtMs, expiresAtMs: claims.expiresAtMs, moduleEnabled: value.moduleEnabled, token: value.token };
}

function messageFor(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "attendance_terminal_denied") return "终端凭证已失效、过期或被撤销。现场码已隐藏，请让负责人核对终端；不要在此登录员工或负责人账号。";
  if (["attendance_disabled", "attendance_settings_required", "attendance_not_available", "enterprise_management_disabled", "forbidden_origin"].includes(code))
    return "当前入口或企业考勤配置不可用。现场码已隐藏，请联系负责人核对后手动重试。";
  if (code === "attendance_location_verification_required") return "此地点需要另行定位验证，不能使用本现场码绕过。请使用企业规定的替代方式。";
  if (code === "attendance_qr_expired") return "现场码已过期并隐藏。请刷新现场码后重新扫描；这不会代员工打卡。";
  if (code === "attendance_display_clock_changed") return "设备时钟发生变化，现场码已隐藏。请核对设备时间后手动刷新。";
  if (code === "attendance_rate_limited") return "刷新较频繁，现场码已隐藏。请稍后手动重试，不会自动连续请求。";
  return "未能取得可用的现场码，旧码已隐藏。请检查网络后手动重试；本页没有提交任何员工打卡。";
}

/** One visible/online display. Raw tokens/URLs exist only during one request and
 * local rendering; public state contains the transient image and public IDs. */
export class AttendanceOnsiteDisplayClient {
  private state = INITIAL;
  private readonly origin: string | null;
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private timer: Timer | null = null;
  private generation = 0;
  private disposed = false;
  private visible = false;
  private online = false;
  private automatic = false;
  private nextAutomatic = Infinity;
  private attempts: number[] = [];
  private validUntilMonotonic = 0;
  private previousWall: number | null = null;
  private previousMonotonic: number | null = null;
  constructor(private readonly options: Options) {
    const loginUrl = terminalRecoveryUrlFromOrigin(options.scanOrigin);
    this.origin = loginUrl ? new URL(loginUrl).origin : null;
  }
  getSnapshot = () => this.state;
  getServerSnapshot = () => INITIAL;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private wall = () => (this.options.wallNow ?? Date.now)();
  private mono = () => (this.options.monotonicNow ?? (() => performance.now()))();
  private later = (fn: () => void, delay: number) => (this.options.setTimer ?? setTimeout)(fn, delay);
  private cancelTimer = (timer: Timer) => (this.options.clearTimer ?? clearTimeout)(timer);
  private active = () => !this.disposed && this.visible && this.online;
  private set(patch: Partial<OnsiteDisplayState>) {
    this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener();
  }
  private clearScheduled() { if (this.timer !== null) this.cancelTimer(this.timer); this.timer = null; }
  private nextAllowed(now: number) {
    this.attempts = this.attempts.filter(at => now - at < WINDOW_MS);
    return Math.max(this.attempts.length ? this.attempts.at(-1)! + BUTTON_DELAY_MS : now,
      this.attempts.length >= 2 ? this.attempts[0] + WINDOW_MS : now);
  }
  private updateControls(now: number) {
    const wait = Math.max(0, this.nextAllowed(now) - now);
    this.set({ retryAfterSeconds: Math.ceil(wait / 1000), canRefresh: !!this.origin && this.active() && !this.controller && wait === 0 });
  }
  private invalidate(message: string, phase: "paused" | "error") {
    this.generation++; this.controller?.abort(); this.controller = null;
    this.automatic = false; this.nextAutomatic = Infinity; this.clearScheduled();
    this.set({ phase, code: null, remainingSeconds: 0, canRefresh: false, message });
  }
  private readClocks() {
    const wall = this.wall(), mono = this.mono();
    if (!Number.isFinite(wall) || !Number.isFinite(mono)
      || this.previousWall !== null && wall < this.previousWall
      || this.previousMonotonic !== null && mono < this.previousMonotonic) throw Error("attendance_display_clock_changed");
    this.previousWall = wall; this.previousMonotonic = mono;
    return { wall, mono };
  }
  private checkCurrent() {
    const { wall, mono } = this.readClocks();
    if (this.state.code) {
      const remaining = Math.min(this.state.code.expiresAtMs - wall, this.validUntilMonotonic - mono);
      if (remaining <= 0) throw Error("attendance_qr_expired");
      this.set({ remainingSeconds: Math.ceil(remaining / 1000) });
    }
    return mono;
  }
  private schedule() {
    this.clearScheduled();
    if (!this.active()) return;
    const now = this.mono(), allowed = this.nextAllowed(now);
    const automaticAt = this.automatic && !this.controller ? Math.max(this.nextAutomatic, allowed) : Infinity;
    const expiryIn = this.state.code ? Math.min(this.state.code.expiresAtMs - this.wall(), this.validUntilMonotonic - now) : Infinity;
    const controlsIn = allowed > now ? allowed - now : Infinity;
    const delay = Math.min(this.state.code || Number.isFinite(controlsIn) ? 1000 : Infinity, expiryIn, controlsIn, automaticAt - now);
    if (Number.isFinite(delay)) this.timer = this.later(() => this.tick(), Math.max(1, delay));
  }
  private tick() {
    this.timer = null;
    if (!this.active()) return;
    try {
      const now = this.checkCurrent(); this.updateControls(now);
      if (this.automatic && !this.controller && now >= this.nextAutomatic && now >= this.nextAllowed(now)) {
        void this.issue(); return;
      }
    } catch (error) {
      const renewWhenAllowed = this.automatic && error instanceof Error && error.message === "attendance_qr_expired";
      this.invalidate(messageFor(error), "error");
      if (renewWhenAllowed) {
        // An early manual refresh can exhaust the two-per-minute allowance.
        // Hide on expiry, then issue once when eligible; a network/server error
        // still stops automatic retries and requires explicit recovery.
        this.automatic = true; this.nextAutomatic = this.mono();
        this.set({ phase: "paused", message: "现场码已过期并隐藏，刷新间隔结束后将重新核对终端。" });
      }
      this.updateControls(this.mono());
    }
    this.schedule();
  }
  start = async (visible: boolean, online: boolean) => {
    this.disposed = false; this.visible = false; this.online = false;
    await this.setEnvironment(visible, online);
  };
  setEnvironment = async (visible: boolean, online: boolean) => {
    if (this.disposed) return;
    const wasActive = this.active(); this.visible = visible; this.online = online;
    if (!this.active()) {
      this.invalidate(online ? "页面已隐藏，现场码已清除。返回页面后会重新核对终端。" : "设备已离线，现场码已隐藏。恢复网络后会重新核对终端。", "paused");
      return;
    }
    if (!this.origin) { this.invalidate("未配置有效的 HTTPS 扫码入口，不能展示现场码。请让负责人核对配置。", "error"); return; }
    if (!wasActive) {
      this.automatic = true; this.nextAutomatic = this.mono();
      await this.issue();
    }
  };
  refresh = async () => {
    if (!this.active() || !this.origin || this.controller) return;
    await this.issue();
  };
  private async issue() {
    if (!this.active() || !this.origin || this.controller) return;
    const startMono = this.mono(), allowed = this.nextAllowed(startMono);
    if (startMono < allowed) { this.updateControls(startMono); this.schedule(); return; }
    // Clear the old image BEFORE any request or QR generation starts.
    const generation = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.attempts.push(startMono); this.nextAutomatic = startMono + REFRESH_MS; this.clearScheduled();
    this.previousWall = null; this.previousMonotonic = null;
    this.set({ phase: "loading", code: null, remainingSeconds: 0, canRefresh: false, message: "正在核对终端并生成新的现场码…" });
    let deadline: Timer | null = null, rejectAbort: (() => void) | null = null;
    try {
      const start = this.readClocks();
      const cancelled = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(Error("aborted"));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
        deadline = this.later(() => { reject(Error("timeout")); controller.abort(); }, DEADLINE_MS);
      });
      const render = async () => {
        const raw = await (this.options.request ?? requestOnsiteDisplay)(controller.signal);
        if (controller.signal.aborted || generation !== this.generation || !this.active()) throw Error("aborted");
        const data = parseOnsiteDisplayIssue(raw), received = this.readClocks();
        if (received.wall >= data.expiresAtMs || received.mono - start.mono >= ONSITE_QR_LIFETIME_MS) throw Error("attendance_qr_expired");
        const url = buildOnsiteScanUrl(this.origin!, data.token);
        const image = await (this.options.render ?? createOnsiteDisplayQr)(url);
        if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw Error("invalid_response");
        // No raw token or URL is retained in public component state.
        const { token: ignored, ...metadata } = data; void ignored;
        return { ...metadata, image };
      };
      const code = await Promise.race([render(), cancelled]);
      if (this.disposed || generation !== this.generation || !this.active()) return;
      const end = this.readClocks();
      this.validUntilMonotonic = Math.min(start.mono + ONSITE_QR_LIFETIME_MS, end.mono + code.expiresAtMs - end.wall);
      const remaining = Math.min(code.expiresAtMs - end.wall, this.validUntilMonotonic - end.mono);
      if (remaining <= 0) throw Error("attendance_qr_expired");
      this.automatic = true;
      this.set({ phase: "ready", code, remainingSeconds: Math.ceil(remaining / 1000), message: "用本人手机扫描现场码；本终端只展示证据，不会代员工打卡。" });
    } catch (error) {
      if (!this.disposed && generation === this.generation && this.active()) {
        this.automatic = false; this.nextAutomatic = Infinity;
        this.set({ phase: "error", code: null, remainingSeconds: 0, message: messageFor(error) });
      }
    } finally {
      if (deadline !== null) this.cancelTimer(deadline);
      if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
      if (generation === this.generation) {
        this.controller = null;
        if (this.active()) { this.updateControls(this.mono()); this.schedule(); }
      }
    }
  }
  dispose = () => {
    this.disposed = true; this.invalidate("页面已关闭，现场码已清除。", "paused");
  };
}

async function requestOnsiteDisplay(signal: AbortSignal) {
  return attendanceManagementRequest((url, init) => fetch(url, { ...init, credentials: "same-origin", redirect: "error" }),
    ONSITE_DISPLAY_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    { signal, timeoutMs: DEADLINE_MS, maxBytes: 4096, errorStatuses: { ...ONSITE_QR_ERRORS, unauthorized: 401,
      enterprise_management_disabled: 403, forbidden_origin: 403 } });
}
