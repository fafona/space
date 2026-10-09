import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { bool, enumValue, exact, freeze, integer, label, micros, optionalUuid, safeTree, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { OUTAGE_ERRORS } from "./merchantAttendanceOutage";
import { OUTAGE_CHANNELS, OUTAGE_TYPES, type OutageAccess, type OutageChannel, type OutageType } from "./merchantAttendanceOutageContract";
import { parseOutageInterval, type OutageInterval } from "./merchantAttendanceOutageTime";

export const OUTAGE_SUBJECT_API = "/api/merchant-enterprise/attendance/outage-subject";
export const OUTAGE_SUBJECT_BYTE_LIMIT = 16384;
export type OutageSubjectQuery = { siteId: string; access: OutageAccess; workerId: string | null; incidentId: string };
export type OutageSubject = { workerId: string; employeeId: string; employeeAuthUserId: string; workerVersion: number;
  employeeVersion: number; generation: number; displayName: string; active: boolean; paused: boolean };
export type OutageSubjectResult = { protocol: "attendance-outage-subject-v1"; siteId: string; access: OutageAccess; actorId: string;
  readAt: string; canWrite: boolean; subject: OutageSubject;
  incident: { id: string; type: OutageType; channel: OutageChannel; locationId: string | null; interval: OutageInterval } };
export type OutageSubjectResponse = { canWrite: boolean; result: OutageSubjectResult };
export const OUTAGE_SUBJECT_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...OUTAGE_ERRORS,
  attendance_outage_subject_invalid: 503, attendance_outage_subject_not_found: 404,
  unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503, enterprise_entitlement_unavailable: 503,
  enterprise_management_disabled: 403, employee_password_authentication_required: 403, forbidden_origin: 403, method_not_allowed: 405,
  attendance_rate_limited: 429,
});
const fail = (code = "attendance_outage_subject_invalid"): never => { throw new MerchantAttendanceError(code); };
export function parseOutageSubjectQuery(raw: unknown): OutageSubjectQuery {
  try {
    safeTree(raw, 4096); const q = exact(raw, ["siteId", "access", "workerId", "incidentId"]);
    const access = enumValue(q.access, ["owner", "self"] as const), workerId = optionalUuid(q.workerId);
    if ((access === "self") !== (workerId === null)) return fail();
    return freeze({ siteId: site(q.siteId), access, workerId, incidentId: uuid(q.incidentId) });
  } catch { return fail("attendance_invalid_request"); }
}
export function outageSubjectQueryString(raw: OutageSubjectQuery): string {
  const q = parseOutageSubjectQuery(raw); return new URLSearchParams(Object.entries(q).filter((p): p is [string, string] => p[1] !== null)).toString();
}
export function parseOutageSubjectHttpQuery(url: string): OutageSubjectQuery {
  try {
    if (typeof url !== "string" || new TextEncoder().encode(url).byteLength > 4096 || !/^https?:\/\//.test(url)
      || /\s|[\u0000-\u001f\u007f-\u009f]|[#\\]/.test(url) || /[\u0000-\u001f\u007f-\u009f]/.test(decodeURIComponent(url))) return fail();
    const u = new URL(url), q: Record<string, unknown> = { workerId: null }, seen = new Set<string>();
    if (u.username || u.password || u.hash) return fail();
    for (const [key, value] of u.searchParams) {
      if (!["siteId", "access", "workerId", "incidentId"].includes(key) || seen.has(key) || !value) return fail();
      seen.add(key); q[key] = value;
    }
    return parseOutageSubjectQuery(q);
  } catch { return fail("attendance_invalid_request"); }
}
export function parseOutageSubjectResult(raw: unknown, query: OutageSubjectQuery, actorId: string): OutageSubjectResult {
  try {
    safeTree(raw, OUTAGE_SUBJECT_BYTE_LIMIT);
    const q = parseOutageSubjectQuery(query), actor = uuid(actorId), r = exact(raw, ["protocol", "siteId", "access", "actorId", "readAt", "canWrite", "subject", "incident"]);
    if (r.protocol !== "attendance-outage-subject-v1" || r.siteId !== q.siteId || r.access !== q.access || r.actorId !== actor) return fail();
    const s = exact(r.subject, ["workerId", "employeeId", "employeeAuthUserId", "workerVersion", "employeeVersion", "generation", "displayName", "active", "paused"]);
    const subject: OutageSubject = { workerId: uuid(s.workerId), employeeId: uuid(s.employeeId), employeeAuthUserId: uuid(s.employeeAuthUserId),
      workerVersion: integer(s.workerVersion), employeeVersion: integer(s.employeeVersion), generation: integer(s.generation, 0),
      displayName: label(s.displayName, 120), active: bool(s.active), paused: bool(s.paused) };
    if (q.access === "owner" ? subject.workerId !== q.workerId : subject.employeeAuthUserId !== actor || !subject.active || subject.paused) return fail();
    const i = exact(r.incident, ["id", "type", "channel", "locationId", "interval"]), readAt = stamp(r.readAt);
    const incident = { id: uuid(i.id), type: enumValue(i.type, OUTAGE_TYPES), channel: enumValue(i.channel, OUTAGE_CHANNELS), locationId: optionalUuid(i.locationId), interval: parseOutageInterval(i.interval, false) };
    if (incident.id !== q.incidentId || micros(incident.interval.endAt) > micros(readAt)) return fail();
    return freeze({ protocol: "attendance-outage-subject-v1", siteId: q.siteId, access: q.access, actorId: actor, readAt, canWrite: bool(r.canWrite), subject, incident });
  } catch { return fail(); }
}
export function parseOutageSubjectResponse(raw: unknown, q: OutageSubjectQuery, actorId: string): OutageSubjectResponse {
  try {
    if (typeof raw === "string") {
      if (new TextEncoder().encode(raw).byteLength > OUTAGE_SUBJECT_BYTE_LIMIT) return fail();
      raw = parseCaptureBrowserJson(raw);
    }
    safeTree(raw, OUTAGE_SUBJECT_BYTE_LIMIT);
    const r = exact(raw, ["ok", "canWrite", "data"]); if (r.ok !== true) return fail();
    const canWrite = bool(r.canWrite), result = parseOutageSubjectResult(r.data, q, actorId);
    if (!canWrite && result.canWrite) return fail();
    return freeze({ canWrite, result });
  } catch { return fail(); }
}
