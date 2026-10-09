import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange, attendanceLocalDate } from "./merchantAttendanceTime";
import type { AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { parsePersonalRulesBody, parsePersonalRulesCommand, parsePersonalRulesQuery, parsePersonalRulesResponse,
  personalRulesQueryString, samePersonalRulesCommand, PERSONAL_RULES_ERRORS,
  type PersonalRulesCommand, type PersonalRulesQuery, type PersonalRulesResponse } from "./merchantAttendancePersonalRules";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PersonalRulesClientOptions = { siteId: string; ownerId: string; workerId: string; apiFetch: AttendanceApiFetch;
  storage: () => StorageLike; randomId?: () => string; timeoutMs?: number };
export type PersonalRulesPending = { siteId: string; ownerId: string; workerId: string; query: PersonalRulesQuery; command: PersonalRulesCommand };
export type PersonalRulesClientState = { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  result: PersonalRulesResponse | null; pending: PersonalRulesPending | null; message: string };
type Lease = { generation: number; controller: AbortController };
const endpoint = "/api/merchant-enterprise/attendance/personal-rules";
const hidden = () => typeof document !== "undefined" && document.hidden;
const definitive = new Set(["attendance_invalid_request", "attendance_version_conflict", "attendance_personal_rule_future_required",
  "attendance_personal_rule_overlap", "attendance_personal_rule_already_withdrawn", "attendance_personal_rule_worker_inactive", "attendance_platform_paused"]);
class Rejected extends Error {}
class StorageChanged extends Error {}
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(frozen); Object.freeze(value);
  }
  return value;
}

// This local transport validates the complete error envelope before classifying
// any rejection as definitive. Header and UTF-8 body reads share one deadline.
async function requestJson(apiFetch: AttendanceApiFetch, url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, rejectCancel: (error: Error) => void = () => {};
  const cancel = (code: string) => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error(code)); };
  const abort = () => cancel("aborted");
  const deadline = new Promise<never>((_, reject) => { rejectCancel = reject; });
  const timer = setTimeout(() => cancel("timeout"), timeoutMs);
  signal.addEventListener("abort", abort, { once: true });
  const run = async () => {
    if (signal.aborted) throw Error("aborted");
    const response = await apiFetch(url, { ...init, cache: "no-store", signal: controller.signal });
    if (controller.signal.aborted || response.redirected
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      void response.body?.cancel().catch(() => {}); throw Error("invalid_response");
    }
    reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw Error("aborted");
        if (done) break;
        bytes += value.byteLength;
        if (bytes > (response.ok ? 131072 : 4096)) throw Error("oversized_response");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined;
    }
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("invalid_response");
    if (!response.ok) {
      const error = body as Record<string, unknown>;
      if (Object.keys(error).sort().join() === "error,ok" && error.ok === false && typeof error.error === "string"
        && Object.hasOwn(PERSONAL_RULES_ERRORS, error.error) && PERSONAL_RULES_ERRORS[error.error] === response.status) throw new Rejected(error.error);
      throw Error("invalid_error_envelope");
    }
    return body;
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

