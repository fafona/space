// Synthetic source WIRE builders. Every successful consumer must use the real
// Sources parser; these helpers do not manufacture trusted normalized results.
import { attendanceDayUtcRange, attendanceLocalDate } from "../../src/lib/merchantAttendanceTime";
import { parseSourcesResult, type SourcesQuery, type SourcesLeave } from "../../src/lib/merchantAttendanceSources";
import type { ScheduleEntry } from "../../src/lib/merchantAttendanceSchedule";
import type { CalendarSummary } from "../../src/lib/merchantAttendanceCalendar";
import type { LeaveStatus } from "../../src/lib/merchantAttendanceLeave";
import type { AttendanceSessionEvent } from "../../src/lib/merchantAttendanceSession";
import type { CorrectionProposal } from "../../src/lib/merchantAttendanceCorrection";
import { sheetEffect } from "./attendance-timesheet-model";

export const scheduleEvidenceId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const scheduleEvidenceActor = scheduleEvidenceId(1);
export const scheduleEvidenceQuery: SourcesQuery = { siteId: "99990009", workerId: scheduleEvidenceId(4), fromDate: "2026-09-01", throughDate: "2026-09-03" };
export const scheduleEvidenceMicros = (value: string) => value.replace(/\.([0-9]{3})Z$/, ".$1000Z");
const record = "2026-08-01T08:00:00.000001Z";
const observed = "2026-09-10T12:00:00.000001Z";
type EvidenceEffect = ReturnType<typeof sheetEffect> & { employeeId: string | null; lineage: {
  rootRequestId: string; rootOperationId: string; rootRecordedAt: string; previousOperationId: null;
} };
export type ScheduleEvidenceWireRow = { startEventId: string; events: AttendanceSessionEvent[]; effect: EvidenceEffect | null };

export function scheduleEvidenceRow(n = 1, startAt = "2026-09-02T08:00:00.000000Z", endAt: string | null = "2026-09-02T16:00:00.000000Z",
  options: { timeZone?: string; locationId?: string; sequence?: number } = {}): ScheduleEvidenceWireRow {
  const sequence = options.sequence ?? n * 2 - 1, timeZone = options.timeZone ?? "UTC", locationId = options.locationId ?? scheduleEvidenceId(5);
  const first: AttendanceSessionEvent = { id: scheduleEvidenceId(1000 + n * 2), locationId, sequence, action: "clock_in",
    occurredAt: scheduleEvidenceMicros(startAt), timeZone, breakPaid: null, source: "web" };
  return { startEventId: first.id, events: endAt === null ? [first] : [first, { ...first, id: scheduleEvidenceId(1001 + n * 2), sequence: sequence + 1,
    action: "clock_out", occurredAt: scheduleEvidenceMicros(endAt) }], effect: null };
}

export function scheduleEvidenceCorrection(row: ScheduleEvidenceWireRow, proposal: CorrectionProposal,
  options: { employeeId?: string | null; recordedAt?: string; n?: number } = {}): EvidenceEffect {
  const n = options.n ?? row.events[0].sequence, recordedAt = options.recordedAt ?? "2026-09-09T08:00:00.000001Z";
  const requestId = scheduleEvidenceId(2000 + n * 2), operationId = scheduleEvidenceId(2001 + n * 2);
  return { ...sheetEffect(proposal, row.events.at(-1)!.id), requestId, operationId, employeeId: options.employeeId === undefined ? scheduleEvidenceId(2) : options.employeeId,
    timeZone: row.events[0].timeZone, recordedAt, lineage: { rootRequestId: requestId, rootOperationId: operationId, rootRecordedAt: recordedAt, previousOperationId: null } };
}

export function scheduleEvidenceSlot(n = 1, startAt = "2026-09-02T08:00:00.000Z", endAt = "2026-09-02T16:00:00.000Z", patch: Partial<ScheduleEntry> = {}): ScheduleEntry {
  const timeZone = patch.timeZone ?? "UTC";
  return { id: scheduleEvidenceId(10000 + n), workerId: scheduleEvidenceQuery.workerId, workerName: "Historical schedule label", locationId: scheduleEvidenceId(5),
    locationName: "Synthetic place", timeZone, workDate: attendanceLocalDate(startAt, timeZone), startAt, endAt, revision: n,
    cancelled: false, reason: "Synthetic plan, not a punch", cancelReason: null, ...patch };
}

