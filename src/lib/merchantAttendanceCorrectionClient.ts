import { CORRECTION_ERRORS, correctionQueryString, parseCorrectionCommand, parseCorrectionQuery, parseCorrectionResult,
  type CorrectionCommand, type CorrectionProposal, type CorrectionQuery, type CorrectionResult } from "./merchantAttendanceCorrection";
import { attendanceManagementRequest, AttendanceManagementRejected } from "./merchantAttendanceManagementClient";
import { ATTENDANCE_SELF_CONTEXT_ERRORS, parseAttendanceSelfContext } from "./merchantAttendanceSelfContext";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type DetailQuery = Extract<CorrectionQuery, { mode: "detail" }>;
type NewCommand = Omit<Extract<CorrectionCommand, { action: "submit" }>, "operationId"> | Omit<Extract<CorrectionCommand, { action: "withdraw" }>, "operationId">;
export type CorrectionPending = { employeeId: string; query: DetailQuery; command: CorrectionCommand };
type Result = CorrectionResult & { moduleEnabled: boolean };
type State = { phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked"; workerId: string | null;
  result: Result | null; query: CorrectionQuery | null; pending: CorrectionPending | null; message: string };
export const correctionPendingKey = (siteId: string, employeeId: string) =>
  `faolla:attendance:correction:v1:${attendanceSelfSite(siteId)}:${attendanceSelfUuid(employeeId)}`;
export function parseCorrectionPending(raw: string, siteId: string, employeeId: string): CorrectionPending {
  if (raw.length > 16384) throw Error("invalid_pending");
  const p = JSON.parse(raw);
  if (!p || Object.keys(p).sort().join() !== "command,employeeId,query" || p.employeeId !== employeeId || !p.query
    || Object.keys(p.query).sort().join() !== "expectedWorkerId,mode,operationId,requestId,siteId") throw Error("invalid_pending");
  if (!p.command || Object.keys(p.command).sort().join() !== (p.command.action === "submit"
    ? `action,expectedLastEventId,${Object.hasOwn(p.command,"expectedPolicyRevision")?"expectedPolicyRevision,":""}expectedRevision,operationId,proposal,reason,startEventId`
    : "action,expectedRevision,operationId,reason,requestId")) throw Error("invalid_pending");
  const query = parseCorrectionQuery(`https://local.invalid/?${correctionQueryString(p.query)}`);
  if (query.siteId !== siteId || query.mode !== "detail" || query.operationId !== null) throw Error("invalid_pending");
  const { command } = parseCorrectionCommand({ siteId, expectedWorkerId: query.expectedWorkerId, ...p.command });
  if (query.requestId !== (command.action === "submit" ? command.operationId : command.requestId)) throw Error("invalid_pending");
  return { employeeId, query, command };
}
export function correctionMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    attendance_application_window_protocol_required: "该商户已启用新版申请窗口，请通过新入口核对后提交；旧待确认编号保留，请先核对原号，不会自动重发。",
    attendance_worker_changed: "考勤档案绑定已变化；停止使用旧档案，保留原操作供核对。",
    attendance_access_denied: "当前身份或权限无法访问申请，请重新登录同一员工账号或联系负责人。",
    attendance_platform_paused: "平台已暂停新申请；仍可按当前权限核对或撤回原申请。",
    attendance_correction_basis_changed: "原始班次已新增打卡，旧申请已失效；请重新选择班次，核对后再填写。",
    attendance_version_conflict: "该班次申请已更新，原操作已失效；请重新读取当前申请。",
    attendance_correction_pending: "本班次已有待处理申请，请先查看原申请。",
    attendance_correction_closed: "这份申请已经结束，不能再次撤回；请重新读取。",
    attendance_correction_decided: "申请已有审批决定，不能撤回或覆盖；请重新查看决定。驳回后可重新准备申请；已批准内容请通过开放的再次修订入口处理。",
    attendance_correction_policy_required: "请先重新读取班次与申请规则；负责人尚未配置期限时不能新建申请。",
    attendance_correction_policy_changed: "申请期限规则已更新；原内容未提交，请重新读取并确认新版规则。",
    attendance_correction_window_expired: "已超过申请期限，未创建申请；请联系负责人核查。",
    attendance_correction_period_locked: "原班次或声明涉及已锁定周期，未创建申请；请联系负责人核查。",
    attendance_period_sealed: "该员工周期已封存，请负责人填写理由重开后，再重新核对补正申请；原记录未改写。",
    attendance_correction_rules_unavailable: "当前日期或锁定范围不能完整核验，未创建申请；请联系负责人。",
    attendance_operation_conflict: "原操作编号与服务器记录不一致，请保留编号并联系负责人，不另起新操作。",
    attendance_correction_not_found: "暂未查到原申请；这不证明提交失败。请保留原编号核对或明确重试。",
    attendance_invalid_request: "请检查时间、休息和理由。理由最多 500 字，休息最多 32 段，申请跨度最多 31 天。",
    attendance_rate_limited: "请求较频繁，请稍后手动核对；不会自动重试。",
    attendance_not_available: "补正申请功能尚未开放。",
    attendance_correction_unsupported_basis: "班次包含未绑定本人身份或不支持来源的记录，请联系负责人核查；不能代其他员工提交补正。",
    attendance_session_too_large: "原始班次超过 202 条记录，请联系负责人核查。",
  };
  return Object.hasOwn(messages, code) ? messages[code] : "暂时无法确认结果或访问权限，请重新核对；不会自动重复提交。";
}