export class AttendancePersonalRulesClient {
  private state: PersonalRulesClientState = frozen({ phase: "idle", result: null, pending: null, message: "尚未读取个人例外候选记录；不会自动提交或应用到考勤。" });
  private readonly options: PersonalRulesClientOptions;
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller: AbortController | null = null;
  private pending: PersonalRulesPending | null = null;
  // Retain the original bytes, including after a failed removal. Never overwrite
  // a replaced/vanished slot merely because an in-memory operation looks valid.
  private pendingRaw: string | null = null;
  readonly storageKey: string;
  constructor(options: PersonalRulesClientOptions) {
    this.options = { ...options, siteId: attendanceSelfSite(options.siteId), ownerId: attendanceSelfUuid(options.ownerId), workerId: attendanceSelfUuid(options.workerId) };
    this.storageKey = `faolla:attendance:personal-rules:v1:${this.options.siteId}:${this.options.ownerId}:${this.options.workerId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(update: Omit<Partial<PersonalRulesClientState>, "pending">) {
    const snapshot = this.state = frozen({ ...this.state, ...update, pending: this.pending });
    for (const listener of [...this.listeners]) {
      if (this.state !== snapshot) break;
      // Observers cannot corrupt a persisted command or make settlement partial.
      try { listener(); } catch { /* UI observer failures do not change the ledger protocol. */ }
    }
  }
  private base(): PersonalRulesQuery { return { siteId: this.options.siteId, workerId: this.options.workerId, operationId: null, beforeRevision: null }; }
  private begin(): Lease | null {
    if (hidden()) { this.pause(); return null; }
    if (this.controller) return null;
    const lease = { generation: ++this.generation, controller: new AbortController() }; this.controller = lease.controller; return lease;
  }
  private guard(lease: Lease) {
    if (lease.generation === this.generation && hidden()) this.pause();
    if (lease.generation !== this.generation || this.controller !== lease.controller || lease.controller.signal.aborted) throw Error("aborted");
  }
  private release(lease: Lease) { if (lease.generation === this.generation && this.controller === lease.controller) this.controller = null; }
  private stored(lease: Lease) {
    try {
      this.guard(lease); const storage = this.options.storage(); this.guard(lease);
      const raw = storage.getItem(this.storageKey); this.guard(lease); return { storage, raw };
    } catch { throw new StorageChanged("pending_unreadable"); }
  }
  private verify(lease: Lease) {
    const stored = this.stored(lease); if (stored.raw !== this.pendingRaw) throw new StorageChanged("pending_changed"); return stored.storage;
  }
  private decode(raw: string): PersonalRulesPending {
    if (new TextEncoder().encode(raw).byteLength > 8192) throw new StorageChanged("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== "command,ownerId,query,siteId,workerId"
      || p.siteId !== this.options.siteId || p.ownerId !== this.options.ownerId || p.workerId !== this.options.workerId) throw new StorageChanged("invalid_pending");
    const { query, command } = parsePersonalRulesBody({ query: p.query, command: p.command });
    if (query.siteId !== this.options.siteId || query.workerId !== this.options.workerId) throw new StorageChanged("pending_identity");
    return frozen({ siteId: p.siteId, ownerId: p.ownerId, workerId: p.workerId, query, command });
  }
  private clear(lease: Lease) {
    try {
      const storage = this.verify(lease); this.guard(lease);
      storage.removeItem(this.storageKey); this.guard(lease);
      const remaining = this.stored(lease).raw; this.guard(lease);
      if (remaining !== null) throw new StorageChanged("pending_not_cleared");
      // No observable intermediate pending-null state: the caller publishes the
      // complete verified result, or the complete definitive rejection, atomically.
      this.pending = null; this.pendingRaw = null;
    } catch { throw new StorageChanged("pending_not_cleared"); }
  }
  pause = () => {
    this.generation++; this.controller?.abort(); this.controller = null;
    const phase = this.pending ? "unconfirmed" : "idle";
    const message = "页面已隐藏或身份已切换；已发送操作不撤销。返回后仅查询原编号，不自动重发。";
    if (this.state.result !== null || this.state.phase !== phase || this.state.message !== message || this.state.pending !== this.pending) this.publish({ result: null, phase, message });
  };
  initialize = async () => {
    const lease = this.begin(); if (!lease) return;
    try {
      const { raw } = this.stored(lease);
      if (this.pending && raw !== this.pendingRaw) throw new StorageChanged("pending_changed");
      const pending = raw === null ? null : this.decode(raw); this.guard(lease);
      this.pending = pending; this.pendingRaw = raw;
      await this.request(this.base(), null, lease);
    } catch (error) { this.failed(error, lease); }
    finally { this.release(lease); }
  };
  refresh = async () => this.initialize();
  next = async () => {
    if (hidden()) { this.pause(); return; }
    const cursor = this.state.result?.nextBeforeRevision;
    if (this.pending || this.state.phase !== "ready" || cursor == null) return;
    await this.request(parsePersonalRulesQuery({ ...this.base(), beforeRevision: cursor }), null);
  };
  approve = async (input: { startsOn: string; endsOn: string; rules: AttendanceRuleDraft; reason: string }) => this.write(result => {
    const worker = result.worker;
    if (!worker.active || !worker.employeeActive || !worker.employeeId || !worker.employeeAuthUserId) throw Error("inactive_worker");
    if (input.startsOn <= attendanceLocalDate(result.readAt.slice(0, 23) + "Z", result.timeZone)
      || attendanceRecordInstant(attendanceDayUtcRange(input.startsOn, result.timeZone).startAt) <= result.readAt) throw Error("future_required");
    return { operationId: this.operationId(), action: "approve", expectedRevision: result.revision, reason: input.reason,
      expectedWorkerVersion: worker.version, expectedSettingsVersion: result.settingsVersion, employeeId: worker.employeeId,
      employeeAuthUserId: worker.employeeAuthUserId, timeZone: result.timeZone, startsOn: input.startsOn, endsOn: input.endsOn, rules: input.rules };
  });
  withdraw = async (approvedRevision: number, reason: string) => this.write(result => {
    const approved = result.items.find(item => item.revision === approvedRevision && item.action === "approve" && item.withdrawnByRevision === null);
    if (!approved || result.readAt >= attendanceRecordInstant(approved.fromAt)) throw Error("future_approval_required");
    return { operationId: this.operationId(), action: "withdraw", expectedRevision: result.revision, approvedRevision, reason };
  });
  private operationId() { return (this.options.randomId ?? (() => crypto.randomUUID()))(); }
  private async write(make: (result: PersonalRulesResponse) => PersonalRulesCommand) {
    if (hidden()) { this.pause(); return; }
    const result = this.state.result;
    if (this.pending || this.state.phase !== "ready" || !result?.moduleEnabled) return;
    const lease = this.begin(); if (!lease) return;
    try {
      this.publish({ result: null, phase: "saving", message: "正在校验完整个人例外候选；尚未确认服务器结果。" }); this.guard(lease);
      const storage = this.verify(lease), command = parsePersonalRulesCommand(make(result)), query = this.base(); this.guard(lease);
      parsePersonalRulesBody({ query, command }); this.verify(lease); this.guard(lease);
      const pending = frozen({ siteId: this.options.siteId, ownerId: this.options.ownerId, workerId: this.options.workerId, query, command });
      // Preserve the proposed original ID even if a storage implementation writes
      // and then throws, or synchronously pauses during setItem/getItem.
      this.pending = pending; this.pendingRaw = JSON.stringify(pending);
      storage.setItem(this.storageKey, this.pendingRaw); this.guard(lease);
      this.verify(lease); await this.request(query, command, lease);
    } catch (error) { this.failed(error, lease, true); }
    finally { this.release(lease); }
  }
  retry = async () => {
    if (hidden()) { this.pause(); return; }
    if (!this.pending || this.state.phase !== "unconfirmed") return;
    const pending = this.pending, generation = await this.request(this.base(), null);
    if (generation === null || generation !== this.generation || hidden() || this.pending !== pending
      || this.state.phase !== "unconfirmed" || !this.state.result?.moduleEnabled) return;
    await this.request(pending.query, pending.command);
  };
  private failed(error: unknown, lease: Lease, storageFailure = false) {
    if (lease.generation !== this.generation) return;
    if (hidden()) { this.pause(); return; }
    const code = error instanceof Error ? error.message : "";
    this.publish({ result: null, phase: storageFailure || error instanceof StorageChanged ? "blocked" : this.pending ? "unconfirmed" : "blocked",
      message: storageFailure || error instanceof StorageChanged ? "内容或待确认存储未通过校验；不会覆盖或继续提交。请保留原编号，恢复当前身份和存储后重新读取。"
        : code === "attendance_version_conflict" ? "当前人员、设置或候选版本已变化；请重新读取后核对，不覆盖旧版本。"
          : code === "attendance_personal_rule_future_required" ? "例外只能核准未来当地日期，且只能在开始前撤回；服务器时间为准。"
            : code === "attendance_personal_rule_identity_changed" || code === "attendance_access_denied" ? "当前身份或员工绑定已变化；资料已隐藏，保留原编号，不会自动重发。"
              : "未能可靠确认结果，个人例外资料已隐藏；请核对当前身份和原编号，不会自动重发。" });
  }
  private async request(base: PersonalRulesQuery, command: PersonalRulesCommand | null, existing?: Lease): Promise<number | null> {
    const lease = existing ?? this.begin(); if (!lease) return null;
    try {
      this.guard(lease);
      this.publish({ result: null, phase: command ? "saving" : "loading", message: command ? "正在提交原编号完整内容；请等待核验收据。" : "正在核验当前身份并查询个人例外候选记录…" });
      this.guard(lease); this.verify(lease); this.guard(lease);
      if (command && (!this.pending || !samePersonalRulesCommand(this.pending.command, command))) throw Error("pending_mismatch");
      const query = parsePersonalRulesQuery({ ...base, operationId: command ? null : this.pending?.command.operationId ?? null });
      const raw = await requestJson(this.options.apiFetch, endpoint + (command ? "" : "?" + personalRulesQueryString(query)),
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, command }) } : { method: "GET" },
        lease.controller.signal, this.options.timeoutMs ?? 12000);
      this.guard(lease); this.verify(lease); this.guard(lease);
      const result = parsePersonalRulesResponse(raw, query, command, this.options.ownerId);
      this.guard(lease);
      if (this.pending && result.receipt) {
        if (!samePersonalRulesCommand(this.pending.command, result.receipt.command)) throw Error("receipt_mismatch");
        this.clear(lease); this.guard(lease);
      }
      this.publish({ result, phase: this.pending ? "unconfirmed" : "ready", message: this.pending
        ? "尚未找到原操作收据；新写入已阻止。可重新查询，或明确按原编号、原内容重试。"
        : result.receipt ? "原操作收据已核验；仅登记个人例外候选，未应用到打卡、工时、异常或工资。" : "已读取个人例外候选；不是实际考勤规则，不自动生效。" });
      this.guard(lease); return lease.generation;
    } catch (error) {
      if (lease.generation !== this.generation) return null;
      if (hidden()) { this.pause(); return null; }
      if (command && error instanceof Rejected && definitive.has(error.message)) {
        try { this.clear(lease); this.guard(lease); }
        catch (storageError) { this.failed(storageError, lease, true); return null; }
      }
      this.failed(error, lease); return null;
    } finally { if (!existing) this.release(lease); }
  }
}
