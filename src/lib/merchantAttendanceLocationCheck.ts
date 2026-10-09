import { attendanceSelfSite, attendanceSelfUuid, ATTENDANCE_SELF_ERROR_STATUS } from "./merchantAttendanceSelf";
import { attendanceInstant, MerchantAttendanceError } from "./merchantAttendanceTime";
import type { AttendancePosition, AttendanceLocationResult } from "./merchantAttendanceLocation";

export const ATTENDANCE_LOCATION_MAX_AGE_MS = 60_000;
export type AttendanceLocationTarget = { siteId: string; expectedWorkerId: string; expectedLocationId: string };
export type AttendanceLocationVersions = { settingsVersion: number; workerVersion: number; locationVersion: number };
export type AttendanceLocationCheckCommand = AttendanceLocationTarget & AttendanceLocationVersions & { position: AttendancePosition };
export type AttendanceLocationPolicy = AttendanceLocationVersions & {
  siteId: string; employeeId: string; workerId: string; locationId: string; checkedAt: string;
  maxAgeMs: typeof ATTENDANCE_LOCATION_MAX_AGE_MS; diagnosticOnly: true; punchRecorded: false;
};
export type AttendanceLocationCheckResult = AttendanceLocationPolicy & AttendanceLocationResult;
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const object = (v: unknown): Record<string, unknown> => !v || typeof v !== "object" || Array.isArray(v) ? fail() : v as Record<string, unknown>;
const exact = (v: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail();
};
const targetKeys = ["siteId", "expectedWorkerId", "expectedLocationId"];
const versionKeys = ["settingsVersion", "workerVersion", "locationVersion"];
const version = (v: unknown): number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : fail();
export function attendanceLocationVersions(input: unknown): AttendanceLocationVersions {
  const v = object(input);
  return { settingsVersion: version(v.settingsVersion), workerVersion: version(v.workerVersion), locationVersion: version(v.locationVersion) };
}
function target(v: Record<string, unknown>): AttendanceLocationTarget {
  return { siteId: attendanceSelfSite(v.siteId), expectedWorkerId: attendanceSelfUuid(v.expectedWorkerId), expectedLocationId: attendanceSelfUuid(v.expectedLocationId) };
}
export function parseAttendanceLocationQuery(url: string): AttendanceLocationTarget {
  const q = new URL(url).searchParams;
  for (const key of q.keys()) if (!targetKeys.includes(key) || q.getAll(key).length !== 1) fail();
  return target(Object.fromEntries(q));
}
export function parseAttendancePosition(input: unknown): AttendancePosition {
  const p = object(input); exact(p, ["latitude", "longitude", "accuracyMeters", "capturedAt"]);
  if (typeof p.latitude !== "number" || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 ||
    typeof p.longitude !== "number" || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180 ||
    typeof p.accuracyMeters !== "number" || !Number.isFinite(p.accuracyMeters) || p.accuracyMeters < 0 || p.accuracyMeters > 40_100_000 ||
    typeof p.capturedAt !== "string") return fail();
  attendanceInstant(p.capturedAt);
  return { latitude: p.latitude, longitude: p.longitude, accuracyMeters: p.accuracyMeters, capturedAt: p.capturedAt };
}
export function parseAttendanceLocationCommand(input: unknown): AttendanceLocationCheckCommand {
  const v = object(input); exact(v, [...targetKeys, ...versionKeys, "position"]);
  return { ...target(v), ...attendanceLocationVersions(v), position: parseAttendancePosition(v.position) };
}
// Explicit projection: coordinates, auth identity, raw RPC fields and any future
// evidence must never be returned by either public response.
export function parseAttendanceLocationPolicy(input: unknown, expected: AttendanceLocationTarget): AttendanceLocationPolicy {
  const v = object(input);
  if (v.siteId !== expected.siteId || v.workerId !== expected.expectedWorkerId || v.locationId !== expected.expectedLocationId ||
    v.maxAgeMs !== ATTENDANCE_LOCATION_MAX_AGE_MS || v.diagnosticOnly !== true || v.punchRecorded !== false || typeof v.checkedAt !== "string") return fail();
  attendanceInstant(v.checkedAt);
  return { ...attendanceLocationVersions(v), siteId: expected.siteId, employeeId: attendanceSelfUuid(v.employeeId),
    workerId: expected.expectedWorkerId, locationId: expected.expectedLocationId, checkedAt: v.checkedAt,
    maxAgeMs: ATTENDANCE_LOCATION_MAX_AGE_MS, diagnosticOnly: true, punchRecorded: false };
}
export function parseAttendanceLocationCheckResult(input: unknown, expected: AttendanceLocationTarget): AttendanceLocationCheckResult {
  const v = object(input), policy = parseAttendanceLocationPolicy(input, expected);
  if (!["inside", "outside", "uncertain", "stale", "future"].includes(String(v.reason)) || v.needsReview !== (v.reason !== "inside")) return fail();
  if (["stale", "future"].includes(String(v.reason)) ? v.distanceMeters !== null :
    typeof v.distanceMeters !== "number" || !Number.isSafeInteger(v.distanceMeters) || v.distanceMeters < 0 || v.distanceMeters > 20_100_000) return fail();
  return { ...policy, reason: v.reason as AttendanceLocationResult["reason"], needsReview: v.needsReview as boolean, distanceMeters: v.distanceMeters as number | null };
}
export const ATTENDANCE_LOCATION_CHECK_ERRORS: Readonly<Record<string, number>> = {
  ...ATTENDANCE_SELF_ERROR_STATUS, attendance_location_check_disabled: 403, attendance_location_not_configured: 409,
  attendance_location_policy_changed: 409, attendance_invalid_instant: 400,
};
