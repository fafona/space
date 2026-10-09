import { attendanceSelfSite, attendanceSelfUuid, parseAttendanceSelfCommand } from "./merchantAttendanceSelf";
import { attendancePendingKey, type AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { onsiteClockPendingKey, type OnsiteCodeMetadata } from "./merchantAttendanceOnsiteClockClient";
import { decodeOnsiteToken } from "./merchantAttendanceOnsiteQrBrowser";
import type { OnsiteClaims, OnsiteCommand } from "./merchantAttendanceOnsiteQr";
import type { SelfScheduleSelection } from "./merchantAttendanceSelfSchedule";
import { captureBrowserExact as exact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parseOnsiteScheduleHttpResult, ONSITE_SCHEDULE_ERRORS, ONSITE_SCHEDULE_BYTE_LIMIT, type OnsiteScheduleHttpResult } from "./merchantAttendanceOnsiteSchedule";

export type OnsiteScheduleStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type OnsiteSchedulePending = Readonly<{ version: 1; siteId: string; authUserId: string; command: OnsiteCommand; selection: SelfScheduleSelection | null }>;
export type OnsiteScheduleClientState = Readonly<{ phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked" | "storage_error";
  result: OnsiteScheduleHttpResult | null; pending: OnsiteSchedulePending | null; code: OnsiteCodeMetadata | null; message: string }>;
export type OnsiteScheduleClientOptions = { siteId: string; authUserId: string; enabled: boolean; apiFetch: AttendanceApiFetch;
  storage: () => OnsiteScheduleStorage; randomId?: () => string; now?: () => number; timeoutMs?: number; canStart?: () => boolean };
type Lease = { generation: number; controller: AbortController };
const endpoint = "/api/merchant-enterprise/attendance/onsite-schedule";
const hidden = () => typeof document !== "undefined" && document.hidden;
class StorageFailure extends Error {}
function freeze<T>(v: T): T { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function selection(raw: unknown): SelfScheduleSelection | null {
  if (raw === null) return null; const v = exact(raw, ["slotId", "revision"]);
  if (typeof v.revision !== "number" || !Number.isSafeInteger(v.revision) || Object.is(v.revision, -0) || v.revision < 1 || v.revision > 9007199254740990) throw Error("invalid_selection");
  return { slotId: attendanceSelfUuid(v.slotId), revision: v.revision };
}
function command(raw: unknown, siteId: string): OnsiteCommand {
  const v = exact(raw, ["expectedWorkerId", "expectedEmployeeId", "operationId", "locationId", "action", "expectedSequence"]);
  const c = { ...parseAttendanceSelfCommand({ siteId, expectedWorkerId: v.expectedWorkerId, operationId: v.operationId,
    locationId: v.locationId, action: v.action, expectedSequence: v.expectedSequence }).command, expectedEmployeeId: attendanceSelfUuid(v.expectedEmployeeId) };
  if (c.action !== "clock_in") throw Error("invalid_action"); return c;
}
export function onsiteSchedulePendingKey(siteId: string, authUserId: string) {
  if (siteId.length !== 8) throw Error("invalid_site");
  return `faolla:attendance:onsite-schedule:v1:${attendanceSelfSite(siteId)}:${attendanceSelfUuid(authUserId)}`;
}
export function parseOnsiteSchedulePending(raw: string, siteId: string, authUserId: string): OnsiteSchedulePending {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 4096) throw Error("invalid_pending");
  const p = exact(parseCaptureBrowserJson(raw), ["version", "siteId", "authUserId", "command", "selection"]);
  if (p.version !== 1 || p.siteId !== siteId || p.authUserId !== authUserId) throw Error("pending_identity");
  return freeze({ version: 1, siteId, authUserId, command: command(p.command, siteId), selection: selection(p.selection) });
}
async function transport(apiFetch: AttendanceApiFetch, url: string, init: RequestInit, lease: AbortSignal, timeout: number) {
  const controller = new AbortController(), deadline = performance.now() + timeout;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (e: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectCancel = reject; });
  const cancel = (code: string) => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error(code)); };
  const abort = () => cancel("aborted"), timer = setTimeout(() => cancel("timeout"), timeout);
  lease.addEventListener("abort", abort, { once: true });
  const check = () => { if (lease.aborted || controller.signal.aborted || performance.now() >= deadline) throw Error("aborted_or_timeout"); };
  const run = async () => {
    check(); const response = await apiFetch(url, { ...init, signal: controller.signal, cache: "no-store", redirect: "error" });
    check(); if (response.redirected || response.ok && response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
    }
    reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try { while (true) { const { done, value } = await reader.read(); check(); if (done) break;
      bytes += value.byteLength; if (bytes > (response.status === 200 ? ONSITE_SCHEDULE_BYTE_LIMIT : 4096)) throw Error("oversized_response"); text += decoder.decode(value, { stream: true }); }
      text += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    check(); const raw = parseCaptureBrowserJson(text); check();
    if (response.status !== 200) {
      const e = exact(raw, ["ok", "error"]);
      if (e.ok === false && typeof e.error === "string" && Object.hasOwn(ONSITE_SCHEDULE_ERRORS, e.error) && ONSITE_SCHEDULE_ERRORS[e.error] === response.status) throw Error(e.error);
      throw Error("invalid_error_response");
    }
    return { raw, check };
  };
  try { return await Promise.race([run(), cancelled]); } finally { clearTimeout(timer); lease.removeEventListener("abort", abort); }
}
/** Only explicit clock-in. The QR capability is private ephemeral memory, never
 * a snapshot or pending field. GET candidates describe the default location,
 * not a verified scanner/terminal; the existing server QR checks remain final. */
