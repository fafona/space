import { timesheetExportCommand, timesheetExportWire } from "./attendance-timesheet-export-model";
import { firstApprovalSourceV2, timesheetId as id } from "./attendance-timesheet-model";
import type { MissingReportSource } from "../../src/lib/merchantAttendanceUnifiedTimesheet";
import type { UnifiedExportCommand } from "../../src/lib/merchantAttendanceUnifiedExport";
export const unifiedExportCommand = timesheetExportCommand;
export function unifiedExportWire(c: UnifiedExportCommand = unifiedExportCommand()) {
  const old = timesheetExportWire(c), base = firstApprovalSourceV2(old.report);
  const missing: MissingReportSource = { source: "missing-approved", requestId: id(500), operationId: id(501), workerId: id(4), employeeId: c.query.access === "self" ? id(2) : null,
    workerName: "申报时员工", locationId: id(5), locationName: "申报时地点", timeZone: "Europe/Madrid", policyRevision: 1,
    proposal: { startAt: "2026-09-06T21:00:00.000000Z", endAt: "2026-09-07T05:00:00.000001Z", breaks: [{ startAt: "2026-09-06T22:30:00.000000Z", endAt: "2026-09-06T23:30:00.000000Z", paid: true }] },
    submittedAt: "2026-09-07T06:00:00.000000Z", approvedAt: "2026-09-07T07:00:00.000000Z" };
  return { receipt: { ...old.receipt, reportVersion: "attendance-unified-v1" as const, missingCount: 1, sourceCount: old.receipt.sessionCount + 1 }, replayed: false,
    report: { version: "attendance-unified-v1", access: c.query.access, base, missing: [missing], complete: true, payrollReady: false } };
}
