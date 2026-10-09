import { ATTENDANCE_MANAGEMENT_ERRORS, parseAttendanceRecordsQuery, parseAttendanceRecordsResult, parseAttendanceScopeCommand,
  parseAttendanceScopeResult, type AttendanceRecordsQuery, type AttendanceRecordsResult, type AttendanceScopeCommand,
  type AttendanceScopeResult } from "./merchantAttendanceManagement";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

export class AttendanceManagementRejected extends Error {}
export function attendanceManagementMessage(e: unknown): string {
  const code = e instanceof Error ? e.message : "";
  if (["attendance_access_denied", "forbidden_origin", "enterprise_management_disabled"].includes(code)) return "当前身份或权限不能访问考勤，请重新登录或联系企业负责人。";
  if (code === "attendance_settings_required") return "请先在考勤配置中保存企业设置。";
  if (code === "attendance_platform_paused") return "平台已暂停新考勤授权；仍可核对结果或撤销已有授权。";
  if (code === "attendance_version_conflict") return "授权已被其他操作更新，请重新读取后再编辑。";
  if (code === "attendance_scope_manager_invalid") return "该员工或角色未启用，或尚无“查看授权考勤明细”权限。";
  if (code === "attendance_scope_target_invalid") return "所选人员或地点已失效，请重新选择。";
  if (code === "attendance_rate_limited") return "请求较频繁，请稍后手动重试。";
  if (["attendance_invalid_request", "attendance_invalid_date", "attendance_invalid_time_zone", "attendance_invalid_instant", "attendance_local_date_does_not_exist"].includes(code)) return "请检查日期、时区和授权内容。";
  if (code === "attendance_not_available") return "考勤功能尚未开放，请稍后再试。";
  return "未能确认服务器结果，请重新读取；待确认的保存不会自动重复提交。";
}

