// Synthetic saved-source model; no connection, clock or business writes.
import { createHash } from "node:crypto";
import { sheetEvent, sheetWire, timesheetId as id } from "./attendance-timesheet-model";
import type { AttendanceSessionEvent } from "../../src/lib/merchantAttendanceSession";
import { administrativeReportBoundaryProjection, type AdministrativeReportBoundary } from "../../src/lib/merchantAttendanceAdministrativeBoundary";
import type { AdministrativeClosureBoundary } from "../../src/lib/merchantAttendanceAdministrativeClosure";
import { parsePeriodClosureSourceReport } from "../../src/lib/merchantAttendancePeriodClosureSourceReport";

export function administrativeFullBoundary(): AdministrativeClosureBoundary {
  return { protocol: "attendance-administrative-boundary-v1", siteId: "99990009", workerId: id(4), employeeId: id(2), employeeAuthUserId: id(9),
    employmentPeriodId: id(901), suspensionId: id(902), generation: 2, revision: 1, operationId: id(900), startEventId: id(101), startSequence: 1,
    startAt: "2026-09-05T08:00:00.000000Z", tailEventId: id(102), tailSequence: 2, tailAction: "break_start", tailOccurredAt: "2026-09-05T09:00:00.000000Z",
    verifiedEndAt: "2026-09-05T10:00:00.000000Z", recordedAt: "2026-09-05T11:00:00.000000Z", sourceFingerprint: "a".repeat(64), timeZone: "Europe/Madrid" };
}
export function administrativeReportWire(laterOnly = false) {
  const p = administrativeReportBoundaryProjection(administrativeFullBoundary());
  const items: { startEventId: string; events: AttendanceSessionEvent[]; effect: null; administrativeBoundary: AdministrativeReportBoundary | null; predecessorBoundary: AdministrativeReportBoundary | null }[] = [
    { startEventId: id(101), events: [sheetEvent(1, "clock_in", p.startAt), sheetEvent(2, "break_start", p.tailOccurredAt)], effect: null, administrativeBoundary: p, predecessorBoundary: null },
    { startEventId: id(103), events: [sheetEvent(3, "clock_in", "2026-09-06T08:00:00.000000Z"), sheetEvent(4, "clock_out", "2026-09-06T10:00:00.000000Z")], effect: null, administrativeBoundary: null, predecessorBoundary: p },
  ];
  const base = { ...sheetWire(), sourceVersion: "raw-and-approved-v3", administrativeUnassessedCount: laterOnly ? 0 : 1, totalsComplete: laterOnly, items: laterOnly ? items.slice(1) : items };
  if (laterOnly) Object.assign(base, { fromDate: "2026-09-06", throughDate: "2026-09-06", fromAt: "2026-09-05T22:00:00.000000Z", toAt: "2026-09-06T22:00:00.000000Z" });
  return { version: "attendance-unified-v1", access: "owner" as const, complete: true, payrollReady: false, base, missing: [] };
}
export function administrativeSourceModel(laterOnly = false) {
  const wire = administrativeReportWire(laterOnly), b = wire.base, dayBoundaries = [];
  for (let day = b.fromDate; day <= b.throughDate; day = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10)) {
    const from = Date.parse(day) - 7200000;
    const utc6 = (ms: number) => new Date(ms).toISOString().slice(0, 23) + "000Z";
    dayBoundaries.push({ date: day, fromAt: utc6(from), toAt: utc6(from + 86400000), skipped: false });
  }
  const basis = { siteId: b.siteId, access: wire.access, workerId: b.workerId, employeeId: b.employeeId, employeeAuthUserId: id(9),
    fromDate: b.fromDate, throughDate: b.throughDate, fromAt: b.fromAt, toAt: b.toAt, timeZone: b.timeZone, dayBoundaries };
  const report = parsePeriodClosureSourceReport(wire, basis, true);
  const { asOf: _asOf, ...rawBase } = b; void _asOf;
  const { access: _access, ...canonicalWire } = wire; void _access;
  const { access: _basisAccess, ...canonicalBasis } = basis; void _basisAccess;
  const source = { sourceVersion: "attendance-period-source-v5", ...canonicalBasis, report: { ...canonicalWire, base: rawBase },
    context: { pendingCorrections: [], missing: [], leave: [], calendar: [], reviews: [],
      plans: { items: [], sessions: b.items.map(item => ({ item: structuredClone(item), ruleBinding: null, relation: null, adoption: null, planRuleApproval: null })) },
      administrativeClosures: [administrativeFullBoundary()] } };
  const worker = { workerId: b.workerId, employeeId: b.employeeId, employeeAuthUserId: id(9), workerName: b.workerName, workerNo: b.workerNo };
  const period = { fromDate: b.fromDate, throughDate: b.throughDate, timeZone: b.timeZone, startAt: b.fromAt, endAt: b.toAt };
  const sourceText = JSON.stringify(source), sourceFingerprint = createHash("sha256").update(sourceText).digest("hex");
  const artifact = { protocol: "attendance-period-artifact-v1", sourceFingerprint, source, worker, period, report, dayBoundaries, calculationVersion: "timesheet-v2-unified-v1" };
  const envelope = { ...source, complete: true, report: wire, sourceCanonical: source, sourceText, sourceFingerprint,
    blockers: laterOnly ? [] : ["administrative_hours_unassessed"] };
  return { wire, basis, source, artifact, envelope, worker, period };
}
