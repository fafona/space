import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parsePeriodClosureV2Query, parsePeriodClosureV2Response, periodClosureV2QueryString,
  type PeriodClosureV2ListItem, type PeriodClosureV2Query, type PeriodClosureV2Result } from "./merchantAttendancePeriodClosureV2";

export const RETENTION_PERIODS_V2_API = "/api/merchant-enterprise/attendance/period-closures-v2";
export const RETENTION_PERIODS_V2_BYTE_LIMIT = 131072;
export type AttendanceRetentionPeriodsV2ClientOptions = {
  siteId: string; actorId: string; workerId: string; fromDate: string; throughDate: string;
  apiFetch: AttendanceApiFetch; enabled: boolean; isCurrentAuth: () => boolean; timeoutMs?: number;
};
export type RetentionPeriodArtifactSelection = Readonly<{
  siteId: string; actorId: string; workerId: string; employeeId: string; employeeAuthUserId: string; periodId: string;
  fromDate: string; throughDate: string; version: number; artifactId: string; sourceFingerprint: string; artifactSha256: string;
}>;
type Page = Extract<PeriodClosureV2Result, { kind: "list" | "versions" }>;
export type AttendanceRetentionPeriodsV2ClientState = Readonly<{
  phase: "idle" | "loading" | "ready" | "blocked"; query: PeriodClosureV2Query | null;
  result: Page | null; selectedPeriod: PeriodClosureV2ListItem | null; message: string;
}>;
type Lease = { generation: number; controller: AbortController; deadline: number };
const hidden = () => typeof document !== "undefined" && document.hidden;
const savedScopeKeys = ["periodId", "workerId", "employeeId", "employeeAuthUserId", "fromDate", "throughDate", "timeZone", "startAt", "endAt"] as const;
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Discovery only. No storage, archive bodies, retention mutation or fallback to v1.
 * A selected version supplies an artifact ID, never authority to preserve it. */