export class AttendanceOnsiteScheduleClient {
  readonly storageKey: string;
  private readonly options: Required<OnsiteScheduleClientOptions>;
  private state: OnsiteScheduleClientState = freeze({ phase: "loading", result: null, pending: null, code: null, message: "正在检查现场选班恢复编号…" });
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private loaded = false;
  private raw: string | null = null;
  private pending: OnsiteSchedulePending | null = null;
  private token: string | null = null;
  private claims: OnsiteClaims | null = null;
  private codeGeneration = 0;
  private codeTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(input: OnsiteScheduleClientOptions) {
    const c = { ...input }, timeoutMs = c.timeoutMs ?? 12000;
    if (typeof c.enabled !== "boolean" || typeof c.storage !== "function" || typeof c.apiFetch !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000
      || c.randomId !== undefined && typeof c.randomId !== "function" || c.now !== undefined && typeof c.now !== "function" || c.canStart !== undefined && typeof c.canStart !== "function") throw Error("invalid_options");
    this.storageKey = onsiteSchedulePendingKey(c.siteId, c.authUserId);
    this.options = Object.freeze({ ...c, siteId: attendanceSelfSite(c.siteId), authUserId: attendanceSelfUuid(c.authUserId), timeoutMs,
      randomId: c.randomId ?? (() => crypto.randomUUID()), now: c.now ?? Date.now, canStart: c.canStart ?? (() => true) });
  }
  getSnapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private publish(patch: Partial<OnsiteScheduleClientState>) {
    const state = this.state = freeze({ ...this.state, ...patch, pending: this.pending });
    for (const f of [...this.listeners]) { if (this.state !== state) break; try { f(); } catch { /* Observers do not authorize a write. */ } }
  }
  private forgetCode() { this.codeGeneration++; this.token = null; this.claims = null; if (this.codeTimer !== null) clearTimeout(this.codeTimer); this.codeTimer = null; }
  clearCode = () => { this.forgetCode(); this.publish({ code: null }); };
  pause = () => {
    const g = ++this.generation, controller = this.controller; this.controller = null; controller?.abort(); this.forgetCode();
    if (g === this.generation) this.publish({ result: null, code: null, phase: this.state.phase === "storage_error" ? "storage_error" : this.pending ? "unconfirmed" : "idle",
      message: "已清除现场码和可见资料；原编号保留。返回后明确读取，不自动扫码或提交。" });
  };
  private begin(): Lease | null { if (hidden()) { this.pause(); return null; } if (this.controller) return null;
    const lease = { generation: ++this.generation, controller: new AbortController() }; this.controller = lease.controller; return lease; }
  private guard(l: Lease) { if (l.generation === this.generation && hidden()) this.pause();
    if (l.generation !== this.generation || this.controller !== l.controller || l.controller.signal.aborted) throw Error("aborted"); }
  private release(l: Lease) { if (l.generation === this.generation && l.controller === this.controller) this.controller = null; }
  private stored(l: Lease) {
    try { this.guard(l); const storage = this.options.storage(); this.guard(l); const raw = storage.getItem(this.storageKey); this.guard(l);
      if (raw !== null && typeof raw !== "string") throw Error("invalid_storage"); return { storage, raw }; }
    catch { throw new StorageFailure("storage_unavailable"); }
  }
  private load(l: Lease) {
    const { raw } = this.stored(l); if (this.loaded) { if (raw !== this.raw) throw new StorageFailure("storage_changed"); return; }
    try { const pending = raw === null ? null : parseOnsiteSchedulePending(raw, this.options.siteId, this.options.authUserId); this.guard(l);
      this.pending = pending; this.raw = raw; this.loaded = true; } catch { throw new StorageFailure("invalid_pending"); }
  }
  private verify(l: Lease) { const s = this.stored(l); if (s.raw !== this.raw) throw new StorageFailure("storage_changed"); return s.storage; }
  private settle(l: Lease) {
    try { const storage = this.verify(l); this.guard(l); storage.removeItem(this.storageKey); this.guard(l);
      if (this.stored(l).raw !== null) throw Error("not_cleared"); this.raw = null; this.pending = null; }
    catch { throw new StorageFailure("pending_not_cleared"); }
  }
  private allowPost(l: Lease, employeeId: string) {
    const storage = this.verify(l), site = this.options.siteId;
    for (const key of [onsiteClockPendingKey(site, this.options.authUserId), attendancePendingKey(site, employeeId),
      `faolla:attendance:self-schedule:v1:${site}:${employeeId}`, `faolla:attendance:location-clock:v1:${site}:${employeeId}`,
      `faolla:attendance:self-schedule-adoption:v1:${site}:${employeeId}`,
      `faolla:attendance:location-schedule:v1:${site}:${employeeId}`, `faolla:attendance:notice:v1:${site}:self:${employeeId}`]) {
      this.guard(l); const raw = storage.getItem(key); this.guard(l); if (raw !== null) throw Error("other_channel_pending");
    }
    const allowed = this.options.canStart(); this.guard(l); if (!allowed || !this.options.enabled) throw Error("start_not_allowed");
  }
  blocksOtherActions = () => {
    const g = this.generation;
    try { if (hidden() || !this.loaded || this.pending || this.controller || this.state.phase === "storage_error") return true;
      const value = this.options.storage().getItem(this.storageKey); return g !== this.generation || hidden() || value !== null; } catch { return true; }
  };
  private currentCode() {
    if (hidden() || !this.token || !this.claims) throw Error("attendance_qr_invalid");
    const c = this.claims, now = this.options.now(), location = this.pending?.command.locationId ?? this.state.result?.clock.locationId;
    if (!Number.isSafeInteger(now) || now < c.issuedAtMs || c.siteId !== this.options.siteId || location && c.locationId !== location) throw Error("attendance_qr_invalid");
    if (now >= c.expiresAtMs) throw Error("attendance_qr_expired"); return c;
  }
  setCode = (token: string | null): boolean => {
    if (this.controller || hidden()) return false;
    const lease = this.generation, expectedVersion = this.codeGeneration + 1;
    const current = () => lease === this.generation && expectedVersion === this.codeGeneration && !this.controller && !hidden();
    const abandoned = () => { if (this.codeGeneration === expectedVersion) this.forgetCode(); return false; };
    this.clearCode(); if (!current()) return abandoned(); if (token === null) return true;
    try { if (!this.options.enabled) throw Error("start_not_allowed"); this.claims = decodeOnsiteToken(token); this.token = token;
      const c = this.currentCode(); if (!current()) return abandoned();
      const delay = Math.max(1, c.expiresAtMs - this.options.now()); if (!current()) return abandoned();
      this.codeTimer = setTimeout(() => { if (this.codeGeneration === expectedVersion) {
        // Read generations do not extend a capability's lifetime. Expiry also
        // invalidates an in-flight preflight, while a reentrant pause wins.
        const expiryGeneration = this.generation;
        this.clearCode(); if (expiryGeneration === this.generation && this.codeGeneration === expectedVersion + 1 && !hidden())
          this.publish({ message: "现场码已过期，请重新扫码；原选择和恢复编号不变。" });
      } }, delay);
      this.publish({ code: { siteId: c.siteId, terminalId: c.terminalId, locationId: c.locationId, issuedAtMs: c.issuedAtMs, expiresAtMs: c.expiresAtMs }, message: "现场码只在内存暂存；请明确选班并确认上班，服务端会再次核验。" });
      return current() || abandoned();
    } catch {
      if (!current()) return abandoned(); this.clearCode();
      if (lease === this.generation && this.codeGeneration === expectedVersion + 1 && !this.controller && !hidden())
        this.publish({ message: "现场码无效、过期或地点不符，请重新扫描当前现场码。" });
      return false;
    }
  };
  private failed(error: unknown, l: Lease) {
    if (l.generation !== this.generation) return; if (hidden()) { this.pause(); return; } this.forgetCode();
    const qr = error instanceof Error && error.message.startsWith("attendance_qr_");
    this.publish({ result: null, code: null, phase: error instanceof StorageFailure ? "storage_error" : this.pending ? "unconfirmed" : "blocked",
      message: error instanceof StorageFailure ? "恢复存储不可用或已变化；未覆盖原号，暂不提交。" : this.pending
        ? "结果尚未确认，原编号和原选择已保留。先只读核对；确需重试时重新扫码，不换编号或改走旧上班。"
        : qr ? "现场码已失效或地点不符，尚未确认打卡；请重新核对并扫码。" : "本次未能可靠核对身份、状态或排班。请明确重新读取；不会自动提交。" });
  }
  initialize = async () => {
    const l = this.begin(); if (!l) return;
    try { this.load(l); this.guard(l); this.forgetCode(); this.publish({ result: null, code: null, phase: this.pending ? "unconfirmed" : "idle",
      message: this.pending ? "发现现场选班原编号；请明确读取核对，无需现场码。" : "请先明确读取默认地点的本人排班；候选不是现场证明。" }); }
    catch (error) { this.failed(error, l); } finally { this.release(l); }
  };
  private async request(l: Lease, c: OnsiteCommand | null, token: string | null, selected: SelfScheduleSelection | null = null) {
    const operationId = c ? null : this.pending?.command.operationId ?? null;
    const params = new URLSearchParams({ siteId: this.options.siteId }); if (operationId) params.set("operationId", operationId);
    this.guard(l); const { raw, check } = await transport(this.options.apiFetch, c ? endpoint : `${endpoint}?${params}`, c ? {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId: this.options.siteId, token, command: c, selection: selected }),
    } : { method: "GET", headers: { Accept: "application/json" } }, l.controller.signal, this.options.timeoutMs);
    this.guard(l); const expected = c ?? this.pending?.command;
    const result = parseOnsiteScheduleHttpResult(raw, { siteId: this.options.siteId, operationId, command: c, authUserId: this.options.authUserId,
      ...(expected ? { expectedWorkerId: expected.expectedWorkerId, employeeId: expected.expectedEmployeeId } : {}),
      ...(c || this.pending ? { selection: c ? selected : this.pending!.selection } : {}) }); check(); this.guard(l); return result;
  }
  private accept(result: OnsiteScheduleHttpResult, l: Lease) {
    this.guard(l); this.verify(l); const c = result.clock, p = this.pending;
    if (p) {
      if (c.workerId !== p.command.expectedWorkerId || c.employeeId !== p.command.expectedEmployeeId) throw Error("identity_changed");
      if (c.receipt) {
        if (c.receipt.action !== "clock_in" || c.receipt.operationId !== p.command.operationId || c.receipt.locationId !== p.command.locationId
          || c.receipt.sequence !== p.command.expectedSequence + 1 || !result.association || !result.adoption
          || JSON.stringify(result.association.selection) !== JSON.stringify(p.selection)) throw Error("receipt_mismatch");
        this.settle(l); this.forgetCode();
      } else if (c.state.sequence > p.command.expectedSequence) { this.settle(l); this.forgetCode(); }
      else if (c.state.sequence < p.command.expectedSequence) throw Error("sequence_mismatch");
    }
    this.guard(l); this.publish({ result, code: this.token ? this.state.code : null, phase: this.pending ? "unconfirmed" : "ready",
      message: this.pending ? "暂未查到原号收据，不证明没有提交。原选择保留；重试需新现场码。" : c.receipt ? "现场上班原号收据已核验；选择和核准引用独立列示。" : "已读取默认地点本人候选；尚未核验现场码，不代表在场。" });
  }
  read = async () => {
    const l = this.begin(); if (!l) return;
    try { this.load(l); if (!this.options.enabled && !this.pending) return;
      this.publish({ phase: "loading", result: null, message: "正在只读核对本人排班与原编号…" }); this.guard(l);
      const result = await this.request(l, null, null); this.accept(result, l);
    } catch (error) { this.failed(error, l); } finally { this.release(l); }
  };
  submit = async (selected: SelfScheduleSelection | null) => { if (!this.pending && this.state.phase === "ready" && this.state.result) await this.send(selected, false); };
  retry = async () => { if (this.pending && this.options.enabled) await this.send(this.pending.selection, true); };
  private async send(rawSelection: SelfScheduleSelection | null, retry: boolean) {
    const before = this.state.result, l = this.begin(); if (!l) return;
    try {
      this.load(l); const selected = selection(rawSelection), p = this.pending;
      if (retry ? !p : p || !before) throw Error("invalid_pending");
      this.allowPost(l, p?.command.expectedEmployeeId ?? before!.clock.employeeId); this.currentCode(); this.guard(l); const codeVersion = this.codeGeneration;
      if (!retry && selected && !before!.choices.entries.some(s => s.id === selected.slotId && s.revision === selected.revision)) throw Error("selection_not_listed");
      this.publish({ phase: "loading", result: null, message: "上班前再次核对本人、原号和选择；仍须有效现场码。" }); this.guard(l);
      const current = await this.request(l, null, null); this.accept(current, l); this.guard(l);
      if (retry && this.pending !== p) return;
      const c = current.clock; this.allowPost(l, c.employeeId);
      if (codeVersion !== this.codeGeneration) throw Error("code_changed");
      const claims = this.currentCode(); this.guard(l);
      if (!current.moduleEnabled || !current.selectionEnabled || !c.locationId || c.state.status !== "off" || c.locationId !== claims.locationId) throw Error("start_not_allowed");
      const original = p?.command;
      if (original ? c.workerId !== original.expectedWorkerId || c.employeeId !== original.expectedEmployeeId || c.locationId !== original.locationId || c.state.sequence !== original.expectedSequence
        : c.workerId !== before!.clock.workerId || c.employeeId !== before!.clock.employeeId || c.locationId !== before!.clock.locationId || c.state.sequence !== before!.clock.state.sequence
          || selected && !current.choices.entries.some(s => s.id === selected.slotId && s.revision === selected.revision)) throw Error("context_changed");
      if (!retry) {
        const intent = command({ operationId: this.options.randomId(), expectedWorkerId: c.workerId, expectedEmployeeId: c.employeeId,
          locationId: c.locationId, action: "clock_in", expectedSequence: c.state.sequence }, this.options.siteId); this.guard(l); this.allowPost(l, c.employeeId);
        const storage = this.verify(l); this.pending = freeze({ version: 1, siteId: this.options.siteId, authUserId: this.options.authUserId, command: intent, selection: selected }); this.raw = JSON.stringify(this.pending);
        try { storage.setItem(this.storageKey, this.raw); this.guard(l); this.verify(l); } catch { throw new StorageFailure("pending_not_saved"); }
      }
      const pending = this.pending; if (!pending) throw Error("pending_missing");
      this.publish({ phase: "saving", result: null, message: "正在提交现场上班、原选择与核准引用；请勿重复操作。" }); this.guard(l); this.allowPost(l, c.employeeId);
      if (codeVersion !== this.codeGeneration) throw Error("code_changed"); this.currentCode(); this.guard(l);
      const token = this.token!; this.forgetCode(); const consumedVersion = this.codeGeneration;
      this.publish({ code: null }); this.guard(l); this.allowPost(l, c.employeeId);
      if (consumedVersion !== this.codeGeneration) throw Error("code_changed");
      const saved = await this.request(l, pending.command, token, pending.selection); this.accept(saved, l);
    } catch (error) { this.failed(error, l); } finally { this.release(l); }
  }
}
