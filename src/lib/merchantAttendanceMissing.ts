import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { parseCorrectionProposal, type CorrectionProposal } from "./merchantAttendanceCorrection";
import { attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { scheduleDate } from "./merchantAttendanceSchedule";
export type MissingQuery = { siteId: string; access: "self" | "owner"; fromDate: string; throughDate: string; requestId: string | null; operationId: string | null; beforeAt: string | null; beforeId: string | null };
export type MissingCommand = { operationId: string; reason: string } & (
  { action: "submit"; expectedWorkerId: string; expectedSettingsVersion: number; expectedPolicyRevision: number; locationId: string; timeZone: string; proposal: CorrectionProposal } |
  { action: "revise"; expectedWorkerId: string; expectedSettingsVersion: number; expectedPolicyRevision: number; locationId: string; timeZone: string; proposal: CorrectionProposal; supersedesRequestId: string; expectedApprovalOperationId: string } |
  { action: "withdraw"; requestId: string; expectedRevision: number } |
  { action: "approve" | "reject"; requestId: string; expectedRevision: number; evidenceToken: string });
export type MissingSummary = { requestId: string; employeeId: string; workerName: string; startAt: string; endAt: string; submittedAt: string; revision: number; status: "submitted" | "withdrawn" | "approved" | "rejected" };
export type MissingLineage = { rootRequestId: string; supersedesRequestId: string | null; currentRequestId: string | null; currentApprovalOperationId: string | null; canRevise: boolean };
export type MissingDetail = MissingSummary & { reason: string; proposal: CorrectionProposal; locationName: string; timeZone: string; lineage: MissingLineage | null;
  policyRevision: number; deadlineAt: string; terminal: null | { reason: string; recordedAt: string }; issues: string[]; evidenceToken: string; canApprove: boolean; canReject: boolean };
export type MissingResult = { siteId: string; access: "self" | "owner"; employeeId: string | null; workerId: string | null; locationId: string | null; timeZone: string;
  canRequest: boolean; settingsVersion: number; policyRevision: number; fromDate: string; throughDate: string; asOf: string;
  items: MissingSummary[]; nextCursor: null | { at: string; id: string }; detail: MissingDetail | null;
  receipt: null | { operationId: string; requestId: string; revision: number; command: MissingCommand }; includedInTimesheet: false; moduleEnabled: boolean };
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
export const missingObject = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
function exact(v: Record<string, unknown>, names: string[]) { if (Object.keys(v).length !== names.length || names.some(k => !Object.hasOwn(v, k))) fail(); }
function number(v: unknown, min = 0): number { return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v < Number.MAX_SAFE_INTEGER - 1 ? v : fail(); }
function text(v: unknown, max = 200): string { return typeof v === "string" && v === v.trim() && [...v].length > 0 && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v) ? v : fail(); }
function bool(v: unknown): boolean { return typeof v === "boolean" ? v : fail(); }
function token(v: unknown): string { return typeof v === "string" && /^[a-f0-9]{32}$/.test(v) ? v : fail(); }
export function missingProposal(v: unknown): CorrectionProposal {
  const p = parseCorrectionProposal(v);
  const us = (s: string) => BigInt(Date.parse(s.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(s.slice(23, 26));
  if (us(p.endAt) - us(p.startAt) > BigInt(86400000000) || p.breaks.length > 8) fail(); return p;
}
export function missingQueryString(q: MissingQuery): string { const p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, v); return p.toString(); }
export function parseMissingQuery(url: string): MissingQuery {
  const q = new URL(url).searchParams;
  for (const k of q.keys()) if (!["siteId", "access", "fromDate", "throughDate", "requestId", "operationId", "beforeAt", "beforeId"].includes(k) || q.getAll(k).length !== 1) fail();
  const access = q.get("access"); if (access !== "self" && access !== "owner") return fail();
  const fromDate = scheduleDate(q.get("fromDate")), throughDate = scheduleDate(q.get("throughDate")), days = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000;
  if (days < 0 || days > 30) fail();
  const requestId = q.has("requestId") ? attendanceSelfUuid(q.get("requestId")) : null, operationId = q.has("operationId") ? attendanceSelfUuid(q.get("operationId")) : null;
  const beforeAt = q.has("beforeAt") ? attendanceRecordInstant(q.get("beforeAt")) : null, beforeId = q.has("beforeId") ? attendanceSelfUuid(q.get("beforeId")) : null;
  if ((beforeAt === null) !== (beforeId === null) || beforeAt && (requestId || operationId)) fail();
  return { siteId: attendanceSelfSite(q.get("siteId")), access, fromDate, throughDate, requestId, operationId, beforeAt, beforeId };
}
export function parseMissingBody(raw: unknown): { query: MissingQuery; command: MissingCommand } {
  const v = missingObject(raw); exact(v, ["query", "command"]); const q = missingObject(v.query);
  exact(q, ["siteId", "access", "fromDate", "throughDate", "requestId", "operationId", "beforeAt", "beforeId"]);
  attendanceSelfSite(q.siteId); scheduleDate(q.fromDate); scheduleDate(q.throughDate);
  if (q.operationId !== null || q.beforeAt !== null || q.beforeId !== null || q.requestId !== null && typeof q.requestId !== "string") fail();
  const query = parseMissingQuery(`https://local.invalid/?${missingQueryString(q as MissingQuery)}`), c = missingObject(v.command);
  const base = { operationId: attendanceSelfUuid(c.operationId), reason: text(c.reason) };
  if (c.action === "submit" || c.action === "revise") {
    exact(c, ["operationId", "reason", "action", "expectedWorkerId", "expectedSettingsVersion", "expectedPolicyRevision", "locationId", "timeZone", "proposal", ...(c.action === "revise" ? ["supersedesRequestId", "expectedApprovalOperationId"] : [])]);
    if (query.access !== "self" || query.requestId !== null) fail();
    const fields = { ...base, expectedWorkerId: attendanceSelfUuid(c.expectedWorkerId), expectedSettingsVersion: number(c.expectedSettingsVersion, 1),
      expectedPolicyRevision: number(c.expectedPolicyRevision, 1), locationId: attendanceSelfUuid(c.locationId), timeZone: attendanceTimeZone(text(c.timeZone, 100)), proposal: missingProposal(c.proposal) };
    if (c.action === "submit") return { query, command: { ...fields, action: "submit" } };
    const supersedesRequestId = attendanceSelfUuid(c.supersedesRequestId), expectedApprovalOperationId = attendanceSelfUuid(c.expectedApprovalOperationId);
    if (base.operationId === supersedesRequestId || base.operationId === expectedApprovalOperationId) fail();
    return { query, command: { ...fields, action: "revise", supersedesRequestId, expectedApprovalOperationId } };
  }
  const requestId = attendanceSelfUuid(c.requestId), expectedRevision = number(c.expectedRevision, 1);
  if (query.requestId !== requestId || expectedRevision !== 1) fail();
  if (c.action === "withdraw") {
    exact(c, ["operationId", "reason", "action", "requestId", "expectedRevision"]); if (query.access !== "self") fail();
    return { query, command: { ...base, action: "withdraw", requestId, expectedRevision } };
  }
  exact(c, ["operationId", "reason", "action", "requestId", "expectedRevision", "evidenceToken"]);
  if ((c.action !== "approve" && c.action !== "reject") || query.access !== "owner") return fail();
  return { query, command: { ...base, action: c.action, requestId, expectedRevision, evidenceToken: token(c.evidenceToken) } };
}
export function missingCommandMatches(a: MissingCommand, b: MissingCommand): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export function parseMissingResult(raw: unknown, q: MissingQuery, requireModule = true): MissingResult {
  const v = missingObject(raw), asOf = attendanceRecordInstant(v.asOf);
  if (v.siteId !== q.siteId || v.access !== q.access || v.fromDate !== q.fromDate || v.throughDate !== q.throughDate || v.includedInTimesheet !== false || !Array.isArray(v.items) || v.items.length > 25) fail();
  const employeeId = v.employeeId === null ? null : attendanceSelfUuid(v.employeeId), workerId = v.workerId === null ? null : attendanceSelfUuid(v.workerId), locationId = v.locationId === null ? null : attendanceSelfUuid(v.locationId);
  const canRequest = bool(v.canRequest);
  if (q.access === "self" && !employeeId || q.access === "owner" && (employeeId || workerId || locationId || canRequest) || canRequest && (!workerId || !locationId)) fail();
  const summary = (rawItem: unknown): MissingSummary => {
    const i = missingObject(rawItem), status = i.status;
    if (!["submitted", "withdrawn", "approved", "rejected"].includes(String(status))) fail();
    const startAt = attendanceRecordInstant(i.startAt), endAt = attendanceRecordInstant(i.endAt), submittedAt = attendanceRecordInstant(i.submittedAt), revision = number(i.revision, 1);
    if (endAt <= startAt || endAt > submittedAt || submittedAt > asOf || Date.parse(endAt) - Date.parse(startAt) > 86400000 || revision !== (status === "submitted" ? 1 : 2)) fail();
    const e = attendanceSelfUuid(i.employeeId); if (q.access === "self" && e !== employeeId) fail();
    return { requestId: attendanceSelfUuid(i.requestId), employeeId: e, workerName: text(i.workerName, 120), startAt, endAt, submittedAt, revision, status: status as MissingSummary["status"] };
  };
  let prior = q.beforeAt ? { submittedAt: q.beforeAt, requestId: q.beforeId! } : null;
  const items = (v.items as unknown[]).map(rawItem => { const i = summary(rawItem);
    if (i.submittedAt.slice(0, 10) < q.fromDate || i.submittedAt.slice(0, 10) > q.throughDate || prior && (i.submittedAt > prior.submittedAt || i.submittedAt === prior.submittedAt && i.requestId >= prior.requestId)) fail();
    prior = i; return i;
  }); if (new Set(items.map(i => i.requestId)).size !== items.length) fail();
  let nextCursor = null;
  if (v.nextCursor !== null) { const c = missingObject(v.nextCursor); nextCursor = { at: attendanceRecordInstant(c.at), id: attendanceSelfUuid(c.id) };
    if (items.length !== 25 || nextCursor.at !== items.at(-1)?.submittedAt || nextCursor.id !== items.at(-1)?.requestId) fail(); }
  let receipt: MissingResult["receipt"] = null;
  if (v.receipt !== null) {
    const r = missingObject(v.receipt), c = missingObject(r.command), requestId = attendanceSelfUuid(r.requestId);
    const creates = c.action === "submit" || c.action === "revise";
    const command = parseMissingBody({ query: { ...q, requestId: creates ? null : requestId, operationId: null, beforeAt: null, beforeId: null }, command: c }).command;
    if (r.operationId !== q.operationId || command.operationId !== q.operationId || creates && requestId !== command.operationId || q.requestId && requestId !== q.requestId) fail();
    const revision = number(r.revision, 1); if (revision !== (creates ? 1 : 2)) fail();
    receipt = { operationId: attendanceSelfUuid(r.operationId), requestId, revision, command };
  }
  let detail: MissingDetail | null = null;
  if (v.detail !== null) {
    const d = missingObject(v.detail), item = summary(d), proposal = missingProposal(d.proposal);
    if (item.requestId !== (q.requestId ?? receipt?.requestId) || proposal.startAt !== item.startAt || proposal.endAt !== item.endAt) fail();
    let terminal = null; if (d.terminal !== null) { const t = missingObject(d.terminal); terminal = { reason: text(t.reason), recordedAt: attendanceRecordInstant(t.recordedAt) };
      if (terminal.recordedAt < item.submittedAt || terminal.recordedAt > asOf) fail(); }
    if ((item.status === "submitted") !== (terminal === null) || !Array.isArray(d.issues) || d.issues.some(i => typeof i !== "string" || !Object.hasOwn(MISSING_ISSUE_LABELS, i))) fail();
    const issues = d.issues as string[], canApprove = bool(d.canApprove), canReject = bool(d.canReject);
    if (canApprove && (issues.length || q.access !== "owner" || item.status !== "submitted") || canReject && (q.access !== "owner" || item.status !== "submitted" || issues.includes("self_review"))) fail();
    let lineage: MissingLineage | null = null;
    if (d.lineage !== undefined && d.lineage !== null) {
      const l = missingObject(d.lineage); exact(l, ["rootRequestId", "supersedesRequestId", "currentRequestId", "currentApprovalOperationId", "canRevise"]);
      lineage = { rootRequestId: attendanceSelfUuid(l.rootRequestId), supersedesRequestId: l.supersedesRequestId === null ? null : attendanceSelfUuid(l.supersedesRequestId),
        currentRequestId: l.currentRequestId === null ? null : attendanceSelfUuid(l.currentRequestId), currentApprovalOperationId: l.currentApprovalOperationId === null ? null : attendanceSelfUuid(l.currentApprovalOperationId), canRevise: bool(l.canRevise) };
      if ((lineage.currentRequestId === null) !== (lineage.currentApprovalOperationId === null) || lineage.supersedesRequestId === item.requestId
        || (lineage.supersedesRequestId === null) !== (lineage.rootRequestId === item.requestId)
        || lineage.currentRequestId === item.requestId && item.status !== "approved"
        || item.status === "approved" && lineage.currentRequestId === null
        || lineage.supersedesRequestId !== null && lineage.currentRequestId === null
        || lineage.supersedesRequestId === null && item.status !== "approved" && lineage.currentRequestId !== null
        || lineage.canRevise && (q.access !== "self" || item.status !== "approved" || lineage.currentRequestId !== item.requestId || !lineage.currentApprovalOperationId || !canRequest)) fail();
      if (receipt?.command.action === "revise" && lineage.supersedesRequestId !== receipt.command.supersedesRequestId) fail();
    }
    if (receipt?.command.action === "revise" && !lineage) fail();
    detail = { ...item, proposal, lineage, reason: text(d.reason), locationName: text(d.locationName, 120), timeZone: attendanceTimeZone(text(d.timeZone, 100)), policyRevision: number(d.policyRevision, 1),
      deadlineAt: attendanceRecordInstant(d.deadlineAt), terminal, issues, evidenceToken: token(d.evidenceToken), canApprove, canReject };
  } else if (q.requestId || receipt) fail();
  return { siteId: q.siteId, access: q.access, employeeId, workerId, locationId, timeZone: attendanceTimeZone(text(v.timeZone, 100)), canRequest,
    settingsVersion: number(v.settingsVersion, 1), policyRevision: number(v.policyRevision), fromDate: q.fromDate, throughDate: q.throughDate, asOf,
    items, nextCursor, detail, receipt, includedInTimesheet: false, moduleEnabled: requireModule ? bool(v.moduleEnabled) : false };
}
export const MISSING_ISSUE_LABELS: Record<string, string> = { binding_changed: "员工关联已变化", employee_inactive: "员工或考勤档案已停用", self_review: "不能审核自己的申请",
  employment_gap: "申报时段不在完整在职范围内", raw_overlap: "与原始打卡时段重叠", effective_overlap: "与已有核定工时重叠", missing_overlap: "与其他未撤回／未驳回的整段申请重叠",
  period_locked: "申报时段处于已锁周期", terminal: "此申请已处理" };
Object.assign(MISSING_ISSUE_LABELS, { revision_base_changed: "修订依据已变化，请重新读取最新批准版本", revision_base_locked: "原批准时段处于已锁定周期，不能通过移动时间绕过锁定" });
export const MISSING_ERRORS: Readonly<Record<string, number>> = { attendance_missing_revision_stale: 409, attendance_missing_revision_pending: 409, attendance_missing_revision_unchanged: 409,
  attendance_application_window_protocol_required: 409,
  attendance_period_sealed: 409,
  attendance_invalid_request: 400, attendance_invalid_instant: 400, attendance_invalid_time_zone: 400,
  attendance_body_too_large: 413, attendance_invalid_content_type: 415, attendance_access_denied: 403, attendance_platform_paused: 403, attendance_rate_limited: 429,
  attendance_settings_required: 409, attendance_missing_not_found: 404, attendance_missing_closed: 409, attendance_missing_conflict: 409, attendance_missing_basis_changed: 409,
  attendance_version_conflict: 409, attendance_operation_conflict: 409, attendance_worker_changed: 409, attendance_correction_policy_required: 409,
  attendance_correction_window_expired: 409, attendance_correction_policy_changed: 409 };
export function missingMessage(code: string): string {
  if (code === "attendance_application_window_protocol_required") return "该商户已启用新版申请窗口，请通过新入口核对后提交；旧待确认编号保留，请先在原入口核对，不会自动重发。";
  if (code === "attendance_period_sealed") return "该员工周期已封存，请负责人填写理由重开后，再重新核对漏卡申请；原记录未改写。";
  const revisions: Record<string, string> = { attendance_missing_revision_stale: "原批准版本已变化，请重新读取最新版本后申请修订。",
    attendance_missing_revision_pending: "该批准版本已有待审修订，请先处理或撤回；原批准版本继续有效。",
    attendance_missing_revision_unchanged: "起止与休息均未改变，无需提交修订。" };
  if (revisions[code]) return revisions[code];
  return ({ attendance_access_denied: "当前身份无权操作，资料已隐藏。", attendance_missing_closed: "申请已处理，请重新读取结果。", attendance_missing_conflict: "时间、在职范围或锁定状态有冲突，未提交／批准；请重新核对。",
    attendance_missing_basis_changed: "核对依据已变化，请重新读取详情后再明确决定。", attendance_platform_paused: "平台暂停新申请和审批，已有资料仍可核对。",
    attendance_correction_policy_required: "负责人需先配置补正申请期限。", attendance_correction_window_expired: "已超过所配置的申请期限。",
    attendance_correction_policy_changed: "申请期限规则已变化，请重新读取。", attendance_worker_changed: "员工档案或地点已变化，请重新读取。",
    attendance_version_conflict: "企业配置已变化，请重新读取。" } as Record<string, string>)[code] ?? "未能确认操作结果，请查原收据；网络异常不代表没有保存。";
}