// Bounded UTF-8 body and deadline cover headers AND body. Never accept an HTML
// login redirect as success; cancellation also cancels an already acquired reader.
export async function attendanceManagementRequest(apiFetch: AttendanceApiFetch, url: string, init: RequestInit = {},
  options: { maxBytes?: number; timeoutMs?: number; signal?: AbortSignal; errorStatuses?: Readonly<Record<string, number>> } = {}): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancel: (e: Error) => void = () => {};
  const cancel = (reason: string) => { controller.abort(); void reader?.cancel().catch(() => {}); rejectCancel(Error(reason)); };
  const onAbort = () => cancel("aborted");
  const deadline = new Promise<never>((_, reject) => { rejectCancel = reject; timer = setTimeout(() => cancel("timeout"), options.timeoutMs ?? 12000); });
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const run = async () => {
    if (options.signal?.aborted) throw Error("aborted");
    const response = await apiFetch(url, { ...init, cache: "no-store", signal: controller.signal });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw Error("aborted"); }
    if (response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Error("invalid_response");
    reader = response.body?.getReader(); if (!reader) throw Error("empty_response");
    let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
    try { while (true) { const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > (options.maxBytes ?? 98304)) { await reader.cancel(); throw Error("oversized_response"); }
      text += decoder.decode(value, { stream: true });
    } } finally { reader.releaseLock(); reader = undefined; }
    const body = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("invalid_response");
    if (!response.ok || body.ok !== true) {
      const errors = options.errorStatuses ?? ATTENDANCE_MANAGEMENT_ERRORS;
      if (typeof body.error === "string" && Object.hasOwn(errors, body.error)
        && errors[body.error] === response.status) throw new AttendanceManagementRejected(body.error);
      if (body.error === "attendance_not_available" && response.status === 404) throw Error(body.error);
      throw Error("attendance_unavailable");
    }
    if (typeof body.moduleEnabled !== "boolean") throw Error("invalid_response");
    return body;
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); }
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ScopePending = { ownerId: string; siteId: string; employeeId: string; command: AttendanceScopeCommand };
type ScopeResponse = AttendanceScopeResult & { moduleEnabled: boolean };
type ScopeState = { phase: "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  employeeId: string | null; result: ScopeResponse | null; pending: ScopePending | null; message: string };
export class AttendanceScopeClient {
  private state: ScopeState = { phase: "loading", employeeId: null, result: null, pending: null, message: "正在检查待确认授权…" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private busy = false;
  private disposed = false;
  readonly storageKey: string;
  constructor(private readonly options: { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; storage: () => StorageLike; randomId?: () => string; timeoutMs?: number }) {
    // One pending write per owner/company/tab, not per selected manager. A return
    // visit recovers the original target before allowing a different target.
    this.storageKey = `faolla:attendance:scope:v1:${options.siteId}:${options.ownerId}`;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<ScopeState>) { this.state = { ...this.state, ...update }; for (const fn of this.listeners) fn(); }
  private current(g: number) { return !this.disposed && g === this.generation; }
  dispose = () => { this.disposed = true; this.generation++; this.busy = false; };
  private restored(): ScopePending | null {
    const raw = this.options.storage().getItem(this.storageKey); if (raw === null) return null;
    if (raw.length > 20000) throw Error("invalid_pending");
    const p = JSON.parse(raw);
    if (!p || Object.keys(p).sort().join() !== "command,employeeId,ownerId,siteId"
      || p.ownerId !== this.options.ownerId || p.siteId !== this.options.siteId) throw Error("invalid_pending");
    if (!p.command || Object.keys(p.command).sort().join() !== "action,expectedRevision,grant,grantId,operationId") throw Error("invalid_pending");
    const parsed = parseAttendanceScopeCommand({ ...p.command, siteId: p.siteId, employeeId: p.employeeId });
    return { ownerId: p.ownerId, ...parsed };
  }
  initialize = async () => {
    this.disposed = false; this.generation++; this.busy = false;
    try {
      const pending = this.restored();
      this.set({ pending, result: null, employeeId: pending?.employeeId ?? this.state.employeeId });
    } catch { this.set({ phase: "blocked", result: null, message: "无法读取待确认操作。请恢复本标签页存储后重新读取；不会丢弃或自动重提授权。" }); return; }
    await this.load();
  };
  select = async (employeeId: string) => {
    if (this.busy || this.disposed || this.state.pending || !["ready", "blocked"].includes(this.state.phase)) return;
    this.set({ employeeId, result: null }); await this.load();
  };
  private clear() {
    this.options.storage().removeItem(this.storageKey);
    if (this.options.storage().getItem(this.storageKey) !== null) throw Error("pending_not_cleared");
    this.set({ pending: null });
  }
  private settle(result: ScopeResponse) {
    const p = this.state.pending;
    if (!p) { this.set({ phase: "ready", result, message: "授权已读取；空人员或空地点不授予访问权。" }); return; }
    const receipt = result.receipt;
    if (receipt) {
      if (receipt.revision !== p.command.expectedRevision + 1 || receipt.action !== p.command.action || receipt.grantId !== p.command.grantId) throw Error("receipt_mismatch");
      this.clear(); this.set({ phase: "ready", result, message: `操作已确认 · 授权版本 ${receipt.revision}。下方为当前授权，可能已有后续更新。` });
    } else if (result.scope.revision > p.command.expectedRevision) {
      this.clear(); this.set({ phase: "ready", result, message: "未找到原收据，但授权版本已更新；旧操作已无法提交，请核对当前范围后重新编辑。" });
    } else this.set({ phase: "unconfirmed", result, message: "尚未找到保存收据。请核对结果，或使用原操作编号重试；此时不能切换主管或发起新授权。" });
  }
  load = async () => {
    if (this.busy || this.disposed) return;
    if (!this.state.employeeId) { this.set({ phase: "ready", result: null, message: "请选择要配置范围的主管。" }); return; }
    this.busy = true; const g = ++this.generation; this.set({ phase: "loading", result: null });
    try { const result = await this.request(null); if (this.current(g)) this.settle(result); }
    catch (e) { if (this.current(g)) this.set({ phase: this.state.pending ? "unconfirmed" : "blocked", result: null, message: attendanceManagementMessage(e) }); }
    finally { if (this.current(g)) this.busy = false; }
  };
  submit = async (change: Pick<AttendanceScopeCommand, "action" | "grantId" | "grant">, expectedRevision: number) => {
    if (this.busy || this.disposed || this.state.pending || this.state.phase !== "ready" || !this.state.employeeId
      || !this.state.result || (change.action === "put" && !this.state.result.moduleEnabled)) return false;
    let command: AttendanceScopeCommand;
    try { command = parseAttendanceScopeCommand({ ...change, expectedRevision, siteId: this.options.siteId, employeeId: this.state.employeeId,
      operationId: (this.options.randomId ?? (() => crypto.randomUUID()))() }).command; }
    catch (e) { this.set({ message: attendanceManagementMessage(e) }); return false; }
    try {
      if (this.restored()) { await this.initialize(); return false; }
      const pending = { ownerId: this.options.ownerId, siteId: this.options.siteId, employeeId: this.state.employeeId, command }, raw = JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey, raw);
      if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_write_failed");
      this.set({ pending });
    } catch { this.set({ phase: "blocked", message: "浏览器存储不可用，尚未发送保存请求。请恢复存储后重新读取。" }); return false; }
    return await this.write(true);
  };
  retry = async () => { if (this.state.phase === "unconfirmed") return await this.write(false); return false; };
  private async write(first: boolean) {
    if (this.busy || this.disposed || !this.state.pending) return false;
    this.busy = true; const g = ++this.generation; this.set({ phase: "saving", message: "正在保存授权，等待服务器确认…" });
    try {
      const result = await this.request(this.state.pending.command);
      if (this.current(g)) { if (!result.receipt) throw Error("receipt_missing"); this.settle(result); return !this.state.pending; }
    } catch (e) {
      if (this.current(g)) {
        if (first && e instanceof AttendanceManagementRejected) { try { this.clear(); } catch { /* Preserve uncertainty. */ } }
        this.set({ phase: this.state.pending ? "unconfirmed" : "blocked", result: null, message: attendanceManagementMessage(e) });
      }
    } finally { if (this.current(g)) this.busy = false; }
    return false;
  }
  private async request(command: AttendanceScopeCommand | null): Promise<ScopeResponse> {
    const expected = { siteId: this.options.siteId, employeeId: this.state.employeeId!, operationId: this.state.pending?.command.operationId ?? null };
    const q = new URLSearchParams({ siteId: expected.siteId, employeeId: expected.employeeId });
    if (expected.operationId) q.set("operationId", expected.operationId);
    const body = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/scopes${command ? "" : `?${q}`}`,
      command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: expected.siteId, employeeId: expected.employeeId, ...command }) } : {},
      { maxBytes: 524288, timeoutMs: this.options.timeoutMs });
    return { ...parseAttendanceScopeResult(body, expected), moduleEnabled: body.moduleEnabled as boolean };
  }
}

export function attendanceRecordsDateQuery(siteId: string, access: "owner" | "manager", startDate: string, endDate: string, timeZone: string): AttendanceRecordsQuery {
  const start = attendanceDayUtcRange(startDate, timeZone), end = attendanceDayUtcRange(endDate, timeZone);
  // 30 calendar days remains below the backend's 31*24-hour limit across DST.
  if (endDate < startDate || Date.parse(`${endDate}T00:00Z`) - Date.parse(`${startDate}T00:00Z`) >= 30 * 86400000) throw Error("attendance_invalid_request");
  return parseAttendanceRecordsQuery(`https://local.invalid/?${new URLSearchParams({ siteId, access, fromAt: start.startAt, toAt: end.endAt })}`);
}
export function attendanceRecordsQueryString(query: AttendanceRecordsQuery) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== null) q.set(k, v);
  return q.toString();
}
type RecordsState = { phase: "idle" | "loading" | "ready" | "blocked"; query: AttendanceRecordsQuery | null;
  result: (AttendanceRecordsResult & { moduleEnabled: boolean }) | null; message: string };