export function scheduleEvidenceMissing(n = 1, startAt = "2026-09-03T08:00:00.000000Z", endAt = "2026-09-03T16:00:00.000000Z") {
  return { source: "missing-approved", requestId: scheduleEvidenceId(20000 + n * 2), operationId: scheduleEvidenceId(20001 + n * 2),
    workerId: scheduleEvidenceQuery.workerId, employeeId: null, workerName: "Historical declaration label", locationId: scheduleEvidenceId(5), locationName: "Declared place",
    timeZone: "UTC", policyRevision: 1, proposal: { startAt: scheduleEvidenceMicros(startAt), endAt: scheduleEvidenceMicros(endAt), breaks: [] },
    submittedAt: "2026-09-08T08:00:00.000001Z", approvedAt: "2026-09-09T08:00:00.000001Z" };
}

export function scheduleEvidenceLeave(n = 1, status: LeaveStatus = "approved", patch: Partial<SourcesLeave> = {}): SourcesLeave {
  return { workerId: scheduleEvidenceQuery.workerId, employeeId: scheduleEvidenceId(2), operationId: scheduleEvidenceId(30000 + n * 2 + (status === "submitted" ? 0 : 1)),
    recordedAt: status === "submitted" ? record : "2026-08-02T08:00:00.000001Z",
    summary: { requestId: scheduleEvidenceId(30000 + n * 2), workerName: "Historical leave label", startAt: "2026-09-02T08:00:00.000Z", endAt: "2026-09-02T16:00:00.000Z",
      timeZone: "UTC", submittedAt: record, revision: status === "submitted" ? 1 : status === "cancelled" ? 3 : 2, status }, ...patch };
}

export function scheduleEvidenceCalendar(n = 1, patch: Partial<CalendarSummary> = {}): CalendarSummary {
  return { entryId: scheduleEvidenceId(40000 + n), locationId: null, locationName: null, timeZone: "UTC", kind: "holiday", title: "Synthetic hint only",
    fromDate: "2026-09-02", throughDate: "2026-09-02", createdAt: record, revision: 1, status: "created", ...patch };
}

export function scheduleEvidenceWire(options: { query?: SourcesQuery; timeZone?: string; asOf?: string; empty?: boolean } = {}) {
  const query = options.query ?? scheduleEvidenceQuery, timeZone = options.timeZone ?? "UTC", asOf = options.asOf ?? observed;
  const fromAt = attendanceDayUtcRange(query.fromDate, timeZone).startAt, toAt = attendanceDayUtcRange(query.throughDate, timeZone).endAt;
  const worker = { workerId: query.workerId, workerName: "Synthetic evidence worker", workerNo: "EVIDENCE", employeeId: scheduleEvidenceId(2) as string | null, version: 3, active: true };
  return { protocol: "sources-v1", siteId: query.siteId, actorId: scheduleEvidenceActor, fromDate: query.fromDate, throughDate: query.throughDate,
    worker, settingsVersion: 3, timeZone, fromAt, toAt, readAt: asOf,
    attendance: { version: "attendance-unified-v1", access: "owner", complete: true, payrollReady: false,
      base: { ...query, employeeId: worker.employeeId, workerName: worker.workerName, workerNo: worker.workerNo, timeZone,
        fromAt: scheduleEvidenceMicros(fromAt), toAt: scheduleEvidenceMicros(toAt), asOf, complete: true, sourceVersion: "raw-and-approved-v2",
        items: options.empty ? [] as ScheduleEvidenceWireRow[] : [scheduleEvidenceRow()] }, missing: [] as ReturnType<typeof scheduleEvidenceMissing>[] },
    assignments: { limited: false, items: [] }, rules: { limited: false, items: [{ groupId: null, revision: 0, publications: [] }] },
    schedule: { limited: false, items: options.empty ? [] as ScheduleEntry[] : [scheduleEvidenceSlot()] },
    leave: { limited: false, items: [] as SourcesLeave[] }, calendar: { limited: false, items: [] as CalendarSummary[] } };
}
export type ScheduleEvidenceWire = ReturnType<typeof scheduleEvidenceWire>;
export function parseScheduleEvidenceWire(wire: ScheduleEvidenceWire) {
  return parseSourcesResult(wire, { siteId: wire.siteId, workerId: wire.worker.workerId, fromDate: wire.fromDate, throughDate: wire.throughDate }, scheduleEvidenceActor);
}
export const scheduleEvidenceSources = () => parseScheduleEvidenceWire(scheduleEvidenceWire());