/** One intent per membership/tab. A reload only GETs; new writes always require an explicit action. */
export class AttendanceCorrectionClient {
  private state: State = { phase: "idle", workerId: null, result: null, query: null, pending: null, message: "正在核对本人考勤身份…" };
  private generation = 0; private controller: AbortController | null = null; private paused = false;
  private listeners = new Set<() => void>();
  readonly storageKey: string;
  constructor(private readonly options: { siteId: string; employeeId: string; apiFetch: AttendanceApiFetch; storage: () => Store;
    randomId?: () => string; timeoutMs?: number }) { this.storageKey = correctionPendingKey(options.siteId, options.employeeId); }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<State>) { this.state = { ...this.state, ...update }; this.listeners.forEach(fn => fn()); }
  private stored() { const raw = this.options.storage().getItem(this.storageKey);
    return raw === null ? null : parseCorrectionPending(raw, this.options.siteId, this.options.employeeId); }
  private checkStorage() { if (JSON.stringify(this.stored()) !== JSON.stringify(this.state.pending)) throw Error("storage_conflict"); }
  private clear() { this.checkStorage(); this.options.storage().removeItem(this.storageKey);
    if (this.options.storage().getItem(this.storageKey) !== null) throw Error("storage_conflict"); this.set({ pending: null }); }
  hasLeaveRisk = () => { try { return !!this.controller || !!this.stored(); } catch { return true; } };
  pause = () => { this.paused = true; this.generation++; this.controller?.abort(); this.controller = null;
    this.set({ result: null, workerId: null, phase: this.state.pending ? "unconfirmed" : "idle", message: "资料已隐藏；中止等待不代表撤回已发送的申请。" }); };
  initialize = async () => {
    this.pause(); this.paused = false; const g = this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ phase: "loading" });
    try {
      const pending = this.stored(); this.set({ pending });
      const body = await attendanceManagementRequest(this.options.apiFetch,
        `/api/merchant-enterprise/attendance/corrections/context?siteId=${this.options.siteId}`, { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 2048, errorStatuses: ATTENDANCE_SELF_CONTEXT_ERRORS });
      const context = parseAttendanceSelfContext(body, this.options.siteId);
      if (context.employeeId !== this.options.employeeId) throw Error("attendance_access_denied");
      this.checkStorage();
      if (pending && pending.query.expectedWorkerId !== context.workerId) throw Error("attendance_worker_changed");
      if (g !== this.generation || this.paused) return;
      this.set({ workerId: context.workerId, query: pending?.query ?? (this.state.query?.expectedWorkerId === context.workerId ? this.state.query : null) });
    } catch (e) { if (g === this.generation) this.set({ phase: "blocked", result: null, workerId: null, message: correctionMessage(e) }); return; }
    finally { if (g === this.generation) this.controller = null; }
    if (g === this.generation && !this.paused) await this.run(this.state.query ?? this.listQuery(), null, false);
  };
  private listQuery(): CorrectionQuery { return { siteId: this.options.siteId, expectedWorkerId: this.state.workerId!, mode: "list", cursorAt: null, cursorId: null }; }
  private canNavigate() { return !this.paused && !this.controller && !this.state.pending && !!this.state.workerId; }
  list = async () => { if (this.canNavigate()) await this.run(this.listQuery(), null, false); };
  next = async () => { const r = this.state.result; if (this.canNavigate() && r?.mode === "list" && r.nextCursor)
    await this.run({ ...this.listQuery(), mode: "list", cursorAt: r.nextCursor.recordedAt, cursorId: r.nextCursor.requestId }, null, false); };
  prepare = async (startEventId: string) => { if (this.canNavigate()) await this.run({ siteId: this.options.siteId, expectedWorkerId: this.state.workerId!, mode: "prepare", startEventId }, null, false); };
  detail = async (requestId: string) => { if (this.canNavigate()) await this.run({ siteId: this.options.siteId, expectedWorkerId: this.state.workerId!, mode: "detail", requestId, operationId: null }, null, false); };
  submit = async (proposal: CorrectionProposal, reason: string) => {
    const r = this.state.result;
    if (!this.canNavigate() || this.state.phase !== "ready" || r?.mode !== "prepare" || !r.canRequest || !r.moduleEnabled || r.pendingRequestId || !r.rules?.policy || r.rules.issues.length) return;
    await this.start({ action: "submit", expectedRevision: r.revision, expectedPolicyRevision:r.rules.policy.revision, reason: reason.trim(),
      startEventId: r.basis.events[0].id, expectedLastEventId: r.basis.events.at(-1)!.id, proposal });
  };
  withdraw = async (reason: string) => {
    const r = this.state.result;
    if (!this.canNavigate() || this.state.phase !== "ready" || r?.mode !== "detail" || !r.canRequest || r.item.status !== "submitted") return;
    await this.start({ action: "withdraw", requestId: r.item.requestId, expectedRevision: r.item.revision, reason: reason.trim() });
  };
  private uuid() { return (this.options.randomId ?? (() => crypto.randomUUID()))(); }
  private async start(input: NewCommand) {
    try {
      this.checkStorage();
      const { command } = parseCorrectionCommand({ siteId: this.options.siteId, expectedWorkerId: this.state.workerId, ...input, operationId: this.uuid() });
      const query: DetailQuery = { siteId: this.options.siteId, expectedWorkerId: this.state.workerId!, mode: "detail", operationId: null,
        requestId: command.action === "submit" ? command.operationId : command.requestId };
      // Normalize both copies before fingerprint comparison (query key order is not semantic).
      const pending = parseCorrectionPending(JSON.stringify({ employeeId: this.options.employeeId, query, command }), this.options.siteId, this.options.employeeId);
      const raw = JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey, raw);
      if (this.options.storage().getItem(this.storageKey) !== raw) throw Error("storage_conflict");
      this.set({ pending }); await this.run(query, command, true);
    } catch (e) { this.set({ phase: "blocked", result: null, message: correctionMessage(e) }); }
  }
  retry = async () => {
    if (this.paused || this.controller || !this.state.workerId || this.state.phase !== "unconfirmed" || !this.state.pending) return;
    // A not-found GET is only permission to retry this SAME immutable command, never permission to discard it.
    const result = await this.run(this.state.pending.query, null, false);
    if (result === "missing" && this.state.pending && !this.paused && this.state.workerId) await this.run(this.state.pending.query, this.state.pending.command, false);
  };
  private async run(input: CorrectionQuery, command: CorrectionCommand | null, first: boolean): Promise<"done" | "missing" | "failed"> {
    const g = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.set({ result: null, phase: command ? "saving" : "loading" });
    try {
      this.checkStorage();
      const query = parseCorrectionQuery(`https://local.invalid/?${correctionQueryString(input)}`);
      if (query.siteId !== this.options.siteId || query.expectedWorkerId !== this.state.workerId) throw Error("attendance_worker_changed");
      this.set({ query });
      const pending = this.state.pending;
      const expected = query.mode === "detail" ? { ...query, operationId: pending?.command.operationId ?? null } : query;
      const raw = await attendanceManagementRequest(this.options.apiFetch, `/api/merchant-enterprise/attendance/corrections${command ? "" : `?${correctionQueryString(expected)}`}`,
        command ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: query.siteId, expectedWorkerId: query.expectedWorkerId, ...command }) } : { method: "GET" },
        { signal: controller.signal, timeoutMs: this.options.timeoutMs, maxBytes: 131072, errorStatuses: CORRECTION_ERRORS });
      const result = { ...parseCorrectionResult(raw, expected, true, true), moduleEnabled: raw.moduleEnabled as boolean };
      if (result.employeeId !== this.options.employeeId) throw Error("attendance_access_denied");
      if (g !== this.generation || this.paused) return "failed";
      this.checkStorage();
      if (result.mode === "detail" && pending && result.receipt) {
        const c = pending.command, receipt = result.receipt;
        if (receipt.revision !== c.expectedRevision + 1 || receipt.action !== c.action
          || c.action === "submit" && (result.reason !== c.reason || result.item.startEventId !== c.startEventId
            || result.basis.events.at(-1)?.id !== c.expectedLastEventId || JSON.stringify(result.proposal) !== JSON.stringify(c.proposal) || result.rules?.policy?.revision !== c.expectedPolicyRevision)
          || c.action === "withdraw" && result.withdrawal?.reason !== c.reason) throw Error("receipt_mismatch");
        this.clear();
      } else if (command) throw Error("receipt_missing");
      this.set({ result, phase: this.state.pending ? "unconfirmed" : "ready", message: this.state.pending
        ? "尚未确认原操作；可再次核对或明确用原编号重试。" : result.mode === "detail" && result.item.decision
          ? "本申请已有审批决定，请查看下方决定说明；原始打卡记录保留。" : result.mode === "detail" && result.receipt
          ? "原操作已确认。下方为当前申请状态；原始打卡和实际工时没有变动。" : "仅核对或申请补正；不代表审批通过，不改变当前打卡状态。" });
      return this.state.pending ? "missing" : "done";
    } catch (e) {
      if (g !== this.generation || this.paused) return "failed";
      let missing = false;
      try {
        this.checkStorage();
        missing = !command && !!this.state.pending && e instanceof AttendanceManagementRejected && e.message === "attendance_correction_not_found";
        // Named terminal conflicts follow exact receipt lookup in the locked transaction.
        // Changed versions/basis or a legacy command lacking policy cannot become a new valid submission.
        if (command && e instanceof AttendanceManagementRejected && e.message !== "attendance_operation_conflict" && e.message !== "attendance_application_window_protocol_required"
          && (first || ["attendance_version_conflict", "attendance_correction_basis_changed", "attendance_correction_policy_changed", "attendance_correction_policy_required", "attendance_correction_decided"].includes(e.message))) this.clear();
      } catch { missing = false; }
      this.set({ result: null, phase: this.state.pending ? "unconfirmed" : "blocked", message: correctionMessage(e) });
      return missing ? "missing" : "failed";
    } finally { if (g === this.generation) this.controller = null; }
  }
}
