// Independent C16 application ledger. Approval records an arrangement, never
// attendance, earned hours, leave balances or an exemption from clock controls.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact as exact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { resolveLeaveInterval } from "./merchantAttendanceLeave";
import type { CorrectionTimeInput } from "./merchantAttendanceCorrectionForm";

export const WORK_ARRANGEMENT_API = "/api/merchant-enterprise/attendance/work-arrangements";
export const WORK_ARRANGEMENT_BYTE_LIMIT = 131072;
export const WORK_ARRANGEMENT_BODY_BYTE_LIMIT = 8192;
export type WorkArrangementAccess = "self" | "owner";
export type WorkArrangementKind = "trip" | "field" | "remote";
export type WorkArrangementStatus = "submitted" | "withdrawn" | "approved" | "rejected" | "cancelled";
export type WorkArrangementDecision = "withdraw" | "approve" | "reject" | "cancel";
export type WorkArrangementPreviewInput = { kind: WorkArrangementKind; timeZone: string; startAt: string; endAt: string };
export type WorkArrangementQuery = { siteId: string; access: WorkArrangementAccess; requestId: string | null; operationId: string | null;
  beforeAt: string | null; beforeId: string | null; preview: WorkArrangementPreviewInput | null };
export type WorkArrangementCommand = { operationId: string; reason: string } & (
  { action: "submit"; expectedWorkerId: string; expectedSettingsVersion: number; expectedPolicyRevision: number } & WorkArrangementPreviewInput |
  { action: "withdraw" | "reject" | "cancel"; requestId: string; expectedRevision: number } |
  { action: "approve"; requestId: string; expectedRevision: number; expectedConflictsFingerprint: string; confirmConflicts: boolean } |
  { action: "set_policy"; expectedRevision: number; retrospectiveDays: number });
export type WorkArrangementPolicy = { operationId: string | null; revision: number; retrospectiveDays: number; actorId: string | null; recordedAt: string | null };
export type WorkArrangementItem = WorkArrangementPreviewInput & { requestId: string; workerId: string; employeeId: string; employeeAuthUserId: string;
  workerName: string; submittedAt: string; policyRevision: number; retrospectiveDays: number; revision: number; status: WorkArrangementStatus };
export type WorkArrangementConflict = { source: "work_arrangement" | "leave" | "schedule"; id: string; status: "submitted" | "approved" | "scheduled";
  revision: number; kind: WorkArrangementKind | null; startAt: string; endAt: string; timeZone: string };
export type WorkArrangementIssue = "binding_changed" | "employment_gap" | "outside_window" | "conflicts" | "sealed";
export type WorkArrangementHistory = { operationId: string; revision: number; action: Exclude<WorkArrangementCommand["action"], "set_policy">;
  actorId: string; reason: string; recordedAt: string; command: WorkArrangementCommand };
export type WorkArrangementDetail = WorkArrangementItem & { reason: string; history: WorkArrangementHistory[]; conflicts: WorkArrangementConflict[];
  conflictsFingerprint: string; sealed: boolean; issues: WorkArrangementIssue[]; canWithdraw: boolean; canApprove: boolean; canReject: boolean; canCancel: boolean };
export type WorkArrangementPreview = WorkArrangementPreviewInput & { conflicts: WorkArrangementConflict[]; conflictsFingerprint: string;
  sealed: boolean; issues: WorkArrangementIssue[]; canSubmit: boolean };
export type WorkArrangementReceipt = { command: WorkArrangementCommand; item: WorkArrangementItem | null; policy: WorkArrangementPolicy | null };
export type WorkArrangementResult = { protocol: "work-arrangement-v1"; siteId: string; access: WorkArrangementAccess; actorId: string;
  employeeId: string | null; workerId: string | null; timeZone: string; settingsVersion: number; canSubmit: boolean; policy: WorkArrangementPolicy;
  items: WorkArrangementItem[]; nextCursor: { at: string; id: string } | null; detail: WorkArrangementDetail | null;
  receipt: WorkArrangementReceipt | null; preview: WorkArrangementPreview | null; readAt: string };
