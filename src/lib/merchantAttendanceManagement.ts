import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { parseAttendanceManagementScope, type AttendanceManagementScope, type AttendanceManagementGrant } from "./merchantAttendanceScope";
import { attendanceInstant, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { MERCHANT_ATTENDANCE_ACTIONS, type AttendanceAction } from "./merchantAttendance";

export type AttendanceScopeCommand = { operationId: string; expectedRevision: number; action: "put" | "remove";
  grantId: string; grant: Omit<AttendanceManagementGrant, "id"> | null };
export type AttendanceScopeQuery = { siteId: string; employeeId: string; operationId: string | null };
export type AttendanceScopeReceipt = { operationId: string; revision: number; action: "put" | "remove"; grantId: string };
export type AttendanceScopeResult = { scope: AttendanceManagementScope; receipt: AttendanceScopeReceipt | null };
export type AttendanceRecordsQuery = { siteId: string; access: "owner" | "manager"; fromAt: string; toAt: string;
  workerId: string | null; locationId: string | null; asOf: string | null; cursorAt: string | null; cursorId: string | null };
export type AttendanceRecord = { id: string; workerId: string; locationId: string; workerName: string; workerNo: string;
  locationName: string; sequence: number; action: AttendanceAction; source: "web" | "kiosk"; timeZone: string;
  breakPaid: boolean | null; occurredAt: string };
export type AttendanceRecordsResult = { siteId: string; access: "owner" | "manager"; scopeRevision: number | null;
  asOf: string; items: AttendanceRecord[]; nextCursor: { occurredAt: string; id: string } | null };

const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function obj(v: unknown, fields?: string[]) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  const o = v as Record<string, unknown>;
  if (fields && (Object.keys(o).length !== fields.length || fields.some(k => !Object.hasOwn(o, k)))) fail();
  return o;
}
function revision(v: unknown, minimum = 0) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < minimum || v >= Number.MAX_SAFE_INTEGER) return fail();
  return v;
}
function instant(v: unknown) { if (typeof v !== "string") return fail(); attendanceInstant(v); return v; }
// Preserve PostgreSQL microseconds in record cursors. Truncating to milliseconds
// would skip rows when several immutable facts share the same millisecond.
export function attendanceRecordInstant(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(v)) return fail();
  instant(`${v.slice(0, 23)}Z`);
  return v.length === 24 ? `${v.slice(0, 23)}000Z` : v;
}
function micros(v: string) { return BigInt(attendanceInstant(`${v.slice(0, 23)}Z`)) * BigInt(1000) + BigInt(v.slice(23, 26)); }
function text(v: unknown, max: number) {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) return fail();
  return v;
}
function query(url: string, fields: string[]) {
  const q = new URL(url).searchParams;
  for (const key of q.keys()) if (!fields.includes(key) || q.getAll(key).length !== 1) fail();
  return q;
}
export function parseAttendanceScopeQuery(url: string): AttendanceScopeQuery {
  const q = query(url, ["siteId", "employeeId", "operationId"]);
  return { siteId: attendanceSelfSite(q.get("siteId")), employeeId: attendanceSelfUuid(q.get("employeeId")),
    operationId: q.has("operationId") ? attendanceSelfUuid(q.get("operationId")) : null };
}
export function parseAttendanceScopeCommand(value: unknown): { siteId: string; employeeId: string; command: AttendanceScopeCommand } {
  const o = obj(value, ["siteId", "employeeId", "operationId", "expectedRevision", "action", "grantId", "grant"]);
  const siteId = attendanceSelfSite(o.siteId), employeeId = attendanceSelfUuid(o.employeeId), grantId = attendanceSelfUuid(o.grantId);
  const base = { operationId: attendanceSelfUuid(o.operationId), expectedRevision: revision(o.expectedRevision), grantId };
  if (o.action === "remove" && o.grant === null) return { siteId, employeeId, command: { ...base, action: "remove", grant: null } };
  if (o.action !== "put") return fail();
  const g = obj(o.grant, ["workerIds", "locationIds", "validFrom", "validUntil"]);
  let parsed: AttendanceManagementGrant;
  try { parsed = parseAttendanceManagementScope({ siteId, employeeId, revision: 1, grants: [{ ...g, id: grantId }] }).grants[0]; }
  catch { return fail(); }
  return { siteId, employeeId, command: { ...base, action: "put", grant: { workerIds: parsed.workerIds,
    locationIds: parsed.locationIds, validFrom: parsed.validFrom, validUntil: parsed.validUntil } } };
}
export function parseAttendanceScopeResult(value: unknown, expected: AttendanceScopeQuery): AttendanceScopeResult {
  const o = obj(value), s = obj(o.scope), rev = revision(s.revision);
  if (s.siteId !== expected.siteId || s.employeeId !== expected.employeeId) return fail();
  // Revision 0 is an uninitialized read, never an authorization snapshot.
  const parsed = parseAttendanceManagementScope({ ...s, revision: rev || 1 });
  if (rev === 0 && parsed.grants.length) return fail();
  let receipt: AttendanceScopeReceipt | null = null;
  if (o.receipt !== null) {
    const r = obj(o.receipt), receiptRevision = revision(r.revision, 1);
    if (r.operationId !== expected.operationId || receiptRevision > rev || !["put", "remove"].includes(String(r.action))) return fail();
    receipt = { operationId: attendanceSelfUuid(r.operationId), revision: receiptRevision,
      action: r.action as "put" | "remove", grantId: attendanceSelfUuid(r.grantId) };
  }
  return { scope: Object.freeze({ ...parsed, revision: rev }), receipt };
}
export function parseAttendanceRecordsQuery(url: string): AttendanceRecordsQuery {
  const q = query(url, ["siteId", "access", "fromAt", "toAt", "workerId", "locationId", "asOf", "cursorAt", "cursorId"]);
  const fromAt = attendanceRecordInstant(q.get("fromAt")), toAt = attendanceRecordInstant(q.get("toAt"));
  if (toAt <= fromAt || micros(toAt) - micros(fromAt) > BigInt(2678400000000)) fail();
  const access = q.get("access"); if (access !== "owner" && access !== "manager") return fail();
  const optionalId = (k: string) => q.has(k) ? attendanceSelfUuid(q.get(k)) : null;
  const optionalInstant = (k: string) => q.has(k) ? attendanceRecordInstant(q.get(k)) : null;
  const asOf = optionalInstant("asOf"), cursorAt = optionalInstant("cursorAt"), cursorId = optionalId("cursorId");
  if ((cursorAt === null) !== (cursorId === null) || (cursorId && (!asOf || cursorAt! < fromAt || cursorAt! >= toAt || cursorAt! >= asOf))) fail();
  return { siteId: attendanceSelfSite(q.get("siteId")), access, fromAt, toAt,
    workerId: optionalId("workerId"), locationId: optionalId("locationId"), asOf, cursorAt, cursorId };
}
export function parseAttendanceRecordsResult(value: unknown, expected: AttendanceRecordsQuery): AttendanceRecordsResult {
  const o = obj(value);
  if (o.siteId !== expected.siteId || o.access !== expected.access) return fail();
  const scopeRevision = expected.access === "owner" ? (o.scopeRevision === null ? null : fail()) : revision(o.scopeRevision);
  return { siteId: expected.siteId, access: expected.access, scopeRevision, ...parseAttendanceRecordPage(value, expected) };
}
// Shared shape validation only. Each caller must separately validate identity and
// authorization metadata; this helper never grants owner or manager access.
export function parseAttendanceRecordPage(value: unknown, expected: Pick<AttendanceRecordsQuery,
  "fromAt" | "toAt" | "workerId" | "locationId" | "asOf" | "cursorAt" | "cursorId">): Pick<AttendanceRecordsResult, "asOf" | "items" | "nextCursor"> {
  const o = obj(value), asOf = attendanceRecordInstant(o.asOf);
  if (!Array.isArray(o.items) || o.items.length > 50
    || (expected.asOf !== null && asOf !== expected.asOf)) return fail();
  let previous = expected.cursorId ? { occurredAt: expected.cursorAt!, id: expected.cursorId } : null;
  const items = Array.from(o.items, (raw): AttendanceRecord => {
    const r = obj(raw), id = attendanceSelfUuid(r.id), occurredAt = attendanceRecordInstant(r.occurredAt);
    const workerId = attendanceSelfUuid(r.workerId), locationId = attendanceSelfUuid(r.locationId);
    if (occurredAt < expected.fromAt || occurredAt >= expected.toAt || occurredAt >= asOf
      || (expected.workerId && workerId !== expected.workerId) || (expected.locationId && locationId !== expected.locationId)
      || (previous && (occurredAt > previous.occurredAt || (occurredAt === previous.occurredAt && id >= previous.id)))
      || !Number.isSafeInteger(r.sequence) || (r.sequence as number) < 1
      || !MERCHANT_ATTENDANCE_ACTIONS.includes(r.action as AttendanceAction) || (r.source !== "web" && r.source !== "kiosk")
      || (r.action === "break_start" ? typeof r.breakPaid !== "boolean" : r.breakPaid !== null)) return fail();
    previous = { occurredAt, id };
    return { id, workerId, locationId, occurredAt, sequence: r.sequence as number, action: r.action as AttendanceAction,
      source: r.source as "web" | "kiosk", timeZone: attendanceTimeZone(text(r.timeZone, 100)), breakPaid: r.breakPaid as boolean | null,
      workerName: text(r.workerName, 120), workerNo: text(r.workerNo, 40), locationName: text(r.locationName, 120) };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) fail();
  let nextCursor: AttendanceRecordsResult["nextCursor"] = null;
  if (o.nextCursor !== null) {
    const c = obj(o.nextCursor); nextCursor = { occurredAt: attendanceRecordInstant(c.occurredAt), id: attendanceSelfUuid(c.id) };
    if (items.length !== 50 || nextCursor.id !== items.at(-1)?.id || nextCursor.occurredAt !== items.at(-1)?.occurredAt) fail();
  }
  return { asOf, items, nextCursor };
}
export const ATTENDANCE_MANAGEMENT_ERRORS: Readonly<Record<string, number>> = {
  attendance_invalid_request: 400, attendance_invalid_instant: 400, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
  attendance_access_denied: 403, attendance_platform_paused: 403, attendance_rate_limited: 429,
  attendance_settings_required: 409, attendance_employee_invalid: 409, attendance_operation_conflict: 409, attendance_version_conflict: 409,
  attendance_scope_manager_invalid: 409, attendance_scope_target_invalid: 409, attendance_scope_limit: 409, attendance_scope_grant_missing: 409,
};
