import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import { parseMissingBody, parseMissingQuery, parseMissingResult, missingQueryString, missingCommandMatches, missingMessage, MISSING_ERRORS,
  type MissingQuery, type MissingCommand, type MissingResult } from "./merchantAttendanceMissing";
import type { CorrectionProposal } from "./merchantAttendanceCorrection";
export type MissingIntent = { action: "submit" | "revise"; proposal: CorrectionProposal; reason: string } | { action: "withdraw" | "approve" | "reject"; reason: string };
type Pending = { actorId: string; query: MissingQuery; command: MissingCommand };
export class AttendanceMissingClient {
  private state: { phase: "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; query: MissingQuery; result: MissingResult | null; pending: Pending | null; message: string };
  private generation = 0; private controller: AbortController | null = null; private paused = false; private listeners = new Set<() => void>();
  readonly storageKey: string;
  constructor(private readonly options: { query: MissingQuery; actorId: string; apiFetch: AttendanceApiFetch; storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">; randomId?: () => string; timeoutMs?: number }) {
    this.storageKey = `faolla:attendance:missing:v1:${options.query.siteId}:${options.query.access}:${options.actorId}`;
    this.state = { phase: "loading", query: options.query, result: null, pending: null, message: "正在读取整段漏卡申请…" };
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<typeof this.state>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private restore(): Pending | null {
    const raw = this.options.storage().getItem(this.storageKey); if (raw === null) return null;
    if (raw.length > 8192) throw Error("invalid_pending"); const p = JSON.parse(raw);
    if (!p || Object.keys(p).sort().join() !== "actorId,command,query" || p.actorId !== this.options.actorId) throw Error("invalid_pending");
    const body = parseMissingBody({ query: p.query, command: p.command });
    if (body.query.siteId !== this.options.query.siteId || body.query.access !== this.options.query.access) throw Error("invalid_pending");
    return { actorId: p.actorId, ...body };
  }
  private samePending() { if (JSON.stringify(this.restore()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict"); }
  private clear() { this.samePending(); this.options.storage().removeItem(this.storageKey); if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_error"); this.set({ pending: null }); }
  pause = () => { this.paused = true; this.generation++; this.controller?.abort(); this.controller = null; this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: "资料已隐藏；返回后只核对原操作，不会自动重发。" }); };
  initialize = async () => {
    this.generation++; this.controller?.abort(); this.controller = null; this.paused = false;
    try { const pending = this.restore(); this.set({ pending, result: null, query: pending?.query ?? this.state.query }); }
    catch { this.set({ result: null, phase: "blocked", message: "待确认存储异常，不会覆盖、丢弃或自动重发。" }); return; }
    await this.request(null, false);
  };
  load = async (query: MissingQuery) => {
    if (this.paused || this.controller || this.state.pending || query.siteId !== this.options.query.siteId || query.access !== this.options.query.access || query.operationId !== null) return;
    try { this.set({ query: parseMissingQuery(`https://local.invalid/?${missingQueryString(query)}`) }); await this.request(null, false); }
    catch { this.set({ result: null, phase: "blocked", message: "请检查日期范围和申请编号。" }); }
  };
  submit = async (intent: MissingIntent) => {
    const r = this.state.result;
    if (this.paused || this.controller || this.state.pending || this.state.phase !== "ready" || !r || !r.moduleEnabled && intent.action !== "withdraw") return;
    try {
      if (this.restore()) { await this.initialize(); return; }
      const base = { operationId: (this.options.randomId ?? (() => crypto.randomUUID()))(), reason: intent.reason.trim() };
      const creates = intent.action === "submit" || intent.action === "revise";
      if (intent.action === "revise" && !r.detail?.lineage?.canRevise) return;
      const command = creates ? { ...base, action: intent.action, proposal: intent.proposal, expectedWorkerId: r.workerId, expectedSettingsVersion: r.settingsVersion,
        expectedPolicyRevision: r.policyRevision, locationId: r.locationId, timeZone: r.timeZone,
        ...(intent.action === "revise" ? { supersedesRequestId: r.detail!.requestId, expectedApprovalOperationId: r.detail!.lineage!.currentApprovalOperationId } : {}) } : { ...base, action: intent.action, requestId: r.detail?.requestId,
        expectedRevision: r.detail?.revision, ...(intent.action !== "withdraw" ? { evidenceToken: r.detail?.evidenceToken } : {}) };
      const query = { ...this.state.query, operationId: null, requestId: creates ? null : r.detail?.requestId ?? null, beforeAt: null, beforeId: null };
      const body = parseMissingBody({ query, command }); if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 4096) throw Error("body_too_large");
      const pending = { actorId: this.options.actorId, ...body }, raw = JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey, raw); if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_error");
      this.set({ pending, query }); await this.request(body.command, true);
    } catch { this.set({ result: null, phase: "blocked", message: "填写内容或本地存储异常，请重新读取核对；不会另建编号重发。" }); }
  };
  retry = async () => {
    if (this.paused || this.controller || !this.state.pending || this.state.phase !== "unconfirmed") return;
    if (await this.request(null, false) && this.state.pending && this.state.result && (this.state.result.moduleEnabled || this.state.pending.command.action === "withdraw")) await this.request(this.state.pending.command, false);
  };
  private async request(command: MissingCommand | null, first: boolean) {
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ result: null, phase: command ? "saving" : "loading" });
    try {
      this.samePending(); const query = { ...this.state.query, operationId: command?.operationId ?? this.state.pending?.command.operationId ?? null };
      const raw = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/missing${command ? "" : `?${missingQueryString(query)}`}`,
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: this.state.query, command }) } : {},
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 262144, errorStatuses: MISSING_ERRORS });
      if (g !== this.generation || this.paused) return false;
      this.samePending(); const result = parseMissingResult(raw, query), pending = this.state.pending;
      if (query.access === "self" && result.employeeId !== this.options.actorId || command && !result.receipt || pending && result.receipt && !missingCommandMatches(pending.command, result.receipt.command)) throw Error("receipt_mismatch");
      if (pending && result.receipt) { this.clear(); this.set({ result, phase: "ready", message: "原操作已确认；历史记录保留，含整段漏卡核对采用最新批准版本，原报表不含整段申报。" }); }
      else this.set({ result, phase: pending ? "unconfirmed" : "ready", message: pending ? "结果待确认，请查询收据或明确使用原编号重试。" : "已读取整段漏卡申请；审批不生成原始打卡。" });
      return true;
    } catch (error) {
      if (g !== this.generation || this.paused) return false;
      if (command && error instanceof AttendanceManagementRejected && (first || ["attendance_missing_closed", "attendance_missing_basis_changed", "attendance_version_conflict", "attendance_correction_policy_changed"].includes(error.message)) && error.message !== "attendance_operation_conflict" && error.message !== "attendance_application_window_protocol_required") {
        try { this.clear(); } catch { /* Keep uncertain pending operation. */ }
      }
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: missingMessage(error instanceof Error ? error.message : "") }); return false;
    } finally { if (g === this.generation) this.controller = null; }
  }
}
