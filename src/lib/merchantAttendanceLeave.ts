import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceInstant, attendanceLocalDate, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseCorrectionTimeInput, type CorrectionTimeInput } from "./merchantAttendanceCorrectionForm";

export type LeaveAccess = "self" | "owner";
export type LeaveStatus = "submitted" | "withdrawn" | "approved" | "rejected" | "cancelled";
export type LeaveDecision = "withdraw" | "approve" | "reject" | "cancel";
export type LeaveQuery = { siteId: string; access: LeaveAccess; requestId: string | null; operationId: string | null; beforeAt: string | null; beforeId: string | null };
export type LeaveCommand = { operationId: string; reason: string } & (
  { action: "submit"; expectedWorkerId: string; expectedSettingsVersion: number; timeZone: string; startAt: string; endAt: string } |
  { action: LeaveDecision; requestId: string; expectedRevision: number });
export type LeaveSummary = { requestId: string; workerName: string; startAt: string; endAt: string; timeZone: string; submittedAt: string; revision: number; status: LeaveStatus };
export type LeaveDetail = LeaveSummary & { workerId: string; employeeId: string; reason: string;
  history: { revision: number; action: LeaveCommand["action"]; reason: string; recordedAt: string }[];
  canWithdraw: boolean; canApprove: boolean; canReject: boolean; canCancel: boolean };
export type LeaveResult = { protocol: "leave-v1"; siteId: string; access: LeaveAccess; actorId: string; employeeId: string | null; workerId: string | null;
  timeZone: string; settingsVersion: number; canSubmit: boolean; items: LeaveSummary[]; nextCursor: { at: string; id: string } | null;
  detail: LeaveDetail | null; receipt: { command: LeaveCommand; item: LeaveSummary; requestId: string; revision: number } | null };