export type WorkArrangementResponse = WorkArrangementResult & { moduleEnabled: boolean };
export const WORK_ARRANGEMENT_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_not_available: 404, attendance_settings_required: 409,
  attendance_worker_not_found: 404, attendance_worker_changed: 409, attendance_platform_paused: 403, attendance_version_conflict: 409,
  attendance_operation_conflict: 409, attendance_period_sealed: 409, attendance_period_closure_invalid: 503,
  attendance_work_arrangement_invalid: 503, attendance_work_arrangement_not_found: 404, attendance_work_arrangement_closed: 409,
  attendance_work_arrangement_binding_changed: 409, attendance_work_arrangement_outside_employment: 409,
  attendance_work_arrangement_outside_window: 409, attendance_work_arrangement_conflicts_changed: 409,
  attendance_work_arrangement_conflict_confirmation_required: 409, attendance_work_arrangement_too_large: 422,
  attendance_unavailable: 503, attendance_rate_limited: 429, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
  forbidden_origin: 403, method_not_allowed: 405, unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403, employee_password_authentication_required: 403,
});
const fail = (code = "attendance_work_arrangement_invalid"): never => { throw new MerchantAttendanceError(code); };
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 ? captureBrowserUuid(v) : fail();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^\d{8}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 0, max = 9007199254740990): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[a-f0-9]{64}$/.test(v) ? v : fail();
function label(v: unknown, max = 200): string {
  if (typeof v !== "string" || !v || v !== v.trim() || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) return fail();
  return v;
}
function stamp(v: unknown, digits: 3 | 6 = 6): string {
  if (typeof v !== "string" || v.length !== (digits === 3 ? 24 : 27)
    || !(digits === 3 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).test(v)
    || v.startsWith("0000-")) return fail();
  const ms = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail(); return v;
}
export function validateWorkArrangementTree(value: unknown, limit = WORK_ARRANGEMENT_BYTE_LIMIT): void {
  let count = 0; const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++count > 18000 || depth > 16) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > limit) fail(); for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const n = v.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail(); }
      else if (c >= 0xdc00 && c <= 0xdfff) fail(); } return; }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
    if (!v || typeof v !== "object" || seen.has(v)) return fail(); seen.add(v);
    const proto = Object.getPrototypeOf(v), descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 300 || keys.length !== v.length + 1) fail();
      for (let i = 0; i < v.length; i++) { const d = descriptors[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); }
    } else { if (proto !== Object.prototype && proto !== null) fail(); for (const key of keys) {
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return fail();
      const d = descriptors[key]; if (!("value" in d) || !d.enumerable) fail(); visit(d.value, depth + 1); } }
    seen.delete(v);
  };
  visit(value, 0); if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limit) fail();
}
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export function parseWorkArrangementJson(text: string, kind: "request" | "response" = "response"): unknown {
  try { const limit = kind === "request" ? WORK_ARRANGEMENT_BODY_BYTE_LIMIT : WORK_ARRANGEMENT_BYTE_LIMIT;
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > limit) fail();
    const value = parseCaptureBrowserJson(text); validateWorkArrangementTree(value, limit); return value;
  } catch { return fail(kind === "request" ? "attendance_invalid_request" : "attendance_work_arrangement_invalid"); }
}
function interval(raw: unknown): WorkArrangementPreviewInput {
  const v = exact(raw, ["kind", "timeZone", "startAt", "endAt"]);
  if (!["trip", "field", "remote"].includes(v.kind as string)) return fail();
  const startAt = stamp(v.startAt, 3), endAt = stamp(v.endAt, 3), timeZone = label(v.timeZone, 100);
  if (Date.parse(startAt) % 60000 || Date.parse(endAt) % 60000 || endAt <= startAt || Date.parse(endAt) - Date.parse(startAt) > 366 * 86400000) fail();
  // Archived UTC intervals are not recalculated using current tzdata.
  return { kind: v.kind as WorkArrangementKind, timeZone, startAt, endAt };
}
export function resolveWorkArrangementInterval(start: CorrectionTimeInput, end: CorrectionTimeInput, zone: string) {
  return resolveLeaveInterval(start, end, zone);
}
export function parseWorkArrangementQuery(raw: unknown): WorkArrangementQuery {
  try { validateWorkArrangementTree(raw, WORK_ARRANGEMENT_BODY_BYTE_LIMIT); const v = exact(raw, ["siteId", "access", "requestId", "operationId", "beforeAt", "beforeId", "preview"]);
    if (v.access !== "self" && v.access !== "owner" || (v.beforeAt === null) !== (v.beforeId === null)
      || v.beforeAt !== null && (v.requestId !== null || v.operationId !== null || v.preview !== null)
      || v.preview !== null && (v.access !== "self" || v.requestId !== null || v.operationId !== null)) return fail();
    return freeze({ siteId: site(v.siteId), access: v.access, requestId: v.requestId === null ? null : uuid(v.requestId),
      operationId: v.operationId === null ? null : uuid(v.operationId), beforeAt: v.beforeAt === null ? null : stamp(v.beforeAt),
      beforeId: v.beforeId === null ? null : uuid(v.beforeId), preview: v.preview === null ? null : interval(v.preview) });
  } catch { return fail("attendance_invalid_request"); }
}
export function parseWorkArrangementHttpQuery(url: string): WorkArrangementQuery {
  try { const p = new URL(url).searchParams, v: Record<string, unknown> = { requestId: null, operationId: null, beforeAt: null, beforeId: null, preview: null };
    for (const [k, value] of p) { if (p.getAll(k).length !== 1) fail(); v[k] = k === "preview" ? parseWorkArrangementJson(value, "request") : value; }
    return parseWorkArrangementQuery(v);
  } catch { return fail("attendance_invalid_request"); }
}
export function workArrangementQueryString(input: WorkArrangementQuery): string {
  const q = parseWorkArrangementQuery(input), p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== null) p.set(k, typeof v === "string" ? v : JSON.stringify(v)); return p.toString();
}
export function parseWorkArrangementCommand(raw: unknown): WorkArrangementCommand {
  try { validateWorkArrangementTree(raw, WORK_ARRANGEMENT_BODY_BYTE_LIMIT);
    const action = Object.getOwnPropertyDescriptor(raw, "action")?.value;
    const keys = ["action", "operationId", "reason", ...(action === "submit" ? ["expectedWorkerId", "expectedSettingsVersion", "expectedPolicyRevision", "kind", "timeZone", "startAt", "endAt"]
      : action === "set_policy" ? ["expectedRevision", "retrospectiveDays"] : ["requestId", "expectedRevision", ...(action === "approve" ? ["expectedConflictsFingerprint", "confirmConflicts"] : [])])];
    const c = exact(raw, keys), base = { operationId: uuid(c.operationId), reason: label(c.reason) };
    if (action === "submit") return freeze({ ...base, action, expectedWorkerId: uuid(c.expectedWorkerId), expectedSettingsVersion: integer(c.expectedSettingsVersion, 1),
      expectedPolicyRevision: integer(c.expectedPolicyRevision), ...interval({ kind: c.kind, timeZone: c.timeZone, startAt: c.startAt, endAt: c.endAt }) });
    if (action === "set_policy") return freeze({ ...base, action, expectedRevision: integer(c.expectedRevision), retrospectiveDays: integer(c.retrospectiveDays, 0, 365) });
    if (!["approve", "withdraw", "reject", "cancel"].includes(action) || c.expectedRevision !== (action === "cancel" ? 2 : 1)) return fail();
    const decision = { ...base, requestId: uuid(c.requestId), expectedRevision: c.expectedRevision as number };
    return freeze(action === "approve" ? { ...decision, action, expectedConflictsFingerprint: hash(c.expectedConflictsFingerprint), confirmConflicts: bool(c.confirmConflicts) }
      : { ...decision, action: action as "withdraw" | "reject" | "cancel" });
  } catch { return fail("attendance_invalid_request"); }
}
export function parseWorkArrangementBody(raw: unknown) {
  try { validateWorkArrangementTree(raw, WORK_ARRANGEMENT_BODY_BYTE_LIMIT); const v = exact(raw, ["query", "command"]), query = parseWorkArrangementQuery(v.query), command = parseWorkArrangementCommand(v.command);
    if (query.preview !== null || query.beforeAt !== null || query.operationId !== null || query.requestId !== ("requestId" in command ? command.requestId : null)
      || (command.action === "submit" || command.action === "withdraw") !== (query.access === "self")) fail();
    return freeze({ query, command });
  } catch { return fail("attendance_invalid_request"); }
}
export function sameWorkArrangementCommand(a: WorkArrangementCommand, b: WorkArrangementCommand): boolean {
  return JSON.stringify(parseWorkArrangementCommand(a)) === JSON.stringify(parseWorkArrangementCommand(b));
}
const ITEM_KEYS = ["requestId", "workerId", "employeeId", "employeeAuthUserId", "workerName", "kind", "startAt", "endAt", "timeZone", "submittedAt", "policyRevision", "retrospectiveDays", "revision", "status"];
const RESULT_KEYS = ["protocol", "siteId", "access", "actorId", "employeeId", "workerId", "timeZone", "settingsVersion", "canSubmit", "policy", "items", "nextCursor", "detail", "receipt", "preview", "readAt"];
const ACTION_STATUS = { submit: "submitted", withdraw: "withdrawn", approve: "approved", reject: "rejected", cancel: "cancelled" } as const;
const pick = (v: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map(k => [k, v[k]]));
function policyData(raw: unknown): WorkArrangementPolicy {
  const p = exact(raw, ["operationId", "revision", "retrospectiveDays", "actorId", "recordedAt"]), revision = integer(p.revision), retrospectiveDays = integer(p.retrospectiveDays, 0, 365);
  if (!revision) { if (p.operationId !== null || p.actorId !== null || p.recordedAt !== null || retrospectiveDays !== 30) fail();
    return { operationId: null, revision, retrospectiveDays, actorId: null, recordedAt: null }; }
  return { operationId: uuid(p.operationId), revision, retrospectiveDays, actorId: uuid(p.actorId), recordedAt: stamp(p.recordedAt) };
}
export function parseWorkArrangementItem(raw: unknown): WorkArrangementItem {
  validateWorkArrangementTree(raw);
  const v = exact(raw, ITEM_KEYS), span = interval(pick(v, ["kind", "timeZone", "startAt", "endAt"]));
  if (!["submitted", "approved", "withdrawn", "rejected", "cancelled"].includes(v.status as string)
    || v.revision !== (v.status === "submitted" ? 1 : v.status === "cancelled" ? 3 : 2)
    || v.policyRevision === 0 && v.retrospectiveDays !== 30) return fail();
  return { ...span, requestId: uuid(v.requestId), workerId: uuid(v.workerId), employeeId: uuid(v.employeeId), employeeAuthUserId: uuid(v.employeeAuthUserId),
    workerName: label(v.workerName, 120), submittedAt: stamp(v.submittedAt), policyRevision: integer(v.policyRevision), retrospectiveDays: integer(v.retrospectiveDays, 0, 365),
    revision: v.revision as number, status: v.status as WorkArrangementStatus };
}
function conflictData(raw: unknown, span: WorkArrangementPreviewInput, excludeId?: string): WorkArrangementConflict[] {
  if (!Array.isArray(raw) || raw.length > 100) return fail(); let previous = "";
  return raw.map(value => {
    const c = exact(value, ["source", "id", "status", "revision", "kind", "startAt", "endAt", "timeZone"]);
    if (!["work_arrangement", "leave", "schedule"].includes(c.source as string) || (c.source === "work_arrangement"
      ? !["trip", "field", "remote"].includes(c.kind as string) : c.kind !== null)
      || (c.source === "schedule" ? c.status !== "scheduled" : c.status !== "submitted" && c.status !== "approved")
      || c.source !== "schedule" && c.revision !== (c.status === "submitted" ? 1 : 2)) return fail();
    const id = uuid(c.id), key = `${c.source}:${id}`, startAt = stamp(c.startAt, 3), endAt = stamp(c.endAt, 3);
    if (key <= previous || endAt <= startAt || startAt >= span.endAt || endAt <= span.startAt || c.source === "work_arrangement" && id === excludeId) fail(); previous = key;
    return { source: c.source as WorkArrangementConflict["source"], id, status: c.status as WorkArrangementConflict["status"], revision: integer(c.revision, 1),
      kind: c.kind as WorkArrangementKind | null, startAt, endAt, timeZone: label(c.timeZone, 100) };
  });
}
function contextData(v: Record<string, unknown>, span: WorkArrangementPreviewInput, preview: boolean, excludeId?: string) {
  const conflicts = conflictData(v.conflicts, span, excludeId), conflictsFingerprint = hash(v.conflictsFingerprint), sealed = bool(v.sealed);
  if (!Array.isArray(v.issues) || v.issues.length > 5) return fail(); const seen = new Set<string>();
  const issues = v.issues.map(i => { if (typeof i !== "string" || !["binding_changed", "employment_gap", "outside_window", "conflicts", "sealed"].includes(i)
    || seen.has(i) || !preview && i === "outside_window") return fail(); seen.add(i); return i as WorkArrangementIssue; });
  if (seen.has("sealed") !== sealed || seen.has("conflicts") !== (conflicts.length > 0)) fail();
  return { conflicts, conflictsFingerprint, sealed, issues };
}
export function parseWorkArrangementHistory(raw: unknown, item: WorkArrangementItem): WorkArrangementHistory[] {
  validateWorkArrangementTree(raw);
  if (!Array.isArray(raw) || raw.length !== item.revision) return fail(); let previous = item.submittedAt;
  const ids = new Set<string>(), history: WorkArrangementHistory[] = raw.map((rawEntry, index) => {
    const e = exact(rawEntry, ["operationId", "revision", "action", "actorId", "reason", "recordedAt", "command"]), command = parseWorkArrangementCommand(e.command);
    const operationId = uuid(e.operationId), actorId = uuid(e.actorId), recordedAt = stamp(e.recordedAt), reason = label(e.reason);
    if (ids.has(operationId) || command.action === "set_policy" || command.operationId !== operationId || command.reason !== reason || command.action !== e.action
      || e.revision !== index + 1 || recordedAt < previous || (index === 0 ? command.action !== "submit" || recordedAt !== item.submittedAt || operationId !== item.requestId
        : index === 1 ? !["withdraw", "approve", "reject"].includes(command.action) : command.action !== "cancel")) return fail();
    if (command.action === "submit") {
      if (command.expectedWorkerId !== item.workerId || command.expectedPolicyRevision !== item.policyRevision || command.kind !== item.kind
        || command.timeZone !== item.timeZone || command.startAt !== item.startAt || command.endAt !== item.endAt || actorId !== item.employeeAuthUserId) fail();
    } else if (command.requestId !== item.requestId || command.expectedRevision !== index
      || command.action === "withdraw" && actorId !== item.employeeAuthUserId || command.action === "approve" && actorId === item.employeeAuthUserId) fail();
    ids.add(operationId); previous = recordedAt;
    return { operationId, revision: index + 1, action: command.action, actorId, reason, recordedAt, command };
  });
  if (ACTION_STATUS[history.at(-1)!.action] !== item.status || history.length === 3 && history[1].action !== "approve") fail();
  return history;
}
export type WorkArrangementContextItem = WorkArrangementItem & { reason: string; history: WorkArrangementHistory[] };
/** Saved UTC boundaries and zone labels only: never rerun Intl on an archive. */
export function parseWorkArrangementContextItem(raw: unknown): WorkArrangementContextItem {
  validateWorkArrangementTree(raw); const v = exact(raw, [...ITEM_KEYS, "reason", "history"]), item = parseWorkArrangementItem(pick(v, ITEM_KEYS));
  const history = parseWorkArrangementHistory(v.history, item), reason = label(v.reason); if (reason !== history[0].reason) fail();
  return freeze({ ...item, reason, history });
}
function detailData(raw: unknown): WorkArrangementDetail {
  const v = exact(raw, [...ITEM_KEYS, "reason", "history", "conflicts", "conflictsFingerprint", "sealed", "issues", "canWithdraw", "canApprove", "canReject", "canCancel"]);
  const item = parseWorkArrangementContextItem(pick(v, [...ITEM_KEYS, "reason", "history"])), context = contextData(v, item, false, item.requestId);
  const canWithdraw = bool(v.canWithdraw), canApprove = bool(v.canApprove), canReject = bool(v.canReject), canCancel = bool(v.canCancel);
  if ((canWithdraw || canApprove || canReject) && item.status !== "submitted" || canCancel && item.status !== "approved"
    || canApprove && (!canReject || context.sealed || context.issues.includes("binding_changed") || context.issues.includes("employment_gap"))
    || canCancel && context.sealed) fail();
  return { ...item, ...context, canWithdraw, canApprove, canReject, canCancel };
}
export type WorkArrangementExpectedIdentity = { ownerId?: string; employeeId?: string; authUserId?: string };
function resultData(raw: unknown, input: WorkArrangementQuery, command: WorkArrangementCommand | null, expected: WorkArrangementExpectedIdentity): WorkArrangementResult {
  validateWorkArrangementTree(raw); const q = parseWorkArrangementQuery(input), v = exact(raw, RESULT_KEYS), actorId = uuid(v.actorId), readAt = stamp(v.readAt);
  if (command) parseWorkArrangementCommand(command);
  if (v.protocol !== "work-arrangement-v1" || v.siteId !== q.siteId || v.access !== q.access
    || expected.authUserId !== undefined && actorId !== expected.authUserId || expected.ownerId !== undefined && (q.access !== "owner" || actorId !== expected.ownerId)
    || !Array.isArray(v.items) || v.items.length > 25) return fail();
  const employeeId = v.employeeId === null ? null : uuid(v.employeeId), workerId = v.workerId === null ? null : uuid(v.workerId), canSubmit = bool(v.canSubmit);
  if (q.access === "owner" ? employeeId !== null || workerId !== null || canSubmit : employeeId === null || canSubmit && workerId === null
    || expected.employeeId !== undefined && employeeId !== expected.employeeId) fail();
  if (expected.employeeId !== undefined && q.access !== "self") fail();
  const policy = policyData(v.policy); if (policy.recordedAt !== null && policy.recordedAt > readAt) fail();
  let previousAt = q.beforeAt, previousId = q.beforeId; const ids = new Set<string>();
  const checkIdentity = (item: WorkArrangementItem) => { if (q.access === "self" && (item.employeeId !== employeeId || item.workerId !== workerId || item.employeeAuthUserId !== actorId)) fail(); };
  const items = v.items.map(value => { const item = parseWorkArrangementItem(value); checkIdentity(item);
    if (ids.has(item.requestId) || item.submittedAt > readAt || previousAt && (item.submittedAt > previousAt || item.submittedAt === previousAt && item.requestId >= previousId!)) fail();
    ids.add(item.requestId); previousAt = item.submittedAt; previousId = item.requestId; return item; });
  if ((q.requestId !== null || q.operationId !== null || q.preview !== null || command) && items.length) fail();
  let nextCursor: WorkArrangementResult["nextCursor"] = null;
  if (v.nextCursor !== null) { const c = exact(v.nextCursor, ["at", "id"]); nextCursor = { at: stamp(c.at), id: uuid(c.id) };
    if (items.length !== 25 || nextCursor.at !== previousAt || nextCursor.id !== previousId || q.requestId || q.operationId || q.preview || command) fail(); }
  const detail = v.detail === null ? null : detailData(v.detail);
  if (detail) { checkIdentity(detail); if (q.requestId && detail.requestId !== q.requestId || detail.history.at(-1)!.recordedAt > readAt
      || q.access === "self" && (detail.canApprove || detail.canReject || detail.canCancel) || q.access === "owner" && detail.canWithdraw
      || q.access === "owner" && actorId === detail.employeeAuthUserId && detail.canApprove) fail(); }
  if (q.requestId !== null && !q.operationId && !command && !detail) fail();
  let preview: WorkArrangementPreview | null = null;
  if (v.preview !== null) {
    const p = exact(v.preview, ["kind", "timeZone", "startAt", "endAt", "conflicts", "conflictsFingerprint", "sealed", "issues", "canSubmit"]), span = interval(pick(p, ["kind", "timeZone", "startAt", "endAt"]));
    if (!q.preview || JSON.stringify(span) !== JSON.stringify(q.preview) || span.timeZone !== v.timeZone || detail || q.access !== "self") fail();
    preview = { ...span, ...contextData(p, span, true), canSubmit: bool(p.canSubmit) };
    if (preview.canSubmit && (!canSubmit || preview.issues.some(i => i !== "conflicts"))) fail();
  } else if (q.preview !== null) fail();
  let receipt: WorkArrangementReceipt | null = null;
  if (v.receipt !== null) {
    const r = exact(v.receipt, ["command", "item", "policy"]), c = parseWorkArrangementCommand(r.command);
    if (c.operationId !== (command?.operationId ?? q.operationId) || command && !sameWorkArrangementCommand(command, c)
      || (c.action === "submit" || c.action === "withdraw") !== (q.access === "self")) fail();
    if (c.action === "set_policy") {
      const saved = policyData(r.policy); if (r.item !== null || detail || saved.operationId !== c.operationId || saved.revision !== c.expectedRevision + 1
        || saved.retrospectiveDays !== c.retrospectiveDays || saved.actorId !== actorId || saved.revision > policy.revision || saved.recordedAt! > readAt) fail();
      receipt = { command: c, item: null, policy: saved };
    } else {
      const item = parseWorkArrangementItem(r.item); checkIdentity(item);
      if (r.policy !== null || item.requestId !== (c.action === "submit" ? c.operationId : c.requestId) || item.revision !== (c.action === "submit" ? 1 : c.expectedRevision + 1)
        || item.status !== ACTION_STATUS[c.action] || q.requestId !== null && q.requestId !== item.requestId
        || c.action === "submit" && (item.workerId !== c.expectedWorkerId || item.policyRevision !== c.expectedPolicyRevision || item.kind !== c.kind
          || item.timeZone !== c.timeZone || item.startAt !== c.startAt || item.endAt !== c.endAt)
        || c.action === "approve" && actorId === item.employeeAuthUserId) fail();
      if (detail && (detail.requestId !== item.requestId || detail.revision < item.revision
        || ITEM_KEYS.filter(k => k !== "revision" && k !== "status").some(k => item[k as keyof WorkArrangementItem] !== detail[k as keyof WorkArrangementItem])
        || !sameWorkArrangementCommand(detail.history[item.revision - 1].command, c) || detail.history[item.revision - 1].actorId !== actorId)) fail();
      receipt = { command: c, item, policy: null };
    }
  }
  if (command && !q.operationId && !receipt || detail && !q.requestId && !receipt || q.preview && receipt) fail();
  return freeze({ protocol: "work-arrangement-v1", siteId: q.siteId, access: q.access, actorId, employeeId, workerId, timeZone: label(v.timeZone, 100),
    settingsVersion: integer(v.settingsVersion, 1), canSubmit, policy, items, nextCursor, detail, receipt, preview, readAt });
}
export function parseWorkArrangementResult(raw: unknown, q: WorkArrangementQuery, command: WorkArrangementCommand | null = null, expected: WorkArrangementExpectedIdentity = {}): WorkArrangementResult {
  try { return resultData(raw, q, command, expected); } catch { return fail(); }
}
export function parseWorkArrangementResponse(raw: unknown, q: WorkArrangementQuery, command: WorkArrangementCommand | null = null, expected: WorkArrangementExpectedIdentity = {}): WorkArrangementResponse {
  try { validateWorkArrangementTree(raw); const v = exact(raw, ["ok", "moduleEnabled", ...RESULT_KEYS]); if (v.ok !== true) fail();
    return freeze({ ...resultData(pick(v, RESULT_KEYS), q, command, expected), moduleEnabled: bool(v.moduleEnabled) });
  } catch { return fail(); }
}