export class AttendanceRecordsClient {
  private state: RecordsState = { phase: "idle", query: null, result: null, message: "选择日期和统计时区后查询。" };
  private generation = 0;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly options: { siteId: string; access: "owner" | "manager"; apiFetch: AttendanceApiFetch; timeoutMs?: number }) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<RecordsState>) { this.state = { ...this.state, ...update }; for (const fn of this.listeners) fn(); }
  invalidate = (forgetQuery = false) => { this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ result: null, ...(forgetQuery ? { query: null } : {}), phase: "idle", message: "返回页面后重新核验访问权限。" }); };
  load = async (input: AttendanceRecordsQuery) => {
    this.invalidate(); const generation = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading", query: null, message: "正在核验权限并读取当前页…" });
    try {
      const query = parseAttendanceRecordsQuery(`https://local.invalid/?${attendanceRecordsQueryString(input)}`);
      if (query.siteId !== this.options.siteId || query.access !== this.options.access) throw Error("attendance_invalid_request");
      this.set({ query });
      const body = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/records?${attendanceRecordsQueryString(query)}`,
        {}, { signal: controller.signal, timeoutMs: this.options.timeoutMs });
      const result = { ...parseAttendanceRecordsResult(body, query), moduleEnabled: body.moduleEnabled as boolean };
      if (generation === this.generation) this.set({ phase: "ready", result, message: result.items.length ? `本页 ${result.items.length} 条原始打卡事实` : "当前条件及授权范围内没有记录。" });
    } catch (e) { if (generation === this.generation) this.set({ phase: "blocked", result: null, message: attendanceManagementMessage(e) }); }
    finally { if (generation === this.generation) this.controller = null; }
  };
  next = async () => {
    const { query, result, phase } = this.state;
    if (phase !== "ready" || !query || !result?.nextCursor) return;
    await this.load({ ...query, asOf: result.asOf, cursorAt: result.nextCursor.occurredAt, cursorId: result.nextCursor.id });
  };
  refresh = async (first = false) => {
    const q = this.state.query;
    if (q) await this.load(first ? { ...q, asOf: null, cursorAt: null, cursorId: null } : q);
  };
}
