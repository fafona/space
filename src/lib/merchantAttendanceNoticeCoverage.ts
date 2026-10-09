import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const COVERAGE_PAGE_SIZE = 50;
export type CoverageQuery = { siteId: string; locationId: string; expectedNoticeRevision: number | null;
  expectedSettingsVersion: number | null; expectedLocationVersion: number | null; cursorWorkerId: string | null };
export type CoverageItem = { workerId: string; workerNo: string; displayName: string; employeeId: string | null;
  eligible: boolean; exclusion: null | "worker_inactive" | "employee_unavailable" | "role_unavailable"; acknowledgedAt: string | null };
export type CoverageResult = { siteId: string; location: { id: string; name: string; active: boolean; version: number };
  settingsVersion: number; notice: { revision: number; action: "publish" | "withdraw"; recordedAt: string } | null;
  noticeCurrent: boolean; observedAt: string; counts: { assigned: number; eligible: number; excluded: number; confirmed: number | null; pending: number | null };
  items: CoverageItem[]; nextCursor: string | null };
export const COVERAGE_ERRORS: Readonly<Record<string, number>> = { attendance_invalid_request: 400, attendance_invalid_instant: 400,
  attendance_access_denied: 403, attendance_location_denied: 403, attendance_settings_required: 409,
  attendance_version_conflict: 409, attendance_rate_limited: 429, attendance_unavailable: 503 };
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return fail();
  return row;
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) return fail();
  return value;
}
function text(value: unknown, maximum: number) {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return fail();
  return value;
}
const fields = ["siteId", "locationId", "expectedNoticeRevision", "expectedSettingsVersion", "expectedLocationVersion", "cursorWorkerId"];
export function coverageQueryString(query: CoverageQuery): string {
  return new URLSearchParams(Object.entries(query).filter(([, value]) => value !== null).map(([key, value]) => [key, String(value)])).toString();
}
export function parseCoverageQuery(url: string): CoverageQuery {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) if (!fields.includes(key) || params.getAll(key).length !== 1) return fail();
  const read = (key: string, minimum: number) => {
    if (!params.has(key)) return null;
    const value = params.get(key)!;
    if (!/^(0|[1-9][0-9]{0,15})$/.test(value)) return fail();
    return integer(Number(value), minimum, key === "expectedNoticeRevision" ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER);
  };
  const query: CoverageQuery = { siteId: attendanceSelfSite(params.get("siteId")), locationId: attendanceSelfUuid(params.get("locationId")),
    expectedNoticeRevision: read("expectedNoticeRevision", 0), expectedSettingsVersion: read("expectedSettingsVersion", 1),
    expectedLocationVersion: read("expectedLocationVersion", 1), cursorWorkerId: params.has("cursorWorkerId") ? attendanceSelfUuid(params.get("cursorWorkerId")) : null };
  const fences = [query.expectedNoticeRevision, query.expectedSettingsVersion, query.expectedLocationVersion];
  if (fences.some(value => value === null) && (!fences.every(value => value === null) || query.cursorWorkerId !== null)) return fail();
  return query;
}

// This is the current assigned population on each read, not a historical roster,
// delivery log, consent record or a frozen multi-page report.
export function parseCoverageResult(input: unknown, query: CoverageQuery): CoverageResult {
  const v = object(input, ["siteId", "location", "settingsVersion", "notice", "noticeCurrent", "observedAt", "counts", "items", "nextCursor"]);
  const loc = object(v.location, ["id", "name", "active", "version"]);
  if (v.siteId !== query.siteId || loc.id !== query.locationId || typeof loc.active !== "boolean" || typeof v.noticeCurrent !== "boolean") return fail();
  const location = { id: query.locationId, name: text(loc.name, 120), active: loc.active, version: integer(loc.version, 1) };
  const settingsVersion = integer(v.settingsVersion, 1), observedAt = attendanceRecordInstant(v.observedAt);
  let notice: CoverageResult["notice"] = null;
  if (v.notice !== null) {
    const n = object(v.notice, ["revision", "action", "recordedAt"]);
    if (n.action !== "publish" && n.action !== "withdraw") return fail();
    notice = { revision: integer(n.revision, 1, Number.MAX_SAFE_INTEGER - 1), action: n.action, recordedAt: attendanceRecordInstant(n.recordedAt) };
  }
  if (v.noticeCurrent && (!location.active || notice?.action !== "publish")) return fail();
  if (query.expectedNoticeRevision !== null && (query.expectedNoticeRevision !== (notice?.revision ?? 0)
    || query.expectedSettingsVersion !== settingsVersion || query.expectedLocationVersion !== location.version)) return fail();
  const c = object(v.counts, ["assigned", "eligible", "excluded", "confirmed", "pending"]);
  const counts: CoverageResult["counts"] = { assigned: integer(c.assigned), eligible: integer(c.eligible), excluded: integer(c.excluded),
    confirmed: c.confirmed === null ? null : integer(c.confirmed), pending: c.pending === null ? null : integer(c.pending) };
  if (counts.eligible + counts.excluded !== counts.assigned) return fail();
  if (notice?.action === "publish") {
    if (counts.confirmed === null || counts.pending === null || counts.confirmed + counts.pending !== counts.eligible) return fail();
  } else if (counts.confirmed !== null || counts.pending !== null) return fail();
  if (!Array.isArray(v.items) || v.items.length > COVERAGE_PAGE_SIZE || v.items.length > counts.assigned) return fail();
  let previous = query.cursorWorkerId ?? "";
  const items: CoverageItem[] = v.items.map(raw => {
    const row = object(raw, ["workerId", "workerNo", "displayName", "employeeId", "eligible", "exclusion", "acknowledgedAt"]);
    const workerId = attendanceSelfUuid(row.workerId), employeeId = row.employeeId === null ? null : attendanceSelfUuid(row.employeeId);
    if (workerId <= previous || typeof row.eligible !== "boolean" || ![null, "worker_inactive", "employee_unavailable", "role_unavailable"].includes(row.exclusion as string | null)) return fail();
    previous = workerId;
    if (row.eligible !== (row.exclusion === null) || row.eligible && employeeId === null) return fail();
    const acknowledgedAt = row.acknowledgedAt === null ? null : attendanceRecordInstant(row.acknowledgedAt);
    // observedAt is a read timestamp, not an immutable cutoff: a concurrent ACK
    // or a database clock correction must not make a genuine receipt malformed.
    if (acknowledgedAt !== null && (!employeeId || notice?.action !== "publish" || acknowledgedAt < notice.recordedAt)) return fail();
    return { workerId, workerNo: text(row.workerNo, 40), displayName: text(row.displayName, 120), employeeId,
      eligible: row.eligible, exclusion: row.exclusion as CoverageItem["exclusion"], acknowledgedAt };
  });
  if (items.filter(row => row.eligible).length > counts.eligible || items.filter(row => !row.eligible).length > counts.excluded
    || notice?.action === "publish" && (items.filter(row => row.eligible && row.acknowledgedAt !== null).length > counts.confirmed!
      || items.filter(row => row.eligible && row.acknowledgedAt === null).length > counts.pending!)) return fail();
  const nextCursor = v.nextCursor === null ? null : attendanceSelfUuid(v.nextCursor);
  if (nextCursor !== null && (items.length !== COVERAGE_PAGE_SIZE || nextCursor !== items.at(-1)?.workerId || counts.assigned <= items.length)) return fail();
  return { siteId: query.siteId, location, settingsVersion, notice, noticeCurrent: v.noticeCurrent, observedAt, counts, items, nextCursor };
}