export type LeaveResponse = LeaveResult & { moduleEnabled: boolean };
export const LEAVE_ERRORS: Readonly<Record<string, number>> = {
  attendance_leave_not_found: 404, attendance_leave_closed: 409, attendance_leave_overlap: 409, attendance_leave_binding_changed: 409,
  attendance_leave_outside_employment: 409, attendance_leave_invalid: 503, attendance_invalid_request: 400, attendance_access_denied: 403,
  attendance_settings_required: 409, attendance_platform_paused: 403, attendance_version_conflict: 409, attendance_operation_conflict: 409,
  attendance_worker_changed: 409, attendance_unavailable: 503, attendance_rate_limited: 429, attendance_not_available: 404,
  attendance_body_too_large: 413, attendance_invalid_content_type: 415,
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function exact(raw: unknown, keys: readonly string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const v = raw as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail();
  return v;
}
const positive = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 9007199254740990 ? v : fail();
const flag = (v: unknown) => typeof v === "boolean" ? v : fail();
const recordTime = (v: unknown) => { try { const t = attendanceRecordInstant(v); return t === v ? t : fail(); } catch { return fail(); } };
export function leaveReason(raw: unknown) {
  if (typeof raw !== "string" || raw !== raw.trim() || !raw || [...raw].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(raw)) return fail();
  return raw;
}
export function leaveInterval(startAt: unknown, endAt: unknown, timeZone: unknown) {
  if (typeof startAt !== "string" || typeof endAt !== "string" || typeof timeZone !== "string") return fail();
  try {
    const start = attendanceInstant(startAt), end = attendanceInstant(endAt), zone = attendanceTimeZone(timeZone);
    if (start % 60000 || end % 60000 || end <= start || end - start > 366 * 86400000) fail();
    for (const at of [startAt, endAt]) { const date = attendanceLocalDate(at, zone); if (date < "2000-01-01" || date > "2100-12-31") fail(); }
    return { startAt, endAt, timeZone: zone };
  } catch { return fail(); }
}
export function resolveLeaveInterval(start: CorrectionTimeInput, end: CorrectionTimeInput, zone: string) {
  for (const input of [start, end]) if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.local)) fail();
  const convert = (input: CorrectionTimeInput) => parseCorrectionTimeInput(input, zone).replace(/000Z$/, "Z");
  const interval = leaveInterval(convert(start), convert(end), zone);
  return { startAt: interval.startAt, endAt: interval.endAt };
}
export function parseLeaveQuery(raw: unknown): LeaveQuery {
  const q = exact(raw, ["siteId", "access", "requestId", "operationId", "beforeAt", "beforeId"]);
  if (q.access !== "self" && q.access !== "owner" || (q.beforeAt === null) !== (q.beforeId === null)
    || q.beforeAt !== null && (q.requestId !== null || q.operationId !== null)) return fail();
  return { siteId: attendanceSelfSite(q.siteId), access: q.access,
    requestId: q.requestId === null ? null : attendanceSelfUuid(q.requestId), operationId: q.operationId === null ? null : attendanceSelfUuid(q.operationId),
    beforeAt: q.beforeAt === null ? null : recordTime(q.beforeAt), beforeId: q.beforeId === null ? null : attendanceSelfUuid(q.beforeId) };
}
export function parseLeaveHttpQuery(url: string) {
  const params = new URL(url).searchParams, q: Record<string, unknown> = { requestId: null, operationId: null, beforeAt: null, beforeId: null };
  for (const [key, value] of params) { if (params.getAll(key).length !== 1) fail(); q[key] = value; }
  return parseLeaveQuery(q);
}
export const leaveQueryString = (q: LeaveQuery) => new URLSearchParams(Object.entries(parseLeaveQuery(q)).filter((e): e is [string, string] => e[1] !== null)).toString();
export function parseLeaveCommand(raw: unknown): LeaveCommand {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const submit = (raw as Record<string, unknown>).action === "submit";
  const c = exact(raw, submit ? ["operationId", "action", "reason", "expectedWorkerId", "expectedSettingsVersion", "timeZone", "startAt", "endAt"]
    : ["operationId", "action", "reason", "requestId", "expectedRevision"]);
  const base = { operationId: attendanceSelfUuid(c.operationId), reason: leaveReason(c.reason) };
  if (submit) return { ...base, action: "submit", expectedWorkerId: attendanceSelfUuid(c.expectedWorkerId), expectedSettingsVersion: positive(c.expectedSettingsVersion), ...leaveInterval(c.startAt, c.endAt, c.timeZone) };
  if (!["withdraw", "approve", "reject", "cancel"].includes(c.action as string) || c.expectedRevision !== (c.action === "cancel" ? 2 : 1)) return fail();
  return { ...base, action: c.action as LeaveDecision, requestId: attendanceSelfUuid(c.requestId), expectedRevision: c.expectedRevision as number };
}
export function parseLeaveBody(raw: unknown) {
  const v = exact(raw, ["query", "command"]), query = parseLeaveQuery(v.query), command = parseLeaveCommand(v.command);
  if (query.beforeAt !== null || query.beforeId !== null || query.operationId !== null
    || query.requestId !== (command.action === "submit" ? null : command.requestId)
    || (command.action === "submit" || command.action === "withdraw") !== (query.access === "self")) fail();
  return { query, command };
}
const summaryKeys = ["requestId", "workerName", "startAt", "endAt", "timeZone", "submittedAt", "revision", "status"];
const actionStatus = { submit: "submitted", withdraw: "withdrawn", approve: "approved", reject: "rejected", cancel: "cancelled" } as const;
export function parseLeaveSummary(raw: unknown): LeaveSummary {
  const v = exact(raw, summaryKeys), interval = leaveInterval(v.startAt, v.endAt, v.timeZone);
  if (typeof v.workerName !== "string" || v.workerName !== v.workerName.trim() || !v.workerName || [...v.workerName].length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(v.workerName)
    || !Object.values(actionStatus).includes(v.status as LeaveStatus) || v.revision !== (v.status === "submitted" ? 1 : v.status === "cancelled" ? 3 : 2)) return fail();
  return { requestId: attendanceSelfUuid(v.requestId), workerName: v.workerName, ...interval, submittedAt: recordTime(v.submittedAt), revision: v.revision as number, status: v.status as LeaveStatus };
}
export function parseLeaveDetail(raw: unknown): LeaveDetail {
  const v = exact(raw, [...summaryKeys, "workerId", "employeeId", "reason", "history", "canWithdraw", "canApprove", "canReject", "canCancel"]);
  const summary = parseLeaveSummary(Object.fromEntries(summaryKeys.map(k => [k, v[k]])));
  if (!Array.isArray(v.history) || v.history.length !== summary.revision) return fail();
  let previous = summary.submittedAt;
  const history = v.history.map((rawEntry, index) => {
    const entry = exact(rawEntry, ["revision", "action", "reason", "recordedAt"]), recordedAt = recordTime(entry.recordedAt);
    if (entry.revision !== index + 1 || !(index === 0 ? entry.action === "submit" && recordedAt === summary.submittedAt
      : index === 1 ? ["withdraw", "approve", "reject"].includes(entry.action as string) : entry.action === "cancel") || recordedAt < previous) fail();
    previous = recordedAt;
    return { revision: entry.revision as number, action: entry.action as LeaveCommand["action"], reason: leaveReason(entry.reason), recordedAt };
  });
  if (actionStatus[history.at(-1)!.action] !== summary.status || history.length === 3 && history[1].action !== "approve"
    || v.reason !== history[0].reason) fail();
  const detail = { ...summary, workerId: attendanceSelfUuid(v.workerId), employeeId: attendanceSelfUuid(v.employeeId), reason: leaveReason(v.reason), history,
    canWithdraw: flag(v.canWithdraw), canApprove: flag(v.canApprove), canReject: flag(v.canReject), canCancel: flag(v.canCancel) };
  if ((detail.canWithdraw || detail.canApprove || detail.canReject) && detail.status !== "submitted" || detail.canCancel && detail.status !== "approved") fail();
  if (detail.canApprove && !detail.canReject) fail();
  return detail;
}
export function sameLeaveCommand(a: LeaveCommand, b: LeaveCommand) { return JSON.stringify(parseLeaveCommand(a)) === JSON.stringify(parseLeaveCommand(b)); }
const resultKeys = ["protocol", "siteId", "access", "actorId", "employeeId", "workerId", "timeZone", "settingsVersion", "canSubmit", "items", "nextCursor", "detail", "receipt"];
export function parseLeaveResult(raw: unknown, input: LeaveQuery, command: LeaveCommand | null = null, expectedActorId?: string): LeaveResult {
  const q = parseLeaveQuery(input), v = exact(raw, resultKeys), actorId = attendanceSelfUuid(v.actorId);
  if (command) parseLeaveBody({ query: q, command });
  if (v.protocol !== "leave-v1" || v.siteId !== q.siteId || v.access !== q.access || expectedActorId !== undefined && actorId !== expectedActorId
    || !Array.isArray(v.items) || v.items.length > 25) return fail();
  if ((q.requestId || q.operationId || command) && (v.items.length || v.nextCursor !== null)) fail();
  const employeeId = v.employeeId === null ? null : attendanceSelfUuid(v.employeeId), workerId = v.workerId === null ? null : attendanceSelfUuid(v.workerId), canSubmit = flag(v.canSubmit);
  if (q.access === "owner" ? employeeId !== null || workerId !== null || canSubmit : employeeId === null || canSubmit && workerId === null) fail();
  let previousAt = q.beforeAt, previousId = q.beforeId;
  const ids = new Set<string>();
  const items = v.items.map(rawItem => {
    const item = parseLeaveSummary(rawItem);
    if (ids.has(item.requestId) || previousAt && (item.submittedAt > previousAt || item.submittedAt === previousAt && item.requestId >= previousId!)) fail();
    ids.add(item.requestId); previousAt = item.submittedAt; previousId = item.requestId; return item;
  });
  let nextCursor: LeaveResult["nextCursor"] = null;
  if (v.nextCursor !== null) {
    const c = exact(v.nextCursor, ["at", "id"]); nextCursor = { at: recordTime(c.at), id: attendanceSelfUuid(c.id) };
    if (items.length !== 25 || nextCursor.at !== previousAt || nextCursor.id !== previousId || q.requestId !== null || q.operationId !== null) fail();
  }
  const detail = v.detail === null ? null : parseLeaveDetail(v.detail);
  if (detail) {
    if (q.requestId !== null && detail.requestId !== q.requestId || q.access === "self" && (detail.employeeId !== employeeId || detail.workerId !== workerId || detail.canApprove || detail.canReject || detail.canCancel)
      || q.access === "owner" && detail.canWithdraw) fail();
    const item = items.find(i => i.requestId === detail.requestId);
    if (item && summaryKeys.some(k => item[k as keyof LeaveSummary] !== detail[k as keyof LeaveSummary])) fail();
  }
  if (q.requestId && !detail) fail();
  let receipt: LeaveResult["receipt"] = null;
  if (v.receipt !== null) {
    const r = exact(v.receipt, ["command", "item", "requestId", "revision"]), c = parseLeaveCommand(r.command), item = parseLeaveSummary(r.item);
    if (c.operationId !== (command?.operationId ?? q.operationId) || item.requestId !== (c.action === "submit" ? c.operationId : c.requestId)
      || r.requestId !== item.requestId || r.revision !== item.revision || item.revision !== (c.action === "submit" ? 1 : c.expectedRevision + 1)
      || item.status !== actionStatus[c.action] || (c.action === "submit" || c.action === "withdraw") !== (q.access === "self")
      || c.action === "submit" && (item.startAt !== c.startAt || item.endAt !== c.endAt || item.timeZone !== c.timeZone)
      || command && !sameLeaveCommand(c, command)) fail();
    receipt = { command: c, item, requestId: item.requestId, revision: item.revision };
  }
  if (command && !receipt) fail();
  if (detail && !q.requestId && !receipt && !command) fail();
  if (receipt) {
    if (!detail || detail.requestId !== receipt.requestId || detail.revision < receipt.revision
      || summaryKeys.filter(k => k !== "revision" && k !== "status").some(k => detail[k as keyof LeaveSummary] !== receipt.item[k as keyof LeaveSummary])
      || detail.history[receipt.revision - 1].action !== receipt.command.action || detail.history[receipt.revision - 1].reason !== receipt.command.reason
      || receipt.command.action === "submit" && detail.workerId !== receipt.command.expectedWorkerId) fail();
  }
  if (typeof v.timeZone !== "string") return fail();
  return { protocol: "leave-v1", siteId: q.siteId, access: q.access, actorId, employeeId, workerId, timeZone: attendanceTimeZone(v.timeZone),
    settingsVersion: positive(v.settingsVersion), canSubmit, items, nextCursor, detail, receipt };
}
export function parseLeaveResponse(raw: unknown, q: LeaveQuery, command: LeaveCommand | null = null, expectedActorId?: string): LeaveResponse {
  const v = exact(raw, ["ok", "moduleEnabled", ...resultKeys]);
  if (v.ok !== true || typeof v.moduleEnabled !== "boolean") return fail();
  const { ok, moduleEnabled, ...rest } = v; void ok;
  return { ...parseLeaveResult(rest, q, command, expectedActorId), moduleEnabled };
}
