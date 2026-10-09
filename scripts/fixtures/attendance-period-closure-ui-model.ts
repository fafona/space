// Synthetic UI wire. The report is built through the existing real Sources
// parser; archive consumers validate saved values without recomputing them.
import { scheduleEvidenceId, scheduleEvidenceActor, scheduleEvidenceQuery, scheduleEvidenceWire, scheduleEvidenceMissing,
  scheduleEvidenceCorrection, parseScheduleEvidenceWire } from "./attendance-schedule-evidence-model";
import type { PeriodClosureArtifact, PeriodClosureCommand, PeriodClosureEntry, PeriodClosureQuery, PeriodClosureResponse, PeriodClosureSummary } from "../../src/lib/merchantAttendancePeriodClosure";

export const periodClosureUiId = scheduleEvidenceId;
export const periodClosureUiOwner = scheduleEvidenceActor;
export const periodClosureUiEmployee = scheduleEvidenceId(2);
export const periodClosureUiAuth = scheduleEvidenceId(3);
export const periodClosureUiPeriod = scheduleEvidenceId(800);
export const periodClosureUiOperation = scheduleEvidenceId(900);
export const periodClosureUiFingerprint = "a".repeat(64);
export function periodClosureUiQuery(mode: PeriodClosureQuery["mode"] = "preview", access: "owner" | "self" = "owner"): PeriodClosureQuery {
  return { ...scheduleEvidenceQuery, access, mode, periodId: ["list", "preview"].includes(mode) ? null : periodClosureUiPeriod,
    operationId: mode === "recover" ? periodClosureUiOperation : null, version: mode === "export" ? 1 : null };
}
export function periodClosureUiArtifact(): PeriodClosureArtifact {
  const wire = scheduleEvidenceWire(), row = wire.attendance.base.items[0];
  row.effect = scheduleEvidenceCorrection(row, { startAt: "2026-09-02T09:00:00.000000Z", endAt: "2026-09-02T16:00:00.000000Z", breaks: [] });
  wire.attendance.missing = [scheduleEvidenceMissing()];
  const result = parseScheduleEvidenceWire(wire), report = result.attendance;
  return { protocol: "attendance-period-artifact-v1", sourceFingerprint: periodClosureUiFingerprint, source: { synthetic: true, purpose: "UI only", context: {
    pendingCorrections: [], missing: [{ requestId: report.missing[0].requestId, operationId: report.missing[0].operationId, revision: 2, status: "approved", synthetic: true }],
    leave: [{ operationId: scheduleEvidenceId(700), summary: { status: "approved", title: "Synthetic leave <img src=x>" } }],
    calendar: [{ summary: { title: "Synthetic holiday", status: "created" } }], plans: { items: [{ synthetic: true, currentApproval: { revision: 1 } }], sessions: [] },
    reviews: [{ caseId: scheduleEvidenceId(701), revision: 2, latestDecision: { outcome: "follow_up" } }],
  } },
    worker: { workerId: result.worker.workerId, workerName: result.worker.workerName, workerNo: result.worker.workerNo,
      employeeId: periodClosureUiEmployee, employeeAuthUserId: periodClosureUiAuth },
    period: { fromDate: result.fromDate, throughDate: result.throughDate, timeZone: result.timeZone, startAt: report.base.fromAt, endAt: report.base.toAt },
    report, dayBoundaries: ["2026-09-01", "2026-09-02", "2026-09-03"].map((date, n) => ({ date, fromAt: `${date}T00:00:00.000000Z`,
      toAt: `2026-09-0${n + 2}T00:00:00.000000Z`, skipped: false })), calculationVersion: "timesheet-v2-unified-v1" };
}
export function periodClosureUiSummary(): PeriodClosureSummary {
  const a = periodClosureUiArtifact(); return { ...a.worker, ...a.period, periodId: periodClosureUiPeriod, revision: 1, currentVersion: 1,
    state: "review", sealed: false, confirmedVersion: null, unresolvedDispute: false };
}
export function periodClosureUiCommand(): PeriodClosureCommand {
  return { action: "send", operationId: periodClosureUiOperation, periodId: periodClosureUiPeriod, expectedRevision: 0, expectedVersion: 0,
    expectedFingerprint: periodClosureUiFingerprint, reason: "Synthetic review invitation" };
}
export function periodClosureUiEntry(command = periodClosureUiCommand()): PeriodClosureEntry {
  return { command, operationId: command.operationId, revision: command.expectedRevision + 1, action: command.action,
    version: command.action === "send" ? command.expectedVersion + 1 : command.expectedVersion, actorId: ["confirm", "dispute"].includes(command.action) ? periodClosureUiAuth : periodClosureUiOwner,
    reason: command.reason, recordedAt: "2026-09-11T10:00:00.000001Z" };
}
export function periodClosureUiHttp(query = periodClosureUiQuery(), command: PeriodClosureCommand | null = null): PeriodClosureResponse {
  const artifact = periodClosureUiArtifact(), common = { protocol: "period-closure-v1" as const, siteId: query.siteId, workerId: query.workerId,
    actorId: query.access === "owner" ? periodClosureUiOwner : periodClosureUiAuth, access: query.access, readAt: "2026-09-11T12:00:00.000001Z" };
  const period = { ...periodClosureUiSummary(), periodId: query.periodId ?? periodClosureUiPeriod };
  if (query.mode === "list") return { ok: true, moduleEnabled: true, data: { ...common, kind: "list", items: [period] } };
  if (query.mode === "preview") return { ok: true, moduleEnabled: true, data: { ...common, kind: "preview", preview: { artifact, blockers: [], period: query.periodId ? period : null } } };
  const original = periodClosureUiCommand();
  const receiptCommand = command ?? (query.mode === "recover" ? query.access === "self" ? { ...original, action: "confirm" as const, expectedRevision: 1, expectedVersion: 1 } : original : { ...original, operationId: scheduleEvidenceId(899) });
  const entry = periodClosureUiEntry({ ...receiptCommand, periodId: period.periodId });
  const history = Array.from({ length: entry.revision - 1 }, (_, n) => periodClosureUiEntry({ ...original, operationId: scheduleEvidenceId(899 - n), periodId: period.periodId,
    action: n === 0 ? "send" : "respond", expectedRevision: n, expectedVersion: n === 0 ? 0 : 1 })); history.push(entry);
  period.revision = entry.revision; period.currentVersion = entry.version;
  return { ok: true, moduleEnabled: true, data: { ...common, kind: "detail", period, artifact, artifactVersion: query.version ?? period.currentVersion,
    history, operation: command || query.mode === "recover" ? entry : null, sourceChanged: query.mode === "recover" || query.mode === "export" ? null : false, replayed: query.mode === "recover" } };
}
