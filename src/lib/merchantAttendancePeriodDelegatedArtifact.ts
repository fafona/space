import { MerchantAttendanceError } from "./merchantAttendanceTime";
import type { AttendanceTimesheetResult } from "./merchantAttendanceTimesheet";
import type { UnifiedReport } from "./merchantAttendanceUnifiedTimesheet";
import type { PeriodClosureRange, PeriodClosureWorker } from "./merchantAttendancePeriodClosure";

// A delegated report is not an owner/self UnifiedReport. Its calculated base is
// the complete worker report, while the real access identity remains explicit.
export type PeriodDelegatedReport = Omit<UnifiedReport, "access" | "base"> & {
  access: "delegate"; base: AttendanceTimesheetResult;
};
export type PeriodDelegationArtifactAuthority = {
  protocol: "period-delegation-authority-v1"; siteId: string; grantId: string; grantRevision: 1;
  actorEmployeeId: string; actorAuthUserId: string; workerId: string; employeeId: string; employeeAuthUserId: string;
  delegateGeneration: number; employeeGeneration: number; fromDate: string; throughDate: string;
  action: "send"; includeExisting: boolean; grantedAt: string; authorizedAt: string; periodId: string;
};
type Frame = { worker: PeriodClosureWorker; period: PeriodClosureRange; source: Record<string, unknown>;
  report: PeriodDelegatedReport; dayBoundaries: { date: string; fromAt: string; toAt: string; skipped: boolean }[] };
const fail = (): never => { throw new MerchantAttendanceError("attendance_period_closure_invalid"); };
const object = (v: unknown): Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype
    || Object.keys(v).some(k => ["__proto__", "constructor", "prototype"].includes(k))
    || Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !Object.hasOwn(d, "value") || !d.enumerable)) return fail();
  return v as Record<string, unknown>;
};
const uuid = (v: unknown): string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const instant = (v: unknown): string => typeof v === "string" && /^(?:20\d{2}|2100)-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 23) === v.slice(0, 23) ? v : fail();
const generation = (v: unknown): number => Number.isSafeInteger(v) && !Object.is(v, -0) && Number(v) >= 0 && Number(v) <= 9007199254740990 ? Number(v) : fail();
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  const x = object(a), y = object(b), keys = Object.keys(x); return keys.length === Object.keys(y).length && keys.every(k => Object.hasOwn(y, k) && same(x[k], y[k]));
}

/** Bind saved values, not today's authorization, timezone database or sources.
 * The service checks exact body/SHA; SQL additionally proves the immutable
 * creation sidecar. A client-side parse is not a substitute for that proof. */
export function validatePeriodDelegatedArtifactFrame(frame: Frame): void {
  const { source: s, worker: w, period: p, report: r } = frame, base = object(r.base), wire = object(s.report);
  //155 fixed boundaries are canonical UTC microseconds, including an end at
  //2101-01-01 for the final permitted civil date. No current timezone lookup.
  for (const value of [p.startAt,p.endAt,...frame.dayBoundaries.flatMap(d=>[d.fromAt,d.toAt])]) {
    if (!/^(?:20\d{2}|2100|2101)-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,23)!==value.slice(0,23)) fail();
  }
  if (!["attendance-period-source-v1", "attendance-period-source-v2", "attendance-period-source-v3", "attendance-period-source-v4", "attendance-period-source-v5"].includes(String(s.sourceVersion))
    || typeof s.siteId !== "string" || !/^\d{8}$/.test(s.siteId) || s.workerId !== w.workerId || s.employeeId !== w.employeeId || s.employeeAuthUserId !== w.employeeAuthUserId
    || s.fromDate !== p.fromDate || s.throughDate !== p.throughDate || s.timeZone !== p.timeZone || s.fromAt !== p.startAt || s.toAt !== p.endAt
    || !same(s.dayBoundaries, frame.dayBoundaries) || r.access !== "delegate" || base.siteId !== s.siteId || base.employeeId !== w.employeeId
    || !(base.sourceVersion === "raw-and-approved-v2" || s.sourceVersion === "attendance-period-source-v5" && base.sourceVersion === "raw-and-approved-v3") || base.calculationVersion !== "attendance-timesheet-v1" || base.payrollReady !== false
    || wire.version !== "attendance-unified-v1" || wire.complete !== true || wire.payrollReady !== false || Object.hasOwn(wire, "access")) fail();
  // The184 delegate base has no owner/self/scoped-viewer marker. Reject a
  // relabeled scoped result instead of pretending its scope is the whole period.
  if (["access", "viewerEmployeeId", "scopeRevision", "locationId", "coverage", "accessValidUntil"].some(k => Object.hasOwn(base, k))) fail();
  const rawBase = object(wire.base);
  if (rawBase.siteId !== s.siteId || rawBase.workerId !== w.workerId || rawBase.employeeId !== w.employeeId
    || rawBase.fromDate !== p.fromDate || rawBase.throughDate !== p.throughDate || rawBase.timeZone !== p.timeZone
    || rawBase.fromAt !== p.startAt || rawBase.toAt !== p.endAt || rawBase.sourceVersion !== base.sourceVersion || rawBase.complete !== true) fail();
}

export function parsePeriodDelegationArtifactAuthority(raw: unknown, frame: Frame): PeriodDelegationArtifactAuthority {
  const v = object(raw), keys = ["protocol", "siteId", "grantId", "grantRevision", "actorEmployeeId", "actorAuthUserId", "workerId", "employeeId", "employeeAuthUserId",
    "delegateGeneration", "employeeGeneration", "fromDate", "throughDate", "action", "includeExisting", "grantedAt", "authorizedAt", "periodId"];
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail();
  const { worker: w, period: p, source: s } = frame;
  const actorEmployeeId = uuid(v.actorEmployeeId), actorAuthUserId = uuid(v.actorAuthUserId), grantedAt = instant(v.grantedAt), authorizedAt = instant(v.authorizedAt);
  if (v.protocol !== "period-delegation-authority-v1" || v.grantRevision !== 1 || v.action !== "send" || typeof v.includeExisting !== "boolean"
    || v.siteId !== s.siteId || v.workerId !== w.workerId || v.employeeId !== w.employeeId || v.employeeAuthUserId !== w.employeeAuthUserId
    || v.fromDate !== p.fromDate || v.throughDate !== p.throughDate || actorEmployeeId === w.employeeId || actorAuthUserId === w.employeeAuthUserId
    || grantedAt > authorizedAt) fail();
  return { protocol: "period-delegation-authority-v1", siteId: v.siteId as string, grantId: uuid(v.grantId), grantRevision: 1,
    actorEmployeeId, actorAuthUserId, workerId: w.workerId, employeeId: w.employeeId, employeeAuthUserId: w.employeeAuthUserId,
    delegateGeneration: generation(v.delegateGeneration), employeeGeneration: generation(v.employeeGeneration), fromDate: p.fromDate, throughDate: p.throughDate,
    action: "send", includeExisting: v.includeExisting as boolean, grantedAt, authorizedAt, periodId: uuid(v.periodId) };
}
