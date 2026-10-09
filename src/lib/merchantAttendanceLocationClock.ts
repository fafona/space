import { attendanceSelfSite, attendanceSelfUuid, parseAttendanceSelfCommand, parseAttendanceSelfResult,
  type AttendanceSelfCommand, type AttendanceSelfResult } from "./merchantAttendanceSelf";
import { ATTENDANCE_LOCATION_CHECK_ERRORS, attendanceLocationVersions, parseAttendancePosition, type AttendanceLocationVersions } from "./merchantAttendanceLocationCheck";
import { attendanceInstant, MerchantAttendanceError } from "./merchantAttendanceTime";
import type { AttendancePosition } from "./merchantAttendanceLocation";
import { parseLocationDisposal, type DisposedLocationPrecision } from "./merchantAttendanceLocationDisposal";

export const ATTENDANCE_POSITION_FAILURES = ["denied", "timeout", "unavailable", "unsupported", "not_provided"] as const;
export type AttendancePositionFailure = typeof ATTENDANCE_POSITION_FAILURES[number];
export type AttendanceLocationClockIntent = AttendanceSelfCommand & AttendanceLocationVersions & { noticeRevision: number | null; safeFinish: boolean };
export type AttendanceLocationClockCommand = AttendanceLocationClockIntent & { position: AttendancePosition | null; positionFailure: AttendancePositionFailure | null };
export type AttendanceLocationClockQuery = { siteId: string; expectedWorkerId: string; operationId: string | null };
export type AttendanceLocationClockPolicy = AttendanceLocationVersions & { mode: "record_and_review"; maxAgeMs: 60000; algorithmVersion: 1 };
export type AttendanceLocationClockSummary = AttendanceLocationVersions & {
  eventId: string; algorithmVersion: 1;
} & ({ reason: "inside" | "outside" | "uncertain" | "stale" | "future" | AttendancePositionFailure;
  needsReview: boolean; capturedAt: string | null; accuracyMeters: number | null; distanceMeters: number | null;
  disposal?: never;
} | DisposedLocationPrecision);
export type AttendanceLocationClockResult = AttendanceSelfResult & {
  siteId: string; employeeId: string; channelEnabled: boolean; policy: AttendanceLocationClockPolicy | null; locationResult: AttendanceLocationClockSummary | null;
  noticeGate: { ready: boolean; reason: "ready" | "unpublished" | "withdrawn" | "configuration_changed" | "fence_mismatch" | "acknowledgement_required" | "shift_location_changed"; revision: number | null };
  finish: (AttendanceLocationVersions & { locationId: string }) | null;
  receiptGate: { noticeRevision: number | null; safeFinish: boolean; command: Omit<AttendanceLocationClockIntent, "expectedWorkerId"> } | null;
};
const fail = (): never => { throw new MerchantAttendanceError("attendance_invalid_request"); };
const object = (value: unknown): Record<string, unknown> => !value || typeof value !== "object" || Array.isArray(value) ? fail() : value as Record<string, unknown>;
const exact = (value: Record<string, unknown>, keys: string[]) => { if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(); };
const intentKeys = ["expectedWorkerId", "operationId", "locationId", "action", "expectedSequence", "settingsVersion", "workerVersion", "locationVersion", "noticeRevision", "safeFinish"];
const revision = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 9007199254740990 ? value : fail();
export function parseAttendanceLocationClockIntent(input: unknown, siteId: string): AttendanceLocationClockIntent {
  const value = object(input); exact(value, intentKeys);
  const base = parseAttendanceSelfCommand({ siteId, expectedWorkerId: value.expectedWorkerId, operationId: value.operationId,
    locationId: value.locationId, action: value.action, expectedSequence: value.expectedSequence });
  if (typeof value.safeFinish !== "boolean") return fail();
  if (value.safeFinish && (value.noticeRevision !== null || !["break_end", "clock_out"].includes(base.command.action))) return fail();
  return { ...base.command, ...attendanceLocationVersions(value), safeFinish: value.safeFinish,
    noticeRevision: value.safeFinish ? null : revision(value.noticeRevision) };
}
export function parseAttendanceLocationClockCommand(input: unknown): { siteId: string; command: AttendanceLocationClockCommand } {
  const value = object(input); exact(value, ["siteId", ...intentKeys, "position", "positionFailure"]);
  const siteId = attendanceSelfSite(value.siteId);
  const intent = parseAttendanceLocationClockIntent(Object.fromEntries(intentKeys.map(key => [key, value[key]])), siteId);
  if (intent.safeFinish && (value.position !== null || value.positionFailure !== "not_provided")) return fail();
  if (value.position === null) {
    if (!ATTENDANCE_POSITION_FAILURES.includes(value.positionFailure as AttendancePositionFailure)) return fail();
    return { siteId, command: { ...intent, position: null, positionFailure: value.positionFailure as AttendancePositionFailure } };
  }
  if (value.positionFailure !== null) return fail();
  return { siteId, command: { ...intent, position: parseAttendancePosition(value.position), positionFailure: null } };
}
export function parseAttendanceLocationClockQuery(url: string): AttendanceLocationClockQuery {
  const q = new URL(url).searchParams;
  for (const key of q.keys()) if (!["siteId", "expectedWorkerId", "operationId"].includes(key) || q.getAll(key).length !== 1) fail();
  return { siteId: attendanceSelfSite(q.get("siteId")), expectedWorkerId: attendanceSelfUuid(q.get("expectedWorkerId")),
    operationId: q.has("operationId") ? attendanceSelfUuid(q.get("operationId")) : null };
}
// Receipt matching needs only the durable intent, never raw GPS transport.
export function parseAttendanceLocationClockResult(input: unknown, expected: AttendanceLocationClockQuery & { command: AttendanceLocationClockIntent | null }): AttendanceLocationClockResult {
  const value = object(input), base = parseAttendanceSelfResult(value, expected);
  if (value.siteId !== expected.siteId || base.workerId !== expected.expectedWorkerId || typeof value.channelEnabled !== "boolean") return fail();
  if (base.state.administrativeBoundary && base.state.administrativeBoundary.employeeId !== value.employeeId) return fail();
  let policy: AttendanceLocationClockPolicy | null = null;
  if (value.policy !== null) {
    const p = object(value.policy);
    if (p.mode !== "record_and_review" || p.maxAgeMs !== 60000 || p.algorithmVersion !== 1 || !base.locationId) return fail();
    policy = { ...attendanceLocationVersions(p), mode: "record_and_review", maxAgeMs: 60000, algorithmVersion: 1 };
  }
  if (value.channelEnabled && policy === null) return fail();
  let locationResult: AttendanceLocationClockSummary | null = null;
  if (value.locationResult !== null) {
    const r = object(value.locationResult);
    if (!base.receipt || r.eventId !== base.receipt.id || r.algorithmVersion !== 1 ||
      !["inside", "outside", "uncertain", "stale", "future", ...ATTENDANCE_POSITION_FAILURES].includes(String(r.reason)) || r.needsReview !== (r.reason !== "inside")) return fail();
    const measured = ["inside", "outside", "uncertain", "stale", "future"].includes(String(r.reason));
    const disposalDescriptor = Object.getOwnPropertyDescriptor(r, "disposal");
    if (disposalDescriptor && (!("value" in disposalDescriptor) || !disposalDescriptor.enumerable)) return fail();
    const disposed = disposalDescriptor ? parseLocationDisposal(disposalDescriptor.value, { reason: r.reason, needsReview: r.needsReview,
      capturedAt: r.capturedAt, accuracyMeters: r.accuracyMeters, distanceMeters: r.distanceMeters }, base.receipt.occurredAt) : null;
    if (disposed) exact(r, ["eventId", "settingsVersion", "workerVersion", "locationVersion", "algorithmVersion", "reason", "needsReview", "capturedAt", "accuracyMeters", "distanceMeters", "disposal"]);
    else if (measured) {
      if (typeof r.capturedAt !== "string" || typeof r.accuracyMeters !== "number" || !Number.isFinite(r.accuracyMeters) || r.accuracyMeters < 0 || r.accuracyMeters > 40100000 ||
        typeof r.distanceMeters !== "number" || !Number.isSafeInteger(r.distanceMeters) || r.distanceMeters < 0 || r.distanceMeters > 20100000) return fail();
      attendanceInstant(r.capturedAt);
      const age = attendanceInstant(base.receipt.occurredAt) - attendanceInstant(r.capturedAt);
      if (r.reason === "future" ? age >= -5000 : r.reason === "stale" ? age <= 60000 : age < -5000 || age > 60000) return fail();
    } else if (r.capturedAt !== null || r.accuracyMeters !== null || r.distanceMeters !== null) return fail();
    locationResult = disposed ? { ...attendanceLocationVersions(r), eventId: base.receipt.id, algorithmVersion: 1, ...disposed } : { ...attendanceLocationVersions(r), eventId: base.receipt.id, algorithmVersion: 1,
      reason: r.reason as AttendanceLocationClockSummary["reason"], needsReview: r.needsReview as boolean,
      capturedAt: r.capturedAt as string | null, accuracyMeters: r.accuracyMeters as number | null, distanceMeters: r.distanceMeters as number | null };
  }
  if ((base.receipt === null) !== (locationResult === null)) return fail();
  const ng = object(value.noticeGate); exact(ng, ["ready", "reason", "revision"]);
  if (typeof ng.ready !== "boolean" || !["ready", "unpublished", "withdrawn", "configuration_changed", "fence_mismatch", "acknowledgement_required", "shift_location_changed"].includes(String(ng.reason))
    || ng.ready !== (ng.reason === "ready") || (ng.reason === "unpublished" ? ng.revision !== null : ng.revision === null && ng.reason !== "shift_location_changed")
    || (value.channelEnabled && !ng.ready)) return fail();
  const noticeGate = { ready: ng.ready, reason: ng.reason as AttendanceLocationClockResult["noticeGate"]["reason"], revision: ng.revision === null ? null : revision(ng.revision) };
  let finish: AttendanceLocationClockResult["finish"] = null;
  if (value.finish !== null) {
    const f = object(value.finish); exact(f, ["locationId", "settingsVersion", "workerVersion", "locationVersion"]);
    if (base.state.status === "off" || !base.state.lastEvent || f.locationId !== base.state.lastEvent.locationId) return fail();
    finish = { ...attendanceLocationVersions(f), locationId: attendanceSelfUuid(f.locationId) };
  }
  let receiptGate: AttendanceLocationClockResult["receiptGate"] = null;
  if (value.receiptGate !== null) {
    const g = object(value.receiptGate); exact(g, ["noticeRevision", "safeFinish", "command"]);
    const raw = object(g.command); exact(raw, intentKeys.filter(key => key !== "expectedWorkerId"));
    const command = parseAttendanceLocationClockIntent({ ...raw, expectedWorkerId: base.workerId }, expected.siteId);
    if (!base.receipt || command.operationId !== base.receipt.operationId || command.action !== base.receipt.action || command.locationId !== base.receipt.locationId
      || command.expectedSequence + 1 !== base.receipt.sequence || g.noticeRevision !== command.noticeRevision || g.safeFinish !== command.safeFinish) return fail();
    if (command.safeFinish && (locationResult?.reason !== "not_provided" || !locationResult.needsReview)) return fail();
    if (!command.safeFinish && ["settingsVersion", "workerVersion", "locationVersion"].some(key =>
      locationResult?.[key as keyof AttendanceLocationVersions] !== command[key as keyof AttendanceLocationVersions])) return fail();
    receiptGate = { noticeRevision: command.noticeRevision, safeFinish: command.safeFinish,
      command: Object.fromEntries(Object.entries(command).filter(([key]) => key !== "expectedWorkerId")) as Omit<AttendanceLocationClockIntent, "expectedWorkerId"> };
  }
  if (expected.command && (!receiptGate || Object.entries(receiptGate.command).some(([key, value]) => value !== expected.command![key as keyof AttendanceLocationClockIntent]))) return fail();
  return { ...base, siteId: expected.siteId, employeeId: attendanceSelfUuid(value.employeeId), channelEnabled: value.channelEnabled, policy, locationResult, noticeGate, finish, receiptGate };
}
export const ATTENDANCE_LOCATION_CLOCK_ERRORS: Readonly<Record<string, number>> = {
  ...ATTENDANCE_LOCATION_CHECK_ERRORS, attendance_location_clock_disabled: 403,
  attendance_notice_required: 409, attendance_safe_finish_unavailable: 409,
};