export class AttendanceRetentionPeriodsV2Client {
  private readonly options: AttendanceRetentionPeriodsV2ClientOptions;
  private readonly firstQuery: PeriodClosureV2Query;
  private state: AttendanceRetentionPeriodsV2ClientState = freeze({ phase: "idle", query: null, result: null,
    selectedPeriod: null, message: "请明确读取长期周期；此处只查找归档，不提交保全或删除。" });
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private disposed = false;
  constructor(options: AttendanceRetentionPeriodsV2ClientOptions) {
    this.firstQuery = freeze(parsePeriodClosureV2Query({ siteId: options.siteId, access: "owner", workerId: options.workerId,
      fromDate: options.fromDate, throughDate: options.throughDate, mode: "list", periodId: null, operationId: null, version: null, cursor: null }));
    attendanceSelfUuid(options.actorId);
    if (typeof options.enabled !== "boolean" || typeof options.apiFetch !== "function" || typeof options.isCurrentAuth !== "function"
      || options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 12000)) throw Error("invalid_options");
    this.options = Object.freeze({ ...options });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<AttendanceRetentionPeriodsV2ClientState>) {
    const next = this.state = freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) { if (this.state !== next) break; try { listener(); } catch { /* Observers confer no permission. */ } }
  }
  pause = () => {
    const generation = ++this.generation, previous = this.controller; this.controller = null; previous?.abort();
    if (generation === this.generation) this.publish({ phase: "idle", query: null, result: null, selectedPeriod: null,
      message: "归档列表已清除；返回后请明确重新读取，不自动翻页。" });
  };
  dispose = () => { if (this.disposed) return; this.disposed = true; this.pause(); this.listeners.clear(); };
  private current() { try { return !this.disposed && this.options.enabled && !hidden() && this.options.isCurrentAuth() === true; } catch { return false; } }
  private usable() { if (this.current()) return true; this.pause(); return false; }
  private guard(l: Lease) {
    if (l.generation === this.generation && !this.current()) this.pause();
    if (performance.now() >= l.deadline) l.controller.abort();
    if (l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted) throw Error("expired_read");
  }
  private async request(q: PeriodClosureV2Query, l: Lease): Promise<Page> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (error: Error) => void;
    const stopped = new Promise<never>((_, fail) => { reject = fail; });
    const abort = () => { reject(Error("aborted_read")); void reader?.cancel().catch(() => {}); };
    const timer = setTimeout(() => { l.controller.abort(); abort(); }, Math.max(0, l.deadline - performance.now()));
    l.controller.signal.addEventListener("abort", abort, { once: true });
    const run = async () => {
      this.guard(l);
      const response = await this.options.apiFetch(`${RETENTION_PERIODS_V2_API}?${periodClosureV2QueryString(q)}`, {
        method: "GET", headers: { Accept: "application/json" }, cache: "no-store", redirect: "error", signal: l.controller.signal });
      try { this.guard(l); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      const length = response.headers.get("content-length");
      if (response.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
        || length !== null && (!/^\d+$/.test(length) || Number(length) > RETENTION_PERIODS_V2_BYTE_LIMIT)) {
        void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
      }
      reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
      const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
      try {
        while (true) { const part = await reader.read(); this.guard(l); if (part.done) break;
          bytes += part.value.byteLength; if (bytes > RETENTION_PERIODS_V2_BYTE_LIMIT) throw Error("response_too_large");
          text += decoder.decode(part.value, { stream: true }); }
        text += decoder.decode();
      } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Aborted reader may still be settling. */ } reader = undefined; }
      this.guard(l); if (length !== null && Number(length) !== bytes) throw Error("invalid_length");
      const result = parsePeriodClosureV2Response(parseCaptureBrowserJson(text), q, { ownerId: this.options.actorId, authUserId: this.options.actorId }).data;
      if (result.kind !== "list" && result.kind !== "versions") throw Error("invalid_mode");
      this.guard(l); return result;
    };
    try { return await Promise.race([run(), stopped]); }
    finally { clearTimeout(timer); l.controller.signal.removeEventListener("abort", abort); }
  }
  private async read(q: PeriodClosureV2Query, selectedPeriod: PeriodClosureV2ListItem | null) {
    if (!this.usable() || this.controller) return;
    const l: Lease = { generation: ++this.generation, controller: new AbortController(), deadline: performance.now() + (this.options.timeoutMs ?? 12000) };
    this.controller = l.controller;
    try {
      this.publish({ phase: "loading", query: null, result: null, selectedPeriod, message: "正在重新核验权限与本页归档目录…" }); this.guard(l);
      const result = await this.request(q, l); this.guard(l);
      if (result.kind === "versions" && (!selectedPeriod || savedScopeKeys.some(key => result.period[key] !== selectedPeriod[key]))) throw Error("saved_scope_changed");
      this.publish({ phase: "ready", query: q, result, selectedPeriod, message: result.kind === "list"
        ? "已读取本页相交周期；请选择保存周期，再明确读取版本。" : "已读取本页版本元数据；多个版本可能复用同一归档，选择后另行核对单条资料。" });
    } catch {
      if (l.generation === this.generation) {
        if (!this.current()) this.pause();
        else this.publish({ phase: "blocked", query: null, result: null, selectedPeriod: null,
          message: "无法核验本页权限、身份或完整目录；旧显示已清除，未改用旧协议或提交任何操作。" });
      }
    } finally { if (l.generation === this.generation && this.controller === l.controller) this.controller = null; }
  }
  list = async () => { await this.read(this.firstQuery, null); };
  nextPeriods = async () => {
    const s = this.state; if (!this.usable() || s !== this.state || s.phase !== "ready" || s.result?.kind !== "list" || !s.result.nextCursor || !s.query) return;
    await this.read(freeze(parsePeriodClosureV2Query({ ...s.query, cursor: s.result.nextCursor })), null);
  };
  openPeriod = async (periodId: string) => {
    const s = this.state; if (!this.usable() || s !== this.state || s.phase !== "ready" || s.result?.kind !== "list") return;
    const row = s.result.items.find(item => item.periodId === periodId); if (!row) return;
    const q = freeze(parsePeriodClosureV2Query({ ...this.firstQuery, workerId: row.workerId, fromDate: row.fromDate,
      throughDate: row.throughDate, mode: "versions", periodId: row.periodId }));
    await this.read(q, row);
  };
  nextVersions = async () => {
    const s = this.state; if (!this.usable() || s !== this.state || s.phase !== "ready" || s.result?.kind !== "versions" || !s.result.nextCursor || !s.query || !s.selectedPeriod) return;
    await this.read(freeze(parsePeriodClosureV2Query({ ...s.query, cursor: s.result.nextCursor })), s.selectedPeriod);
  };
  selectVersion = (version: number): RetentionPeriodArtifactSelection | null => {
    const s = this.state, generation = this.generation;
    if (!this.usable() || s !== this.state || this.controller || s.phase !== "ready" || s.result?.kind !== "versions" || !s.selectedPeriod) return null;
    const item = s.result.items.find(row => row.version === version); if (!item) return null;
    const p = s.selectedPeriod;
    const selected = freeze({ siteId: this.options.siteId, actorId: this.options.actorId, workerId: p.workerId,
      employeeId: p.employeeId, employeeAuthUserId: p.employeeAuthUserId, periodId: p.periodId, fromDate: p.fromDate, throughDate: p.throughDate,
      version: item.version, artifactId: item.artifactId, sourceFingerprint: item.sourceFingerprint, artifactSha256: item.artifactSha256 });
    return this.usable() && generation === this.generation && s === this.state ? selected : null;
  };
}
